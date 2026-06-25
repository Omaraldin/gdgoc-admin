package worker

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"sync"

	"github.com/gdgoc/admin-api/internal/config"
	"github.com/gdgoc/admin-api/internal/database"
	"github.com/gdgoc/admin-api/internal/domain/chapters"
	"github.com/gdgoc/admin-api/internal/domain/issuance"
	"github.com/gdgoc/admin-api/internal/domain/mail"
	"github.com/gdgoc/admin-api/internal/domain/templates"
)


type IssuanceWorker struct {
	db               *database.DB
	queue            <-chan string
	issuanceRepo     *issuance.Repository
	tmplRepo         *templates.Repository
	chapterRepo      *chapters.Repository
	mailTemplateRepo *mail.TemplateRepository
	cfg              config.WorkerConfig
	oauthCreds       mail.OAuthCreds
	publicURL        string
	frontendURL      string
	certSvc          *issuance.Service // used to pre-render and attach the certificate PNG in emails
	fallbackSMTP     config.FallbackSMTPConfig
}

func NewIssuanceWorker(
	db *database.DB,
	queue <-chan string,
	issuanceRepo *issuance.Repository,
	tmplRepo *templates.Repository,
	chapterRepo *chapters.Repository,
	mailTemplateRepo *mail.TemplateRepository,
	cfg config.WorkerConfig,
	oauthCreds mail.OAuthCreds,
	publicURL string,
	frontendURL string,
	certSvc *issuance.Service,
	fallbackSMTP config.FallbackSMTPConfig,
) *IssuanceWorker {
	return &IssuanceWorker{
		db:               db,
		queue:            queue,
		issuanceRepo:     issuanceRepo,
		tmplRepo:         tmplRepo,
		chapterRepo:      chapterRepo,
		mailTemplateRepo: mailTemplateRepo,
		cfg:              cfg,
		oauthCreds:       oauthCreds,
		publicURL:        publicURL,
		frontendURL:      frontendURL,
		certSvc:          certSvc,
		fallbackSMTP:     fallbackSMTP,
	}
}

func (w *IssuanceWorker) Run(ctx context.Context) {
	sem := make(chan struct{}, w.cfg.Concurrency)
	var wg sync.WaitGroup

	log.Println("issuance worker started")
	for {
		var batchID string
		select {
		case batchID = <-w.queue:
		case <-ctx.Done():
			wg.Wait()
			log.Println("issuance worker stopped")
			return
		}
		payload := `{"batch_id":"` + batchID + `"}`
		sem <- struct{}{}
		wg.Add(1)
		go func(p string) {
			defer func() {
				<-sem
				wg.Done()
			}()
			if err := w.processJob(ctx, p); err != nil {
				log.Printf("issuance job error: %v", err)
			}
		}(payload)
	}
}

type jobPayload struct {
	BatchID string `json:"batch_id"`
}

func (w *IssuanceWorker) processJob(ctx context.Context, payload string) error {
	var job jobPayload
	if err := json.Unmarshal([]byte(payload), &job); err != nil {
		return fmt.Errorf("unmarshal job: %w", err)
	}

	batch, err := w.issuanceRepo.GetBatch(ctx, job.BatchID)
	if err != nil {
		return fmt.Errorf("get batch: %w", err)
	}

	if batch.Status == "cancelled" {
		return nil
	}

	// Mark batch as processing
	if err = w.db.Gorm.WithContext(ctx).Exec(
		`UPDATE issuance_batches SET status = 'processing', updated_at = NOW() WHERE id = ?`, batch.ID,
	).Error; err != nil {
		return err
	}

	recipients, err := w.issuanceRepo.ListRecipients(ctx, batch.ID)
	if err != nil {
		return err
	}

	version, err := w.tmplRepo.GetVersion(ctx, batch.TemplateVersionID)
	if err != nil {
		return fmt.Errorf("get template version: %w", err)
	}

	// Resolve SMTP once for the whole batch (probes the connection).
	// If the batch doesn't need mail, skip to avoid a needless network round-trip.
	var smtpCfg *mail.SMTPConfig
	if batch.SendMail {
		smtpCfg, err = resolveSMTPConfig(ctx, w.chapterRepo, batch.ChapterID, w.fallbackSMTP, w.oauthCreds)
		if err != nil {
			log.Printf("batch %s: cannot resolve SMTP, mail will be skipped: %v", batch.ID, err)
			// Non-fatal: certificates will still be rendered.
		}
	}

	successCount, failedCount := 0, 0
	for _, rec := range recipients {
		if rec.Status != "queued" {
			continue
		}
		if err := w.renderRecipient(ctx, batch, rec, version, smtpCfg); err != nil {
			log.Printf("render failed for recipient %s: %v", rec.ID, err)
			failedCount++
			reason := err.Error()
			w.db.Gorm.WithContext(ctx).Exec(
				`UPDATE issuance_recipients SET status = 'failed', failure_reason = ?, updated_at = NOW() WHERE id = ?`,
				reason, rec.ID)
		} else {
			successCount++
		}
	}

	finalStatus := "completed"
	if failedCount > 0 && successCount == 0 {
		finalStatus = "failed"
	}

	err = w.db.Gorm.WithContext(ctx).Exec(`
		UPDATE issuance_batches
		SET status = ?, success_count = ?, failed_count = ?, updated_at = NOW()
		WHERE id = ?
	`, finalStatus, successCount, failedCount, batch.ID).Error
	return err
}

func (w *IssuanceWorker) renderRecipient(
	ctx context.Context,
	batch *issuance.IssuanceBatch,
	rec *issuance.BatchRecipient,
	version *templates.TemplateVersion,
	smtpCfg *mail.SMTPConfig,
) error {
	// Mark as rendering
	w.db.Gorm.WithContext(ctx).Exec(
		`UPDATE issuance_recipients SET status = 'rendering', updated_at = NOW() WHERE id = ?`, rec.ID)

	// Validate the scene is parseable before marking as rendered.
	var scene templates.SceneDefinition
	if err := json.Unmarshal(version.Scene, &scene); err != nil {
		return fmt.Errorf("unmarshal scene: %w", err)
	}

	// Mark as rendered — actual image rendering happens on demand via the
	// /certificates/:id/render endpoint with in-memory caching.
	w.db.Gorm.WithContext(ctx).Exec(
		`UPDATE issuance_recipients SET status = 'rendered', updated_at = NOW() WHERE id = ?`, rec.ID)

	if batch.SendMail && smtpCfg != nil {
		if err := w.sendCertificateMail(ctx, batch, rec, smtpCfg); err != nil {
			log.Printf("send mail failed for recipient %s: %v", rec.ID, err)
			// Mail failure is non-fatal — certificate is rendered; mark as rendered
		} else {
			w.db.Gorm.WithContext(ctx).Exec(
				`UPDATE issuance_recipients SET status = 'emailed', updated_at = NOW() WHERE id = ?`,
				rec.ID)
		}
	}

	return nil
}

func (w *IssuanceWorker) sendCertificateMail(
	ctx context.Context,
	batch *issuance.IssuanceBatch,
	rec *issuance.BatchRecipient,
	smtpCfg *mail.SMTPConfig,
) error {
	pdfURL := fmt.Sprintf("%s/api/v1/certificates/%s/render?format=pdf", w.publicURL, rec.ID)
	// cert.verify_url points to the frontend verify page (human-readable link in emails).
	// The OG share endpoint is on the API; only the LinkedIn crawler needs that.
	verifyURL := fmt.Sprintf("%s/verify/%s", w.frontendURL, rec.ID)

	if batch.MailTemplateID != nil && *batch.MailTemplateID != "" && w.mailTemplateRepo != nil {
		tmpl, err := w.mailTemplateRepo.Get(ctx, *batch.MailTemplateID, batch.ChapterID)
		if err != nil {
			log.Printf("sendCertificateMail: load mail template %s: %v — falling back to default", *batch.MailTemplateID, err)
		} else {
			// Build variable map.
			// Layer 1: per-recipient variables (with global.* aliases for mail templates).
			mailVars := make(map[string]string, (len(rec.Variables)+len(batch.MailVariables)+8)*2)
			for k, v := range rec.Variables {
				mailVars[k] = v
				mailVars["global."+k] = v // also accessible as {{global.key}}
			}
			// System variables
			mailVars["cert.id"] = rec.ID
			mailVars["cert.pdf_url"] = pdfURL
			mailVars["cert.verify_url"] = verifyURL

			mailVars["batch.name"] = batch.Name
			mailVars["batch.cert_name"] = batch.CertName
			mailVars["batch.cert_description"] = batch.CertDescription

			// Add chapter-scoped variables so {{chapter.name}} etc. work in mail templates.
			if ch, err := w.chapterRepo.GetByID(ctx, batch.ChapterID); err == nil {
				mailVars["chapter.name"] = ch.Name
				mailVars["chapter.code"] = ch.Code
				mailVars["chapter.leader_codename"] = ch.LeaderCodename
				if ch.SinceYear != nil {
					mailVars["chapter.since"] = fmt.Sprintf("%d", *ch.SinceYear)
				}
				leaderID := ""
				if ch.LeaderID != nil {
					leaderID = *ch.LeaderID
				}
				mailVars["chapter.leader"] = w.chapterRepo.GetLeaderName(ctx, leaderID)
			}
			// Layer 2: batch-level mail variable overrides.
			// Values may be {{key}} references — resolve them against layer-1 vars first
			// so a mapping like role→{{global.role}} resolves to the actual recipient value.
			for k, v := range batch.MailVariables {
				resolved := Interpolate(v, mailVars)
				mailVars[k] = resolved
				mailVars["global."+k] = resolved // also accessible as {{global.key}}
			}
			subject := Interpolate(tmpl.Subject, mailVars)
			body := Interpolate(tmpl.Body, mailVars)
			return mail.SendMailWithAttachments(rec.Email, subject, body, true, *smtpCfg, w.oauthCreds, w.renderAttachment(ctx, rec.ID))
		}
	}

	// Default fallback when no mail template is configured
	displayName := batch.CertName
	if displayName == "" {
		displayName = batch.Name
	}
	subject := fmt.Sprintf("Your certificate from %s", displayName)
	body := fmt.Sprintf(
		"<p>Congratulations!</p>"+
			"<p>Your certificate for <strong>%s</strong> is ready.</p>"+
			"<p><a href=\""+pdfURL+"\">Download your certificate (PDF)</a></p>",
		displayName,
	)
	return mail.SendMailWithAttachments(rec.Email, subject, body, true, *smtpCfg, w.oauthCreds, w.renderAttachment(ctx, rec.ID))
}

// renderAttachment renders the certificate PNG for the given recipient and
// returns it as a mail attachment. Returns nil on any error so that a failed
// render does not prevent the email from being sent.
func (w *IssuanceWorker) renderAttachment(ctx context.Context, recipientID string) []mail.MailAttachment {
	if w.certSvc == nil {
		return nil
	}
	data, _, err := w.certSvc.RenderCertificate(ctx, recipientID, "png")
	if err != nil {
		log.Printf("renderAttachment: render png for %s: %v", recipientID, err)
		return nil
	}
	return []mail.MailAttachment{{
		Filename:    recipientID + ".png",
		ContentType: "image/png",
		Data:        data,
	}}
}
