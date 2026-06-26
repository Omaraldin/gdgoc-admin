import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

// Google brand palette — 4 shades of each brand colour + neutrals.
const GOOGLE_COLORS: { label: string; colors: string[] }[] = [
  {
    label: "Google Blue",
    colors: ["#c3ecf6", "#57caff", "#4285f4"],
  },
  {
    label: "Google Red",
    colors: ["#f8d8d8", "#ff7daf", "#ea4335"],
  },
  {
    label: "Google Green",
    colors: ["#ccf6c5", "#5cdb6d", "#34a853"],
  },
  {
    label: "Google Yellow",
    colors: ["#ffe7a5", "#ffd427", "#f9ab00"],
  },
  {
    label: "Neutrals",
    colors: ["#f0f0f0", "#BDC1C6", "#80868B"],
  },
  {
    label: "Dark",
    colors: ["#3C4043", "#1e1e1e", "#000000"],
  },
];

// All recommended chips in a flat list for quick look-up.
export const ALL_GOOGLE_COLORS = GOOGLE_COLORS.flatMap((g) => g.colors);

interface ColorPickerProps {
  value: string;
  onChange: (v: string) => void;
  /** Render as a small rounded swatch circle (default) or a wider rectangular button */
  variant?: "swatch" | "rect";
  className?: string;
}

/**
 * ColorPicker — a small color swatch that opens a popover with Google brand
 * color chips and a native color input for arbitrary values.
 */
export function ColorPicker({ value, onChange, variant = "swatch", className }: ColorPickerProps) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const nativeRef = useRef<HTMLInputElement>(null);
  const [popPos, setPopPos] = useState({ top: 0, left: 0 });

  // Position popover, flipping left if near the right edge.
  const POP_W = 208; // w-52
  const POP_H = 260; // approximate height
  const MARGIN = 8;

  const openPopover = () => {
    if (!anchorRef.current) return;
    const r = anchorRef.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // Prefer right of anchor; flip to left if it would overflow.
    const left =
      r.right + MARGIN + POP_W <= vw
        ? r.right + MARGIN
        : r.left - POP_W - MARGIN;

    // Align top with anchor; nudge up if it would overflow bottom.
    const rawTop = r.top;
    const top = rawTop + POP_H > vh ? Math.max(0, vh - POP_H - MARGIN) : rawTop;

    setPopPos({ top, left });
    setOpen(true);
  };

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        !popoverRef.current?.contains(e.target as Node) &&
        !anchorRef.current?.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const handleChip = (color: string) => {
    onChange(color);
    setOpen(false);
  };

  const triggerClass =
    variant === "swatch"
      ? `relative inline-flex items-center justify-center w-5 h-5 rounded-full border border-black/20 shadow-sm cursor-pointer shrink-0 overflow-hidden ${className ?? ""}`
      : `relative inline-flex items-center justify-center h-9 w-14 border rounded-md cursor-pointer ${className ?? ""}`;

  const popover = open
    ? createPortal(
        <div
          ref={popoverRef}
          className="fixed z-[9999] bg-white border border-black/10 rounded-xl shadow-2xl p-3 w-52"
          style={{ top: popPos.top, left: popPos.left }}
        >
          <div className="space-y-1.5 mb-3">
            {GOOGLE_COLORS.map((group) => (
              <div key={group.label} className="flex gap-1">
                {group.colors.map((c) => (
                  <button
                    key={c}
                    type="button"
                    title={c}
                    onClick={() => handleChip(c)}
                    style={{ backgroundColor: c }}
                    className={`w-9 h-9 rounded-lg border-2 transition-transform hover:scale-110 focus:outline-none ${
                      (value || "").toLowerCase() === c.toLowerCase()
                        ? "border-blue-500 scale-105"
                        : "border-transparent"
                    }`}
                  />
                ))}
              </div>
            ))}
          </div>

          {/* Divider */}
          <div className="border-t border-black/10 mb-2" />

          {/* Custom color row */}
          <div className="flex items-center gap-2">
            <div
              className="w-7 h-7 rounded-md border border-black/20 shrink-0"
              style={{ backgroundColor: value || "transparent" }}
            />
            <button
              type="button"
              className="flex-1 text-left text-xs text-text-2 hover:text-text-1 font-mono uppercase tracking-wide"
              onClick={() => nativeRef.current?.click()}
            >
              {value || "None"}
            </button>
            <input
              ref={nativeRef}
              type="color"
              value={value || "#000000"}
              onChange={(e) => onChange(e.target.value)}
              className="sr-only"
            />
            <button
              type="button"
              title="Pick custom color"
              onClick={() => nativeRef.current?.click()}
              className="shrink-0 text-[10px] border rounded px-1.5 py-0.5 hover:bg-canvas text-text-2"
            >
              Custom
            </button>
          </div>
        </div>,
        document.body,
      )
    : null;

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        className={triggerClass}
        style={{ backgroundColor: value || "transparent" }}
        onClick={openPopover}
        title={`Color: ${value || "none"}`}
      >
        {variant === "swatch" && (
          // invisible overlay to show "swatch" style on the circle background
          <span className="absolute inset-0" />
        )}
      </button>
      {popover}
    </>
  );
}
