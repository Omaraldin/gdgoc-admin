import { useState, useRef } from "react";
import { useNavigate, Link } from "react-router";
import { RichEditor } from "~/components/RichEditor";
import type { MailTemplate } from "~/lib/api/mail";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Card, CardContent } from "~/components/ui/card";

// Variables automatically provided by the system when the template is sent
// as part of a certificate issuance batch.
const SYSTEM_VARS: { key: string; label: string }[] = [
  { key: "cert.id",          label: "Certificate ID / code" },
  { key: "cert.pdf_url",     label: "Certificate PDF download link" },
  { key: "cert.verify_url",  label: "Certificate verification link" },
  { key: "batch.name",             label: "Batch name" },
  { key: "batch.cert_name",        label: "Certificate programme name" },
  { key: "batch.cert_description", label: "Certificate programme description" },
  { key: "chapter.name",     label: "Chapter name" },
  { key: "chapter.leader",   label: "Chapter leader name" },
  { key: "chapter.leader_codename", label: "Chapter leader codename" },
  { key: "chapter.code",     label: "Chapter code" },
  { key: "chapter.since",    label: "Chapter since" },
];

interface MailTemplateFormProps {
  initial?: MailTemplate;
  onSave: (data: { name: string; subject: string; body: string; variables: string[] }) => Promise<void>;
  saving: boolean;
  error: string;
}

export function MailTemplateForm({ initial, onSave, saving, error }: MailTemplateFormProps) {
  const navigate = useNavigate();
  const [name, setName] = useState(initial?.name ?? "");
  const [subject, setSubject] = useState(initial?.subject ?? "");
  const [body, setBody] = useState(initial?.body ?? "");
  const [varInput, setVarInput] = useState("");
  const [variables, setVariables] = useState<string[]>(initial?.variables ?? []);
  const subjectRef = useRef<HTMLInputElement>(null);

  const addVariable = () => {
    const key = varInput.trim().replace(/\s+/g, "_").replace(/[^a-z0-9_]/gi, "");
    if (!key || variables.includes(key)) { setVarInput(""); return; }
    setVariables((prev) => [...prev, key]);
    setVarInput("");
  };

  const removeVariable = (key: string) => setVariables((prev) => prev.filter((v) => v !== key));

  // Insert {{key}} into the subject at the current cursor position.
  const insertIntoSubject = (key: string) => {
    const el = subjectRef.current;
    const token = `{{${key}}}`;
    if (!el) { setSubject((s) => s + token); return; }
    const start = el.selectionStart ?? subject.length;
    const end = el.selectionEnd ?? subject.length;
    const next = subject.slice(0, start) + token + subject.slice(end);
    setSubject(next);
    // Restore focus and move caret after the inserted token.
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + token.length, start + token.length);
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await onSave({ name, subject, body, variables });
  };

  // All variable keys exposed to the rich editor toolbar (system + custom).
  const allVarKeys = [...SYSTEM_VARS.map((v) => v.key), ...variables];

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* Basic info */}
      <Card>
        <CardContent className="p-5 space-y-4">
          <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Template Details</h2>
          <div className="space-y-1.5">
            <Label htmlFor="mtmpl-name">Template Name <span className="text-destructive">*</span></Label>
            <Input id="mtmpl-name" required placeholder="e.g. Event Certificate Email" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="mtmpl-subj">Email Subject <span className="text-destructive">*</span></Label>
            <p className="text-xs text-muted-foreground">
              You can use dynamic variables in the subject — click a variable below to insert it.
            </p>
            <Input ref={subjectRef} id="mtmpl-subj" required className="font-mono" placeholder="e.g. Your certificate for {{batch.name}}" value={subject} onChange={(e) => setSubject(e.target.value)} />
            {/* Variable insertion chips for the subject field */}
            <div className="flex flex-wrap gap-1.5 pt-1">
              {SYSTEM_VARS.map(({ key }) => (
                <button
                  key={key}
                  type="button"
                  title={`Insert {{${key}}} into subject`}
                  onClick={() => insertIntoSubject(key)}
                  className="text-[11px] font-mono px-1.5 py-0.5 rounded border border-green-200 bg-green-50 text-green-700 hover:bg-green-100 transition-colors"
                >
                  {`{{${key}}}`}
                </button>
              ))}
              {variables.map((v) => (
                <button
                  key={v}
                  type="button"
                  title={`Insert {{${v}}} into subject`}
                  onClick={() => insertIntoSubject(v)}
                  className="text-[11px] font-mono px-1.5 py-0.5 rounded border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors"
                >
                  {`{{${v}}}`}
                </button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Available variables reference */}
      <div className="bg-accent border border-primary/20 rounded-lg p-4 text-sm space-y-3">
        <h2 className="font-semibold text-primary text-sm">Available variables</h2>
        <div className="space-y-2">
          <div>
            <p className="text-xs text-muted-foreground mb-1.5">Auto-provided by the system when sent from a batch:</p>
            <div className="flex flex-wrap gap-1.5">
              {SYSTEM_VARS.map(({ key, label }) => (
                <span key={key} title={label} className="text-xs font-mono px-2 py-0.5 rounded border border-green-200 bg-green-50 text-green-800">
                  {`{{${key}}}`}
                </span>
              ))}
            </div>
          </div>
          {variables.length > 0 && (
            <div>
              <p className="text-xs text-muted-foreground mb-1.5">Your custom variables (filled at send time):</p>
              <div className="flex flex-wrap gap-1.5">
                {variables.map((v) => (
                  <span key={v} className="text-xs font-mono px-2 py-0.5 rounded border border-blue-200 bg-blue-50 text-blue-800">
                    {`{{${v}}}`}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Dynamic variables */}
      <Card>
        <CardContent className="p-5 space-y-3">
          <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Custom Variables</h2>
          <p className="text-sm text-muted-foreground">
            Define extra variable keys to be filled in at send time (e.g. a recipient&apos;s name or role).
            Use them as <code className="bg-[var(--canvas)] px-1 rounded">{"{{variable_key}}"}</code>.
          </p>
          <div className="flex gap-2">
            <Input
              type="text"
              placeholder="e.g. recipient_name"
              value={varInput}
              onChange={(e) => setVarInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addVariable(); } }}
              className="font-mono"
            />
            <Button type="button" variant="outline" onClick={addVariable}>+ Add</Button>
          </div>
          {variables.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {variables.map((v) => (
                <span key={v} className="flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-accent border border-primary/20 text-primary">
                  <code>{"{{"}{v}{"}}"}</code>
                  <button type="button" onClick={() => removeVariable(v)} className="text-muted-foreground hover:text-destructive leading-none">×</button>
                </span>
              ))}
            </div>
          )}
          {variables.length === 0 && (
            <p className="text-xs text-muted-foreground italic">No custom variables yet.</p>
          )}
        </CardContent>
      </Card>

      {/* Rich email body */}
      <Card>
        <CardContent className="p-5 space-y-3">
          <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Email Body</h2>
          <p className="text-xs text-muted-foreground">
            Use the toolbar to format text, change colors, add links, and insert dynamic variables.
            The email will be sent as HTML.
          </p>
          <RichEditor
            value={body}
            onChange={setBody}
            variables={allVarKeys}
            placeholder="Write your email body here…"
            minHeight={320}
          />
        </CardContent>
      </Card>

      {error && <p className="text-sm text-destructive bg-red-soft rounded px-3 py-2">{error}</p>}

      <div className="flex gap-3">
        <Button type="submit" disabled={saving || !body}>
          {saving ? "Saving…" : "Save Template"}
        </Button>
        <Button type="button" variant="outline" onClick={() => navigate(-1)}>Cancel</Button>
      </div>
    </form>
  );
}
