package verification

import (
	"context"
	"fmt"
	"html"
	"net/url"
	"strings"
	"time"

	"github.com/gdgoc/admin-api/internal/apperrors"
	"github.com/gdgoc/admin-api/internal/database"
	"github.com/gofiber/fiber/v2"
	"gorm.io/gorm"
)

type VerificationResult struct {
	Valid           bool      `json:"valid"`
	Code            string    `json:"code"`
	RecipientEmail  string    `json:"recipient_email,omitempty"`
	RecipientName   string    `json:"recipient_name,omitempty"`
	TemplateName    string    `json:"template_name,omitempty"`
	BatchName       string    `json:"batch_name,omitempty"`
	CertName        string    `json:"cert_name,omitempty"`
	ChapterName     string    `json:"chapter_name,omitempty"`
	IssuedAt        time.Time `json:"issued_at,omitempty"`
	Status          string    `json:"status"`
	PreviewImageURL string    `json:"preview_image_url,omitempty"`
	VerifyURL       string    `json:"verify_url,omitempty"`
	ShareURL        string    `json:"share_url,omitempty"`
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
			b.name,
			b.cert_name,
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
		&result.BatchName,
		&result.CertName,
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
	repo      *Repository
	publicURL string
}

func NewService(repo *Repository, publicURL string) *Service {
	return &Service{repo: repo, publicURL: strings.TrimSuffix(publicURL, "/")}
}

func (s *Service) Verify(ctx context.Context, code string) (*VerificationResult, error) {
	if code == "" {
		return nil, apperrors.BadRequest("verification code is required")
	}
	result, err := s.repo.VerifyByCode(ctx, code)
	if err != nil {
		return nil, err
	}

	result.VerifyURL = s.verifyURL(code)
	result.ShareURL = s.shareURL(code)
	if result.Valid {
		result.PreviewImageURL = s.previewImageURL(code)
	}

	return result, nil
}

func (s *Service) previewImageURL(code string) string {
	return fmt.Sprintf("%s/api/v1/certificates/%s/render?format=png", s.publicURL, url.PathEscape(code))
}

func (s *Service) verifyURL(code string) string {
	return fmt.Sprintf("%s/verify/%s", s.publicURL, url.PathEscape(code))
}

func (s *Service) shareURL(code string) string {
	return fmt.Sprintf("%s/api/v1/verify/%s/share", s.publicURL, url.PathEscape(code))
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

func (h *Handler) VerifySharePage(c *fiber.Ctx) error {
	result, err := h.svc.Verify(c.Context(), c.Params("code"))
	if err != nil {
		return err
	}

	title := "Certificate Verification"
	description := "Verify this certificate issued by GDGoC."
	if result.Valid {
		name := result.RecipientName
		if name == "" {
			name = result.RecipientEmail
		}
		certName := result.CertName
		if certName == "" {
			certName = result.BatchName
		}
		if certName == "" {
			certName = result.TemplateName
		}
		if certName == "" {
			certName = "Certificate"
		}
		if name != "" {
			title = fmt.Sprintf("%s earned %s", name, certName)
			description = fmt.Sprintf("Verified achievement issued by %s.", result.ChapterName)
		} else {
			title = fmt.Sprintf("Verified %s", certName)
			description = "View this verified certificate achievement."
		}
	} else if result.Status == "revoked" {
		title = "Certificate Revoked"
		description = "This certificate has been revoked and is no longer valid."
	} else {
		title = "Certificate Not Found"
		description = "This certificate could not be verified."
	}

	imageURL := result.PreviewImageURL
	if imageURL == "" {
		imageURL = fmt.Sprintf("%s/logo.svg", h.svc.publicURL)
	}

	verifyURL := result.VerifyURL
	if verifyURL == "" {
		verifyURL = h.svc.verifyURL(result.Code)
	}
	shareURL := result.ShareURL
	if shareURL == "" {
		shareURL = h.svc.shareURL(result.Code)
	}

	doc := fmt.Sprintf(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>%s</title>
  <meta name="description" content="%s" />
  <meta property="og:type" content="website" />
  <meta property="og:title" content="%s" />
  <meta property="og:description" content="%s" />
  <meta property="og:url" content="%s" />
  <meta property="og:image" content="%s" />
  <meta property="og:image:alt" content="Certificate preview" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="%s" />
  <meta name="twitter:description" content="%s" />
  <meta name="twitter:image" content="%s" />
  <meta http-equiv="refresh" content="0;url=%s" />
  <script>window.location.replace(%q);</script>
</head>
<body>
  <p>Redirecting to verification page...</p>
  <p><a href="%s">Open certificate verification</a></p>
</body>
</html>`,
		html.EscapeString(title),
		html.EscapeString(description),
		html.EscapeString(title),
		html.EscapeString(description),
		html.EscapeString(shareURL),
		html.EscapeString(imageURL),
		html.EscapeString(title),
		html.EscapeString(description),
		html.EscapeString(imageURL),
		html.EscapeString(verifyURL),
		verifyURL,
		html.EscapeString(verifyURL),
	)

	c.Set("Content-Type", "text/html; charset=utf-8")
	c.Set("Cache-Control", "public, max-age=300")
	return c.SendString(doc)
}
