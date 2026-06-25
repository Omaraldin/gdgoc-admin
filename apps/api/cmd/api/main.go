package main

import (
	"context"
	"log"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/gdgoc/admin-api/internal/config"
	"github.com/gdgoc/admin-api/internal/database"
	"github.com/gdgoc/admin-api/internal/domain/auth"
	"github.com/gdgoc/admin-api/internal/domain/chapters"
	"github.com/gdgoc/admin-api/internal/domain/issuance"
	"github.com/gdgoc/admin-api/internal/domain/mail"
	"github.com/gdgoc/admin-api/internal/domain/templates"
	"github.com/gdgoc/admin-api/internal/server"
	"github.com/gdgoc/admin-api/internal/storage"
	"github.com/gdgoc/admin-api/internal/worker"
	"github.com/joho/godotenv"
)


func main() {
	if err := godotenv.Load(); err != nil {
		if err2 := godotenv.Load("../../.env"); err2 != nil && os.Getenv("APP_ENV") == "" {
			log.Println("No .env file found, using environment variables")
		}
	}

	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("failed to load config: %v", err)
	}

	db, err := database.Connect(cfg.DatabaseURL, cfg.DB.MaxOpenConns, cfg.DB.MaxIdleConns, cfg.DB.MaxLifetimeMins)
	if err != nil {
		log.Fatalf("failed to connect to database: %v", err)
	}
	defer db.Close()

	if err := database.Migrate(db); err != nil {
		log.Fatalf("failed to run migrations: %v", err)
	}

	if bootstrapEmail := os.Getenv("BOOTSTRAP_SUPER_ADMIN"); bootstrapEmail != "" {
		authRepo := auth.NewRepository(db)
		if err := authRepo.BootstrapSuperAdmin(context.Background(), bootstrapEmail); err != nil {
			log.Fatalf("failed to bootstrap super admin: %v", err)
		}
		log.Printf("bootstrap: %s is whitelisted as super_admin", bootstrapEmail)
	}

	issuanceQ := make(chan string, 256)
	mailQ := make(chan mail.MailJob, 256)

	store, err := storage.New(cfg.Storage)
	if err != nil {
		log.Fatalf("failed to init storage: %v", err)
	}
	if err := store.EnsureBuckets(context.Background()); err != nil {
		log.Fatalf("failed to ensure storage buckets: %v", err)
	}

	diskCache, err := issuance.NewDiskCache(cfg.Worker.CertCacheDir)
	if err != nil {
		log.Fatalf("failed to init cert disk cache: %v", err)
	}

	// server.New owns the issuance service; it returns it so the worker can
	// share the exact same instance (and disk cache).
	app, issuanceSvc, err := server.New(cfg, db, store, issuanceQ, mailQ, diskCache)
	if err != nil {
		log.Fatalf("failed to create server: %v", err)
	}

	chapterRepo := chapters.NewRepository(db)
	issuanceRepo := issuance.NewRepository(db)
	tmplRepo := templates.NewRepository(db)
	mailTemplateRepo := mail.NewTemplateRepository(db)

	oauthCreds := mail.OAuthCreds{
		GoogleClientID:        cfg.SMTPOAuth.GoogleClientID,
		GoogleClientSecret:    cfg.SMTPOAuth.GoogleClientSecret,
		MicrosoftClientID:     cfg.SMTPOAuth.MicrosoftClientID,
		MicrosoftClientSecret: cfg.SMTPOAuth.MicrosoftClientSecret,
	}

	w := worker.NewIssuanceWorker(db, issuanceQ, issuanceRepo, tmplRepo, chapterRepo, mailTemplateRepo, cfg.Worker, oauthCreds, cfg.PublicURL, cfg.FrontendURL, issuanceSvc, cfg.FallbackSMTP)
	workerCtx, workerCancel := context.WithCancel(context.Background())
	defer workerCancel()
	go w.Run(workerCtx)

mailWorker := worker.NewMailWorker(mailQ, chapterRepo, oauthCreds, cfg.Worker.MaxRetries, cfg.FallbackSMTP)
	go mailWorker.Run(workerCtx)

	go func() {
		addr := ":" + cfg.ServerPort
		log.Printf("server starting on %s", addr)
		if err := app.Listen(addr); err != nil {
			log.Fatalf("server error: %v", err)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	log.Println("shutting down server...")
	if err := app.ShutdownWithContext(ctx); err != nil {
		log.Printf("shutdown error: %v", err)
	}
	log.Println("server stopped")
}
