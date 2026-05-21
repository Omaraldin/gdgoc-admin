import { useEditor, EditorContent } from "@tiptap/react";
import type { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { TextStyle } from "@tiptap/extension-text-style";
import { Color } from "@tiptap/extension-color";
import Underline from "@tiptap/extension-underline";
import Highlight from "@tiptap/extension-highlight";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import Placeholder from "@tiptap/extension-placeholder";
import TextAlign from "@tiptap/extension-text-align";
import { useEffect, useCallback, useRef, useState } from "react";
import { uploadMailImage } from "~/lib/api/mail";

// ── SVG Icons ─────────────────────────────────────────────────────────────────

const icons = {
  undo: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/>
    </svg>
  ),
  redo: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 7v6h-6"/><path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3L21 13"/>
    </svg>
  ),
  bold: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 4h8a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z"/><path d="M6 12h9a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z"/>
    </svg>
  ),
  italic: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="19" y1="4" x2="10" y2="4"/><line x1="14" y1="20" x2="5" y2="20"/><line x1="15" y1="4" x2="9" y2="20"/>
    </svg>
  ),
  underline: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 3v7a6 6 0 0 0 6 6 6 6 0 0 0 6-6V3"/><line x1="4" y1="21" x2="20" y2="21"/>
    </svg>
  ),
  strikethrough: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 4H9a3 3 0 0 0-2.83 4"/><path d="M14 12a4 4 0 0 1 0 8H6"/><line x1="4" y1="12" x2="20" y2="12"/>
    </svg>
  ),
  bulletList: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="9" y1="6" x2="20" y2="6"/><line x1="9" y1="12" x2="20" y2="12"/><line x1="9" y1="18" x2="20" y2="18"/>
      <circle cx="4" cy="6" r="1.5" fill="currentColor" stroke="none"/><circle cx="4" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="4" cy="18" r="1.5" fill="currentColor" stroke="none"/>
    </svg>
  ),
  orderedList: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="10" y1="6" x2="21" y2="6"/><line x1="10" y1="12" x2="21" y2="12"/><line x1="10" y1="18" x2="21" y2="18"/>
      <path d="M4 6h1v4" stroke="currentColor" strokeWidth="1.5"/><path d="M4 10h2" stroke="currentColor" strokeWidth="1.5"/>
      <path d="M6 14H4c0-1 2-2 2-3s-1-1.5-2-1" stroke="currentColor" strokeWidth="1.5"/>
    </svg>
  ),
  blockquote: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
      <path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z"/>
      <path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3c0 1 0 1 1 1z"/>
    </svg>
  ),
  link: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
    </svg>
  ),
  image: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/>
      <polyline points="21 15 16 10 5 21"/>
    </svg>
  ),
  imageLoading: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="animate-spin">
      <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
    </svg>
  ),
  highlight: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
    </svg>
  ),
  colorText: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/>
    </svg>
  ),
  removeFormat: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
    </svg>
  ),
  imageUrl: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/>
      <polyline points="21 15 16 10 5 21"/>
      <path d="M16 5h2M19 5v2" strokeWidth="1.8"/>
    </svg>
  ),
  code: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>
    </svg>
  ),
  alignLeft: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="21" y1="6" x2="3" y2="6"/><line x1="15" y1="12" x2="3" y2="12"/><line x1="17" y1="18" x2="3" y2="18"/>
    </svg>
  ),
  alignCenter: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="21" y1="6" x2="3" y2="6"/><line x1="17" y1="12" x2="7" y2="12"/><line x1="19" y1="18" x2="5" y2="18"/>
    </svg>
  ),
  alignRight: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="21" y1="6" x2="3" y2="6"/><line x1="21" y1="12" x2="9" y2="12"/><line x1="21" y1="18" x2="7" y2="18"/>
    </svg>
  ),
  alignJustify: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="21" y1="6" x2="3" y2="6"/><line x1="21" y1="12" x2="3" y2="12"/><line x1="21" y1="18" x2="3" y2="18"/>
    </svg>
  ),
};

// ── Toolbar button ────────────────────────────────────────────────────────────

function Btn({
  active,
  disabled,
  title,
  onClick,
  children,
  text,
}: {
  active?: boolean;
  disabled?: boolean;
  title?: string;
  onClick: () => void;
  children?: React.ReactNode;
  text?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onMouseDown={(e) => {
        e.preventDefault();
        onClick();
      }}
      className={[
        "flex items-center justify-center rounded h-7 min-w-[28px] px-1.5 transition-colors select-none text-xs font-semibold",
        active
          ? "bg-blue-100 text-g-blue dark:bg-blue-950 dark:text-blue-300"
          : "text-text-2 hover:bg-neutral-100 dark:hover:bg-neutral-800 hover:text-text-1 disabled:opacity-30 disabled:cursor-not-allowed",
      ].join(" ")}
    >
      {children ?? text}
    </button>
  );
}

function Divider() {
  return <div className="w-px h-5 bg-border mx-1 self-center flex-shrink-0" />;
}

// ── Variable chips for URL inputs ─────────────────────────────────────────────

function insertVarAtCursor(
  inputRef: React.RefObject<HTMLInputElement>,
  current: string,
  variable: string,
  onChange: (v: string) => void,
) {
  const el = inputRef.current;
  const start = el?.selectionStart ?? current.length;
  const end = el?.selectionEnd ?? current.length;
  const insertion = `{{${variable}}}`;
  const next = current.slice(0, start) + insertion + current.slice(end);
  onChange(next);
  requestAnimationFrame(() => {
    if (el) {
      const pos = start + insertion.length;
      el.focus();
      el.setSelectionRange(pos, pos);
    }
  });
}

function UrlVariableChips({
  variables,
  inputRef,
  url,
  onChange,
}: {
  variables: string[];
  inputRef: React.RefObject<HTMLInputElement>;
  url: string;
  onChange: (v: string) => void;
}) {
  if (!variables.length) return null;
  return (
    <div className="mt-2">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-text-3 mb-1">Insert variable</p>
      <div className="flex flex-wrap gap-1">
        {variables.map((v) => (
          <button
            key={v}
            type="button"
            title={`Insert {{${v}}}`}
            onMouseDown={(e) => {
              e.preventDefault();
              insertVarAtCursor(inputRef, url, v, onChange);
            }}
            className="text-[10px] font-mono px-1.5 py-0.5 rounded border border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900 transition-colors"
          >
            {`{{${v}}}`}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Color palette ─────────────────────────────────────────────────────────────

const COLORS = [
  { label: "Black",       value: "#000000" },
  { label: "Dark gray",   value: "#374151" },
  { label: "Gray",        value: "#6B7280" },
  { label: "Light gray",  value: "#D1D5DB" },
  { label: "Red",         value: "#EF4444" },
  { label: "Orange",      value: "#F97316" },
  { label: "Yellow",      value: "#EAB308" },
  { label: "Green",       value: "#22C55E" },
  { label: "Blue",        value: "#3B82F6" },
  { label: "Indigo",      value: "#6366F1" },
  { label: "Purple",      value: "#8B5CF6" },
  { label: "Pink",        value: "#EC4899" },
  { label: "Teal",        value: "#14B8A6" },
  { label: "White",       value: "#FFFFFF" },
];

const HIGHLIGHTS = [
  { label: "Yellow",  value: "#FEF08A" },
  { label: "Green",   value: "#BBF7D0" },
  { label: "Blue",    value: "#BAE6FD" },
  { label: "Pink",    value: "#FBCFE8" },
  { label: "Orange",  value: "#FED7AA" },
  { label: "Purple",  value: "#E9D5FF" },
];

// ── Popover color picker ──────────────────────────────────────────────────────

function ColorPicker({
  onSelect,
  onReset,
  activeColor,
}: {
  onSelect: (color: string) => void;
  onReset: () => void;
  activeColor?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        title="Text color"
        onMouseDown={(e) => { e.preventDefault(); setOpen((v) => !v); }}
        className="flex flex-col items-center justify-center rounded h-7 w-8 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors select-none"
      >
        <span className="text-text-1">{icons.colorText}</span>
        <span
          className="w-5 h-1 rounded-sm mt-0.5"
          style={{ backgroundColor: activeColor ?? "#000000" }}
        />
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 z-50 bg-surface border rounded-lg shadow-lg p-2.5 w-44">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-text-3 mb-1.5">Text Color</p>
          <div className="grid grid-cols-7 gap-1 mb-2">
            {COLORS.map(({ label, value }) => (
              <button
                key={value}
                type="button"
                title={label}
                onMouseDown={(e) => { e.preventDefault(); onSelect(value); setOpen(false); }}
                className={[
                  "w-5 h-5 rounded border transition-transform hover:scale-110",
                  value === "#FFFFFF" ? "border-border" : "border-transparent",
                  activeColor === value ? "ring-2 ring-g-blue ring-offset-1" : "",
                ].join(" ")}
                style={{ backgroundColor: value }}
              />
            ))}
          </div>
          <button
            type="button"
            onMouseDown={(e) => { e.preventDefault(); onReset(); setOpen(false); }}
            className="text-xs text-text-3 hover:text-text-1 w-full text-left"
          >
            Remove color
          </button>
        </div>
      )}
    </div>
  );
}

function HighlightPicker({
  onSelect,
  onReset,
  active,
}: {
  onSelect: (color: string) => void;
  onReset: () => void;
  active: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        title="Highlight"
        onMouseDown={(e) => { e.preventDefault(); setOpen((v) => !v); }}
        className={[
          "flex items-center justify-center rounded h-7 w-8 transition-colors select-none",
          active
            ? "bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300"
            : "text-text-2 hover:bg-neutral-100 dark:hover:bg-neutral-800 hover:text-text-1",
        ].join(" ")}
      >
        {icons.highlight}
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 z-50 bg-surface border rounded-lg shadow-lg p-2.5 w-36">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-text-3 mb-1.5">Highlight</p>
          <div className="grid grid-cols-6 gap-1 mb-2">
            {HIGHLIGHTS.map(({ label, value }) => (
              <button
                key={value}
                type="button"
                title={label}
                onMouseDown={(e) => { e.preventDefault(); onSelect(value); setOpen(false); }}
                className="w-5 h-5 rounded border border-border/60 transition-transform hover:scale-110"
                style={{ backgroundColor: value }}
              />
            ))}
          </div>
          <button
            type="button"
            onMouseDown={(e) => { e.preventDefault(); onReset(); setOpen(false); }}
            className="text-xs text-text-3 hover:text-text-1 w-full text-left"
          >
            Remove
          </button>
        </div>
      )}
    </div>
  );
}

// ── Image URL popover ─────────────────────────────────────────────────────────

function ImageUrlPopover({ onInsert, variables = [] }: { onInsert: (url: string) => void; variables?: string[] }) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setUrl("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleOpen = () => {
    setOpen((v) => !v);
    // Focus the input after the popover renders
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const handleInsert = () => {
    const trimmed = url.trim();
    if (!trimmed) return;
    onInsert(trimmed);
    setOpen(false);
    setUrl("");
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        title="Insert image from URL"
        onMouseDown={(e) => { e.preventDefault(); handleOpen(); }}
        className={[
          "flex items-center justify-center rounded h-7 w-7 transition-colors select-none",
          open
            ? "bg-blue-100 text-g-blue dark:bg-blue-950 dark:text-blue-300"
            : "text-text-2 hover:bg-neutral-100 dark:hover:bg-neutral-800 hover:text-text-1",
        ].join(" ")}
      >
        {icons.imageUrl}
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 z-50 bg-surface border border-border rounded-lg shadow-lg p-3 w-72">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-text-3 mb-2">Insert image URL</p>
          <input
            ref={inputRef}
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); handleInsert(); }
              if (e.key === "Escape") { setOpen(false); setUrl(""); }
            }}
            placeholder="https://example.com/image.png or {{variable}}"
            className="w-full text-sm px-2.5 py-1.5 rounded border border-border bg-canvas text-text-1 placeholder:text-text-3 focus:outline-none focus:ring-2 focus:ring-g-blue/40"
          />
          <UrlVariableChips variables={variables} inputRef={inputRef} url={url} onChange={setUrl} />
          <div className="flex justify-end gap-2 mt-2">
            <button
              type="button"
              onMouseDown={(e) => { e.preventDefault(); setOpen(false); setUrl(""); }}
              className="text-xs px-2.5 py-1 rounded border border-border text-text-2 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!url.trim()}
              onMouseDown={(e) => { e.preventDefault(); handleInsert(); }}
              className="text-xs px-2.5 py-1 rounded bg-g-blue text-white hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
            >
              Insert
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Link popover ─────────────────────────────────────────────────────────────

function LinkPopover({ editor, variables = [] }: { editor: Editor; variables?: string[] }) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const isActive = editor.isActive("link");

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setUrl("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleOpen = () => {
    const prev = (editor.getAttributes("link").href as string) ?? "";
    setUrl(prev);
    setOpen((v) => !v);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const handleApply = () => {
    const trimmed = url.trim();
    if (!trimmed) {
      editor.chain().focus().unsetLink().run();
    } else {
      editor.chain().focus().setLink({ href: trimmed }).run();
    }
    setOpen(false);
    setUrl("");
  };

  const handleRemove = () => {
    editor.chain().focus().unsetLink().run();
    setOpen(false);
    setUrl("");
  };

  return (
    <div ref={ref} className="relative">
      <Btn
        title={isActive ? "Edit link" : "Insert link"}
        active={isActive}
        onClick={handleOpen}
      >
        {icons.link}
      </Btn>

      {open && (
        <div className="absolute top-full left-0 mt-1 z-50 bg-surface border border-border rounded-lg shadow-lg p-3 w-72">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-text-3 mb-2">
            {isActive ? "Edit link" : "Insert link"}
          </p>
          <input
            ref={inputRef}
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); handleApply(); }
              if (e.key === "Escape") { setOpen(false); setUrl(""); }
            }}
            placeholder="https://example.com or {{variable}}"
            className="w-full text-sm px-2.5 py-1.5 rounded border border-border bg-canvas text-text-1 placeholder:text-text-3 focus:outline-none focus:ring-2 focus:ring-g-blue/40"
          />
          <UrlVariableChips variables={variables} inputRef={inputRef} url={url} onChange={setUrl} />
          <div className="flex items-center gap-2 mt-2">
            {isActive && (
              <button
                type="button"
                onMouseDown={(e) => { e.preventDefault(); handleRemove(); }}
                className="text-xs px-2.5 py-1 rounded border border-red-200 text-red-600 hover:bg-red-50 transition-colors"
              >
                Remove
              </button>
            )}
            <div className="flex gap-2 ml-auto">
              <button
                type="button"
                onMouseDown={(e) => { e.preventDefault(); setOpen(false); setUrl(""); }}
                className="text-xs px-2.5 py-1 rounded border border-border text-text-2 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!url.trim()}
                onMouseDown={(e) => { e.preventDefault(); handleApply(); }}
                className="text-xs px-2.5 py-1 rounded bg-g-blue text-white hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
              >
                Apply
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface RichEditorProps {
  value: string;
  onChange: (html: string) => void;
  variables?: string[];
  placeholder?: string;
  minHeight?: number;
}

export function RichEditor({
  value,
  onChange,
  variables = [],
  placeholder = "Write your email body…",
  minHeight = 300,
}: RichEditorProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [codeView, setCodeView] = useState(false);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ codeBlock: false }),
      TextStyle,
      Color,
      Underline,
      Highlight.configure({ multicolor: true }),
      Link.configure({ openOnClick: false, validate: () => true, HTMLAttributes: { class: "text-g-blue underline" } }),
      Image.configure({ HTMLAttributes: { class: "max-w-full rounded" } }),
      Placeholder.configure({ placeholder }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
    ],
    editorProps: {
      attributes: {
        class: "outline-none",
      },
    },
    content: value,
    onUpdate({ editor }) {
      onChange(editor.getHTML());
    },
  });

  useEffect(() => {
    if (!editor) return;
    if (editor.getHTML() !== value) {
      editor.commands.setContent(value);
    }
  }, [value, editor]);

  const insertVariable = useCallback(
    (key: string) => {
      editor?.chain().focus().insertContent(`{{${key}}}`).run();
    },
    [editor],
  );

  const handleImageFile = useCallback(
    async (file: File) => {
      if (!editor) return;
      setUploading(true);
      try {
        const { url } = await uploadMailImage(file);
        editor.chain().focus().setImage({ src: url, alt: file.name }).run();
      } catch {
        // silently ignore — user can retry
      } finally {
        setUploading(false);
      }
    },
    [editor],
  );

  if (!editor) return null;

  const activeColor = editor.getAttributes("textStyle").color as string | undefined;

  return (
    <div className="border border-border rounded-lg overflow-hidden bg-surface shadow-sm">
      {/* ── Toolbar ───────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-0.5 px-2 py-1.5 border-b border-border bg-canvas">

        {/* History */}
        <Btn title="Undo (Ctrl+Z)" onClick={() => editor.chain().focus().undo().run()} disabled={!editor.can().undo()}>
          {icons.undo}
        </Btn>
        <Btn title="Redo (Ctrl+Y)" onClick={() => editor.chain().focus().redo().run()} disabled={!editor.can().redo()}>
          {icons.redo}
        </Btn>

        <Divider />

        {/* Headings */}
        <Btn title="Heading 1" text="H1" active={editor.isActive("heading", { level: 1 })} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} />
        <Btn title="Heading 2" text="H2" active={editor.isActive("heading", { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} />
        <Btn title="Heading 3" text="H3" active={editor.isActive("heading", { level: 3 })} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} />

        <Divider />

        {/* Inline formatting */}
        <Btn title="Bold (Ctrl+B)" active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()}>
          {icons.bold}
        </Btn>
        <Btn title="Italic (Ctrl+I)" active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()}>
          {icons.italic}
        </Btn>
        <Btn title="Underline (Ctrl+U)" active={editor.isActive("underline")} onClick={() => editor.chain().focus().toggleUnderline().run()}>
          {icons.underline}
        </Btn>
        <Btn title="Strikethrough" active={editor.isActive("strike")} onClick={() => editor.chain().focus().toggleStrike().run()}>
          {icons.strikethrough}
        </Btn>

        <Divider />

        {/* Color & highlight */}
        <ColorPicker
          activeColor={activeColor}
          onSelect={(c) => editor.chain().focus().setColor(c).run()}
          onReset={() => editor.chain().focus().unsetColor().run()}
        />
        <HighlightPicker
          active={editor.isActive("highlight")}
          onSelect={(c) => editor.chain().focus().toggleHighlight({ color: c }).run()}
          onReset={() => editor.chain().focus().unsetHighlight().run()}
        />

        <Divider />

        {/* Alignment */}
        <Btn title="Align left" active={editor.isActive({ textAlign: "left" })} onClick={() => editor.chain().focus().setTextAlign("left").run()}>
          {icons.alignLeft}
        </Btn>
        <Btn title="Align center" active={editor.isActive({ textAlign: "center" })} onClick={() => editor.chain().focus().setTextAlign("center").run()}>
          {icons.alignCenter}
        </Btn>
        <Btn title="Align right" active={editor.isActive({ textAlign: "right" })} onClick={() => editor.chain().focus().setTextAlign("right").run()}>
          {icons.alignRight}
        </Btn>
        <Btn title="Justify" active={editor.isActive({ textAlign: "justify" })} onClick={() => editor.chain().focus().setTextAlign("justify").run()}>
          {icons.alignJustify}
        </Btn>

        <Divider />

        {/* Lists */}
        <Btn title="Bullet list" active={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()}>
          {icons.bulletList}
        </Btn>
        <Btn title="Ordered list" active={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()}>
          {icons.orderedList}
        </Btn>

        <Divider />

        {/* Block elements */}
        <Btn title="Blockquote" active={editor.isActive("blockquote")} onClick={() => editor.chain().focus().toggleBlockquote().run()}>
          {icons.blockquote}
        </Btn>
        <LinkPopover editor={editor} variables={variables} />
        <Btn title={uploading ? "Uploading…" : "Upload image"} disabled={uploading} onClick={() => fileInputRef.current?.click()}>
          {uploading ? icons.imageLoading : icons.image}
        </Btn>
        <ImageUrlPopover
          variables={variables}
          onInsert={(url) =>
            editor.chain().focus().setImage({ src: url }).run()
          }
        />

        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleImageFile(file);
            e.target.value = "";
          }}
        />

        {/* Dynamic variable insertion */}
        {variables.length > 0 && (
          <>
            <Divider />
            <div className="flex items-center gap-1 flex-wrap py-0.5">
              <span className="text-[11px] font-medium text-text-3 pr-0.5">Variables:</span>
              {variables.map((v) => (
                <button
                  key={v}
                  type="button"
                  title={`Insert {{${v}}}`}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    if (codeView) {
                      onChange(value + `{{${v}}}`);
                    } else {
                      insertVariable(v);
                    }
                  }}
                  className="text-[11px] font-mono px-1.5 py-0.5 rounded border border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900 transition-colors"
                >
                  {"{{"}{v}{"}}"}
                </button>
              ))}
            </div>
          </>
        )}

        {/* Code view toggle */}
        <div className="ml-auto pl-1">
          <Btn
            title={codeView ? "Switch to rich editor" : "Edit raw HTML"}
            active={codeView}
            onClick={() => setCodeView((v) => !v)}
          >
            {icons.code}
          </Btn>
        </div>
      </div>

      {/* ── Editor content area / raw HTML textarea ────────────────────────── */}
      {codeView ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          spellCheck={false}
          className="w-full resize-y font-mono text-xs px-5 py-4 bg-canvas text-text-1 focus:outline-none"
          style={{ minHeight }}
          placeholder="<p>Write raw HTML here… use {{variable}} for dynamic content</p>"
        />
      ) : (
        <EditorContent
          editor={editor}
          className="px-5 py-4 [&_.ProseMirror]:min-h-[inherit]"
          style={{ minHeight }}
        />
      )}
    </div>
  );
}
