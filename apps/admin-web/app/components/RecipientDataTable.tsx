import {
    useState,
    useMemo,
    useEffect,
    useRef,
    forwardRef,
    useImperativeHandle,
    useCallback,
} from "react";
import * as XLSX from "xlsx";
import { Plus, Trash2, Code, Upload } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { ScriptEditor } from "~/components/ScriptEditor";
import { evalScript } from "~/lib/script-functions";
import { cn } from "~/lib/utils";
import type { RecipientInput } from "~/lib/api/issuance";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type CellVal = { raw: string; isScript: boolean };
type InternalRow = { id: string; cells: Record<string, CellVal> };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let _rowSeq = 0;
function makeRow(columns: string[]): InternalRow {
    return {
        id: String(++_rowSeq),
        cells: Object.fromEntries(columns.map((c) => [c, { raw: "", isScript: false }])),
    };
}

/**
 * Evaluates all cells in a row.
 * Script cells receive `vars` = the plain-text values of all non-script cells + contextVars.
 */
function evalRow(
    row: InternalRow,
    preamble: string,
    contextVars: Record<string, string> = {},
): Record<string, { value: string; error?: string }> {
    // First pass: gather plain values
    const plain: Record<string, string> = {};
    for (const [k, cell] of Object.entries(row.cells)) {
        if (!cell.isScript) plain[k] = cell.raw;
    }

    // Merge context (context keys don't overwrite row values)
    const varsForScript = { ...contextVars, ...plain };

    // Second pass: evaluate scripts + collect plain values
    const result: Record<string, { value: string; error?: string }> = {};
    for (const [k, cell] of Object.entries(row.cells)) {
        if (cell.isScript && cell.raw.trim()) {
            result[k] = evalScript(cell.raw, varsForScript, preamble);
        } else if (cell.isScript) {
            result[k] = { value: "" };
        } else {
            result[k] = { value: cell.raw };
        }
    }
    return result;
}

function parseCSVIntoRows(text: string, columns: string[]): InternalRow[] {
    const lines = text.trim().split(/\r?\n/);
    if (lines.length < 2) return [];
    const headers = lines[0]!.split(",").map((h) => h.trim().replace(/^"|"$/g, ""));
    return lines
        .slice(1)
        .filter(Boolean)
        .map((line) => {
            const values = line.split(",").map((v) => v.trim().replace(/^"|"$/g, ""));
            const row = makeRow(columns);
            headers.forEach((h, i) => {
                if (Object.prototype.hasOwnProperty.call(row.cells, h)) {
                    row.cells[h] = { raw: values[i] ?? "", isScript: false };
                }
            });
            return row;
        });
}

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface RecipientDataTableHandle {
    compile(): { recipients: RecipientInput[]; errors: string[] };
}

interface Props {
    /** All column names including "email". Order matters — email should be first. */
    columns: string[];
    /** Preamble from the user's functions library. */
    preamble?: string;
    /**
     * Extra read-only variables available in every script (chapter, batch, template info).
     * Merged into `vars` when opening the ScriptEditor and during evaluation.
     */
    contextVars?: Record<string, string>;
    /** Called whenever the table contents change with the fully-evaluated recipient list. */
    onChange: (recipients: RecipientInput[], hasErrors: boolean) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const RecipientDataTable = forwardRef<RecipientDataTableHandle, Props>(
    function RecipientDataTable({ columns, preamble = "", contextVars = {}, onChange }, ref) {
        const [rows, setRows] = useState<InternalRow[]>(() => [makeRow(columns)]);

        // Which cell's script editor is open
        const [scriptCell, setScriptCell] = useState<{ rowId: string; col: string } | null>(null);
        // Which column formula editor is open
        const [colFormula, setColFormula] = useState<string | null>(null);

        const fileRef = useRef<HTMLInputElement>(null);
        const onChangeRef = useRef(onChange);
        onChangeRef.current = onChange;

        // ---------------------------------------------------------------------------
        // Evaluate all rows (memoised for render)
        // ---------------------------------------------------------------------------
        const evalledRows = useMemo(
            () => rows.map((r) => ({ id: r.id, evalled: evalRow(r, preamble, contextVars) })),
            [rows, preamble, contextVars],
        );

        // Notify parent whenever evaluated results change
        useEffect(() => {
            let hasErrors = false;
            const recipients: RecipientInput[] = evalledRows.map(({ id, evalled }) => {
                const row = rows.find((r) => r.id === id);
                const variables: Record<string, string> = {};
                const scripts: Record<string, string> = {};
                let email = "";
                for (const [k, v] of Object.entries(evalled)) {
                    if (v.error) hasErrors = true;
                    if (k === "email") email = v.value;
                    else variables[k] = v.value;
                }
                if (row) {
                    for (const [k, cell] of Object.entries(row.cells)) {
                        if (cell.isScript && cell.raw.trim()) scripts[k] = cell.raw;
                    }
                }
                return { email, variables, ...(Object.keys(scripts).length ? { scripts } : {}) };
            });
            onChangeRef.current(recipients, hasErrors);
        }, [evalledRows, rows]);

        // ---------------------------------------------------------------------------
        // Imperative handle
        // ---------------------------------------------------------------------------
        useImperativeHandle(ref, () => ({
            compile() {
                const errors: string[] = [];
                const recipients: RecipientInput[] = rows.map((r, i) => {
                    const evalled = evalRow(r, preamble, contextVars);
                    const variables: Record<string, string> = {};
                    const scripts: Record<string, string> = {};
                    let email = "";
                    for (const [k, v] of Object.entries(evalled)) {
                        if (v.error) errors.push(`Row ${i + 1} — "${k}": ${v.error}`);
                        if (k === "email") email = v.value;
                        else variables[k] = v.value;
                    }
                    for (const [k, cell] of Object.entries(r.cells)) {
                        if (cell.isScript && cell.raw.trim()) scripts[k] = cell.raw;
                    }
                    return { email, variables, ...(Object.keys(scripts).length ? { scripts } : {}) };
                });
                return { recipients, errors };
            },
        }));

        // ---------------------------------------------------------------------------
        // Mutations
        // ---------------------------------------------------------------------------
        const setCell = useCallback(
            (rowId: string, col: string, raw: string, isScript: boolean) =>
                setRows((prev) =>
                    prev.map((r) =>
                        r.id === rowId
                            ? { ...r, cells: { ...r.cells, [col]: { raw, isScript } } }
                            : r,
                    ),
                ),
            [],
        );

        const applyColFormula = useCallback(
            (col: string, script: string) =>
                setRows((prev) =>
                    prev.map((r) => ({
                        ...r,
                        cells: {
                            ...r.cells,
                            [col]: script.trim()
                                ? { raw: script, isScript: true }
                                : { raw: "", isScript: false },
                        },
                    })),
                ),
            [],
        );

        const addRow = () => setRows((prev) => [...prev, makeRow(columns)]);
        const removeRow = (id: string) =>
            setRows((prev) => prev.filter((r) => r.id !== id));

        // ---------------------------------------------------------------------------
        // File import
        // ---------------------------------------------------------------------------
        const importCSV = useCallback(
            (text: string) => {
                const imported = parseCSVIntoRows(text, columns);
                if (imported.length > 0) setRows(imported);
            },
            [columns],
        );

        const handleFile = (file: File) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                const data = new Uint8Array(e.target!.result as ArrayBuffer);
                const wb = XLSX.read(data, { type: "array" });
                const sheet = wb.Sheets[wb.SheetNames[0]!];
                importCSV(XLSX.utils.sheet_to_csv(sheet!));
            };
            reader.readAsArrayBuffer(file);
        };

        // ---------------------------------------------------------------------------
        // Script editor state helpers
        // ---------------------------------------------------------------------------
        const scriptCellRow = scriptCell
            ? rows.find((r) => r.id === scriptCell.rowId)
            : null;

        const scriptCellVars = scriptCell && scriptCellRow
            ? {
                ...contextVars,
                ...Object.fromEntries(
                    Object.entries(evalRow(scriptCellRow, preamble, contextVars))
                        .filter(([k]) => k !== scriptCell.col)
                        .map(([k, v]) => [k, v.value]),
                ),
            }
            : {};

        const scriptCellInitial =
            scriptCell && scriptCellRow
                ? scriptCellRow.cells[scriptCell.col]?.isScript
                    ? scriptCellRow.cells[scriptCell.col]!.raw
                    : ""
                : "";

        // For column formula: sample vars = contextVars + first row's plain values (other cols)
        const colFormulaVars = colFormula
            ? {
                ...contextVars,
                ...Object.fromEntries(
                    columns
                        .filter((c) => c !== colFormula)
                        .map((c) => [c, rows[0]?.cells[c]?.raw ?? ""]),
                ),
            }
            : {};

        // ---------------------------------------------------------------------------
        // Render
        // ---------------------------------------------------------------------------
        return (
            <div className="space-y-2">
                {/* Toolbar */}
                <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-1.5 flex-wrap">
                        <Button type="button" variant="outline" size="sm" onClick={addRow}>
                            <Plus className="h-3.5 w-3.5 mr-1" />
                            Add Row
                        </Button>
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => fileRef.current?.click()}
                        >
                            <Upload className="h-3.5 w-3.5 mr-1" />
                            Import CSV / Excel
                        </Button>
                        <input
                            ref={fileRef}
                            type="file"
                            accept=".csv,.xlsx,.xls"
                            className="hidden"
                            onChange={(e) => {
                                const f = e.target.files?.[0];
                                if (f) handleFile(f);
                                e.target.value = "";
                            }}
                        />
                    </div>
                    <span className="text-xs text-muted-foreground">
                        {rows.length} row{rows.length !== 1 ? "s" : ""}
                    </span>
                </div>

                {/* Table */}
                <div className="overflow-auto rounded-md border bg-background">
                    <table className="w-full text-sm border-collapse">
                        <thead>
                            <tr className="border-b bg-muted/50">
                                <th className="w-8 px-2 text-center text-xs text-muted-foreground font-normal">#</th>
                                {columns.map((col) => (
                                    <th
                                        key={col}
                                        className="px-2 py-1.5 text-left text-xs font-medium text-muted-foreground whitespace-nowrap"
                                        style={{ minWidth: "150px" }}
                                    >
                                        <div className="flex items-center gap-1">
                                            <span className="font-mono">{col}</span>
                                            {col !== "email" && (
                                                <button
                                                    type="button"
                                                    title={`Apply a formula to all rows in "${col}"`}
                                                    onClick={() => setColFormula(col)}
                                                    className="ml-0.5 p-0.5 rounded text-muted-foreground hover:text-violet-600 hover:bg-violet-50 transition-colors"
                                                >
                                                    <Code className="h-3 w-3" />
                                                </button>
                                            )}
                                        </div>
                                    </th>
                                ))}
                                <th className="w-8" />
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((row, rowIdx) => {
                                const evalled =
                                    evalledRows.find((e) => e.id === row.id)?.evalled ?? {};
                                return (
                                    <tr
                                        key={row.id}
                                        className={cn(
                                            "border-b last:border-0 hover:bg-muted/20 group",
                                            rowIdx % 2 !== 0 ? "bg-muted/5" : "",
                                        )}
                                    >
                                        <td className="px-2 text-center text-xs text-muted-foreground select-none">
                                            {rowIdx + 1}
                                        </td>

                                        {columns.map((col) => {
                                            const cell = row.cells[col] ?? { raw: "", isScript: false };
                                            const ev = evalled[col] ?? { value: "" };

                                            return (
                                                <td key={col} className="px-1.5 py-1 align-middle">
                                                    {cell.isScript ? (
                                                        // --- Script cell ---
                                                        <div className="flex items-center gap-1">
                                                            <button
                                                                type="button"
                                                                onClick={() =>
                                                                    setScriptCell({ rowId: row.id, col })
                                                                }
                                                                title={
                                                                    ev.error
                                                                        ? `Script error: ${ev.error}`
                                                                        : `Script: ${cell.raw}`
                                                                }
                                                                className={cn(
                                                                    "flex-1 text-left px-2 py-0.5 rounded font-mono text-xs h-7 border transition-colors truncate",
                                                                    ev.error
                                                                        ? "bg-red-50 border-red-200 text-red-600"
                                                                        : "bg-violet-50 border-violet-200 text-violet-900 hover:bg-violet-100",
                                                                )}
                                                            >
                                                                {ev.error ? (
                                                                    <span title={ev.error}>⚠ error</span>
                                                                ) : ev.value ? (
                                                                    ev.value
                                                                ) : (
                                                                    <span className="text-muted-foreground italic">
                                                                        empty
                                                                    </span>
                                                                )}
                                                            </button>
                                                            <Button
                                                                type="button"

                                                                variant="ghost"
                                                                size="icon-sm"
                                                                title="Remove script, revert to plain value"
                                                                onClick={() => setCell(row.id, col, "", false)}
                                                                className="hover:bg-g-red-pastel text-g-red hover:text-g-red h-7"
                                                            >
                                                                ×
                                                            </Button>
                                                        </div>
                                                    ) : (
                                                        // --- Plain value cell ---
                                                        <div className="flex items-center gap-1">
                                                            <Input
                                                                className="h-7 text-xs flex-1 font-mono min-w-[100px]"
                                                                value={cell.raw}
                                                                placeholder={
                                                                    col === "email" ? "name@example.com" : ""
                                                                }
                                                                onChange={(e) =>
                                                                    setCell(row.id, col, e.target.value, false)
                                                                }
                                                            />
                                                            {col !== "email" && (
                                                                <Button
                                                                    type="button"
                                                                    variant="ghost"
                                                                    size="icon-sm"
                                                                    title="Write a formula for this cell"
                                                                    onClick={() =>
                                                                        setScriptCell({ rowId: row.id, col })
                                                                    }
                                                                    className={cell.isScript ? "text-violet-600 hover:text-violet-700" : "text-muted-foreground"}
                                                                >
                                                                    <Code className="h-3.5 w-3.5" />
                                                                </Button>
                                                            )}
                                                        </div>
                                                    )}
                                                </td>
                                            );
                                        })}

                                        <td className="px-1 py-1 text-right">
                                            <button
                                                type="button"
                                                onClick={() => removeRow(row.id)}
                                                disabled={rows.length === 1}
                                                title="Remove row"
                                                className="p-0.5 rounded text-muted-foreground hover:text-destructive hover:bg-muted transition-colors disabled:opacity-20"
                                            >
                                                <Trash2 className="h-3.5 w-3.5" />
                                            </button>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>

                {/* Per-cell script editor */}
                {scriptCell && (
                    <ScriptEditor
                        key={`${scriptCell.rowId}__${scriptCell.col}`}
                        open
                        title={scriptCell.col}
                        initialScript={scriptCellInitial}
                        rowVars={scriptCellVars}
                        preamble={preamble}
                        onSave={(script) => {
                            if (script.trim()) {
                                setCell(scriptCell.rowId, scriptCell.col, script, true);
                            } else {
                                setCell(scriptCell.rowId, scriptCell.col, "", false);
                            }
                        }}
                        onClose={() => setScriptCell(null)}
                    />
                )}

                {/* Column formula editor */}
                {colFormula && (
                    <ScriptEditor
                        key={`col__${colFormula}`}
                        open
                        title={`Apply to all rows: ${colFormula}`}
                        initialScript=""
                        rowVars={colFormulaVars}
                        preamble={preamble}
                        clearable={false}
                        onSave={(script) => {
                            applyColFormula(colFormula, script);
                        }}
                        onClose={() => setColFormula(null)}
                    />
                )}
            </div>
        );
    },
);
