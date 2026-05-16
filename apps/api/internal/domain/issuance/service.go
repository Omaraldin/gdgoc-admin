package issuance

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"image"
	"image/png"
	"io"
	"sync"

	"github.com/gdgoc/admin-api/internal/apperrors"
	"github.com/gdgoc/admin-api/internal/config"
	"github.com/gdgoc/admin-api/internal/domain/auth"
	"github.com/gdgoc/admin-api/internal/domain/chapters"
	"github.com/gdgoc/admin-api/internal/domain/templates"
)

// Renderer is the interface satisfied by worker.ImageRenderer.
// Defined here to avoid a circular import between issuance and worker packages.
type Renderer interface {
	Render(ctx context.Context, scene templates.SceneDefinition, vars map[string]string) (image.Image, error)
}

// PDFEncoder converts a rendered image into raw PDF bytes.
type PDFEncoder func(img image.Image) ([]byte, error)

// certCacheEntry stores rendered certificate bytes with a singleflight-style
// sync.Once so concurrent requests for the same cert only trigger one render.
type certCacheEntry struct {
	once sync.Once
	data []byte
	err  error
}

type Service struct {
	repo        *Repository
	tmplRepo    *templates.Repository
	chapterRepo *chapters.Repository
	queue       chan<- string
	workerCfg   config.WorkerConfig
	renderer    Renderer
	pdfEncoder  PDFEncoder
	publicURL   string
	cache       sync.Map // key: recipientID+":"+format → *certCacheEntry
}

func NewService(
	repo *Repository,
	tmplRepo *templates.Repository,
	chapterRepo *chapters.Repository,
	queue chan<- string,
	workerCfg config.WorkerConfig,
	renderer Renderer,
	pdfEncoder PDFEncoder,
	publicURL string,
) *Service {
	return &Service{
		repo:        repo,
		tmplRepo:    tmplRepo,
		chapterRepo: chapterRepo,
		queue:       queue,
		workerCfg:   workerCfg,
		renderer:    renderer,
		pdfEncoder:  pdfEncoder,
		publicURL:   publicURL,
	}
}

// CertRenderURL returns the public URL for rendering a recipient's certificate.
func (s *Service) CertRenderURL(recipientID, format string) string {
	return fmt.Sprintf("%s/api/v1/certificates/%s/render?format=%s", s.publicURL, recipientID, format)
}

// RenderCertificate renders (or returns a cached render of) a recipient's
// certificate in the requested format ("png" or "pdf").
func (s *Service) RenderCertificate(ctx context.Context, recipientID, format string) ([]byte, string, error) {
	if format != "pdf" {
		format = "png"
	}

	key := recipientID + ":" + format
	entry := &certCacheEntry{}
	actual, loaded := s.cache.LoadOrStore(key, entry)
	e := actual.(*certCacheEntry)
	if !loaded {
		// We won the race — compute the render.
		e.once.Do(func() {
			e.data, e.err = s.renderCertBytes(ctx, recipientID, format)
			if e.err != nil {
				// Remove failed entry so callers can retry.
				s.cache.Delete(key)
			}
		})
	} else {
		// Another goroutine may be computing — wait for it.
		e.once.Do(func() {}) // no-op if already done; blocks if still running
	}
	if e.err != nil {
		return nil, "", e.err
	}
	contentType := "image/png"
	if format == "pdf" {
		contentType = "application/pdf"
	}
	return e.data, contentType, nil
}

func (s *Service) renderCertBytes(ctx context.Context, recipientID, format string) ([]byte, error) {
	rec, err := s.fetchCertificate(ctx, recipientID)
	if err != nil {
		return nil, err
	}

	batch, err := s.repo.GetBatch(ctx, rec.BatchID)
	if err != nil {
		return nil, fmt.Errorf("get batch: %w", err)
	}

	version, err := s.tmplRepo.GetVersion(ctx, batch.TemplateVersionID)
	if err != nil {
		return nil, fmt.Errorf("get template version: %w", err)
	}

	var scene templates.SceneDefinition
	if err := json.Unmarshal(version.Scene, &scene); err != nil {
		return nil, fmt.Errorf("parse scene: %w", err)
	}

	if batch.IsPrintable {
		scene = templates.MapSceneColorsPrintable(scene)
	}

	// Build vars: recipient-supplied values are the base; system auto-fill
	// variables are set last so they cannot be overridden by recipients.
	vars := make(map[string]string, len(rec.Variables)+4)
	for k, v := range rec.Variables {
		vars[k] = v
	}
	vars["cert.id"] = rec.ID

	chapter, err := s.chapterRepo.GetByID(ctx, batch.ChapterID)
	if err == nil {
		vars["chapter.name"] = chapter.Name
		vars["chapter.leader_codename"] = chapter.LeaderCodename
		vars["chapter.code"] = chapter.Code
		if chapter.SinceYear != nil {
			vars["chapter.since"] = fmt.Sprintf("%d", *chapter.SinceYear)
		}
		leaderID := ""
		if chapter.LeaderID != nil {
			leaderID = *chapter.LeaderID
		}
		vars["chapter.leader"] = s.chapterRepo.GetLeaderName(ctx, leaderID)
	}

	img, err := s.renderer.Render(ctx, scene, vars)
	if err != nil {
		return nil, fmt.Errorf("render: %w", err)
	}

	if format == "pdf" {
		return s.pdfEncoder(img)
	}

	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		return nil, fmt.Errorf("png encode: %w", err)
	}
	return buf.Bytes(), nil
}

func (s *Service) CreateBatch(ctx context.Context, input CreateBatchInput, caller *auth.SessionUser) (*IssuanceBatch, error) {
	if len(input.Recipients) == 0 {
		return nil, apperrors.BadRequest("at least one recipient is required")
	}

	tmpl, err := s.tmplRepo.GetByID(ctx, input.TemplateID)
	if err != nil {
		return nil, err
	}

	// Chapter scoping: chapter leaders can only issue for their own chapter
	if !auth.IsSuperAdmin(caller.Role) && tmpl.OwnerChapterID != caller.ChapterID {
		// They may use a public template but must issue under their own chapter
		// The batch will be scoped to their chapter
	}

	if tmpl.CurrentVersionID == nil {
		return nil, apperrors.BadRequest("template has no published version")
	}

	batch, err := s.repo.CreateBatch(ctx, input, caller.ChapterID, caller.ID, *tmpl.CurrentVersionID)
	if err != nil {
		return nil, err
	}

	// Enqueue the batch for async processing
	select {
	case s.queue <- batch.ID:
	default:
		// Non-fatal: batch is created, worker will pick it up when queue drains
		fmt.Printf("warn: issuance queue full, batch %s will process after backlog clears\n", batch.ID)
	}

	return batch, nil
}

func (s *Service) ListBatches(ctx context.Context, caller *auth.SessionUser) ([]*IssuanceBatch, error) {
	if auth.IsSuperAdmin(caller.Role) {
		return s.repo.ListAllBatches(ctx)
	}
	return s.repo.ListBatches(ctx, caller.ChapterID)
}

func (s *Service) GetBatch(ctx context.Context, id string, caller *auth.SessionUser) (*IssuanceBatch, error) {
	batch, err := s.repo.GetBatch(ctx, id)
	if err != nil {
		return nil, err
	}
	if !auth.IsSuperAdmin(caller.Role) && batch.ChapterID != caller.ChapterID {
		return nil, apperrors.Forbidden("access denied")
	}
	return batch, nil
}

func (s *Service) ListRecipients(ctx context.Context, batchID string, caller *auth.SessionUser) ([]*BatchRecipient, error) {
	if _, err := s.GetBatch(ctx, batchID, caller); err != nil {
		return nil, err
	}
	return s.repo.ListRecipients(ctx, batchID)
}

func (s *Service) GetProgress(ctx context.Context, batchID string, caller *auth.SessionUser) (*BatchProgress, error) {
	if _, err := s.GetBatch(ctx, batchID, caller); err != nil {
		return nil, err
	}
	return s.repo.GetProgress(ctx, batchID)
}

func (s *Service) CancelBatch(ctx context.Context, batchID string, caller *auth.SessionUser) error {
	if _, err := s.GetBatch(ctx, batchID, caller); err != nil {
		return err
	}
	return s.repo.CancelBatch(ctx, batchID)
}

func (s *Service) GetCertificate(ctx context.Context, recipientID string, caller *auth.SessionUser) (*BatchRecipient, error) {
	rec, err := s.fetchCertificate(ctx, recipientID)
	if err != nil {
		return nil, err
	}
	batch, err := s.repo.GetBatch(ctx, rec.BatchID)
	if err != nil {
		return nil, err
	}
	if !auth.IsSuperAdmin(caller.Role) && batch.ChapterID != caller.ChapterID {
		return nil, apperrors.Forbidden("access denied")
	}
	return rec, nil
}

// fetchCertificate retrieves a certificate record without authorization checks.
// Used internally by the public render path and RevokeCertificate.
func (s *Service) fetchCertificate(ctx context.Context, recipientID string) (*BatchRecipient, error) {
	type row struct {
		ID            string
		BatchID       string
		Email         string
		Variables     []byte
		Scripts       []byte
		Status        string
		PDFObjectKey  *string
		PNGObjectKey  *string
		FailureReason *string
	}
	var r row
	err := s.repo.db.WithContext(ctx).Raw(`
		SELECT id, batch_id, email, variables, scripts, status,
		       pdf_object_key, png_object_key, failure_reason
		FROM issuance_recipients WHERE id = ?
	`, recipientID).Scan(&r).Error
	if err != nil || r.ID == "" {
		return nil, apperrors.NotFound("certificate not found")
	}
	rec := &BatchRecipient{
		ID:            r.ID,
		BatchID:       r.BatchID,
		Email:         r.Email,
		Status:        RecipientStatus(r.Status),
		PDFObjectKey:  r.PDFObjectKey,
		PNGObjectKey:  r.PNGObjectKey,
		FailureReason: r.FailureReason,
	}
	if err := json.Unmarshal(r.Variables, &rec.Variables); err != nil {
		return nil, err
	}
	if len(r.Scripts) > 0 && string(r.Scripts) != "null" {
		if err := json.Unmarshal(r.Scripts, &rec.Scripts); err != nil {
			return nil, err
		}
	}
	return rec, nil
}

func (s *Service) RevokeCertificate(ctx context.Context, recipientID string, caller *auth.SessionUser) error {
	if _, err := s.GetCertificate(ctx, recipientID, caller); err != nil {
		return err
	}
	return s.repo.RevokeCertificate(ctx, recipientID)
}

// DownloadArchive writes a ZIP of every rendered PDF for the batch into w.
func (s *Service) DownloadArchive(ctx context.Context, batchID string, caller *auth.SessionUser, w io.Writer) (string, error) {
	batch, err := s.GetBatch(ctx, batchID, caller)
	if err != nil {
		return "", err
	}
	if batch.Status != "completed" && batch.Status != "failed" {
		return "", apperrors.BadRequest("batch is not yet completed")
	}

	recipients, err := s.repo.ListRecipients(ctx, batchID)
	if err != nil {
		return "", err
	}

	zw := zip.NewWriter(w)
	defer zw.Close()

	for _, rec := range recipients {
		if rec.Status != RecipientRendered && rec.Status != RecipientEmailed {
			continue
		}
		pdfBytes, _, err := s.RenderCertificate(ctx, rec.ID, "pdf")
		if err != nil {
			continue // skip failed renders — don't abort the whole archive
		}
		fileName := fmt.Sprintf("%s.pdf", rec.Email)
		f, err := zw.Create(fileName)
		if err != nil {
			continue
		}
		_, _ = io.Copy(f, bytes.NewReader(pdfBytes))
	}

	return batch.Name, nil
}

// CertificateEntry is a recipient record enriched with public-facing URLs.
type CertificateEntry struct {
	*BatchRecipient
	PDFURL string `json:"pdf_url,omitempty"`
	PNGURL string `json:"png_url,omitempty"`
}

// ListCertificates returns recipients for a batch with resolved render URLs.
func (s *Service) ListCertificates(ctx context.Context, batchID string, caller *auth.SessionUser) ([]*CertificateEntry, error) {
	if _, err := s.GetBatch(ctx, batchID, caller); err != nil {
		return nil, err
	}
	recipients, err := s.repo.ListRecipients(ctx, batchID)
	if err != nil {
		return nil, err
	}
	entries := make([]*CertificateEntry, 0, len(recipients))
	for _, rec := range recipients {
		e := &CertificateEntry{BatchRecipient: rec}
		if rec.Status == RecipientRendered || rec.Status == RecipientEmailed {
			e.PDFURL = s.CertRenderURL(rec.ID, "pdf")
			e.PNGURL = s.CertRenderURL(rec.ID, "png")
		}
		entries = append(entries, e)
	}
	return entries, nil
}

// DeleteBatch removes a batch and all its recipients from the database.
func (s *Service) DeleteBatch(ctx context.Context, batchID string, caller *auth.SessionUser) error {
	batch, err := s.GetBatch(ctx, batchID, caller)
	if err != nil {
		return err
	}
	if batch.Status == BatchStatusProcessing {
		return apperrors.BadRequest("cannot delete a batch while it is processing; cancel it first")
	}

	return s.repo.DeleteBatch(ctx, batchID)
}
