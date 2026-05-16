import { useState } from "react";
import { useNavigate, useOutletContext } from "react-router";
import axios from "axios";
import { apiClient } from "~/lib/api/client";
import { listMailTemplates, type MailTemplate } from "~/lib/api/mail";
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
import type { User } from "~/lib/types";

export function meta() {
  return [{ title: "Compose Email | GDGoC Admin" }];
}

function interpolate(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? `{{${key}}}`);
}

export default function ComposeMailPage() {
  const navigate = useNavigate();
  const { user } = useOutletContext<{ user: User }>();

  // template picker state
  const [templates, setTemplates] = useState<MailTemplate[] | null>(null);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<MailTemplate | null>(null);
  const [varValues, setVarValues] = useState<Record<string, string>>({});

  // form state
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [isHtml, setIsHtml] = useState(false);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  // SMTP error modal state
  const [smtpError, setSmtpError] = useState<string | null>(null);

  const loadTemplates = async () => {
    if (templates !== null) return;
    setLoadingTemplates(true);
    try {
      const all = await listMailTemplates();
      setTemplates(all.filter((t) => t.status === "published"));
    } finally {
      setLoadingTemplates(false);
    }
  };

  const applyTemplate = (tmpl: MailTemplate | null) => {
    setSelectedTemplate(tmpl);
    setVarValues({});
    if (tmpl) {
      setSubject(tmpl.subject);
      setBody(tmpl.body);
      setIsHtml(true);
    }
  };

  const resolvedSubject = selectedTemplate
    ? interpolate(selectedTemplate.subject, varValues)
    : subject;

  const resolvedBody = selectedTemplate
    ? interpolate(selectedTemplate.body, varValues)
    : body;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSending(true);
    try {
      await apiClient.post("/mail/send", {
        to: to.split(",").map((s) => s.trim()),
        subject: resolvedSubject,
        body: resolvedBody,
        is_html: isHtml,
      });
      setSent(true);
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.status === 422) {
        setSmtpError(
          err.response.data?.error ?? "No SMTP configured for your chapter."
        );
      } else {
        throw err;
      }
    } finally {
      setSending(false);
    }
  };

  if (sent) {
    return (
      <div className="p-4 sm:p-8 text-center">
        <p className="text-status-green font-semibold text-lg">✓ Email queued for delivery</p>
        <Button variant="link" onClick={() => { setSent(false); applyTemplate(null); setTo(""); setSubject(""); setBody(""); }} className="mt-4">Send another</Button>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-8 max-w-2xl mx-auto">
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
            {user.chapter_id && (
              <Button asChild variant="default">
                <a href={`/chapters/${user.chapter_id}`}>Go to Chapter Settings</a>
              </Button>
            )}
            <Button variant="outline" onClick={() => setSmtpError(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Card>
        <CardContent className="p-6">
          {/* Template picker */}
          <div className="mb-5 pb-5 border-b border-border space-y-1.5">
            <Label>Use a template (optional)</Label>
            <Select
              onOpenChange={(open) => { if (open) loadTemplates(); }}
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
                <SelectValue placeholder={loadingTemplates ? "Loading…" : "No template — write manually"} />
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

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="mail-to">To (comma-separated) *</Label>
              <Input id="mail-to" type="text" required value={to} onChange={(e) => setTo(e.target.value)} />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="mail-subject">Subject *</Label>
              <Input
                id="mail-subject"
                type="text"
                required
                value={selectedTemplate ? resolvedSubject : subject}
                readOnly={!!selectedTemplate}
                onChange={(e) => setSubject(e.target.value)}
                className={selectedTemplate ? "bg-muted cursor-not-allowed" : ""}
              />
            </div>

            {/* Variable fields when a template is selected */}
            {selectedTemplate && selectedTemplate.variables.length > 0 && (
              <div className="rounded-md border border-border bg-muted/40 p-4 space-y-3">
                <p className="text-sm font-medium text-foreground">Template variables</p>
                {selectedTemplate.variables.map((v) => (
                  <div key={v} className="space-y-1">
                    <Label htmlFor={`var-${v}`} className="text-xs">
                      <code className="text-primary">{`{{${v}}}`}</code>
                    </Label>
                    <Input
                      id={`var-${v}`}
                      value={varValues[v] ?? ""}
                      onChange={(e) => setVarValues((prev) => ({ ...prev, [v]: e.target.value }))}
                      placeholder={`Value for ${v}`}
                    />
                  </div>
                ))}
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="mail-body">Body *</Label>
              {selectedTemplate ? (
                <div
                  className="min-h-[200px] rounded-md border border-input bg-muted px-3 py-2 text-sm overflow-auto"
                  dangerouslySetInnerHTML={{ __html: resolvedBody }}
                />
              ) : (
                <Textarea id="mail-body" rows={8} required value={body} onChange={(e) => setBody(e.target.value)} />
              )}
            </div>

            {!selectedTemplate && (
              <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
                <input type="checkbox" checked={isHtml} onChange={(e) => setIsHtml(e.target.checked)} className="rounded" />
                Send as HTML
              </label>
            )}

            <Button type="submit" disabled={sending} className="w-full">
              {sending ? "Sending…" : "Send Email"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

