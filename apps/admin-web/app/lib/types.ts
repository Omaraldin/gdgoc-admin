// Shared TypeScript types that mirror the backend JSON contract.
// Keep in sync with the OpenAPI spec in /packages/api-contract.

// --- Font Library ---

export interface FontRecord {
  id: string;
  family_name: string;
  object_key: string;
  asset_url: string;
  file_name: string;
  mime_type: string;
  content_hash: string;
  uploaded_by: string | null;
  created_at: string;
}

export interface User {
  id: string;
  email: string;
  name: string;
  role: "super_admin" | "chapter_leader" | "editor";
  chapter_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface Chapter {
  id: string;
  name: string;
  /** Short abbreviation / codename set by the chapter leader (e.g. "NCTU"). */
  code: string;
  /** Year of the chapter's first season. */
  since_year: number | null;
  /** Codename used by chapter leader for certification ID generation. */
  leader_codename: string;
  /** Full name of the chapter leader (resolved server-side). */
  leader_name?: string;
  email: string;
  smtp_password?: string | null;
  leader_id: string | null;
  status: "active" | "inactive";
  profile_picture_url: string | null;
  created_at: string;
  updated_at: string;
}

export type SMTPProvider = "gmail" | "outlook" | "manual";

export interface SMTPStatus {
  provider: SMTPProvider;
  from_email: string;
  connected: boolean;
}

export interface WhitelistEntry {
  id: string;
  email: string;
  added_by: string;
  created_at: string;
}

// --- Template types ---

export type TemplateStatus = "draft" | "published" | "archived";
export type TemplateVisibility = "private" | "public";
export type LayerType = "text" | "image" | "shape";
export type ShapeKind = "rect" | "rounded-rect" | "circle" | "line" | "path";
export type GradientType = "linear" | "radial";
export type StrokeAlignment = "inside" | "center" | "outside";
export type StrokeLineCap = "butt" | "round" | "square";
export type StrokeLineJoin = "miter" | "round" | "bevel";
export type FillRule = "nonzero" | "evenodd";

export interface GradientStop {
  offset: number; // 0.0 – 1.0
  color: string;
}

/** A single anchor point in path-local coords. Handles are RELATIVE to the anchor (paper.js style). */
export interface PathAnchor {
  x: number;
  y: number;
  /** handle in (incoming segment), relative to anchor. {0,0} = corner. */
  hi_x: number;
  hi_y: number;
  /** handle out (outgoing segment), relative to anchor. {0,0} = corner. */
  ho_x: number;
  ho_y: number;
}

export interface SubPath {
  closed: boolean;
  anchors: PathAnchor[];
}

export interface PathProps {
  subpaths: SubPath[];
  fill_rule: FillRule;
}

export interface ShapeProps {
  kind: ShapeKind;
  corner_radius: number;
  fill_type: "solid" | "gradient" | "none";
  fill_color: string;
  gradient_type: GradientType;
  gradient_stops: GradientStop[];
  gradient_angle: number; // degrees, 0 = left→right
  stroke: boolean;
  stroke_color: string;
  stroke_width: number;
  // ---- New vector / stroke options (all optional for backward-compat). ----
  path_props?: PathProps;
  stroke_alignment?: StrokeAlignment;     // default "center"
  stroke_linecap?: StrokeLineCap;         // default "butt"
  stroke_linejoin?: StrokeLineJoin;       // default "miter"
  stroke_miter_limit?: number;            // default 4
  stroke_dash?: number[];                 // empty = solid
}

export interface Template {
  id: string;
  name: string;
  description: string;
  owner_user_id: string;
  owner_chapter_id: string;
  visibility: TemplateVisibility;
  status: TemplateStatus;
  source_template_id: string | null;
  current_version_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface TemplateVersion {
  id: string;
  template_id: string;
  version: number;
  scene: SceneDefinition;
  created_at: string;
}

export interface SceneDefinition {
  width: number;
  height: number;
  background: string;
  layers: Layer[];
}

export interface Layer {
  id: string;
  type: LayerType;
  z_index: number;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  visible: boolean;
  text_props?: TextProps;
  image_props?: ImageProps;
  shape_props?: ShapeProps;
}

export interface TextProps {
  /** Supports inline interpolation, e.g. "Hello ${name}". */
  content: string;
  font_size: number;
  font_family: string;
  bold: boolean;
  italic: boolean;
  /** Numeric font weight (100–900). When set, takes precedence over `bold`. */
  font_weight?: number;
  color: string;
  align: "left" | "center" | "right";
  is_dynamic: boolean;
  variable_key?: string;
  /** JS snippet evaluated server-side at render time; receives `vars` object. */
  script_source?: string;
  /** When false the text wraps at layer.width (fixed-width mode). Default (undefined/true) = auto-fit. */
  auto_width?: boolean;
  /** Object key of an uploaded font in the assets bucket; takes priority over font_family for backend rendering. */
  font_asset_key?: string;
  /** CSS-style text transform applied before rendering. Default (undefined/"none") = no transform. */
  text_transform?: "none" | "uppercase" | "lowercase" | "capitalize";
}

export interface ImageProps {
  asset_key: string;
  object_fit: "cover" | "contain" | "fill";
}

// --- Issuance types ---

export type BatchStatus = "pending" | "processing" | "completed" | "cancelled" | "failed";
export type RecipientStatus = "queued" | "rendering" | "rendered" | "emailed" | "failed" | "revoked";

export interface IssuanceBatch {
  id: string;
  chapter_id: string;
  template_id: string;
  template_version_id: string;
  name: string;
  status: BatchStatus;
  send_mail: boolean;
  is_printable: boolean;
  total_count: number;
  success_count: number;
  failed_count: number;
  created_by_user_id: string;
  created_at: string;
  updated_at: string;
}

export interface BatchRecipient {
  id: string;
  batch_id: string;
  email: string;
  variables: Record<string, string>;
  /** Original JS script source per field — present when cells were formula-driven. */
  scripts?: Record<string, string>;
  status: RecipientStatus;
  pdf_object_key?: string;
  png_object_key?: string;
  failure_reason?: string;
  created_at: string;
  updated_at: string;
}

export interface BatchProgress {
  batch_id: string;
  status: BatchStatus;
  total_count: number;
  success_count: number;
  failed_count: number;
}

// --- Verification ---

export interface VerificationResult {
  valid: boolean;
  code: string;
  recipient_email?: string;
  recipient_name?: string;
  template_name?: string;
  chapter_name?: string;
  issued_at?: string;
  status: string;
}

// --- Dynamic Images ---

export interface DynamicField {
  key: string;
  label: string;
}

export interface DynamicImage {
  id: string;
  name: string;
  description: string;
  status: "draft" | "published";
  owner_user_id: string;
  owner_chapter_id: string;
  scene: SceneDefinition;
  created_at: string;
  updated_at: string;
}

export interface DynamicImageDetail extends DynamicImage {
  fields: DynamicField[];
}

