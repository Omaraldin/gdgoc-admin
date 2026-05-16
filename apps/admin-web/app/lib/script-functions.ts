/**
 * Reusable JS functions library — stored in localStorage per browser.
 * These functions are injected as a preamble whenever a script field is evaluated,
 * making them callable by name in any script cell or template script.
 */

export interface StoredFunction {
  id: string;
  name: string;
  description: string;
  /** Complete JS snippet — typically one or more function declarations. */
  code: string;
}

const STORAGE_KEY = "gdgoc_script_fns_v1";

export function loadFunctions(): StoredFunction[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as StoredFunction[]) : [];
  } catch {
    return [];
  }
}

export function saveFunctions(fns: StoredFunction[]): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(fns));
}

/** Concatenates all function code blocks into a single JS preamble string. */
export function buildPreamble(fns: StoredFunction[]): string {
  return fns.map((f) => f.code.trim()).join("\n\n");
}

/**
 * Evaluates a user-supplied JavaScript snippet in the browser.
 *
 * The script may:
 *  - Be a single expression: `vars.name.toUpperCase()`
 *  - Contain statements with a `return`: `var d = new Date(); return d.toLocaleDateString();`
 *  - Define inner functions and call them
 *
 * `vars` is a plain object whose keys are the other column values in the current row.
 * All functions from the library are available via their name.
 */
export function evalScript(
  script: string,
  vars: Record<string, string>,
  preamble = "",
): { value: string; error?: string } {
  try {
    // eslint-disable-next-line no-new-func
    const fn = new Function("vars", `${preamble}\nreturn (function(){\n${script}\n})()`);
    const result = fn({ ...vars });
    return { value: result == null ? "" : String(result) };
  } catch (e) {
    return { value: "", error: e instanceof Error ? e.message : String(e) };
  }
}
