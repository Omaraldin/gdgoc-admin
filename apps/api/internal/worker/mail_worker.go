package worker

import (
	"context"
	"log"
	"time"

	"github.com/gdgoc/admin-api/internal/config"
	"github.com/gdgoc/admin-api/internal/domain/chapters"
	"github.com/gdgoc/admin-api/internal/domain/mail"
)

// MailWorker processes queued mail jobs, sending each one via the chapter's
// configured SMTP provider (Gmail OAuth2, Outlook OAuth2, or manual SMTP).
type MailWorker struct {
	queue        <-chan mail.MailJob
	chapterRepo  *chapters.Repository
	oauthCreds   mail.OAuthCreds
	maxRetries   int
	fallbackSMTP config.FallbackSMTPConfig
}

func NewMailWorker(queue <-chan mail.MailJob, chapterRepo *chapters.Repository, oauthCreds mail.OAuthCreds, maxRetries int, fallbackSMTP config.FallbackSMTPConfig) *MailWorker {
	return &MailWorker{queue: queue, chapterRepo: chapterRepo, oauthCreds: oauthCreds, maxRetries: maxRetries, fallbackSMTP: fallbackSMTP}
}

func (w *MailWorker) Run(ctx context.Context) {
	log.Println("mail worker started")
	for {
		select {
		case <-ctx.Done():
			log.Println("mail worker stopped")
			return
		case job := <-w.queue:
			if err := w.processJob(ctx, job); err != nil {
				log.Printf("mail worker: job %s failed: %v", job.ID, err)
			}
		}
	}
}

func (w *MailWorker) processJob(ctx context.Context, job mail.MailJob) error {
	smtpCfg, err := resolveSMTPConfig(ctx, w.chapterRepo, job.ChapterID, w.fallbackSMTP, w.oauthCreds)
	if err != nil {
		return err
	}

	for _, to := range job.Input.To {
		var lastErr error
		for attempt := 0; attempt <= w.maxRetries; attempt++ {
			if attempt > 0 {
				wait := time.Duration(1<<uint(attempt-1)) * time.Second
				select {
				case <-time.After(wait):
				case <-ctx.Done():
					return ctx.Err()
				}
			}
			lastErr = mail.SendMail(to, job.Input.Subject, job.Input.Body, job.Input.IsHTML, *smtpCfg, w.oauthCreds)
			if lastErr == nil {
				break
			}
			log.Printf("mail worker: send to %s attempt %d/%d failed: %v", to, attempt+1, w.maxRetries+1, lastErr)
		}
		if lastErr != nil {
			log.Printf("mail worker: giving up on %s after %d attempt(s): %v", to, w.maxRetries+1, lastErr)
		}
	}
	return nil
}
