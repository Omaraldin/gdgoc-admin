package fonts

import (
	"context"

	"github.com/gdgoc/admin-api/internal/apperrors"
	"github.com/gdgoc/admin-api/internal/database"
	"gorm.io/gorm"
)

// Repository handles database access for fonts.
type Repository struct {
	db *gorm.DB
}

func NewRepository(db *database.DB) *Repository {
	return &Repository{db: db.Gorm}
}

func (r *Repository) List(ctx context.Context) ([]*Font, error) {
	var fonts []*Font
	err := r.db.WithContext(ctx).Raw(`
		SELECT id, family_name, object_key, file_name, mime_type, content_hash, uploaded_by, created_at
		FROM fonts
		ORDER BY family_name ASC
	`).Scan(&fonts).Error
	return fonts, err
}

func (r *Repository) GetByID(ctx context.Context, id string) (*Font, error) {
	var f Font
	if err := r.db.WithContext(ctx).Raw(`
		SELECT id, family_name, object_key, file_name, mime_type, content_hash, uploaded_by, created_at
		FROM fonts WHERE id = ?
	`, id).Scan(&f).Error; err != nil {
		return nil, err
	}
	if f.ID == "" {
		return nil, apperrors.NotFound("font not found")
	}
	return &f, nil
}

// FindByHash returns the font with the given SHA-256 content hash, or nil if none exists.
func (r *Repository) FindByHash(ctx context.Context, hash string) (*Font, error) {
	var f Font
	if err := r.db.WithContext(ctx).Raw(`
		SELECT id, family_name, object_key, file_name, mime_type, content_hash, uploaded_by, created_at
		FROM fonts WHERE content_hash = ?
	`, hash).Scan(&f).Error; err != nil {
		return nil, err
	}
	if f.ID == "" {
		return nil, nil // not found — caller decides what to do
	}
	return &f, nil
}

func (r *Repository) Create(ctx context.Context, f *Font) error {
	return r.db.WithContext(ctx).Exec(`
		INSERT INTO fonts (id, family_name, object_key, file_name, mime_type, content_hash, uploaded_by, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, NOW())
	`, f.ID, f.FamilyName, f.ObjectKey, f.FileName, f.MimeType, f.ContentHash, f.UploadedBy).Error
}

func (r *Repository) Delete(ctx context.Context, id string) error {
	res := r.db.WithContext(ctx).Exec(`DELETE FROM fonts WHERE id = ?`, id)
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return apperrors.NotFound("font not found")
	}
	return nil
}
