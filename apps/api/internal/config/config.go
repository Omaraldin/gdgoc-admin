package config

import (
	"fmt"
	"os"
	"strconv"
)

type Config struct {
	AppEnv      string
	ServerPort  string
	DatabaseURL string
	PublicURL   string // API_BASE_URL — used to build certificate render links in emails
	Storage     StorageConfig
	Kayan       KayanConfig
	Session     SessionConfig
	CORS        CORSConfig
	Worker      WorkerConfig
	SMTPOAuth   SMTPOAuthConfig
	DB          DBPoolConfig
	RateLimit   RateLimitConfig
}

// DBPoolConfig controls the PostgreSQL connection pool.
type DBPoolConfig struct {
	MaxOpenConns    int // DB_MAX_OPEN_CONNS   (default 25)
	MaxIdleConns    int // DB_MAX_IDLE_CONNS   (default 5)
	MaxLifetimeMins int // DB_MAX_LIFETIME_MINS (default 30)
}

// RateLimitConfig controls per-IP rate limits for auth and public endpoints.
type RateLimitConfig struct {
	AuthMax          int // RATE_LIMIT_AUTH_MAX            (default 10 requests)
	AuthWindowSecs   int // RATE_LIMIT_AUTH_WINDOW_SECS   (default 60 seconds)
	PublicMax        int // RATE_LIMIT_PUBLIC_MAX          (default 60 requests)
	PublicWindowSecs int // RATE_LIMIT_PUBLIC_WINDOW_SECS (default 60 seconds)
}

type StorageConfig struct {
	Driver       string // local | s3 | minio | cloudinary  (default: local)
	Endpoint     string // S3/MinIO endpoint
	AccessKey    string // S3 access key OR Cloudinary api_key
	SecretKey    string // S3 secret key OR Cloudinary api_secret
	CloudName    string // Cloudinary cloud name
	BucketAssets string
	BucketCerts  string
	UseSSL       bool
	LocalDir     string // base directory for local driver (default: ./data)
	PublicPrefix string // URL prefix for local driver (default: /files)
}

type KayanConfig struct {
	Issuer       string // Google OIDC issuer, e.g. https://accounts.google.com
	ClientID     string
	ClientSecret string
	RedirectURL  string
}

type SessionConfig struct {
	Secret           string
	AccessTokenHours int // default 1  — lifetime of the short-lived JWT access token
	MaxAgeHours      int // default 168 — lifetime of the long-lived JWT refresh token
}

type CORSConfig struct {
	AllowedOrigins string
}

type WorkerConfig struct {
	Concurrency int
	MaxRetries  int
}

// SMTPOAuthConfig holds the OAuth2 client credentials for Gmail and Outlook,
// plus the shared callback URL registered with both providers.
type SMTPOAuthConfig struct {
	GoogleClientID        string // SMTP_GOOGLE_CLIENT_ID
	GoogleClientSecret    string // SMTP_GOOGLE_CLIENT_SECRET
	MicrosoftClientID     string // SMTP_MICROSOFT_CLIENT_ID
	MicrosoftClientSecret string // SMTP_MICROSOFT_CLIENT_SECRET
	// CallbackURL is the URL registered with Google / Microsoft for the OAuth2
	// redirect. E.g. "https://api.example.com/api/v1/chapters/smtp/oauth/callback"
	CallbackURL string // SMTP_OAUTH_CALLBACK_URL
	// FrontendURL is the base URL to redirect to after the OAuth flow completes.
	// E.g. "https://admin.example.com"
	FrontendURL string // SMTP_OAUTH_FRONTEND_URL
	// StateSecret is used to HMAC-sign the OAuth2 state parameter to prevent
	// CSRF. Defaults to the session secret when left empty.
	StateSecret string
}

func Load() (*Config, error) {
	cfg := &Config{
		AppEnv:      getEnv("APP_ENV", "development"),
		ServerPort:  getEnv("SERVER_PORT", "8080"),
		DatabaseURL: mustEnv("DATABASE_URL"),
		PublicURL:   getEnv("API_BASE_URL", "http://localhost:8080"),
		Storage: StorageConfig{
			Driver:       getEnv("STORAGE_DRIVER", "local"),
			Endpoint:     getEnv("STORAGE_ENDPOINT", ""),
			AccessKey:    getEnv("STORAGE_ACCESS_KEY", ""),
			SecretKey:    getEnv("STORAGE_SECRET_KEY", ""),
			CloudName:    getEnv("STORAGE_CLOUDINARY_CLOUD_NAME", ""),
			BucketAssets: getEnv("STORAGE_BUCKET_ASSETS", "gdgoc-assets"),
			BucketCerts:  getEnv("STORAGE_BUCKET_CERTS", "gdgoc-certificates"),
			UseSSL:       getEnvBool("STORAGE_USE_SSL", false),
			LocalDir:     getEnv("STORAGE_LOCAL_DIR", "./data"),
			PublicPrefix: getEnv("STORAGE_PUBLIC_PREFIX", "/files"),
		},
		Kayan: KayanConfig{
			Issuer:       getEnv("KAYAN_ISSUER", "https://accounts.google.com"),
			ClientID:     mustEnv("KAYAN_CLIENT_ID"),
			ClientSecret: mustEnv("KAYAN_CLIENT_SECRET"),
			RedirectURL:  mustEnv("KAYAN_REDIRECT_URL"),
		},
		Session: SessionConfig{
			Secret:           mustEnv("SESSION_SECRET"),
			AccessTokenHours: getEnvInt("SESSION_ACCESS_TOKEN_HOURS", 1),
			MaxAgeHours:      getEnvInt("SESSION_MAX_AGE_HOURS", 168),
		},
		CORS: CORSConfig{
			AllowedOrigins: getEnv("CORS_ALLOWED_ORIGINS", "http://localhost:5173"),
		},
		Worker: WorkerConfig{
			Concurrency: getEnvInt("WORKER_CONCURRENCY", 5),
			MaxRetries:  getEnvInt("WORKER_MAX_RETRIES", 3),
		},
		DB: DBPoolConfig{
			MaxOpenConns:    getEnvInt("DB_MAX_OPEN_CONNS", 25),
			MaxIdleConns:    getEnvInt("DB_MAX_IDLE_CONNS", 5),
			MaxLifetimeMins: getEnvInt("DB_MAX_LIFETIME_MINS", 30),
		},
		RateLimit: RateLimitConfig{
			AuthMax:          getEnvInt("RATE_LIMIT_AUTH_MAX", 10),
			AuthWindowSecs:   getEnvInt("RATE_LIMIT_AUTH_WINDOW_SECS", 60),
			PublicMax:        getEnvInt("RATE_LIMIT_PUBLIC_MAX", 60),
			PublicWindowSecs: getEnvInt("RATE_LIMIT_PUBLIC_WINDOW_SECS", 60),
		},
		SMTPOAuth: SMTPOAuthConfig{
			GoogleClientID:        getEnv("SMTP_GOOGLE_CLIENT_ID", ""),
			GoogleClientSecret:    getEnv("SMTP_GOOGLE_CLIENT_SECRET", ""),
			MicrosoftClientID:     getEnv("SMTP_MICROSOFT_CLIENT_ID", ""),
			MicrosoftClientSecret: getEnv("SMTP_MICROSOFT_CLIENT_SECRET", ""),
			CallbackURL:           getEnv("SMTP_OAUTH_CALLBACK_URL", ""),
			FrontendURL:           getEnv("SMTP_OAUTH_FRONTEND_URL", ""),
		},
	}
	// Fall back to the session secret for signing OAuth state tokens.
	if cfg.SMTPOAuth.StateSecret == "" {
		cfg.SMTPOAuth.StateSecret = cfg.Session.Secret
	}

	// In production, enforce a strong SESSION_SECRET.
	const devSecret = "dev-session-secret-change-in-production-32chars"
	if cfg.AppEnv == "production" {
		if cfg.Session.Secret == devSecret || len(cfg.Session.Secret) < 32 {
			return nil, fmt.Errorf("SESSION_SECRET must be at least 32 characters and must not be the default dev value in production")
		}
	}

	return cfg, nil
}

func mustEnv(key string) string {
	v := os.Getenv(key)
	if v == "" {
		panic(fmt.Sprintf("required environment variable %s is not set", key))
	}
	return v
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func getEnvInt(key string, fallback int) int {
	if v := os.Getenv(key); v != "" {
		if i, err := strconv.Atoi(v); err == nil {
			return i
		}
	}
	return fallback
}

func getEnvBool(key string, fallback bool) bool {
	if v := os.Getenv(key); v != "" {
		b, err := strconv.ParseBool(v)
		if err == nil {
			return b
		}
	}
	return fallback
}
