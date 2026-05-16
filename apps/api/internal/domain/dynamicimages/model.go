package dynamicimages

import (
	"encoding/json"
	"time"

	tmpl "github.com/gdgoc/admin-api/internal/domain/templates"
)

// DynamicImage is a standalone renderable image whose text layers can be
// overridden at request time via URL query parameters.
type DynamicImage struct {
	ID             string          `json:"id"`
	Name           string          `json:"name"`
	Description    string          `json:"description"`
	Status         string          `json:"status"` // "draft" | "published"
	OwnerUserID    string          `json:"owner_user_id"`
	OwnerChapterID string          `json:"owner_chapter_id"`
	Scene          json.RawMessage `json:"scene"` // tmpl.SceneDefinition serialised
	CreatedAt      time.Time       `json:"created_at"`
	UpdatedAt      time.Time       `json:"updated_at"`
}

// ParsedScene deserialises the stored JSONB into a SceneDefinition.
func (d *DynamicImage) ParsedScene() (tmpl.SceneDefinition, error) {
	var s tmpl.SceneDefinition
	if err := json.Unmarshal(d.Scene, &s); err != nil {
		return s, err
	}
	return s, nil
}

// DynamicField describes one variable key exposed by a dynamic image.
type DynamicField struct {
	Key   string `json:"key"`
	Label string `json:"label"` // human-readable label derived from the key
}

// DynamicImageDetail is DynamicImage + the list of dynamic fields derived from
// the scene (so the frontend knows what query params to show).
type DynamicImageDetail struct {
	DynamicImage
	Fields []DynamicField `json:"fields"`
}
