/**
 * PathRenderer — renders a path-kind shape layer on a Konva stage.
 *
 * Stroke alignment is implemented manually via Path2D + ctx.clip, since Konva
 * (like Canvas2D) only supports center-aligned strokes natively. We render:
 *   1. A Konva.Path for fill + hit testing + center-aligned stroke (default).
 *   2. An optional auxiliary Konva.Shape for inside/outside-aligned stroke,
 *      drawn at 2× width and clipped to the desired half.
 */

import { useMemo } from "react";
import { Path as KonvaPath, Shape, Transformer } from "react-konva";
import type Konva from "konva";
import type { Layer as LayerModel, ShapeProps, GradientStop } from "~/lib/types";
import { pathPropsToSvgD } from "~/lib/pathUtils";
import { useEffect, useRef } from "react";

interface PathRendererProps {
  layer: LayerModel;
  isSelected: boolean;
  isMultiSelected: boolean;
  registerNode: (id: string, node: Konva.Node | null) => void;
  onGroupDragStart: (sourceId: string) => void;
  onGroupDragMove: (sourceId: string, x: number, y: number) => void;
  onGroupDragEnd: (sourceId: string, x: number, y: number) => void;
  /** Disable Transformer + drag (pen / direct-select tools). */
  selectionDisabled?: boolean;
  onSelect: (e: Konva.KonvaEventObject<MouseEvent>) => void;
  onUpdate: (u: Partial<LayerModel>) => void;
  /** Snap helper (matches the rest of the editor). */
  getSnapResult?: (
    cx: number,
    cy: number,
    w: number,
    h: number,
    id: string,
  ) => { snapX: number | null; snapY: number | null; guides: { vertical: number[]; horizontal: number[] } };
  setGuides?: (g: { vertical: number[]; horizontal: number[] }) => void;
}

const EMPTY_GUIDES = { vertical: [], horizontal: [] };

export function PathRenderer({
  layer,
  isSelected,
  isMultiSelected,
  registerNode,
  onGroupDragStart,
  onGroupDragMove,
  onGroupDragEnd,
  selectionDisabled,
  onSelect,
  onUpdate,
  getSnapResult,
  setGuides,
}: PathRendererProps) {
  const sp = layer.shape_props!;
  const path = sp.path_props!;
  const w = layer.width;
  const h = layer.height;

  const dataString = useMemo(() => pathPropsToSvgD(path), [path]);

  const fillProps = useMemo(() => buildFillProps(sp, w, h), [sp, w, h]);

  const strokeAlignment = sp.stroke_alignment ?? "center";
  const strokeEnabled = sp.stroke && sp.stroke_width > 0;
  const linecap = sp.stroke_linecap ?? "butt";
  const linejoin = sp.stroke_linejoin ?? "miter";
  const miterLimit = sp.stroke_miter_limit ?? 4;
  const dash = sp.stroke_dash && sp.stroke_dash.length > 0 ? sp.stroke_dash : undefined;
  const fillRuleCanvas: CanvasFillRule =
    path.fill_rule === "evenodd" ? "evenodd" : "nonzero";

  // Fill node: also carries hit testing + drag for the layer.
  // It always renders the shape; stroke is only drawn here when alignment === "center".
  const trRef = useRef<Konva.Transformer | null>(null);
  const nodeRef = useRef<Konva.Path | null>(null);

  useEffect(() => {
    if (selectionDisabled || isMultiSelected) {
      if (trRef.current) trRef.current.nodes([]);
      return;
    }
    if (isSelected && trRef.current && nodeRef.current) {
      trRef.current.nodes([nodeRef.current]);
      trRef.current.getLayer()?.batchDraw();
    } else if (trRef.current) {
      trRef.current.nodes([]);
    }
  }, [isSelected, selectionDisabled, isMultiSelected]);

  useEffect(() => {
    if (!selectionDisabled) registerNode(layer.id, nodeRef.current);
    return () => registerNode(layer.id, null);
  }, [layer.id, selectionDisabled, registerNode]); // eslint-disable-line react-hooks/exhaustive-deps

  const draggable = !selectionDisabled && isSelected;

  const handleDragMove = (e: Konva.KonvaEventObject<DragEvent>) => {
    if (!getSnapResult || !setGuides) return;
    const node = e.target;
    if (!isMultiSelected) {
      const { snapX, snapY, guides } = getSnapResult(node.x(), node.y(), w, h, layer.id);
      if (snapX !== null) node.x(snapX);
      if (snapY !== null) node.y(snapY);
      setGuides(guides);
    }
    if (isMultiSelected) onGroupDragMove(layer.id, node.x(), node.y());
  };

  const handleDragEnd = (e: Konva.KonvaEventObject<DragEvent>) => {
    setGuides?.(EMPTY_GUIDES);
    if (isMultiSelected) {
      onGroupDragEnd(layer.id, e.target.x(), e.target.y());
    } else {
      onUpdate({ x: e.target.x(), y: e.target.y() });
    }
  };

  // For center stroke we let Konva.Path handle stroke directly — most efficient.
  const useCenterStroke = strokeEnabled && strokeAlignment === "center";

  return (
    <>
      <KonvaPath
        ref={nodeRef as React.Ref<Konva.Path>}
        x={layer.x}
        y={layer.y}
        offsetX={w / 2}
        offsetY={h / 2}
        rotation={layer.rotation}
        data={dataString}
        fillRule={fillRuleCanvas}
        // Spread fill props (solid color / gradient).
        {...(fillProps as object)}
        // Center stroke (others handled by aux Shape below).
        stroke={useCenterStroke ? sp.stroke_color : undefined}
        strokeWidth={useCenterStroke ? sp.stroke_width : 0}
        strokeEnabled={useCenterStroke}
        lineCap={useCenterStroke ? linecap : undefined}
        lineJoin={useCenterStroke ? linejoin : undefined}
        miterLimit={useCenterStroke ? miterLimit : undefined}
        dash={useCenterStroke ? dash : undefined}
        hitStrokeWidth={
          // Open paths (e.g. lines) need a fat hit area for selection.
          path.subpaths.some((s) => !s.closed) ? Math.max(12, sp.stroke_width) : undefined
        }
        draggable={draggable}
        onClick={(e) => onSelect(e as unknown as Konva.KonvaEventObject<MouseEvent>)}
        onTap={(e) => onSelect(e as unknown as Konva.KonvaEventObject<MouseEvent>)}
        onDragStart={() => { if (isMultiSelected) onGroupDragStart(layer.id); }}
        onDragMove={handleDragMove}
        onDragEnd={handleDragEnd}
        onTransformEnd={(e) => {
          const node = e.target as Konva.Path;
          const sx = node.scaleX();
          const sy = node.scaleY();
          node.scaleX(1);
          node.scaleY(1);
          // Bake scale into width/height + path coordinates.
          const newW = Math.max(1, w * sx);
          const newH = Math.max(1, h * sy);
          const scaledPath = {
            fill_rule: path.fill_rule,
            subpaths: path.subpaths.map((subp) => ({
              closed: subp.closed,
              anchors: subp.anchors.map((a) => ({
                x: a.x * sx,
                y: a.y * sy,
                hi_x: a.hi_x * sx,
                hi_y: a.hi_y * sy,
                ho_x: a.ho_x * sx,
                ho_y: a.ho_y * sy,
              })),
            })),
          };
          onUpdate({
            x: node.x(),
            y: node.y(),
            width: newW,
            height: newH,
            rotation: node.rotation(),
            shape_props: { ...sp, path_props: scaledPath },
          });
        }}
      />

      {/* Aux stroke shape for inside / outside alignment. */}
      {strokeEnabled && strokeAlignment !== "center" && (
        <Shape
          listening={false}
          x={layer.x}
          y={layer.y}
          offsetX={w / 2}
          offsetY={h / 2}
          rotation={layer.rotation}
          sceneFunc={(ctx) => {
            // Konva.Context proxies most CanvasRenderingContext2D methods, but
            // clip(Path2D) is non-standard on the proxy; reach the underlying ctx.
            const raw = (ctx as unknown as { _context: CanvasRenderingContext2D })
              ._context;
            try {
              const p2 = new Path2D(dataString);
              raw.save();
              if (strokeAlignment === "inside") {
                raw.clip(p2, fillRuleCanvas);
              } else {
                // outside: clip to (huge rect) XOR path using even-odd fill rule.
                const clipP = new Path2D();
                // Big enough box to contain anything we'd ever render in scene coords.
                clipP.rect(-1e5, -1e5, 2e5, 2e5);
                clipP.addPath(p2);
                raw.clip(clipP, "evenodd");
              }
              raw.lineWidth = sp.stroke_width * 2;
              raw.lineCap = linecap;
              raw.lineJoin = linejoin;
              raw.miterLimit = miterLimit;
              if (dash) raw.setLineDash(dash);
              else raw.setLineDash([]);
              raw.strokeStyle = sp.stroke_color;
              raw.stroke(p2);
              raw.restore();
            } catch {
              // Fall back silently if Path2D / clip(Path2D, fillRule) not supported.
            }
          }}
        />
      )}

      {isSelected && !selectionDisabled && !isMultiSelected && (
        <Transformer
          ref={trRef as React.Ref<Konva.Transformer>}
          rotateEnabled
          boundBoxFunc={(oldBox, newBox) =>
            newBox.width < 2 || newBox.height < 2 ? oldBox : newBox
          }
        />
      )}
    </>
  );
}

// ---------- Fill props builder (mirrors the legacy buildShapeFillProps) ----------

function buildFillProps(
  sp: ShapeProps,
  w: number,
  h: number,
): Record<string, unknown> {
  if (sp.fill_type === "none") {
    return { fillEnabled: false };
  }
  if (sp.fill_type === "solid") {
    return { fill: sp.fill_color };
  }
  // Gradient — Konva expects flat array [offset, color, offset, color, ...].
  const stops = sp.gradient_stops.flatMap(
    (s: GradientStop): (number | string)[] => [s.offset, s.color],
  );
  if (sp.gradient_type === "linear") {
    const rad = (sp.gradient_angle * Math.PI) / 180;
    const dx = Math.cos(rad);
    const dy = Math.sin(rad);
    const cx = w / 2;
    const cy = h / 2;
    const len = (Math.abs(dx) * w + Math.abs(dy) * h) / 2;
    return {
      fillLinearGradientStartPoint: { x: cx - dx * len, y: cy - dy * len },
      fillLinearGradientEndPoint: { x: cx + dx * len, y: cy + dy * len },
      fillLinearGradientColorStops: stops,
    };
  }
  return {
    fillRadialGradientStartPoint: { x: w / 2, y: h / 2 },
    fillRadialGradientEndPoint: { x: w / 2, y: h / 2 },
    fillRadialGradientStartRadius: 0,
    fillRadialGradientEndRadius: Math.max(w, h) / 2,
    fillRadialGradientColorStops: stops,
  };
}
