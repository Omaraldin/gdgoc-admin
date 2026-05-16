package auth

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"time"

	kayanSession "github.com/getkayan/kayan/core/session"
	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"

	"github.com/gdgoc/admin-api/internal/apperrors"
	"github.com/gdgoc/admin-api/internal/config"
)

// SessionUser is the in-memory user representation stored in the request context.
type SessionUser struct {
	ID        string
	Email     string
	Name      string
	Role      string
	ChapterID string
}

// TokenPair holds the short-lived access token and the long-lived refresh token
// produced after a successful login or token refresh.
type TokenPair struct {
	AccessToken  string
	RefreshToken string
}

// Service handles authentication and session management.
type Service struct {
	cfg        *config.Config
	repo       *Repository
	kayan      *KayanClient
	sessionMgr *kayanSession.Manager
}

func NewService(cfg *config.Config, repo *Repository, kayan *KayanClient) *Service {
	accessExpiry := time.Duration(cfg.Session.AccessTokenHours) * time.Hour
	refreshExpiry := time.Duration(cfg.Session.MaxAgeHours) * time.Hour
	secret := []byte(cfg.Session.Secret)
	strategy := kayanSession.NewJWTStrategy(kayanSession.JWTConfig{
		SigningMethod:        jwt.SigningMethodHS256,
		SigningKey:           secret,
		VerifyingKey:         secret,
		Expiry:               accessExpiry,
		RefreshSigningMethod: jwt.SigningMethodHS256,
		RefreshSigningKey:    secret,
		RefreshVerifyingKey:  secret,
		RefreshExpiry:        refreshExpiry,
	})
	return &Service{
		cfg:        cfg,
		repo:       repo,
		kayan:      kayan,
		sessionMgr: kayanSession.NewManager(strategy),
	}
}

func (s *Service) LoginURL(ctx context.Context) (string, string, error) {
	state, err := generateToken(16)
	if err != nil {
		return "", "", fmt.Errorf("generate state: %w", err)
	}
	url := s.kayan.AuthorizationURL(state)
	return url, state, nil
}

func (s *Service) HandleCallback(ctx context.Context, code, state string) (*TokenPair, error) {
	identity, err := s.kayan.ExchangeCode(ctx, code)
	if err != nil {
		return nil, fmt.Errorf("exchange code: %w", err)
	}

	// check whitelist
	whitelisted, err := s.repo.IsWhitelisted(ctx, identity.Email)
	if err != nil {
		return nil, err
	}
	if !whitelisted {
		return nil, apperrors.Forbidden("your email is not whitelisted")
	}

	user, err := s.repo.UpsertUser(ctx, identity)
	if err != nil {
		return nil, fmt.Errorf("upsert user: %w", err)
	}

	sess, err := s.sessionMgr.Create(uuid.New().String(), user.ID)
	if err != nil {
		return nil, fmt.Errorf("create jwt session: %w", err)
	}

	return &TokenPair{AccessToken: sess.ID, RefreshToken: sess.RefreshToken}, nil
}

// ValidateSession verifies the access token JWT and returns the current user from the database.
func (s *Service) ValidateSession(ctx context.Context, token string) (*SessionUser, error) {
	sess, err := s.sessionMgr.Validate(token)
	if err != nil {
		return nil, apperrors.Unauthorized("invalid or expired session")
	}

	user, err := s.repo.GetUserByID(ctx, sess.IdentityID)
	if err != nil {
		return nil, apperrors.Unauthorized("user not found")
	}

	return &SessionUser{
		ID:        user.ID,
		Email:     user.Email,
		Name:      user.Name,
		Role:      user.Role,
		ChapterID: user.ChapterID,
	}, nil
}

// RefreshSession verifies the refresh token and issues a new rotated TokenPair.
func (s *Service) RefreshSession(_ context.Context, refreshToken string) (*TokenPair, error) {
	sess, err := s.sessionMgr.Refresh(refreshToken)
	if err != nil {
		return nil, apperrors.Unauthorized("invalid or expired refresh token")
	}
	return &TokenPair{AccessToken: sess.ID, RefreshToken: sess.RefreshToken}, nil
}

// RevokeSession is a no-op for JWT sessions (stateless).
func (s *Service) RevokeSession(_ context.Context, _ string) error {
	return nil
}

func generateToken(n int) (string, error) {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}
