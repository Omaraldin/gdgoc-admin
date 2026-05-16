package issuance

import (
	"github.com/gdgoc/admin-api/internal/apperrors"
	"github.com/gdgoc/admin-api/internal/domain/auth"
	"github.com/gdgoc/admin-api/internal/middleware"
	"github.com/gofiber/fiber/v2"
)

type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler {
	return &Handler{svc: svc}
}

func caller(c *fiber.Ctx) *auth.SessionUser {
	return c.Locals(middleware.ContextKeyUser).(*auth.SessionUser)
}

func (h *Handler) ListBatches(c *fiber.Ctx) error {
	batches, err := h.svc.ListBatches(c.Context(), caller(c))
	if err != nil {
		return err
	}
	return c.JSON(batches)
}

func (h *Handler) GetBatch(c *fiber.Ctx) error {
	batch, err := h.svc.GetBatch(c.Context(), c.Params("id"), caller(c))
	if err != nil {
		return err
	}
	return c.JSON(batch)
}

func (h *Handler) CreateBatch(c *fiber.Ctx) error {
	var input CreateBatchInput
	if err := c.BodyParser(&input); err != nil {
		return apperrors.BadRequest("invalid request body")
	}
	if input.TemplateID == "" || input.Name == "" {
		return apperrors.BadRequest("template_id and name are required")
	}
	batch, err := h.svc.CreateBatch(c.Context(), input, caller(c))
	if err != nil {
		return err
	}
	return c.Status(fiber.StatusCreated).JSON(batch)
}

func (h *Handler) ListRecipients(c *fiber.Ctx) error {
	recipients, err := h.svc.ListRecipients(c.Context(), c.Params("id"), caller(c))
	if err != nil {
		return err
	}
	return c.JSON(recipients)
}

func (h *Handler) GetProgress(c *fiber.Ctx) error {
	progress, err := h.svc.GetProgress(c.Context(), c.Params("id"), caller(c))
	if err != nil {
		return err
	}
	return c.JSON(progress)
}

func (h *Handler) CancelBatch(c *fiber.Ctx) error {
	if err := h.svc.CancelBatch(c.Context(), c.Params("id"), caller(c)); err != nil {
		return err
	}
	return c.JSON(fiber.Map{"message": "batch cancelled"})
}

func (h *Handler) GetCertificate(c *fiber.Ctx) error {
	cert, err := h.svc.GetCertificate(c.Context(), c.Params("id"), caller(c))
	if err != nil {
		return err
	}
	return c.JSON(cert)
}

// RenderCertificate is a public endpoint that renders a certificate on demand
// and returns the result as PNG or PDF depending on the ?format= query param.
// Rendered bytes are cached in memory keyed by recipient ID.
func (h *Handler) RenderCertificate(c *fiber.Ctx) error {
	format := c.Query("format", "png")
	data, contentType, err := h.svc.RenderCertificate(c.Context(), c.Params("id"), format)
	if err != nil {
		return err
	}
	c.Set("Content-Type", contentType)
	c.Set("Cache-Control", "public, max-age=86400, immutable")
	return c.Send(data)
}

func (h *Handler) RevokeCertificate(c *fiber.Ctx) error {
	if err := h.svc.RevokeCertificate(c.Context(), c.Params("id"), caller(c)); err != nil {
		return err
	}
	return c.JSON(fiber.Map{"message": "certificate revoked"})
}

func (h *Handler) DownloadArchive(c *fiber.Ctx) error {
	c.Set("Content-Type", "application/zip")
	c.Set("Content-Disposition", `attachment; filename="certificates.zip"`)
	name, err := h.svc.DownloadArchive(c.Context(), c.Params("id"), caller(c), c.Response().BodyWriter())
	if err != nil {
		return err
	}
	// Update filename to match batch name now that we have it
	c.Set("Content-Disposition", `attachment; filename="`+sanitizeFilename(name)+`.zip"`)
	return nil
}

func (h *Handler) ListCertificates(c *fiber.Ctx) error {
	entries, err := h.svc.ListCertificates(c.Context(), c.Params("id"), caller(c))
	if err != nil {
		return err
	}
	return c.JSON(entries)
}

func (h *Handler) DeleteBatch(c *fiber.Ctx) error {
	if err := h.svc.DeleteBatch(c.Context(), c.Params("id"), caller(c)); err != nil {
		return err
	}
	return c.SendStatus(fiber.StatusNoContent)
}

func sanitizeFilename(s string) string {
	out := make([]byte, 0, len(s))
	for i := 0; i < len(s); i++ {
		b := s[i]
		if b == '"' || b == '\\' || b == '/' || b == '\n' || b == '\r' {
			out = append(out, '_')
		} else {
			out = append(out, b)
		}
	}
	return string(out)
}
