package mail

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/gdgoc/admin-api/internal/apperrors"
	"github.com/gdgoc/admin-api/internal/database"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

// MailTemplate is a reusable HTML email template with dynamic variable slots.
type MailTemplate struct {
	ID        string    `json:"id"`
	ChapterID string    `json:"chapter_id"`
	Name      string    `json:"name"`
	Subject   string    `json:"subject"`
	Body      string    `json:"body"` // HTML from rich editor
	Variables []string  `json:"variables"`
	Status    string    `json:"status"` // "draft" | "published"
	CreatedBy string    `json:"created_by"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// TemplateRepository handles persistence for MailTemplate records.
type TemplateRepository struct {
	db *gorm.DB
}

func NewTemplateRepository(db *database.DB) *TemplateRepository {
	return &TemplateRepository{db: db.Gorm}
}

func (r *TemplateRepository) List(ctx context.Context, chapterID string) ([]*MailTemplate, error) {
	rows, err := r.db.WithContext(ctx).Raw(
		`SELECT id, chapter_id, name, subject, body, variables, status, created_by, created_at, updated_at
		 FROM mail_templates WHERE chapter_id = ? ORDER BY created_at DESC`, chapterID,
	).Rows()
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var results []*MailTemplate
	for rows.Next() {
		var t MailTemplate
		var varsJSON []byte
		if err := rows.Scan(&t.ID, &t.ChapterID, &t.Name, &t.Subject, &t.Body, &varsJSON,
			&t.Status, &t.CreatedBy, &t.CreatedAt, &t.UpdatedAt); err != nil {
			return nil, err
		}
		if err := json.Unmarshal(varsJSON, &t.Variables); err != nil {
			t.Variables = []string{}
		}
		results = append(results, &t)
	}
	return results, nil
}

// ListByChapterOrPublished returns all templates owned by chapterID plus
// published templates from any other chapter for cross-chapter visibility.
func (r *TemplateRepository) ListByChapterOrPublished(ctx context.Context, chapterID string) ([]*MailTemplate, error) {
	rows, err := r.db.WithContext(ctx).Raw(
		`SELECT id, chapter_id, name, subject, body, variables, status, created_by, created_at, updated_at
		 FROM mail_templates WHERE chapter_id = ? OR status = 'published'
		 ORDER BY (chapter_id = ?) DESC, created_at DESC`, chapterID, chapterID,
	).Rows()
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var results []*MailTemplate
	for rows.Next() {
		var t MailTemplate
		var varsJSON []byte
		if err := rows.Scan(&t.ID, &t.ChapterID, &t.Name, &t.Subject, &t.Body, &varsJSON,
			&t.Status, &t.CreatedBy, &t.CreatedAt, &t.UpdatedAt); err != nil {
			return nil, err
		}
		if err := json.Unmarshal(varsJSON, &t.Variables); err != nil {
			t.Variables = []string{}
		}
		results = append(results, &t)
	}
	return results, nil
}

func (r *TemplateRepository) ListAll(ctx context.Context) ([]*MailTemplate, error) {
	rows, err := r.db.WithContext(ctx).Raw(
		`SELECT id, chapter_id, name, subject, body, variables, status, created_by, created_at, updated_at
                 FROM mail_templates ORDER BY chapter_id, created_at DESC`,
	).Rows()
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var results []*MailTemplate
	for rows.Next() {
		var t MailTemplate
		var varsJSON []byte
		if err := rows.Scan(&t.ID, &t.ChapterID, &t.Name, &t.Subject, &t.Body, &varsJSON,
			&t.Status, &t.CreatedBy, &t.CreatedAt, &t.UpdatedAt); err != nil {
			return nil, err
		}
		if err := json.Unmarshal(varsJSON, &t.Variables); err != nil {
			t.Variables = []string{}
		}
		results = append(results, &t)
	}
	return results, nil
}

func (r *TemplateRepository) Get(ctx context.Context, id, chapterID string) (*MailTemplate, error) {
	var t MailTemplate
	var varsJSON []byte
	err := r.db.WithContext(ctx).Raw(
		`SELECT id, chapter_id, name, subject, body, variables, status, created_by, created_at, updated_at
		 FROM mail_templates WHERE id = ? AND chapter_id = ?`, id, chapterID,
	).Row().Scan(&t.ID, &t.ChapterID, &t.Name, &t.Subject, &t.Body, &varsJSON,
		&t.Status, &t.CreatedBy, &t.CreatedAt, &t.UpdatedAt)
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, apperrors.NotFound("mail template not found")
		}
		return nil, err
	}
	if err := json.Unmarshal(varsJSON, &t.Variables); err != nil {
		t.Variables = []string{}
	}
	return &t, nil
}

// GetAny retrieves a mail template by ID regardless of chapter ownership.
func (r *TemplateRepository) GetAny(ctx context.Context, id string) (*MailTemplate, error) {
	var t MailTemplate
	var varsJSON []byte
	err := r.db.WithContext(ctx).Raw(
		`SELECT id, chapter_id, name, subject, body, variables, status, created_by, created_at, updated_at
		 FROM mail_templates WHERE id = ?`, id,
	).Row().Scan(&t.ID, &t.ChapterID, &t.Name, &t.Subject, &t.Body, &varsJSON,
		&t.Status, &t.CreatedBy, &t.CreatedAt, &t.UpdatedAt)
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, apperrors.NotFound("mail template not found")
		}
		return nil, err
	}
	if err := json.Unmarshal(varsJSON, &t.Variables); err != nil {
		t.Variables = []string{}
	}
	return &t, nil
}

func (r *TemplateRepository) Create(ctx context.Context, t *MailTemplate) error {
	varsJSON, err := json.Marshal(t.Variables)
	if err != nil {
		return fmt.Errorf("marshal variables: %w", err)
	}
	return r.db.WithContext(ctx).Exec(
		`INSERT INTO mail_templates (id, chapter_id, name, subject, body, variables, created_by, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
		t.ID, t.ChapterID, t.Name, t.Subject, t.Body, varsJSON, t.CreatedBy,
	).Error
}

func (r *TemplateRepository) Update(ctx context.Context, t *MailTemplate) error {
	varsJSON, err := json.Marshal(t.Variables)
	if err != nil {
		return fmt.Errorf("marshal variables: %w", err)
	}
	result := r.db.WithContext(ctx).Exec(
		`UPDATE mail_templates SET name=?, subject=?, body=?, variables=?, updated_at=NOW()
		 WHERE id=? AND chapter_id=?`,
		t.Name, t.Subject, t.Body, varsJSON, t.ID, t.ChapterID,
	)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return apperrors.NotFound("mail template not found")
	}
	return nil
}

func (r *TemplateRepository) Delete(ctx context.Context, id, chapterID string) error {
	result := r.db.WithContext(ctx).Exec(
		`DELETE FROM mail_templates WHERE id=? AND chapter_id=?`, id, chapterID,
	)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return apperrors.NotFound("mail template not found")
	}
	return nil
}

func (r *TemplateRepository) Publish(ctx context.Context, id, chapterID string) error {
	result := r.db.WithContext(ctx).Exec(
		`UPDATE mail_templates SET status='published', updated_at=NOW() WHERE id=? AND chapter_id=?`,
		id, chapterID,
	)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return apperrors.NotFound("mail template not found")
	}
	return nil
}

func (r *TemplateRepository) Unpublish(ctx context.Context, id, chapterID string) error {
	result := r.db.WithContext(ctx).Exec(
		`UPDATE mail_templates SET status='draft', updated_at=NOW() WHERE id=? AND chapter_id=?`,
		id, chapterID,
	)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return apperrors.NotFound("mail template not found")
	}
	return nil
}

// TemplateService wraps business logic for mail templates.
type TemplateService struct {
	repo *TemplateRepository
}

func NewTemplateService(repo *TemplateRepository) *TemplateService {
	return &TemplateService{repo: repo}
}

type CreateTemplateInput struct {
	Name      string   `json:"name"`
	Subject   string   `json:"subject"`
	Body      string   `json:"body"`
	Variables []string `json:"variables"`
}

type UpdateTemplateInput struct {
	Name      string   `json:"name"`
	Subject   string   `json:"subject"`
	Body      string   `json:"body"`
	Variables []string `json:"variables"`
}

func (s *TemplateService) List(ctx context.Context, chapterID string) ([]*MailTemplate, error) {
	return s.repo.ListByChapterOrPublished(ctx, chapterID)
}

func (s *TemplateService) ListAll(ctx context.Context) ([]*MailTemplate, error) {
	return s.repo.ListAll(ctx)
}

func (s *TemplateService) Get(ctx context.Context, id, chapterID string) (*MailTemplate, error) {
	return s.repo.Get(ctx, id, chapterID)
}

func (s *TemplateService) Create(ctx context.Context, in CreateTemplateInput, chapterID, userID string) (*MailTemplate, error) {
	if in.Name == "" || in.Subject == "" || in.Body == "" {
		return nil, apperrors.BadRequest("name, subject and body are required")
	}
	if in.Variables == nil {
		in.Variables = []string{}
	}
	t := &MailTemplate{
		ID:        uuid.New().String(),
		ChapterID: chapterID,
		Name:      in.Name,
		Subject:   in.Subject,
		Body:      in.Body,
		Variables: in.Variables,
		CreatedBy: userID,
	}
	if err := s.repo.Create(ctx, t); err != nil {
		return nil, err
	}
	return s.repo.Get(ctx, t.ID, chapterID)
}

func (s *TemplateService) Update(ctx context.Context, id string, in UpdateTemplateInput, chapterID string) (*MailTemplate, error) {
	if in.Name == "" || in.Subject == "" || in.Body == "" {
		return nil, apperrors.BadRequest("name, subject and body are required")
	}
	if in.Variables == nil {
		in.Variables = []string{}
	}
	t := &MailTemplate{
		ID:        id,
		ChapterID: chapterID,
		Name:      in.Name,
		Subject:   in.Subject,
		Body:      in.Body,
		Variables: in.Variables,
	}
	if err := s.repo.Update(ctx, t); err != nil {
		return nil, err
	}
	return s.repo.Get(ctx, id, chapterID)
}

func (s *TemplateService) Delete(ctx context.Context, id, chapterID string) error {
	return s.repo.Delete(ctx, id, chapterID)
}

func (s *TemplateService) Publish(ctx context.Context, id, chapterID string) (*MailTemplate, error) {
	if err := s.repo.Publish(ctx, id, chapterID); err != nil {
		return nil, err
	}
	return s.repo.Get(ctx, id, chapterID)
}

func (s *TemplateService) Unpublish(ctx context.Context, id, chapterID string) (*MailTemplate, error) {
	if err := s.repo.Unpublish(ctx, id, chapterID); err != nil {
		return nil, err
	}
	return s.repo.Get(ctx, id, chapterID)
}

// Clone copies a mail template (from any chapter) into the caller's chapter as a new draft.
func (s *TemplateService) Clone(ctx context.Context, srcID, toChapterID, byUserID string) (*MailTemplate, error) {
	src, err := s.repo.GetAny(ctx, srcID)
	if err != nil {
		return nil, err
	}
	clone := &MailTemplate{
		ID:        uuid.New().String(),
		ChapterID: toChapterID,
		Name:      src.Name + " (Clone)",
		Subject:   src.Subject,
		Body:      src.Body,
		Variables: src.Variables,
		CreatedBy: byUserID,
	}
	if err := s.repo.Create(ctx, clone); err != nil {
		return nil, err
	}
	return s.repo.Get(ctx, clone.ID, toChapterID)
}
