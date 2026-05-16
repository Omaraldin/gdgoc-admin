import { useState } from "react";
import { Link } from "react-router";
import { Plus, Trash2, Pencil, Code } from "lucide-react";
import {
  loadFunctions,
  saveFunctions,
  buildPreamble,
  evalScript,
} from "~/lib/script-functions";
import type { StoredFunction } from "~/lib/script-functions";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Card, CardContent } from "~/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "~/components/ui/dialog";
import { ConfirmModal } from "~/components/ConfirmModal";

export function meta() {
  return [{ title: "Functions | GDGoC Admin" }];
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ScriptFunctionsPage() {
  const [fns, setFns] = useState<StoredFunction[]>(() => loadFunctions());
  const [editing, setEditing] = useState<StoredFunction | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  // Test console
  const [testScript, setTestScript] = useState("");
  const [testVarsRaw, setTestVarsRaw] = useState(
    '{"name":"Alice","event":"Google I/O"}',
  );
  const [testResult, setTestResult] = useState<{
    value: string;
    error?: string;
  } | null>(null);

  // ---------------------------------------------------------------------------
  // Mutations
  // ---------------------------------------------------------------------------

  const persist = (next: StoredFunction[]) => {
    saveFunctions(next);
    setFns(next);
  };

  const openNew = () => {
    setEditing({
      id: crypto.randomUUID(),
      name: "",
      description: "",
      code: "function myFunction(arg) {\n  return arg;\n}",
    });
    setIsNew(true);
  };

  const openEdit = (fn: StoredFunction) => {
    setEditing({ ...fn });
    setIsNew(false);
  };

  const handleSave = () => {
    if (!editing) return;
    persist(
      isNew
        ? [...fns, editing]
        : fns.map((f) => (f.id === editing.id ? editing : f)),
    );
    setEditing(null);
  };

  const handleDelete = (id: string) => {
    persist(fns.filter((f) => f.id !== id));
    setDeleteTarget(null);
  };

  const runTest = () => {
    let vars: Record<string, string> = {};
    try {
      vars = JSON.parse(testVarsRaw);
    } catch {
      setTestResult({ value: "", error: "Invalid JSON in vars" });
      return;
    }
    setTestResult(evalScript(testScript, vars, buildPreamble(fns)));
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="p-4 sm:p-8 max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link
            to="/batches/new"
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            ← Back to New Batch
          </Link>
          <h1 className="text-xl font-semibold mt-1 text-foreground">
            Script Functions Library
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Define reusable JavaScript functions available in every script cell
            and template field. Stored locally in your browser.
          </p>
        </div>
        <Button type="button" size="sm" onClick={openNew}>
          <Plus className="h-3.5 w-3.5 mr-1" />
          New Function
        </Button>
      </div>

      {/* Functions list */}
      {fns.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground border rounded-lg">
          <Code className="h-8 w-8 mx-auto mb-3 opacity-30" />
          <p className="font-medium">No functions defined yet</p>
          <p className="text-sm mt-1">
            Create reusable helpers to call from any script field instead of
            rewriting the same logic each time.
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-4"
            onClick={openNew}
          >
            <Plus className="h-3.5 w-3.5 mr-1" />
            Create your first function
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {fns.map((fn) => (
            <Card key={fn.id}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <code className="text-sm font-mono font-semibold text-foreground">
                        {fn.name || "(unnamed)"}
                      </code>
                      {fn.description && (
                        <span className="text-xs text-muted-foreground">
                          — {fn.description}
                        </span>
                      )}
                    </div>
                    <pre className="mt-2 text-xs font-mono bg-muted/50 border rounded p-3 overflow-x-auto whitespace-pre-wrap leading-relaxed">
                      {fn.code}
                    </pre>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => openEdit(fn)}
                      title="Edit"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => setDeleteTarget(fn.id)}
                      title="Delete"
                      className="text-destructive hover:text-destructive"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Test console */}
      <Card>
        <CardContent className="p-5 space-y-3">
          <div>
            <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Test Console
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Run any script with all defined functions available.
            </p>
          </div>

          <div>
            <Label className="text-xs mb-1 block">
              vars{" "}
              <span className="text-muted-foreground font-normal">(JSON)</span>
            </Label>
            <Input
              className="font-mono text-xs"
              value={testVarsRaw}
              onChange={(e) => setTestVarsRaw(e.target.value)}
              placeholder='{"name":"Alice","event":"Google I/O"}'
            />
          </div>

          <div>
            <Label className="text-xs mb-1 block">Script</Label>
            <textarea
              className="w-full min-h-[80px] font-mono text-sm border border-input rounded-md px-3 py-2 bg-background resize-y focus:outline-none focus:ring-2 focus:ring-ring leading-relaxed"
              value={testScript}
              onChange={(e) => setTestScript(e.target.value)}
              placeholder="formatDate(vars.event_date)"
              spellCheck={false}
            />
          </div>

          <Button type="button" size="sm" variant="outline" onClick={runTest}>
            ▶ Run
          </Button>

          {testResult && (
            <div
              className={`rounded-md px-3 py-2 text-sm border font-mono ${
                testResult.error
                  ? "bg-red-50 border-red-200 text-red-600"
                  : "bg-emerald-50 border-emerald-200 text-emerald-700"
              }`}
            >
              {testResult.error
                ? `⚠ ${testResult.error}`
                : `→ "${testResult.value}"`}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Edit / New dialog */}
      {editing && (
        <Dialog
          open
          onOpenChange={(o) => {
            if (!o) setEditing(null);
          }}
        >
          <DialogContent className="max-w-xl">
            <DialogHeader>
              <DialogTitle>
                {isNew ? "New Function" : "Edit Function"}
              </DialogTitle>
            </DialogHeader>

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">
                    Name <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    className="font-mono text-sm"
                    placeholder="formatDate"
                    value={editing.name}
                    onChange={(e) =>
                      setEditing({
                        ...editing,
                        name: e.target.value.replace(/\s+/g, ""),
                      })
                    }
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Call it as{" "}
                    <code className="font-mono">
                      {editing.name || "functionName"}(…)
                    </code>{" "}
                    in any script.
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Description</Label>
                  <Input
                    className="text-sm"
                    placeholder="Formats a date string"
                    value={editing.description}
                    onChange={(e) =>
                      setEditing({ ...editing, description: e.target.value })
                    }
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">
                  Code <span className="text-destructive">*</span>
                </Label>
                <textarea
                  autoFocus
                  className="w-full min-h-[200px] font-mono text-sm border border-input rounded-md px-3 py-2 bg-background resize-y focus:outline-none focus:ring-2 focus:ring-ring leading-relaxed"
                  value={editing.code}
                  onChange={(e) =>
                    setEditing({ ...editing, code: e.target.value })
                  }
                  spellCheck={false}
                  placeholder={
                    "function formatDate(d) {\n  return new Date(d).toLocaleDateString('en-US', {\n    year: 'numeric',\n    month: 'long',\n    day: 'numeric',\n  });\n}"
                  }
                />
                <p className="text-[11px] text-muted-foreground">
                  You can define multiple functions or helper variables here.
                  The entire block is injected before every script evaluation.
                </p>
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setEditing(null)}>
                Cancel
              </Button>
              <Button
                onClick={handleSave}
                disabled={!editing.name.trim() || !editing.code.trim()}
              >
                {isNew ? "Create" : "Save changes"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Delete confirm */}
      {deleteTarget && (
        <ConfirmModal
          title="Delete function?"
          message="This function will be removed from the library. Scripts that reference it by name will fail until updated."
          destructive
          confirmLabel="Delete"
          onConfirm={() => handleDelete(deleteTarget)}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}
