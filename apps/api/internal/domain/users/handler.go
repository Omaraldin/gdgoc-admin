package users

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

func (h *Handler) List(c *fiber.Ctx) error {
	caller := c.Locals(middleware.ContextKeyUser).(*auth.SessionUser)
	var chapterFilter *string
	if !auth.IsSuperAdmin(caller.Role) && caller.ChapterID != "" {
		chapterFilter = &caller.ChapterID
	}
	users, err := h.svc.List(c.Context(), chapterFilter)
	if err != nil {
		return err
	}
	return c.JSON(users)
}

func (h *Handler) Get(c *fiber.Ctx) error {
	user, err := h.svc.Get(c.Context(), c.Params("id"))
	if err != nil {
		return err
	}
	return c.JSON(user)
}

func (h *Handler) Create(c *fiber.Ctx) error {
	// Users are created on first login; this endpoint is for admin invite/pre-create
	return apperrors.BadRequest("use whitelist to invite users")
}

func (h *Handler) Update(c *fiber.Ctx) error {
	var input UpdateUserInput
	if err := c.BodyParser(&input); err != nil {
		return apperrors.BadRequest("invalid request body")
	}
	user, err := h.svc.Update(c.Context(), c.Params("id"), input)
	if err != nil {
		return err
	}
	return c.JSON(user)
}

func (h *Handler) Delete(c *fiber.Ctx) error {
	if err := h.svc.Delete(c.Context(), c.Params("id")); err != nil {
		return err
	}
	return c.SendStatus(fiber.StatusNoContent)
}

func (h *Handler) ListWhitelist(c *fiber.Ctx) error {
	caller := c.Locals(middleware.ContextKeyUser).(*auth.SessionUser)
	var chapterFilter *string
	if !auth.IsSuperAdmin(caller.Role) && caller.ChapterID != "" {
		chapterFilter = &caller.ChapterID
	}
	entries, err := h.svc.ListWhitelist(c.Context(), chapterFilter)
	if err != nil {
		return err
	}
	return c.JSON(entries)
}

func (h *Handler) AddToWhitelist(c *fiber.Ctx) error {
	var body struct {
		Email string `json:"email"`
		Role  string `json:"role"`
	}
	if err := c.BodyParser(&body); err != nil || body.Email == "" {
		return apperrors.BadRequest("email is required")
	}
	if body.Role == "" {
		body.Role = auth.RoleChapterLeader
	}
	caller := c.Locals(middleware.ContextKeyUser).(*auth.SessionUser)
	var chapterID *string
	if !auth.IsSuperAdmin(caller.Role) {
		if body.Role == auth.RoleSuperAdmin {
			return apperrors.Forbidden("chapter leaders cannot assign the super_admin role")
		}
		if caller.ChapterID == "" {
			return apperrors.Forbidden("you are not associated with a chapter")
		}
		chapterID = &caller.ChapterID
	}
	entry, err := h.svc.AddToWhitelist(c.Context(), body.Email, body.Role, caller.ID, chapterID)
	if err != nil {
		return err
	}
	return c.Status(fiber.StatusCreated).JSON(entry)
}

func (h *Handler) RemoveFromWhitelist(c *fiber.Ctx) error {
	caller := c.Locals(middleware.ContextKeyUser).(*auth.SessionUser)
	var chapterID *string
	if !auth.IsSuperAdmin(caller.Role) {
		if caller.ChapterID == "" {
			return apperrors.Forbidden("you are not associated with a chapter")
		}
		chapterID = &caller.ChapterID
	}
	if err := h.svc.RemoveFromWhitelist(c.Context(), c.Params("id"), chapterID); err != nil {
		return err
	}
	return c.SendStatus(fiber.StatusNoContent)
}
