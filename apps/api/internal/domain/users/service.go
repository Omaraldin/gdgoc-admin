package users

import (
	"context"

	"github.com/gdgoc/admin-api/internal/apperrors"
	"github.com/gdgoc/admin-api/internal/domain/auth"
)

type Service struct {
	repo *Repository
}

func NewService(repo *Repository) *Service {
	return &Service{repo: repo}
}

func (s *Service) List(ctx context.Context, chapterID *string) ([]*User, error) {
	return s.repo.List(ctx, chapterID)
}

func (s *Service) Get(ctx context.Context, id string) (*User, error) {
	return s.repo.GetByID(ctx, id)
}

func (s *Service) Update(ctx context.Context, id string, input UpdateUserInput) (*User, error) {
	if input.Role != nil && !auth.IsValidRole(*input.Role) {
		return nil, apperrors.BadRequest("invalid role")
	}
	return s.repo.Update(ctx, id, input)
}

func (s *Service) Delete(ctx context.Context, id string) error {
	return s.repo.Delete(ctx, id)
}

func (s *Service) ListWhitelist(ctx context.Context, chapterID *string) ([]*WhitelistEntry, error) {
	return s.repo.ListWhitelist(ctx, chapterID)
}

func (s *Service) AddToWhitelist(ctx context.Context, email, role, addedBy string, chapterID *string) (*WhitelistEntry, error) {
	if !auth.IsValidRole(role) {
		return nil, apperrors.BadRequest("invalid role")
	}
	return s.repo.AddToWhitelist(ctx, email, role, addedBy, chapterID)
}

func (s *Service) RemoveFromWhitelist(ctx context.Context, id string, callerChapterID *string) error {
	return s.repo.RemoveFromWhitelist(ctx, id, callerChapterID)
}
