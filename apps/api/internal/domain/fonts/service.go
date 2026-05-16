package fonts

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"mime/multipart"
	"path/filepath"
	"strings"

	"github.com/gdgoc/admin-api/internal/apperrors"
	"github.com/gdgoc/admin-api/internal/domain/auth"
	"github.com/gdgoc/admin-api/internal/storage"
	"github.com/google/uuid"
)

// Service handles business logic for the font library.
type Service struct {
	repo  *Repository
	store storage.Backend
}

func NewService(repo *Repository, store storage.Backend) *Service {
	return &Service{repo: repo, store: store}
}

func (s *Service) List(ctx context.Context) ([]*Font, error) {
	fonts, err := s.repo.List(ctx)
	if err != nil {
		return nil, err
	}
	for _, f := range fonts {
		f.AssetURL = s.store.GetAssetURL(f.ObjectKey)
	}
	return fonts, nil
}

var allowedFontMIME = map[string]string{
	".ttf":   "font/ttf",
	".otf":   "font/otf",
	".woff":  "font/woff",
	".woff2": "font/woff2",
}

// Upload stores a font file, deduplicating by SHA-256 content hash.
// If an identical file was already uploaded, the existing record is returned.
func (s *Service) Upload(ctx context.Context, fh *multipart.FileHeader, caller *auth.SessionUser) (*Font, error) {
	ext := strings.ToLower(filepath.Ext(fh.Filename))
	mime, ok := allowedFontMIME[ext]
	if !ok {
		return nil, apperrors.BadRequest("unsupported font type; use TTF, OTF, WOFF, or WOFF2")
	}

	f, err := fh.Open()
	if err != nil {
		return nil, fmt.Errorf("open font file: %w", err)
	}
	defer f.Close()

	data, err := io.ReadAll(f)
	if err != nil {
		return nil, fmt.Errorf("read font file: %w", err)
	}

	sum := sha256.Sum256(data)
	hash := hex.EncodeToString(sum[:])

	// Dedup: if this exact file was already uploaded, return the existing record.
	existing, err := s.repo.FindByHash(ctx, hash)
	if err != nil {
		return nil, fmt.Errorf("check dedup hash: %w", err)
	}
	if existing != nil {
		existing.AssetURL = s.store.GetAssetURL(existing.ObjectKey)
		return existing, nil
	}

	// Derive a human-readable family name from the filename.
	familyName := strings.TrimSuffix(fh.Filename, filepath.Ext(fh.Filename))
	familyName = strings.ReplaceAll(familyName, "-", " ")
	familyName = strings.ReplaceAll(familyName, "_", " ")

	objectKey := fmt.Sprintf("fonts/%s%s", uuid.New().String(), ext)
	if _, err := s.store.UploadAsset(ctx, objectKey, bytes.NewReader(data), int64(len(data)), mime); err != nil {
		return nil, fmt.Errorf("upload font to storage: %w", err)
	}

	font := &Font{
		ID:          uuid.New().String(),
		FamilyName:  familyName,
		ObjectKey:   objectKey,
		FileName:    fh.Filename,
		MimeType:    mime,
		ContentHash: hash,
		UploadedBy:  &caller.ID,
	}
	if err := s.repo.Create(ctx, font); err != nil {
		return nil, fmt.Errorf("save font record: %w", err)
	}

	font.AssetURL = s.store.GetAssetURL(objectKey)
	return font, nil
}

// Delete removes a font. Only the uploader or a super admin may delete.
func (s *Service) Delete(ctx context.Context, id string, caller *auth.SessionUser) error {
	font, err := s.repo.GetByID(ctx, id)
	if err != nil {
		return err
	}
	if !auth.IsSuperAdmin(caller.Role) && (font.UploadedBy == nil || *font.UploadedBy != caller.ID) {
		return apperrors.Forbidden("only the uploader or a super admin can delete this font")
	}
	if err := s.repo.Delete(ctx, id); err != nil {
		return err
	}
	// Best-effort: remove from storage (don't fail the request on storage errors).
	_ = s.store.DeleteObject(ctx, s.store.BucketAssets(), font.ObjectKey)
	return nil
}
