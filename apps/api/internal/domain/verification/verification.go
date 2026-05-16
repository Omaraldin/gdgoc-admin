package verification

import (
	"context"
	"time"

	"github.com/gdgoc/admin-api/internal/apperrors"
	"github.com/gdgoc/admin-api/internal/database"
	"github.com/gofiber/fiber/v2"
	"gorm.io/gorm"
)

type VerificationResult struct {
	Valid          bool      `json:"valid"`
	Code           string    `json:"code"`
	RecipientEmail string    `json:"recipient_email,omitempty"`
	RecipientName  string    `json:"recipient_name,omitempty"`
	TemplateName   string    `json:"template_name,omitempty"`
	ChapterName    string    `json:"chapter_name,omitempty"`
	IssuedAt       time.Time `json:"issued_at,omitempty"`
	Status         string    `json:"status"`
}

type Repository struct {
	db *gorm.DB
}

func NewRepository(db *database.DB) *Repository {
	return &Repository{db: db.Gorm}
}

func (r *Repository) VerifyByCode(ctx context.Context, code string) (*VerificationResult, error) {
	result := &VerificationResult{Code: code}

	err := r.db.WithContext(ctx).Raw(`
		SELECT
			rec.status,
			rec.email,
			COALESCE(rec.variables->>'recipient_name', ''),
			t.name,
			c.name,
			rec.created_at
		FROM issuance_recipients rec
		JOIN issuance_batches b    ON b.id = rec.batch_id
		JOIN templates t           ON t.id = b.template_id
		JOIN chapters c            ON c.id = b.chapter_id
		WHERE rec.id = ?
	`, code).Row().Scan(
		&result.Status,
		&result.RecipientEmail,
		&result.RecipientName,
		&result.TemplateName,
		&result.ChapterName,
		&result.IssuedAt,
	)
	if err != nil {
		return &VerificationResult{Valid: false, Code: code, Status: "not_found"}, nil
	}

	result.Valid = result.Status == "emailed" || result.Status == "rendered"
	if result.Status == "revoked" {
		result.Valid = false
	}

	return result, nil
}

type Service struct {
	repo *Repository
}

func NewService(repo *Repository) *Service {
	return &Service{repo: repo}
}

func (s *Service) Verify(ctx context.Context, code string) (*VerificationResult, error) {
	if code == "" {
		return nil, apperrors.BadRequest("verification code is required")
	}
	return s.repo.VerifyByCode(ctx, code)
}

type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler {
	return &Handler{svc: svc}
}

func (h *Handler) VerifyCertificate(c *fiber.Ctx) error {
	result, err := h.svc.Verify(c.Context(), c.Params("code"))
	if err != nil {
		return err
	}
	return c.JSON(result)
}
