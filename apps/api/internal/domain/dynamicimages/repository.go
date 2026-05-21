package dynamicimages

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/gdgoc/admin-api/internal/apperrors"
	"github.com/gdgoc/admin-api/internal/database"
	tmpl "github.com/gdgoc/admin-api/internal/domain/templates"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

type Repository struct {
	db *gorm.DB
}

func NewRepository(db *database.DB) *Repository {
	return &Repository{db: db.Gorm}
}

func (r *Repository) List(ctx context.Context, ownerChapterID string) ([]*DynamicImage, error) {
	items := make([]*DynamicImage, 0)
	err := r.db.WithContext(ctx).Raw(`
		SELECT d.id, d.name, d.description, d.status, d.owner_user_id, d.owner_chapter_id, d.scene, d.created_at, d.updated_at,
		       COALESCE(u.name, '') AS created_by_name
		FROM dynamic_images d
		LEFT JOIN users u ON u.id = d.owner_user_id
		WHERE d.owner_chapter_id = ? AND d.deleted_at IS NULL
		ORDER BY d.updated_at DESC
	`, ownerChapterID).Scan(&items).Error
	return items, err
}

// ListByChapterOrPublished returns all images owned by ownerChapterID
// plus published images from any other chapter (for cross-chapter visibility).
func (r *Repository) ListByChapterOrPublished(ctx context.Context, ownerChapterID string) ([]*DynamicImage, error) {
	items := make([]*DynamicImage, 0)
	err := r.db.WithContext(ctx).Raw(`
		SELECT d.id, d.name, d.description, d.status, d.owner_user_id, d.owner_chapter_id, d.scene, d.created_at, d.updated_at,
		       COALESCE(u.name, '') AS created_by_name
		FROM dynamic_images d
		LEFT JOIN users u ON u.id = d.owner_user_id
		WHERE d.deleted_at IS NULL AND (d.owner_chapter_id = ? OR d.status = 'published')
		ORDER BY (d.owner_chapter_id = ?) DESC, d.updated_at DESC
	`, ownerChapterID, ownerChapterID).Scan(&items).Error
	return items, err
}

func (r *Repository) ListAll(ctx context.Context) ([]*DynamicImage, error) {
	items := make([]*DynamicImage, 0)
	err := r.db.WithContext(ctx).Raw(`
		SELECT d.id, d.name, d.description, d.status, d.owner_user_id, d.owner_chapter_id, d.scene, d.created_at, d.updated_at,
		       COALESCE(u.name, '') AS created_by_name
		FROM dynamic_images d
		LEFT JOIN users u ON u.id = d.owner_user_id
		WHERE d.deleted_at IS NULL
		ORDER BY d.updated_at DESC
	`).Scan(&items).Error
	return items, err
}

func (r *Repository) GetByID(ctx context.Context, id string) (*DynamicImage, error) {
	var d DynamicImage
	err := r.db.WithContext(ctx).Raw(`
		SELECT d.id, d.name, d.description, d.status, d.owner_user_id, d.owner_chapter_id, d.scene, d.created_at, d.updated_at,
		       COALESCE(u.name, '') AS created_by_name
		FROM dynamic_images d
		LEFT JOIN users u ON u.id = d.owner_user_id
		WHERE d.id = ? AND d.deleted_at IS NULL
	`, id).Scan(&d).Error
	if err != nil || d.ID == "" {
		return nil, apperrors.NotFound("dynamic image not found")
	}
	return &d, nil
}

type CreateInput struct {
	Name           string
	Description    string
	OwnerUserID    string
	OwnerChapterID string
	Scene          tmpl.SceneDefinition
}

func (r *Repository) Create(ctx context.Context, input CreateInput) (*DynamicImage, error) {
	sceneJSON, err := json.Marshal(input.Scene)
	if err != nil {
		return nil, fmt.Errorf("marshal scene: %w", err)
	}
	id := uuid.New().String()
	err = r.db.WithContext(ctx).Exec(`
		INSERT INTO dynamic_images (id, name, description, owner_user_id, owner_chapter_id, scene, created_at, updated_at)
		VALUES (?, ?, ?, ?, NULLIF(?, '')::uuid, ?, NOW(), NOW())
	`, id, input.Name, input.Description, input.OwnerUserID, input.OwnerChapterID, sceneJSON).Error
	if err != nil {
		return nil, err
	}
	return r.GetByID(ctx, id)
}

type UpdateInput struct {
	Name        string
	Description string
	Scene       tmpl.SceneDefinition
}

func (r *Repository) Update(ctx context.Context, id string, input UpdateInput) (*DynamicImage, error) {
	sceneJSON, err := json.Marshal(input.Scene)
	if err != nil {
		return nil, fmt.Errorf("marshal scene: %w", err)
	}
	result := r.db.WithContext(ctx).Exec(`
		UPDATE dynamic_images
		SET name = ?, description = ?, scene = ?, updated_at = NOW()
		WHERE id = ? AND deleted_at IS NULL
	`, input.Name, input.Description, sceneJSON, id)
	if result.Error != nil {
		return nil, result.Error
	}
	if result.RowsAffected == 0 {
		return nil, apperrors.NotFound("dynamic image not found")
	}
	return r.GetByID(ctx, id)
}

func (r *Repository) Delete(ctx context.Context, id string) error {
	result := r.db.WithContext(ctx).Exec(`
		UPDATE dynamic_images SET deleted_at = NOW() WHERE id = ? AND deleted_at IS NULL
	`, id)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return apperrors.NotFound("dynamic image not found")
	}
	return nil
}

func (r *Repository) Publish(ctx context.Context, id string) error {
	result := r.db.WithContext(ctx).Exec(`
		UPDATE dynamic_images SET status = 'published', updated_at = NOW()
		WHERE id = ? AND deleted_at IS NULL
	`, id)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return apperrors.NotFound("dynamic image not found")
	}
	return nil
}

func (r *Repository) Unpublish(ctx context.Context, id string) error {
	result := r.db.WithContext(ctx).Exec(`
		UPDATE dynamic_images SET status = 'draft', updated_at = NOW()
		WHERE id = ? AND deleted_at IS NULL
	`, id)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return apperrors.NotFound("dynamic image not found")
	}
	return nil
}

func (r *Repository) Clone(ctx context.Context, sourceID, newOwnerUserID, newOwnerChapterID string) (*DynamicImage, error) {
	src, err := r.GetByID(ctx, sourceID)
	if err != nil {
		return nil, err
	}
	id := uuid.New().String()
	err = r.db.WithContext(ctx).Exec(`
		INSERT INTO dynamic_images (id, name, description, owner_user_id, owner_chapter_id, scene, created_at, updated_at)
		VALUES (?, ?, ?, ?, NULLIF(?, '')::uuid, ?, NOW(), NOW())
	`, id, src.Name+" (Clone)", src.Description, newOwnerUserID, newOwnerChapterID, src.Scene).Error
	if err != nil {
		return nil, err
	}
	return r.GetByID(ctx, id)
}
