import { useEffect, useRef } from "react";
import { Ellipse, Line, Rect, Transformer } from "react-konva";
import type Konva from "konva";
import type { Layer as LayerModel, ShapeProps } from "~/lib/types";
import { EMPTY_GUIDES, type GetSnapResult, type GuideLines } from "./types";
import { useTransformer } from "./useTransformer";

// ---------- Fill helper ----------

export function buildShapeFillProps(sp: ShapeProps, w: number, h: number, isEllipse: boolean): Record<string, unknown> {
  if (sp.fill_type === "none") return { fillEnabled: false };
  if (sp.fill_type === "solid") return { fill: sp.fill_color };

  const stops = sp.gradient_stops.flatMap((s): (number | string)[] => [s.offset, s.color]);
  if (sp.gradient_type === "linear") {
    const rad = (sp.gradient_angle * Math.PI) / 180;
    const dx = Math.cos(rad);
    const dy = Math.sin(rad);
    if (isEllipse) {
      const len = (Math.abs(dx) * w + Math.abs(dy) * h) / 2;
      return {
        fillLinearGradientStartPoint: { x: -dx * len, y: -dy * len },
        fillLinearGradientEndPoint: { x: dx * len, y: dy * len },
        fillLinearGradientColorStops: stops,
      };
    }
    const cx = w / 2;
    const cy = h / 2;
    const len = (Math.abs(dx) * w + Math.abs(dy) * h) / 2;
    return {
      fillLinearGradientStartPoint: { x: cx - dx * len, y: cy - dy * len },
      fillLinearGradientEndPoint: { x: cx + dx * len, y: cy + dy * len },
      fillLinearGradientColorStops: stops,
    };
  }
  if (isEllipse) {
    return {
      fillRadialGradientStartPoint: { x: 0, y: 0 },
      fillRadialGradientEndPoint: { x: 0, y: 0 },
      fillRadialGradientStartRadius: 0,
      fillRadialGradientEndRadius: Math.max(w, h) / 2,
      fillRadialGradientColorStops: stops,
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

// ---------- Component ----------

interface EditorShapeNodeProps {
  layer: LayerModel;
  isSelected: boolean;
  isMultiSelected: boolean;
  registerNode: (id: string, node: Konva.Node | null) => void;
  onGroupDragStart: (sourceId: string) => void;
  onGroupDragMove: (sourceId: string, x: number, y: number) => void;
  onGroupDragEnd: (sourceId: string, x: number, y: number) => void;
  onSelect: () => void;
  onUpdate: (u: Partial<LayerModel>) => void;
  getSnapResult: GetSnapResult;
  setGuides: React.Dispatch<React.SetStateAction<GuideLines>>;
}

export function EditorShapeNode({ layer, isSelected, isMultiSelected, registerNode, onGroupDragStart, onGroupDragMove, onGroupDragEnd, onSelect, onUpdate, getSnapResult, setGuides }: EditorShapeNodeProps) {
  const sp = layer.shape_props!;
  const { trRef, nodeRef, rotationSnaps } = useTransformer(isSelected && !isMultiSelected);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const w = layer.width;
  const h = layer.height;

  useEffect(() => {
    registerNode(layer.id, nodeRef.current);
    return () => registerNode(layer.id, null);
  }, [layer.id, registerNode]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleDragStart = (e: Konva.KonvaEventObject<DragEvent>) => {
    dragStartRef.current = { x: e.target.x(), y: e.target.y() };
    if (isMultiSelected) onGroupDragStart(layer.id);
  };

  const handleDragMove = (e: Konva.KonvaEventObject<DragEvent>) => {
    const node = e.target;
    if (!isMultiSelected) {
      let axisLock: "x" | "y" | null = null;
      if (e.evt.shiftKey && dragStartRef.current) {
        const dx = Math.abs(node.x() - dragStartRef.current.x);
        const dy = Math.abs(node.y() - dragStartRef.current.y);
        if (dx >= dy) { axisLock = "x"; node.y(dragStartRef.current.y); }
        else { axisLock = "y"; node.x(dragStartRef.current.x); }
      }
      const { snapX, snapY, guides } = getSnapResult(node.x(), node.y(), node.width() || w, node.height() || h, layer.id);
      if (snapX !== null && axisLock !== "y") node.x(snapX);
      if (snapY !== null && axisLock !== "x") node.y(snapY);
      setGuides(guides);
    }
    if (isMultiSelected) onGroupDragMove(layer.id, node.x(), node.y());
  };

  const handleDragEnd = (e: Konva.KonvaEventObject<DragEvent>) => {
    setGuides(EMPTY_GUIDES);
    if (isMultiSelected) {
      onGroupDragEnd(layer.id, e.target.x(), e.target.y());
    } else {
      onUpdate({ x: e.target.x(), y: e.target.y() });
    }
  };

  const fillProps = buildShapeFillProps(sp, w, h, sp.kind === "circle");
  const strokeProps = sp.stroke
    ? { stroke: sp.stroke_color, strokeWidth: sp.stroke_width }
    : { strokeEnabled: false };

  if (sp.kind === "line") {
    return (
      <>
        <Line
          ref={nodeRef as React.Ref<Konva.Line>}
          x={layer.x}
          y={layer.y}
          points={[-w / 2, 0, w / 2, 0]}
          stroke={sp.stroke_color}
          strokeWidth={sp.stroke_width}
          hitStrokeWidth={Math.max(10, sp.stroke_width)}
          rotation={layer.rotation}
          draggable={isSelected}
          onClick={onSelect}
          onTap={onSelect}
          onDragStart={handleDragStart}
          onDragMove={handleDragMove}
          onDragEnd={handleDragEnd}
          onTransformEnd={(e) => {
            const node = e.target;
            const scaleX = node.scaleX();
            node.scaleX(1);
            node.scaleY(1);
            onUpdate({ x: node.x(), y: node.y(), width: Math.max(2, w * scaleX), rotation: node.rotation() });
          }}
        />
        {isSelected && !isMultiSelected && (
          <Transformer
            ref={trRef as React.Ref<Konva.Transformer>}
            rotateEnabled
            rotationSnaps={rotationSnaps}
            enabledAnchors={["middle-left", "middle-right"]}
            boundBoxFunc={(oldBox, newBox) => (newBox.width < 2 ? oldBox : newBox)}
          />
        )}
      </>
    );
  }

  if (sp.kind === "circle") {
    return (
      <>
        <Ellipse
          ref={nodeRef as React.Ref<Konva.Ellipse>}
          x={layer.x}
          y={layer.y}
          radiusX={w / 2}
          radiusY={h / 2}
          rotation={layer.rotation}
          {...(fillProps as object)}
          {...(strokeProps as object)}
          draggable={isSelected}
          onClick={onSelect}
          onTap={onSelect}
          onDragStart={handleDragStart}
          onDragMove={handleDragMove}
          onDragEnd={handleDragEnd}
          onTransformEnd={(e) => {
            const node = e.target as Konva.Ellipse;
            const scaleX = node.scaleX();
            const scaleY = node.scaleY();
            node.scaleX(1);
            node.scaleY(1);
            onUpdate({ x: node.x(), y: node.y(), width: Math.max(2, w * scaleX), height: Math.max(2, h * scaleY), rotation: node.rotation() });
          }}
        />
        {isSelected && !isMultiSelected && (
          <Transformer
            ref={trRef as React.Ref<Konva.Transformer>}
            rotateEnabled
            rotationSnaps={rotationSnaps}
            boundBoxFunc={(oldBox, newBox) => (newBox.width < 4 || newBox.height < 4 ? oldBox : newBox)}
          />
        )}
      </>
    );
  }

  const cornerRadius = sp.kind === "rounded-rect" ? sp.corner_radius : 0;
  return (
    <>
      <Rect
        ref={nodeRef as React.Ref<Konva.Rect>}
        x={layer.x}
        y={layer.y}
        offsetX={w / 2}
        offsetY={h / 2}
        width={w}
        height={h}
        cornerRadius={cornerRadius}
        rotation={layer.rotation}
        {...(fillProps as object)}
        {...(strokeProps as object)}
        draggable={isSelected}
        onClick={onSelect}
        onTap={onSelect}
        onDragStart={handleDragStart}
        onDragMove={handleDragMove}
        onDragEnd={handleDragEnd}
        onTransformEnd={(e) => {
          const node = e.target as Konva.Rect;
          const scaleX = node.scaleX();
          const scaleY = node.scaleY();
          node.scaleX(1);
          node.scaleY(1);
          onUpdate({ x: node.x(), y: node.y(), width: Math.max(2, node.width() * scaleX), height: Math.max(2, node.height() * scaleY), rotation: node.rotation() });
        }}
      />
      {isSelected && !isMultiSelected && (
        <Transformer
          ref={trRef as React.Ref<Konva.Transformer>}
          rotateEnabled
          rotationSnaps={rotationSnaps}
          boundBoxFunc={(oldBox, newBox) => (newBox.width < 2 || newBox.height < 2 ? oldBox : newBox)}
        />
      )}
    </>
  );
}
