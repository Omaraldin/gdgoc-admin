package mail

import (
	"context"
	"fmt"
	"time"

	"github.com/gdgoc/admin-api/internal/apperrors"
	"github.com/gdgoc/admin-api/internal/domain/auth"
	"github.com/gdgoc/admin-api/internal/middleware"
	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
)

type SendMailInput struct {
	To      []string `json:"to"`
	Subject string   `json:"subject"`
	Body    string   `json:"body"`
	IsHTML  bool     `json:"is_html"`
}

type MailJob struct {
	ID        string        `json:"id"`
	ChapterID string        `json:"chapter_id"`
	Input     SendMailInput `json:"input"`
	CreatedAt time.Time     `json:"created_at"`
}

type Service struct {
	queue chan<- MailJob
}

func NewService(queue chan<- MailJob) *Service {
	return &Service{queue: queue}
}

func (s *Service) Send(ctx context.Context, input SendMailInput, chapterID string) (string, error) {
	if len(input.To) == 0 || input.Subject == "" || input.Body == "" {
		return "", apperrors.BadRequest("to, subject and body are required")
	}

	job := MailJob{
		ID:        uuid.New().String(),
		ChapterID: chapterID,
		Input:     input,
		CreatedAt: time.Now(),
	}
	fmt.Println(input.Body)
	select {
	case s.queue <- job:
	case <-ctx.Done():
		return "", fmt.Errorf("enqueue mail job: context cancelled")
	}
	return job.ID, nil
}

type Handler struct {
	svc       *Service
	checkSMTP func(ctx context.Context, chapterID string) error
}

func NewHandler(svc *Service, checkSMTP func(ctx context.Context, chapterID string) error) *Handler {
	return &Handler{svc: svc, checkSMTP: checkSMTP}
}

func (h *Handler) Send(c *fiber.Ctx) error {
	var input SendMailInput
	if err := c.BodyParser(&input); err != nil {
		return apperrors.BadRequest("invalid request body")
	}
	caller := c.Locals(middleware.ContextKeyUser).(*auth.SessionUser)

	// Validate SMTP is configured before queuing — fail fast with a clear error.
	if err := h.checkSMTP(c.Context(), caller.ChapterID); err != nil {
		return fiber.NewError(fiber.StatusUnprocessableEntity, err.Error())
	}

	jobID, err := h.svc.Send(c.Context(), input, caller.ChapterID)
	if err != nil {
		return err
	}
	return c.Status(fiber.StatusAccepted).JSON(fiber.Map{"job_id": jobID, "message": "mail queued"})
}

func (h *Handler) History(c *fiber.Ctx) error {
	// Stub: implement mail_jobs table and query when needed
	return c.JSON([]fiber.Map{})
}
