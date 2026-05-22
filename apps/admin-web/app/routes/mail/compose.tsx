import { useState, useMemo, useEffect } from "react";
import { useNavigate, useLoaderData, Link } from "react-router";
import axios from "axios";
import { apiClient } from "~/lib/api/client";
import { listMailTemplates, type MailTemplate } from "~/lib/api/mail";
import { getChapter } from "~/lib/api/admin";
import { getMe } from "~/lib/api/auth";
import { interpolate } from "~/lib/interpolate";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Textarea } from "~/components/ui/textarea";
import { Card, CardContent } from "~/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "~/components/ui/dialog";
import { Code, Plus, Trash2 } from "lucide-react";
import { RecipientDataTable } from "~/components/RecipientDataTable";
import { ScriptEditor } from "~/components/ScriptEditor";
import { RichEditor } from "~/components/RichEditor";
import type { RecipientInput } from "~/lib/api/issuance";
import { loadFunctions, buildPreamble, evalScript } from "~/lib/script-functions";
import type { Chapter } from "~/lib/types";
import { cn } from "~/lib/utils";

export function meta() {
  return [{ title: "Compose Email | GDGoC Admin" }];
}

export async function clientLoader() {
  const [me, mailTemplates] = await Promise.all([
    getMe(),
    listMailTemplates().catch(() => [] as MailTemplate[])
  ]);
  let chapter: Chapter | null = null;
  if (me.chapter_id) {
    chapter = await getChapter(me.chapter_id).catch(() => null);
  }
  return { me, chapter, templates: mailTemplates.filter((t) => t.status === "published") };
}

export default function ComposeMailPage() {
  const { me, chapter, templates } = useLoaderData<typeof clientLoader>();
  const navigate = useNavigate();

  const [selectedTemplate, setSelectedTemplate] = useState<MailTemplate | null>(null);

  // form state
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [isHtml, setIsHtml] = useState(true);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  // SMTP error modal state
  const [smtpError, setSmtpError] = useState<string | null>(null);

  // table state
  const [tableRecipients, setTableRecipients] = useState<RecipientInput[]>([]);
  const [tableHasErrors, setTableHasErrors] = useState(false);

  // global fields
  const [globalFields, setGlobalFields] = useState<Array<{ key: string; value: string; script?: string }>>([]);
  const [globalScriptIdx, setGlobalScriptIdx] = useState<number | null>(null);

  // Functions library preamble
  const [preamble, setPreamble] = useState("");
  useEffect(() => { setPreamble(buildPreamble(loadFunctions())); }, []);

  const contextVars = useMemo(() => {
    const ctx: Record<string, string> = {};
    if (chapter) {
      ctx["chapter.id"]             = chapter.id;
      ctx["chapter.name"]           = chapter.name ?? "";
      ctx["chapter.code"]           = (chapter as { code?: string }).code ?? "";
      ctx["chapter.email"]          = chapter.email ?? "";
      ctx["chapter.leader"]         = chapter.leader_name ?? (me.id === chapter.leader_id ? me.name : "");
      ctx["chapter.leader_codename"] = (chapter as { leader_codename?: string }).leader_codename ?? "";
    }
    return ctx;
  }, [chapter, me]);

  const applyTemplate = (tmpl: MailTemplate | null) => {
    setSelectedTemplate(tmpl);
    if (tmpl) {
      setSubject(tmpl.subject);
      setBody(tmpl.body);
      setIsHtml(true);
    } else {
      setSubject("");
      setBody("");
      setIsHtml(true);
    }
  };

  const { parsedVars, autoFilledVars } = useMemo(() => {
    const content = selectedTemplate ? (selectedTemplate.subject + " " + selectedTemplate.body) : (subject + " " + body);
    const keys: string[] = [];
    const autoKeys: string[] = [];
    const VAR_PATTERN = /\{\{\s*([a-zA-Z0-9_.\\-]+)\s*\}\}/g;
    for (const m of content.matchAll(VAR_PATTERN)) {
      const key = m[1]?.trim();
      if (!key) continue;
      if (key.startsWith("cert.") || key.startsWith("batch.")) {
        continue;
      } else if (key.startsWith("chapter.")) {
        if (!autoKeys.includes(key)) autoKeys.push(key);
      } else {
        if (!keys.includes(key)) keys.push(key);
      }
    }
    return { parsedVars: keys, autoFilledVars: autoKeys };
  }, [selectedTemplate, subject, body]);

  const tableColumns = ["email", ...parsedVars];
  const validCount = tableRecipients.filter((r) => r.email.trim()).length;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    const validRecipients = tableRecipients.filter((r) => r.email.trim());
    if (validRecipients.length === 0) {
      setError("Add at least one recipient with a valid email address.");
      return;
    }
    if (tableHasErrors) {
      setError("Some script cells have errors. Fix them before sending.");
      return;
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

    setSending(true);
    let successCount = 0;
    try {
      const promises = validRecipients.map((rec) => {
        const mailSubj = selectedTemplate ? selectedTemplate.subject : subject;
        const mailBody = selectedTemplate ? selectedTemplate.body : body;
        
        const combinedVars = { ...rec.variables, ...contextVars, ...globalVars };

        const resolvedSubject = interpolate(mailSubj, combinedVars);
        const resolvedBody = interpolate(mailBody, combinedVars);

        return apiClient.post("/mail/send", {
          to: [rec.email],
          subject: resolvedSubject,
          body: resolvedBody,
          is_html: isHtml || !!selectedTemplate,
        }).then(() => { successCount++; });
      });

      await Promise.all(promises);
      setSent(true);
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.status === 422) {
        setSmtpError(
          err.response.data?.error ?? "No SMTP configured for your chapter."
        );
      } else {
        setError(`Failed to send some emails (Sent ${successCount}/${validRecipients.length}).`);
      }
    } finally {
      setSending(false);
    }
  };

  if (sent) {
    return (
      <div className="p-4 sm:p-8 text-center">
        <p className="text-status-green font-semibold text-lg">✓ Emails queued for delivery</p>
        <Button variant="link" onClick={() => { setSent(false); applyTemplate(null); setTableRecipients([]); }} className="mt-4">Send more</Button>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-8 max-w-5xl mx-auto">
      <h1 className="text-xl font-semibold mb-6 text-foreground">Compose Email</h1>

      {/* SMTP not-configured error modal */}
      <Dialog open={smtpError !== null} onOpenChange={(open) => { if (!open) setSmtpError(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>SMTP Not Configured</DialogTitle>
            <DialogDescription>{smtpError}</DialogDescription>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Your chapter needs to have a manual SMTP server configured before you can send emails.
          </p>
          <DialogFooter className="gap-2">
            {me.chapter_id && (
              <Button asChild variant="default">
                <a href={`/chapters/${me.chapter_id}`}>Go to Chapter Settings</a>
              </Button>
            )}
            <Button variant="outline" onClick={() => setSmtpError(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <form onSubmit={handleSubmit} className="space-y-6">
        <Card>
          <CardContent className="p-6">
            {/* Template picker */}
            <div className="mb-5 pb-5 border-b border-border space-y-1.5">
              <Label>Use a template (optional)</Label>
              <Select
                value={selectedTemplate?.id ?? "__none__"}
                onValueChange={(val) => {
                  if (val === "__none__") {
                    applyTemplate(null);
                  } else {
                    const tmpl = templates?.find((t) => t.id === val) ?? null;
                    applyTemplate(tmpl);
                  }
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="No template — write manually" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">No template — write manually</SelectItem>
                  {(templates ?? []).map((t) => (
                    <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                  ))}
                  {templates?.length === 0 && (
                    <div className="px-3 py-2 text-xs text-muted-foreground">No published templates</div>
                  )}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="mail-subject">Subject *</Label>
                <Input
                  id="mail-subject"
                  type="text"
                  required
                  value={selectedTemplate ? selectedTemplate.subject : subject}
                  readOnly={!!selectedTemplate}
                  onChange={(e) => setSubject(e.target.value)}
                  className={selectedTemplate ? "bg-muted cursor-not-allowed" : ""}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="mail-body">Body *</Label>
                {selectedTemplate ? (
                  <div 
                    className="min-h-[200px] rounded-md border border-input bg-canvas px-5 py-4 text-sm overflow-auto ProseMirror"
                    dangerouslySetInnerHTML={{ __html: selectedTemplate.body }}
                  />
                ) : (
                  <RichEditor
                    value={body}
                    onChange={setBody}
                    variables={Object.keys(contextVars)}
                  />
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Global Fields */}
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
        <Card>
          <CardContent className="p-5 space-y-3">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div>
                <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Recipients & Variables</h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Fill rows manually or import a CSV / Excel file. Click the{" "}
                  <Code className="h-3 w-3 inline-block align-middle" /> icon on any cell or column header to write a JS formula.{" "}
                  <Link to="/functions" className="text-primary hover:underline font-medium">
                    Manage functions library →
                  </Link>
                </p>
                {autoFilledVars.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5 items-center">
                    <span className="text-xs text-muted-foreground">Auto-filled:</span>
                    {autoFilledVars.map((k) => (
                      <code key={k} className="px-2 py-0.5 rounded text-xs font-mono bg-green-100 text-green-800 border border-green-200">{k}</code>
                    ))}
                  </div>
                )}
                {parsedVars.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5 items-center">
                    <span className="text-xs text-muted-foreground">Per-recipient variables:</span>
                    {parsedVars.map((k) => (
                      <code key={k} className="px-2 py-0.5 rounded text-xs font-mono bg-background border">{k}</code>
                    ))}
                  </div>
                )}
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

            <RecipientDataTable
              columns={tableColumns}
              preamble={preamble}
              contextVars={contextVars}
              onChange={(recs, hasErrors) => {
                setTableRecipients(recs);
                setTableHasErrors(hasErrors);
              }}
            />
          </CardContent>
        </Card>

        {error && <p className="text-sm text-destructive bg-red-50 border border-red-200 rounded px-3 py-2">{error}</p>}

        <Button type="submit" disabled={sending || validCount === 0} className="w-full">
          {sending ? "Sending…" : "Send Emails"}
        </Button>
      </form>
    </div>
  );
}
