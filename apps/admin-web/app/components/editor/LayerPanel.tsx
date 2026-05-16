import { Eye, EyeOff, Image, Shapes, Type, Variable, X } from "lucide-react";
import type { Layer as LayerModel, ShapeProps } from "~/lib/types";
import type { BooleanOp } from "~/lib/booleanOps";
import { CommonTransformPanel, TextPropsPanel, ImagePropsPanel, ShapePropsPanel } from "./PropertyPanels";

// ---------- BooleanOpsPanel ----------

export function BooleanOpsPanel({ count, onRun }: {
  count: number;
  onRun: (op: BooleanOp) => void;
}) {
  const ops: { op: BooleanOp; label: string; title: string }[] = [
    { op: "unite",     label: "Unite",     title: "Combine paths into a single shape" },
    { op: "subtract",  label: "Subtract",  title: "Subtract upper paths from lowest" },
    { op: "intersect", label: "Intersect", title: "Keep only the overlapping region" },
    { op: "exclude",   label: "Exclude",   title: "Keep non-overlapping regions" },
  ];
  return (
    <div className="p-4 border-b">
      <h3 className="text-sm font-semibold text-text-2 mb-2">Path Operations</h3>
      <div className="text-xs text-text-3 mb-2">{count} layers selected</div>
      <div className="grid grid-cols-2 gap-1">
        {ops.map((o) => (
          <button key={o.op} type="button" title={o.title} onClick={() => onRun(o.op)} className="text-xs border rounded py-1.5 hover:bg-canvas">
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------- LayerList ----------

interface LayerListProps {
  layers: LayerModel[];
  selectedId: string | null;
  extraSelectedIds: string[];
  onSelect: (id: string, additive: boolean) => void;
  onToggleVisible: (id: string) => void;
  onRemove: (id: string) => void;
}

export function LayerList({ layers, selectedId, extraSelectedIds, onSelect, onToggleVisible, onRemove }: LayerListProps) {
  return (
    <div className="p-4 border-b">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-text-2">Layers</h3>
        <span className="text-xs text-text-3">{layers.length}</span>
      </div>
      <ul className="space-y-1">
        {[...layers].sort((a, b) => b.z_index - a.z_index).map((layer) => (
          <li
            key={layer.id}
            className={`flex items-center gap-1 px-2 py-1.5 rounded text-xs cursor-pointer ${
              selectedId === layer.id || extraSelectedIds.includes(layer.id) ? "bg-blue-100 text-blue-700" : "hover:bg-canvas"
            }`}
            onClick={(e) => onSelect(layer.id, e.shiftKey)}
          >
            <button
              type="button"
              title={layer.visible ? "Hide" : "Show"}
              className="text-text-3 hover:text-text-1"
              onClick={(e) => { e.stopPropagation(); onToggleVisible(layer.id); }}
            >
              {layer.visible ? <Eye size={13} /> : <EyeOff size={13} />}
            </button>
            <span className="flex-1 truncate flex items-center gap-1">
              {layer.type === "text" ? (
                layer.text_props?.is_dynamic ? (
                  <><Variable size={11} className="shrink-0" />{layer.text_props.variable_key}</>
                ) : (
                  <><Type size={11} className="shrink-0" />{layer.text_props?.content?.slice(0, 20)}</>
                )
              ) : layer.type === "image" ? (
                <><Image size={11} className="shrink-0" />{layer.image_props?.asset_key?.split("/").at(-1)}</>
              ) : (
                <><Shapes size={11} className="shrink-0" />{layer.shape_props?.kind}</>  
              )}
            </span>
            <button
              type="button"
              title="Delete"
              className="text-red-400 hover:text-red-600"
              onClick={(e) => { e.stopPropagation(); onRemove(layer.id); }}
            >
              <X size={12} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------- PropertiesPanel ----------

interface PropertiesPanelProps {
  layer: LayerModel;
  onUpdate: (u: Partial<LayerModel>) => void;
  onReorder: (direction: "up" | "down" | "top" | "bottom") => void;
  onDuplicate: () => void;
  onRemove: () => void;
}

export function PropertiesPanel({ layer, onUpdate, onReorder, onDuplicate, onRemove }: PropertiesPanelProps) {
  // When the user manually edits the W field for a text layer, switch to fixed-width mode.
  const handleTransformUpdate = (u: Partial<LayerModel>) => {
    if (layer.type === "text" && layer.text_props && "width" in u) {
      onUpdate({ ...u, text_props: { ...layer.text_props, auto_width: false } });
    } else {
      onUpdate(u);
    }
  };

  return (
    <div className="p-4 space-y-3">
      <h3 className="text-sm font-semibold text-text-2">Properties</h3>
      <div className="grid grid-cols-4 gap-1">
        <button type="button" className="text-xs border rounded py-1 hover:bg-canvas" onClick={() => onReorder("top")} title="Bring to front">⤒</button>
        <button type="button" className="text-xs border rounded py-1 hover:bg-canvas" onClick={() => onReorder("up")} title="Forward">↑</button>
        <button type="button" className="text-xs border rounded py-1 hover:bg-canvas" onClick={() => onReorder("down")} title="Backward">↓</button>
        <button type="button" className="text-xs border rounded py-1 hover:bg-canvas" onClick={() => onReorder("bottom")} title="Send to back">⤓</button>
      </div>
      <button type="button" onClick={onDuplicate} className="w-full text-xs border rounded py-1 hover:bg-canvas">Duplicate</button>

      <CommonTransformPanel layer={layer} onUpdate={handleTransformUpdate} />

      {layer.type === "text" && layer.text_props && (
        <TextPropsPanel props={layer.text_props} onUpdate={(p) => onUpdate({ text_props: p })} />
      )}
      {layer.type === "image" && layer.image_props && (
        <ImagePropsPanel props={layer.image_props} onUpdate={(p) => onUpdate({ image_props: p })} />
      )}
      {layer.type === "shape" && layer.shape_props && (
        <ShapePropsPanel props={layer.shape_props} onUpdate={(p) => onUpdate({ shape_props: p })} />
      )}

      <button type="button" onClick={onRemove} className="w-full text-sm text-red-600 hover:text-red-800 border border-red-200 rounded px-3 py-1.5">
        Remove Layer
      </button>
    </div>
  );
}
