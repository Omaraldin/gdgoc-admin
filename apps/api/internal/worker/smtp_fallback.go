package worker

import (
	"context"
	"fmt"
	"log"

	"github.com/gdgoc/admin-api/internal/config"
	"github.com/gdgoc/admin-api/internal/domain/chapters"
	"github.com/gdgoc/admin-api/internal/domain/mail"
)

// fallbackSMTPConfig builds the system-level fallback mail.SMTPConfig from env.
// Returns nil when the fallback is not configured.
func fallbackSMTPCfg(fb config.FallbackSMTPConfig) *mail.SMTPConfig {
	if fb.Email == "" || fb.Password == "" {
		return nil
	}
	return &mail.SMTPConfig{
		Provider:  "manual",
		FromEmail: fb.Email,
		Host:      "smtp.gmail.com",
		Port:      587,
		Username:  fb.Email,
		Password:  fb.Password,
	}
}

// resolveSMTPConfig returns the best available SMTP config for a chapter:
//  1. Chapter's own config — probed to confirm it is working right now.
//  2. System fallback — used when the chapter has no config OR the probe fails.
//
// Probing is done once here so callers can send all emails for a batch/job
// without per-message failures triggering 50 fallbacks for 50 recipients.
// Returns an error only when both the chapter config and the fallback are unavailable.
func resolveSMTPConfig(ctx context.Context, chapterRepo *chapters.Repository, chapterID string, fb config.FallbackSMTPConfig, oauthCreds mail.OAuthCreds) (*mail.SMTPConfig, error) {
	cfg, err := chapterRepo.GetSMTPConfig(ctx, chapterID)
	if err == nil {
		// Config loaded — probe it to catch expired tokens / unreachable servers.
		if probeErr := mail.ProbeConnection(*cfg, oauthCreds); probeErr != nil {
			log.Printf("smtp probe failed for chapter %s (%v) — trying fallback", chapterID, probeErr)
		} else {
			return cfg, nil
		}
	} else {
		log.Printf("smtp: chapter %s has no config (%v) — trying fallback", chapterID, err)
	}

	fb_cfg := fallbackSMTPCfg(fb)
	if fb_cfg == nil {
		return nil, fmt.Errorf("chapter %s: no SMTP config and no fallback is set", chapterID)
	}

	// Probe the fallback too so we fail fast instead of attempting all sends.
	if probeErr := mail.ProbeConnection(*fb_cfg, oauthCreds); probeErr != nil {
		return nil, fmt.Errorf("chapter %s: primary SMTP unavailable and fallback probe failed: %w", chapterID, probeErr)
	}

	// Populate a display name so the From header reads "Chapter Name <fallback@gmail.com>"
	// instead of a bare email address, which looks automated to spam filters.
	if ch, err := chapterRepo.GetByID(ctx, chapterID); err == nil && ch.Name != "" {
		fb_cfg.ChapterName = ch.Name
	}

	log.Printf("smtp: using fallback account %s for chapter %s", fb_cfg.FromEmail, chapterID)
	return fb_cfg, nil
}
