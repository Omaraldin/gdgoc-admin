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
	"log"
	"sync"
	"time"

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
	frontendURL string
	cache       sync.Map  // key: recipientID+":"+format → *certCacheEntry (in-flight dedup only)
	diskCache   *DiskCache // nil if CERT_CACHE_DIR is unset
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
	frontendURL string,
	diskCache *DiskCache,
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
		frontendURL: frontendURL,
		diskCache:   diskCache,
	}
}

// CertRenderURL returns the public URL for rendering a recipient's certificate.
func (s *Service) CertRenderURL(recipientID, format string) string {
	return fmt.Sprintf("%s/api/v1/certificates/%s/render?format=%s", s.publicURL, recipientID, format)
}

// RenderCertificate renders (or returns a cached render of) a recipient's
// certificate in the requested format ("png" or "pdf").
//
// Cache priority: disk cache → in-flight singleflight dedup → full render.
// On a successful render the result is written to disk so future calls
// (including across process restarts) avoid recomputation.
func (s *Service) RenderCertificate(ctx context.Context, recipientID, format string) ([]byte, string, error) {
	if format != "pdf" {
		format = "png"
	}

	contentType := "image/png"
	if format == "pdf" {
		contentType = "application/pdf"
	}

	// 1. Disk cache hit — serve immediately without touching the in-memory map.
	if s.diskCache != nil {
		if cached, err := s.diskCache.Get(recipientID, format); err == nil && cached != nil {
			return cached, contentType, nil
		}
	}

	// 2. In-flight dedup: only one goroutine renders; the rest wait.
	key := recipientID + ":" + format
	entry := &certCacheEntry{}
	actual, loaded := s.cache.LoadOrStore(key, entry)
	e := actual.(*certCacheEntry)
	if !loaded {
		e.once.Do(func() {
			log.Printf("[render] start %s format=%s", recipientID, format)
			t0 := time.Now()
			e.data, e.err = s.renderCertBytes(ctx, recipientID, format)
			if e.err != nil {
				log.Printf("[render] error %s: %v", recipientID, e.err)
				s.cache.Delete(key)
			} else {
				log.Printf("[render] done %s format=%s in %s (%d bytes)", recipientID, format, time.Since(t0), len(e.data))
				if s.diskCache != nil {
					_ = s.diskCache.Put(recipientID, format, e.data)
					s.cache.Delete(key)
				}
			}
		})
	} else {
		e.once.Do(func() {})
	}
	if e.err != nil {
		return nil, "", e.err
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
	vars["cert.pdf_url"] = s.CertRenderURL(rec.ID, "pdf")
	vars["cert.verify_url"] = fmt.Sprintf("%s/verify/%s", s.frontendURL, rec.ID)

	vars["batch.name"] = batch.Name
	vars["batch.cert_name"] = batch.CertName
	vars["batch.cert_description"] = batch.CertDescription

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
	if caller.ChapterID == "" {
		return []*IssuanceBatch{}, nil
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

func (s *Service) ListCertNames(ctx context.Context, caller *auth.SessionUser) ([]string, error) {
	if auth.IsSuperAdmin(caller.Role) {
		// Super-admins get names across all chapters — just return empty to keep things simple.
		// They should browse per-chapter certifications from the chapter view.
		return []string{}, nil
	}
	if caller.ChapterID == "" {
		return []string{}, nil
	}
	return s.repo.ListCertNames(ctx, caller.ChapterID)
}

func (s *Service) ListCertMetadata(ctx context.Context, caller *auth.SessionUser) ([]*CertMetadata, error) {
	if caller.ChapterID == "" {
		return []*CertMetadata{}, nil
	}
	return s.repo.ListCertMetadata(ctx, caller.ChapterID)
}

func (s *Service) CreateCertMetadata(ctx context.Context, input CreateCertMetadataInput, caller *auth.SessionUser) (*CertMetadata, error) {
	if caller.ChapterID == "" {
		return nil, apperrors.Forbidden("no chapter assigned")
	}
	if input.Name == "" {
		return nil, apperrors.BadRequest("name is required")
	}
	return s.repo.CreateCertMetadata(ctx, caller.ChapterID, input)
}

func (s *Service) UpdateCertMetadata(ctx context.Context, id string, input UpdateCertMetadataInput, caller *auth.SessionUser) (*CertMetadata, error) {
	if caller.ChapterID == "" {
		return nil, apperrors.Forbidden("no chapter assigned")
	}
	if input.Name == "" {
		return nil, apperrors.BadRequest("name is required")
	}
	return s.repo.UpdateCertMetadata(ctx, id, caller.ChapterID, input)
}

func (s *Service) DeleteCertMetadata(ctx context.Context, id string, caller *auth.SessionUser) error {
	if caller.ChapterID == "" {
		return apperrors.Forbidden("no chapter assigned")
	}
	return s.repo.DeleteCertMetadata(ctx, id, caller.ChapterID)
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

// evictCert removes a recipient's rendered files from both the in-memory
// singleflight map and the disk cache.
func (s *Service) evictCert(recipientID string) {
	for _, format := range []string{"png", "pdf"} {
		s.cache.Delete(recipientID + ":" + format)
	}
	if s.diskCache != nil {
		s.diskCache.Evict(recipientID)
	}
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
	if err := s.repo.RevokeCertificate(ctx, recipientID); err != nil {
		return err
	}
	s.evictCert(recipientID)
	return nil
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

// DeleteBatch removes a batch and all its recipients from the database,
// and evicts every recipient's rendered files from the cache.
func (s *Service) DeleteBatch(ctx context.Context, batchID string, caller *auth.SessionUser) error {
	batch, err := s.GetBatch(ctx, batchID, caller)
	if err != nil {
		return err
	}
	if batch.Status == BatchStatusProcessing {
		return apperrors.BadRequest("cannot delete a batch while it is processing; cancel it first")
	}

	recipients, err := s.repo.ListRecipients(ctx, batchID)
	if err != nil {
		return err
	}

	if err := s.repo.DeleteBatch(ctx, batchID); err != nil {
		return err
	}

	for _, rec := range recipients {
		s.evictCert(rec.ID)
	}
	return nil
}
