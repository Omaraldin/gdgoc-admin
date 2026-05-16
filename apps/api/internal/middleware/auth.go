package middleware

import (
	"github.com/gdgoc/admin-api/internal/apperrors"
	"github.com/gdgoc/admin-api/internal/domain/auth"
	"github.com/gofiber/fiber/v2"
)

const ContextKeyUser = "user"

// RequireAuth validates the session cookie and injects the current user into context.
func RequireAuth(authSvc *auth.Service) fiber.Handler {
	return func(c *fiber.Ctx) error {
		sessionToken := c.Cookies("session")
		if sessionToken == "" {
			return apperrors.Unauthorized("authentication required")
		}

		user, err := authSvc.ValidateSession(c.Context(), sessionToken)
		if err != nil {
			return apperrors.Unauthorized("invalid or expired session")
		}

		c.Locals(ContextKeyUser, user)
		return c.Next()
	}
}

// RequireRole asserts that the authenticated user has the given role.
func RequireRole(role string) fiber.Handler {
	return func(c *fiber.Ctx) error {
		user, ok := c.Locals(ContextKeyUser).(*auth.SessionUser)
		if !ok || user == nil {
			return apperrors.Unauthorized("authentication required")
		}
		if user.Role != role {
			return apperrors.Forbidden("insufficient permissions")
		}
		return c.Next()
	}
}

// RequireChapterAccess ensures the user owns or is admin of the chapter in the route param.
func RequireChapterAccess() fiber.Handler {
	return func(c *fiber.Ctx) error {
		user, ok := c.Locals(ContextKeyUser).(*auth.SessionUser)
		if !ok || user == nil {
			return apperrors.Unauthorized("authentication required")
		}
		if auth.IsSuperAdmin(user.Role) {
			return c.Next()
		}
		chapterID := c.Params("id")
		if chapterID == "" {
			chapterID = c.Params("chapterId")
		}
		if chapterID != "" && user.ChapterID != chapterID {
			return apperrors.Forbidden("access denied for this chapter")
		}
		return c.Next()
	}
}

// RequireChapterLeaderAccess ensures only chapter leaders (or super admins)
// can access routes that modify chapter details.
func RequireChapterLeaderAccess() fiber.Handler {
	return func(c *fiber.Ctx) error {
		user, ok := c.Locals(ContextKeyUser).(*auth.SessionUser)
		if !ok || user == nil {
			return apperrors.Unauthorized("authentication required")
		}
		if auth.IsSuperAdmin(user.Role) {
			return c.Next()
		}
		if !auth.IsChapterLeader(user.Role) {
			return apperrors.Forbidden("only chapter leaders can edit chapter details")
		}
		chapterID := c.Params("id")
		if chapterID == "" {
			chapterID = c.Params("chapterId")
		}
		if chapterID != "" && user.ChapterID != chapterID {
			return apperrors.Forbidden("access denied for this chapter")
		}
		return c.Next()
	}
}
