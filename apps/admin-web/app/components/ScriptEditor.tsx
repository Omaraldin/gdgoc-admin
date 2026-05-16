import { useState, useMemo, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "~/components/ui/dialog";
import { Button } from "~/components/ui/button";
import { Label } from "~/components/ui/label";
import { evalScript } from "~/lib/script-functions";

interface ScriptEditorProps {
  open: boolean;
  onClose: () => void;
  /** Display title shown in the dialog header (e.g. column name). */
  title: string;
  /** The script to pre-populate the editor with (without any "=" prefix). */
  initialScript: string;
  /** Called when the user clicks Apply. Empty string means "clear / use plain value". */
  onSave: (script: string) => void;
  /** Other column values for the current row — exposed as `vars` in the preview. */
  rowVars?: Record<string, string>;
  /** Preamble from the functions library — injected before evaluation. */
  preamble?: string;
  /** Show a "Clear script" button that calls onSave(""). Defaults to true. */
  clearable?: boolean;
}

export function ScriptEditor({
  open,
  onClose,
  title,
  initialScript,
  onSave,
  rowVars = {},
  preamble = "",
  clearable = true,
}: ScriptEditorProps) {
  const [script, setScript] = useState(initialScript);

  // Re-sync when the dialog is opened for a different cell
  useEffect(() => {
    if (open) setScript(initialScript);
  }, [open, initialScript]);

  const preview = useMemo(() => {
    if (!script.trim()) return null;
    return evalScript(script, rowVars, preamble);
  }, [script, rowVars, preamble]);

  const handleApply = () => {
    onSave(script);
    onClose();
  };

  const handleClear = () => {
    onSave("");
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="font-mono bg-violet-100 text-violet-800 text-xs px-2 py-0.5 rounded">ƒx</span>
            <span className="font-mono">{title}</span>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label className="text-xs text-muted-foreground mb-1.5 block">
              JavaScript expression or statements — use{" "}
              <code className="font-mono bg-muted px-1 rounded text-xs">vars.key</code>{" "}
              to read other fields in this row.
            </Label>
            <textarea
              autoFocus
              className="w-full min-h-[140px] font-mono text-sm border border-input rounded-md px-3 py-2 bg-background resize-y focus:outline-none focus:ring-2 focus:ring-ring leading-relaxed"
              value={script}
              onChange={(e) => setScript(e.target.value)}
              placeholder={
                "// Single expression:\nvars.name.toUpperCase()\n\n// Statements with return:\nvar d = new Date(vars.date);\nreturn d.toLocaleDateString('en-US', {year:'numeric', month:'long'});\n\n// Immediately-invoked function:\n(function() {\n  // do things\n  return vars.name + ' — ' + vars.event;\n})()"
              }
              spellCheck={false}
            />
          </div>

          {Object.keys(rowVars).length > 0 && (
            <div className="bg-muted/40 rounded-md p-3 space-y-1.5">
              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
                Available in <code className="font-mono normal-case">vars</code>
              </p>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(rowVars).map(([k, v]) => (
                  <code
                    key={k}
                    className="text-xs bg-background border rounded px-1.5 py-0.5 font-mono"
                    title={`vars.${k}`}
                  >
                    .{k}
                    {v ? (
                      <span className="text-muted-foreground"> = &quot;{v}&quot;</span>
                    ) : null}
                  </code>
                ))}
              </div>
            </div>
          )}

          {preview !== null && (
            <div
              className={`rounded-md px-3 py-2 text-sm border ${
                preview.error
                  ? "bg-red-50 border-red-200 text-red-600"
                  : "bg-emerald-50 border-emerald-200 text-emerald-700"
              }`}
            >
              {preview.error ? (
                <span className="font-mono text-xs">⚠ {preview.error}</span>
              ) : (
                <span className="font-mono">
                  →{" "}
                  {preview.value ? (
                    <>&quot;{preview.value}&quot;</>
                  ) : (
                    <em className="not-italic opacity-60">(empty string)</em>
                  )}
                </span>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          {clearable && (
            <Button
              variant="ghost"
              size="sm"
              className="mr-auto text-muted-foreground"
              onClick={handleClear}
            >
              Clear script
            </Button>
          )}
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleApply}>Apply</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
