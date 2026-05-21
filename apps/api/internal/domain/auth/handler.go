package auth

import (
	"net/http"
	"time"

	"github.com/gdgoc/admin-api/internal/apperrors"
	"github.com/gofiber/fiber/v2"
)

const refreshCookiePath = "/api/v1/auth/refresh"

func sameSiteForSessionCookies(appEnv string) string {
	if appEnv == "production" {
		// Cross-site frontend (e.g. Vercel) requires SameSite=None cookies.
		return "None"
	}
	return "Lax"
}

type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler {
	return &Handler{svc: svc}
}

func (h *Handler) Login(c *fiber.Ctx) error {
	url, state, err := h.svc.LoginURL(c.Context())
	if err != nil {
		return err
	}
	c.Cookie(&fiber.Cookie{
		Name:     "oauth_state",
		Value:    state,
		HTTPOnly: true,
		SameSite: "Lax",
		MaxAge:   300,
	})
	// Persist the desired post-login redirect so Callback can use it.
	if redirect := c.Query("redirect"); redirect != "" {
		c.Cookie(&fiber.Cookie{
			Name:     "oauth_redirect",
			Value:    redirect,
			HTTPOnly: true,
			SameSite: "Lax",
			MaxAge:   300,
		})
	}
	return c.Redirect(url, fiber.StatusTemporaryRedirect)
}

func (h *Handler) Callback(c *fiber.Ctx) error {
	code := c.Query("code")
	state := c.Query("state")

	if c.Cookies("oauth_state") != state {
		return fiber.NewError(fiber.StatusBadRequest, "invalid oauth state")
	}
	c.ClearCookie("oauth_state")

	pair, err := h.svc.HandleCallback(c.Context(), code, state)
	if err != nil {
		return err
	}

	secure := h.svc.cfg.AppEnv == "production"
	sameSite := sameSiteForSessionCookies(h.svc.cfg.AppEnv)

	// Short-lived access token — sent on every request.
	c.Cookie(&fiber.Cookie{
		Name:     "session",
		Value:    pair.AccessToken,
		HTTPOnly: true,
		SameSite: sameSite,
		MaxAge:   h.svc.cfg.Session.AccessTokenHours * 3600,
		Secure:   secure,
	})
	// Long-lived refresh token — scoped to the refresh endpoint only.
	c.Cookie(&fiber.Cookie{
		Name:     "refresh_token",
		Value:    pair.RefreshToken,
		HTTPOnly: true,
		SameSite: sameSite,
		Path:     refreshCookiePath,
		MaxAge:   h.svc.cfg.Session.MaxAgeHours * 3600,
		Secure:   secure,
	})

	frontendURL := c.Cookies("oauth_redirect")
	c.ClearCookie("oauth_redirect")
	if frontendURL == "" {
		frontendURL = c.Query("redirect", "/")
	}
	return c.Redirect(frontendURL, http.StatusSeeOther)
}

// Refresh validates the refresh token cookie and issues a new rotated token pair.
func (h *Handler) Refresh(c *fiber.Ctx) error {
	rt := c.Cookies("refresh_token")
	if rt == "" {
		return apperrors.Unauthorized("refresh token required")
	}

	pair, err := h.svc.RefreshSession(c.Context(), rt)
	if err != nil {
		return err
	}

	secure := h.svc.cfg.AppEnv == "production"
	sameSite := sameSiteForSessionCookies(h.svc.cfg.AppEnv)

	c.Cookie(&fiber.Cookie{
		Name:     "session",
		Value:    pair.AccessToken,
		HTTPOnly: true,
		SameSite: sameSite,
		MaxAge:   h.svc.cfg.Session.AccessTokenHours * 3600,
		Secure:   secure,
	})
	c.Cookie(&fiber.Cookie{
		Name:     "refresh_token",
		Value:    pair.RefreshToken,
		HTTPOnly: true,
		SameSite: sameSite,
		Path:     refreshCookiePath,
		MaxAge:   h.svc.cfg.Session.MaxAgeHours * 3600,
		Secure:   secure,
	})

	return c.JSON(fiber.Map{"message": "token refreshed"})
}

func (h *Handler) Logout(c *fiber.Ctx) error {
	expired := time.Unix(0, 0)
	c.Cookie(&fiber.Cookie{
		Name:    "session",
		Value:   "",
		Expires: expired,
	})
	c.Cookie(&fiber.Cookie{
		Name:    "refresh_token",
		Value:   "",
		Path:    refreshCookiePath,
		Expires: expired,
	})
	return c.JSON(fiber.Map{"message": "logged out"})
}

func (h *Handler) Me(c *fiber.Ctx) error {
	user := c.Locals("user").(*SessionUser)
	return c.JSON(fiber.Map{
		"id":         user.ID,
		"email":      user.Email,
		"name":       user.Name,
		"role":       user.Role,
		"chapter_id": user.ChapterID,
	})
}
