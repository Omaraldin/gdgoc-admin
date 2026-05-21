import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  Layer as LayerModel,
  SceneDefinition,
  TextProps,
  ShapeKind,
  PathProps,
} from "~/lib/types";
import { nanoid } from "~/lib/utils";
import { preloadFonts } from "~/lib/fonts";
import { ellipsePath, linePath, migrateSceneShapes, rectPath } from "~/lib/pathUtils";
import { booleanOp, type BooleanOp } from "~/lib/booleanOps";
import type { ToolMode } from "./PathOverlay";
import type { EditorProps } from "./types";
import { computeSnap } from "./snap";
import { readImageDimensions, transformPathToScene, sceneSpacePathToLayer } from "./pathTransforms";
import { EditorToolbar } from "./EditorToolbar";
import { CanvasViewport } from "./CanvasViewport";
import { LayerList, BooleanOpsPanel, PropertiesPanel } from "./LayerPanel";

export function CertificateEditor({ scene, onChange, assetBaseUrl, getImageUrl, onAddImageFile, onImageReady }: EditorProps) {
  // ---- One-time migration of legacy shape kinds → path ----
  const migrationDoneRef = useRef(false);
  useEffect(() => {
    if (migrationDoneRef.current) return;
    const needs = scene.layers.some(
      (l) => l.type === "shape" && l.shape_props && (l.shape_props.kind !== "path" || !l.shape_props.path_props),
    );
    if (needs) onChange(migrateSceneShapes(scene));
    migrationDoneRef.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [extraSelectedIds, setExtraSelectedIds] = useState<string[]>([]);
  const allSelectedIds = useMemo(
    () => (selectedId ? [selectedId, ...extraSelectedIds] : []),
    [selectedId, extraSelectedIds],
  );
  const [toolMode, setToolMode] = useState<ToolMode>("select");
  const [drawShapeKind, setDrawShapeKind] = useState<ShapeKind | null>(null);
  const [zoom, setZoom] = useState(1);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const clipboardRef = useRef<LayerModel[]>([]);
  // Keep a ref in sync so the keyboard effect always reads fresh extra-selection without re-subscribing.
  const extraSelectedIdsRef = useRef<string[]>([]);
  useEffect(() => { extraSelectedIdsRef.current = extraSelectedIds; }, [extraSelectedIds]);

  // Preload fonts referenced by scene.
  useEffect(() => {
    const families = scene.layers.map((l) => l.text_props?.font_family).filter((f): f is string => Boolean(f));
    preloadFonts(families);
  }, [scene.layers]);

  const handleSelectLayer = useCallback(
    (id: string, additive = false) => {
      if (additive && selectedId && selectedId !== id) {
        setExtraSelectedIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
      } else {
        setSelectedId(id);
        setExtraSelectedIds([]);
      }
    },
    [selectedId],
  );

  const getSnapResult = useCallback(
    (cx: number, cy: number, w: number, h: number, id: string) =>
      computeSnap(cx, cy, w, h, id, scene.layers, scene.width, scene.height),
    [scene.layers, scene.width, scene.height],
  );

  const updateLayer = useCallback(
    (id: string, updates: Partial<LayerModel>) =>
      onChange({ ...scene, layers: scene.layers.map((l) => (l.id === id ? { ...l, ...updates } : l)) }),
    [scene, onChange],
  );

  // ---- Layer mutations ----

  const addTextLayer = (text = "New Text", props: Partial<TextProps> = {}) => {
    const newLayer: LayerModel = {
      id: nanoid(), type: "text", z_index: scene.layers.length,
      x: scene.width / 2, y: scene.height / 2, width: 300, height: 40, rotation: 0, visible: true,
      text_props: { content: text, font_size: 32, font_family: "Roboto", bold: false, italic: false, color: "#1a1a1a", align: "center", is_dynamic: false, ...props },
    };
    onChange({ ...scene, layers: [...scene.layers, newLayer] });
    setSelectedId(newLayer.id);
  };

  const addDynamicTextField = (variableKey: string) =>
    addTextLayer(`\${${variableKey}}`, { is_dynamic: true, variable_key: variableKey, bold: true, font_size: 40 });

  const addQrLayer = () => {
    const size = Math.round(Math.min(scene.width, scene.height) * 0.25);
    const newLayer = {
      id: nanoid(),
      type: "qr" as const,
      z_index: scene.layers.length,
      x: Math.round(scene.width / 2),
      y: Math.round(scene.height / 2),
      width: size,
      height: size,
      rotation: 0,
      visible: true,
      qr_props: {
        content: "{{cert.verify_url}}",
        color_dark: "#000000",
        color_light: "#ffffff",
        error_correction: "M" as const,
      },
    };
    onChange({ ...scene, layers: [...scene.layers, newLayer] });
    setSelectedId(newLayer.id);
  };

  const commitShapeDraw = (kind: ShapeKind, cx: number, cy: number, w: number, h: number) => {
    const isLine = kind === "line";
    const fw = Math.round(w);
    const fh = isLine ? 4 : Math.round(h);
    let pathProps: PathProps;
    switch (kind) {
      case "rounded-rect": pathProps = rectPath(fw, fh, Math.min(16, fw / 4, fh / 4)); break;
      case "circle": pathProps = ellipsePath(fw, fh); break;
      case "line": pathProps = linePath(fw, fh); break;
      default: pathProps = rectPath(fw, fh, 0); break;
    }
    const newLayer: LayerModel = {
      id: nanoid(), type: "shape", z_index: scene.layers.length,
      x: Math.round(cx), y: Math.round(isLine ? cy : cy), width: fw, height: fh, rotation: 0, visible: true,
      shape_props: {
        kind: "path", corner_radius: 16,
        fill_type: isLine ? "none" : "solid", fill_color: "#4285f4",
        gradient_type: "linear",
        gradient_stops: [{ offset: 0, color: "#4285f4" }, { offset: 1, color: "#ea4335" }],
        gradient_angle: 90,
        stroke: isLine, stroke_color: "#1a1a1a", stroke_width: isLine ? 3 : 2,
        path_props: pathProps, stroke_alignment: "center",
        stroke_linecap: isLine ? "round" : "butt", stroke_linejoin: "miter",
        stroke_miter_limit: 4, stroke_dash: [],
      },
    };
    onChange({ ...scene, layers: [...scene.layers, newLayer] });
    setSelectedId(newLayer.id);
    setExtraSelectedIds([]);
  };

  const runBooleanOp = async (op: BooleanOp) => {
    if (allSelectedIds.length < 2) return;
    const layers = allSelectedIds
      .map((id) => scene.layers.find((l) => l.id === id))
      .filter((l): l is LayerModel => !!l && l.type === "shape" && l.shape_props?.kind === "path" && !!l.shape_props.path_props);
    if (layers.length < 2) return;
    const result = await booleanOp(op, layers.map(transformPathToScene));
    if (!result.subpaths.length) {
      onChange({ ...scene, layers: scene.layers.filter((l) => !allSelectedIds.includes(l.id)) });
      setSelectedId(null); setExtraSelectedIds([]);
      return;
    }
    const newLayer = sceneSpacePathToLayer(result, layers[0]!.shape_props!);
    newLayer.z_index = scene.layers.length;
    onChange({ ...scene, layers: [...scene.layers.filter((l) => !allSelectedIds.includes(l.id)), newLayer] });
    setSelectedId(newLayer.id); setExtraSelectedIds([]);
  };

  const handleImageFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    const objectKey = onAddImageFile(file);
    const dims = await readImageDimensions(file);
    const maxW = scene.width * 0.4;
    const scale = dims.w > maxW ? maxW / dims.w : 1;
    const w = Math.round(dims.w * scale);
    const h = Math.round(dims.h * scale);
    const newLayer: LayerModel = {
      id: nanoid(), type: "image", z_index: scene.layers.length,
      x: Math.round(scene.width / 2), y: Math.round(scene.height / 2),
      width: w, height: h, rotation: 0, visible: true,
      image_props: { asset_key: objectKey, object_fit: "contain" },
    };
    onChange({ ...scene, layers: [...scene.layers, newLayer] });
    setSelectedId(newLayer.id);
  };

  const removeLayer = (id: string) => {
    onChange({ ...scene, layers: scene.layers.filter((l) => l.id !== id) });
    if (selectedId === id) setSelectedId(null);
  };

  const reorderLayer = (id: string, direction: "up" | "down" | "top" | "bottom") => {
    const sorted = [...scene.layers].sort((a, b) => a.z_index - b.z_index);
    const idx = sorted.findIndex((l) => l.id === id);
    if (idx < 0) return;
    let newIdx = idx;
    if (direction === "up") newIdx = Math.min(sorted.length - 1, idx + 1);
    else if (direction === "down") newIdx = Math.max(0, idx - 1);
    else if (direction === "top") newIdx = sorted.length - 1;
    else if (direction === "bottom") newIdx = 0;
    if (newIdx === idx) return;
    const [moved] = sorted.splice(idx, 1);
    if (!moved) return;
    sorted.splice(newIdx, 0, moved);
    onChange({ ...scene, layers: sorted.map((l, i) => ({ ...l, z_index: i })) });
  };

  const duplicateLayer = (id: string) => {
    const src = scene.layers.find((l) => l.id === id);
    if (!src) return;
    const copy: LayerModel = {
      ...src, id: nanoid(), z_index: scene.layers.length, x: src.x + 20, y: src.y + 20,
      text_props: src.text_props ? { ...src.text_props } : undefined,
      image_props: src.image_props ? { ...src.image_props } : undefined,
      shape_props: src.shape_props ? { ...src.shape_props, gradient_stops: src.shape_props.gradient_stops.map((s) => ({ ...s })) } : undefined,
      qr_props: src.qr_props ? { ...src.qr_props } : undefined,
    };
    onChange({ ...scene, layers: [...scene.layers, copy] });
    setSelectedId(copy.id);
  };

  const selectedLayer = scene.layers.find((l) => l.id === selectedId);
  const sortedLayers = useMemo(() => [...scene.layers].sort((a, b) => a.z_index - b.z_index), [scene.layers]);

  // Keyboard shortcuts: Delete, arrow nudge, tool toggles, Figma-like commands.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;

      const ctrl = e.ctrlKey || e.metaKey;

      // ── Global tool / canvas shortcuts (no selection needed) ──────────────
      if (!ctrl) {
        switch (e.key) {
          case "v": case "V": setToolMode("select"); return;
          case "p": case "P": setToolMode("pen"); return;
          case "a": case "A": setToolMode("direct-select"); return;
          case "t": case "T": addTextLayer(); return;
          case "r": case "R": setDrawShapeKind("rect"); setToolMode("select"); return;
          case "o": case "O": setDrawShapeKind("circle"); setToolMode("select"); return;
          case "l": case "L": setDrawShapeKind("line"); setToolMode("select"); return;
          case "Escape": setDrawShapeKind(null); setToolMode("select"); return;
          case "+": case "=": setZoom((z) => Math.min(3, +( z + 0.1).toFixed(2))); return;
          case "-": setZoom((z) => Math.max(0.1, +(z - 0.1).toFixed(2))); return;
          case "0": setZoom(1); return;
        }
      }

      // ── Ctrl+A: select all visible layers ─────────────────────────────────
      if (ctrl && e.key.toLowerCase() === "a") {
        e.preventDefault();
        const visible = scene.layers.filter((l) => l.visible);
        if (visible.length > 0) {
          setSelectedId(visible[visible.length - 1]!.id);
          setExtraSelectedIds(visible.slice(0, -1).map((l) => l.id));
        }
        return;
      }

      // ── Ctrl+C: copy selected layers ──────────────────────────────────────
      if (ctrl && e.key.toLowerCase() === "c") {
        e.preventDefault();
        if (!selectedId) return;
        const ids = [selectedId, ...extraSelectedIdsRef.current];
        const toCopy = ids
          .map((id) => scene.layers.find((l) => l.id === id))
          .filter((l): l is LayerModel => !!l);
        if (toCopy.length) clipboardRef.current = toCopy;
        return;
      }

      // ── Ctrl+V: paste copied layers ───────────────────────────────────────
      if (ctrl && e.key.toLowerCase() === "v") {
        e.preventDefault();
        const srcs = clipboardRef.current;
        if (!srcs.length) return;
        const copies: LayerModel[] = srcs.map((src, i) => ({
          ...src,
          id: nanoid(),
          z_index: scene.layers.length + i,
          x: src.x + 20,
          y: src.y + 20,
          text_props: src.text_props ? { ...src.text_props } : undefined,
          image_props: src.image_props ? { ...src.image_props } : undefined,
          shape_props: src.shape_props
            ? { ...src.shape_props, gradient_stops: src.shape_props.gradient_stops.map((s) => ({ ...s })) }
            : undefined,
          qr_props: src.qr_props ? { ...src.qr_props } : undefined,
        }));
        onChange({ ...scene, layers: [...scene.layers, ...copies] });
        const [first, ...rest] = copies;
        if (first) { setSelectedId(first.id); setExtraSelectedIds(rest.map((c) => c.id)); }
        return;
      }

      if (!selectedId) return;
      const layer = scene.layers.find((l) => l.id === selectedId);
      if (!layer) return;
      const step = e.shiftKey ? 10 : 1;

      // ── Arrow nudge ───────────────────────────────────────────────────────
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        const toRemove = new Set([selectedId, ...extraSelectedIdsRef.current]);
        onChange({ ...scene, layers: scene.layers.filter((l) => !toRemove.has(l.id)) });
        setSelectedId(null);
        setExtraSelectedIds([]);
      }
      else if (e.key === "ArrowUp")    { e.preventDefault(); updateLayer(selectedId, { y: layer.y - step }); }
      else if (e.key === "ArrowDown")  { e.preventDefault(); updateLayer(selectedId, { y: layer.y + step }); }
      else if (e.key === "ArrowLeft")  { e.preventDefault(); updateLayer(selectedId, { x: layer.x - step }); }
      else if (e.key === "ArrowRight") { e.preventDefault(); updateLayer(selectedId, { x: layer.x + step }); }

      // ── Ctrl combos that need a selection ─────────────────────────────────
      else if (ctrl && e.key.toLowerCase() === "d") {
        e.preventDefault();
        duplicateLayer(selectedId);
      }
      // Ctrl+] / Ctrl+[ — bring forward / send backward (+ Shift → to front/back)
      else if (ctrl && e.key === "]") {
        e.preventDefault();
        reorderLayer(selectedId, e.shiftKey ? "top" : "up");
      }
      else if (ctrl && e.key === "[") {
        e.preventDefault();
        reorderLayer(selectedId, e.shiftKey ? "bottom" : "down");
      }
      // Ctrl+B — toggle bold (weight < 600 → 700, else → 400)
      else if (ctrl && !e.shiftKey && e.key.toLowerCase() === "b") {
        e.preventDefault();
        if (layer.text_props) {
          const w = layer.text_props.font_weight ?? (layer.text_props.bold ? 700 : 400);
          const newWeight = w < 600 ? 700 : 400;
          updateLayer(selectedId, {
            text_props: { ...layer.text_props, font_weight: newWeight, bold: newWeight >= 700 },
          });
        }
      }
      // Ctrl+I — toggle italic
      else if (ctrl && !e.shiftKey && e.key.toLowerCase() === "i") {
        e.preventDefault();
        if (layer.text_props) {
          updateLayer(selectedId, {
            text_props: { ...layer.text_props, italic: !layer.text_props.italic },
          });
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, scene.layers]);

  return (
    <div className="flex h-full">
      <EditorToolbar
        scene={scene}
        toolMode={toolMode}
        zoom={zoom}
        drawShapeKind={drawShapeKind}
        onToolModeChange={setToolMode}
        onAddText={() => addTextLayer()}
        onAddImageClick={() => fileInputRef.current?.click()}
        onAddQr={addQrLayer}
        onSelectShapeTool={(kind) => {
          setDrawShapeKind((prev) => prev === kind ? null : kind);
          setToolMode("select");
        }}
        onBackgroundChange={(color) => onChange({ ...scene, background: color })}
        onZoomIn={() => setZoom((z) => Math.min(3, z + 0.1))}
        onZoomOut={() => setZoom((z) => Math.max(0.1, z - 0.1))}
        onZoomReset={() => setZoom(1)}
        fileInputRef={fileInputRef}
        onFileChange={handleImageFile}
      />

      <CanvasViewport
        scene={scene}
        zoom={zoom}
        setZoom={setZoom}
        toolMode={toolMode}
        setToolMode={setToolMode}
        sortedLayers={sortedLayers}
        selectedId={selectedId}
        extraSelectedIds={extraSelectedIds}
        assetBaseUrl={assetBaseUrl}
        getImageUrl={getImageUrl}
        onImageReady={onImageReady}
        onSelectLayer={(id) => { setSelectedId(id); setExtraSelectedIds([]); }}
        onSelectLayerAdditive={handleSelectLayer}
        onClearSelection={() => { setSelectedId(null); setExtraSelectedIds([]); }}
        onUpdateLayer={updateLayer}
        onAddPathLayer={(layer) => onChange({ ...scene, layers: [...scene.layers, layer] })}
        getSnapResult={getSnapResult}
        drawShapeKind={drawShapeKind}
        onCommitShapeDraw={commitShapeDraw}
        onCancelDrawShape={() => setDrawShapeKind(null)}
      />

      <aside className="w-72 flex-shrink-0 bg-surface border-l overflow-y-auto">
        <LayerList
          layers={scene.layers}
          selectedId={selectedId}
          extraSelectedIds={extraSelectedIds}
          onSelect={handleSelectLayer}
          onToggleVisible={(id) => updateLayer(id, { visible: !scene.layers.find((l) => l.id === id)?.visible })}
          onRemove={removeLayer}
        />

        {allSelectedIds.length >= 2 && (
          <BooleanOpsPanel count={allSelectedIds.length} onRun={runBooleanOp} />
        )}

        {selectedLayer && allSelectedIds.length === 1 && (
          <PropertiesPanel
            layer={selectedLayer}
            onUpdate={(u) => updateLayer(selectedLayer.id, u)}
            onReorder={(dir) => reorderLayer(selectedLayer.id, dir)}
            onDuplicate={() => duplicateLayer(selectedLayer.id)}
            onRemove={() => removeLayer(selectedLayer.id)}
          />
        )}
      </aside>
    </div>
  );
}
