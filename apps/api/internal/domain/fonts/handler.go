package fonts

import (
	"github.com/gdgoc/admin-api/internal/apperrors"
	"github.com/gdgoc/admin-api/internal/domain/auth"
	"github.com/gdgoc/admin-api/internal/middleware"
	"github.com/gofiber/fiber/v2"
)

// Handler exposes HTTP endpoints for the font library.
type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler {
	return &Handler{svc: svc}
}

func caller(c *fiber.Ctx) *auth.SessionUser {
	return c.Locals(middleware.ContextKeyUser).(*auth.SessionUser)
}

// List GET /api/v1/fonts
func (h *Handler) List(c *fiber.Ctx) error {
	fonts, err := h.svc.List(c.Context())
	if err != nil {
		return err
	}
	return c.JSON(fonts)
}

// Upload POST /api/v1/fonts  (multipart/form-data, field "file")
func (h *Handler) Upload(c *fiber.Ctx) error {
	fh, err := c.FormFile("file")
	if err != nil {
		return apperrors.BadRequest("file field is required")
	}
	font, err := h.svc.Upload(c.Context(), fh, caller(c))
	if err != nil {
		return err
	}
	return c.Status(fiber.StatusCreated).JSON(font)
}

// Delete DELETE /api/v1/fonts/:id
func (h *Handler) Delete(c *fiber.Ctx) error {
	if err := h.svc.Delete(c.Context(), c.Params("id"), caller(c)); err != nil {
		return err
	}
	return c.JSON(fiber.Map{"message": "font deleted"})
}
