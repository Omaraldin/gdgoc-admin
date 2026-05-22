package auth

import (
	"context"
	"fmt"
	"strings"

	"github.com/gdgoc/admin-api/internal/database"
	"gorm.io/gorm"
)

type UserRecord struct {
	ID        string
	Email     string
	Name      string
	Role      string
	ChapterID string
}

type Repository struct {
	db *gorm.DB
}

func NewRepository(db *database.DB) *Repository {
	return &Repository{db: db.Gorm}
}

func (r *Repository) IsWhitelisted(ctx context.Context, email string) (bool, error) {
	var count int64
	email = strings.ToLower(strings.TrimSpace(email))
	err := r.db.WithContext(ctx).Raw(
		`SELECT COUNT(*) FROM whitelist WHERE LOWER(email) = ? AND deleted_at IS NULL`, email,
	).Scan(&count).Error
	return count > 0, err
}

func (r *Repository) UpsertUser(ctx context.Context, identity *KayanIdentity) (*UserRecord, error) {
	var u UserRecord
	email := strings.ToLower(strings.TrimSpace(identity.Email))

	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Raw(`
			INSERT INTO users (kayan_id, email, name, role, chapter_id, created_at, updated_at)
			VALUES (?, ?, ?,
				COALESCE((SELECT role FROM whitelist WHERE LOWER(email) = ? AND deleted_at IS NULL LIMIT 1), 'chapter_leader'),
				(SELECT chapter_id FROM whitelist WHERE LOWER(email) = ? AND deleted_at IS NULL LIMIT 1),
				NOW(), NOW())
			ON CONFLICT (kayan_id) DO UPDATE
				SET email = EXCLUDED.email, name = EXCLUDED.name, updated_at = NOW()
			RETURNING id, email, name, role, COALESCE(chapter_id::text, '')
		`, identity.KayanID, email, identity.Name, email, email,
		).Scan(&u).Error; err != nil {
			return err
		}

		if u.Role == "chapter_leader" && u.ChapterID != "" {
			if err := tx.Exec(`
				UPDATE chapters 
				SET leader_id = ?::uuid, updated_at = NOW() 
				WHERE id = ?::uuid AND leader_id IS NULL
			`, u.ID, u.ChapterID).Error; err != nil {
				return err
			}
		}
		return nil
	})

	return &u, err
}

// BootstrapSuperAdmin whitelists the given email (if not already) and promotes
// the user to super_admin (if they already exist). Safe to call on every startup.
func (r *Repository) BootstrapSuperAdmin(ctx context.Context, email string) error {
	err := r.db.WithContext(ctx).Exec(`
		INSERT INTO whitelist (email, role, added_by, created_at)
		VALUES (?, 'super_admin', NULL, NOW())
		ON CONFLICT (email) DO UPDATE SET role = 'super_admin', deleted_at = NULL
	`, email).Error
	if err != nil {
		return fmt.Errorf("bootstrap whitelist: %w", err)
	}
	return r.db.WithContext(ctx).Exec(`
		UPDATE users SET role = ?, updated_at = NOW()
		WHERE email = ? AND role != ?
	`, RoleSuperAdmin, email, RoleSuperAdmin).Error
}

func (r *Repository) GetUserByKayanID(ctx context.Context, kayanID string) (*UserRecord, error) {
	var u UserRecord
	err := r.db.WithContext(ctx).Raw(`
		SELECT id, email, name, role, COALESCE(chapter_id::text, '')
		FROM users WHERE kayan_id = ? AND deleted_at IS NULL
	`, kayanID).Scan(&u).Error
	if err != nil || u.ID == "" {
		return nil, fmt.Errorf("user not found")
	}
	return &u, nil
}

func (r *Repository) GetUserByID(ctx context.Context, id string) (*UserRecord, error) {
	var u UserRecord
	err := r.db.WithContext(ctx).Raw(`
		SELECT id, email, name, role, COALESCE(chapter_id::text, '') AS chapter_id
		FROM users WHERE id = ? AND deleted_at IS NULL
	`, id).Scan(&u).Error
	if err != nil || u.ID == "" {
		return nil, fmt.Errorf("user not found")
	}
	return &u, nil
}

func (r *Repository) GetUserByEmail(ctx context.Context, email string) (*UserRecord, error) {
	var u UserRecord
	err := r.db.WithContext(ctx).Raw(`
		SELECT id, email, name, role, COALESCE(chapter_id::text, '')
		FROM users WHERE email = ? AND deleted_at IS NULL
	`, email).Scan(&u).Error
	if err != nil || u.ID == "" {
		return nil, fmt.Errorf("user not found")
	}
	return &u, nil
}

func (r *Repository) AddToWhitelist(ctx context.Context, email, addedByUserID string) error {
	email = strings.ToLower(strings.TrimSpace(email))
	return r.db.WithContext(ctx).Exec(`
		INSERT INTO whitelist (email, added_by, created_at)
		VALUES (?, ?, NOW())
		ON CONFLICT (email) DO NOTHING
	`, email, addedByUserID).Error
}

func (r *Repository) RemoveFromWhitelist(ctx context.Context, id string) error {
	result := r.db.WithContext(ctx).Exec(
		`UPDATE whitelist SET deleted_at = NOW() WHERE id = ? AND deleted_at IS NULL`, id)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return fmt.Errorf("whitelist entry not found")
	}
	return nil
}
