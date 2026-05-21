import { useCallback, useEffect, useRef, useState } from "react";
import { Image as KonvaImage, Transformer } from "react-konva";
import type Konva from "konva";
import type { Layer as LayerModel } from "~/lib/types";
import { EMPTY_GUIDES, type GetSnapResult, type GuideLines } from "./types";
import { useTransformer } from "./useTransformer";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a tiny placeholder SVG data-url shown before the real QR is ready. */
function placeholderDataUrl(
  w: number,
  h: number,
  text: string,
  dark: string,
  light: string,
): string {
  const label = text.length > 24 ? text.slice(0, 21) + "…" : text;
  const safe = label
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  const cell = Math.max(4, Math.round(Math.min(w, h) / 16));

  // Simple deterministic pixel grid
  const rects: string[] = [];
  const cols = Math.ceil(w / cell);
  const rows = Math.ceil(h / cell);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if ((r * 7 + c * 3 + r * c) % 4 < 2) {
        rects.push(
          `<rect x="${c * cell}" y="${r * cell}" width="${cell}" height="${cell}" fill="${dark}"/>`,
        );
      }
    }
  }

  // Corner finder patterns
  const cs = Math.round(Math.min(w, h) * 0.22);
  const bw = Math.round(cs * 0.14);
  const inner = cs - 2 * bw;
  const ip = Math.round(inner * 0.25);
  const dot = inner - 2 * ip;
  const corners = (
    [
      [bw, bw],
      [w - cs + bw, bw],
      [bw, h - cs + bw],
    ] as [number, number][]
  )
    .map(
      ([cx, cy]) =>
        `<rect x="${cx - bw}" y="${cy - bw}" width="${cs}" height="${cs}" fill="${dark}"/>` +
        `<rect x="${cx}" y="${cy}" width="${inner}" height="${inner}" fill="${light}"/>` +
        `<rect x="${cx + ip}" y="${cy + ip}" width="${dot}" height="${dot}" fill="${dark}"/>`,
    )
    .join("");

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <rect width="${w}" height="${h}" fill="${light}"/>
    ${rects.join("")}${corners}
    <rect x="2" y="${h / 2 - 8}" width="${w - 4}" height="16" fill="${light}" opacity="0.85" rx="2"/>
    <text x="${w / 2}" y="${h / 2 + 4}" text-anchor="middle" font-family="monospace" font-size="9" fill="${dark}">${safe}</text>
  </svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** Async – renders the real QR via the qrcode npm package. */
async function realQrDataUrl(
  content: string,
  dark: string,
  light: string,
  ec: string,
  size: number,
): Promise<string> {
  const QRCode = (await import("qrcode")).default;
  const canvas = document.createElement("canvas");
  await QRCode.toCanvas(canvas, content || " ", {
    width: size,
    margin: 1,
    color: { dark, light },
    errorCorrectionLevel: ec as "L" | "M" | "Q" | "H",
  });
  return canvas.toDataURL("image/png");
}

/** Load a data-url into an HTMLImageElement and resolve when ready. */
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve) => {
    const img = new window.Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(img); // resolve anyway – show broken image
    img.src = src;
  });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface EditorQrNodeProps {
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

export function EditorQrNode({
  layer,
  isSelected,
  isMultiSelected,
  registerNode,
  onGroupDragStart,
  onGroupDragMove,
  onGroupDragEnd,
  onSelect,
  onUpdate,
  getSnapResult,
  setGuides,
}: EditorQrNodeProps) {
  const qrProps = layer.qr_props!;
  const { trRef, nodeRef, rotationSnaps } = useTransformer(
    isSelected && !isMultiSelected,
  );
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);

  const size = Math.max(layer.width, layer.height, 64);
  const dark = qrProps.color_dark || "#000000";
  const light = qrProps.color_light || "#ffffff";

  // ── Always keep ONE stable HTMLImageElement in state ──────────────────────
  // We initialise it synchronously with the placeholder so the KonvaImage
  // always exists (and nodeRef is always set) before the async QR arrives.
  // This prevents the Transformer from losing its attached node.
  const [imgEl] = useState<HTMLImageElement>(() => {
    const img = new window.Image();
    img.src = placeholderDataUrl(layer.width, layer.height, qrProps.content, dark, light);
    return img;
  });

  // Mutate imgEl.src in-place so Konva picks up the new pixels without
  // unmounting/remounting the KonvaImage node.
  const updateImage = useCallback(
    (src: string) => {
      if (!imgEl) return;
      imgEl.src = src;
      // Tell Konva to redraw after the image element updates.
      requestAnimationFrame(() => {
        nodeRef.current?.getLayer()?.batchDraw();
      });
    },
    [imgEl, nodeRef],
  );

  // Regenerate whenever QR props or dimensions change.
  useEffect(() => {
    let cancelled = false;

    // 1. Show the placeholder immediately.
    updateImage(
      placeholderDataUrl(layer.width, layer.height, qrProps.content, dark, light),
    );

    // 2. Generate the real QR asynchronously.
    const content = qrProps.content.trim() || "https://example.com";
    realQrDataUrl(content, dark, light, qrProps.error_correction || "M", Math.max(size, 128))
      .then((dataUrl) => {
        if (cancelled) return;
        // Pre-load the image so onload fires before we swap imgEl.src.
        return loadImage(dataUrl);
      })
      .then((img) => {
        if (!img || cancelled) return;
        updateImage(img.src);
      })
      .catch(() => {/* keep placeholder on error */});

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qrProps.content, qrProps.color_dark, qrProps.color_light, qrProps.error_correction, layer.width, layer.height]);

  // Register with multi-select Transformer manager.
  useEffect(() => {
    registerNode(layer.id, nodeRef.current);
    return () => registerNode(layer.id, null);
  }, [layer.id, registerNode]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      {/* Always render KonvaImage – never swap to a different element type.
          This keeps nodeRef stable so the Transformer never loses the node. */}
      <KonvaImage
        ref={nodeRef as React.Ref<Konva.Image>}
        image={imgEl}
        x={layer.x}
        y={layer.y}
        offsetX={layer.width / 2}
        offsetY={layer.height / 2}
        width={layer.width}
        height={layer.height}
        rotation={layer.rotation}
        draggable={isSelected}
        onClick={onSelect}
        onTap={onSelect}
        onDragStart={(e) => {
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
            const { snapX, snapY, guides } = getSnapResult(
              node.x(), node.y(), node.width(), node.height(), layer.id,
            );
            if (snapX !== null && axisLock !== "y") node.x(snapX);
            if (snapY !== null && axisLock !== "x") node.y(snapY);
            setGuides(guides);
          }
          if (isMultiSelected) onGroupDragMove(layer.id, node.x(), node.y());
        }}
        onDragEnd={(e) => {
          setGuides(EMPTY_GUIDES);
          if (isMultiSelected) {
            onGroupDragEnd(layer.id, e.target.x(), e.target.y());
          } else {
            onUpdate({ x: e.target.x(), y: e.target.y() });
          }
        }}
        onTransformEnd={(e) => {
          const node = e.target as Konva.Image;
          const scaleX = node.scaleX();
          const scaleY = node.scaleY();
          node.scaleX(1);
          node.scaleY(1);
          const newSize = Math.max(20, Math.max(node.width() * scaleX, node.height() * scaleY));
          onUpdate({
            x: node.x(),
            y: node.y(),
            width: newSize,
            height: newSize,
            rotation: node.rotation(),
          });
        }}
      />

      {isSelected && !isMultiSelected && (
        <Transformer
          ref={trRef as React.Ref<Konva.Transformer>}
          rotateEnabled
          rotationSnaps={rotationSnaps}
          keepRatio
          boundBoxFunc={(oldBox, newBox) =>
            newBox.width < 20 || newBox.height < 20 ? oldBox : newBox
          }
        />
      )}
    </>
  );
}
