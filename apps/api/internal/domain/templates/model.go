package templates

import (
	"encoding/json"
	"time"
)

// TemplateStatus represents the lifecycle state of a template.
type TemplateStatus string

const (
	StatusDraft     TemplateStatus = "draft"
	StatusPublished TemplateStatus = "published"
	StatusArchived  TemplateStatus = "archived"
)

// TemplateVisibility controls cross-chapter sharing.
type TemplateVisibility string

const (
	VisibilityPrivate TemplateVisibility = "private"
	VisibilityPublic  TemplateVisibility = "public"
)

// Template is the top-level record for a certificate template.
type Template struct {
	ID               string             `json:"id"`
	Name             string             `json:"name"`
	Description      string             `json:"description"`
	OwnerUserID      string             `json:"owner_user_id"`
	OwnerChapterID   string             `json:"owner_chapter_id"`
	Visibility       TemplateVisibility `json:"visibility"`
	Status           TemplateStatus     `json:"status"`
	SourceTemplateID *string            `json:"source_template_id,omitempty"`
	CurrentVersionID *string            `json:"current_version_id,omitempty"`
	CreatedAt        time.Time          `json:"created_at"`
	UpdatedAt        time.Time          `json:"updated_at"`
}

// TemplateVersion holds an immutable snapshot of the editor scene JSON.
type TemplateVersion struct {
	ID         string          `json:"id"`
	TemplateID string          `json:"template_id"`
	Version    int             `json:"version"`
	Scene      json.RawMessage `json:"scene"` // SceneDefinition serialized
	CreatedAt  time.Time       `json:"created_at"`
}

// --- Scene model (editor contract) ---

// SceneDefinition is the JSON contract between the frontend editor and the backend renderer.
type SceneDefinition struct {
	Width      float64 `json:"width"`
	Height     float64 `json:"height"`
	Background string  `json:"background"` // hex color or asset key
	Layers     []Layer `json:"layers"`
}

// Layer represents a single positioned element on the certificate canvas.
type Layer struct {
	ID         string      `json:"id"`
	Type       LayerType   `json:"type"`
	ZIndex     float64     `json:"z_index"`
	X          float64     `json:"x"`
	Y          float64     `json:"y"`
	Width      float64     `json:"width"`
	Height     float64     `json:"height"`
	Rotation   float64     `json:"rotation"`
	Visible    bool        `json:"visible"`
	TextProps  *TextProps  `json:"text_props,omitempty"`
	ImageProps *ImageProps `json:"image_props,omitempty"`
	ShapeProps *ShapeProps `json:"shape_props,omitempty"`
}

type LayerType string

const (
	LayerTypeText  LayerType = "text"
	LayerTypeImage LayerType = "image"
	LayerTypeShape LayerType = "shape"
)

// TextProps holds styling and content for a text layer.
type TextProps struct {
	Content      string  `json:"content"` // static text or interpolated text like "Hello ${name}"
	FontSize     float64 `json:"font_size"`
	FontFamily   string  `json:"font_family"`
	FontAssetKey string  `json:"font_asset_key,omitempty"` // object key of an uploaded TTF/OTF in the assets bucket; takes priority over font_family
	Bold         bool    `json:"bold"`
	Italic       bool    `json:"italic"`
	FontWeight   int     `json:"font_weight,omitempty"` // CSS font-weight (100–900); 0 means derive from Bold
	Color        string  `json:"color"`
	Align        string  `json:"align"` // left | center | right
	IsDynamic    bool    `json:"is_dynamic"`
	VariableKey  string  `json:"variable_key,omitempty"`
	ScriptSource string  `json:"script_source,omitempty"` // JS snippet; receives `vars` object, must return a string
	// AutoWidth controls whether the layer box auto-sizes to fit text content.
	// nil (omitted) and true both mean auto; false means fixed width/height set by the user.
	// *bool is used so that false is preserved in JSON (a plain bool would be omitted by omitempty).
	AutoWidth *bool `json:"auto_width,omitempty"`
	// TextTransform applies a case transform after content resolution.
	// Values: "" / "none" = as-is, "uppercase", "lowercase", "capitalize" (title-case).
	TextTransform string `json:"text_transform,omitempty"`
}

// ImageProps holds asset reference for an image layer.
type ImageProps struct {
	AssetKey  string `json:"asset_key"`  // object key in storage
	ObjectFit string `json:"object_fit"` // cover | contain | fill
}

// --- Shape / vector types ---

// GradientStop represents a single stop in a gradient fill.
type GradientStop struct {
	Offset float64 `json:"offset"` // 0..1
	Color  string  `json:"color"`
}

// ShapeFill describes a fill paint: solid, linear gradient, or radial gradient.
type ShapeFill struct {
	Type   string         `json:"type"` // "solid" | "linear" | "radial"
	Color  string         `json:"color,omitempty"`
	Stops  []GradientStop `json:"stops,omitempty"`
	Angle  float64        `json:"angle,omitempty"`  // degrees, for linear
	CX     float64        `json:"cx,omitempty"`     // 0..1 for radial center x
	CY     float64        `json:"cy,omitempty"`     // 0..1 for radial center y
	Radius float64        `json:"radius,omitempty"` // 0..1 for radial radius
}

// PathAnchor is a single anchor point on a sub-path. Handles are RELATIVE to (x,y).
type PathAnchor struct {
	X   float64 `json:"x"`
	Y   float64 `json:"y"`
	HiX float64 `json:"hi_x"`
	HiY float64 `json:"hi_y"`
	HoX float64 `json:"ho_x"`
	HoY float64 `json:"ho_y"`
}

// SubPath is one continuous (possibly closed) component of a compound path.
type SubPath struct {
	Closed  bool         `json:"closed"`
	Anchors []PathAnchor `json:"anchors"`
}

// PathProps holds the geometry of a vector path layer.
type PathProps struct {
	Subpaths []SubPath `json:"subpaths"`
	FillRule string    `json:"fill_rule"` // "nonzero" | "evenodd"
}

// ShapeProps holds vector / shape rendering properties.
type ShapeProps struct {
	Kind             string     `json:"kind"` // "path" (and legacy: rect|circle|line)
	PathProps        *PathProps `json:"path_props,omitempty"`
	Fill             *ShapeFill `json:"fill,omitempty"`
	StrokeColor      string     `json:"stroke_color,omitempty"`
	StrokeWidth      float64    `json:"stroke_width,omitempty"`
	StrokeAlignment  string     `json:"stroke_alignment,omitempty"` // center|inside|outside
	StrokeLineCap    string     `json:"stroke_linecap,omitempty"`   // butt|round|square
	StrokeLineJoin   string     `json:"stroke_linejoin,omitempty"`  // miter|round|bevel
	StrokeMiterLimit float64    `json:"stroke_miter_limit,omitempty"`
	StrokeDash       []float64  `json:"stroke_dash,omitempty"`
	Opacity          float64    `json:"opacity,omitempty"`
	// Legacy props (kept for compatibility):
	CornerRadius float64 `json:"corner_radius,omitempty"`
}

// TemplateVariable defines a dynamic field in a template.
type TemplateVariable struct {
	Key         string `json:"key"`
	Label       string `json:"label"`
	Description string `json:"description"`
	Required    bool   `json:"required"`
}

// TemplateAsset records an uploaded image asset for a template.
type TemplateAsset struct {
	ID          string    `json:"id"`
	TemplateID  string    `json:"template_id"`
	ObjectKey   string    `json:"object_key"`
	FileName    string    `json:"file_name"`
	MimeType    string    `json:"mime_type"`
	ContentHash string    `json:"content_hash"` // SHA-256 hex digest of the file bytes
	CreatedAt   time.Time `json:"created_at"`
}
