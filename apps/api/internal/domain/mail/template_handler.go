package mail

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"path/filepath"
	"strings"
	"time"

	"github.com/gdgoc/admin-api/internal/apperrors"
	"github.com/gdgoc/admin-api/internal/domain/auth"
	"github.com/gdgoc/admin-api/internal/middleware"
	"github.com/gdgoc/admin-api/internal/storage"
	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
)

// TemplateHandler handles HTTP requests for mail template management.
type TemplateHandler struct {
	svc       *TemplateService
	store     storage.Backend
	imageRepo *ImageRepository
}

func NewTemplateHandler(svc *TemplateService, store storage.Backend, imageRepo *ImageRepository) *TemplateHandler {
	return &TemplateHandler{svc: svc, store: store, imageRepo: imageRepo}
}

func tmplCaller(c *fiber.Ctx) *auth.SessionUser {
	return c.Locals(middleware.ContextKeyUser).(*auth.SessionUser)
}

// List returns all mail templates. Super admins see all chapters; others see only their chapter.
func (h *TemplateHandler) List(c *fiber.Ctx) error {
	caller := tmplCaller(c)
	var templates []*MailTemplate
	var err error
	if auth.IsSuperAdmin(caller.Role) {
		templates, err = h.svc.ListAll(c.Context())
	} else {
		templates, err = h.svc.List(c.Context(), caller.ChapterID)
	}
	if err != nil {
		return err
	}
	if templates == nil {
		templates = []*MailTemplate{}
	}
	return c.JSON(templates)
}

// Get returns a single mail template.
func (h *TemplateHandler) Get(c *fiber.Ctx) error {
	caller := tmplCaller(c)
	id := c.Params("id")
	if id == "" {
		return apperrors.BadRequest("id is required")
	}
	t, err := h.svc.Get(c.Context(), id, caller.ChapterID)
	if err != nil {
		return err
	}
	return c.JSON(t)
}

// Create creates a new mail template.
func (h *TemplateHandler) Create(c *fiber.Ctx) error {
	caller := tmplCaller(c)
	var in CreateTemplateInput
	if err := c.BodyParser(&in); err != nil {
		return apperrors.BadRequest("invalid request body")
	}
	t, err := h.svc.Create(c.Context(), in, caller.ChapterID, caller.ID)
	if err != nil {
		return err
	}
	return c.Status(fiber.StatusCreated).JSON(t)
}

// Update updates an existing mail template.
func (h *TemplateHandler) Update(c *fiber.Ctx) error {
	caller := tmplCaller(c)
	id := c.Params("id")
	if id == "" {
		return apperrors.BadRequest("id is required")
	}
	var in UpdateTemplateInput
	if err := c.BodyParser(&in); err != nil {
		return apperrors.BadRequest("invalid request body")
	}
	t, err := h.svc.Update(c.Context(), id, in, caller.ChapterID, caller.ID, auth.IsSuperAdmin(caller.Role))
	if err != nil {
		return err
	}
	return c.JSON(t)
}

// Delete deletes a mail template.
func (h *TemplateHandler) Delete(c *fiber.Ctx) error {
	caller := tmplCaller(c)
	id := c.Params("id")
	if id == "" {
		return apperrors.BadRequest("id is required")
	}
	if err := h.svc.Delete(c.Context(), id, caller.ChapterID, caller.ID, auth.IsSuperAdmin(caller.Role)); err != nil {
		return err
	}
	return c.SendStatus(fiber.StatusNoContent)
}

// Publish marks a mail template as published so it appears in the compose picker.
func (h *TemplateHandler) Publish(c *fiber.Ctx) error {
	caller := tmplCaller(c)
	id := c.Params("id")
	if id == "" {
		return apperrors.BadRequest("id is required")
	}
	t, err := h.svc.Publish(c.Context(), id, caller.ChapterID, caller.ID, auth.IsSuperAdmin(caller.Role))
	if err != nil {
		return err
	}
	return c.JSON(t)
}

// Unpublish reverts a mail template back to draft.
func (h *TemplateHandler) Unpublish(c *fiber.Ctx) error {
	caller := tmplCaller(c)
	id := c.Params("id")
	if id == "" {
		return apperrors.BadRequest("id is required")
	}
	t, err := h.svc.Unpublish(c.Context(), id, caller.ChapterID, caller.ID, auth.IsSuperAdmin(caller.Role))
	if err != nil {
		return err
	}
	return c.JSON(t)
}

// Clone copies a mail template into the caller's chapter as a new draft.
func (h *TemplateHandler) Clone(c *fiber.Ctx) error {
	caller := tmplCaller(c)
	id := c.Params("id")
	if id == "" {
		return apperrors.BadRequest("id is required")
	}
	t, err := h.svc.Clone(c.Context(), id, caller.ChapterID, caller.ID)
	if err != nil {
		return err
	}
	return c.Status(fiber.StatusCreated).JSON(t)
}

// UploadImage uploads an image for use inside a mail template body.
// Returns the public URL that the rich editor embeds as an <img src="...">.
// If the same file content was already uploaded (detected via SHA-256 hash) the
// existing object is reused — no re-upload occurs.
func (h *TemplateHandler) UploadImage(c *fiber.Ctx) error {
	caller := tmplCaller(c)

	fh, err := c.FormFile("file")
	if err != nil {
		return apperrors.BadRequest("file is required")
	}

	ext := strings.ToLower(filepath.Ext(fh.Filename))
	allowed := map[string]string{
		".png":  "image/png",
		".jpg":  "image/jpeg",
		".jpeg": "image/jpeg",
		".webp": "image/webp",
		".gif":  "image/gif",
	}
	mime, ok := allowed[ext]
	if !ok {
		return apperrors.BadRequest("unsupported file type; use PNG, JPEG, WebP, or GIF")
	}

	f, err := fh.Open()
	if err != nil {
		return fmt.Errorf("open uploaded file: %w", err)
	}
	defer f.Close()

	// Read all bytes so we can hash before deciding whether to upload.
	data, err := io.ReadAll(f)
	if err != nil {
		return fmt.Errorf("read uploaded file: %w", err)
	}

	// Compute SHA-256 content hash.
	sum := sha256.Sum256(data)
	hash := hex.EncodeToString(sum[:])

	// Check for existing upload with identical content.
	existing, err := h.imageRepo.FindImageByHash(c.Context(), hash)
	if err != nil {
		return fmt.Errorf("check content hash: %w", err)
	}

	if existing != nil {
		// Reuse the already-stored object — record the reference for this chapter.
		img := &MailTemplateImage{
			ID:          uuid.New().String(),
			ChapterID:   caller.ChapterID,
			ObjectKey:   existing.ObjectKey,
			FileName:    fh.Filename,
			MimeType:    mime,
			ContentHash: hash,
			CreatedAt:   time.Now(),
		}
		if err := h.imageRepo.SaveImage(c.Context(), img); err != nil {
			return fmt.Errorf("save image record: %w", err)
		}
		return c.Status(fiber.StatusCreated).JSON(fiber.Map{
			"url":        h.store.GetAssetURL(existing.ObjectKey),
			"object_key": existing.ObjectKey,
		})
	}

	// New content — upload to storage.
	objectKey := fmt.Sprintf("mail/%s/images/%s%s", caller.ChapterID, uuid.New().String(), ext)
	if _, err := h.store.UploadAsset(c.Context(), objectKey, bytes.NewReader(data), fh.Size, mime); err != nil {
		return fmt.Errorf("upload image: %w", err)
	}

	img := &MailTemplateImage{
		ID:          uuid.New().String(),
		ChapterID:   caller.ChapterID,
		ObjectKey:   objectKey,
		FileName:    fh.Filename,
		MimeType:    mime,
		ContentHash: hash,
		CreatedAt:   time.Now(),
	}
	if err := h.imageRepo.SaveImage(c.Context(), img); err != nil {
		return fmt.Errorf("save image record: %w", err)
	}

	return c.Status(fiber.StatusCreated).JSON(fiber.Map{
		"url":        h.store.GetAssetURL(objectKey),
		"object_key": objectKey,
	})
}
