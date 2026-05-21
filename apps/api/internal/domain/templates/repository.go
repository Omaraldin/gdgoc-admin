package templates

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/gdgoc/admin-api/internal/apperrors"
	"github.com/gdgoc/admin-api/internal/database"
	"gorm.io/gorm"
)

type Repository struct {
	db *gorm.DB
}

func NewRepository(db *database.DB) *Repository {
	return &Repository{db: db.Gorm}
}

func (r *Repository) List(ctx context.Context, ownerChapterID string) ([]*Template, error) {
	templates := make([]*Template, 0)
	err := r.db.WithContext(ctx).Raw(`
		SELECT t.id, t.name, t.description, t.owner_user_id, t.owner_chapter_id, t.visibility, t.status,
		       t.source_template_id, t.current_version_id, t.created_at, t.updated_at,
		       COALESCE(u.name, '') AS created_by_name
		FROM templates t
		LEFT JOIN users u ON u.id = t.owner_user_id
		WHERE t.owner_chapter_id = ? AND t.deleted_at IS NULL
		ORDER BY t.updated_at DESC
	`, ownerChapterID).Scan(&templates).Error
	return templates, err
}

func (r *Repository) ListAll(ctx context.Context) ([]*Template, error) {
	templates := make([]*Template, 0)
	err := r.db.WithContext(ctx).Raw(`
		SELECT t.id, t.name, t.description, t.owner_user_id, t.owner_chapter_id, t.visibility, t.status,
		       t.source_template_id, t.current_version_id, t.created_at, t.updated_at,
		       COALESCE(u.name, '') AS created_by_name
		FROM templates t
		LEFT JOIN users u ON u.id = t.owner_user_id
		WHERE t.deleted_at IS NULL
		ORDER BY t.updated_at DESC
	`).Scan(&templates).Error
	return templates, err
}

func (r *Repository) ListPublic(ctx context.Context) ([]*Template, error) {
	templates := make([]*Template, 0)
	err := r.db.WithContext(ctx).Raw(`
		SELECT t.id, t.name, t.description, t.owner_user_id, t.owner_chapter_id, t.visibility, t.status,
		       t.source_template_id, t.current_version_id, t.created_at, t.updated_at,
		       COALESCE(u.name, '') AS created_by_name
		FROM templates t
		LEFT JOIN users u ON u.id = t.owner_user_id
		WHERE t.visibility = 'public' AND t.status = 'published' AND t.deleted_at IS NULL
		ORDER BY t.updated_at DESC
	`).Scan(&templates).Error
	return templates, err
}

func (r *Repository) GetByID(ctx context.Context, id string) (*Template, error) {
	var t Template
	err := r.db.WithContext(ctx).Raw(`
		SELECT t.id, t.name, t.description, t.owner_user_id, t.owner_chapter_id, t.visibility, t.status,
		       t.source_template_id, t.current_version_id, t.created_at, t.updated_at,
		       COALESCE(u.name, '') AS created_by_name
		FROM templates t
		LEFT JOIN users u ON u.id = t.owner_user_id
		WHERE t.id = ? AND t.deleted_at IS NULL
	`, id).Scan(&t).Error
	if err != nil || t.ID == "" {
		return nil, apperrors.NotFound("template not found")
	}
	return &t, nil
}

type CreateTemplateInput struct {
	Name           string             `json:"name"`
	Description    string             `json:"description"`
	Visibility     TemplateVisibility `json:"visibility"`
	OwnerUserID    string
	OwnerChapterID string
	Scene          SceneDefinition `json:"scene"`
}

func (r *Repository) Create(ctx context.Context, input CreateTemplateInput) (*Template, error) {
	sceneJSON, err := json.Marshal(input.Scene)
	if err != nil {
		return nil, fmt.Errorf("marshal scene: %w", err)
	}

	var tmplID string
	err = r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Raw(`
			INSERT INTO templates (name, description, owner_user_id, owner_chapter_id, visibility, status, created_at, updated_at)
			VALUES (?, ?, ?, NULLIF(?, '')::uuid, ?, 'draft', NOW(), NOW())
			RETURNING id
		`, input.Name, input.Description, input.OwnerUserID, input.OwnerChapterID, input.Visibility,
		).Scan(&tmplID).Error; err != nil {
			return err
		}

		var versionID string
		if err := tx.Raw(`
			INSERT INTO template_versions (template_id, version, scene, created_at)
			VALUES (?, 1, ?, NOW())
			RETURNING id
		`, tmplID, sceneJSON).Scan(&versionID).Error; err != nil {
			return err
		}

		return tx.Exec(`UPDATE templates SET current_version_id = ? WHERE id = ?`, versionID, tmplID).Error
	})
	if err != nil {
		return nil, err
	}
	return r.GetByID(ctx, tmplID)
}

// HasBatches returns true if any issuance batch references this template.
func (r *Repository) HasBatches(ctx context.Context, id string) (bool, error) {
	var count int64
	if err := r.db.WithContext(ctx).Raw(
		`SELECT COUNT(*) FROM issuance_batches WHERE template_id = ?`, id,
	).Scan(&count).Error; err != nil {
		return false, err
	}
	return count > 0, nil
}

// HardDelete soft-deletes the template (sets deleted_at).
func (r *Repository) HardDelete(ctx context.Context, id string) error {
	result := r.db.WithContext(ctx).Exec(
		`UPDATE templates SET deleted_at = NOW() WHERE id = ? AND deleted_at IS NULL`, id)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return apperrors.NotFound("template not found")
	}
	return nil
}

func (r *Repository) UpdateMeta(ctx context.Context, id, name, description string) error {
	result := r.db.WithContext(ctx).Exec(
		`UPDATE templates SET name = ?, description = ?, updated_at = NOW() WHERE id = ? AND deleted_at IS NULL`,
		name, description, id)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return apperrors.NotFound("template not found")
	}
	return nil
}

func (r *Repository) SetStatus(ctx context.Context, id string, status TemplateStatus) error {
	result := r.db.WithContext(ctx).Exec(
		`UPDATE templates SET status = ?, updated_at = NOW() WHERE id = ? AND deleted_at IS NULL`,
		status, id)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return apperrors.NotFound("template not found")
	}
	return nil
}

// Publish sets status='published' and visibility='public' so the template
// appears in cross-chapter public listings.
func (r *Repository) Publish(ctx context.Context, id string) error {
	result := r.db.WithContext(ctx).Exec(
		`UPDATE templates SET status = 'published', visibility = 'public', updated_at = NOW()
		 WHERE id = ? AND deleted_at IS NULL`, id)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return apperrors.NotFound("template not found")
	}
	return nil
}

func (r *Repository) Clone(ctx context.Context, sourceID, newOwnerUserID, newOwnerChapterID, name string) (*Template, error) {
	source, err := r.GetByID(ctx, sourceID)
	if err != nil {
		return nil, err
	}

	if source.CurrentVersionID == nil {
		return nil, fmt.Errorf("get source version: template has no current version")
	}
	version, err := r.GetVersion(ctx, *source.CurrentVersionID)
	if err != nil {
		return nil, fmt.Errorf("get source version: %w", err)
	}

	var scene SceneDefinition
	if err := json.Unmarshal(version.Scene, &scene); err != nil {
		return nil, err
	}

	cloneName := name
	if cloneName == "" {
		cloneName = source.Name + " (Clone)"
	}

	cloned, err := r.Create(ctx, CreateTemplateInput{
		Name:           cloneName,
		Description:    source.Description,
		Visibility:     VisibilityPrivate,
		OwnerUserID:    newOwnerUserID,
		OwnerChapterID: newOwnerChapterID,
		Scene:          scene,
	})
	if err != nil {
		return nil, err
	}

	return cloned, r.db.WithContext(ctx).Exec(
		`UPDATE templates SET source_template_id = ? WHERE id = ?`, sourceID, cloned.ID,
	).Error
}

func (r *Repository) GetVersion(ctx context.Context, versionID string) (*TemplateVersion, error) {
	var v TemplateVersion
	err := r.db.WithContext(ctx).Raw(
		`SELECT id, template_id, version, scene, created_at FROM template_versions WHERE id = ?`,
		versionID,
	).Scan(&v).Error
	if err != nil || v.ID == "" {
		return nil, apperrors.NotFound("template version not found")
	}
	return &v, nil
}

func (r *Repository) ListVersions(ctx context.Context, templateID string) ([]*TemplateVersion, error) {
	versions := make([]*TemplateVersion, 0)
	err := r.db.WithContext(ctx).Raw(`
		SELECT id, template_id, version, scene, created_at
		FROM template_versions WHERE template_id = ? ORDER BY version DESC`, templateID,
	).Scan(&versions).Error
	return versions, err
}

func (r *Repository) CreateVersion(ctx context.Context, templateID string, scene SceneDefinition) (*TemplateVersion, error) {
	sceneJSON, err := json.Marshal(scene)
	if err != nil {
		return nil, fmt.Errorf("marshal scene: %w", err)
	}

	var versionID string
	err = r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		// Determine next version number.
		var nextVer int
		if err := tx.Raw(
			`SELECT COALESCE(MAX(version), 0) + 1 FROM template_versions WHERE template_id = ?`,
			templateID,
		).Scan(&nextVer).Error; err != nil {
			return err
		}

		if err := tx.Raw(`
			INSERT INTO template_versions (template_id, version, scene, created_at)
			VALUES (?, ?, ?, NOW())
			RETURNING id
		`, templateID, nextVer, sceneJSON).Scan(&versionID).Error; err != nil {
			return err
		}

		return tx.Exec(
			`UPDATE templates SET current_version_id = ?, updated_at = NOW() WHERE id = ?`,
			versionID, templateID,
		).Error
	})
	if err != nil {
		return nil, err
	}
	return r.GetVersion(ctx, versionID)
}

// FindAssetByHash looks up any existing asset with the given SHA-256 content hash.
// Returns nil, nil when no match is found.
func (r *Repository) FindAssetByHash(ctx context.Context, hash string) (*TemplateAsset, error) {
	var a TemplateAsset
	err := r.db.WithContext(ctx).Raw(`
		SELECT id, template_id, object_key, file_name, mime_type, content_hash, created_at
		FROM template_assets
		WHERE content_hash = ?
		LIMIT 1
	`, hash).Scan(&a).Error
	if err != nil {
		return nil, err
	}
	if a.ID == "" {
		return nil, nil
	}
	return &a, nil
}

// SaveAsset inserts a new template_assets record.
func (r *Repository) SaveAsset(ctx context.Context, a *TemplateAsset) error {
	return r.db.WithContext(ctx).Exec(`
		INSERT INTO template_assets (id, template_id, object_key, file_name, mime_type, content_hash, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?)
	`, a.ID, a.TemplateID, a.ObjectKey, a.FileName, a.MimeType, a.ContentHash, a.CreatedAt).Error
}
