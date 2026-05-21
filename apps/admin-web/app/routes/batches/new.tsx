import { useState, useEffect, useRef, useMemo } from "react";
import { useNavigate, useLoaderData, Link } from "react-router";
import { Plus, Trash2, Code } from "lucide-react";
import { listTemplates, getTemplate, getTemplateVersion } from "~/lib/api/templates";
import { createBatch, listCertMetadata, createCertMetadata } from "~/lib/api/issuance";
import type { RecipientInput } from "~/lib/api/issuance";
import { getMe } from "~/lib/api/auth";
import { getChapter } from "~/lib/api/admin";
import { listMailTemplates } from "~/lib/api/mail";
import type { MailTemplate } from "~/lib/api/mail";
import { loadFunctions, buildPreamble, evalScript } from "~/lib/script-functions";
import { RecipientDataTable } from "~/components/RecipientDataTable";
import { ScriptEditor } from "~/components/ScriptEditor";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Card, CardContent } from "~/components/ui/card";
import { cn } from "~/lib/utils";
import type { Chapter, User, CertMetadata } from "~/lib/types";

export function meta() {
  return [{ title: "New Batch | GDGoC Admin" }];
}

export async function clientLoader() {
  const [templates, me, mailTemplates] = await Promise.all([listTemplates(), getMe(), listMailTemplates().catch(() => [] as MailTemplate[])]);
  let chapter: Chapter | null = null;
  if (me.chapter_id) {
    chapter = await getChapter(me.chapter_id).catch(() => null);
  }
  return { templates, me, chapter, mailTemplates };
}

interface ClassifiedVars {
  csvKeys: string[];
  chapterKeys: string[];
  globalKeys: string[];
  scriptKeys: string[];
}

const VAR_PATTERN = /\{\{\s*([a-zA-Z0-9_.\\-]+)\s*\}\}/g;

function extractInlineKeys(content: string): string[] {
  const keys: string[] = [];
  for (const m of content.matchAll(VAR_PATTERN)) {
    const key = m[1].trim();
    if (key && !keys.includes(key)) keys.push(key);
  }
  return keys;
}

async function fetchTemplateVariables(templateId: string): Promise<ClassifiedVars> {
  const tmpl = await getTemplate(templateId);
  if (!tmpl.current_version_id)
    return { csvKeys: [], chapterKeys: [], globalKeys: [], scriptKeys: [] };
  const version = await getTemplateVersion(templateId, tmpl.current_version_id);
  const csvKeys: string[] = [];
  const chapterKeys: string[] = [];
  const globalKeys: string[] = [];
  const scriptKeys: string[] = [];

  function classifyKey(key: string) {
    if (key.startsWith("chapter.") || key.startsWith("cert.")) {
      if (!chapterKeys.includes(key)) chapterKeys.push(key);
    } else if (key.startsWith("global.")) {
      if (!globalKeys.includes(key)) globalKeys.push(key);
    } else {
      if (!csvKeys.includes(key)) csvKeys.push(key);
    }
  }

  for (const layer of version.scene.layers) {
    if (layer.type !== "text") continue;
    const tp = layer.text_props;
    if (!tp) continue;
    if ((tp as { script_source?: string }).script_source) {
      if (tp.variable_key && !scriptKeys.includes(tp.variable_key))
        scriptKeys.push(tp.variable_key);
      continue;
    }
    if (tp.is_dynamic && tp.variable_key) {
      classifyKey(tp.variable_key);
    } else if (tp.content) {
      for (const key of extractInlineKeys(tp.content)) {
        classifyKey(key);
      }
    }
  }
  return { csvKeys, chapterKeys, globalKeys, scriptKeys };
}

// System variable keys auto-provided by the issuance worker
const SYSTEM_VAR_KEYS = [
  "cert.id", "cert.pdf_url", "cert.verify_url",
  "batch.name", "batch.cert_name", "batch.cert_description",
  "chapter.name", "chapter.leader", "chapter.id", "chapter.email", "chapter.code",
];

export default function NewBatchPage() {
  const { templates, me, chapter, mailTemplates } = useLoaderData<typeof clientLoader>();
  const navigate = useNavigate();

  const [templateId, setTemplateId] = useState("");
  const [batchName, setBatchName] = useState("");
  const [certId, setCertId] = useState("");
  const [certMetadataList, setCertMetadataList] = useState<CertMetadata[]>([]);
  // New cert modal state
  const [showNewCertModal, setShowNewCertModal] = useState(false);
  const [newCertName, setNewCertName] = useState("");
  const [newCertDescription, setNewCertDescription] = useState("");
  const [creatingCert, setCreatingCert] = useState(false);
  const [certModalError, setCertModalError] = useState("");
  const [sendMail, setSendMail] = useState(false);
  const [isPrintable, setIsPrintable] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [vars, setVars] = useState<ClassifiedVars | null>(null);
  const [loadingVars, setLoadingVars] = useState(false);
  const [globalFields, setGlobalFields] = useState<Array<{ key: string; value: string; script?: string }>>([]); 

  // Script editor for a global field
  const [globalScriptIdx, setGlobalScriptIdx] = useState<number | null>(null);

  // Table output
  const [tableRecipients, setTableRecipients] = useState<RecipientInput[]>([]);
  const [tableHasErrors, setTableHasErrors] = useState(false);

  // Mail template selection state
  const [mailTemplateId, setMailTemplateId] = useState("");
  const [mailVarOverrides, setMailVarOverrides] = useState<Record<string, string>>({}); // variable -> static value or {{batchKey}}

  const selectedMailTemplate = useMemo(
    () => mailTemplates.find((t) => t.id === mailTemplateId) ?? null,
    [mailTemplates, mailTemplateId]
  );

  // Reset mail template when sendMail is unchecked
  useEffect(() => {
    if (!sendMail) {
      setMailTemplateId("");
      setMailVarOverrides({});
    }
  }, [sendMail]);

  // Functions library preamble (read from localStorage on mount)
  const [preamble, setPreamble] = useState("");
  useEffect(() => { setPreamble(buildPreamble(loadFunctions())); }, []);

  // Load cert metadata list
  useEffect(() => {
    listCertMetadata().then(setCertMetadataList).catch(() => setCertMetadataList([]));
  }, []);

  const selectedCert = certMetadataList.find((c) => c.id === certId) ?? null;

  const handleTemplateChange = async (id: string) => {
    setTemplateId(id);
    setVars(null);
    setGlobalFields([]);
    if (!id) return;
    setLoadingVars(true);
    try {
      const classified = await fetchTemplateVariables(id);
      setVars(classified);
      setGlobalFields(classified.globalKeys.map((k) => ({ key: k.slice("global.".length), value: "", script: undefined })));
    } catch {
      setVars({ csvKeys: [], chapterKeys: [], globalKeys: [], scriptKeys: [] });
    } finally {
      setLoadingVars(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    const validRecipients = tableRecipients.filter((r) => r.email.trim());
    if (validRecipients.length === 0) {
      setError("Add at least one recipient with a valid email address.");
      return;
    }
    if (tableHasErrors) {
      setError("Some script cells have errors. Fix them before creating the batch.");
      return;
    }

    const chapterVars: Record<string, string> = {};
    if (chapter) {
      chapterVars["chapter.name"] = chapter.name ?? "";
      chapterVars["chapter.leader"] = chapter.leader_name ?? (me.id === chapter.leader_id ? me.name : "");
    }

    const globalVars: Record<string, string> = {};
    const globalScriptErrors: string[] = [];
    for (const { key, value, script } of globalFields) {
      if (!key) continue;
      if (script?.trim()) {
        const result = evalScript(script, contextVars, preamble);
        if (result.error) {
          globalScriptErrors.push(`global.${key}: ${result.error}`);
        } else {
          globalVars[`global.${key}`] = result.value;
        }
      } else {
        globalVars[`global.${key}`] = value;
      }
    }
    if (globalScriptErrors.length > 0) {
      setError(`Global field script errors:\n${globalScriptErrors.join("\n")}`);
      return;
    }

    const recipients: RecipientInput[] = validRecipients.map((r) => ({
      email: r.email,
      variables: { ...r.variables, ...chapterVars, ...globalVars },
    }));

    // Collect mail variables: resolved {{batchKey}} refs become the key itself (worker resolves at send time)
    const mailVariables: Record<string, string> = {};
    for (const [k, v] of Object.entries(mailVarOverrides)) {
      if (v.trim()) mailVariables[k] = v.trim();
    }

    setCreating(true);
    try {
      const batch = await createBatch({
        template_id: templateId,
        name: batchName,
        cert_id: certId || undefined,
        recipients,
        send_mail: sendMail,
        is_printable: isPrintable,
        ...(sendMail && mailTemplateId ? { mail_template_id: mailTemplateId, mail_variables: mailVariables } : {}),
      });
      navigate(`/batches/${batch.id}`);
    } catch {
      setError("Failed to create batch. Please check your inputs and try again.");
    } finally {
      setCreating(false);
    }
  };

  const tableColumns = ["email", ...(vars?.csvKeys ?? [])];
  const validCount = tableRecipients.filter((r) => r.email.trim()).length;

  // Context vars visible to all scripts (chapter, template, batch metadata)
  const selectedTemplate = templates.find((t) => t.id === templateId);
  const contextVars = useMemo(() => {
    const ctx: Record<string, string> = {};
    // chapter.*
    if (chapter) {
      ctx["chapter.id"]             = chapter.id;
      ctx["chapter.name"]           = chapter.name ?? "";
      ctx["chapter.code"]           = (chapter as { code?: string }).code ?? "";
      ctx["chapter.email"]          = chapter.email ?? "";
      ctx["chapter.leader"]         = chapter.leader_name ?? (me.id === chapter.leader_id ? me.name : "");
      ctx["chapter.leader_codename"] = (chapter as { leader_codename?: string }).leader_codename ?? "";
    }
    // template.*
    if (selectedTemplate) {
      ctx["template.id"]     = selectedTemplate.id;
      ctx["template.name"]   = selectedTemplate.name;
      ctx["template.status"] = selectedTemplate.status;
    }
    // batch.*
    ctx["batch.name"] = batchName;
    ctx["batch.cert_name"] = selectedCert?.name ?? "";
    ctx["batch.cert_description"] = selectedCert?.description ?? "";
    return ctx;
  }, [chapter, me, selectedTemplate, batchName, selectedCert]);

  // All variable keys available to reference in mail template variable mapping
  const availableBatchKeys = useMemo(() => {
    const keys = new Set<string>(SYSTEM_VAR_KEYS);
    // Per-recipient vars from template
    for (const k of vars?.csvKeys ?? []) keys.add(k);
    // Global fields
    for (const f of globalFields) { if (f.key) keys.add(`global.${f.key}`); }
    // Chapter keys
    for (const k of vars?.chapterKeys ?? []) keys.add(k);
    return Array.from(keys);
  }, [vars, globalFields]);

  return (
    <div className="p-4 sm:p-8 max-w-5xl mx-auto">
      <div className="mb-6">
        <Link to="/batches" className="text-xs text-muted-foreground hover:text-foreground">← Back to Batches</Link>
        <h1 className="text-xl font-semibold mt-1 text-foreground">New Issuance Batch</h1>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Batch details */}
        <Card>
          <CardContent className="p-5 space-y-4">
            <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Batch Details</h2>
            <div className="space-y-1.5">
              <Label>Certificate</Label>
              <p className="text-xs text-muted-foreground">
                The programme or event this batch belongs to. Groups batches on the Certifications page.
              </p>
              <div className="flex gap-2">
                <select
                  className="flex h-9 flex-1 rounded-md border border-input bg-background px-3 py-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  value={certId}
                  onChange={(e) => setCertId(e.target.value)}
                >
                  <option value="">— None —</option>
                  {certMetadataList.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="shrink-0"
                  onClick={() => { setShowNewCertModal(true); setCertModalError(""); setNewCertName(""); setNewCertDescription(""); }}
                >
                  <Plus className="w-3.5 h-3.5 mr-1" />
                  New
                </Button>
              </div>
              {selectedCert?.description && (
                <p className="text-xs text-muted-foreground italic">{selectedCert.description}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="batch-name">Batch Name <span className="text-destructive">*</span></Label>
              <Input
                id="batch-name"
                required
                placeholder="e.g. Google I/O 2026 – Workshop Certificates"
                value={batchName}
                onChange={(e) => setBatchName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="batch-tmpl">Template <span className="text-destructive">*</span></Label>
              <select
                id="batch-tmpl"
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                required
                value={templateId}
                onChange={(e) => handleTemplateChange(e.target.value)}
              >
                <option value="">Select a template…</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>{t.name} ({t.status})</option>
                ))}
              </select>
            </div>
          </CardContent>
        </Card>

        {/* Variable info */}
        {templateId && vars && !loadingVars && (
          <div className="bg-accent border border-primary/20 rounded-lg p-4 text-sm space-y-2">
            <h2 className="font-semibold text-primary text-sm">Template variables</h2>
            {vars.chapterKeys.length > 0 && (
              <div className="flex flex-wrap gap-1.5 items-center">
                <span className="text-xs text-muted-foreground">Auto-filled:</span>
                {vars.chapterKeys.map((k) => (
                  <code key={k} className="px-2 py-0.5 rounded text-xs font-mono bg-green-100 text-green-800 border border-green-200">{k}</code>
                ))}
              </div>
            )}
            {vars.scriptKeys.length > 0 && (
              <div className="flex flex-wrap gap-1.5 items-center">
                <span className="text-xs text-muted-foreground">Server-scripted:</span>
                {vars.scriptKeys.map((k) => (
                  <code key={k} className="px-2 py-0.5 rounded text-xs font-mono bg-violet-100 text-violet-800 border border-violet-200">{k}</code>
                ))}
              </div>
            )}
            {vars.csvKeys.length > 0 && (
              <div className="flex flex-wrap gap-1.5 items-center">
                <span className="text-xs text-muted-foreground">Per-recipient:</span>
                {vars.csvKeys.map((k) => (
                  <code key={k} className="px-2 py-0.5 rounded text-xs font-mono bg-background border">{k}</code>
                ))}
              </div>
            )}
            {vars.csvKeys.length === 0 && vars.chapterKeys.length === 0 && (
              <p className="text-xs text-muted-foreground">This template has no dynamic variables.</p>
            )}
          </div>
        )}
        {loadingVars && (
          <p className="text-xs text-muted-foreground px-1">Loading template variables…</p>
        )}

        {/* Global fields */}
        {vars && (vars.globalKeys.length > 0 || globalFields.length > 0) && (
          <Card>
            <CardContent className="p-5 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Global Fields</h2>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Shared values applied to every recipient. Reference them as{" "}
                    <code className="font-mono">{"{{global.field_name}}"}</code>.
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setGlobalFields((prev) => [...prev, { key: "", value: "" }])}
                >
                  <Plus className="h-3.5 w-3.5 mr-1" /> Add field
                </Button>
              </div>
              {globalFields.length === 0 ? (
                <p className="text-xs text-muted-foreground italic">No global fields defined.</p>
              ) : (
                <div className="space-y-2">
                  {globalFields.map((field, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <div className="flex items-center gap-1 flex-1 min-w-0">
                        <span className="text-xs text-muted-foreground font-mono shrink-0">global.</span>
                        <Input
                          className="h-7 text-xs font-mono flex-1 min-w-0"
                          placeholder="field_name"
                          value={field.key}
                          onChange={(e) =>
                            setGlobalFields((prev) =>
                              prev.map((f, idx) => (idx === i ? { ...f, key: e.target.value.replace(/\s+/g, "_") } : f))
                            )
                          }
                        />
                      </div>
                      <span className="text-xs text-muted-foreground shrink-0">=</span>
                      {field.script ? (
                        <button
                          type="button"
                          onClick={() => setGlobalScriptIdx(i)}
                          className="flex-[2] min-w-0 h-7 px-2 rounded-md border border-violet-300 bg-violet-50 text-violet-800 text-xs font-mono text-left truncate hover:bg-violet-100 transition-colors"
                          title="Click to edit script"
                        >
                          <span className="opacity-60 mr-1">ƒx</span>
                          {field.script.split("\n")[0]}
                        </button>
                      ) : (
                        <Input
                          className="h-7 text-xs flex-[2] min-w-0"
                          placeholder="value"
                          value={field.value}
                          onChange={(e) =>
                            setGlobalFields((prev) =>
                              prev.map((f, idx) => (idx === i ? { ...f, value: e.target.value } : f))
                            )
                          }
                        />
                      )}
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        title={field.script ? "Script active — click to edit" : "Add JS formula"}
                        onClick={() => setGlobalScriptIdx(i)}
                        className={field.script ? "text-violet-600 hover:text-violet-700" : "text-muted-foreground"}
                      >
                        <Code className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => setGlobalFields((prev) => prev.filter((_, idx) => idx !== i))}
                      >
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Global field script editor */}
        {globalScriptIdx !== null && (
          <ScriptEditor
            open
            title={`global.${globalFields[globalScriptIdx]?.key || "field"}`}
            initialScript={globalFields[globalScriptIdx]?.script ?? ""}
            rowVars={contextVars}
            preamble={preamble}
            onSave={(script) =>
              setGlobalFields((prev) =>
                prev.map((f, idx) =>
                  idx === globalScriptIdx
                    ? { ...f, script: script || undefined }
                    : f
                )
              )
            }
            onClose={() => setGlobalScriptIdx(null)}
          />
        )}

        {/* Recipients data table */}
        {templateId && (
          <Card>
            <CardContent className="p-5 space-y-3">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Recipients</h2>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Fill rows manually or import a CSV / Excel file. Click the{" "}
                    <Code className="h-3 w-3 inline-block align-middle" /> icon on any cell or column header to write a JS formula.{" "}
                    <Link to="/functions" className="text-primary hover:underline font-medium">
                      Manage functions library →
                    </Link>
                  </p>
                </div>
                {validCount > 0 && (
                  <span className={cn(
                    "text-xs font-medium px-2 py-0.5 rounded-full",
                    tableHasErrors ? "bg-red-100 text-red-700" : "bg-green-100 text-green-700"
                  )}>
                    {tableHasErrors ? "⚠ script errors" : `${validCount} recipient${validCount !== 1 ? "s" : ""}`}
                  </span>
                )}
              </div>

              {loadingVars ? (
                <p className="text-xs text-muted-foreground py-4 text-center">Loading template variables…</p>
              ) : (
                <RecipientDataTable
                  key={templateId}
                  columns={tableColumns}
                  preamble={preamble}
                  contextVars={contextVars}
                  onChange={(recs, hasErrors) => {
                    setTableRecipients(recs);
                    setTableHasErrors(hasErrors);
                  }}
                />
              )}
            </CardContent>
          </Card>
        )}

        {/* Send mail */}
        <div className="rounded-lg border bg-card overflow-hidden">
          <div className="flex items-start gap-3 p-4">
            <input
              id="send-mail"
              type="checkbox"
              className="mt-0.5 h-4 w-4 rounded border-input accent-primary"
              checked={sendMail}
              onChange={(e) => setSendMail(e.target.checked)}
            />
            <div>
              <label htmlFor="send-mail" className="text-sm font-medium cursor-pointer">
                Send certificates by email
              </label>
              <p className="text-xs text-muted-foreground mt-0.5">
                Each recipient will receive their certificate PDF at the address in the table.
                Requires the chapter&apos;s Gmail / App Password to be configured.
                Leave unchecked to generate certificates for manual download only.
              </p>
            </div>
          </div>

          {/* Mail template selection */}
          {sendMail && (
            <div className="border-t px-4 pb-4 pt-3 space-y-4 bg-muted/30">
              <div className="space-y-1.5">
                <Label htmlFor="mail-tmpl">Email Template <span className="text-muted-foreground font-normal">(optional)</span></Label>
                <select
                  id="mail-tmpl"
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  value={mailTemplateId}
                  onChange={(e) => { setMailTemplateId(e.target.value); setMailVarOverrides({}); }}
                >
                  <option value="">Default email (certificate download link)</option>
                  {mailTemplates.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
                <p className="text-xs text-muted-foreground">
                  Pick a custom email template, or leave blank to use the default message.
                </p>
              </div>

              {/* Variable mapping for selected mail template */}
              {selectedMailTemplate && selectedMailTemplate.variables.length > 0 && (
                <div className="space-y-2">
                  <div>
                    <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Template Variable Mapping</h3>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Map each template variable to a batch variable or type a static value.
                      System variables (<code className="font-mono">cert.*</code>, <code className="font-mono">batch.*</code>, <code className="font-mono">chapter.*</code>) and per-recipient variables are auto-filled.
                    </p>
                  </div>
                  <div className="space-y-2">
                    {selectedMailTemplate.variables.map((varKey) => {
                      const isAuto = availableBatchKeys.includes(varKey);
                      const override = mailVarOverrides[varKey] ?? "";
                      return (
                        <div key={varKey} className="flex items-center gap-2">
                          <code className="text-xs font-mono bg-background border rounded px-2 py-1 min-w-[140px] shrink-0">{`{{${varKey}}}`}</code>
                          {isAuto ? (
                            <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 border border-green-200 font-medium shrink-0">
                              auto-filled
                            </span>
                          ) : (
                            <div className="flex gap-1 flex-1 min-w-0">
                              <select
                                className="flex h-7 flex-1 min-w-0 rounded-md border border-input bg-background px-2 py-0 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                value={override.startsWith("{{") ? override : ""}
                                onChange={(e) =>
                                  setMailVarOverrides((prev) => ({ ...prev, [varKey]: e.target.value }))
                                }
                              >
                                <option value="">— pick a batch variable —</option>
                                {availableBatchKeys.map((k) => (
                                  <option key={k} value={`{{${k}}}`}>{k}</option>
                                ))}
                              </select>
                              <span className="text-xs text-muted-foreground self-center shrink-0">or</span>
                              <Input
                                className="h-7 text-xs flex-1 min-w-0"
                                placeholder="static value"
                                value={override.startsWith("{{") ? "" : override}
                                onChange={(e) =>
                                  setMailVarOverrides((prev) => ({ ...prev, [varKey]: e.target.value }))
                                }
                              />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Printable */}
        <div className="flex items-start gap-3 rounded-lg border p-4 bg-card">
          <input
            id="is-printable"
            type="checkbox"
            className="mt-0.5 h-4 w-4 rounded border-input accent-primary"
            checked={isPrintable}
            onChange={(e) => setIsPrintable(e.target.checked)}
          />
          <div>
            <label htmlFor="is-printable" className="text-sm font-medium cursor-pointer">
              Print-ready output
            </label>
            <p className="text-xs text-muted-foreground mt-0.5">
              All colors will be converted to CMYK-correct equivalents before rendering.
              Enable this when certificates will be professionally printed.
            </p>
          </div>
        </div>

        {error && <p className="text-sm text-destructive bg-red-50 border border-red-200 rounded px-3 py-2">{error}</p>}

        <Button
          type="submit"
          disabled={creating || !templateId || validCount === 0}
          className="w-full"
        >
          {creating ? "Creating…" : sendMail ? "Create Batch & Send Emails" : "Create Batch & Generate Certificates"}
        </Button>
      </form>

      {/* New Certificate Modal */}
      {showNewCertModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-background rounded-lg shadow-xl w-full max-w-md mx-4 p-6 space-y-4">
            <h2 className="text-base font-semibold text-foreground">New Certificate</h2>
            <p className="text-xs text-muted-foreground">
              Create a new certificate programme that groups related batches together.
            </p>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="modal-cert-name">Name <span className="text-destructive">*</span></Label>
                <Input
                  id="modal-cert-name"
                  placeholder="e.g. Google Cloud Study Jam 2026"
                  value={newCertName}
                  onChange={(e) => setNewCertName(e.target.value)}
                  autoFocus
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="modal-cert-desc">Description</Label>
                <textarea
                  id="modal-cert-desc"
                  rows={3}
                  className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  placeholder="Briefly describe this certification programme…"
                  value={newCertDescription}
                  onChange={(e) => setNewCertDescription(e.target.value)}
                />
              </div>
              {certModalError && (
                <p className="text-xs text-destructive">{certModalError}</p>
              )}
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setShowNewCertModal(false)}
                disabled={creatingCert}
              >
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={creatingCert || !newCertName.trim()}
                onClick={async () => {
                  setCertModalError("");
                  setCreatingCert(true);
                  try {
                    const created = await createCertMetadata({ name: newCertName.trim(), description: newCertDescription.trim() });
                    setCertMetadataList((prev) => [...prev, created]);
                    setCertId(created.id);
                    setShowNewCertModal(false);
                  } catch {
                    setCertModalError("Failed to create certificate. Please try again.");
                  } finally {
                    setCreatingCert(false);
                  }
                }}
              >
                {creatingCert ? "Creating…" : "Create Certificate"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
