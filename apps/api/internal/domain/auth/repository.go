package auth

import (
	"context"
	"fmt"

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
	err := r.db.WithContext(ctx).Raw(
		`SELECT COUNT(*) FROM whitelist WHERE email = ? AND deleted_at IS NULL`, email,
	).Scan(&count).Error
	return count > 0, err
}

func (r *Repository) UpsertUser(ctx context.Context, identity *KayanIdentity) (*UserRecord, error) {
	var u UserRecord
	err := r.db.WithContext(ctx).Raw(`
		INSERT INTO users (kayan_id, email, name, role, created_at, updated_at)
		VALUES (?, ?, ?,
			CASE WHEN EXISTS(SELECT 1 FROM whitelist WHERE email = ? AND added_by IS NULL)
			     THEN ? ELSE ? END,
			NOW(), NOW())
		ON CONFLICT (kayan_id) DO UPDATE
			SET email = EXCLUDED.email, name = EXCLUDED.name, updated_at = NOW()
		RETURNING id, email, name, role, COALESCE(chapter_id::text, '')
	`, identity.KayanID, identity.Email, identity.Name, identity.Email, RoleSuperAdmin, RoleChapterLeader,
	).Scan(&u).Error
	return &u, err
}

// BootstrapSuperAdmin whitelists the given email (if not already) and promotes
// the user to super_admin (if they already exist). Safe to call on every startup.
func (r *Repository) BootstrapSuperAdmin(ctx context.Context, email string) error {
	err := r.db.WithContext(ctx).Exec(`
		INSERT INTO whitelist (email, added_by, created_at)
		VALUES (?, NULL, NOW())
		ON CONFLICT (email) DO NOTHING
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
