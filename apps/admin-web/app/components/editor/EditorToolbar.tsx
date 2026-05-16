import { useState, useRef } from "react";
import { MousePointer, PenTool, Spline, Type, Image, ZoomIn, ZoomOut, Variable, Palette } from "lucide-react";
import type { SceneDefinition, ShapeKind } from "~/lib/types";
import type { ToolMode } from "./PathOverlay";
import { ColorPicker } from "./ColorPicker";

export function ShapeIcon({ kind }: { kind: ShapeKind }) {
  switch (kind) {
    case "rect":
      return <svg width="16" height="16" viewBox="0 0 24 18" fill="none"><rect x="1.5" y="1.5" width="21" height="15" stroke="currentColor" strokeWidth="2" /></svg>;
    case "rounded-rect":
      return <svg width="16" height="16" viewBox="0 0 24 18" fill="none"><rect x="1.5" y="1.5" width="21" height="15" rx="4" stroke="currentColor" strokeWidth="2" /></svg>;
    case "circle":
      return <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><ellipse cx="12" cy="12" rx="10" ry="9" stroke="currentColor" strokeWidth="2" /></svg>;
    case "line":
      return <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><line x1="2" y1="12" x2="22" y2="12" stroke="currentColor" strokeWidth="2" /></svg>;
  }
}

const SHAPE_LABELS: Record<ShapeKind, string> = {
  rect: "Rectangle",
  "rounded-rect": "Rounded Rect",
  circle: "Circle",
  line: "Line",
  path: "Path",
};

const SHAPE_SHORTCUTS: Partial<Record<ShapeKind, string>> = {
  rect: "R",
  circle: "O",
  line: "L",
};

// ---------- Fixed tooltip ----------

function useTooltip() {
  const [tip, setTip] = useState<{ label: string; x: number; y: number } | null>(null);
  const show = (e: React.MouseEvent, label: string) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setTip({ label, x: r.right + 8, y: r.top + r.height / 2 });
  };
  const hide = () => setTip(null);
  const el = tip ? (
    <div
      className="fixed z-[9999] pointer-events-none"
      style={{ left: tip.x, top: tip.y, transform: "translateY(-50%)" }}
    >
      <div className="bg-neutral-900 text-white text-xs rounded px-2 py-1 whitespace-nowrap shadow-lg">
        {tip.label}
      </div>
    </div>
  ) : null;
  return { show, hide, el };
}

// ---------- Icon button ----------

function IconBtn({
  icon,
  label,
  onClick,
  active = false,
  onMouseEnter,
  onMouseLeave,
}: {
  icon: React.ReactNode;
  label: string;
  onClick?: () => void;
  active?: boolean;
  onMouseEnter?: (e: React.MouseEvent) => void;
  onMouseLeave?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className={`w-8 h-8 flex items-center justify-center rounded transition-colors ${
        active ? "bg-g-blue text-white" : "text-text-1 hover:bg-canvas"
      }`}
    >
      {icon}
    </button>
  );
}

// ---------- Separator ----------

function Sep() {
  return <div className="my-1 border-t border-border w-full" />;
}

// ---------- Props ----------

interface EditorToolbarProps {
  scene: SceneDefinition;
  toolMode: ToolMode;
  zoom: number;
  drawShapeKind: ShapeKind | null;
  onToolModeChange: (mode: ToolMode) => void;
  onAddText: () => void;
  onAddImageClick: () => void;
  onSelectShapeTool: (kind: ShapeKind) => void;
  onBackgroundChange: (color: string) => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomReset: () => void;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

export function EditorToolbar({
  scene,
  toolMode,
  zoom,
  drawShapeKind,
  onToolModeChange,
  onAddText,
  onAddImageClick,
  onSelectShapeTool,
  onBackgroundChange,
  onZoomIn,
  onZoomOut,
  onZoomReset,
  fileInputRef,
  onFileChange,
}: EditorToolbarProps) {
  const { show, hide, el: tooltipEl } = useTooltip();

  return (
    <>
      {tooltipEl}
      <aside className="w-12 flex-shrink-0 bg-surface border-r flex flex-col items-center py-2 overflow-y-auto">

        {/* Tools */}
        <IconBtn icon={<MousePointer size={15} />} label="Select (V)" active={toolMode === "select"} onClick={() => onToolModeChange("select")} onMouseEnter={(e) => show(e, "Select (V)")} onMouseLeave={hide} />
        <IconBtn icon={<PenTool size={15} />} label="Pen (P)" active={toolMode === "pen"} onClick={() => onToolModeChange("pen")} onMouseEnter={(e) => show(e, "Pen (P)")} onMouseLeave={hide} />
        <IconBtn icon={<Spline size={15} />} label="Direct Select (A)" active={toolMode === "direct-select"} onClick={() => onToolModeChange("direct-select")} onMouseEnter={(e) => show(e, "Direct Select (A)")} onMouseLeave={hide} />

        <Sep />

        {/* Add */}
        <IconBtn icon={<Type size={15} />} label="Add Text (T)" onClick={onAddText} onMouseEnter={(e) => show(e, "Add Text (T)")} onMouseLeave={hide} />
        <button
          type="button"
          onClick={onAddImageClick}
          onMouseEnter={(e) => show(e, "Add Image")}
          onMouseLeave={hide}
          className="w-8 h-8 flex items-center justify-center rounded text-text-1 hover:bg-canvas transition-colors"
        >
          <Image size={15} />
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/jpg,image/svg+xml,image/webp,image/gif"
          className="hidden"
          onChange={onFileChange}
        />

        <Sep />

        {/* Shapes */}
        {(["rect", "rounded-rect", "circle", "line"] as ShapeKind[]).map((kind) => (
          <IconBtn
            key={kind}
            icon={<ShapeIcon kind={kind} />}
            label={SHAPE_LABELS[kind]}
            active={drawShapeKind === kind}
            onClick={() => onSelectShapeTool(kind)}
            onMouseEnter={(e) => show(e, `${SHAPE_LABELS[kind]}${SHAPE_SHORTCUTS[kind] ? ` (${SHAPE_SHORTCUTS[kind]})` : ""} — drag to draw`)}
            onMouseLeave={hide}
          />
        ))}

        <Sep />

        {/* Background color */}
        <span
          className="w-8 h-8 flex items-center justify-center rounded text-text-1 relative"
          onMouseEnter={(e) => show(e, `Background: ${scene.background}`)}
          onMouseLeave={hide}
        >
          <ColorPicker
            value={scene.background.startsWith("#") ? scene.background : "#ffffff"}
            onChange={onBackgroundChange}
          />
        </span>

        <Sep />

        {/* Zoom */}
        <IconBtn icon={<ZoomIn size={15} />} label="Zoom In" onClick={onZoomIn} onMouseEnter={(e) => show(e, "Zoom In (+)")} onMouseLeave={hide} />
        <button
          type="button"
          onClick={onZoomReset}
          onMouseEnter={(e) => show(e, `${Math.round(zoom * 100)}% — click to reset`)}
          onMouseLeave={hide}
          className="w-8 h-5 flex items-center justify-center rounded text-text-3 hover:bg-canvas text-[10px] font-mono transition-colors"
        >
          {Math.round(zoom * 100)}%
        </button>
        <IconBtn icon={<ZoomOut size={15} />} label="Zoom Out" onClick={onZoomOut} onMouseEnter={(e) => show(e, "Zoom Out (–)")} onMouseLeave={hide} />

      </aside>
    </>
  );
}
