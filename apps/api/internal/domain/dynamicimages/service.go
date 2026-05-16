package dynamicimages

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"image/png"
	"io"
	"mime/multipart"
	"path/filepath"
	"strings"
	"time"

	"github.com/gdgoc/admin-api/internal/apperrors"
	"github.com/gdgoc/admin-api/internal/domain/auth"
	tmpl "github.com/gdgoc/admin-api/internal/domain/templates"
	"github.com/gdgoc/admin-api/internal/storage"
	"github.com/gdgoc/admin-api/internal/worker"
	"github.com/google/uuid"
)

type Service struct {
	repo     *Repository
	renderer *worker.ImageRenderer
	storage  storage.Backend
}

func NewService(repo *Repository, renderer *worker.ImageRenderer, store storage.Backend) *Service {
	return &Service{repo: repo, renderer: renderer, storage: store}
}

func (s *Service) List(ctx context.Context, caller *auth.SessionUser) ([]*DynamicImage, error) {
	if auth.IsSuperAdmin(caller.Role) {
		return s.repo.ListAll(ctx)
	}
	return s.repo.ListByChapterOrPublished(ctx, caller.ChapterID)
}

func (s *Service) Get(ctx context.Context, id string, caller *auth.SessionUser) (*DynamicImageDetail, error) {
	d, err := s.repo.GetByID(ctx, id)
	if err != nil {
		return nil, err
	}
	if !s.canAccess(d, caller) {
		return nil, apperrors.Forbidden("access denied")
	}
	return s.toDetail(d), nil
}

func (s *Service) Create(ctx context.Context, input CreateInput, caller *auth.SessionUser) (*DynamicImage, error) {
	input.OwnerUserID = caller.ID
	input.OwnerChapterID = caller.ChapterID
	return s.repo.Create(ctx, input)
}

func (s *Service) Update(ctx context.Context, id string, input UpdateInput, caller *auth.SessionUser) (*DynamicImage, error) {
	d, err := s.repo.GetByID(ctx, id)
	if err != nil {
		return nil, err
	}
	if !s.canWrite(d, caller) {
		return nil, apperrors.Forbidden("access denied")
	}
	return s.repo.Update(ctx, id, input)
}

func (s *Service) Delete(ctx context.Context, id string, caller *auth.SessionUser) error {
	d, err := s.repo.GetByID(ctx, id)
	if err != nil {
		return err
	}
	if !s.canWrite(d, caller) {
		return apperrors.Forbidden("access denied")
	}
	return s.repo.Delete(ctx, id)
}

func (s *Service) Publish(ctx context.Context, id string, caller *auth.SessionUser) (*DynamicImage, error) {
	d, err := s.repo.GetByID(ctx, id)
	if err != nil {
		return nil, err
	}
	if !s.canWrite(d, caller) {
		return nil, apperrors.Forbidden("access denied")
	}
	if err := s.repo.Publish(ctx, id); err != nil {
		return nil, err
	}
	return s.repo.GetByID(ctx, id)
}

func (s *Service) Unpublish(ctx context.Context, id string, caller *auth.SessionUser) (*DynamicImage, error) {
	d, err := s.repo.GetByID(ctx, id)
	if err != nil {
		return nil, err
	}
	if !s.canWrite(d, caller) {
		return nil, apperrors.Forbidden("access denied")
	}
	if err := s.repo.Unpublish(ctx, id); err != nil {
		return nil, err
	}
	return s.repo.GetByID(ctx, id)
}

// UploadAsset stores an image file for use in the dynamic image scene.
func (s *Service) UploadAsset(ctx context.Context, id string, fh *multipart.FileHeader, caller *auth.SessionUser) (*AssetResult, error) {
	d, err := s.repo.GetByID(ctx, id)
	if err != nil {
		return nil, err
	}
	if !s.canWrite(d, caller) {
		return nil, apperrors.Forbidden("access denied")
	}

	f, err := fh.Open()
	if err != nil {
		return nil, fmt.Errorf("open uploaded file: %w", err)
	}
	defer f.Close()

	ext := strings.ToLower(filepath.Ext(fh.Filename))
	allowed := map[string]string{
		".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
		".webp": "image/webp", ".svg": "image/svg+xml", ".gif": "image/gif",
	}
	mime, ok := allowed[ext]
	if !ok {
		return nil, apperrors.BadRequest("unsupported file type; use PNG, JPEG, WebP, SVG, or GIF")
	}

	data, err := io.ReadAll(f)
	if err != nil {
		return nil, fmt.Errorf("read uploaded file: %w", err)
	}

	sum := sha256.Sum256(data)
	hash := hex.EncodeToString(sum[:])
	_ = hash // could deduplicate across all assets — omitted for simplicity

	objectKey := fmt.Sprintf("dynamic-images/%s/assets/%s%s", id, uuid.New().String(), ext)
	size := int64(len(data))
	if _, err := s.storage.UploadAsset(ctx, objectKey, bytes.NewReader(data), size, mime); err != nil {
		return nil, fmt.Errorf("upload asset: %w", err)
	}

	return &AssetResult{ObjectKey: objectKey, CreatedAt: time.Now()}, nil
}

// AssetResult is the JSON response for UploadAsset.
type AssetResult struct {
	ObjectKey string    `json:"object_key"`
	CreatedAt time.Time `json:"created_at"`
}

// Render renders the dynamic image with the given variable overrides and
// returns the PNG-encoded bytes. Only published images can be rendered.
func (s *Service) Render(ctx context.Context, id string, vars map[string]string) ([]byte, error) {
	d, err := s.repo.GetByID(ctx, id)
	if err != nil {
		return nil, err
	}
	if d.Status != "published" {
		return nil, apperrors.NotFound("dynamic image not found")
	}
	scene, err := d.ParsedScene()
	if err != nil {
		return nil, apperrors.BadRequest("invalid scene data")
	}
	img, err := s.renderer.Render(ctx, scene, vars)
	if err != nil {
		return nil, err
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

func (s *Service) toDetail(d *DynamicImage) *DynamicImageDetail {
	detail := &DynamicImageDetail{DynamicImage: *d, Fields: []DynamicField{}}
	scene, err := d.ParsedScene()
	if err != nil {
		return detail
	}
	seen := map[string]bool{}
	for _, layer := range scene.Layers {
		if layer.Type != tmpl.LayerTypeText || layer.TextProps == nil {
			continue
		}
		if layer.TextProps.IsDynamic {
			key := layer.TextProps.VariableKey
			if key != "" && !seen[key] {
				seen[key] = true
				detail.Fields = append(detail.Fields, DynamicField{
					Key:   key,
					Label: keyToLabel(key),
				})
			}
		}
		for _, key := range worker.ExtractInterpolatedVariableKeys(layer.TextProps.Content) {
			if key == "" || seen[key] {
				continue
			}
			seen[key] = true
			detail.Fields = append(detail.Fields, DynamicField{
				Key:   key,
				Label: keyToLabel(key),
			})
		}
	}
	return detail
}

func (s *Service) canAccess(d *DynamicImage, caller *auth.SessionUser) bool {
	return auth.IsSuperAdmin(caller.Role) || d.OwnerChapterID == caller.ChapterID
}

func (s *Service) canWrite(d *DynamicImage, caller *auth.SessionUser) bool {
	return auth.IsSuperAdmin(caller.Role) || d.OwnerChapterID == caller.ChapterID
}

// keyToLabel converts a snake_case / camelCase key into a human-readable label.
func keyToLabel(key string) string {
	s := strings.ReplaceAll(key, "_", " ")
	s = strings.ReplaceAll(s, "-", " ")
	if len(s) == 0 {
		return key
	}
	return strings.ToUpper(s[:1]) + s[1:]
}
