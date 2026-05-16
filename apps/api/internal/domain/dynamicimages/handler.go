package dynamicimages

import (
	"github.com/gdgoc/admin-api/internal/apperrors"
	"github.com/gdgoc/admin-api/internal/domain/auth"
	tmpl "github.com/gdgoc/admin-api/internal/domain/templates"
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
	items, err := h.svc.List(c.Context(), caller(c))
	if err != nil {
		return err
	}
	return c.JSON(items)
}

func (h *Handler) Get(c *fiber.Ctx) error {
	detail, err := h.svc.Get(c.Context(), c.Params("id"), caller(c))
	if err != nil {
		return err
	}
	return c.JSON(detail)
}

func (h *Handler) Create(c *fiber.Ctx) error {
	var body struct {
		Name        string               `json:"name"`
		Description string               `json:"description"`
		Scene       tmpl.SceneDefinition `json:"scene"`
	}
	if err := c.BodyParser(&body); err != nil {
		return apperrors.BadRequest("invalid request body")
	}
	if body.Name == "" {
		return apperrors.BadRequest("name is required")
	}
	item, err := h.svc.Create(c.Context(), CreateInput{
		Name:        body.Name,
		Description: body.Description,
		Scene:       body.Scene,
	}, caller(c))
	if err != nil {
		return err
	}
	return c.Status(fiber.StatusCreated).JSON(item)
}

func (h *Handler) Update(c *fiber.Ctx) error {
	var body struct {
		Name        string               `json:"name"`
		Description string               `json:"description"`
		Scene       tmpl.SceneDefinition `json:"scene"`
	}
	if err := c.BodyParser(&body); err != nil {
		return apperrors.BadRequest("invalid request body")
	}
	if body.Name == "" {
		return apperrors.BadRequest("name is required")
	}
	item, err := h.svc.Update(c.Context(), c.Params("id"), UpdateInput{
		Name:        body.Name,
		Description: body.Description,
		Scene:       body.Scene,
	}, caller(c))
	if err != nil {
		return err
	}
	return c.JSON(item)
}

func (h *Handler) Delete(c *fiber.Ctx) error {
	if err := h.svc.Delete(c.Context(), c.Params("id"), caller(c)); err != nil {
		return err
	}
	return c.SendStatus(fiber.StatusNoContent)
}

func (h *Handler) Publish(c *fiber.Ctx) error {
	item, err := h.svc.Publish(c.Context(), c.Params("id"), caller(c))
	if err != nil {
		return err
	}
	return c.JSON(item)
}

func (h *Handler) Unpublish(c *fiber.Ctx) error {
	item, err := h.svc.Unpublish(c.Context(), c.Params("id"), caller(c))
	if err != nil {
		return err
	}
	return c.JSON(item)
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

// Render is a public endpoint: GET /images/:id?field=value&...
// Returns a PNG image rendered from the stored scene with query param overrides.
func (h *Handler) Render(c *fiber.Ctx) error {
	vars := make(map[string]string)
	c.Request().URI().QueryArgs().VisitAll(func(k, v []byte) {
		vars[string(k)] = string(v)
	})

	imgBytes, err := h.svc.Render(c.Context(), c.Params("id"), vars)
	if err != nil {
		return err
	}

	c.Set("Content-Type", "image/png")
	c.Set("Cache-Control", "no-cache, no-store, must-revalidate")
	return c.Send(imgBytes)
}
