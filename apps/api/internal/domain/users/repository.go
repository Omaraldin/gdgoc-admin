package users

import (
	"context"
	"strings"
	"time"

	"github.com/gdgoc/admin-api/internal/apperrors"
	"github.com/gdgoc/admin-api/internal/database"
	"gorm.io/gorm"
)

type User struct {
	ID        string    `json:"id"`
	Email     string    `json:"email"`
	Name      string    `json:"name"`
	Role      string    `json:"role"`
	ChapterID *string   `json:"chapter_id,omitempty"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

type WhitelistEntry struct {
	ID        string    `json:"id"`
	Email     string    `json:"email"`
	Role      string    `json:"role"`
	ChapterID *string   `json:"chapter_id,omitempty"`
	AddedBy   string    `json:"added_by"`
	CreatedAt time.Time `json:"created_at"`
}

type Repository struct {
	db *gorm.DB
}

func NewRepository(db *database.DB) *Repository {
	return &Repository{db: db.Gorm}
}

func (r *Repository) List(ctx context.Context, chapterID *string) ([]*User, error) {
	users := make([]*User, 0)
	query := `SELECT id, email, name, role, chapter_id, created_at, updated_at FROM users WHERE deleted_at IS NULL`
	args := []interface{}{}
	if chapterID != nil {
		query += ` AND chapter_id = ?::uuid`
		args = append(args, *chapterID)
	}
	query += ` ORDER BY created_at DESC`
	err := r.db.WithContext(ctx).Raw(query, args...).Scan(&users).Error
	return users, err
}

func (r *Repository) GetByID(ctx context.Context, id string) (*User, error) {
	var u User
	err := r.db.WithContext(ctx).Raw(`
		SELECT id, email, name, role, chapter_id, created_at, updated_at
		FROM users WHERE id = ? AND deleted_at IS NULL`, id,
	).Scan(&u).Error
	if err != nil || u.ID == "" {
		return nil, apperrors.NotFound("user not found")
	}
	return &u, nil
}

type UpdateUserInput struct {
	Name      *string `json:"name"`
	Role      *string `json:"role"`
	ChapterID *string `json:"chapter_id"`
}

func (r *Repository) Update(ctx context.Context, id string, input UpdateUserInput) (*User, error) {
	// Build SET clause dynamically so we can distinguish "not provided" (nil)
	// from "explicitly cleared" (pointer to empty string) for chapter_id.
	setClauses := []string{"updated_at = NOW()"}
	args := []interface{}{}

	if input.Name != nil {
		setClauses = append(setClauses, "name = ?")
		args = append(args, *input.Name)
	}
	if input.Role != nil {
		setClauses = append(setClauses, "role = ?")
		args = append(args, *input.Role)
	}
	if input.ChapterID != nil {
		if *input.ChapterID == "" {
			setClauses = append(setClauses, "chapter_id = NULL")
		} else {
			setClauses = append(setClauses, "chapter_id = ?::uuid")
			args = append(args, *input.ChapterID)
		}
	}

	args = append(args, id)
	query := "UPDATE users SET " + strings.Join(setClauses, ", ") + " WHERE id = ? AND deleted_at IS NULL"
	if err := r.db.WithContext(ctx).Exec(query, args...).Error; err != nil {
		return nil, err
	}
	return r.GetByID(ctx, id)
}

func (r *Repository) Delete(ctx context.Context, id string) error {
	result := r.db.WithContext(ctx).Exec(
		`UPDATE users SET deleted_at = NOW() WHERE id = ? AND deleted_at IS NULL`, id)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return apperrors.NotFound("user not found")
	}
	return nil
}

func (r *Repository) ListWhitelist(ctx context.Context, chapterID *string) ([]*WhitelistEntry, error) {
	entries := make([]*WhitelistEntry, 0)
	query := `SELECT id, email, role, chapter_id, added_by, created_at FROM whitelist WHERE deleted_at IS NULL`
	args := []interface{}{}
	if chapterID != nil {
		query += ` AND chapter_id = ?::uuid`
		args = append(args, *chapterID)
	}
	query += ` ORDER BY created_at DESC`
	err := r.db.WithContext(ctx).Raw(query, args...).Scan(&entries).Error
	return entries, err
}

func (r *Repository) AddToWhitelist(ctx context.Context, email, role, addedBy string, chapterID *string) (*WhitelistEntry, error) {
	email = strings.ToLower(strings.TrimSpace(email))
	var chapterArg interface{}
	if chapterID != nil {
		chapterArg = *chapterID
	}
	var entry WhitelistEntry
	err := r.db.WithContext(ctx).Raw(`
		INSERT INTO whitelist (email, role, added_by, chapter_id)
		VALUES (?, ?, ?::uuid, ?::uuid)
		ON CONFLICT (email) DO UPDATE SET deleted_at = NULL, added_by = EXCLUDED.added_by, role = EXCLUDED.role, chapter_id = EXCLUDED.chapter_id
		RETURNING id, email, role, chapter_id, added_by, created_at`,
		email, role, addedBy, chapterArg,
	).Scan(&entry).Error
	if err != nil {
		return nil, err
	}
	return &entry, nil
}

func (r *Repository) RemoveFromWhitelist(ctx context.Context, id string, callerChapterID *string) error {
	query := `UPDATE whitelist SET deleted_at = NOW() WHERE id = ?::uuid AND deleted_at IS NULL`
	args := []interface{}{id}
	if callerChapterID != nil {
		query += ` AND chapter_id = ?::uuid`
		args = append(args, *callerChapterID)
	}
	result := r.db.WithContext(ctx).Exec(query, args...)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return apperrors.NotFound("whitelist entry not found or access denied")
	}
	return nil
}
