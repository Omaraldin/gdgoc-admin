import type { Layer as LayerModel, PathProps, ShapeProps } from "~/lib/types";
import { nanoid } from "~/lib/utils";

export function readImageDimensions(file: File): Promise<{ w: number; h: number }> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { resolve({ w: img.naturalWidth || 200, h: img.naturalHeight || 200 }); URL.revokeObjectURL(url); };
    img.onerror = () => { resolve({ w: 200, h: 200 }); URL.revokeObjectURL(url); };
    img.src = url;
  });
}

export function transformPathToScene(layer: LayerModel): PathProps {
  const path = layer.shape_props!.path_props!;
  const w = layer.width;
  const h = layer.height;
  const rad = ((layer.rotation || 0) * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const tx = (lx: number, ly: number) => ({
    x: layer.x + (lx - w / 2) * cos - (ly - h / 2) * sin,
    y: layer.y + (lx - w / 2) * sin + (ly - h / 2) * cos,
  });
  const tv = (vx: number, vy: number) => ({ x: vx * cos - vy * sin, y: vx * sin + vy * cos });
  return {
    fill_rule: path.fill_rule,
    subpaths: path.subpaths.map((sp) => ({
      closed: sp.closed,
      anchors: sp.anchors.map((a) => {
        const p = tx(a.x, a.y);
        const hi = tv(a.hi_x, a.hi_y);
        const ho = tv(a.ho_x, a.ho_y);
        return { x: p.x, y: p.y, hi_x: hi.x, hi_y: hi.y, ho_x: ho.x, ho_y: ho.y };
      }),
    })),
  };
}

export function sceneSpacePathToLayer(scenePath: PathProps, baseSp: ShapeProps): LayerModel {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const sp of scenePath.subpaths) {
    for (const a of sp.anchors) {
      for (const xx of [a.x, a.x + a.hi_x, a.x + a.ho_x]) { if (xx < minX) minX = xx; if (xx > maxX) maxX = xx; }
      for (const yy of [a.y, a.y + a.hi_y, a.y + a.ho_y]) { if (yy < minY) minY = yy; if (yy > maxY) maxY = yy; }
    }
  }
  if (!Number.isFinite(minX)) { minX = 0; minY = 0; maxX = 1; maxY = 1; }
  const width = Math.max(1, maxX - minX);
  const height = Math.max(1, maxY - minY);
  const localPath: PathProps = {
    fill_rule: scenePath.fill_rule,
    subpaths: scenePath.subpaths.map((sp) => ({
      closed: sp.closed,
      anchors: sp.anchors.map((a) => ({ x: a.x - minX, y: a.y - minY, hi_x: a.hi_x, hi_y: a.hi_y, ho_x: a.ho_x, ho_y: a.ho_y })),
    })),
  };
  return {
    id: nanoid(),
    type: "shape",
    z_index: 0,
    x: minX + width / 2,
    y: minY + height / 2,
    width,
    height,
    rotation: 0,
    visible: true,
    shape_props: { ...baseSp, kind: "path", path_props: localPath },
  };
}
