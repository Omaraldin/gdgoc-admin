package server

import (
	"context"
	"fmt"
	"io"
	"path/filepath"
	"strings"
	"time"

	"github.com/gdgoc/admin-api/internal/config"
	"github.com/gdgoc/admin-api/internal/database"
	"github.com/gdgoc/admin-api/internal/storage"

	// domain handlers
	"github.com/gdgoc/admin-api/internal/domain/auth"
	"github.com/gdgoc/admin-api/internal/domain/chapters"
	dynamicimages "github.com/gdgoc/admin-api/internal/domain/dynamicimages"
	"github.com/gdgoc/admin-api/internal/domain/fonts"
	"github.com/gdgoc/admin-api/internal/domain/issuance"
	"github.com/gdgoc/admin-api/internal/domain/mail"
	"github.com/gdgoc/admin-api/internal/domain/templates"
	"github.com/gdgoc/admin-api/internal/domain/users"
	"github.com/gdgoc/admin-api/internal/domain/verification"
	"github.com/gdgoc/admin-api/internal/worker"

	"github.com/gdgoc/admin-api/internal/middleware"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/cors"
	"github.com/gofiber/fiber/v2/middleware/helmet"
	"github.com/gofiber/fiber/v2/middleware/limiter"
	"github.com/gofiber/fiber/v2/middleware/logger"
	"github.com/gofiber/fiber/v2/middleware/recover"
)

func New(
	cfg *config.Config,
	db *database.DB,
	store storage.Backend,
	issuanceQ chan<- string,
	mailQ chan<- mail.MailJob,
) (*fiber.App, error) {
	app := fiber.New(fiber.Config{
		AppName:      "GDGoC Admin API",
		ErrorHandler: errorHandler,
		BodyLimit:    10 * 1024 * 1024, // 10 MB
	})

	app.Use(recover.New())
	app.Use(helmet.New())
	app.Use(logger.New())
	app.Use(cors.New(cors.Config{
		AllowOrigins:     cfg.CORS.AllowedOrigins,
		AllowCredentials: true,
		AllowHeaders:     "Origin, Content-Type, Accept, Authorization",
		AllowMethods:     "GET, POST, PUT, PATCH, DELETE, OPTIONS",
	}))

	// Rate limiter for auth endpoints (login / callback / refresh).
	authLimiter := limiter.New(limiter.Config{
		Max:          cfg.RateLimit.AuthMax,
		Expiration:   time.Duration(cfg.RateLimit.AuthWindowSecs) * time.Second,
		KeyGenerator: func(c *fiber.Ctx) string { return c.IP() },
		LimitReached: func(c *fiber.Ctx) error {
			return fiber.NewError(fiber.StatusTooManyRequests, "too many requests, please slow down")
		},
	})

	// Rate limiter for public render/verify endpoints.
	publicLimiter := limiter.New(limiter.Config{
		Max:          cfg.RateLimit.PublicMax,
		Expiration:   time.Duration(cfg.RateLimit.PublicWindowSecs) * time.Second,
		KeyGenerator: func(c *fiber.Ctx) string { return c.IP() },
		LimitReached: func(c *fiber.Ctx) error {
			return fiber.NewError(fiber.StatusTooManyRequests, "too many requests, please slow down")
		},
	})

	// --- dependency wiring ---
	authRepo := auth.NewRepository(db)
	kayanClient, err := auth.NewKayanClient(cfg.Kayan, authRepo)
	if err != nil {
		return nil, fmt.Errorf("kayan: %w", err)
	}
	authSvc := auth.NewService(cfg, authRepo, kayanClient)
	authH := auth.NewHandler(authSvc)

	userRepo := users.NewRepository(db)
	userSvc := users.NewService(userRepo)
	userH := users.NewHandler(userSvc)

	chapterRepo := chapters.NewRepository(db)
	chapterSvc := chapters.NewService(chapterRepo, userRepo, store)
	chapterH := chapters.NewHandler(chapterSvc, chapters.SMTPOAuthHandlerConfig{
		GoogleClientID:        cfg.SMTPOAuth.GoogleClientID,
		GoogleClientSecret:    cfg.SMTPOAuth.GoogleClientSecret,
		MicrosoftClientID:     cfg.SMTPOAuth.MicrosoftClientID,
		MicrosoftClientSecret: cfg.SMTPOAuth.MicrosoftClientSecret,
		CallbackURL:           cfg.SMTPOAuth.CallbackURL,
		FrontendURL:           cfg.SMTPOAuth.FrontendURL,
		StateSecret:           cfg.SMTPOAuth.StateSecret,
	})

	tmplRepo := templates.NewRepository(db)
	tmplSvc := templates.NewService(tmplRepo, store)
	tmplH := templates.NewHandler(tmplSvc)

	imageRenderer := worker.NewImageRenderer(store)
	dynImgRepo := dynamicimages.NewRepository(db)
	dynImgSvc := dynamicimages.NewService(dynImgRepo, imageRenderer, store)
	dynImgH := dynamicimages.NewHandler(dynImgSvc)

	issuanceRepo := issuance.NewRepository(db)
	issuanceSvc := issuance.NewService(
		issuanceRepo,
		tmplRepo,
		chapterRepo,
		issuanceQ,
		cfg.Worker,
		imageRenderer,
		worker.ToPDFBytes,
		cfg.PublicURL,
	)
	issuanceH := issuance.NewHandler(issuanceSvc)

	verificationRepo := verification.NewRepository(db)
	verificationSvc := verification.NewService(verificationRepo)
	verificationH := verification.NewHandler(verificationSvc)

	mailSvc := mail.NewService(mailQ)
	mailH := mail.NewHandler(mailSvc, func(ctx context.Context, chapterID string) error {
		_, err := chapterRepo.GetSMTPConfig(ctx, chapterID)
		return err
	})
	mailTmplRepo := mail.NewTemplateRepository(db)
	mailTmplSvc := mail.NewTemplateService(mailTmplRepo)
	mailImageRepo := mail.NewImageRepository(db)
	mailTmplH := mail.NewTemplateHandler(mailTmplSvc, store, mailImageRepo)

	fontRepo := fonts.NewRepository(db)
	fontSvc := fonts.NewService(fontRepo, store)
	fontH := fonts.NewHandler(fontSvc)

	// --- auth middleware ---
	requireAuth := middleware.RequireAuth(authSvc)
	requireSuperAdmin := middleware.RequireRole(auth.RoleSuperAdmin)

	// Serve local storage assets directly (static middleware, local driver only).
	// For S3/Cloudinary the /api/v1/assets/* handler below redirects to the CDN URL.
	if cfg.Storage.Driver == "local" || cfg.Storage.Driver == "" {
		app.Static(cfg.Storage.PublicPrefix, cfg.Storage.LocalDir)
	}

	// --- routes ---
	api := app.Group("/api/v1")

	// Public asset proxy — works for all storage drivers.
	// Clients use GET /api/v1/assets/<object_key> to load template images.
	// [public] stream or redirect to asset URL
	api.Get("/assets/*", func(c *fiber.Ctx) error {
		objectKey := c.Params("*")
		if objectKey == "" {
			return fiber.ErrNotFound
		}
		assetURL := store.GetAssetURL(objectKey)
		// Cloud backends return an absolute http URL — redirect the browser there.
		if strings.HasPrefix(assetURL, "http") {
			return c.Redirect(assetURL, fiber.StatusFound)
		}
		// Local driver: stream from disk.
		r, err := store.GetObject(c.Context(), store.BucketAssets(), objectKey)
		if err != nil {
			return fiber.ErrNotFound
		}
		defer r.Close()
		ext := strings.ToLower(filepath.Ext(objectKey))
		mimeTypes := map[string]string{
			".png":  "image/png",
			".jpg":  "image/jpeg",
			".jpeg": "image/jpeg",
			".webp": "image/webp",
			".svg":  "image/svg+xml",
			".gif":  "image/gif",
		}
		ct := mimeTypes[ext]
		if ct == "" {
			ct = "application/octet-stream"
		}
		c.Set("Content-Type", ct)
		c.Set("Cache-Control", "public, max-age=31536000, immutable")
		_, err = io.Copy(c.Response().BodyWriter(), r)
		return err
	})

	// ── public routes ─────────────────────────────────────────────────────────
	api.Get("/health", healthCheck)                                                  // [public] health check
	api.Get("/verify/:code", publicLimiter, verificationH.VerifyCertificate)        // [public] verify certificate by code
	// Dynamic image render — public, no auth required
	api.Get("/images/:id", publicLimiter, dynImgH.Render)                        // [public] render dynamic image
	api.Get("/certificates/:id/render", publicLimiter, issuanceH.RenderCertificate) // [public] render certificate on demand

	// ── auth ──────────────────────────────────────────────────────────────────
	authGroup := api.Group("/auth")
	authGroup.Get("/login", authLimiter, authH.Login)       // [public] initiate Google OAuth flow
	authGroup.Get("/callback", authLimiter, authH.Callback) // [public] Google OAuth callback
	authGroup.Post("/logout", authH.Logout)                 // [public] clear session cookies
	authGroup.Post("/refresh", authLimiter, authH.Refresh)  // [public] rotate access/refresh tokens

	// ── protected (all routes below require a valid session cookie) ───────────
	protected := api.Group("", requireAuth)

	protected.Get("/me", authH.Me) // [authenticated] current user profile

	// ── users ─────────────────────────────────────────────────────────────────
	usersGroup := protected.Group("/users", requireSuperAdmin)
	usersGroup.Get("/", userH.List)        // [super_admin] list all users
	usersGroup.Get("/:id", userH.Get)      // [super_admin] get user by id
	usersGroup.Post("/", userH.Create)     // [super_admin] create user
	usersGroup.Patch("/:id", userH.Update) // [super_admin] update user
	usersGroup.Delete("/:id", userH.Delete) // [super_admin] delete user

	// ── whitelist ─────────────────────────────────────────────────────────────
	whitelistGroup := protected.Group("/whitelist", requireSuperAdmin)
	whitelistGroup.Get("/", userH.ListWhitelist)          // [super_admin] list whitelist entries
	whitelistGroup.Post("/", userH.AddToWhitelist)        // [super_admin] add email to whitelist
	whitelistGroup.Delete("/:id", userH.RemoveFromWhitelist) // [super_admin] remove entry from whitelist

	// ── chapters ──────────────────────────────────────────────────────────────
	protected.Get("/chapters", chapterH.List)     // [authenticated] list chapters
	protected.Get("/chapters/:id", chapterH.Get)  // [authenticated] get chapter by id

	protected.Patch("/chapters/:id", middleware.RequireChapterLeaderAccess(), chapterH.Update)               // [chapter_leader(own) | super_admin] update chapter details
	protected.Get("/chapters/:id/smtp", middleware.RequireChapterAccess(), chapterH.GetSMTPStatus)            // [chapter_leader(own) | super_admin] get SMTP status
	protected.Patch("/chapters/:id/leader-profile", middleware.RequireChapterLeaderAccess(), chapterH.UpdateLeaderProfile) // [chapter_leader(own) | super_admin] update leader profile
	protected.Patch("/chapters/:id/smtp", middleware.RequireChapterAccess(), chapterH.UpdateSMTP)             // [chapter_leader(own) | super_admin] set SMTP credentials
	protected.Delete("/chapters/:id/smtp", middleware.RequireChapterAccess(), chapterH.DisconnectSMTP)        // [chapter_leader(own) | super_admin] disconnect SMTP
	protected.Get("/chapters/:id/smtp/oauth/connect", middleware.RequireChapterAccess(), chapterH.OAuthConnectURL) // [chapter_leader(own) | super_admin] get OAuth2 authorization URL
	api.Get("/chapters/smtp/oauth/callback", chapterH.OAuthCallback) // [public] OAuth2 provider redirect (no session cookie available)

	chaptersAdmin := protected.Group("/chapters", requireSuperAdmin)
	chaptersAdmin.Post("/", chapterH.Create)                                  // [super_admin] create chapter
	chaptersAdmin.Delete("/:id", chapterH.Delete)                             // [super_admin] delete chapter
	chaptersAdmin.Post("/:id/leader", chapterH.AssignLeader)                  // [super_admin] assign chapter leader
	chaptersAdmin.Post("/:id/profile-picture", chapterH.UploadProfilePicture) // [super_admin] upload chapter profile picture

	// ── templates ─────────────────────────────────────────────────────────────
	protected.Get("/templates", tmplH.List)                                      // [authenticated] list templates
	protected.Get("/templates/public", tmplH.ListPublic)                         // [authenticated] list published templates
	protected.Post("/templates/import", tmplH.Import)                            // [authenticated] import template from JSON
	protected.Get("/templates/:id", tmplH.Get)                                   // [authenticated] get template by id
	protected.Post("/templates", tmplH.Create)                                   // [authenticated] create template
	protected.Patch("/templates/:id", tmplH.Update)                              // [authenticated] update template
	protected.Delete("/templates/:id", tmplH.Delete)                             // [authenticated] delete template
	protected.Get("/templates/:id/export", tmplH.Export)                         // [authenticated] export template as JSON
	protected.Post("/templates/:id/publish", tmplH.Publish)                      // [authenticated] publish template
	protected.Post("/templates/:id/archive", tmplH.Archive)                      // [authenticated] archive template
	protected.Post("/templates/:id/clone", tmplH.Clone)                          // [authenticated] clone template
	protected.Post("/templates/:id/assets", tmplH.UploadAsset)                   // [authenticated] upload template asset
	protected.Get("/templates/:id/versions", tmplH.ListVersions)                 // [authenticated] list template versions
	protected.Post("/templates/:id/versions", tmplH.CreateVersion)               // [authenticated] create template version
	protected.Get("/templates/:id/versions/:versionId", tmplH.GetVersion)        // [authenticated] get specific template version

	// ── certificate issuance ──────────────────────────────────────────────────
	protected.Get("/batches", issuanceH.ListBatches)                           // [authenticated] own-chapter only; super_admin sees all
	protected.Get("/batches/:id", issuanceH.GetBatch)                          // [authenticated] own-chapter | super_admin
	protected.Post("/batches", issuanceH.CreateBatch)                          // [authenticated] batch scoped to caller's chapter
	protected.Get("/batches/:id/recipients", issuanceH.ListRecipients)         // [authenticated] own-chapter | super_admin
	protected.Get("/batches/:id/progress", issuanceH.GetProgress)              // [authenticated] own-chapter | super_admin
	protected.Get("/batches/:id/certificates", issuanceH.ListCertificates)     // [authenticated] own-chapter | super_admin
	protected.Post("/batches/:id/cancel", issuanceH.CancelBatch)               // [authenticated] own-chapter | super_admin
	protected.Delete("/batches/:id", issuanceH.DeleteBatch)                    // [authenticated] own-chapter | super_admin
	protected.Get("/batches/:id/download", issuanceH.DownloadArchive)          // [authenticated] own-chapter | super_admin
	protected.Get("/certificates/:id", issuanceH.GetCertificate)               // [authenticated] own-chapter | super_admin
	protected.Post("/certificates/:id/revoke", issuanceH.RevokeCertificate)    // [authenticated] own-chapter | super_admin

	// ── mail ──────────────────────────────────────────────────────────────────
	protected.Post("/mail/send", mailH.Send)       // [authenticated] send mail
	protected.Get("/mail/history", mailH.History)  // [authenticated] mail send history

	// ── mail templates ────────────────────────────────────────────────────────
	protected.Get("/mail/templates", mailTmplH.List)                          // [authenticated] list mail templates
	protected.Post("/mail/templates", mailTmplH.Create)                       // [authenticated] create mail template
	protected.Get("/mail/templates/:id", mailTmplH.Get)                       // [authenticated] get mail template by id
	protected.Patch("/mail/templates/:id", mailTmplH.Update)                  // [authenticated] update mail template
	protected.Delete("/mail/templates/:id", mailTmplH.Delete)                 // [authenticated] delete mail template
	protected.Post("/mail/templates/:id/publish", mailTmplH.Publish)          // [authenticated] publish mail template
        protected.Post("/mail/templates/:id/unpublish", mailTmplH.Unpublish)        // [authenticated] unpublish mail template
        protected.Post("/mail/templates/:id/clone", mailTmplH.Clone)                // [authenticated] clone mail template into caller's chapter
        protected.Post("/mail/images", mailTmplH.UploadImage)                       // [authenticated] upload mail template image
	// ── dynamic images ────────────────────────────────────────────────────────
	protected.Get("/dynamic-images", dynImgH.List)                            // [authenticated] list dynamic images
	protected.Get("/dynamic-images/:id", dynImgH.Get)                         // [authenticated] get dynamic image by id
	protected.Post("/dynamic-images", dynImgH.Create)                         // [authenticated] create dynamic image
	protected.Patch("/dynamic-images/:id", dynImgH.Update)                    // [authenticated] update dynamic image
	protected.Delete("/dynamic-images/:id", dynImgH.Delete)                   // [authenticated] delete dynamic image
	protected.Post("/dynamic-images/:id/publish", dynImgH.Publish)            // [authenticated] publish dynamic image
	protected.Post("/dynamic-images/:id/unpublish", dynImgH.Unpublish)        // [authenticated] unpublish dynamic image
	protected.Post("/dynamic-images/:id/assets", dynImgH.UploadAsset)         // [authenticated] upload dynamic image asset

	// ── font library ──────────────────────────────────────────────────────────
	protected.Get("/fonts", fontH.List)         // [authenticated] list fonts
	protected.Post("/fonts", fontH.Upload)       // [authenticated] upload font
	protected.Delete("/fonts/:id", fontH.Delete) // [authenticated] delete font

	return app, nil
}

func healthCheck(c *fiber.Ctx) error {
	return c.JSON(fiber.Map{"status": "ok"})
}

func errorHandler(c *fiber.Ctx, err error) error {
	code := fiber.StatusInternalServerError
	msg := "internal server error"

	if e, ok := err.(*fiber.Error); ok {
		code = e.Code
		msg = e.Message
	}

	return c.Status(code).JSON(fiber.Map{
		"error": msg,
	})
}
