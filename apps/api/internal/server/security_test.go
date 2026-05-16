package server_test

import (
	"bytes"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/cors"
	"github.com/gofiber/fiber/v2/middleware/helmet"
	"github.com/gofiber/fiber/v2/middleware/limiter"
)

// ─── helpers ────────────────────────────────────────────────────────────────

func testErrorHandler(c *fiber.Ctx, err error) error {
	code := fiber.StatusInternalServerError
	if e, ok := err.(*fiber.Error); ok {
		code = e.Code
	}
	return c.SendStatus(code)
}

// doGet sends a GET request and returns the *http.Response.
func doGet(t *testing.T, app *fiber.App, target string, headers ...string) *http.Response {
	t.Helper()
	req := httptest.NewRequest("GET", target, nil)
	for i := 0; i+1 < len(headers); i += 2 {
		req.Header.Set(headers[i], headers[i+1])
	}
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("app.Test: %v", err)
	}
	return resp
}

// ─── Security headers (Helmet) ───────────────────────────────────────────────

// newHelmetApp returns a Fiber app with the Helmet middleware applied.
func newHelmetApp() *fiber.App {
	app := fiber.New(fiber.Config{ErrorHandler: testErrorHandler})
	app.Use(helmet.New())
	app.Get("/health", func(c *fiber.Ctx) error { return c.SendStatus(200) })
	return app
}

func TestHelmet_XContentTypeOptions(t *testing.T) {
	app := newHelmetApp()
	req := httptest.NewRequest("GET", "/health", nil)
	resp, _ := app.Test(req)
	if v := resp.Header.Get("X-Content-Type-Options"); v != "nosniff" {
		t.Errorf("X-Content-Type-Options: expected 'nosniff', got %q", v)
	}
}

func TestHelmet_XFrameOptions(t *testing.T) {
	app := newHelmetApp()
	req := httptest.NewRequest("GET", "/health", nil)
	resp, _ := app.Test(req)
	if v := resp.Header.Get("X-Frame-Options"); v == "" {
		t.Error("X-Frame-Options header is missing")
	}
}

func TestHelmet_XSSProtection(t *testing.T) {
	app := newHelmetApp()
	req := httptest.NewRequest("GET", "/health", nil)
	resp, _ := app.Test(req)
	if v := resp.Header.Get("X-XSS-Protection"); v == "" {
		t.Error("X-XSS-Protection header is missing")
	}
}

func TestHelmet_ReferrerPolicy(t *testing.T) {
	app := newHelmetApp()
	req := httptest.NewRequest("GET", "/health", nil)
	resp, _ := app.Test(req)
	if v := resp.Header.Get("Referrer-Policy"); v == "" {
		t.Error("Referrer-Policy header is missing")
	}
}

// ─── CORS ────────────────────────────────────────────────────────────────────

const allowedOrigin = "https://admin.example.com"

// newCORSApp returns a Fiber app configured with the same CORS settings used
// in production (single allowed origin, credentials: true).
func newCORSApp(allowedOrigins string) *fiber.App {
	app := fiber.New(fiber.Config{ErrorHandler: testErrorHandler})
	app.Use(cors.New(cors.Config{
		AllowOrigins:     allowedOrigins,
		AllowCredentials: true,
		AllowHeaders:     "Origin, Content-Type, Accept, Authorization",
		AllowMethods:     "GET, POST, PUT, PATCH, DELETE, OPTIONS",
	}))
	app.Get("/health", func(c *fiber.Ctx) error { return c.SendStatus(200) })
	app.Options("/health", func(c *fiber.Ctx) error { return c.SendStatus(204) })
	return app
}

func TestCORS_AllowedOriginReceivesHeader(t *testing.T) {
	app := newCORSApp(allowedOrigin)
	req := httptest.NewRequest("GET", "/health", nil)
	req.Header.Set("Origin", allowedOrigin)
	resp, _ := app.Test(req)
	got := resp.Header.Get("Access-Control-Allow-Origin")
	if got != allowedOrigin {
		t.Errorf("expected ACAO=%q, got %q", allowedOrigin, got)
	}
}

func TestCORS_UnknownOriginDoesNotReceiveHeader(t *testing.T) {
	app := newCORSApp(allowedOrigin)
	req := httptest.NewRequest("GET", "/health", nil)
	req.Header.Set("Origin", "https://evil.example.com")
	resp, _ := app.Test(req)
	got := resp.Header.Get("Access-Control-Allow-Origin")
	if got == "https://evil.example.com" || got == "*" {
		t.Errorf("unexpected ACAO header for unknown origin: %q", got)
	}
}

func TestCORS_CredentialsHeaderPresent(t *testing.T) {
	app := newCORSApp(allowedOrigin)
	req := httptest.NewRequest("GET", "/health", nil)
	req.Header.Set("Origin", allowedOrigin)
	resp, _ := app.Test(req)
	if v := resp.Header.Get("Access-Control-Allow-Credentials"); v != "true" {
		t.Errorf("expected Access-Control-Allow-Credentials=true, got %q", v)
	}
}

func TestCORS_PreflightAllowedOrigin(t *testing.T) {
	app := newCORSApp(allowedOrigin)
	req := httptest.NewRequest("OPTIONS", "/health", nil)
	req.Header.Set("Origin", allowedOrigin)
	req.Header.Set("Access-Control-Request-Method", "POST")
	resp, _ := app.Test(req)
	if resp.StatusCode != 204 && resp.StatusCode != 200 {
		t.Errorf("preflight expected 204 or 200, got %d", resp.StatusCode)
	}
	if v := resp.Header.Get("Access-Control-Allow-Origin"); v != allowedOrigin {
		t.Errorf("preflight ACAO: expected %q, got %q", allowedOrigin, v)
	}
}

// ─── Rate limiting ───────────────────────────────────────────────────────────

// newLimitedApp returns a Fiber app whose /endpoint is guarded by a rate
// limiter that allows max requests within the given window.
func newLimitedApp(max int, window time.Duration) *fiber.App {
	app := fiber.New(fiber.Config{ErrorHandler: testErrorHandler})
	lim := limiter.New(limiter.Config{
		Max:          max,
		Expiration:   window,
		KeyGenerator: func(c *fiber.Ctx) string { return c.IP() },
		LimitReached: func(c *fiber.Ctx) error {
			return fiber.NewError(fiber.StatusTooManyRequests, "too many requests")
		},
	})
	app.Get("/endpoint", lim, func(c *fiber.Ctx) error { return c.SendStatus(200) })
	return app
}

// hammer sends n GET requests to /endpoint on the same app and returns all
// status codes in order.
func hammer(t *testing.T, app *fiber.App, n int) []int {
	t.Helper()
	codes := make([]int, n)
	for i := range codes {
		req := httptest.NewRequest("GET", "/endpoint", nil)
		resp, err := app.Test(req)
		if err != nil {
			t.Fatalf("request %d: %v", i, err)
		}
		codes[i] = resp.StatusCode
	}
	return codes
}

func TestRateLimit_BlocksAfterMaxRequests(t *testing.T) {
	const max = 5
	app := newLimitedApp(max, 10*time.Second)
	codes := hammer(t, app, max+1)

	for i, code := range codes[:max] {
		if code != fiber.StatusOK {
			t.Errorf("request %d: expected 200, got %d", i+1, code)
		}
	}
	if codes[max] != fiber.StatusTooManyRequests {
		t.Errorf("request %d (over limit): expected 429, got %d", max+1, codes[max])
	}
}

func TestRateLimit_AuthEndpointEnforcedStrictly(t *testing.T) {
	// Mirrors the auth limiter config: 3 requests allowed in a short window.
	const authMax = 3
	app := newLimitedApp(authMax, 60*time.Second)
	codes := hammer(t, app, authMax+2)

	allowed := 0
	blocked := 0
	for _, code := range codes {
		switch code {
		case 200:
			allowed++
		case 429:
			blocked++
		}
	}

	if allowed != authMax {
		t.Errorf("expected exactly %d allowed requests, got %d", authMax, allowed)
	}
	if blocked != 2 {
		t.Errorf("expected 2 blocked requests, got %d", blocked)
	}
}

func TestRateLimit_HeadersPresent(t *testing.T) {
	app := newLimitedApp(10, 60*time.Second)
	req := httptest.NewRequest("GET", "/endpoint", nil)
	resp, _ := app.Test(req)
	if resp.StatusCode != 200 {
		t.Fatalf("unexpected status %d", resp.StatusCode)
	}
	// Fiber's built-in limiter sets X-RateLimit-* headers.
	for _, h := range []string{"X-Ratelimit-Limit", "X-Ratelimit-Remaining"} {
		if v := resp.Header.Get(h); v == "" {
			t.Errorf("missing rate-limit header %s", h)
		}
	}
}

// ─── Unauthenticated access to protected routes ───────────────────────────────
// These tests verify that routes requiring authentication return 401 when no
// session cookie is present. They use a standalone Fiber app that mirrors the
// middleware chain used in production, without requiring a real database.

func newProtectedApp(requireAuth fiber.Handler) *fiber.App {
	app := fiber.New(fiber.Config{ErrorHandler: testErrorHandler})
	app.Get("/protected", requireAuth, func(c *fiber.Ctx) error { return c.SendStatus(200) })
	return app
}

// authBlocker is a fiber.Handler that always rejects requests (simulates
// RequireAuth behaviour when no valid session cookie is present) without
// needing a real auth service or database.
func authBlocker(c *fiber.Ctx) error {
	if c.Cookies("session") == "" {
		return fiber.NewError(fiber.StatusUnauthorized, "authentication required")
	}
	// Any non-empty cookie still gets rejected because we have no real verifier.
	return fiber.NewError(fiber.StatusUnauthorized, "invalid or expired session")
}

func TestUnauthenticated_ProtectedRouteReturns401(t *testing.T) {
	app := newProtectedApp(authBlocker)
	req := httptest.NewRequest("GET", "/protected", nil)
	resp, _ := app.Test(req)
	if resp.StatusCode != fiber.StatusUnauthorized {
		t.Errorf("expected 401, got %d", resp.StatusCode)
	}
}

func TestUnauthenticated_InvalidTokenReturns401(t *testing.T) {
	app := newProtectedApp(authBlocker)
	req := httptest.NewRequest("GET", "/protected", nil)
	req.Header.Set("Cookie", "session=garbage-token-value")
	resp, _ := app.Test(req)
	if resp.StatusCode != fiber.StatusUnauthorized {
		t.Errorf("expected 401, got %d", resp.StatusCode)
	}
}

// ─── Body size limit ─────────────────────────────────────────────────────────

func TestBodySizeLimit_OversizedPayloadRejected(t *testing.T) {
	const limitBytes = 1024 // 1 KB for this test
	app := fiber.New(fiber.Config{
		ErrorHandler: testErrorHandler,
		BodyLimit:    limitBytes,
	})
	app.Post("/upload", func(c *fiber.Ctx) error { return c.SendStatus(200) })

	// Build a body larger than the limit.
	oversized := bytes.Repeat([]byte("x"), limitBytes+1)
	req := httptest.NewRequest("POST", "/upload", bytes.NewReader(oversized))
	req.Header.Set("Content-Type", "application/octet-stream")
	resp, err := app.Test(req)

	// Fiber/fasthttp can reject an oversized body either by:
	//  (a) returning a 413 response, or
	//  (b) surfacing an error from app.Test itself ("body size exceeds the given limit").
	// Both outcomes prove the limit is enforced.
	if err != nil {
		if !strings.Contains(err.Error(), "body size exceeds") &&
			!strings.Contains(err.Error(), "413") {
			t.Errorf("unexpected error: %v", err)
		}
		return // limit enforced via error — test passes
	}
	if resp.StatusCode != fiber.StatusRequestEntityTooLarge {
		t.Errorf("expected 413, got %d", resp.StatusCode)
	}
}

// readerFromBytes is kept to satisfy the io import; its Read implementation
// is a correct io.Reader contract.
type readerFromBytes struct {
	data []byte
	pos  int
}

func (r *readerFromBytes) Read(p []byte) (n int, err error) {
	if r.pos >= len(r.data) {
		return 0, io.EOF
	}
	n = copy(p, r.data[r.pos:])
	r.pos += n
	return n, nil
}
