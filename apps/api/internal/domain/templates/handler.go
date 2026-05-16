package templates

import (
	"log"
	"strings"

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

func (h *Handler) List(c *fiber.Ctx) error {
	templates, err := h.svc.List(c.Context(), caller(c))
	if err != nil {
		return err
	}
	return c.JSON(templates)
}

func (h *Handler) ListPublic(c *fiber.Ctx) error {
	templates, err := h.svc.ListPublic(c.Context())
	if err != nil {
		return err
	}
	return c.JSON(templates)
}

func (h *Handler) Get(c *fiber.Ctx) error {
	tmpl, err := h.svc.Get(c.Context(), c.Params("id"), caller(c))
	if err != nil {
		return err
	}
	return c.JSON(tmpl)
}

func (h *Handler) Create(c *fiber.Ctx) error {
	var input CreateTemplateInput
	if err := c.BodyParser(&input); err != nil {
		return apperrors.BadRequest("invalid request body")
	}
	if input.Name == "" {
		return apperrors.BadRequest("name is required")
	}
	if input.Visibility == "" {
		input.Visibility = VisibilityPrivate
	}
	tmpl, err := h.svc.Create(c.Context(), input, caller(c))
	if err != nil {
		return err
	}
	return c.Status(fiber.StatusCreated).JSON(tmpl)
}

func (h *Handler) Update(c *fiber.Ctx) error {
	// Update handled as a new version creation — stub for now
	return apperrors.BadRequest("use POST /templates/:id/versions to save a new version")
}

func (h *Handler) Delete(c *fiber.Ctx) error {
	return apperrors.BadRequest("archive the template instead of deleting")
}

func (h *Handler) Publish(c *fiber.Ctx) error {
	if err := h.svc.Publish(c.Context(), c.Params("id"), caller(c)); err != nil {
		return err
	}
	return c.JSON(fiber.Map{"message": "template published"})
}

func (h *Handler) Archive(c *fiber.Ctx) error {
	if err := h.svc.Archive(c.Context(), c.Params("id"), caller(c)); err != nil {
		return err
	}
	return c.JSON(fiber.Map{"message": "template archived"})
}

func (h *Handler) Clone(c *fiber.Ctx) error {
	var body struct {
		Name string `json:"name"`
	}
	// body is optional; ignore parse error
	_ = c.BodyParser(&body)
	cloned, err := h.svc.Clone(c.Context(), c.Params("id"), body.Name, caller(c))
	if err != nil {
		return err
	}
	return c.Status(fiber.StatusCreated).JSON(cloned)
}

func (h *Handler) Export(c *fiber.Ctx) error {
	data, err := h.svc.Export(c.Context(), c.Params("id"), caller(c))
	if err != nil {
		return err
	}
	// Sanitize name for use as a filename
	filename := strings.Map(func(r rune) rune {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '-' || r == '_' {
			return r
		}
		return '-'
	}, data.Name) + ".json"
	c.Set("Content-Disposition", `attachment; filename="`+filename+`"`)
	return c.JSON(data)
}

func (h *Handler) Import(c *fiber.Ctx) error {
	var data TemplateExportData
	if err := c.BodyParser(&data); err != nil {
		return apperrors.BadRequest("invalid JSON")
	}
	tmpl, err := h.svc.Import(c.Context(), data, caller(c))
	if err != nil {
		return err
	}
	return c.Status(fiber.StatusCreated).JSON(tmpl)
}

func (h *Handler) UploadAsset(c *fiber.Ctx) error {
	fh, err := c.FormFile("file")
	if err != nil {
		return apperrors.BadRequest("file is required")
	}
	asset, err := h.svc.UploadAsset(c.Context(), c.Params("id"), fh, caller(c))
	if err != nil {
		return err
	}
	return c.Status(fiber.StatusCreated).JSON(asset)
}

func (h *Handler) ListVersions(c *fiber.Ctx) error {
	versions, err := h.svc.ListVersions(c.Context(), c.Params("id"))
	if err != nil {
		return err
	}
	return c.JSON(versions)
}

func (h *Handler) CreateVersion(c *fiber.Ctx) error {
	var body struct {
		Scene SceneDefinition `json:"scene"`
	}
	if err := c.BodyParser(&body); err != nil {
		log.Printf("CreateVersion: body parse error for template %s: %v", c.Params("id"), err)
		return apperrors.BadRequest("invalid request body")
	}
	v, err := h.svc.CreateVersion(c.Context(), c.Params("id"), body.Scene, caller(c))
	if err != nil {
		return err
	}
	return c.Status(fiber.StatusCreated).JSON(v)
}

func (h *Handler) GetVersion(c *fiber.Ctx) error {
	version, err := h.svc.GetVersion(c.Context(), c.Params("versionId"))
	if err != nil {
		return err
	}
	return c.JSON(version)
}
