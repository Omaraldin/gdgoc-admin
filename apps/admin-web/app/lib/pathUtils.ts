/**
 * Vector path utilities — anchor/handle model, SVG path data conversion,
 * bbox computation, and migration of legacy shape kinds (rect/rounded-rect/
 * circle/line) into editable paths.
 *
 * Anchor / handle model mirrors Paper.js Segments:
 *   - anchor point in path-local coords (0,0 = top-left of bbox)
 *   - handle_in / handle_out are RELATIVE to the anchor
 *   - {hi_x:0, hi_y:0, ho_x:0, ho_y:0} == corner with no curve
 */

import type {
  Layer,
  PathAnchor,
  PathProps,
  ShapeProps,
  SubPath,
} from "./types";

// Magic constant for cubic-bezier approximation of a quarter circle: 4*(sqrt(2)-1)/3
export const KAPPA = 0.5522847498307936;

// ---------- Construction helpers ----------

export function makeAnchor(
  x: number,
  y: number,
  hi: { x: number; y: number } | null = null,
  ho: { x: number; y: number } | null = null,
): PathAnchor {
  return {
    x,
    y,
    hi_x: hi?.x ?? 0,
    hi_y: hi?.y ?? 0,
    ho_x: ho?.x ?? 0,
    ho_y: ho?.y ?? 0,
  };
}

export function isCorner(a: PathAnchor): boolean {
  return a.hi_x === 0 && a.hi_y === 0 && a.ho_x === 0 && a.ho_y === 0;
}

// ---------- SVG path data ----------

/** Format helper that strips trailing zeros for cleaner path strings. */
function fmt(n: number): string {
  if (!Number.isFinite(n)) return "0";
  // Round to 3 decimals then drop trailing zeros.
  const r = Math.round(n * 1000) / 1000;
  return String(r);
}

/** Build SVG path "d" attribute from PathProps. Coords are path-local. */
export function pathPropsToSvgD(props: PathProps): string {
  const parts: string[] = [];
  for (const sp of props.subpaths) {
    if (sp.anchors.length === 0) continue;
    const first = sp.anchors[0];
    if (!first) continue;
    parts.push(`M${fmt(first.x)} ${fmt(first.y)}`);

    for (let i = 1; i < sp.anchors.length; i++) {
      const prev = sp.anchors[i - 1]!;
      const cur = sp.anchors[i]!;
      appendSegment(parts, prev, cur);
    }
    if (sp.closed) {
      const last = sp.anchors[sp.anchors.length - 1]!;
      appendSegment(parts, last, first);
      parts.push("Z");
    }
  }
  return parts.join(" ");
}

function appendSegment(parts: string[], a: PathAnchor, b: PathAnchor): void {
  const aHasOut = a.ho_x !== 0 || a.ho_y !== 0;
  const bHasIn = b.hi_x !== 0 || b.hi_y !== 0;
  if (!aHasOut && !bHasIn) {
    parts.push(`L${fmt(b.x)} ${fmt(b.y)}`);
  } else {
    const c1x = a.x + a.ho_x;
    const c1y = a.y + a.ho_y;
    const c2x = b.x + b.hi_x;
    const c2y = b.y + b.hi_y;
    parts.push(
      `C${fmt(c1x)} ${fmt(c1y)} ${fmt(c2x)} ${fmt(c2y)} ${fmt(b.x)} ${fmt(b.y)}`,
    );
  }
}

// ---------- Bounding box ----------

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Compute tight bbox of a path (anchors only — does not include curve extrema; good enough for handle dragging). */
export function computePathBounds(props: PathProps): Bounds {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const sp of props.subpaths) {
    for (const a of sp.anchors) {
      if (a.x < minX) minX = a.x;
      if (a.y < minY) minY = a.y;
      if (a.x > maxX) maxX = a.x;
      if (a.y > maxY) maxY = a.y;
      // Include handle endpoints so dragged handles can grow the bbox.
      const hix = a.x + a.hi_x;
      const hiy = a.y + a.hi_y;
      const hox = a.x + a.ho_x;
      const hoy = a.y + a.ho_y;
      if (hix < minX) minX = hix;
      if (hiy < minY) minY = hiy;
      if (hix > maxX) maxX = hix;
      if (hiy > maxY) maxY = hiy;
      if (hox < minX) minX = hox;
      if (hoy < minY) minY = hoy;
      if (hox > maxX) maxX = hox;
      if (hoy > maxY) maxY = hoy;
    }
  }
  if (!Number.isFinite(minX)) return { x: 0, y: 0, width: 0, height: 0 };
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * Re-origin a path so its bbox top-left becomes (0,0). Also returns the offset
 * that was subtracted, which the caller should ADD to layer.x / layer.y if it
 * wants the visual position to stay put.
 */
export function normalizePathOrigin(
  props: PathProps,
): { props: PathProps; dx: number; dy: number; width: number; height: number } {
  const b = computePathBounds(props);
  const dx = b.x;
  const dy = b.y;
  const out: PathProps = {
    fill_rule: props.fill_rule,
    subpaths: props.subpaths.map((sp) => ({
      closed: sp.closed,
      anchors: sp.anchors.map((a) => ({
        ...a,
        x: a.x - dx,
        y: a.y - dy,
      })),
    })),
  };
  return { props: out, dx, dy, width: b.width, height: b.height };
}

// ---------- Hit testing on an anchor segment (for "add anchor" tool) ----------

/** Sample a cubic bezier at t in [0..1]. */
export function bezierPoint(
  p0: { x: number; y: number },
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  p3: { x: number; y: number },
  t: number,
): { x: number; y: number } {
  const u = 1 - t;
  const tt = t * t;
  const uu = u * u;
  const uuu = uu * u;
  const ttt = tt * t;
  return {
    x: uuu * p0.x + 3 * uu * t * p1.x + 3 * u * tt * p2.x + ttt * p3.x,
    y: uuu * p0.y + 3 * uu * t * p1.y + 3 * u * tt * p2.y + ttt * p3.y,
  };
}

/** Find closest point on the segment from anchor a → anchor b. Returns { t, dist, point } or null. */
export function closestPointOnSegment(
  a: PathAnchor,
  b: PathAnchor,
  px: number,
  py: number,
  steps = 32,
): { t: number; dist: number; point: { x: number; y: number } } {
  const p0 = { x: a.x, y: a.y };
  const p1 = { x: a.x + a.ho_x, y: a.y + a.ho_y };
  const p2 = { x: b.x + b.hi_x, y: b.y + b.hi_y };
  const p3 = { x: b.x, y: b.y };
  let bestT = 0;
  let bestD = Infinity;
  let bestP = p0;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const pt = bezierPoint(p0, p1, p2, p3, t);
    const d = Math.hypot(pt.x - px, pt.y - py);
    if (d < bestD) {
      bestD = d;
      bestT = t;
      bestP = pt;
    }
  }
  return { t: bestT, dist: bestD, point: bestP };
}

/** Split a cubic bezier at t using De Casteljau. Returns the in/out handles for the new middle anchor and updated handles for endpoints. */
export function splitBezierAtT(
  a: PathAnchor,
  b: PathAnchor,
  t: number,
): { newA: PathAnchor; newMid: PathAnchor; newB: PathAnchor } {
  const p0 = { x: a.x, y: a.y };
  const p1 = { x: a.x + a.ho_x, y: a.y + a.ho_y };
  const p2 = { x: b.x + b.hi_x, y: b.y + b.hi_y };
  const p3 = { x: b.x, y: b.y };
  const u = 1 - t;
  const q0 = { x: u * p0.x + t * p1.x, y: u * p0.y + t * p1.y };
  const q1 = { x: u * p1.x + t * p2.x, y: u * p1.y + t * p2.y };
  const q2 = { x: u * p2.x + t * p3.x, y: u * p2.y + t * p3.y };
  const r0 = { x: u * q0.x + t * q1.x, y: u * q0.y + t * q1.y };
  const r1 = { x: u * q1.x + t * q2.x, y: u * q1.y + t * q2.y };
  const m = { x: u * r0.x + t * r1.x, y: u * r0.y + t * r1.y };
  return {
    newA: { ...a, ho_x: q0.x - a.x, ho_y: q0.y - a.y },
    newMid: { x: m.x, y: m.y, hi_x: r0.x - m.x, hi_y: r0.y - m.y, ho_x: r1.x - m.x, ho_y: r1.y - m.y },
    newB: { ...b, hi_x: q2.x - b.x, hi_y: q2.y - b.y },
  };
}

// ---------- Migration: legacy shape kinds → path ----------

/** Build a path representing a (possibly rounded) rectangle with origin (0,0) and given size. */
export function rectPath(width: number, height: number, radius = 0): PathProps {
  const r = Math.max(0, Math.min(radius, Math.min(width, height) / 2));
  if (r <= 0) {
    return {
      fill_rule: "nonzero",
      subpaths: [
        {
          closed: true,
          anchors: [
            makeAnchor(0, 0),
            makeAnchor(width, 0),
            makeAnchor(width, height),
            makeAnchor(0, height),
          ],
        },
      ],
    };
  }
  // 8-anchor rounded rectangle. Each corner is two anchors with bezier handles.
  const k = r * KAPPA;
  return {
    fill_rule: "nonzero",
    subpaths: [
      {
        closed: true,
        anchors: [
          // top edge: top-left → top-right
          makeAnchor(r, 0, null, null),
          makeAnchor(width - r, 0, null, { x: k, y: 0 }),
          // top-right corner curve to right edge
          makeAnchor(width, r, { x: 0, y: -k }, null),
          // right edge: top-right → bottom-right
          makeAnchor(width, height - r, null, { x: 0, y: k }),
          // bottom-right corner
          makeAnchor(width - r, height, { x: k, y: 0 }, null),
          // bottom edge
          makeAnchor(r, height, null, { x: -k, y: 0 }),
          // bottom-left corner
          makeAnchor(0, height - r, { x: 0, y: k }, null),
          // left edge
          makeAnchor(0, r, null, { x: 0, y: -k }),
        ],
      },
    ],
  };
}

/** Ellipse inscribed in (0,0)..(w,h). 4-anchor approximation with kappa. */
export function ellipsePath(width: number, height: number): PathProps {
  const cx = width / 2;
  const cy = height / 2;
  const rx = width / 2;
  const ry = height / 2;
  const ox = rx * KAPPA;
  const oy = ry * KAPPA;
  return {
    fill_rule: "nonzero",
    subpaths: [
      {
        closed: true,
        anchors: [
          makeAnchor(cx, 0, { x: -ox, y: 0 }, { x: ox, y: 0 }),
          makeAnchor(width, cy, { x: 0, y: -oy }, { x: 0, y: oy }),
          makeAnchor(cx, height, { x: ox, y: 0 }, { x: -ox, y: 0 }),
          makeAnchor(0, cy, { x: 0, y: oy }, { x: 0, y: -oy }),
        ],
      },
    ],
  };
}

/** Horizontal line spanning width at vertical center; layer height represents stroke caliber, but path uses a single y. */
export function linePath(width: number, height: number): PathProps {
  const y = height / 2;
  return {
    fill_rule: "nonzero",
    subpaths: [
      {
        closed: false,
        anchors: [makeAnchor(0, y), makeAnchor(width, y)],
      },
    ],
  };
}

/**
 * Convert a legacy shape layer to a path-kind shape layer in place. Mutation-safe
 * (returns a new layer object). Idempotent: if already path, returns layer unchanged.
 */
export function migrateShapeLayerToPath(layer: Layer): Layer {
  if (layer.type !== "shape" || !layer.shape_props) return layer;
  const sp = layer.shape_props;
  if (sp.kind === "path" && sp.path_props) return layer;

  let pathProps: PathProps;
  switch (sp.kind) {
    case "rect":
      pathProps = rectPath(layer.width, layer.height, 0);
      break;
    case "rounded-rect":
      pathProps = rectPath(layer.width, layer.height, sp.corner_radius);
      break;
    case "circle":
      pathProps = ellipsePath(layer.width, layer.height);
      break;
    case "line":
      pathProps = linePath(layer.width, layer.height);
      break;
    case "path":
      // already path but missing path_props — fall back to a unit rect
      pathProps = rectPath(layer.width, layer.height, sp.corner_radius);
      break;
    default:
      pathProps = rectPath(layer.width, layer.height, 0);
  }

  // Lines (open paths) historically had stroke without fill; preserve.
  const newSp: ShapeProps = {
    ...sp,
    kind: "path",
    path_props: pathProps,
    // Carry sensible stroke defaults if missing.
    stroke_alignment: sp.stroke_alignment ?? "center",
    stroke_linecap: sp.stroke_linecap ?? "butt",
    stroke_linejoin: sp.stroke_linejoin ?? "miter",
    stroke_miter_limit: sp.stroke_miter_limit ?? 4,
    stroke_dash: sp.stroke_dash ?? [],
  };
  return { ...layer, shape_props: newSp };
}

/** Run migration over an entire scene's layers. */
export function migrateSceneShapes<T extends { layers: Layer[] }>(scene: T): T {
  return {
    ...scene,
    layers: scene.layers.map(migrateShapeLayerToPath),
  };
}
