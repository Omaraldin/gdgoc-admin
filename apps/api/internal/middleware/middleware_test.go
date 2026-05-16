package middleware_test

import (
	"net/http/httptest"
	"testing"

	"github.com/gdgoc/admin-api/internal/config"
	"github.com/gdgoc/admin-api/internal/domain/auth"
	"github.com/gdgoc/admin-api/internal/middleware"
	"github.com/gofiber/fiber/v2"
)

// ─── helpers ────────────────────────────────────────────────────────────────

// testErrorHandler converts fiber.Error values into their HTTP status codes so
// that app.Test() returns the expected code instead of always 500.
func testErrorHandler(c *fiber.Ctx, err error) error {
	code := fiber.StatusInternalServerError
	if e, ok := err.(*fiber.Error); ok {
		code = e.Code
	}
	return c.SendStatus(code)
}

// newApp creates a minimal Fiber app under GET /test with the given handler chain.
func newApp(handlers ...fiber.Handler) *fiber.App {
	app := fiber.New(fiber.Config{ErrorHandler: testErrorHandler})
	app.Get("/test", handlers...)
	return app
}

// newChapterApp creates a Fiber app with a route that exposes a :id param.
func newChapterApp(handlers ...fiber.Handler) *fiber.App {
	app := fiber.New(fiber.Config{ErrorHandler: testErrorHandler})
	app.Get("/chapters/:id/data", handlers...)
	return app
}

func okHandler(c *fiber.Ctx) error { return c.SendStatus(fiber.StatusOK) }

// injectUser returns middleware that pre-populates context locals with the
// supplied SessionUser, simulating a previously-authenticated request.
func injectUser(u *auth.SessionUser) fiber.Handler {
	return func(c *fiber.Ctx) error {
		c.Locals(middleware.ContextKeyUser, u)
		return c.Next()
	}
}

// testAuthService constructs a real *auth.Service using a test JWT secret.
// The repository and kayan client are nil because no DB or OAuth calls are
// needed for the token-validation paths exercised by these tests.
func testAuthService() *auth.Service {
	cfg := &config.Config{
		AppEnv: "test",
		Session: config.SessionConfig{
			Secret:           "test-secret-key-that-is-long-enough-32b",
			AccessTokenHours: 1,
			MaxAgeHours:      24,
		},
	}
	return auth.NewService(cfg, nil, nil)
}

// get sends a GET request to the app and returns the HTTP status code.
func get(t *testing.T, app *fiber.App, target string, cookieKV ...string) int {
	t.Helper()
	req := httptest.NewRequest("GET", target, nil)
	for i := 0; i+1 < len(cookieKV); i += 2 {
		req.Header.Add("Cookie", cookieKV[i]+"="+cookieKV[i+1])
	}
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("app.Test: %v", err)
	}
	return resp.StatusCode
}

// ─── RequireAuth ─────────────────────────────────────────────────────────────

func TestRequireAuth_NoCookie_Returns401(t *testing.T) {
	app := newApp(middleware.RequireAuth(testAuthService()), okHandler)
	if code := get(t, app, "/test"); code != fiber.StatusUnauthorized {
		t.Errorf("expected 401, got %d", code)
	}
}

func TestRequireAuth_InvalidJWT_Returns401(t *testing.T) {
	app := newApp(middleware.RequireAuth(testAuthService()), okHandler)
	if code := get(t, app, "/test", "session", "not.a.valid.jwt"); code != fiber.StatusUnauthorized {
		t.Errorf("expected 401, got %d", code)
	}
}

func TestRequireAuth_MalformedToken_Returns401(t *testing.T) {
	app := newApp(middleware.RequireAuth(testAuthService()), okHandler)
	// A single-segment string that is not a JWT at all.
	if code := get(t, app, "/test", "session", "definitely-not-a-jwt"); code != fiber.StatusUnauthorized {
		t.Errorf("expected 401, got %d", code)
	}
}

func TestRequireAuth_TokenSignedWithWrongKey_Returns401(t *testing.T) {
	app := newApp(middleware.RequireAuth(testAuthService()), okHandler)
	// A structurally valid JWT but signed with a different secret.
	wrongKeyJWT := "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9." +
		"eyJzdWIiOiJ1c2VyLTEiLCJleHAiOjk5OTk5OTk5OTl9." +
		"SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c"
	if code := get(t, app, "/test", "session", wrongKeyJWT); code != fiber.StatusUnauthorized {
		t.Errorf("expected 401, got %d", code)
	}
}

// ─── RequireRole ─────────────────────────────────────────────────────────────

func TestRequireRole_NoUserInContext_Returns401(t *testing.T) {
	app := newApp(middleware.RequireRole(auth.RoleSuperAdmin), okHandler)
	if code := get(t, app, "/test"); code != fiber.StatusUnauthorized {
		t.Errorf("expected 401, got %d", code)
	}
}

func TestRequireRole_ChapterLeaderAccessingSuperAdminRoute_Returns403(t *testing.T) {
	user := &auth.SessionUser{ID: "u1", Role: auth.RoleChapterLeader}
	app := newApp(injectUser(user), middleware.RequireRole(auth.RoleSuperAdmin), okHandler)
	if code := get(t, app, "/test"); code != fiber.StatusForbidden {
		t.Errorf("expected 403, got %d", code)
	}
}

func TestRequireRole_EditorAccessingSuperAdminRoute_Returns403(t *testing.T) {
	user := &auth.SessionUser{ID: "u1", Role: auth.RoleEditor}
	app := newApp(injectUser(user), middleware.RequireRole(auth.RoleSuperAdmin), okHandler)
	if code := get(t, app, "/test"); code != fiber.StatusForbidden {
		t.Errorf("expected 403, got %d", code)
	}
}

func TestRequireRole_SuperAdminAccessingSuperAdminRoute_Returns200(t *testing.T) {
	user := &auth.SessionUser{ID: "u1", Role: auth.RoleSuperAdmin}
	app := newApp(injectUser(user), middleware.RequireRole(auth.RoleSuperAdmin), okHandler)
	if code := get(t, app, "/test"); code != fiber.StatusOK {
		t.Errorf("expected 200, got %d", code)
	}
}

// ─── RequireChapterAccess ────────────────────────────────────────────────────

func TestRequireChapterAccess_NoUser_Returns401(t *testing.T) {
	app := newChapterApp(middleware.RequireChapterAccess(), okHandler)
	if code := get(t, app, "/chapters/ch-1/data"); code != fiber.StatusUnauthorized {
		t.Errorf("expected 401, got %d", code)
	}
}

func TestRequireChapterAccess_SuperAdminCanAccessAnyChapter(t *testing.T) {
	user := &auth.SessionUser{ID: "u1", Role: auth.RoleSuperAdmin, ChapterID: "ch-other"}
	app := newChapterApp(injectUser(user), middleware.RequireChapterAccess(), okHandler)
	if code := get(t, app, "/chapters/ch-1/data"); code != fiber.StatusOK {
		t.Errorf("expected 200, got %d", code)
	}
}

func TestRequireChapterAccess_LeaderCanAccessOwnChapter(t *testing.T) {
	user := &auth.SessionUser{ID: "u1", Role: auth.RoleChapterLeader, ChapterID: "ch-1"}
	app := newChapterApp(injectUser(user), middleware.RequireChapterAccess(), okHandler)
	if code := get(t, app, "/chapters/ch-1/data"); code != fiber.StatusOK {
		t.Errorf("expected 200, got %d", code)
	}
}

func TestRequireChapterAccess_LeaderCannotAccessOtherChapter(t *testing.T) {
	user := &auth.SessionUser{ID: "u1", Role: auth.RoleChapterLeader, ChapterID: "ch-2"}
	app := newChapterApp(injectUser(user), middleware.RequireChapterAccess(), okHandler)
	if code := get(t, app, "/chapters/ch-1/data"); code != fiber.StatusForbidden {
		t.Errorf("expected 403, got %d", code)
	}
}

func TestRequireChapterAccess_EditorCannotAccessOtherChapter(t *testing.T) {
	user := &auth.SessionUser{ID: "u1", Role: auth.RoleEditor, ChapterID: "ch-2"}
	app := newChapterApp(injectUser(user), middleware.RequireChapterAccess(), okHandler)
	if code := get(t, app, "/chapters/ch-1/data"); code != fiber.StatusForbidden {
		t.Errorf("expected 403, got %d", code)
	}
}

// ─── RequireChapterLeaderAccess ───────────────────────────────────────────────

func TestRequireChapterLeaderAccess_NoUser_Returns401(t *testing.T) {
	app := newChapterApp(middleware.RequireChapterLeaderAccess(), okHandler)
	if code := get(t, app, "/chapters/ch-1/data"); code != fiber.StatusUnauthorized {
		t.Errorf("expected 401, got %d", code)
	}
}

func TestRequireChapterLeaderAccess_EditorForbidden(t *testing.T) {
	user := &auth.SessionUser{ID: "u1", Role: auth.RoleEditor, ChapterID: "ch-1"}
	app := newChapterApp(injectUser(user), middleware.RequireChapterLeaderAccess(), okHandler)
	if code := get(t, app, "/chapters/ch-1/data"); code != fiber.StatusForbidden {
		t.Errorf("expected 403, got %d", code)
	}
}

func TestRequireChapterLeaderAccess_LeaderCanEditOwnChapter(t *testing.T) {
	user := &auth.SessionUser{ID: "u1", Role: auth.RoleChapterLeader, ChapterID: "ch-1"}
	app := newChapterApp(injectUser(user), middleware.RequireChapterLeaderAccess(), okHandler)
	if code := get(t, app, "/chapters/ch-1/data"); code != fiber.StatusOK {
		t.Errorf("expected 200, got %d", code)
	}
}

func TestRequireChapterLeaderAccess_LeaderCannotEditOtherChapter(t *testing.T) {
	user := &auth.SessionUser{ID: "u1", Role: auth.RoleChapterLeader, ChapterID: "ch-2"}
	app := newChapterApp(injectUser(user), middleware.RequireChapterLeaderAccess(), okHandler)
	if code := get(t, app, "/chapters/ch-1/data"); code != fiber.StatusForbidden {
		t.Errorf("expected 403, got %d", code)
	}
}

func TestRequireChapterLeaderAccess_SuperAdminCanEditAnyChapter(t *testing.T) {
	user := &auth.SessionUser{ID: "u1", Role: auth.RoleSuperAdmin, ChapterID: "ch-other"}
	app := newChapterApp(injectUser(user), middleware.RequireChapterLeaderAccess(), okHandler)
	if code := get(t, app, "/chapters/ch-1/data"); code != fiber.StatusOK {
		t.Errorf("expected 200, got %d", code)
	}
}

// ─── Privilege escalation probes ─────────────────────────────────────────────

// An editor must not bypass chapter-leader-level protection even on their own chapter.
func TestPrivilegeEscalation_EditorCannotActAsChapterLeader(t *testing.T) {
	user := &auth.SessionUser{ID: "u1", Role: auth.RoleEditor, ChapterID: "ch-1"}
	app := newChapterApp(injectUser(user), middleware.RequireChapterLeaderAccess(), okHandler)
	if code := get(t, app, "/chapters/ch-1/data"); code != fiber.StatusForbidden {
		t.Errorf("expected 403, got %d — editor must not act as chapter leader", code)
	}
}

// A chapter leader must not access admin-only routes.
func TestPrivilegeEscalation_ChapterLeaderCannotActAsSuperAdmin(t *testing.T) {
	user := &auth.SessionUser{ID: "u1", Role: auth.RoleChapterLeader}
	app := newApp(injectUser(user), middleware.RequireRole(auth.RoleSuperAdmin), okHandler)
	if code := get(t, app, "/test"); code != fiber.StatusForbidden {
		t.Errorf("expected 403, got %d — chapter leader must not act as super admin", code)
	}
}
