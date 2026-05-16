package mail

import (
	"context"
	"time"

	"github.com/gdgoc/admin-api/internal/database"
	"gorm.io/gorm"
)

// MailTemplateImage records an image uploaded for use inside mail template bodies.
type MailTemplateImage struct {
	ID          string    `json:"id"`
	ChapterID   string    `json:"chapter_id"`
	ObjectKey   string    `json:"object_key"`
	FileName    string    `json:"file_name"`
	MimeType    string    `json:"mime_type"`
	ContentHash string    `json:"content_hash"` // SHA-256 hex digest
	CreatedAt   time.Time `json:"created_at"`
}

// ImageRepository handles persistence for MailTemplateImage records.
type ImageRepository struct {
	db *gorm.DB
}

func NewImageRepository(db *database.DB) *ImageRepository {
	return &ImageRepository{db: db.Gorm}
}

// FindImageByHash returns any existing image with the given SHA-256 content hash.
// Returns nil, nil when no match exists.
func (r *ImageRepository) FindImageByHash(ctx context.Context, hash string) (*MailTemplateImage, error) {
	var img MailTemplateImage
	err := r.db.WithContext(ctx).Raw(`
		SELECT id, chapter_id, object_key, file_name, mime_type, content_hash, created_at
		FROM mail_template_images
		WHERE content_hash = ?
		LIMIT 1
	`, hash).Scan(&img).Error
	if err != nil {
		return nil, err
	}
	if img.ID == "" {
		return nil, nil
	}
	return &img, nil
}

// SaveImage inserts a new mail_template_images record.
func (r *ImageRepository) SaveImage(ctx context.Context, img *MailTemplateImage) error {
	return r.db.WithContext(ctx).Exec(`
		INSERT INTO mail_template_images (id, chapter_id, object_key, file_name, mime_type, content_hash, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?)
	`, img.ID, img.ChapterID, img.ObjectKey, img.FileName, img.MimeType, img.ContentHash, img.CreatedAt).Error
}
