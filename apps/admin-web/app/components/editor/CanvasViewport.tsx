import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Stage, Layer, Line, Rect, Transformer } from "react-konva";
import type Konva from "konva";
import type { Layer as LayerModel, SceneDefinition, ShapeKind } from "~/lib/types";
import type { GetSnapResult, GuideLines } from "./types";
import { EMPTY_GUIDES } from "./types";
import type { ToolMode } from "./PathOverlay";
import { PathOverlay } from "./PathOverlay";
import { PathRenderer } from "./PathRenderer";
import { EditorTextNode } from "./EditorTextNode";
import { EditorImageNode } from "./EditorImageNode";
import { EditorShapeNode } from "./EditorShapeNode";
import { EditorQrNode } from "./EditorQrNode";

interface CanvasViewportProps {
  scene: SceneDefinition;
  zoom: number;
  setZoom: React.Dispatch<React.SetStateAction<number>>;
  toolMode: ToolMode;
  setToolMode: (mode: ToolMode) => void;
  sortedLayers: LayerModel[];
  selectedId: string | null;
  extraSelectedIds: string[];
  assetBaseUrl: string;
  getImageUrl: (objectKey: string) => string;
  onImageReady: (objectKey: string) => void;
  onSelectLayer: (id: string) => void;
  onSelectLayerAdditive: (id: string, additive: boolean) => void;
  onClearSelection: () => void;
  onUpdateLayer: (id: string, u: Partial<LayerModel>) => void;
  onAddPathLayer: (layer: LayerModel) => void;
  getSnapResult: GetSnapResult;
  sceneRef?: React.RefObject<HTMLDivElement | null>;
  drawShapeKind: ShapeKind | null;
  onCommitShapeDraw: (kind: ShapeKind, cx: number, cy: number, w: number, h: number) => void;
  onCancelDrawShape: () => void;
}

export function CanvasViewport({
  scene,
  zoom,
  setZoom,
  toolMode,
  setToolMode,
  sortedLayers,
  selectedId,
  extraSelectedIds,
  assetBaseUrl,
  getImageUrl,
  onImageReady,
  onSelectLayer,
  onSelectLayerAdditive,
  onClearSelection,
  onUpdateLayer,
  onAddPathLayer,
  getSnapResult,
  drawShapeKind,
  onCommitShapeDraw,
  onCancelDrawShape,
}: CanvasViewportProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneDivRef = useRef<HTMLDivElement>(null);
  const spaceHeldRef = useRef(false);
  const panningRef = useRef<{ x: number; y: number } | null>(null);
  const [panCursor, setPanCursor] = useState<"default" | "grab" | "grabbing">("default");
  const [guides, setGuides] = useState<GuideLines>(EMPTY_GUIDES);

  // ---- Multi-select: node registry + shared Transformer ----
  const nodeMapRef = useRef<Map<string, Konva.Node>>(new Map());
  const groupDragInitialRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  const sharedTrRef = useRef<Konva.Transformer | null>(null);
  // Refs so callbacks are always fresh without being recreated.
  const onUpdateLayerRef = useRef(onUpdateLayer);
  onUpdateLayerRef.current = onUpdateLayer;
  const sceneRef = useRef(scene);
  sceneRef.current = scene;

  const allSelectedIds = useMemo(
    () => (selectedId ? [selectedId, ...extraSelectedIds] : []),
    [selectedId, extraSelectedIds],
  );
  const allSelectedIdsRef = useRef<string[]>([]);
  allSelectedIdsRef.current = allSelectedIds;

  const registerNode = useCallback((id: string, node: Konva.Node | null) => {
    if (node) nodeMapRef.current.set(id, node);
    else nodeMapRef.current.delete(id);
  }, []);

  const handleGroupDragStart = useCallback((_sourceId: string) => {
    groupDragInitialRef.current.clear();
    for (const id of allSelectedIdsRef.current) {
      const n = nodeMapRef.current.get(id);
      if (n) groupDragInitialRef.current.set(id, { x: n.x(), y: n.y() });
    }
  }, []);

  const handleGroupDragMove = useCallback((sourceId: string, x: number, y: number) => {
    const srcInit = groupDragInitialRef.current.get(sourceId);
    if (!srcInit) return;
    const dx = x - srcInit.x;
    const dy = y - srcInit.y;
    let konvaLayer: Konva.Layer | null = null;
    for (const id of allSelectedIdsRef.current) {
      if (id === sourceId) continue;
      const n = nodeMapRef.current.get(id);
      const init = groupDragInitialRef.current.get(id);
      if (n && init) {
        n.x(init.x + dx);
        n.y(init.y + dy);
        if (!konvaLayer) konvaLayer = n.getLayer();
      }
    }
    konvaLayer?.batchDraw();
  }, []);

  const handleGroupDragEnd = useCallback((sourceId: string, x: number, y: number) => {
    const srcInit = groupDragInitialRef.current.get(sourceId);
    if (!srcInit) return;
    const dx = x - srcInit.x;
    const dy = y - srcInit.y;
    for (const id of allSelectedIdsRef.current) {
      const init = groupDragInitialRef.current.get(id);
      if (init) onUpdateLayerRef.current(id, { x: init.x + dx, y: init.y + dy });
    }
    groupDragInitialRef.current.clear();
  }, []);

  // Keep the shared Transformer in sync with selection.
  useEffect(() => {
    const tr = sharedTrRef.current;
    if (!tr) return;
    if (allSelectedIds.length <= 1) {
      tr.nodes([]);
      tr.getLayer()?.batchDraw();
      return;
    }
    const nodes = allSelectedIds
      .map((id) => nodeMapRef.current.get(id))
      .filter((n): n is Konva.Node => !!n);
    tr.nodes(nodes);
    tr.getLayer()?.batchDraw();
  }, [allSelectedIds]);

  // Ref-based handler so it always closes over fresh scene/onUpdateLayer.
  const handleSharedTransformEndRef = useRef<() => void>(() => {});
  handleSharedTransformEndRef.current = () => {
    for (const id of allSelectedIdsRef.current) {
      const n = nodeMapRef.current.get(id);
      if (!n) continue;
      const sx = n.scaleX();
      const sy = n.scaleY();
      n.scaleX(1);
      n.scaleY(1);
      const layerData = sceneRef.current.layers.find((l) => l.id === id);
      if (!layerData) continue;
      const base: Partial<LayerModel> = { x: n.x(), y: n.y(), rotation: n.rotation() };
      if (layerData.type === "text" && layerData.text_props) {
        base.width = Math.max(20, layerData.width * Math.abs(sx));
        base.text_props = { ...layerData.text_props, font_size: Math.max(6, Math.round(layerData.text_props.font_size * Math.abs(sy))) };
      } else if (layerData.type === "shape" && layerData.shape_props?.kind === "path" && layerData.shape_props.path_props) {
        const p = layerData.shape_props.path_props;
        base.width = Math.max(1, layerData.width * Math.abs(sx));
        base.height = Math.max(1, layerData.height * Math.abs(sy));
        base.shape_props = {
          ...layerData.shape_props,
          path_props: {
            fill_rule: p.fill_rule,
            subpaths: p.subpaths.map((sp) => ({
              closed: sp.closed,
              anchors: sp.anchors.map((a) => ({
                x: a.x * sx, y: a.y * sy,
                hi_x: a.hi_x * sx, hi_y: a.hi_y * sy,
                ho_x: a.ho_x * sx, ho_y: a.ho_y * sy,
              })),
            })),
          },
        };
      } else {
        base.width = Math.max(1, layerData.width * Math.abs(sx));
        base.height = Math.max(1, layerData.height * Math.abs(sy));
      }
      onUpdateLayerRef.current(id, base);
    }
  };
  const [shapeDrag, setShapeDrag] = useState<{
    startX: number; startY: number;
    currentX: number; currentY: number;
    shiftKey: boolean;
  } | null>(null);

  // Global mousemove / mouseup while drawing a shape.
  useEffect(() => {
    if (!shapeDrag) return;
    const onMove = (e: MouseEvent) => {
      const el = sceneDivRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      setShapeDrag((prev) =>
        prev ? {
          ...prev,
          currentX: Math.max(0, Math.min(scene.width, (e.clientX - rect.left) / zoom)),
          currentY: Math.max(0, Math.min(scene.height, (e.clientY - rect.top) / zoom)),
          shiftKey: e.shiftKey,
        } : null,
      );
    };
    const onUp = (e: MouseEvent) => {
      const el = sceneDivRef.current;
      if (!el || !drawShapeKind) { setShapeDrag(null); return; }
      const rect = el.getBoundingClientRect();
      const ex = Math.max(0, Math.min(scene.width, (e.clientX - rect.left) / zoom));
      const ey = Math.max(0, Math.min(scene.height, (e.clientY - rect.top) / zoom));
      const rawW = Math.abs(ex - shapeDrag.startX);
      const rawH = Math.abs(ey - shapeDrag.startY);

      if (drawShapeKind === "line") {
        if (rawW > 4) {
          const cx = (shapeDrag.startX + ex) / 2;
          onCommitShapeDraw(drawShapeKind, cx, shapeDrag.startY, rawW, 4);
        }
      } else {
        const constrain = e.shiftKey;
        const w = constrain ? Math.min(rawW, rawH) : rawW;
        const h = constrain ? Math.min(rawW, rawH) : rawH;
        if (w > 4 && h > 4) {
          const dirX = ex >= shapeDrag.startX ? 1 : -1;
          const dirY = ey >= shapeDrag.startY ? 1 : -1;
          const cx = shapeDrag.startX + dirX * w / 2;
          const cy = shapeDrag.startY + dirY * h / 2;
          onCommitShapeDraw(drawShapeKind, cx, cy, w, h);
        }
      }
      setShapeDrag(null);
      onCancelDrawShape();
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [shapeDrag, drawShapeKind, zoom, scene.width, scene.height, onCommitShapeDraw, onCancelDrawShape]);

  // Auto-fit zoom on mount / scene size change.
  useEffect(() => {
    const fit = () => {
      const el = containerRef.current;
      if (!el) return;
      const padding = 48;
      const z = Math.min((el.clientWidth - padding) / scene.width, (el.clientHeight - padding) / scene.height, 1);
      setZoom(Math.max(0.1, z));
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [scene.width, scene.height, setZoom]);

  // Ctrl+scroll wheel zoom and two-finger pinch+pan.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const handleWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      setZoom((z) => Math.min(3, Math.max(0.1, z - e.deltaY * 0.001)));
    };

    let lastPinchDist: number | null = null;
    let lastPinchCenter: { x: number; y: number } | null = null;

    const pinchDist = (t: TouchList) => {
      const t0 = t[0]!; const t1 = t[1]!;
      return Math.hypot(t0.clientX - t1.clientX, t0.clientY - t1.clientY);
    };
    const pinchCenter = (t: TouchList) => {
      const t0 = t[0]!; const t1 = t[1]!;
      return { x: (t0.clientX + t1.clientX) / 2, y: (t0.clientY + t1.clientY) / 2 };
    };

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) { lastPinchDist = pinchDist(e.touches); lastPinchCenter = pinchCenter(e.touches); }
    };
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length !== 2 || lastPinchDist === null) return;
      e.preventDefault();
      const dist = pinchDist(e.touches);
      const center = pinchCenter(e.touches);
      setZoom((z) => Math.min(3, Math.max(0.1, z * (dist / lastPinchDist!))));
      lastPinchDist = dist;
      if (lastPinchCenter) { el.scrollLeft -= center.x - lastPinchCenter.x; el.scrollTop -= center.y - lastPinchCenter.y; }
      lastPinchCenter = center;
    };
    const onTouchEnd = () => { lastPinchDist = null; lastPinchCenter = null; };

    el.addEventListener("wheel", handleWheel, { passive: false });
    el.addEventListener("touchstart", onTouchStart, { passive: false });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd);
    return () => {
      el.removeEventListener("wheel", handleWheel);
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
    };
  }, [setZoom]);

  // Space bar pan mode.
  useEffect(() => {
    const onDown = (e: KeyboardEvent) => {
      if (e.code !== "Space" || e.repeat) return;
      const t = e.target as HTMLElement;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      e.preventDefault();
      spaceHeldRef.current = true;
      setPanCursor("grab");
    };
    const onUp = (e: KeyboardEvent) => {
      if (e.code !== "Space") return;
      spaceHeldRef.current = false;
      panningRef.current = null;
      setPanCursor("default");
    };
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    return () => { window.removeEventListener("keydown", onDown); window.removeEventListener("keyup", onUp); };
  }, []);

  return (
    <div
      ref={containerRef}
      className="flex-1 overflow-auto flex items-center justify-center bg-canvas/50 p-6"
      style={{
        cursor: panCursor,
        userSelect: panCursor !== "default" ? "none" : undefined,
        backgroundImage:
          "linear-gradient(45deg, #00000008 25%, transparent 25%), linear-gradient(-45deg, #00000008 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #00000008 75%), linear-gradient(-45deg, transparent 75%, #00000008 75%)",
        backgroundSize: "20px 20px",
        backgroundPosition: "0 0, 0 10px, 10px -10px, -10px 0px",
      }}
      onMouseDownCapture={(e) => {
        if (!spaceHeldRef.current) return;
        e.stopPropagation();
        e.preventDefault();
        panningRef.current = { x: e.clientX, y: e.clientY };
        setPanCursor("grabbing");
      }}
      onMouseMove={(e) => {
        if (!panningRef.current) return;
        const el = containerRef.current;
        if (!el) return;
        el.scrollLeft -= e.clientX - panningRef.current.x;
        el.scrollTop -= e.clientY - panningRef.current.y;
        panningRef.current = { x: e.clientX, y: e.clientY };
      }}
      onMouseUp={() => {
        if (!panningRef.current) return;
        panningRef.current = null;
        setPanCursor(spaceHeldRef.current ? "grab" : "default");
      }}
      onMouseLeave={() => {
        if (!panningRef.current) return;
        panningRef.current = null;
        setPanCursor(spaceHeldRef.current ? "grab" : "default");
      }}
    >
      <div ref={sceneDivRef} className="shadow-xl relative" style={{ width: scene.width * zoom, height: scene.height * zoom }}>
        <Stage
          width={scene.width * zoom}
          height={scene.height * zoom}
          scaleX={zoom}
          scaleY={zoom}
          onMouseDown={(e) => {
            if (toolMode !== "select") return;
            if (e.target === e.target.getStage()) onClearSelection();
          }}
        >
          <Layer>
            <Rect width={scene.width} height={scene.height} fill={scene.background} />
            {sortedLayers.filter((l) => l.visible).map((layer) => {
              const layerIsSelected = selectedId === layer.id || extraSelectedIds.includes(layer.id);
              const layerIsMultiSelected = layerIsSelected && allSelectedIds.length > 1;
              const groupDragProps = {
                isMultiSelected: layerIsMultiSelected,
                registerNode,
                onGroupDragStart: handleGroupDragStart,
                onGroupDragMove: handleGroupDragMove,
                onGroupDragEnd: handleGroupDragEnd,
              };
              if (layer.type === "text" && layer.text_props) {
                return (
                  <EditorTextNode
                    key={layer.id}
                    layer={layer}
                    isSelected={layerIsSelected}
                    onSelect={() => onSelectLayerAdditive(layer.id, false)}
                    onUpdate={(u) => onUpdateLayer(layer.id, u)}
                    getSnapResult={getSnapResult}
                    setGuides={setGuides}
                    {...groupDragProps}
                  />
                );
              }
              if (layer.type === "image" && layer.image_props) {
                return (
                  <EditorImageNode
                    key={layer.id}
                    layer={layer}
                    assetBaseUrl={assetBaseUrl}
                    getImageUrl={getImageUrl}
                    onImageReady={onImageReady}
                    isSelected={layerIsSelected}
                    onSelect={() => onSelectLayerAdditive(layer.id, false)}
                    onUpdate={(u) => onUpdateLayer(layer.id, u)}
                    getSnapResult={getSnapResult}
                    setGuides={setGuides}
                    {...groupDragProps}
                  />
                );
              }
              if (layer.type === "shape" && layer.shape_props) {
                if (layer.shape_props.kind === "path" && layer.shape_props.path_props) {
                  return (
                    <PathRenderer
                      key={layer.id}
                      layer={layer}
                      isSelected={layerIsSelected}
                      selectionDisabled={toolMode !== "select"}
                      onSelect={(e) => {
                        const additive = !!(e?.evt as MouseEvent | undefined)?.shiftKey;
                        onSelectLayerAdditive(layer.id, additive);
                      }}
                      onUpdate={(u) => onUpdateLayer(layer.id, u)}
                      getSnapResult={getSnapResult}
                      setGuides={setGuides}
                      {...groupDragProps}
                    />
                  );
                }
                return (
                  <EditorShapeNode
                    key={layer.id}
                    layer={layer}
                    isSelected={layerIsSelected}
                    onSelect={() => onSelectLayerAdditive(layer.id, false)}
                    onUpdate={(u) => onUpdateLayer(layer.id, u)}
                    getSnapResult={getSnapResult}
                    setGuides={setGuides}
                    {...groupDragProps}
                  />
                );
              }
              if (layer.type === "qr" && layer.qr_props) {
                return (
                  <EditorQrNode
                    key={layer.id}
                    layer={layer}
                    isSelected={layerIsSelected}
                    onSelect={() => onSelectLayerAdditive(layer.id, false)}
                    onUpdate={(u) => onUpdateLayer(layer.id, u)}
                    getSnapResult={getSnapResult}
                    setGuides={setGuides}
                    {...groupDragProps}
                  />
                );
              }
              return null;
            })}
            {/* Shared Transformer — used when multiple layers are selected */}
            <Transformer
              ref={sharedTrRef}
              rotateEnabled
              onTransformEnd={() => handleSharedTransformEndRef.current()}
            />
          </Layer>
          <Layer listening={false}>
            {guides.vertical.map((x) => (
              <Line key={`vg-${x}`} points={[x, 0, x, scene.height]} stroke="#0099ff" strokeWidth={1 / zoom} dash={[4 / zoom, 4 / zoom]} />
            ))}
            {guides.horizontal.map((y) => (
              <Line key={`hg-${y}`} points={[0, y, scene.width, y]} stroke="#0099ff" strokeWidth={1 / zoom} dash={[4 / zoom, 4 / zoom]} />
            ))}
          </Layer>
        </Stage>
        <PathOverlay
          toolMode={toolMode}
          setToolMode={setToolMode}
          scene={scene}
          zoom={zoom}
          selectedId={selectedId}
          setSelectedId={(id) => { if (id) onSelectLayer(id); }}
          updateLayer={onUpdateLayer}
          addPathLayer={onAddPathLayer}
          setGuides={setGuides}
        />
        {/* Shape draw overlay — sits on top of everything when a shape tool is active */}
        {drawShapeKind && (
          <div
            className="absolute inset-0 z-50"
            style={{ cursor: "crosshair", userSelect: "none" }}
            onMouseDown={(e) => {
              if (e.button !== 0 || spaceHeldRef.current) return;
              const rect = e.currentTarget.getBoundingClientRect();
              const x = Math.max(0, Math.min(scene.width, (e.clientX - rect.left) / zoom));
              const y = Math.max(0, Math.min(scene.height, (e.clientY - rect.top) / zoom));
              setShapeDrag({ startX: x, startY: y, currentX: x, currentY: y, shiftKey: e.shiftKey });
            }}
          >
            {shapeDrag && (() => {
              const isLine = drawShapeKind === "line";
              const rawW = Math.abs(shapeDrag.currentX - shapeDrag.startX);
              const rawH = Math.abs(shapeDrag.currentY - shapeDrag.startY);
              const constrain = shapeDrag.shiftKey && !isLine;
              const sw = constrain ? Math.min(rawW, rawH) : rawW; // scene width
              const sh = isLine ? 0 : constrain ? Math.min(rawW, rawH) : rawH; // scene height
              const dirX = shapeDrag.currentX >= shapeDrag.startX ? 1 : -1;
              const dirY = shapeDrag.currentY >= shapeDrag.startY ? 1 : -1;
              // top-left corner of bounding box in scene coords
              const bx = shapeDrag.startX + (dirX < 0 ? -sw : 0);
              const by = isLine ? shapeDrag.startY : shapeDrag.startY + (dirY < 0 ? -sh : 0);
              const left = bx * zoom;
              const top = by * zoom;
              const w = sw * zoom;
              const h = sh * zoom;
              const wScene = Math.round(sw);
              const hScene = Math.round(sh);
              return (
                <svg
                  className="absolute inset-0 pointer-events-none"
                  width={scene.width * zoom}
                  height={scene.height * zoom}
                  style={{ overflow: "visible" }}
                >
                  {isLine ? (
                    <line
                      x1={shapeDrag.startX * zoom} y1={shapeDrag.startY * zoom}
                      x2={shapeDrag.currentX * zoom} y2={shapeDrag.startY * zoom}
                      stroke="#4285f4" strokeWidth="1.5" strokeDasharray="5 4"
                    />
                  ) : drawShapeKind === "circle" ? (
                    <ellipse
                      cx={left + w / 2} cy={top + h / 2}
                      rx={Math.max(0, w / 2)} ry={Math.max(0, h / 2)}
                      fill="rgba(66,133,244,0.12)" stroke="#4285f4"
                      strokeWidth="1.5" strokeDasharray="5 4"
                    />
                  ) : (
                    <rect
                      x={left} y={top} width={Math.max(0, w)} height={Math.max(0, h)}
                      rx={drawShapeKind === "rounded-rect" ? Math.min(8 * zoom, w / 4, h / 4) : 0}
                      fill="rgba(66,133,244,0.12)" stroke="#4285f4"
                      strokeWidth="1.5" strokeDasharray="5 4"
                    />
                  )}
                  {/* Size label */}
                  {isLine && wScene > 10 && (
                    <text
                      x={(shapeDrag.startX + shapeDrag.currentX) / 2 * zoom}
                      y={shapeDrag.startY * zoom - 10}
                      textAnchor="middle" dominantBaseline="auto"
                      fontSize={11} fill="#4285f4" fontFamily="monospace"
                      paintOrder="stroke" stroke="white" strokeWidth="3"
                    >
                      {wScene}
                    </text>
                  )}
                  {!isLine && wScene > 20 && hScene > 16 && (
                    <text
                      x={left + w / 2} y={top + h + 14}
                      textAnchor="middle" dominantBaseline="auto"
                      fontSize={11} fill="#4285f4" fontFamily="monospace"
                      paintOrder="stroke" stroke="white" strokeWidth="3"
                    >
                      {wScene} x {hScene}
                    </text>
                  )}
                </svg>
              );
            })()}
          </div>
        )}
      </div>
    </div>
  );
}
