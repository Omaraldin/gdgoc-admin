package fonts

import "time"

// Font represents an uploaded custom font stored in the asset bucket.
type Font struct {
	ID          string    `json:"id"`
	FamilyName  string    `json:"family_name"`
	ObjectKey   string    `json:"object_key"`
	AssetURL    string    `json:"asset_url"` // populated by service, not stored in DB
	FileName    string    `json:"file_name"`
	MimeType    string    `json:"mime_type"`
	ContentHash string    `json:"content_hash"`
	UploadedBy  *string   `json:"uploaded_by"`
	CreatedAt   time.Time `json:"created_at"`
}
