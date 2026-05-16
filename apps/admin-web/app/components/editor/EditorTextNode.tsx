import { useEffect, useRef } from "react";
import { Text, Transformer } from "react-konva";
import type Konva from "konva";
import type { Layer as LayerModel } from "~/lib/types";
import { loadGoogleFont, subscribeCustomFonts, subscribeLibraryFonts } from "~/lib/fonts";
import { EMPTY_GUIDES, type GetSnapResult, type GuideLines } from "./types";
import { useTransformer } from "./useTransformer";

interface EditorTextNodeProps {
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

export function EditorTextNode({ layer, isSelected, isMultiSelected, registerNode, onGroupDragStart, onGroupDragMove, onGroupDragEnd, onSelect, onUpdate, getSnapResult, setGuides }: EditorTextNodeProps) {
  const p = layer.text_props!;
  const { trRef, nodeRef, rotationSnaps } = useTransformer(isSelected && !isMultiSelected);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const isDraggingRef = useRef(false);
  const transformStartRef = useRef<{ width: number; height: number; fontSize: number } | null>(null);

  useEffect(() => {
    loadGoogleFont(p.font_family);
    // Re-draw the canvas once a custom/library font finishes loading.
    // Konva renders synchronously; if the font isn't in document.fonts yet it
    // falls back to the default. The callbacks below fire after the font bytes
    // are loaded and document.fonts.add() has been called, so batchDraw() picks
    // up the correct typeface without needing any prop change.
    const redraw = () => nodeRef.current?.getLayer()?.batchDraw();
    const unsub1 = subscribeCustomFonts(redraw);
    const unsub2 = subscribeLibraryFonts(redraw);
    return () => { unsub1(); unsub2(); };
  }, [p.font_family]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    registerNode(layer.id, nodeRef.current);
    return () => registerNode(layer.id, null);
  }, [layer.id, registerNode]); // eslint-disable-line react-hooks/exhaustive-deps

  const rawText = p.is_dynamic ? `{${p.variable_key ?? p.content}}` : p.content;
  const displayText = p.text_transform === "uppercase" ? rawText.toUpperCase()
    : p.text_transform === "lowercase" ? rawText.toLowerCase()
    : p.text_transform === "capitalize" ? rawText.replace(/\b\w/g, (c) => c.toUpperCase())
    : rawText;
  const isAutoWidth = p.auto_width !== false;

  // Build the font style string Konva passes to canvas ctx.font:
  // format: "[italic] [weight] [variant]" (weight omitted for 400 to match browser default)
  const fontWeight = p.font_weight ?? (p.bold ? 700 : 400);
  const fontStyleStr = [
    p.italic ? "italic" : "normal",
    fontWeight !== 400 ? String(fontWeight) : "",
  ].filter(Boolean).join(" ") || "normal";

  // Auto-width mode: shrink/grow the layer to fit the rendered text exactly.
  // We pass width=undefined to Konva so _setTextData() computes the true natural
  // text width (fixedWidth=false), rather than clamping to the old layer.width.
  useEffect(() => {
    if (!isAutoWidth) return;
    const node = nodeRef.current as Konva.Text | null;
    if (!node) return;
    const id = requestAnimationFrame(() => {
      if (isDraggingRef.current) return;
      // textWidth is set on the instance by Konva's _setTextData().
      const tw = (node as any).textWidth as number | undefined;
      // Use getHeight() for accurate multi-line / lineHeight-aware height.
      const th = (node as any).getHeight?.() as number | undefined;
      if (!tw || !th) return;
      if (Math.round(tw) !== Math.round(layer.width) || Math.round(th) !== Math.round(layer.height)) {
        onUpdate({ width: tw, height: th });
      }
    });
    return () => cancelAnimationFrame(id);
  }, [displayText, p.font_size, p.font_family, p.bold, p.italic, p.font_weight, isAutoWidth]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fixed mode: height is user-controlled, no auto-sync.

  return (
    <>
      <Text
        ref={nodeRef as React.Ref<Konva.Text>}
        x={layer.x}
        y={layer.y}
        offsetX={layer.width / 2}
        offsetY={layer.height / 2}
        width={isAutoWidth ? undefined : layer.width}
        height={isAutoWidth ? undefined : layer.height}
        wrap={isAutoWidth ? "none" : "word"}
        text={displayText}
        fontSize={p.font_size}
        fontFamily={p.font_family}
        fontStyle={fontStyleStr}
        fill={p.color}
        align={p.align}
        rotation={layer.rotation}
        draggable={isSelected}
        onClick={onSelect}
        onTap={onSelect}
        onDragStart={(e) => {
          isDraggingRef.current = true;
          dragStartRef.current = { x: e.target.x(), y: e.target.y() };
          if (isMultiSelected) onGroupDragStart(layer.id);
        }}
        onDragMove={(e) => {
          const node = e.target;
          if (!isMultiSelected) {
            let axisLock: "x" | "y" | null = null;
            if (e.evt.shiftKey && dragStartRef.current) {
              const dx = Math.abs(node.x() - dragStartRef.current.x);
              const dy = Math.abs(node.y() - dragStartRef.current.y);
              if (dx >= dy) { axisLock = "x"; node.y(dragStartRef.current.y); }
              else { axisLock = "y"; node.x(dragStartRef.current.x); }
            }
            const { snapX, snapY, guides } = getSnapResult(node.x(), node.y(), node.width(), node.height(), layer.id);
            if (snapX !== null && axisLock !== "y") node.x(snapX);
            if (snapY !== null && axisLock !== "x") node.y(snapY);
            setGuides(guides);
          }
          if (isMultiSelected) onGroupDragMove(layer.id, node.x(), node.y());
        }}
        onDragEnd={(e) => {
          isDraggingRef.current = false;
          setGuides(EMPTY_GUIDES);
          if (isMultiSelected) {
            onGroupDragEnd(layer.id, e.target.x(), e.target.y());
          } else {
            onUpdate({ x: e.target.x(), y: e.target.y() });
          }
        }}
        onTransformStart={() => {
          transformStartRef.current = {
            width: layer.width,
            height: layer.height,
            fontSize: p.font_size,
          };
        }}
        onTransform={(e) => {
          const node = e.target as Konva.Text;
          const scaleX = node.scaleX();
          const scaleY = node.scaleY();
          if (isAutoWidth) {
            // Auto-width: absorb scale into dimensions each frame to prevent visual stretching.
            const newWidth = Math.max(20, node.width() * Math.abs(scaleX));
            const newHeight = Math.max(6, node.height() * Math.abs(scaleY));
            node.width(newWidth);
            node.height(newHeight);
            node.offsetX(newWidth / 2);
            node.offsetY(newHeight / 2);
          } else {
            // Fixed mode: absorb both width and height changes each frame.
            const newWidth = Math.max(20, node.width() * Math.abs(scaleX));
            const newHeight = Math.max(6, node.height() * Math.abs(scaleY));
            node.width(newWidth);
            node.height(newHeight);
            node.offsetX(newWidth / 2);
            node.offsetY(newHeight / 2);
          }
          node.scaleX(1);
          node.scaleY(1);
        }}
        onTransformEnd={(e) => {
          const node = e.target as Konva.Text;
          node.scaleX(1);
          node.scaleY(1);

          if (isAutoWidth) {
            // Compute font size from how much the height changed relative to start.
            const start = transformStartRef.current;
            const startH = start?.height ?? layer.height;
            const startFs = start?.fontSize ?? p.font_size;
            const ratio = node.height() / startH;
            onUpdate({
              x: node.x(),
              y: node.y(),
              rotation: node.rotation(),
              text_props: {
                ...p,
                font_size: Math.max(6, Math.round(startFs * ratio)),
              },
            });
          } else {
            // Fixed mode: onTransform already applied width+height & reset scale, just commit.
            onUpdate({
              x: node.x(),
              y: node.y(),
              width: Math.max(20, node.width()),
              height: Math.max(6, node.height()),
              rotation: node.rotation(),
              text_props: { ...p },
            });
          }
        }}
      />
      {isSelected && !isMultiSelected && (
        <Transformer
          ref={trRef as React.Ref<Konva.Transformer>}
          rotateEnabled
          rotationSnaps={rotationSnaps}
          boundBoxFunc={(_oldBox, newBox) => ({
            ...newBox,
            width: Math.max(20, newBox.width),
            height: Math.max(6, newBox.height),
          })}
        />
      )}
    </>
  );
}
