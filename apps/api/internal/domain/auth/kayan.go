package auth

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"
	"time"

	kayanaudit "github.com/getkayan/kayan/core/audit"
	kayanconfig "github.com/getkayan/kayan/core/config"
	"github.com/getkayan/kayan/core/domain"
	"github.com/getkayan/kayan/core/flow"
	"github.com/getkayan/kayan/core/identity"
	"github.com/google/uuid"

	"github.com/gdgoc/admin-api/internal/config"
)

// KayanClient wraps Kayan's OIDCManager to handle Google OAuth via OIDC.
type KayanClient struct {
	mgr *flow.OIDCManager
}

// NewKayanClient initialises the Kayan OIDCManager for Google OIDC.
// It performs OIDC discovery against cfg.Issuer at startup.
func NewKayanClient(cfg config.KayanConfig, repo *Repository) (*KayanClient, error) {
	store := &kayanStorageAdapter{repo: repo}

	mgr, err := flow.NewOIDCManager(
		store,
		map[string]kayanconfig.OIDCProvider{
			"google": {
				Issuer:       cfg.Issuer,
				ClientID:     cfg.ClientID,
				ClientSecret: cfg.ClientSecret,
				RedirectURL:  cfg.RedirectURL,
			},
		},
		func() any { return &identity.Identity{} },
	)
	if err != nil {
		return nil, fmt.Errorf("kayan: init oidc manager: %w", err)
	}

	// Include sub, name, and picture alongside email.
	mgr.SetClaimMapper(func(claims map[string]any) identity.JSON {
		traits := map[string]any{
			"sub":     claims["sub"],
			"email":   claims["email"],
			"name":    claims["name"],
			"picture": claims["picture"],
		}
		b, _ := json.Marshal(traits)
		return identity.JSON(b)
	})

	mgr.SetIDGenerator(func() any { return uuid.NewString() })

	return &KayanClient{mgr: mgr}, nil
}

// AuthorizationURL returns the Google OIDC authorization URL with the state nonce.
func (k *KayanClient) AuthorizationURL(state string) string {
	url, _ := k.mgr.GetAuthURL("google", state)
	return url
}

// ExchangeCode exchanges an authorization code for a verified KayanIdentity.
// Kayan verifies the Google ID token signature and claims before returning.
func (k *KayanClient) ExchangeCode(ctx context.Context, code string) (*KayanIdentity, error) {
	ident, err := k.mgr.HandleCallback(ctx, "google", code)
	if err != nil {
		return nil, fmt.Errorf("kayan: oidc callback: %w", err)
	}

	i, ok := ident.(*identity.Identity)
	if !ok {
		return nil, errors.New("kayan: unexpected identity type returned")
	}

	var traits struct {
		Sub     string `json:"sub"`
		Email   string `json:"email"`
		Name    string `json:"name"`
		Picture string `json:"picture"`
	}
	if err := json.Unmarshal(i.Traits, &traits); err != nil {
		return nil, fmt.Errorf("kayan: parse identity traits: %w", err)
	}

	return &KayanIdentity{
		KayanID: traits.Sub,
		Email:   traits.Email,
		Name:    traits.Name,
		Picture: traits.Picture,
	}, nil
}

// KayanIdentity is the normalised identity returned after a successful OAuth login.
type KayanIdentity struct {
	KayanID string
	Email   string
	Name    string
	Picture string
}

// ---------------------------------------------------------------------------
// kayanStorageAdapter â€” bridges domain.Storage to our PostgreSQL schema.
//
// Methods called by OIDCManager.HandleCallback:
//   GetCredentialByIdentifier â†’ kayan_credentials table
//   FindIdentity              â†’ kayan_identities JOIN users
//   GetIdentity               â†’ kayan_identities
//   CreateIdentity            â†’ users (upsert) + kayan_identities + kayan_credentials
//   CreateCredential          â†’ kayan_credentials
//
// All other interface methods are no-ops because OIDCManager never invokes them.
// ---------------------------------------------------------------------------

type kayanStorageAdapter struct {
	repo *Repository
}

// ---- CredentialStorage ----

func (s *kayanStorageAdapter) GetCredentialByIdentifier(identifier, method string) (*identity.Credential, error) {
	var cred identity.Credential
	err := s.repo.db.Raw(`
		SELECT id, identity_id, type, identifier, created_at, updated_at
		FROM kayan_credentials
		WHERE identifier = ? AND type = ?
	`, identifier, method).Scan(&cred).Error
	if err != nil || cred.ID == "" {
		return nil, fmt.Errorf("credential not found")
	}
	return &cred, nil
}

func (s *kayanStorageAdapter) UpdateCredentialSecret(_ context.Context, _, _, _ string) error {
	return nil // OIDC credentials carry no secret
}

// ---- IdentityStorage ----

// CreateIdentity is called by OIDCManager on the first login for a Google account.
// It upserts into our canonical users table, then records the mapping in
// kayan_identities and persists any attached OIDC credentials.
func (s *kayanStorageAdapter) CreateIdentity(ident any) error {
	i, ok := ident.(*identity.Identity)
	if !ok {
		return errors.New("kayan storage: CreateIdentity: unexpected identity type")
	}

	var traits struct {
		Sub     string `json:"sub"`
		Email   string `json:"email"`
		Name    string `json:"name"`
		Picture string `json:"picture"`
	}
	json.Unmarshal(i.Traits, &traits) //nolint:errcheck â€” malformed traits handled below

	// Prefer the sub extracted from the OIDC credential identifier ("google:{sub}").
	kayanID := traits.Sub
	for _, cred := range i.Credentials {
		if cred.Type == "oidc" {
			if idx := strings.IndexByte(cred.Identifier, ':'); idx >= 0 {
				kayanID = cred.Identifier[idx+1:]
			}
			break
		}
	}

	// Upsert into the canonical users table.
	user, err := s.repo.UpsertUser(context.Background(), &KayanIdentity{
		KayanID: kayanID,
		Email:   traits.Email,
		Name:    traits.Name,
		Picture: traits.Picture,
	})
	if err != nil {
		return fmt.Errorf("kayan storage: upsert user: %w", err)
	}

	traitsJSON, _ := json.Marshal(traits)

	// Record the Kayan identity ID â†’ our user ID mapping.
	err = s.repo.db.Exec(`
		INSERT INTO kayan_identities (id, user_id, traits, state, created_at, updated_at)
		VALUES (?, ?, ?, 'active', NOW(), NOW())
		ON CONFLICT (id) DO UPDATE SET traits = EXCLUDED.traits, updated_at = NOW()
	`, i.ID, user.ID, traitsJSON).Error
	if err != nil {
		return fmt.Errorf("kayan storage: insert kayan_identities: %w", err)
	}

	// Persist OIDC credentials that were attached to the identity struct.
	for _, cred := range i.Credentials {
		credID := cred.ID
		if credID == "" {
			credID = uuid.NewString()
		}
		s.repo.db.Exec(`
			INSERT INTO kayan_credentials (id, identity_id, type, identifier, created_at, updated_at)
			VALUES (?, ?, ?, ?, NOW(), NOW())
			ON CONFLICT (identifier, type) DO NOTHING
		`, credID, i.ID, cred.Type, cred.Identifier)
	}

	return nil
}

func (s *kayanStorageAdapter) GetIdentity(factory func() any, id any) (any, error) {
	var row struct {
		ID     string
		Traits []byte
	}
	err := s.repo.db.Raw(`
		SELECT id, traits FROM kayan_identities WHERE id = ? AND deleted_at IS NULL
	`, fmt.Sprintf("%v", id)).Scan(&row).Error
	if err != nil || row.ID == "" {
		return nil, fmt.Errorf("kayan storage: get identity %v: not found", id)
	}
	return &identity.Identity{ID: row.ID, Traits: row.Traits}, nil
}

func (s *kayanStorageAdapter) FindIdentity(factory func() any, query map[string]any) (any, error) {
	email, _ := query["email"].(string)
	if email == "" {
		return nil, errors.New("kayan storage: FindIdentity: email required")
	}
	var row struct {
		ID     string
		Traits []byte
	}
	err := s.repo.db.Raw(`
		SELECT ki.id, ki.traits
		FROM kayan_identities ki
		JOIN users u ON u.id = ki.user_id
		WHERE u.email = ? AND ki.deleted_at IS NULL AND u.deleted_at IS NULL
		LIMIT 1
	`, email).Scan(&row).Error
	if err != nil || row.ID == "" {
		return nil, fmt.Errorf("kayan storage: find identity by email: not found")
	}
	return &identity.Identity{ID: row.ID, Traits: row.Traits}, nil
}

func (s *kayanStorageAdapter) ListIdentities(_ func() any, _, _ int) ([]any, error) {
	return nil, nil
}

func (s *kayanStorageAdapter) UpdateIdentity(ident any) error {
	i, ok := ident.(*identity.Identity)
	if !ok {
		return nil
	}
	return s.repo.db.Exec(`
		UPDATE kayan_identities SET traits = ?, updated_at = NOW() WHERE id = ?
	`, []byte(i.Traits), i.ID).Error
}

func (s *kayanStorageAdapter) DeleteIdentity(id any) error {
	return s.repo.db.Exec(`
		UPDATE kayan_identities SET deleted_at = NOW() WHERE id = ?
	`, fmt.Sprintf("%v", id)).Error
}

func (s *kayanStorageAdapter) CreateCredential(cred any) error {
	c, ok := cred.(*identity.Credential)
	if !ok {
		return nil
	}
	id := c.ID
	if id == "" {
		id = uuid.NewString()
	}
	return s.repo.db.Exec(`
		INSERT INTO kayan_credentials (id, identity_id, type, identifier, created_at, updated_at)
		VALUES (?, ?, ?, ?, NOW(), NOW())
		ON CONFLICT (identifier, type) DO NOTHING
	`, id, c.IdentityID, c.Type, c.Identifier).Error
}

// ---- SessionStorage â€” OIDCManager does not use these ----

func (s *kayanStorageAdapter) CreateSession(_ *identity.Session) error { return nil }
func (s *kayanStorageAdapter) GetSession(_ any) (*identity.Session, error) {
	return nil, errors.New("kayan storage: GetSession not supported")
}
func (s *kayanStorageAdapter) GetSessionByRefreshToken(_ string) (*identity.Session, error) {
	return nil, errors.New("kayan storage: GetSessionByRefreshToken not supported")
}
func (s *kayanStorageAdapter) DeleteSession(_ any) error { return nil }

// ---- audit.AuditStore â€” no-op ----

func (s *kayanStorageAdapter) SaveEvent(_ context.Context, _ *kayanaudit.AuditEvent) error {
	return nil
}
func (s *kayanStorageAdapter) Query(_ context.Context, _ kayanaudit.Filter) ([]kayanaudit.AuditEvent, error) {
	return nil, nil
}
func (s *kayanStorageAdapter) Count(_ context.Context, _ kayanaudit.Filter) (int64, error) {
	return 0, nil
}
func (s *kayanStorageAdapter) Export(_ context.Context, _ kayanaudit.Filter, _ kayanaudit.ExportFormat) (io.Reader, error) {
	return nil, errors.New("kayan storage: Export not supported")
}
func (s *kayanStorageAdapter) Purge(_ context.Context, _ time.Time) (int64, error) { return 0, nil }

// ---- domain.TokenStore â€” no-op ----

func (s *kayanStorageAdapter) SaveToken(_ context.Context, _ *domain.AuthToken) error { return nil }
func (s *kayanStorageAdapter) GetToken(_ context.Context, _ string) (*domain.AuthToken, error) {
	return nil, errors.New("kayan storage: GetToken not supported")
}
func (s *kayanStorageAdapter) DeleteToken(_ context.Context, _ string) error { return nil }
func (s *kayanStorageAdapter) DeleteExpiredTokens(_ context.Context) error   { return nil }
