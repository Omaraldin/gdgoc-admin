import { useEffect, useRef, useState } from "react";
import { X, Variable } from "lucide-react";
import type { Layer as LayerModel, TextProps, ImageProps, ShapeProps, ShapeKind, GradientStop, StrokeAlignment, StrokeLineCap, StrokeLineJoin, QrProps, QrErrorCorrectionLevel } from "~/lib/types";
import { loadGoogleFont, loadCustomFontFile, getCustomFonts, subscribeCustomFonts } from "~/lib/fonts";
import { FontPicker, WeightPicker } from "~/components/FontPicker";
import { ColorPicker } from "./ColorPicker";

// ---------- Shared variable catalogue ----------
// Single source of truth used by TextPropsPanel (content chips)
// and QrPropsPanel (content chips). Mirrors the variable_key select options.

export const ALL_DYNAMIC_VARIABLES: { group: string; vars: { key: string; label: string }[] }[] = [
  {
    group: "Recipient",
    vars: [
      { key: "recipient_name", label: "recipient_name" },
      { key: "event_name",     label: "event_name" },
      { key: "issue_date",     label: "issue_date" },
    ],
  },
  {
    group: "Certificate",
    vars: [
      { key: "cert.id",         label: "cert.id" },
      { key: "cert.pdf_url",    label: "cert.pdf_url" },
      { key: "cert.verify_url", label: "cert.verify_url" },
    ],
  },
  {
    group: "Batch",
    vars: [
      { key: "batch.name",             label: "batch.name" },
      { key: "batch.cert_name",        label: "batch.cert_name" },
      { key: "batch.cert_description", label: "batch.cert_description" },
    ],
  },
  {
    group: "Chapter",
    vars: [
      { key: "chapter.name",            label: "chapter.name" },
      { key: "chapter.leader",          label: "chapter.leader" },
      { key: "chapter.leader_codename", label: "chapter.leader_codename" },
      { key: "chapter.code",            label: "chapter.code" },
      { key: "chapter.since",           label: "chapter.since" },
    ],
  },
];

/** Flat list of every variable key (for simple chip rows). */
const ALL_VARS_FLAT = ALL_DYNAMIC_VARIABLES.flatMap((g) => g.vars);

// ---------- NumField ----------

export function NumField({ label, value, onChange, disabled }: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  disabled?: boolean;
}) {
  return (
    <label className="block text-xs text-text-2">
      {label}
      <input
        type="number"
        disabled={disabled}
        className="mt-0.5 w-full border rounded px-1.5 py-1 text-xs disabled:opacity-50"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}

// ---------- OriginPicker ----------

// Origin is stored as "col-row" where col/row ∈ {0,1,2} (0=left/top, 1=center, 2=right/bottom).
// layer.x / layer.y are always the CENTER of the object (Konva offset = width/2, height/2).
// The picker only affects how the X/Y fields are displayed and edited — no layer data changes.

type OriginKey =
  | "0-0" | "1-0" | "2-0"
  | "0-1" | "1-1" | "2-1"
  | "0-2" | "1-2" | "2-2";

const ORIGIN_OFFSETS: Record<OriginKey, [number, number]> = {
  "0-0": [-0.5, -0.5], "1-0": [0, -0.5], "2-0": [0.5, -0.5],
  "0-1": [-0.5,  0  ], "1-1": [0,  0  ], "2-1": [0.5,  0  ],
  "0-2": [-0.5,  0.5], "1-2": [0,  0.5], "2-2": [0.5,  0.5],
};

const ORIGIN_LABELS: Record<OriginKey, string> = {
  "0-0": "Top Left",    "1-0": "Top Center",    "2-0": "Top Right",
  "0-1": "Middle Left", "1-1": "Center",        "2-1": "Middle Right",
  "0-2": "Bottom Left", "1-2": "Bottom Center", "2-2": "Bottom Right",
};

function OriginPicker({ value, onChange }: { value: OriginKey; onChange: (k: OriginKey) => void }) {
  return (
    <div className="grid grid-cols-3 gap-[3px] w-[42px]" title="Origin point">
      {(["0-0","1-0","2-0","0-1","1-1","2-1","0-2","1-2","2-2"] as OriginKey[]).map((k) => (
        <button
          key={k}
          type="button"
          title={ORIGIN_LABELS[k]}
          onClick={() => onChange(k)}
          className={`w-[12px] h-[12px] rounded-sm border transition-colors ${
            value === k
              ? "bg-g-blue border-g-blue"
              : "bg-transparent border-text-3 hover:border-text-1"
          }`}
        />
      ))}
    </div>
  );
}

// ---------- CommonTransformPanel ----------

export function CommonTransformPanel({ layer, onUpdate }: {
  layer: LayerModel;
  onUpdate: (u: Partial<LayerModel>) => void;
}) {
  const originCacheRef = useRef(new Map<string, OriginKey>());
  const [origin, setOriginState] = useState<OriginKey>(
    () => originCacheRef.current.get(layer.id) ?? "1-1",
  );

  useEffect(() => {
    setOriginState(originCacheRef.current.get(layer.id) ?? "1-1");
  }, [layer.id]);

  const setOrigin = (k: OriginKey) => {
    originCacheRef.current.set(layer.id, k);
    setOriginState(k);
  };

  const [ox, oy] = ORIGIN_OFFSETS[origin];
  // Convert center-stored x/y → display x/y for the chosen origin
  const displayX = Math.round(layer.x + ox * layer.width);
  const displayY = Math.round(layer.y + oy * layer.height);

  const handleX = (v: number) => onUpdate({ x: v - ox * layer.width });
  const handleY = (v: number) => onUpdate({ y: v - oy * layer.height });

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <OriginPicker value={origin} onChange={setOrigin} />
        <div className="grid grid-cols-2 gap-2 flex-1">
          <NumField label="X" value={displayX} onChange={handleX} />
          <NumField label="Y" value={displayY} onChange={handleY} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <NumField label="W" value={Math.round(layer.width)} onChange={(v) => onUpdate({ width: Math.max(1, v) })} />
        <NumField label="H" value={Math.round(layer.height)} onChange={(v) => onUpdate({ height: Math.max(1, v) })} disabled={layer.type === "text"} />
      </div>
      <div>
        <label className="block text-xs text-text-2">
          Rotation: {Math.round(layer.rotation)}°
          <input
            type="range"
            min={-180}
            max={180}
            value={layer.rotation}
            onChange={(e) => onUpdate({ rotation: Number(e.target.value) })}
            className="w-full"
          />
        </label>
      </div>
    </div>
  );
}

// ---------- TextPropsPanel ----------

export function TextPropsPanel({ props, onUpdate }: {
  props: TextProps;
  onUpdate: (p: TextProps) => void;
}) {
  const set = <K extends keyof TextProps>(key: K, value: TextProps[K]) =>
    onUpdate({ ...props, [key]: value });

  const contentRef = useRef<HTMLTextAreaElement>(null);

  /** Insert {{variable}} at cursor inside the content textarea. */
  const insertContentVar = (key: string) => {
    const el = contentRef.current;
    const token = `{{${key}}}`;
    if (!el) { set("content", props.content + token); return; }
    const start = el.selectionStart ?? props.content.length;
    const end   = el.selectionEnd   ?? props.content.length;
    const next  = props.content.slice(0, start) + token + props.content.slice(end);
    set("content", next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + token.length, start + token.length);
    });
  };

  return (
    <div className="space-y-2 pt-2 border-t">
      <h4 className="text-xs font-semibold text-text-2">Text</h4>
      <label className="block text-xs text-text-2">
        Content
        <textarea
          ref={contentRef}
          rows={2}
          className="mt-1 w-full border rounded px-2 py-1 text-sm"
          value={props.content}
          onChange={(e) => set("content", e.target.value)}
          disabled={props.is_dynamic}
        />
      </label>
      {!props.is_dynamic && (
        <>
          <p className="text-[11px] text-text-3">
            Use <span className="font-mono">{"{{field_name}}"}</span> to inject dynamic values.
          </p>
          {/* Variable chip insertion for content field */}
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-text-3 mb-1">Insert variable</p>
            <div className="flex flex-wrap gap-1">
              {ALL_VARS_FLAT.map((v) => (
                <button
                  key={v.key}
                  type="button"
                  title={`Insert {{${v.key}}}`}
                  onClick={() => insertContentVar(v.key)}
                  className="text-[10px] font-mono px-1.5 py-0.5 rounded border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors"
                >
                  {`{{${v.label}}}`}
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      <label className="block text-xs text-text-2">
        Font Family
        <FontPicker
          className="mt-1"
          value={props.font_family}
          onChange={(family, assetKey) => {
            if (!assetKey) loadGoogleFont(family);
            onUpdate({ ...props, font_family: family, font_asset_key: assetKey ?? "" });
          }}
        />
      </label>

      <div className="grid grid-cols-2 gap-2">
        <NumField label="Size" value={props.font_size} onChange={(v) => set("font_size", Math.max(1, Math.round(v)))} />
        <label className="block text-xs text-text-2">
          Color
          <div className="mt-1 flex items-center gap-1.5">
            <ColorPicker value={props.color} onChange={(v) => set("color", v)} />
            <span className="text-xs text-text-3 font-mono uppercase">{props.color}</span>
          </div>
        </label>
      </div>

      <label className="block text-xs text-text-2">
        Weight
        <WeightPicker
          fontFamily={props.font_family}
          value={props.font_weight ?? (props.bold ? 700 : 400)}
          onChange={(w) => onUpdate({ ...props, font_weight: w, bold: w >= 700 })}
          className="mt-1"
        />
      </label>

      <div className="flex gap-3">
        <label className="flex items-center gap-1 text-xs">
          <input type="checkbox" checked={props.italic} onChange={(e) => set("italic", e.target.checked)} /> Italic
        </label>
      </div>

      <div className="grid grid-cols-4 gap-1">
        {(["none", "uppercase", "lowercase", "capitalize"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => set("text_transform", t === "none" ? undefined : t)}
            className={`text-[10px] border rounded py-1 truncate ${
              (props.text_transform ?? "none") === t
                ? "bg-g-blue text-white border-g-blue"
                : "hover:bg-canvas"
            }`}
            title={t === "none" ? "As-is" : t.charAt(0).toUpperCase() + t.slice(1)}
          >
            {t === "none" ? "Aa" : t === "uppercase" ? "AA" : t === "lowercase" ? "aa" : "Aa·"}
          </button>
        ))}
      </div>

      <label className="block text-xs text-text-2">
        Align
        <select className="mt-1 w-full border rounded px-2 py-1 text-sm" value={props.align} onChange={(e) => set("align", e.target.value as TextProps["align"])}>
          <option value="left">Left</option>
          <option value="center">Center</option>
          <option value="right">Right</option>
        </select>
      </label>

      <div className="flex items-center gap-1">
        <label className="flex items-center gap-1 text-xs flex-1">
          Auto width
          <span className="text-text-2 text-[10px] ml-1">(fits content)</span>
          <input
            type="checkbox"
            checked={props.auto_width !== false}
            onChange={(e) => set("auto_width", e.target.checked ? true : false)}
            className="ml-auto"
          />
        </label>
        {props.auto_width === false && (
          <button
            type="button"
            className="shrink-0 border rounded px-2 py-0.5 text-[10px] hover:bg-canvas whitespace-nowrap"
            title="Reset width to fit text content"
            onClick={() => set("auto_width", true)}
          >
            Fit to text
          </button>
        )}
      </div>

      <label className="flex items-center gap-1 text-xs">
        Dynamic field
        <input type="checkbox" checked={props.is_dynamic} onChange={(e) => set("is_dynamic", e.target.checked)} className="ml-auto" />
      </label>
      {props.is_dynamic && (
        <div className="space-y-1.5 p-2 rounded bg-blue-50 border border-blue-200">
          <div className="text-xs font-medium text-blue-700 flex items-center gap-1">
            <Variable size={11} /> Dynamic field
          </div>
          <p className="text-[11px] text-blue-700/90">
            Tip: for mixed text, turn this off and use <span className="font-mono">{"{{field_name}}"}</span> in Content.
          </p>
          <div className="text-xs text-text-2">Preset</div>
          <select
            className="w-full border rounded px-2 py-1 text-xs"
            value={props.variable_key ?? ""}
            onChange={(e) => set("variable_key", e.target.value)}
          >
            <option value="">— custom —</option>
            <optgroup label="Recipient">
              <option value="recipient_name">Recipient Name</option>
              <option value="event_name">Event Name</option>
              <option value="issue_date">Issue Date</option>
            </optgroup>
            <optgroup label="Certificate (auto-filled)">
              <option value="cert.id">cert.id</option>
              <option value="cert.pdf_url">cert.pdf_url</option>
              <option value="cert.verify_url">cert.verify_url</option>
            </optgroup>
            <optgroup label="Batch">
              <option value="batch.name">batch.name</option>
              <option value="batch.cert_name">batch.cert_name</option>
              <option value="batch.cert_description">batch.cert_description</option>
            </optgroup>
            <optgroup label="Chapter (auto-filled)">
              <option value="chapter.name">chapter.name</option>
              <option value="chapter.leader">chapter.leader</option>
              <option value="chapter.leader_codename">chapter.leader_codename</option>
              <option value="chapter.code">chapter.code</option>
              <option value="chapter.since">chapter.since</option>
            </optgroup>
          </select>
          {(props.variable_key === "" || props.variable_key === undefined || !["recipient_name","event_name","issue_date","cert.id","cert.pdf_url","chapter.name","chapter.leader","chapter.leader_codename","chapter.code","chapter.since"].includes(props.variable_key)) && (
            <input
              className="w-full border rounded px-2 py-1 text-xs font-mono"
              value={props.variable_key ?? ""}
              placeholder="custom_key or global.field_name"
              onChange={(e) => set("variable_key", e.target.value)}
            />
          )}
        </div>
      )}
    </div>
  );
}

// ---------- ImagePropsPanel ----------

export function ImagePropsPanel({ props, onUpdate }: {
  props: ImageProps;
  onUpdate: (p: ImageProps) => void;
}) {
  return (
    <div className="space-y-2 pt-2 border-t">
      <h4 className="text-xs font-semibold text-text-2">Image</h4>
      <div className="text-xs text-text-3 font-mono break-all">{props.asset_key}</div>
      <label className="block text-xs text-text-2">
        Object Fit
        <select className="mt-1 w-full border rounded px-2 py-1 text-sm" value={props.object_fit} onChange={(e) => onUpdate({ ...props, object_fit: e.target.value as ImageProps["object_fit"] })}>
          <option value="contain">Contain</option>
          <option value="cover">Cover</option>
          <option value="fill">Fill</option>
        </select>
      </label>
    </div>
  );
}

// ---------- ShapePropsPanel ----------

export function ShapePropsPanel({ props, onUpdate }: {
  props: ShapeProps;
  onUpdate: (p: ShapeProps) => void;
}) {
  const set = <K extends keyof ShapeProps>(key: K, value: ShapeProps[K]) =>
    onUpdate({ ...props, [key]: value });

  const updateStop = (i: number, patch: Partial<GradientStop>) =>
    set("gradient_stops", props.gradient_stops.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));

  const addStop = () => {
    const stops = [...props.gradient_stops, { offset: 1, color: "#ffffff" }].sort((a, b) => a.offset - b.offset);
    set("gradient_stops", stops);
  };

  const removeStop = (i: number) => {
    if (props.gradient_stops.length <= 2) return;
    set("gradient_stops", props.gradient_stops.filter((_, idx) => idx !== i));
  };

  return (
    <div className="space-y-3 pt-2 border-t">
      <h4 className="text-xs font-semibold text-text-2">Shape</h4>

      <label className="block text-xs text-text-2">
        Type
        <select className="mt-1 w-full border rounded px-2 py-1 text-sm" value={props.kind} onChange={(e) => set("kind", e.target.value as ShapeKind)}>
          <option value="rect">Rectangle</option>
          <option value="rounded-rect">Rounded Rectangle</option>
          <option value="circle">Circle / Ellipse</option>
          <option value="line">Line</option>
        </select>
      </label>

      {props.kind === "rounded-rect" && (
        <NumField label="Corner Radius" value={props.corner_radius} onChange={(v) => set("corner_radius", Math.max(0, v))} />
      )}

      {props.kind !== "line" && (
        <div>
          <h5 className="text-xs font-medium text-text-2 mb-1">Fill</h5>
          <div className="flex gap-1 mb-2">
            {(["none", "solid", "gradient"] as const).map((ft) => (
              <button key={ft} type="button" onClick={() => set("fill_type", ft)}
                className={`flex-1 text-xs border rounded py-1 capitalize ${props.fill_type === ft ? "bg-g-blue text-white border-g-blue" : "hover:bg-canvas"}`}>
                {ft}
              </button>
            ))}
          </div>

          {props.fill_type === "solid" && (
            <label className="block text-xs text-text-2">
              Color
              <div className="mt-1 flex items-center gap-1.5">
                <ColorPicker value={props.fill_color} onChange={(v) => set("fill_color", v)} />
                <span className="text-xs text-text-3 font-mono uppercase">{props.fill_color}</span>
              </div>
            </label>
          )}

          {props.fill_type === "gradient" && (
            <div className="space-y-2">
              <div className="flex gap-1">
                {(["linear", "radial"] as const).map((gt) => (
                  <button key={gt} type="button" onClick={() => set("gradient_type", gt)}
                    className={`flex-1 text-xs border rounded py-1 capitalize ${props.gradient_type === gt ? "bg-g-blue text-white border-g-blue" : "hover:bg-canvas"}`}>
                    {gt}
                  </button>
                ))}
              </div>

              {props.gradient_type === "linear" && (
                <label className="block text-xs text-text-2">
                  Angle: {props.gradient_angle}°
                  <input type="range" min={0} max={360} value={props.gradient_angle} onChange={(e) => set("gradient_angle", Number(e.target.value))} className="w-full" />
                </label>
              )}

              <div>
                <div className="flex items-center justify-between text-xs text-text-2 mb-1">
                  <span>Color Stops</span>
                  <button type="button" onClick={addStop} className="text-g-blue hover:underline text-xs">+ Add</button>
                </div>
                <div className="space-y-1">
                  {props.gradient_stops.map((stop, i) => (
                    <div key={i} className="flex items-center gap-1">
                      <ColorPicker value={stop.color} onChange={(v) => updateStop(i, { color: v })} />
                      <input type="range" min={0} max={1} step={0.01} value={stop.offset} className="flex-1" onChange={(e) => updateStop(i, { offset: Number(e.target.value) })} />
                      <span className="text-xs text-text-3 w-8 text-right shrink-0">{Math.round(stop.offset * 100)}%</span>
                      <button type="button" onClick={() => removeStop(i)} disabled={props.gradient_stops.length <= 2}
                        className="text-red-400 hover:text-red-600 disabled:opacity-30 shrink-0"><X size={12} /></button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      <div>
        <h5 className="text-xs font-medium text-text-2 mb-1">Stroke</h5>
        <label className="flex items-center gap-2 text-xs mb-2">
          <input type="checkbox" checked={props.stroke} onChange={(e) => set("stroke", e.target.checked)} />
          Enable stroke
        </label>
        {props.stroke && (
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <label className="block text-xs text-text-2">
                Color
                <div className="mt-1 flex items-center gap-1.5">
                  <ColorPicker value={props.stroke_color} onChange={(v) => set("stroke_color", v)} />
                  <span className="text-xs text-text-3 font-mono uppercase">{props.stroke_color}</span>
                </div>
              </label>
              <NumField label="Width (px)" value={props.stroke_width} onChange={(v) => set("stroke_width", Math.max(1, v))} />
            </div>
            <div>
              <div className="text-xs text-text-2 mb-1">Align</div>
              <div className="flex gap-1">
                {(["inside", "center", "outside"] as StrokeAlignment[]).map((a) => (
                  <button key={a} type="button" onClick={() => set("stroke_alignment", a)}
                    className={`flex-1 text-xs border rounded py-1 capitalize ${(props.stroke_alignment ?? "center") === a ? "bg-g-blue text-white border-g-blue" : "hover:bg-canvas"}`}>
                    {a}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div className="text-xs text-text-2 mb-1">Join</div>
              <div className="flex gap-1">
                {(["miter", "round", "bevel"] as StrokeLineJoin[]).map((j) => (
                  <button key={j} type="button" onClick={() => set("stroke_linejoin", j)}
                    className={`flex-1 text-xs border rounded py-1 capitalize ${(props.stroke_linejoin ?? "miter") === j ? "bg-g-blue text-white border-g-blue" : "hover:bg-canvas"}`}>
                    {j}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div className="text-xs text-text-2 mb-1">Cap</div>
              <div className="flex gap-1">
                {(["butt", "round", "square"] as StrokeLineCap[]).map((c) => (
                  <button key={c} type="button" onClick={() => set("stroke_linecap", c)}
                    className={`flex-1 text-xs border rounded py-1 capitalize ${(props.stroke_linecap ?? "butt") === c ? "bg-g-blue text-white border-g-blue" : "hover:bg-canvas"}`}>
                    {c}
                  </button>
                ))}
              </div>
            </div>
            {(props.stroke_linejoin ?? "miter") === "miter" && (
              <NumField label="Miter Limit" value={props.stroke_miter_limit ?? 4} onChange={(v) => set("stroke_miter_limit", Math.max(1, v))} />
            )}
            <label className="block text-xs text-text-2">
              Dash (comma-sep, blank = solid)
              <input
                type="text"
                className="mt-1 w-full border rounded px-2 py-1 text-xs font-mono"
                value={(props.stroke_dash ?? []).join(",")}
                placeholder="e.g. 6,3"
                onChange={(e) => {
                  const parts = e.target.value.split(",").map((s) => Number(s.trim())).filter((n) => Number.isFinite(n) && n > 0);
                  set("stroke_dash", parts);
                }}
              />
            </label>
          </div>
        )}
      </div>

      {props.kind === "path" && props.path_props && (
        <div className="pt-2 border-t">
          <h5 className="text-xs font-medium text-text-2 mb-1">Path</h5>
          <div className="text-xs text-text-2 mb-1">Fill Rule</div>
          <div className="flex gap-1">
            {(["nonzero", "evenodd"] as const).map((r) => (
              <button key={r} type="button" onClick={() => set("path_props", { ...props.path_props!, fill_rule: r })}
                className={`flex-1 text-xs border rounded py-1 ${props.path_props!.fill_rule === r ? "bg-g-blue text-white border-g-blue" : "hover:bg-canvas"}`}>
                {r === "nonzero" ? "Non-zero" : "Even-Odd"}
              </button>
            ))}
          </div>
          <div className="mt-2 text-xs text-text-3">
            {props.path_props.subpaths.reduce((n, sp) => n + sp.anchors.length, 0)} anchors,{" "}
            {props.path_props.subpaths.length} subpath{props.path_props.subpaths.length === 1 ? "" : "s"}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- QrPropsPanel ----------

const EC_LEVELS: { value: QrErrorCorrectionLevel; label: string; hint: string }[] = [
  { value: "L", label: "L", hint: "~7% recovery" },
  { value: "M", label: "M", hint: "~15% recovery" },
  { value: "Q", label: "Q", hint: "~25% recovery" },
  { value: "H", label: "H", hint: "~30% recovery" },
];

export function QrPropsPanel({ props, onUpdate }: {
  props: QrProps;
  onUpdate: (p: QrProps) => void;
}) {
  const set = <K extends keyof QrProps>(key: K, value: QrProps[K]) =>
    onUpdate({ ...props, [key]: value });

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  /** Insert a {{variable}} chip at the current cursor position in the textarea. */
  const insertVar = (variable: string) => {
    const el = textareaRef.current;
    const insertion = `{{${variable}}}`;
    if (!el) {
      set("content", props.content + insertion);
      return;
    }
    const start = el.selectionStart ?? props.content.length;
    const end   = el.selectionEnd   ?? props.content.length;
    const next  = props.content.slice(0, start) + insertion + props.content.slice(end);
    set("content", next);
    requestAnimationFrame(() => {
      const pos = start + insertion.length;
      el.focus();
      el.setSelectionRange(pos, pos);
    });
  };

  return (
    <div className="space-y-3 pt-2 border-t">
      <h4 className="text-xs font-semibold text-text-2 flex items-center gap-1.5">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
          <rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>
        </svg>
        QR Code
      </h4>

      {/* Content / URL */}
      <label className="block text-xs text-text-2">
        Content (URL or text)
        <textarea
          ref={textareaRef}
          rows={3}
          className="mt-1 w-full border rounded px-2 py-1.5 text-xs font-mono resize-none focus:outline-none focus:ring-2 focus:ring-g-blue/40"
          value={props.content}
          placeholder="https://example.com or {{cert.verify_url}}"
          onChange={(e) => set("content", e.target.value)}
        />
      </label>

      {/* Variable chip insertion — all known variables */}
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wide text-text-3 mb-1">Insert variable</p>
        {ALL_DYNAMIC_VARIABLES.map((group) => (
          <div key={group.group} className="mb-2">
            <p className="text-[9px] uppercase tracking-wider text-text-3 mb-0.5">{group.group}</p>
            <div className="flex flex-wrap gap-1">
              {group.vars.map((v) => (
                <button
                  key={v.key}
                  type="button"
                  title={`Insert {{${v.key}}}`}
                  onClick={() => insertVar(v.key)}
                  className="text-[10px] font-mono px-1.5 py-0.5 rounded border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors"
                >
                  {`{{${v.key}}}`}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Colors */}
      <div className="grid grid-cols-2 gap-2">
        <label className="block text-xs text-text-2">
          Foreground
          <div className="mt-1 flex items-center gap-1.5">
            <ColorPicker value={props.color_dark} onChange={(v) => set("color_dark", v)} />
            <span className="text-xs text-text-3 font-mono uppercase">{props.color_dark}</span>
          </div>
        </label>
        <label className="block text-xs text-text-2">
          Background
          <div className="mt-1 flex items-center gap-1.5">
            <ColorPicker value={props.color_light} onChange={(v) => set("color_light", v)} />
            <span className="text-xs text-text-3 font-mono uppercase">{props.color_light}</span>
          </div>
        </label>
      </div>

      {/* Error correction */}
      <div>
        <p className="text-xs text-text-2 mb-1">Error Correction</p>
        <div className="grid grid-cols-4 gap-1">
          {EC_LEVELS.map((ec) => (
            <button
              key={ec.value}
              type="button"
              title={ec.hint}
              onClick={() => set("error_correction", ec.value)}
              className={`text-xs border rounded py-1 font-mono ${
                props.error_correction === ec.value
                  ? "bg-g-blue text-white border-g-blue"
                  : "hover:bg-canvas"
              }`}
            >
              {ec.label}
            </button>
          ))}
        </div>
        <p className="mt-1 text-[10px] text-text-3">
          Higher = more data recovery, denser pattern.
        </p>
      </div>
    </div>
  );
}
