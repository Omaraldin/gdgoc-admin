package issuance

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/gdgoc/admin-api/internal/apperrors"
	"github.com/gdgoc/admin-api/internal/database"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

type Repository struct {
	db *gorm.DB
}

func NewRepository(db *database.DB) *Repository {
	return &Repository{db: db.Gorm}
}

func (r *Repository) CreateCertMetadata(ctx context.Context, chapterID string, input CreateCertMetadataInput) (*CertMetadata, error) {
	var cm CertMetadata
	err := r.db.WithContext(ctx).Raw(`
		INSERT INTO cert_metadata (chapter_id, name, description, created_at, updated_at)
		VALUES (?, ?, ?, NOW(), NOW())
		RETURNING id, chapter_id, name, description, created_at, updated_at
	`, chapterID, input.Name, input.Description).Scan(&cm).Error
	if err != nil {
		return nil, fmt.Errorf("create cert metadata: %w", err)
	}
	return &cm, nil
}

func (r *Repository) ListCertMetadata(ctx context.Context, chapterID string) ([]*CertMetadata, error) {
	var rows []struct {
		ID          string    `gorm:"column:id"`
		ChapterID   string    `gorm:"column:chapter_id"`
		Name        string    `gorm:"column:name"`
		Description string    `gorm:"column:description"`
		CreatedAt   time.Time `gorm:"column:created_at"`
		UpdatedAt   time.Time `gorm:"column:updated_at"`
	}
	if err := r.db.WithContext(ctx).Raw(`
		SELECT id, chapter_id, name, description, created_at, updated_at
		FROM cert_metadata WHERE chapter_id = ? ORDER BY name ASC
	`, chapterID).Scan(&rows).Error; err != nil {
		return nil, err
	}
	result := make([]*CertMetadata, 0, len(rows))
	for _, row := range rows {
		result = append(result, &CertMetadata{
			ID:          row.ID,
			ChapterID:   row.ChapterID,
			Name:        row.Name,
			Description: row.Description,
			CreatedAt:   row.CreatedAt,
			UpdatedAt:   row.UpdatedAt,
		})
	}
	return result, nil
}

func (r *Repository) UpdateCertMetadata(ctx context.Context, id, chapterID string, input UpdateCertMetadataInput) (*CertMetadata, error) {
	var cm CertMetadata
	err := r.db.WithContext(ctx).Raw(`
		UPDATE cert_metadata SET name = ?, description = ?, updated_at = NOW()
		WHERE id = ? AND chapter_id = ?
		RETURNING id, chapter_id, name, description, created_at, updated_at
	`, input.Name, input.Description, id, chapterID).Scan(&cm).Error
	if err != nil {
		return nil, fmt.Errorf("update cert metadata: %w", err)
	}
	if cm.ID == "" {
		return nil, apperrors.NotFound("cert metadata not found")
	}
	return &cm, nil
}

func (r *Repository) DeleteCertMetadata(ctx context.Context, id, chapterID string) error {
	res := r.db.WithContext(ctx).Exec(`DELETE FROM cert_metadata WHERE id = ? AND chapter_id = ?`, id, chapterID)
	if res.Error != nil {
		return fmt.Errorf("delete cert metadata: %w", res.Error)
	}
	if res.RowsAffected == 0 {
		return apperrors.NotFound("cert metadata not found")
	}
	return nil
}

func (r *Repository) CreateBatch(ctx context.Context, input CreateBatchInput, chapterID, userID, versionID string) (*IssuanceBatch, error) {
	batchID := uuid.New().String()
	now := time.Now()

	// If cert_id is provided, resolve cert_name from cert_metadata.
	var certDescription string
	if input.CertID != nil && *input.CertID != "" {
		type cmRow struct {
			Name        string `gorm:"column:name"`
			Description string `gorm:"column:description"`
		}
		var cm cmRow
		if err := r.db.WithContext(ctx).Raw(
			`SELECT name, description FROM cert_metadata WHERE id = ? AND chapter_id = ?`,
			*input.CertID, chapterID,
		).Scan(&cm).Error; err == nil && cm.Name != "" {
			input.CertName = cm.Name
			certDescription = cm.Description
		}
	}

	// Fetch chapter metadata needed to generate human-readable certificate IDs.
	type chapterMeta struct {
		Code           string `gorm:"column:code"`
		SinceYear      *int   `gorm:"column:since_year"`
		LeaderCodename string `gorm:"column:leader_codename"`
	}
	var ch chapterMeta
	if err := r.db.WithContext(ctx).Raw(
		`SELECT code, since_year, leader_codename FROM chapters WHERE id = ?`, chapterID,
	).Scan(&ch).Error; err != nil {
		return nil, fmt.Errorf("fetch chapter meta: %w", err)
	}

	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		mailVarsJSON, mErr := json.Marshal(input.MailVariables)
		if mErr != nil {
			mailVarsJSON = []byte("{}")
		}
		if err := tx.Exec(`
			INSERT INTO issuance_batches
				(id, chapter_id, template_id, template_version_id, name, cert_id, cert_name, status, send_mail, is_printable, mail_template_id, mail_variables, total_count, success_count, failed_count, created_by_user_id, created_at, updated_at)
			VALUES (?,?,?,?,?,?::uuid,?,'pending',?,?,?,?,?,0,0,?,NOW(),NOW())
		`, batchID, chapterID, input.TemplateID, versionID, input.Name, input.CertID, input.CertName, input.SendMail, input.IsPrintable, input.MailTemplateID, mailVarsJSON, len(input.Recipients), userID).Error; err != nil {
			return fmt.Errorf("create batch: %w", err)
		}

		for _, rec := range input.Recipients {
			varsJSON, err := json.Marshal(rec.Variables)
			if err != nil {
				return err
			}
			scriptsJSON, err := json.Marshal(rec.Scripts)
			if err != nil {
				return err
			}
			certID := GenerateCertificateID(ch.Code, ch.LeaderCodename)
			if err := tx.Exec(`
				INSERT INTO issuance_recipients
					(id, batch_id, email, variables, scripts, status, created_at, updated_at)
				VALUES (?,?,?,?,?,'queued',NOW(),NOW())
			`, certID, batchID, rec.Email, varsJSON, scriptsJSON).Error; err != nil {
				return fmt.Errorf("insert recipient: %w", err)
			}
		}

		return nil
	})
	if err != nil {
		return nil, err
	}
	// Construct the batch from known values to avoid a redundant SELECT that
	// can fail if GORM's column-mapping heuristic doesn't align with our field names.
	mailVars := input.MailVariables
	if mailVars == nil {
		mailVars = map[string]string{}
	}
	return &IssuanceBatch{
		ID:                batchID,
		ChapterID:         chapterID,
		TemplateID:        input.TemplateID,
		TemplateVersionID: versionID,
		Name:              input.Name,
		CertID:            input.CertID,
		CertName:          input.CertName,
		CertDescription:   certDescription,
		Status:            BatchStatusPending,
		SendMail:          input.SendMail,
		IsPrintable:       input.IsPrintable,
		MailTemplateID:    input.MailTemplateID,
		MailVariables:     mailVars,
		TotalCount:        len(input.Recipients),
		SuccessCount:      0,
		FailedCount:       0,
		CreatedByUserID:   userID,
		CreatedAt:         now,
		UpdatedAt:         now,
	}, nil
}

func (r *Repository) GetBatch(ctx context.Context, id string) (*IssuanceBatch, error) {
	type batchRow struct {
		ID                string          `gorm:"column:id"`
		ChapterID         string          `gorm:"column:chapter_id"`
		TemplateID        string          `gorm:"column:template_id"`
		TemplateVersionID string          `gorm:"column:template_version_id"`
		Name              string          `gorm:"column:name"`
		CertID            *string         `gorm:"column:cert_id"`
		CertName          string          `gorm:"column:cert_name"`
		CertDescription   string          `gorm:"column:cert_description"`
		Status            string          `gorm:"column:status"`
		SendMail          bool            `gorm:"column:send_mail"`
		IsPrintable       bool            `gorm:"column:is_printable"`
		MailTemplateID    *string         `gorm:"column:mail_template_id"`
		MailVariablesJSON json.RawMessage `gorm:"column:mail_variables"`
		TotalCount        int             `gorm:"column:total_count"`
		SuccessCount      int             `gorm:"column:success_count"`
		FailedCount       int             `gorm:"column:failed_count"`
		CreatedByUserID   string          `gorm:"column:created_by_user_id"`
		CreatedByName     string          `gorm:"column:created_by_name"`
		CreatedAt         time.Time       `gorm:"column:created_at"`
		UpdatedAt         time.Time       `gorm:"column:updated_at"`
	}
	var row batchRow
	err := r.db.WithContext(ctx).Raw(`
		SELECT b.id, b.chapter_id, b.template_id, b.template_version_id, b.name, b.cert_id, b.cert_name, b.status, b.send_mail, b.is_printable,
		       b.mail_template_id, b.mail_variables,
		       b.total_count, b.success_count, b.failed_count, b.created_by_user_id, b.created_at, b.updated_at,
		       COALESCE(u.name, '') AS created_by_name,
		       COALESCE(cm.description, '') AS cert_description
		FROM issuance_batches b
		LEFT JOIN users u ON u.id = b.created_by_user_id
		LEFT JOIN cert_metadata cm ON cm.id = b.cert_id
		WHERE b.id = ?
	`, id).Scan(&row).Error
	if err != nil || row.ID == "" {
		return nil, apperrors.NotFound("batch not found")
	}
	var mailVars map[string]string
	if err := json.Unmarshal(row.MailVariablesJSON, &mailVars); err != nil || mailVars == nil {
		mailVars = map[string]string{}
	}
	return &IssuanceBatch{
		ID:                row.ID,
		ChapterID:         row.ChapterID,
		TemplateID:        row.TemplateID,
		TemplateVersionID: row.TemplateVersionID,
		Name:              row.Name,
		CertID:            row.CertID,
		CertName:          row.CertName,
		CertDescription:   row.CertDescription,
		Status:            BatchStatus(row.Status),
		SendMail:          row.SendMail,
		IsPrintable:       row.IsPrintable,
		MailTemplateID:    row.MailTemplateID,
		MailVariables:     mailVars,
		TotalCount:        row.TotalCount,
		SuccessCount:      row.SuccessCount,
		FailedCount:       row.FailedCount,
		CreatedByUserID:   row.CreatedByUserID,
		CreatedByName:     row.CreatedByName,
		CreatedAt:         row.CreatedAt,
		UpdatedAt:         row.UpdatedAt,
	}, nil
}

func (r *Repository) listBatchRows(ctx context.Context, query string, args ...interface{}) ([]*IssuanceBatch, error) {
	type batchRow struct {
		ID                string          `gorm:"column:id"`
		ChapterID         string          `gorm:"column:chapter_id"`
		TemplateID        string          `gorm:"column:template_id"`
		TemplateVersionID string          `gorm:"column:template_version_id"`
		Name              string          `gorm:"column:name"`
		CertID            *string         `gorm:"column:cert_id"`
		CertName          string          `gorm:"column:cert_name"`
		CertDescription   string          `gorm:"column:cert_description"`
		Status            string          `gorm:"column:status"`
		SendMail          bool            `gorm:"column:send_mail"`
		IsPrintable       bool            `gorm:"column:is_printable"`
		MailTemplateID    *string         `gorm:"column:mail_template_id"`
		MailVariablesJSON json.RawMessage `gorm:"column:mail_variables"`
		TotalCount        int             `gorm:"column:total_count"`
		SuccessCount      int             `gorm:"column:success_count"`
		FailedCount       int             `gorm:"column:failed_count"`
		CreatedByUserID   string          `gorm:"column:created_by_user_id"`
		CreatedByName     string          `gorm:"column:created_by_name"`
		CreatedAt         time.Time       `gorm:"column:created_at"`
		UpdatedAt         time.Time       `gorm:"column:updated_at"`
	}
	var rows []batchRow
	if err := r.db.WithContext(ctx).Raw(query, args...).Scan(&rows).Error; err != nil {
		return nil, err
	}
	batches := make([]*IssuanceBatch, 0, len(rows))
	for _, row := range rows {
		var mailVars map[string]string
		if err := json.Unmarshal(row.MailVariablesJSON, &mailVars); err != nil || mailVars == nil {
			mailVars = map[string]string{}
		}
		batches = append(batches, &IssuanceBatch{
			ID:                row.ID,
			ChapterID:         row.ChapterID,
			TemplateID:        row.TemplateID,
			TemplateVersionID: row.TemplateVersionID,
			Name:              row.Name,
			CertID:            row.CertID,
			CertName:          row.CertName,
			CertDescription:   row.CertDescription,
			Status:            BatchStatus(row.Status),
			SendMail:          row.SendMail,
			IsPrintable:       row.IsPrintable,
			MailTemplateID:    row.MailTemplateID,
			MailVariables:     mailVars,
			TotalCount:        row.TotalCount,
			SuccessCount:      row.SuccessCount,
			FailedCount:       row.FailedCount,
			CreatedByUserID:   row.CreatedByUserID,
			CreatedByName:     row.CreatedByName,
			CreatedAt:         row.CreatedAt,
			UpdatedAt:         row.UpdatedAt,
		})
	}
	return batches, nil
}

func (r *Repository) ListBatches(ctx context.Context, chapterID string) ([]*IssuanceBatch, error) {
	return r.listBatchRows(ctx, `
		SELECT b.id, b.chapter_id, b.template_id, b.template_version_id, b.name, b.cert_id, b.cert_name, b.status, b.send_mail, b.is_printable,
		       b.mail_template_id, b.mail_variables,
		       b.total_count, b.success_count, b.failed_count, b.created_by_user_id, b.created_at, b.updated_at,
		       COALESCE(u.name, '') AS created_by_name,
		       COALESCE(cm.description, '') AS cert_description
		FROM issuance_batches b
		LEFT JOIN users u ON u.id = b.created_by_user_id
		LEFT JOIN cert_metadata cm ON cm.id = b.cert_id
		WHERE b.chapter_id = ? ORDER BY b.created_at DESC
	`, chapterID)
}

func (r *Repository) ListAllBatches(ctx context.Context) ([]*IssuanceBatch, error) {
	return r.listBatchRows(ctx, `
		SELECT b.id, b.chapter_id, b.template_id, b.template_version_id, b.name, b.cert_id, b.cert_name, b.status, b.send_mail, b.is_printable,
		       b.mail_template_id, b.mail_variables,
		       b.total_count, b.success_count, b.failed_count, b.created_by_user_id, b.created_at, b.updated_at,
		       COALESCE(u.name, '') AS created_by_name,
		       COALESCE(cm.description, '') AS cert_description
		FROM issuance_batches b
		LEFT JOIN users u ON u.id = b.created_by_user_id
		LEFT JOIN cert_metadata cm ON cm.id = b.cert_id
		ORDER BY b.created_at DESC
	`)
}

// ListCertNames returns distinct non-empty cert_name values for a chapter, ordered by most recent.
func (r *Repository) ListCertNames(ctx context.Context, chapterID string) ([]string, error) {
	var names []string
	err := r.db.WithContext(ctx).Raw(`
		SELECT DISTINCT cert_name
		FROM issuance_batches
		WHERE chapter_id = ? AND cert_name <> ''
		ORDER BY cert_name ASC
	`, chapterID).Pluck("cert_name", &names).Error
	if err != nil {
		return nil, err
	}
	return names, nil
}

func (r *Repository) ListRecipients(ctx context.Context, batchID string) ([]*BatchRecipient, error) {
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
	var rows []row
	err := r.db.WithContext(ctx).Raw(`
		SELECT id, batch_id, email, variables, scripts, status,
		       pdf_object_key, png_object_key, failure_reason
		FROM issuance_recipients WHERE batch_id = ? ORDER BY created_at ASC
	`, batchID).Scan(&rows).Error
	if err != nil {
		return nil, err
	}

	recipients := make([]*BatchRecipient, 0, len(rows))
	for _, rr := range rows {
		rec := &BatchRecipient{
			ID:            rr.ID,
			BatchID:       rr.BatchID,
			Email:         rr.Email,
			Status:        RecipientStatus(rr.Status),
			PDFObjectKey:  rr.PDFObjectKey,
			PNGObjectKey:  rr.PNGObjectKey,
			FailureReason: rr.FailureReason,
		}
		if err := json.Unmarshal(rr.Variables, &rec.Variables); err != nil {
			return nil, err
		}
		if len(rr.Scripts) > 0 && string(rr.Scripts) != "null" {
			if err := json.Unmarshal(rr.Scripts, &rec.Scripts); err != nil {
				return nil, err
			}
		}
		recipients = append(recipients, rec)
	}
	return recipients, nil
}

func (r *Repository) CancelBatch(ctx context.Context, id string) error {
	result := r.db.WithContext(ctx).Exec(`
		UPDATE issuance_batches SET status = 'cancelled', updated_at = NOW()
		WHERE id = ? AND status IN ('pending','processing')`, id)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return apperrors.BadRequest("batch cannot be cancelled in its current state")
	}
	return nil
}

func (r *Repository) GetProgress(ctx context.Context, id string) (*BatchProgress, error) {
	b, err := r.GetBatch(ctx, id)
	if err != nil {
		return nil, err
	}
	return &BatchProgress{
		BatchID:      b.ID,
		Status:       b.Status,
		TotalCount:   b.TotalCount,
		SuccessCount: b.SuccessCount,
		FailedCount:  b.FailedCount,
	}, nil
}

func (r *Repository) RevokeCertificate(ctx context.Context, recipientID string) error {
	return r.db.WithContext(ctx).Exec(
		`UPDATE issuance_recipients SET status = 'revoked', updated_at = NOW() WHERE id = ?`,
		recipientID).Error
}

// DeleteBatch hard-deletes a batch and all its recipients from the database.
// The caller is responsible for removing associated storage objects beforehand.
func (r *Repository) DeleteBatch(ctx context.Context, batchID string) error {
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Exec(`DELETE FROM issuance_recipients WHERE batch_id = ?`, batchID).Error; err != nil {
			return fmt.Errorf("delete recipients: %w", err)
		}
		if err := tx.Exec(`DELETE FROM issuance_batches WHERE id = ?`, batchID).Error; err != nil {
			return fmt.Errorf("delete batch: %w", err)
		}
		return nil
	})
}

// ListRecipientObjectKeys returns all non-null PDF and PNG object keys for a batch.
func (r *Repository) ListRecipientObjectKeys(ctx context.Context, batchID string) ([]string, error) {
	var keys []string
	err := r.db.WithContext(ctx).Raw(`
		SELECT pdf_object_key FROM issuance_recipients
		WHERE batch_id = ? AND pdf_object_key IS NOT NULL
	`, batchID).Pluck("pdf_object_key", &keys).Error
	if err != nil {
		return nil, err
	}
	var pngKeys []string
	if err := r.db.WithContext(ctx).Raw(`
		SELECT png_object_key FROM issuance_recipients
		WHERE batch_id = ? AND png_object_key IS NOT NULL
	`, batchID).Pluck("png_object_key", &pngKeys).Error; err != nil {
		return nil, err
	}
	return append(keys, pngKeys...), nil
}
