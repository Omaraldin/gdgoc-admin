package templates

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"path/filepath"
	"strings"
	"time"

	"github.com/gdgoc/admin-api/internal/apperrors"
	"github.com/gdgoc/admin-api/internal/domain/auth"
	"github.com/gdgoc/admin-api/internal/storage"
	"github.com/google/uuid"
)

type Service struct {
	repo    *Repository
	storage storage.Backend
}

func NewService(repo *Repository, storage storage.Backend) *Service {
	return &Service{repo: repo, storage: storage}
}

func (s *Service) List(ctx context.Context, caller *auth.SessionUser) ([]*Template, error) {
	if auth.IsSuperAdmin(caller.Role) {
		// Super admins see all templates across all chapters
		return s.repo.ListAll(ctx)
	}
	if caller.ChapterID == "" {
		return []*Template{}, nil
	}
	return s.repo.List(ctx, caller.ChapterID)
}

func (s *Service) ListPublic(ctx context.Context) ([]*Template, error) {
	return s.repo.ListPublic(ctx)
}

func (s *Service) Get(ctx context.Context, id string, caller *auth.SessionUser) (*Template, error) {
	tmpl, err := s.repo.GetByID(ctx, id)
	if err != nil {
		return nil, err
	}
	if !s.canRead(tmpl, caller) {
		return nil, apperrors.Forbidden("access denied")
	}
	return tmpl, nil
}

func (s *Service) Create(ctx context.Context, input CreateTemplateInput, caller *auth.SessionUser) (*Template, error) {
	input.OwnerUserID = caller.ID
	input.OwnerChapterID = caller.ChapterID
	return s.repo.Create(ctx, input)
}

func (s *Service) UpdateMeta(ctx context.Context, id, name, description string, caller *auth.SessionUser) error {
	tmpl, err := s.repo.GetByID(ctx, id)
	if err != nil {
		return err
	}
	if !s.canWrite(tmpl, caller) {
		return apperrors.Forbidden("access denied")
	}
	if name == "" {
		return apperrors.BadRequest("name is required")
	}
	return s.repo.UpdateMeta(ctx, id, name, description)
}

func (s *Service) Publish(ctx context.Context, id string, caller *auth.SessionUser) error {
	tmpl, err := s.repo.GetByID(ctx, id)
	if err != nil {
		return err
	}
	if !s.canWrite(tmpl, caller) {
		return apperrors.Forbidden("access denied")
	}
	return s.repo.Publish(ctx, id)
}

func (s *Service) Archive(ctx context.Context, id string, caller *auth.SessionUser) error {
	tmpl, err := s.repo.GetByID(ctx, id)
	if err != nil {
		return err
	}
	if !s.canWrite(tmpl, caller) {
		return apperrors.Forbidden("access denied")
	}
	return s.repo.SetStatus(ctx, id, StatusArchived)
}

// Delete hard-deletes the template if no batches reference it, otherwise archives it.
// Returns a boolean indicating whether the template was archived (true) or deleted (false).
func (s *Service) Delete(ctx context.Context, id string, caller *auth.SessionUser) (archived bool, err error) {
	tmpl, err := s.repo.GetByID(ctx, id)
	if err != nil {
		return false, err
	}
	if !s.canWrite(tmpl, caller) {
		return false, apperrors.Forbidden("access denied")
	}
	hasBatches, err := s.repo.HasBatches(ctx, id)
	if err != nil {
		return false, err
	}
	if hasBatches {
		return true, s.repo.SetStatus(ctx, id, StatusArchived)
	}
	return false, s.repo.HardDelete(ctx, id)
}
func (s *Service) Clone(ctx context.Context, sourceID, name string, caller *auth.SessionUser) (*Template, error) {
	source, err := s.repo.GetByID(ctx, sourceID)
	if err != nil {
		return nil, err
	}
	// Can only clone published public templates, or own templates
	if source.OwnerChapterID != caller.ChapterID {
		if source.Visibility != VisibilityPublic || source.Status != StatusPublished {
			return nil, apperrors.Forbidden("template is not publicly available")
		}
	}
	return s.repo.Clone(ctx, sourceID, caller.ID, caller.ChapterID, name)
}

func (s *Service) UploadAsset(ctx context.Context, templateID string, fh *multipart.FileHeader, caller *auth.SessionUser) (*TemplateAsset, error) {
	tmpl, err := s.repo.GetByID(ctx, templateID)
	if err != nil {
		return nil, err
	}
	if !s.canWrite(tmpl, caller) {
		return nil, apperrors.Forbidden("access denied")
	}

	f, err := fh.Open()
	if err != nil {
		return nil, fmt.Errorf("open uploaded file: %w", err)
	}
	defer f.Close()

	ext := strings.ToLower(filepath.Ext(fh.Filename))
	allowed := map[string]string{
		".png":  "image/png",
		".jpg":  "image/jpeg",
		".jpeg": "image/jpeg",
		".webp": "image/webp",
		".svg":  "image/svg+xml",
		".gif":  "image/gif",
	}
	mime, ok := allowed[ext]
	if !ok {
		return nil, apperrors.BadRequest("unsupported file type; use PNG, JPEG, WebP, SVG, or GIF")
	}

	// Read all bytes so we can hash and then (conditionally) upload.
	data, err := io.ReadAll(f)
	if err != nil {
		return nil, fmt.Errorf("read uploaded file: %w", err)
	}

	// Compute SHA-256 content hash.
	sum := sha256.Sum256(data)
	hash := hex.EncodeToString(sum[:])

	// Check whether this exact file content was already uploaded anywhere.
	existing, err := s.repo.FindAssetByHash(ctx, hash)
	if err != nil {
		return nil, fmt.Errorf("check content hash: %w", err)
	}

	if existing != nil {
		// Same content already in storage – reuse the object key.
		// If it already belongs to this template, return it as-is.
		if existing.TemplateID == templateID {
			return existing, nil
		}
		// Otherwise create a new asset record for this template pointing to
		// the same object (no re-upload needed).
		asset := &TemplateAsset{
			ID:          uuid.New().String(),
			TemplateID:  templateID,
			ObjectKey:   existing.ObjectKey,
			FileName:    fh.Filename,
			MimeType:    mime,
			ContentHash: hash,
			CreatedAt:   time.Now(),
		}
		if err := s.repo.SaveAsset(ctx, asset); err != nil {
			return nil, fmt.Errorf("save asset: %w", err)
		}
		return asset, nil
	}

	// New content – upload to storage.
	objectKey := fmt.Sprintf("templates/%s/assets/%s%s", templateID, uuid.New().String(), ext)
	if _, err := s.storage.UploadAsset(ctx, objectKey, bytes.NewReader(data), fh.Size, mime); err != nil {
		return nil, fmt.Errorf("upload asset: %w", err)
	}

	asset := &TemplateAsset{
		ID:          uuid.New().String(),
		TemplateID:  templateID,
		ObjectKey:   objectKey,
		FileName:    fh.Filename,
		MimeType:    mime,
		ContentHash: hash,
		CreatedAt:   time.Now(),
	}
	if err := s.repo.SaveAsset(ctx, asset); err != nil {
		return nil, fmt.Errorf("save asset: %w", err)
	}
	return asset, nil
}

func (s *Service) GetVersion(ctx context.Context, versionID string) (*TemplateVersion, error) {
	return s.repo.GetVersion(ctx, versionID)
}

func (s *Service) CreateVersion(ctx context.Context, templateID string, scene SceneDefinition, caller *auth.SessionUser) (*TemplateVersion, error) {
	tmpl, err := s.repo.GetByID(ctx, templateID)
	if err != nil {
		return nil, err
	}
	if !s.canWrite(tmpl, caller) {
		return nil, apperrors.Forbidden("access denied")
	}
	return s.repo.CreateVersion(ctx, templateID, scene)
}

func (s *Service) ListVersions(ctx context.Context, templateID string) ([]*TemplateVersion, error) {
	return s.repo.ListVersions(ctx, templateID)
}

// TemplateExportData is the portable JSON representation of a template (no DB IDs).
type TemplateExportData struct {
	Name        string          `json:"name"`
	Description string          `json:"description"`
	Scene       SceneDefinition `json:"scene"`
}

func (s *Service) Export(ctx context.Context, id string, caller *auth.SessionUser) (*TemplateExportData, error) {
	tmpl, err := s.repo.GetByID(ctx, id)
	if err != nil {
		return nil, err
	}
	if !s.canRead(tmpl, caller) {
		return nil, apperrors.Forbidden("access denied")
	}
	if tmpl.CurrentVersionID == nil {
		return nil, apperrors.BadRequest("template has no content to export")
	}
	version, err := s.repo.GetVersion(ctx, *tmpl.CurrentVersionID)
	if err != nil {
		return nil, err
	}
	var scene SceneDefinition
	if err := json.Unmarshal(version.Scene, &scene); err != nil {
		return nil, fmt.Errorf("parse scene: %w", err)
	}
	return &TemplateExportData{
		Name:        tmpl.Name,
		Description: tmpl.Description,
		Scene:       scene,
	}, nil
}

func (s *Service) Import(ctx context.Context, data TemplateExportData, caller *auth.SessionUser) (*Template, error) {
	if data.Name == "" {
		return nil, apperrors.BadRequest("name is required")
	}
	return s.repo.Create(ctx, CreateTemplateInput{
		Name:           data.Name,
		Description:    data.Description,
		Visibility:     VisibilityPrivate,
		OwnerUserID:    caller.ID,
		OwnerChapterID: caller.ChapterID,
		Scene:          data.Scene,
	})
}

func (s *Service) canRead(tmpl *Template, caller *auth.SessionUser) bool {
	if auth.IsSuperAdmin(caller.Role) {
		return true
	}
	if tmpl.OwnerChapterID == caller.ChapterID {
		return true
	}
	return tmpl.Visibility == VisibilityPublic && tmpl.Status == StatusPublished
}

func (s *Service) canWrite(tmpl *Template, caller *auth.SessionUser) bool {
	if auth.IsSuperAdmin(caller.Role) {
		return true
	}
	// Allow any member of the same chapter to edit the chapter's templates
	if tmpl.OwnerChapterID != "" && tmpl.OwnerChapterID == caller.ChapterID {
		return true
	}
	return tmpl.OwnerUserID == caller.ID
}
