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

func (s *Service) List(ctx context.Context) ([]*User, error) {
	return s.repo.List(ctx)
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

func (s *Service) ListWhitelist(ctx context.Context) ([]*WhitelistEntry, error) {
	return s.repo.ListWhitelist(ctx)
}

func (s *Service) AddToWhitelist(ctx context.Context, email string, addedBy string) (*WhitelistEntry, error) {
	return s.repo.AddToWhitelist(ctx, email, addedBy)
}

func (s *Service) RemoveFromWhitelist(ctx context.Context, id string) error {
	return s.repo.RemoveFromWhitelist(ctx, id)
}
