package chapters

import (
	"context"
	"fmt"
	"time"

	"github.com/gdgoc/admin-api/internal/apperrors"
	"github.com/gdgoc/admin-api/internal/database"
	"github.com/gdgoc/admin-api/internal/domain/auth"
	"github.com/gdgoc/admin-api/internal/domain/mail"
	"gorm.io/gorm"
)

type Chapter struct {
	ID                string    `json:"id"`
	Name              string    `json:"name"`
	Code              string    `json:"code"`
	SinceYear         *int      `json:"since_year,omitempty"`
	LeaderCodename    string    `json:"leader_codename"`
	LeaderName        string    `json:"leader_name,omitempty"`
	Email             string    `json:"email"`
	SmtpProvider      string    `json:"smtp_provider"`
	SmtpHost          *string   `json:"smtp_host,omitempty"`
	SmtpPort          *int      `json:"smtp_port,omitempty"`
	SmtpUsername      *string   `json:"smtp_username,omitempty"`
	SmtpPassword      *string   `json:"smtp_password,omitempty"`
	LeaderID          *string   `json:"leader_id,omitempty"`
	Status            string    `json:"status"`
	ProfilePictureURL *string   `json:"profile_picture_url,omitempty"`
	CreatedAt         time.Time `json:"created_at"`
	UpdatedAt         time.Time `json:"updated_at"`
}

// ManualSMTPInput carries the settings needed to configure manual (PlainAuth) SMTP.
type ManualSMTPInput struct {
	Host     string `json:"host"`
	Port     int    `json:"port"`
	Username string `json:"username"`
	Password string `json:"password"`
	// Email is the From: address. Defaults to Username when empty.
	Email string `json:"email"`
}

type CreateChapterInput struct {
	Name           string  `json:"name"`
	Email          string  `json:"email"`
	Code           string  `json:"code"`
	SinceYear      *int    `json:"since_year"`
	LeaderCodename string  `json:"leader_codename"`
	SmtpPassword   *string `json:"smtp_password"`
}

type UpdateChapterInput struct {
	Name           *string `json:"name"`
	Code           *string `json:"code"`
	SinceYear      *int    `json:"since_year"`
	LeaderCodename *string `json:"leader_codename"`
	Email          *string `json:"email"`
	Status         *string `json:"status"`
	SmtpPassword   *string `json:"smtp_password"`
}

type Repository struct {
	db *gorm.DB
}

func NewRepository(db *database.DB) *Repository {
	return &Repository{db: db.Gorm}
}

func (r *Repository) List(ctx context.Context) ([]*Chapter, error) {
	chapters := make([]*Chapter, 0)
	err := r.db.WithContext(ctx).Raw(`
		SELECT id, name, code, since_year, leader_codename, email, smtp_provider, smtp_host, smtp_port, smtp_username, smtp_password,
		       leader_id, status, profile_picture_url, created_at, updated_at
		FROM chapters WHERE deleted_at IS NULL ORDER BY name ASC`,
	).Scan(&chapters).Error
	return chapters, err
}

func (r *Repository) GetByID(ctx context.Context, id string) (*Chapter, error) {
	var ch Chapter
	err := r.db.WithContext(ctx).Raw(`
		SELECT c.id, c.name, c.code, c.since_year, c.leader_codename, c.email, c.smtp_provider, c.smtp_host, c.smtp_port, c.smtp_username, c.smtp_password,
		       c.leader_id, c.status, c.profile_picture_url, c.created_at, c.updated_at,
		       COALESCE(u.name, '') AS leader_name
		FROM chapters c
		LEFT JOIN users u ON u.id = c.leader_id AND u.deleted_at IS NULL
		WHERE c.id = ? AND c.deleted_at IS NULL`, id,
	).Scan(&ch).Error
	if err != nil || ch.ID == "" {
		return nil, apperrors.NotFound("chapter not found")
	}
	return &ch, nil
}

// GetLeaderName returns the full name of the chapter's leader user.
// Returns an empty string if leader_id is null or the user is not found.
func (r *Repository) GetLeaderName(ctx context.Context, leaderID string) string {
	if leaderID == "" {
		return ""
	}
	var name string
	r.db.WithContext(ctx).Raw(`SELECT name FROM users WHERE id = ? AND deleted_at IS NULL`, leaderID).Scan(&name)
	return name
}

func (r *Repository) Create(ctx context.Context, input CreateChapterInput) (*Chapter, error) {
	var ch Chapter
	err := r.db.WithContext(ctx).Raw(`
		INSERT INTO chapters (name, email, code, since_year, leader_codename, smtp_password, status, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, 'active', NOW(), NOW())
		RETURNING id, name, code, since_year, leader_codename, email, smtp_provider, smtp_host, smtp_port, smtp_username, smtp_password,
		          leader_id, status, profile_picture_url, created_at, updated_at
	`, input.Name, input.Email, input.Code, input.SinceYear, input.LeaderCodename, input.SmtpPassword,
	).Scan(&ch).Error
	if err != nil {
		return nil, err
	}
	return &ch, nil
}

func (r *Repository) Update(ctx context.Context, id string, input UpdateChapterInput) (*Chapter, error) {
	err := r.db.WithContext(ctx).Exec(`
		UPDATE chapters SET
			name          = COALESCE(?, name),
			code          = COALESCE(?, code),
			since_year    = COALESCE(?, since_year),
			leader_codename = COALESCE(?, leader_codename),
			email         = COALESCE(?, email),
			status        = COALESCE(?, status),
			smtp_password = COALESCE(?, smtp_password),
			updated_at    = NOW()
		WHERE id = ? AND deleted_at IS NULL
	`, input.Name, input.Code, input.SinceYear, input.LeaderCodename, input.Email, input.Status, input.SmtpPassword, id).Error
	if err != nil {
		return nil, err
	}
	return r.GetByID(ctx, id)
}

// GetSMTPConfig returns the email-sending configuration for a chapter.
func (r *Repository) GetSMTPConfig(ctx context.Context, chapterID string) (*mail.SMTPConfig, error) {
	var row struct {
		Name              string  `gorm:"column:name"`
		Email             string  `gorm:"column:email"`
		SmtpProvider      string  `gorm:"column:smtp_provider"`
		SmtpHost          *string `gorm:"column:smtp_host"`
		SmtpPort          *int    `gorm:"column:smtp_port"`
		SmtpUsername      *string `gorm:"column:smtp_username"`
		SmtpPassword      *string `gorm:"column:smtp_password"`
		OAuthRefreshToken *string `gorm:"column:oauth_refresh_token"`
	}
	err := r.db.WithContext(ctx).Raw(`
		SELECT name, email, smtp_provider, smtp_host, smtp_port, smtp_username, smtp_password, oauth_refresh_token
		FROM chapters WHERE id = ? AND deleted_at IS NULL`, chapterID,
	).Scan(&row).Error
	if err != nil || row.Email == "" {
		return nil, fmt.Errorf("chapter not found")
	}

	provider := row.SmtpProvider
	if provider == "" {
		provider = "manual"
	}

	cfg := &mail.SMTPConfig{
		Provider:    provider,
		FromEmail:   ptrStringOr(row.SmtpUsername, row.Email),
		ChapterName: row.Name,
	}

	switch provider {
	case "gmail", "outlook":
		if row.OAuthRefreshToken == nil || *row.OAuthRefreshToken == "" {
			return nil, fmt.Errorf("chapter %s has no OAuth refresh token; connect via OAuth first", chapterID)
		}
		cfg.RefreshToken = *row.OAuthRefreshToken
	case "manual":
		if row.SmtpHost == nil || *row.SmtpHost == "" {
			return nil, fmt.Errorf("chapter %s has no manual SMTP configured", chapterID)
		}
		cfg.Host = *row.SmtpHost
		cfg.Port = intPtrOr(row.SmtpPort, 587)
		cfg.Username = ptrStringOr(row.SmtpUsername, row.Email)
		if row.SmtpPassword == nil || *row.SmtpPassword == "" {
			return nil, fmt.Errorf("chapter %s has no smtp_password configured", chapterID)
		}
		cfg.Password = *row.SmtpPassword
	default:
		return nil, fmt.Errorf("chapter %s has unknown smtp_provider %q", chapterID, provider)
	}

	return cfg, nil
}

// SaveOAuthConnection stores the provider, authorized email, and refresh token
// for a chapter after a successful OAuth2 consent flow.
func (r *Repository) SaveOAuthConnection(ctx context.Context, chapterID, provider, fromEmail, refreshToken string) error {
	return r.db.WithContext(ctx).Exec(`
		UPDATE chapters
		SET smtp_provider       = ?,
		    smtp_username       = ?,
		    oauth_refresh_token = ?,
		    updated_at          = NOW()
		WHERE id = ? AND deleted_at IS NULL
	`, provider, fromEmail, refreshToken, chapterID).Error
}

// UpdateManualSMTP sets the manual SMTP configuration for a chapter and clears
// any previously stored OAuth refresh token.
func (r *Repository) UpdateManualSMTP(ctx context.Context, chapterID string, input ManualSMTPInput) error {
	fromEmail := input.Email
	if fromEmail == "" {
		fromEmail = input.Username
	}
	return r.db.WithContext(ctx).Exec(`
		UPDATE chapters
		SET smtp_provider       = 'manual',
		    smtp_host           = ?,
		    smtp_port           = ?,
		    smtp_username       = ?,
		    smtp_password       = ?,
		    oauth_refresh_token = NULL,
		    updated_at          = NOW()
		WHERE id = ? AND deleted_at IS NULL
	`, input.Host, input.Port, fromEmail, input.Password, chapterID).Error
}

// DisconnectSMTP clears all SMTP credentials for a chapter.
func (r *Repository) DisconnectSMTP(ctx context.Context, chapterID string) error {
	return r.db.WithContext(ctx).Exec(`
		UPDATE chapters
		SET smtp_provider       = 'manual',
		    smtp_host           = NULL,
		    smtp_port           = NULL,
		    smtp_username       = NULL,
		    smtp_password       = NULL,
		    oauth_refresh_token = NULL,
		    updated_at          = NOW()
		WHERE id = ? AND deleted_at IS NULL
	`, chapterID).Error
}

func (r *Repository) AssignLeader(ctx context.Context, chapterID, userID string) error {
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Exec(
			`UPDATE chapters SET leader_id = ?, updated_at = NOW() WHERE id = ?`, userID, chapterID,
		).Error; err != nil {
			return err
		}
		return tx.Exec(
			`UPDATE users SET chapter_id = ?, role = CASE WHEN role = ? THEN ? ELSE ? END, updated_at = NOW() WHERE id = ?`,
			chapterID, auth.RoleSuperAdmin, auth.RoleSuperAdmin, auth.RoleChapterLeader, userID,
		).Error
	})
}

func (r *Repository) UpdateProfilePicture(ctx context.Context, id, url string) (*Chapter, error) {
	err := r.db.WithContext(ctx).Exec(
		`UPDATE chapters SET profile_picture_url = ?, updated_at = NOW() WHERE id = ? AND deleted_at IS NULL`, url, id,
	).Error
	if err != nil {
		return nil, err
	}
	return r.GetByID(ctx, id)
}

func (r *Repository) Delete(ctx context.Context, id string) error {
	result := r.db.WithContext(ctx).Exec(
		`UPDATE chapters SET deleted_at = NOW() WHERE id = ? AND deleted_at IS NULL`, id)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return apperrors.NotFound("chapter not found")
	}
	return nil
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

func ptrStringOr(s *string, fallback string) string {
	if s != nil && *s != "" {
		return *s
	}
	return fallback
}

func intPtrOr(n *int, fallback int) int {
	if n != nil {
		return *n
	}
	return fallback
}
