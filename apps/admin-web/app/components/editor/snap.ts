import type { Layer as LayerModel } from "~/lib/types";
import type { GuideLines, SnapResult } from "./types";

const SNAP_THRESHOLD = 6;

/** Snap a single point (scene coords) to other anchors / scene edges.
 *  Returns corrected { x, y } and snap guides. */
export function snapPoint(
  sx: number,
  sy: number,
  excludeLayerId: string,
  layers: LayerModel[],
  sceneW: number,
  sceneH: number,
  zoom: number,
): { x: number; y: number; guides: GuideLines } {
  const threshold = SNAP_THRESHOLD / zoom;

  const refX: number[] = [0, sceneW / 2, sceneW];
  const refY: number[] = [0, sceneH / 2, sceneH];

  // Collect all anchor positions from other path layers as ref points.
  for (const l of layers) {
    if (!l.visible) continue;
    if (l.type !== "shape" || l.shape_props?.kind !== "path" || !l.shape_props.path_props) continue;
    const isOwn = l.id === excludeLayerId;
    const rad = ((l.rotation || 0) * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    for (const sp of l.shape_props.path_props.subpaths) {
      for (const a of sp.anchors) {
        // Convert anchor local → scene.
        const offX = a.x - l.width / 2;
        const offY = a.y - l.height / 2;
        const ax = l.x + offX * cos - offY * sin;
        const ay = l.y + offX * sin + offY * cos;
        // Skip the anchor being dragged by checking coordinates proximity.
        // We add all anchors from other layers; for own layer they serve as
        // snap targets too (useful for aligning anchors within same path).
        void isOwn;
        refX.push(ax);
        refY.push(ay);
      }
    }
  }

  let snapX: number | null = null;
  let guideX: number | null = null;
  let minDX = threshold;
  for (const rx of refX) {
    const d = Math.abs(sx - rx);
    if (d < minDX) { minDX = d; snapX = rx; guideX = rx; }
  }

  let snapY: number | null = null;
  let guideY: number | null = null;
  let minDY = threshold;
  for (const ry of refY) {
    const d = Math.abs(sy - ry);
    if (d < minDY) { minDY = d; snapY = ry; guideY = ry; }
  }

  return {
    x: snapX ?? sx,
    y: snapY ?? sy,
    guides: {
      vertical: guideX !== null ? [guideX] : [],
      horizontal: guideY !== null ? [guideY] : [],
    },
  };
}

export function computeSnap(
  cx: number,
  cy: number,
  w: number,
  h: number,
  draggedId: string,
  layers: LayerModel[],
  sceneW: number,
  sceneH: number,
): SnapResult {
  const refX: number[] = [0, sceneW / 2, sceneW];
  const refY: number[] = [0, sceneH / 2, sceneH];

  for (const l of layers) {
    if (l.id === draggedId || !l.visible) continue;
    refX.push(l.x - l.width / 2, l.x, l.x + l.width / 2);
    refY.push(l.y - l.height / 2, l.y, l.y + l.height / 2);
  }

  const nodeLeft = cx - w / 2;
  const nodeRight = cx + w / 2;

  let snapX: number | null = null;
  let guideX: number | null = null;
  let minDX = SNAP_THRESHOLD;

  for (const rx of refX) {
    let d = Math.abs(nodeLeft - rx);
    if (d < minDX) { minDX = d; snapX = rx + w / 2; guideX = rx; }
    d = Math.abs(cx - rx);
    if (d < minDX) { minDX = d; snapX = rx; guideX = rx; }
    d = Math.abs(nodeRight - rx);
    if (d < minDX) { minDX = d; snapX = rx - w / 2; guideX = rx; }
  }

  const nodeTop = cy - h / 2;
  const nodeBottom = cy + h / 2;

  let snapY: number | null = null;
  let guideY: number | null = null;
  let minDY = SNAP_THRESHOLD;

  for (const ry of refY) {
    let d = Math.abs(nodeTop - ry);
    if (d < minDY) { minDY = d; snapY = ry + h / 2; guideY = ry; }
    d = Math.abs(cy - ry);
    if (d < minDY) { minDY = d; snapY = ry; guideY = ry; }
    d = Math.abs(nodeBottom - ry);
    if (d < minDY) { minDY = d; snapY = ry - h / 2; guideY = ry; }
  }

  return {
    snapX,
    snapY,
    guides: {
      vertical: guideX !== null ? [guideX] : [],
      horizontal: guideY !== null ? [guideY] : [],
    },
  };
}
