package chapters

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/gdgoc/admin-api/internal/apperrors"
	"github.com/gdgoc/admin-api/internal/domain/mail"
	"github.com/gofiber/fiber/v2"
)

var leaderCodenamePattern = regexp.MustCompile(`^[A-Z0-9-]+$`)

// SMTPOAuthHandlerConfig holds the OAuth2 application credentials and URLs
// needed by the chapter SMTP OAuth flow handlers.
type SMTPOAuthHandlerConfig struct {
	GoogleClientID        string
	GoogleClientSecret    string
	MicrosoftClientID     string
	MicrosoftClientSecret string
	// CallbackURL is the redirect URI registered with Google and Microsoft.
	// Example: "https://api.example.com/api/v1/chapters/smtp/oauth/callback"
	CallbackURL string
	// FrontendURL is the base URL to redirect to after the OAuth flow.
	// When empty, the handler returns JSON instead of redirecting.
	FrontendURL string
	// StateSecret is the HMAC key used to sign the state parameter.
	StateSecret string
}

type Handler struct {
	svc      *Service
	oauthCfg SMTPOAuthHandlerConfig
}

func NewHandler(svc *Service, oauthCfg SMTPOAuthHandlerConfig) *Handler {
	return &Handler{svc: svc, oauthCfg: oauthCfg}
}

func (h *Handler) List(c *fiber.Ctx) error {
	chapters, err := h.svc.List(c.Context())
	if err != nil {
		return err
	}
	return c.JSON(chapters)
}

func (h *Handler) Get(c *fiber.Ctx) error {
	ch, err := h.svc.Get(c.Context(), c.Params("id"))
	if err != nil {
		return err
	}
	return c.JSON(ch)
}

func (h *Handler) Create(c *fiber.Ctx) error {
	var input CreateChapterInput
	if err := c.BodyParser(&input); err != nil {
		return apperrors.BadRequest("invalid request body")
	}
	if input.Name == "" {
		return apperrors.BadRequest("name is required")
	}
	if input.SinceYear != nil && (*input.SinceYear < 1900 || *input.SinceYear > 9999) {
		return apperrors.BadRequest("since_year must be between 1900 and 9999")
	}
	normalizedCodename, err := normalizeLeaderCodename(input.LeaderCodename)
	if err != nil {
		return err
	}
	input.LeaderCodename = normalizedCodename
	ch, err := h.svc.Create(c.Context(), input)
	if err != nil {
		return err
	}
	return c.Status(fiber.StatusCreated).JSON(ch)
}

func (h *Handler) Update(c *fiber.Ctx) error {
	var input UpdateChapterInput
	if err := c.BodyParser(&input); err != nil {
		return apperrors.BadRequest("invalid request body")
	}
	if input.SinceYear != nil && (*input.SinceYear < 1900 || *input.SinceYear > 9999) {
		return apperrors.BadRequest("since_year must be between 1900 and 9999")
	}
	if input.LeaderCodename != nil {
		normalizedCodename, err := normalizeLeaderCodename(*input.LeaderCodename)
		if err != nil {
			return err
		}
		input.LeaderCodename = &normalizedCodename
	}
	ch, err := h.svc.Update(c.Context(), c.Params("id"), input)
	if err != nil {
		return err
	}
	return c.JSON(ch)
}

// UpdateLeaderProfile allows chapter leaders to update chapter identity fields
// used by certificate metadata generation.
func (h *Handler) UpdateLeaderProfile(c *fiber.Ctx) error {
	var body struct {
		SinceYear      *int    `json:"since_year"`
		LeaderCodename *string `json:"leader_codename"`
	}
	if err := c.BodyParser(&body); err != nil {
		return apperrors.BadRequest("invalid request body")
	}
	if body.SinceYear != nil && (*body.SinceYear < 1900 || *body.SinceYear > 9999) {
		return apperrors.BadRequest("since_year must be between 1900 and 9999")
	}
	var codename *string
	if body.LeaderCodename != nil {
		normalizedCodename, err := normalizeLeaderCodename(*body.LeaderCodename)
		if err != nil {
			return err
		}
		codename = &normalizedCodename
	}
	ch, err := h.svc.Update(c.Context(), c.Params("id"), UpdateChapterInput{
		SinceYear:      body.SinceYear,
		LeaderCodename: codename,
	})
	if err != nil {
		return err
	}
	return c.JSON(ch)
}

func (h *Handler) Delete(c *fiber.Ctx) error {
	if err := h.svc.Delete(c.Context(), c.Params("id")); err != nil {
		return err
	}
	return c.SendStatus(fiber.StatusNoContent)
}

func (h *Handler) AssignLeader(c *fiber.Ctx) error {
	var body struct {
		UserID string `json:"user_id"`
	}
	if err := c.BodyParser(&body); err != nil || body.UserID == "" {
		return apperrors.BadRequest("user_id is required")
	}
	if err := h.svc.AssignLeader(c.Context(), c.Params("id"), body.UserID); err != nil {
		return err
	}
	return c.JSON(fiber.Map{"message": "leader assigned"})
}

func (h *Handler) UploadProfilePicture(c *fiber.Ctx) error {
	fh, err := c.FormFile("file")
	if err != nil {
		return apperrors.BadRequest("file is required")
	}
	ch, err := h.svc.UploadProfilePicture(c.Context(), c.Params("id"), fh)
	if err != nil {
		return err
	}
	return c.JSON(ch)
}

// ---------------------------------------------------------------------------
// SMTP handlers
// ---------------------------------------------------------------------------

// GetSMTPStatus returns the current SMTP provider and connection status for a
// chapter without exposing any credentials.
func (h *Handler) GetSMTPStatus(c *fiber.Ctx) error {
	cfg, err := h.svc.GetSMTPConfig(c.Context(), c.Params("id"))
	if err != nil {
		// Not configured yet — return an empty status instead of an error.
		return c.JSON(fiber.Map{
			"provider":   "manual",
			"connected":  false,
			"from_email": "",
		})
	}
	return c.JSON(fiber.Map{
		"provider":   cfg.Provider,
		"from_email": cfg.FromEmail,
		"connected":  true,
	})
}

// UpdateSMTP configures manual (PlainAuth) SMTP for a chapter.
// Body: { "host": "smtp.example.com", "port": 587, "username": "user@example.com",
//
//	"password": "secret", "email": "noreply@example.com" }
//
// "email" is optional; when omitted, "username" is used as the From address.
func (h *Handler) UpdateSMTP(c *fiber.Ctx) error {
	var input ManualSMTPInput
	if err := c.BodyParser(&input); err != nil {
		return apperrors.BadRequest("invalid request body")
	}
	if input.Host == "" || input.Port == 0 || input.Username == "" || input.Password == "" {
		return apperrors.BadRequest("host, port, username, and password are required")
	}
	if err := h.svc.UpdateManualSMTP(c.Context(), c.Params("id"), input); err != nil {
		return err
	}
	return c.JSON(fiber.Map{"message": "manual SMTP configured"})
}

// DisconnectSMTP removes all SMTP credentials from a chapter.
func (h *Handler) DisconnectSMTP(c *fiber.Ctx) error {
	if err := h.svc.DisconnectSMTP(c.Context(), c.Params("id")); err != nil {
		return err
	}
	return c.JSON(fiber.Map{"message": "SMTP disconnected"})
}

// OAuthConnectURL returns the provider's authorization URL that the frontend
// should redirect the user to.
// Query param: provider=gmail|outlook
func (h *Handler) OAuthConnectURL(c *fiber.Ctx) error {
	provider := c.Query("provider")
	if provider != "gmail" && provider != "outlook" {
		return apperrors.BadRequest("provider must be 'gmail' or 'outlook'")
	}

	chapterID := c.Params("id")
	state, err := generateState(chapterID, provider, h.oauthCfg.StateSecret)
	if err != nil {
		return fmt.Errorf("generate state: %w", err)
	}

	var authURL string
	switch provider {
	case "gmail":
		if h.oauthCfg.GoogleClientID == "" {
			return c.Status(fiber.StatusServiceUnavailable).JSON(fiber.Map{"error": "Gmail OAuth is not configured on this server. Set SMTP_GOOGLE_CLIENT_ID and SMTP_GOOGLE_CLIENT_SECRET."})
		}
		params := url.Values{
			"client_id":     {h.oauthCfg.GoogleClientID},
			"redirect_uri":  {h.oauthCfg.CallbackURL},
			"response_type": {"code"},
			"scope":         {"https://mail.google.com/ openid email"},
			"access_type":   {"offline"},
			"prompt":        {"consent"}, // required to always receive a refresh token
			"state":         {state},
		}
		authURL = "https://accounts.google.com/o/oauth2/v2/auth?" + params.Encode()
	case "outlook":
		if h.oauthCfg.MicrosoftClientID == "" {
			return c.Status(fiber.StatusServiceUnavailable).JSON(fiber.Map{"error": "Outlook OAuth is not configured on this server. Set SMTP_MICROSOFT_CLIENT_ID and SMTP_MICROSOFT_CLIENT_SECRET."})
		}
		params := url.Values{
			"client_id":     {h.oauthCfg.MicrosoftClientID},
			"redirect_uri":  {h.oauthCfg.CallbackURL},
			"response_type": {"code"},
			// offline_access is required to receive a refresh token
			"scope": {"https://outlook.office.com/SMTP.Send offline_access"},
			"state": {state},
		}
		authURL = "https://login.microsoftonline.com/common/oauth2/v2.0/authorize?" + params.Encode()
	}

	return c.JSON(fiber.Map{"auth_url": authURL})
}

// OAuthCallback handles the redirect from Google / Microsoft after the user
// grants consent. It exchanges the authorization code for tokens and saves the
// refresh token. This endpoint must be registered as a public (unauthenticated)
// route because the provider redirect does not carry the session cookie.
func (h *Handler) OAuthCallback(c *fiber.Ctx) error {
	code := c.Query("code")
	state := c.Query("state")
	if code == "" || state == "" {
		return h.oauthRedirect(c, "", "", "missing code or state parameter")
	}

	chapterID, provider, err := parseState(state, h.oauthCfg.StateSecret)
	if err != nil {
		return h.oauthRedirect(c, chapterID, "", err.Error())
	}

	var clientID, clientSecret string
	switch provider {
	case "gmail":
		clientID = h.oauthCfg.GoogleClientID
		clientSecret = h.oauthCfg.GoogleClientSecret
	case "outlook":
		clientID = h.oauthCfg.MicrosoftClientID
		clientSecret = h.oauthCfg.MicrosoftClientSecret
	default:
		return h.oauthRedirect(c, chapterID, "", "unknown provider in state")
	}

	accessToken, refreshToken, err := mail.ExchangeCodeForTokens(
		provider, code, h.oauthCfg.CallbackURL, clientID, clientSecret,
	)
	if err != nil {
		return h.oauthRedirect(c, chapterID, "", "token exchange failed")
	}

	fromEmail, err := mail.GetOAuthUserEmail(provider, accessToken)
	if err != nil {
		return h.oauthRedirect(c, chapterID, "", "could not retrieve authorized email")
	}

	if err := h.svc.SaveOAuthConnection(c.Context(), chapterID, provider, fromEmail, refreshToken); err != nil {
		return h.oauthRedirect(c, chapterID, "", "failed to save OAuth connection")
	}

	return h.oauthRedirect(c, chapterID, "smtp_provider="+provider+"&smtp_email="+url.QueryEscape(fromEmail), "")
}

// oauthRedirect redirects to the configured frontend URL's chapter detail page
// with smtp_status or smtp_error query parameters. When no frontend URL is
// configured it returns JSON.
func (h *Handler) oauthRedirect(c *fiber.Ctx, chapterID, successParams, errMsg string) error {
	base := h.oauthCfg.FrontendURL
	if base == "" {
		if errMsg != "" {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": errMsg})
		}
		return c.JSON(fiber.Map{"message": "email connected successfully"})
	}
	target := base + "/chapters/" + chapterID
	if errMsg != "" {
		return c.Redirect(target+"?smtp_error="+url.QueryEscape(errMsg), fiber.StatusFound)
	}
	return c.Redirect(target+"?smtp_connected=1&"+successParams, fiber.StatusFound)
}

func normalizeLeaderCodename(raw string) (string, error) {
	normalized := strings.ToUpper(strings.TrimSpace(raw))
	if normalized == "" {
		return "", nil
	}
	if len(normalized) > 32 {
		return "", apperrors.BadRequest("leader_codename must be at most 32 characters")
	}
	if !leaderCodenamePattern.MatchString(normalized) {
		return "", apperrors.BadRequest("leader_codename may contain only A-Z, 0-9, and '-' characters")
	}
	return normalized, nil
}

// ---------------------------------------------------------------------------
// state token helpers (HMAC-signed, 10-minute TTL)
// ---------------------------------------------------------------------------

func generateState(chapterID, provider, secret string) (string, error) {
	ts := strconv.FormatInt(time.Now().Unix(), 10)
	payload := chapterID + ":" + provider + ":" + ts
	encoded := base64.RawURLEncoding.EncodeToString([]byte(payload))
	mac := hmac.New(sha256.New, []byte(secret))
	if _, err := mac.Write([]byte(encoded)); err != nil {
		return "", err
	}
	sig := hex.EncodeToString(mac.Sum(nil))
	return encoded + "." + sig, nil
}

func parseState(state, secret string) (chapterID, provider string, err error) {
	dot := strings.LastIndex(state, ".")
	if dot < 0 {
		return "", "", fmt.Errorf("invalid state format")
	}
	encoded, sig := state[:dot], state[dot+1:]

	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(encoded))
	expected := hex.EncodeToString(mac.Sum(nil))
	if !hmac.Equal([]byte(sig), []byte(expected)) {
		return "", "", fmt.Errorf("invalid state signature")
	}

	raw, err := base64.RawURLEncoding.DecodeString(encoded)
	if err != nil {
		return "", "", fmt.Errorf("invalid state encoding")
	}

	parts := strings.SplitN(string(raw), ":", 3)
	if len(parts) != 3 {
		return "", "", fmt.Errorf("malformed state payload")
	}

	ts, err := strconv.ParseInt(parts[2], 10, 64)
	if err != nil || time.Now().Unix()-ts > 600 {
		return "", "", fmt.Errorf("state token expired")
	}

	return parts[0], parts[1], nil
}
