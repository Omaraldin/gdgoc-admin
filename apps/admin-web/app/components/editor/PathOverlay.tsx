/**
 * PathOverlay — HTML/SVG layer rendered on top of the Konva stage that hosts
 * the Pen tool and Direct-Select tool. Renders anchor squares, handle dots and
 * dotted lines for the currently-edited path layer, and intercepts mouse
 * events when one of those tools is active.
 *
 * Coordinate model:
 *   - The overlay is a `<div>` of size (sceneW * zoom, sceneH * zoom).
 *   - Inside it we render one `<svg>` at viewBox 0 0 sceneW sceneH so we can
 *     work in scene coordinates throughout.
 *   - Each path layer has its own local origin. We translate into local space
 *     using `layer.x - w/2, layer.y - h/2` and apply rotation around center.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Layer as LayerModel, PathAnchor, PathProps, ShapeProps } from "~/lib/types";
import {
  closestPointOnSegment,
  computePathBounds,
  makeAnchor,
  normalizePathOrigin,
  pathPropsToSvgD,
  splitBezierAtT,
} from "~/lib/pathUtils";
import { nanoid } from "~/lib/utils";
import { snapPoint } from "./snap";

export type ToolMode = "select" | "pen" | "direct-select";

interface PathOverlayProps {
  toolMode: ToolMode;
  setToolMode: (m: ToolMode) => void;
  scene: { width: number; height: number; layers: LayerModel[] };
  zoom: number;
  selectedId: string | null;
  setSelectedId: (id: string | null) => void;
  /** Called whenever a layer's geometry (path / x / y / width / height) is mutated. */
  updateLayer: (id: string, u: Partial<LayerModel>) => void;
  /** Called when the Pen tool creates a new shape layer. */
  addPathLayer: (layer: LayerModel) => void;
  setGuides: React.Dispatch<React.SetStateAction<{ vertical: number[]; horizontal: number[] }>>;
}

// Reference to a specific anchor in a layer's path.
interface AnchorRef {
  layerId: string;
  subIdx: number;
  anchorIdx: number;
}

interface DragState {
  kind: "anchor" | "handle-in" | "handle-out" | "new-handle";
  ref: AnchorRef;
  // Original anchor coords (path-local) at drag start.
  startX: number;
  startY: number;
  // Pointer scene coords at drag start.
  pointerStartX: number;
  pointerStartY: number;
  /** Hold alt to break symmetry (default: smooth handle = symmetric mirror). */
  altPressed: boolean;
}

const ANCHOR_SIZE = 8;
const HANDLE_SIZE = 6;

export function PathOverlay({
  toolMode,
  setToolMode,
  scene,
  zoom,
  selectedId,
  setSelectedId,
  updateLayer,
  addPathLayer,
  setGuides,
}: PathOverlayProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  // Active path being authored with Pen tool. null = none in progress.
  const [penLayerId, setPenLayerId] = useState<string | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [penCursor, setPenCursor] = useState<{ x: number; y: number } | null>(null);
  const [hoverSegment, setHoverSegment] = useState<{ subIdx: number; segIdx: number } | null>(null);

  // ------- Pointer math -------

  const eventToScene = useCallback(
    (e: { clientX: number; clientY: number }): { x: number; y: number } => {
      const el = overlayRef.current;
      if (!el) return { x: 0, y: 0 };
      const rect = el.getBoundingClientRect();
      return {
        x: (e.clientX - rect.left) / zoom,
        y: (e.clientY - rect.top) / zoom,
      };
    },
    [zoom],
  );

  /** Convert scene coords into a layer's local path-coords (accounts for translation, rotation). */
  const sceneToLocal = useCallback(
    (layer: LayerModel, sx: number, sy: number): { x: number; y: number } => {
      const w = layer.width;
      const h = layer.height;
      // Layer local origin (top-left) in scene coords (no rotation):
      // (layer.x - w/2, layer.y - h/2). Rotation pivots around (layer.x, layer.y).
      const cx = layer.x;
      const cy = layer.y;
      const dx = sx - cx;
      const dy = sy - cy;
      const rad = ((-layer.rotation || 0) * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      const lx = dx * cos - dy * sin + w / 2;
      const ly = dx * sin + dy * cos + h / 2;
      return { x: lx, y: ly };
    },
    [],
  );

  /** Convert layer-local path coords into scene coords. */
  const localToScene = useCallback(
    (layer: LayerModel, lx: number, ly: number): { x: number; y: number } => {
      const w = layer.width;
      const h = layer.height;
      const offX = lx - w / 2;
      const offY = ly - h / 2;
      const rad = ((layer.rotation || 0) * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      return {
        x: layer.x + offX * cos - offY * sin,
        y: layer.y + offX * sin + offY * cos,
      };
    },
    [],
  );

  // ------- Selected layer (path) -------

  const selectedLayer = useMemo(
    () => scene.layers.find((l) => l.id === selectedId) ?? null,
    [scene.layers, selectedId],
  );

  type PathLayer = LayerModel & { shape_props: NonNullable<LayerModel["shape_props"]> & { path_props: NonNullable<NonNullable<LayerModel["shape_props"]>["path_props"]> } };
  const isPathLayer = (l: LayerModel | null | undefined): l is PathLayer =>
    !!l && l.type === "shape" && l.shape_props?.kind === "path" && !!l.shape_props.path_props;

  /** Layer to show anchors for: pen-tool's authoring layer takes priority. */
  const editLayer = useMemo(() => {
    if (penLayerId) {
      const l = scene.layers.find((x) => x.id === penLayerId);
      if (isPathLayer(l)) return l;
    }
    if (toolMode === "direct-select" && isPathLayer(selectedLayer)) return selectedLayer;
    return null;
  }, [penLayerId, scene.layers, selectedLayer, toolMode]);

  // ------- Mutation helper: re-normalize bounds after path edit -------

  const writePath = useCallback(
    (layerId: string, newPath: PathProps) => {
      const layer = scene.layers.find((l) => l.id === layerId);
      if (!layer || !layer.shape_props) return;
      const norm = normalizePathOrigin(newPath);
      const cos = Math.cos(((layer.rotation || 0) * Math.PI) / 180);
      const sin = Math.sin(((layer.rotation || 0) * Math.PI) / 180);
      // The shift `(dx, dy)` happened in the layer's *local* frame. To keep the
      // visual geometry in place we move layer.x/y by the rotated equivalent
      // and grow w/h to the new bounds.
      const newW = Math.max(1, norm.width);
      const newH = Math.max(1, norm.height);
      // Old top-left in scene coords: (layer.x - w/2, layer.y - h/2) rotated.
      // New top-left in scene coords sits at old + (dx, dy) in local frame.
      const localShiftX = norm.dx + (newW - layer.width) / 2;
      const localShiftY = norm.dy + (newH - layer.height) / 2;
      const dxScene = localShiftX * cos - localShiftY * sin;
      const dyScene = localShiftX * sin + localShiftY * cos;
      updateLayer(layerId, {
        x: layer.x + dxScene,
        y: layer.y + dyScene,
        width: newW,
        height: newH,
        shape_props: { ...layer.shape_props, path_props: norm.props },
      });
    },
    [scene.layers, updateLayer],
  );

  // ------- Pen tool: clicking the empty stage area -------

  const handleBackgroundMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (toolMode !== "pen") return;
      e.stopPropagation();
      const scenePt = eventToScene(e);

      if (!penLayerId) {
        // Start a new path layer with one anchor at the click.
        const id = nanoid();
        const newLayer: LayerModel = {
          id,
          type: "shape",
          z_index: scene.layers.length,
          x: scenePt.x,
          y: scenePt.y,
          width: 1,
          height: 1,
          rotation: 0,
          visible: true,
          shape_props: makeDefaultPathShapeProps([
            {
              closed: false,
              anchors: [makeAnchor(0.5, 0.5)],
            },
          ]),
        };
        addPathLayer(newLayer);
        setPenLayerId(id);
        setSelectedId(id);
        // Begin a "new-handle" drag: dragging immediately defines the first handle out.
        setDrag({
          kind: "new-handle",
          ref: { layerId: id, subIdx: 0, anchorIdx: 0 },
          startX: 0.5,
          startY: 0.5,
          pointerStartX: scenePt.x,
          pointerStartY: scenePt.y,
          altPressed: e.altKey,
        });
        return;
      }

      // Continuing an existing pen path.
      const layer = scene.layers.find((l) => l.id === penLayerId);
      if (!isPathLayer(layer)) return;
      const local = sceneToLocal(layer, scenePt.x, scenePt.y);
      const path = layer.shape_props.path_props!;
      const sub = path.subpaths[0]!;

      // Closing: clicking near the first anchor closes the path.
      const first = sub.anchors[0]!;
      const closeDist = Math.hypot(first.x - local.x, first.y - local.y);
      if (sub.anchors.length >= 2 && closeDist < 8 / zoom) {
        const newPath: PathProps = {
          ...path,
          subpaths: path.subpaths.map((sp, i) =>
            i === 0 ? { ...sp, closed: true } : sp,
          ),
        };
        writePath(layer.id, newPath);
        setPenLayerId(null);
        return;
      }

      // Append a new anchor.
      const newAnchorIdx = sub.anchors.length;
      const newPath: PathProps = {
        ...path,
        subpaths: path.subpaths.map((sp, i) =>
          i === 0
            ? { ...sp, anchors: [...sp.anchors, makeAnchor(local.x, local.y)] }
            : sp,
        ),
      };
      writePath(layer.id, newPath);
      // Drag from this new anchor sets its handle_out (and mirrored handle_in).
      setDrag({
        kind: "new-handle",
        ref: { layerId: layer.id, subIdx: 0, anchorIdx: newAnchorIdx },
        startX: local.x,
        startY: local.y,
        pointerStartX: scenePt.x,
        pointerStartY: scenePt.y,
        altPressed: e.altKey,
      });
    },
    [
      addPathLayer,
      eventToScene,
      penLayerId,
      scene.layers,
      sceneToLocal,
      setSelectedId,
      toolMode,
      writePath,
      zoom,
    ],
  );

  // Finish pen path on Escape / Enter.
  useEffect(() => {
    if (!penLayerId) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.key === "Escape" || e.key === "Enter") {
        e.preventDefault();
        setPenLayerId(null);
        setToolMode("select");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [penLayerId, setToolMode]);

  // ------- Direct select: anchor + handle dragging -------

  const startAnchorDrag = (
    kind: DragState["kind"],
    ref: AnchorRef,
    sceneStart: { x: number; y: number },
    altPressed: boolean,
  ) => {
    const layer = scene.layers.find((l) => l.id === ref.layerId);
    if (!isPathLayer(layer)) return;
    const a = layer.shape_props.path_props!.subpaths[ref.subIdx]!.anchors[ref.anchorIdx]!;
    setDrag({
      kind,
      ref,
      startX: kind === "handle-in" ? a.hi_x : kind === "handle-out" ? a.ho_x : a.x,
      startY: kind === "handle-in" ? a.hi_y : kind === "handle-out" ? a.ho_y : a.y,
      pointerStartX: sceneStart.x,
      pointerStartY: sceneStart.y,
      altPressed,
    });
  };

  // Global pointermove / pointerup while dragging.
  useEffect(() => {
    if (!drag) return;
    const onMove = (e: PointerEvent) => {
      const layer = scene.layers.find((l) => l.id === drag.ref.layerId);
      if (!isPathLayer(layer)) return;
      const scenePt = eventToScene(e);
      // Convert delta to local-frame delta (account for rotation).
      const startLocal = sceneToLocal(layer, drag.pointerStartX, drag.pointerStartY);
      const curLocal = sceneToLocal(layer, scenePt.x, scenePt.y);
      const dx = curLocal.x - startLocal.x;
      const dy = curLocal.y - startLocal.y;

      const path = layer.shape_props.path_props!;
      const sub = path.subpaths[drag.ref.subIdx]!;
      const a = sub.anchors[drag.ref.anchorIdx]!;

      let updatedAnchor: PathAnchor = a;
      if (drag.kind === "anchor") {
        let nx = drag.startX + dx;
        let ny = drag.startY + dy;
        // Convert candidate local position → scene, snap, convert back.
        const candidateScene = localToScene(layer, nx, ny);
        const snapped = snapPoint(
          candidateScene.x,
          candidateScene.y,
          layer.id,
          scene.layers,
          scene.width,
          scene.height,
          zoom,
        );
        setGuides(snapped.guides);
        if (snapped.x !== candidateScene.x || snapped.y !== candidateScene.y) {
          const snappedLocal = sceneToLocal(layer, snapped.x, snapped.y);
          nx = snappedLocal.x;
          ny = snappedLocal.y;
        }
        updatedAnchor = { ...a, x: nx, y: ny };
      } else if (drag.kind === "handle-out" || drag.kind === "new-handle") {
        const ox = drag.startX + dx;
        const oy = drag.startY + dy;
        // For new-handle (created via Pen drag), startX/Y is the anchor point —
        // the "delta from the anchor" IS the handle vector.
        const hx = drag.kind === "new-handle" ? dx : ox;
        const hy = drag.kind === "new-handle" ? dy : oy;
        updatedAnchor = { ...a, ho_x: hx, ho_y: hy };
        // If smooth (not alt), mirror to handle-in. Use live e.altKey so
        // the user can break symmetry mid-drag by pressing/releasing Alt.
        if (!e.altKey) {
          updatedAnchor.hi_x = -hx;
          updatedAnchor.hi_y = -hy;
        }
      } else if (drag.kind === "handle-in") {
        const hx = drag.startX + dx;
        const hy = drag.startY + dy;
        updatedAnchor = { ...a, hi_x: hx, hi_y: hy };
        if (!e.altKey) {
          updatedAnchor.ho_x = -hx;
          updatedAnchor.ho_y = -hy;
        }
      }

      const newPath: PathProps = {
        ...path,
        subpaths: path.subpaths.map((sp, i) =>
          i === drag.ref.subIdx
            ? {
                ...sp,
                anchors: sp.anchors.map((aa, ai) =>
                  ai === drag.ref.anchorIdx ? updatedAnchor : aa,
                ),
              }
            : sp,
        ),
      };
      // Direct path mutation (no re-normalization) during drag → keeps origin
      // stable so handles don't jitter. We re-normalize on drag end below.
      const updatedSp: ShapeProps = { ...layer.shape_props!, path_props: newPath };
      updateLayer(layer.id, { shape_props: updatedSp });
    };
    const onUp = () => {
      setGuides({ vertical: [], horizontal: [] });
      // Re-normalize once at the end of the drag.
      const layer = scene.layers.find((l) => l.id === drag.ref.layerId);
      if (isPathLayer(layer)) {
        // Don't normalize while pen is drawing — keeps coordinate frame stable
        // for subsequent clicks. We normalize when pen completes.
        if (toolMode !== "pen") {
          writePath(layer.id, layer.shape_props.path_props!);
        }
      }
      setDrag(null);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [drag, eventToScene, sceneToLocal, scene.layers, toolMode, updateLayer, writePath]);

  // ------- Anchor / segment commands -------

  const deleteAnchor = (ref: AnchorRef) => {
    const layer = scene.layers.find((l) => l.id === ref.layerId);
    if (!isPathLayer(layer)) return;
    const path = layer.shape_props.path_props!;
    const newSubs = path.subpaths
      .map((sp, i) =>
        i === ref.subIdx
          ? {
              ...sp,
              anchors: sp.anchors.filter((_, ai) => ai !== ref.anchorIdx),
            }
          : sp,
      )
      .filter((sp) => sp.anchors.length > 0);
    if (newSubs.length === 0) return; // refuse to leave an empty path
    writePath(layer.id, { ...path, subpaths: newSubs });
  };

  const toggleSmoothCorner = (ref: AnchorRef) => {
    const layer = scene.layers.find((l) => l.id === ref.layerId);
    if (!isPathLayer(layer)) return;
    const path = layer.shape_props.path_props!;
    const sub = path.subpaths[ref.subIdx]!;
    const a = sub.anchors[ref.anchorIdx]!;
    const isCorner = a.hi_x === 0 && a.hi_y === 0 && a.ho_x === 0 && a.ho_y === 0;
    let newAnchor: PathAnchor;
    if (isCorner) {
      // Convert corner → smooth: handles tangent to neighbours.
      const prev = sub.anchors[(ref.anchorIdx - 1 + sub.anchors.length) % sub.anchors.length]!;
      const next = sub.anchors[(ref.anchorIdx + 1) % sub.anchors.length]!;
      const tx = (next.x - prev.x) / 4;
      const ty = (next.y - prev.y) / 4;
      newAnchor = { ...a, hi_x: -tx, hi_y: -ty, ho_x: tx, ho_y: ty };
    } else {
      newAnchor = { ...a, hi_x: 0, hi_y: 0, ho_x: 0, ho_y: 0 };
    }
    writePath(layer.id, {
      ...path,
      subpaths: path.subpaths.map((sp, i) =>
        i === ref.subIdx
          ? {
              ...sp,
              anchors: sp.anchors.map((aa, ai) => (ai === ref.anchorIdx ? newAnchor : aa)),
            }
          : sp,
      ),
    });
  };

  /** Add an anchor on a segment at the given pointer scene-coords. */
  const addAnchorOnSegment = (sceneX: number, sceneY: number) => {
    if (!isPathLayer(editLayer)) return;
    const local = sceneToLocal(editLayer, sceneX, sceneY);
    const path = editLayer.shape_props.path_props!;
    let best: { subIdx: number; segIdx: number; t: number; dist: number } | null = null;
    for (let si = 0; si < path.subpaths.length; si++) {
      const sp = path.subpaths[si]!;
      const segCount = sp.closed ? sp.anchors.length : sp.anchors.length - 1;
      for (let ai = 0; ai < segCount; ai++) {
        const a = sp.anchors[ai]!;
        const b = sp.anchors[(ai + 1) % sp.anchors.length]!;
        const r = closestPointOnSegment(a, b, local.x, local.y);
        if (!best || r.dist < best.dist) {
          best = { subIdx: si, segIdx: ai, t: r.t, dist: r.dist };
        }
      }
    }
    if (!best || best.dist > 12 / zoom) return;
    const sub = path.subpaths[best.subIdx]!;
    const a = sub.anchors[best.segIdx]!;
    const b = sub.anchors[(best.segIdx + 1) % sub.anchors.length]!;
    const split = splitBezierAtT(a, b, best.t);
    const newAnchors = [...sub.anchors];
    newAnchors[best.segIdx] = split.newA;
    const insertAt = best.segIdx + 1;
    newAnchors.splice(insertAt, 0, split.newMid);
    if (best.segIdx + 1 < sub.anchors.length) {
      newAnchors[insertAt + 1] = split.newB;
    } else {
      // wrap (closed): the b is the first anchor
      newAnchors[0] = split.newB;
    }
    writePath(editLayer.id, {
      ...path,
      subpaths: path.subpaths.map((sp, i) =>
        i === best!.subIdx ? { ...sp, anchors: newAnchors } : sp,
      ),
    });
  };

  // Delete-key removes selected anchor — but we don't track an "active anchor"
  // selection here; for v1 we instead expose Alt-click on an anchor to delete.

  // ------- Mouse move: pen preview + segment hover -------

  const handleOverlayMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (toolMode === "select") return;
      const scenePt = eventToScene(e);
      if (penLayerId) {
        setPenCursor(scenePt);
      }
      if (toolMode === "direct-select" && isPathLayer(editLayer) && !drag) {
        const local = sceneToLocal(editLayer, scenePt.x, scenePt.y);
        const path = editLayer.shape_props.path_props!;
        let best: { subIdx: number; segIdx: number; dist: number } | null = null;
        for (let si = 0; si < path.subpaths.length; si++) {
          const sp = path.subpaths[si]!;
          const segCount = sp.closed ? sp.anchors.length : sp.anchors.length - 1;
          for (let ai = 0; ai < segCount; ai++) {
            const a = sp.anchors[ai]!;
            const b = sp.anchors[(ai + 1) % sp.anchors.length]!;
            const r = closestPointOnSegment(a, b, local.x, local.y);
            if (!best || r.dist < best.dist) {
              best = { subIdx: si, segIdx: ai, dist: r.dist };
            }
          }
        }
        setHoverSegment(best && best.dist < 12 / zoom ? { subIdx: best.subIdx, segIdx: best.segIdx } : null);
      } else if (!penLayerId) {
        setHoverSegment(null);
      }
    },
    [drag, editLayer, eventToScene, penLayerId, sceneToLocal, toolMode, zoom],
  );

  // ------- Render -------

  const overlayActive = toolMode !== "select";
  const showHandles = !!editLayer;

  return (
    <div
      ref={overlayRef}
      style={{
        position: "absolute",
        inset: 0,
        width: scene.width * zoom,
        height: scene.height * zoom,
        cursor: toolMode === "pen" ? "crosshair" : toolMode === "direct-select" ? "default" : "default",
        pointerEvents: overlayActive ? "auto" : "none",
      }}
      onMouseDown={handleBackgroundMouseDown}
      onMouseMove={handleOverlayMouseMove}
      onMouseLeave={() => { setPenCursor(null); setHoverSegment(null); }}
    >
      {showHandles && editLayer && isPathLayer(editLayer) && (
        <svg
          viewBox={`0 0 ${scene.width} ${scene.height}`}
          width={scene.width * zoom}
          height={scene.height * zoom}
          style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
        >
          <PathHandles
            layer={editLayer}
            zoom={zoom}
            localToScene={localToScene}
            onAnchorMouseDown={(ref, scenePt, e) => {
              e.stopPropagation();
              if (e.altKey && toolMode === "direct-select") {
                // Alt-click anchor in direct-select → toggle smooth/corner.
                toggleSmoothCorner(ref);
                return;
              }
              if ((e as React.MouseEvent).shiftKey) {
                deleteAnchor(ref);
                return;
              }
              startAnchorDrag("anchor", ref, scenePt, e.altKey);
            }}
            onHandleInMouseDown={(ref, scenePt, e) => {
              e.stopPropagation();
              startAnchorDrag("handle-in", ref, scenePt, e.altKey);
            }}
            onHandleOutMouseDown={(ref, scenePt, e) => {
              e.stopPropagation();
              startAnchorDrag("handle-out", ref, scenePt, e.altKey);
            }}
            onSegmentDoubleClick={(scenePt) => {
              addAnchorOnSegment(scenePt.x, scenePt.y);
            }}
            penInProgress={penLayerId === editLayer.id}
            hoverSegment={hoverSegment}
          />
          {penLayerId === editLayer.id && penCursor && (
            <PenPreview
              layer={editLayer}
              localToScene={localToScene}
              cursorScene={penCursor}
              zoom={zoom}
            />
          )}
        </svg>
      )}
    </div>
  );
}

// ---------- Render anchors + handles for one path layer ----------

function PathHandles({
  layer,
  zoom,
  localToScene,
  onAnchorMouseDown,
  onHandleInMouseDown,
  onHandleOutMouseDown,
  onSegmentDoubleClick,
  penInProgress,
  hoverSegment,
}: {
  layer: LayerModel;
  zoom: number;
  localToScene: (layer: LayerModel, lx: number, ly: number) => { x: number; y: number };
  onAnchorMouseDown: (
    ref: AnchorRef,
    scenePt: { x: number; y: number },
    e: React.MouseEvent,
  ) => void;
  onHandleInMouseDown: (
    ref: AnchorRef,
    scenePt: { x: number; y: number },
    e: React.MouseEvent,
  ) => void;
  onHandleOutMouseDown: (
    ref: AnchorRef,
    scenePt: { x: number; y: number },
    e: React.MouseEvent,
  ) => void;
  onSegmentDoubleClick: (scenePt: { x: number; y: number }) => void;
  penInProgress: boolean;
  hoverSegment?: { subIdx: number; segIdx: number } | null;
}) {
  const path = layer.shape_props!.path_props!;
  const aSize = ANCHOR_SIZE / zoom;
  const hSize = HANDLE_SIZE / zoom;
  const stroke = 1 / zoom;

  // Build segment-highlight element for hovered segment in direct-select.
  let segmentHighlightEl: React.ReactNode = null;
  if (hoverSegment) {
    const sp = path.subpaths[hoverSegment.subIdx];
    if (sp) {
      const a = sp.anchors[hoverSegment.segIdx];
      const b = sp.anchors[(hoverSegment.segIdx + 1) % sp.anchors.length];
      if (a && b) {
        const d = `M ${a.x} ${a.y} C ${a.x + a.ho_x} ${a.y + a.ho_y} ${b.x + b.hi_x} ${b.y + b.hi_y} ${b.x} ${b.y}`;
        segmentHighlightEl = (
          <g
            transform={`translate(${layer.x} ${layer.y}) rotate(${layer.rotation || 0}) translate(${-layer.width / 2} ${-layer.height / 2})`}
            pointerEvents="none"
          >
            <path d={d} fill="none" stroke="#0099ff" strokeWidth={3 * stroke} opacity={0.45} />
          </g>
        );
      }
    }
  }

  const eventToScene = (e: React.MouseEvent): { x: number; y: number } => {
    // <svg> uses viewBox in scene coords, so currentTarget's CTM gives us
    // the conversion. Simpler: walk up to the parent overlay and use its rect.
    const svg =
      ((e.currentTarget as SVGElement).ownerSVGElement as SVGSVGElement | null) ??
      (e.currentTarget as unknown as SVGSVGElement);
    const rect = svg.getBoundingClientRect();
    const vb = svg.viewBox?.baseVal;
    const sx = ((e.clientX - rect.left) / rect.width) * (vb?.width || 1);
    const sy = ((e.clientY - rect.top) / rect.height) * (vb?.height || 1);
    return { x: sx, y: sy };
  };

  return (
    <g>
      {/* Outline of the path itself, for visual reference. */}
      <PathOutline layer={layer} stroke={stroke} />
      {segmentHighlightEl}

      {path.subpaths.map((sp, si) => (
        <g key={si}>
          {sp.anchors.map((a, ai) => {
            const anchorScene = localToScene(layer, a.x, a.y);
            const hasHi = a.hi_x !== 0 || a.hi_y !== 0;
            const hasHo = a.ho_x !== 0 || a.ho_y !== 0;
            const inScene = hasHi
              ? localToScene(layer, a.x + a.hi_x, a.y + a.hi_y)
              : null;
            const outScene = hasHo
              ? localToScene(layer, a.x + a.ho_x, a.y + a.ho_y)
              : null;
            const isFirst = ai === 0 && penInProgress;
            const isSmooth = hasHi || hasHo;
            return (
              <g key={ai}>
                {inScene && (
                  <>
                    <line
                      x1={anchorScene.x}
                      y1={anchorScene.y}
                      x2={inScene.x}
                      y2={inScene.y}
                      stroke="#0099ff"
                      strokeWidth={stroke}
                      strokeDasharray={`${2 / zoom} ${2 / zoom}`}
                      pointerEvents="none"
                    />
                    <circle
                      cx={inScene.x}
                      cy={inScene.y}
                      r={hSize / 2}
                      fill="#ffffff"
                      stroke="#0099ff"
                      strokeWidth={stroke}
                      style={{ cursor: "move", pointerEvents: "auto" }}
                      onMouseDown={(e) =>
                        onHandleInMouseDown(
                          { layerId: layer.id, subIdx: si, anchorIdx: ai },
                          eventToScene(e),
                          e,
                        )
                      }
                    />
                  </>
                )}
                {outScene && (
                  <>
                    <line
                      x1={anchorScene.x}
                      y1={anchorScene.y}
                      x2={outScene.x}
                      y2={outScene.y}
                      stroke="#0099ff"
                      strokeWidth={stroke}
                      strokeDasharray={`${2 / zoom} ${2 / zoom}`}
                      pointerEvents="none"
                    />
                    <circle
                      cx={outScene.x}
                      cy={outScene.y}
                      r={hSize / 2}
                      fill="#ffffff"
                      stroke="#0099ff"
                      strokeWidth={stroke}
                      style={{ cursor: "move", pointerEvents: "auto" }}
                      onMouseDown={(e) =>
                        onHandleOutMouseDown(
                          { layerId: layer.id, subIdx: si, anchorIdx: ai },
                          eventToScene(e),
                          e,
                        )
                      }
                    />
                  </>
                )}
                {/* Anchor: circle = smooth, square = corner */}
                {isSmooth ? (
                  <circle
                    cx={anchorScene.x}
                    cy={anchorScene.y}
                    r={aSize / 2}
                    fill={isFirst ? "#ffeb3b" : "#ffffff"}
                    stroke="#0099ff"
                    strokeWidth={stroke}
                    style={{ cursor: "move", pointerEvents: "auto" }}
                    onMouseDown={(e) =>
                      onAnchorMouseDown(
                        { layerId: layer.id, subIdx: si, anchorIdx: ai },
                        eventToScene(e),
                        e,
                      )
                    }
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      onSegmentDoubleClick(eventToScene(e));
                    }}
                  />
                ) : (
                  <rect
                    x={anchorScene.x - aSize / 2}
                    y={anchorScene.y - aSize / 2}
                    width={aSize}
                    height={aSize}
                    fill={isFirst ? "#ffeb3b" : "#ffffff"}
                    stroke="#0099ff"
                    strokeWidth={stroke}
                    style={{ cursor: "move", pointerEvents: "auto" }}
                    onMouseDown={(e) =>
                      onAnchorMouseDown(
                        { layerId: layer.id, subIdx: si, anchorIdx: ai },
                        eventToScene(e),
                        e,
                      )
                    }
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      onSegmentDoubleClick(eventToScene(e));
                    }}
                  />
                )}
              </g>
            );
          })}
        </g>
      ))}
    </g>
  );
}

function PathOutline({ layer, stroke }: { layer: LayerModel; stroke: number }) {
  const path = layer.shape_props!.path_props!;
  // Build a transformed SVG path: each anchor coordinate translated/rotated
  // into scene space. Use a transform group instead — simpler.
  const w = layer.width;
  const h = layer.height;
  const cx = layer.x;
  const cy = layer.y;
  const d = pathPropsToSvgD(path);
  return (
    <g
      transform={`translate(${cx} ${cy}) rotate(${layer.rotation || 0}) translate(${-w / 2} ${-h / 2})`}
      pointerEvents="none"
    >
      <path d={d} fill="none" stroke="#0099ff" strokeWidth={stroke} />
    </g>
  );
}

// ---------- Defaults ----------

function makeDefaultPathShapeProps(subpaths: PathProps["subpaths"]): ShapeProps {
  return {
    kind: "path",
    corner_radius: 0,
    fill_type: "solid",
    fill_color: "#4285f4",
    gradient_type: "linear",
    gradient_stops: [
      { offset: 0, color: "#4285f4" },
      { offset: 1, color: "#ea4335" },
    ],
    gradient_angle: 90,
    stroke: true,
    stroke_color: "#1a1a1a",
    stroke_width: 2,
    path_props: { subpaths, fill_rule: "nonzero" },
    stroke_alignment: "center",
    stroke_linecap: "butt",
    stroke_linejoin: "miter",
    stroke_miter_limit: 4,
    stroke_dash: [],
  };
}

// (computePathBounds is imported but we may need it later for Pen tool autocompletion.)
void computePathBounds;

// ---------- Pen preview: dashed curve from last anchor to cursor ----------

type PathLayer = LayerModel & { shape_props: NonNullable<LayerModel["shape_props"]> & { path_props: NonNullable<NonNullable<LayerModel["shape_props"]>["path_props"]> } };

function PenPreview({
  layer,
  localToScene,
  cursorScene,
  zoom,
}: {
  layer: PathLayer;
  localToScene: (layer: LayerModel, lx: number, ly: number) => { x: number; y: number };
  cursorScene: { x: number; y: number };
  zoom: number;
}) {
  const sub = layer.shape_props.path_props.subpaths[0];
  if (!sub || sub.anchors.length === 0) return null;

  const lastA = sub.anchors[sub.anchors.length - 1]!;
  const lastScene = localToScene(layer, lastA.x, lastA.y);
  // Control point 1: last anchor's handle-out (or the anchor itself if none).
  const cp1 = (lastA.ho_x !== 0 || lastA.ho_y !== 0)
    ? localToScene(layer, lastA.x + lastA.ho_x, lastA.y + lastA.ho_y)
    : lastScene;

  // Detect "will close": cursor is near the first anchor.
  const firstA = sub.anchors[0]!;
  const firstScene = localToScene(layer, firstA.x, firstA.y);
  const closeDist = Math.hypot(firstScene.x - cursorScene.x, firstScene.y - cursorScene.y);
  const willClose = sub.anchors.length >= 2 && closeDist < 8 / zoom;

  const stroke = 1 / zoom;
  // Cubic bezier: M lastScene C cp1 cursor cursor  (no incoming handle at cursor yet).
  const d = `M ${lastScene.x} ${lastScene.y} C ${cp1.x} ${cp1.y} ${cursorScene.x} ${cursorScene.y} ${cursorScene.x} ${cursorScene.y}`;

  return (
    <g pointerEvents="none">
      <path
        d={d}
        fill="none"
        stroke="#0099ff"
        strokeWidth={stroke}
        strokeDasharray={`${3 / zoom} ${3 / zoom}`}
        opacity={0.7}
      />
      {/* Cursor dot */}
      <circle cx={cursorScene.x} cy={cursorScene.y} r={3 / zoom} fill={willClose ? "#4caf50" : "#0099ff"} opacity={0.85} />
      {/* Close-path ring */}
      {willClose && (
        <circle
          cx={firstScene.x}
          cy={firstScene.y}
          r={9 / zoom}
          fill="none"
          stroke="#4caf50"
          strokeWidth={1.5 / zoom}
        />
      )}
    </g>
  );
}
