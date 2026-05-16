package chapters

import (
	"context"
	"fmt"
	"mime/multipart"
	"path/filepath"
	"strings"

	"github.com/gdgoc/admin-api/internal/domain/mail"
	"github.com/gdgoc/admin-api/internal/domain/users"
	"github.com/gdgoc/admin-api/internal/storage"
)

type Service struct {
	repo     *Repository
	userRepo *users.Repository
	storage  storage.Backend
}

func NewService(repo *Repository, userRepo *users.Repository, store storage.Backend) *Service {
	return &Service{repo: repo, userRepo: userRepo, storage: store}
}

func (s *Service) List(ctx context.Context) ([]*Chapter, error) {
	return s.repo.List(ctx)
}

func (s *Service) Get(ctx context.Context, id string) (*Chapter, error) {
	return s.repo.GetByID(ctx, id)
}

func (s *Service) Create(ctx context.Context, input CreateChapterInput) (*Chapter, error) {
	return s.repo.Create(ctx, input)
}

func (s *Service) Update(ctx context.Context, id string, input UpdateChapterInput) (*Chapter, error) {
	return s.repo.Update(ctx, id, input)
}

// UpdateSMTPPassword updates only the smtp_password for a chapter.
// It is accessible to the chapter's own leader (no super_admin required).
func (s *Service) UpdateSMTPPassword(ctx context.Context, chapterID, password string) (*Chapter, error) {
	return s.repo.Update(ctx, chapterID, UpdateChapterInput{SmtpPassword: &password})
}

// GetSMTPConfig returns the current SMTP sending configuration for a chapter.
func (s *Service) GetSMTPConfig(ctx context.Context, chapterID string) (*mail.SMTPConfig, error) {
	return s.repo.GetSMTPConfig(ctx, chapterID)
}

// SaveOAuthConnection persists the OAuth2 refresh token returned after the
// consent flow and records the authorized email as the From address.
func (s *Service) SaveOAuthConnection(ctx context.Context, chapterID, provider, fromEmail, refreshToken string) error {
	return s.repo.SaveOAuthConnection(ctx, chapterID, provider, fromEmail, refreshToken)
}

// UpdateManualSMTP configures a chapter to send mail via a custom SMTP server.
func (s *Service) UpdateManualSMTP(ctx context.Context, chapterID string, input ManualSMTPInput) error {
	return s.repo.UpdateManualSMTP(ctx, chapterID, input)
}

// DisconnectSMTP clears all SMTP credentials for a chapter.
func (s *Service) DisconnectSMTP(ctx context.Context, chapterID string) error {
	return s.repo.DisconnectSMTP(ctx, chapterID)
}

func (s *Service) Delete(ctx context.Context, id string) error {
	return s.repo.Delete(ctx, id)
}

func (s *Service) AssignLeader(ctx context.Context, chapterID, userID string) error {
	// Verify user exists before assignment
	if _, err := s.userRepo.GetByID(ctx, userID); err != nil {
		return err
	}
	return s.repo.AssignLeader(ctx, chapterID, userID)
}

func (s *Service) UploadProfilePicture(ctx context.Context, chapterID string, fh *multipart.FileHeader) (*Chapter, error) {
	if _, err := s.repo.GetByID(ctx, chapterID); err != nil {
		return nil, err
	}

	f, err := fh.Open()
	if err != nil {
		return nil, fmt.Errorf("open uploaded file: %w", err)
	}
	defer f.Close()

	ext := strings.ToLower(filepath.Ext(fh.Filename))
	allowed := map[string]string{".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp"}
	mime, ok := allowed[ext]
	if !ok {
		return nil, fmt.Errorf("unsupported file type; use PNG, JPEG, or WebP")
	}

	objectKey := fmt.Sprintf("chapters/%s/profile%s", chapterID, ext)
	url, err := s.storage.UploadAsset(ctx, objectKey, f, fh.Size, mime)
	if err != nil {
		return nil, fmt.Errorf("upload profile picture: %w", err)
	}
	if url == "" {
		url = s.storage.GetAssetURL(objectKey)
	}

	return s.repo.UpdateProfilePicture(ctx, chapterID, url)
}
