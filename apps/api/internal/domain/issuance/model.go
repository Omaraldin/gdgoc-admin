package issuance

import (
	"time"
)

// CertMetadata represents a named certification programme that groups batches.
type CertMetadata struct {
	ID          string    `json:"id"`
	ChapterID   string    `json:"chapter_id"`
	Name        string    `json:"name"`
	Description string    `json:"description"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

// CreateCertMetadataInput is the request body for creating a new cert metadata record.
type CreateCertMetadataInput struct {
	Name        string `json:"name"`
	Description string `json:"description"`
}

// UpdateCertMetadataInput is the request body for updating a cert metadata record.
type UpdateCertMetadataInput struct {
	Name        string `json:"name"`
	Description string `json:"description"`
}

type BatchStatus string

const (
	BatchStatusPending    BatchStatus = "pending"
	BatchStatusProcessing BatchStatus = "processing"
	BatchStatusCompleted  BatchStatus = "completed"
	BatchStatusCancelled  BatchStatus = "cancelled"
	BatchStatusFailed     BatchStatus = "failed"
)

type RecipientStatus string

const (
	RecipientQueued    RecipientStatus = "queued"
	RecipientRendering RecipientStatus = "rendering"
	RecipientRendered  RecipientStatus = "rendered"
	RecipientEmailed   RecipientStatus = "emailed"
	RecipientFailed    RecipientStatus = "failed"
)

// IssuanceBatch is a group of certificate issuances from one template.
type IssuanceBatch struct {
	ID                string            `json:"id"`
	ChapterID         string            `json:"chapter_id"`
	TemplateID        string            `json:"template_id"`
	TemplateVersionID string            `json:"template_version_id"`
	Name              string            `json:"name"`
	CertID            *string           `json:"cert_id,omitempty"`
	CertName          string            `json:"cert_name,omitempty"`
	CertDescription   string            `json:"cert_description,omitempty"`
	Status            BatchStatus       `json:"status"`
	SendMail          bool              `json:"send_mail"`
	IsPrintable       bool              `json:"is_printable"`
	MailTemplateID    *string           `json:"mail_template_id,omitempty"`
	MailVariables     map[string]string `json:"mail_variables,omitempty"`
	TotalCount        int               `json:"total_count"`
	SuccessCount      int               `json:"success_count"`
	FailedCount       int               `json:"failed_count"`
	CreatedByUserID   string            `json:"created_by_user_id"`
	CreatedByName     string            `json:"created_by_name"`
	CreatedAt         time.Time         `json:"created_at"`
	UpdatedAt         time.Time         `json:"updated_at"`
}

// BatchRecipient is one certificate issuance within a batch.
type BatchRecipient struct {
	ID            string            `json:"id"`
	BatchID       string            `json:"batch_id"`
	Email         string            `json:"email"`
	Variables     map[string]string `json:"variables"`         // key => resolved value
	Scripts       map[string]string `json:"scripts,omitempty"` // key => JS source (optional)
	Status        RecipientStatus   `json:"status"`
	PDFObjectKey  *string           `json:"pdf_object_key,omitempty"`
	PNGObjectKey  *string           `json:"png_object_key,omitempty"`
	FailureReason *string           `json:"failure_reason,omitempty"`
	CreatedAt     time.Time         `json:"created_at"`
	UpdatedAt     time.Time         `json:"updated_at"`
}

// CreateBatchInput is the request body for creating a new issuance batch.
type CreateBatchInput struct {
	TemplateID     string            `json:"template_id"`
	Name           string            `json:"name"`
	CertID         *string           `json:"cert_id,omitempty"`
	CertName       string            `json:"cert_name"`
	Recipients     []RecipientInput  `json:"recipients"`
	SendMail       bool              `json:"send_mail"`
	IsPrintable    bool              `json:"is_printable"`
	MailTemplateID *string           `json:"mail_template_id,omitempty"`
	MailVariables  map[string]string `json:"mail_variables,omitempty"`
}

// RecipientInput is one row in the batch (can be from manual form or bulk CSV import).
type RecipientInput struct {
	Email     string            `json:"email"`
	Variables map[string]string `json:"variables"`
	// Scripts stores the original JS source for each formula cell, keyed by variable name.
	// Values are resolved by the browser before submission; scripts are kept for later re-evaluation.
	Scripts map[string]string `json:"scripts,omitempty"`
}

// BatchProgress is a lightweight progress view for polling.
type BatchProgress struct {
	BatchID      string      `json:"batch_id"`
	Status       BatchStatus `json:"status"`
	TotalCount   int         `json:"total_count"`
	SuccessCount int         `json:"success_count"`
	FailedCount  int         `json:"failed_count"`
}
