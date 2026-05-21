import { useLoaderData, Link, useRevalidator, useSearchParams } from "react-router";
import { useState, useEffect } from "react";
import type { Route } from "./+types/detail";
import {
  getChapter,
  assignLeader,
  listUsers,
  getChapterSMTPStatus,
  updateManualSMTP,
  disconnectSMTP,
  getOAuthConnectURL,
  updateChapterLeaderProfile,
} from "~/lib/api/admin";
import { getMe } from "~/lib/api/auth";
import { ROLE_SUPER_ADMIN, ROLE_CHAPTER_LEADER, isSuperAdminRole, isChapterLeaderRole } from "~/lib/roles";
import { formatDate } from "~/lib/utils";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Badge } from "~/components/ui/badge";
import { Card, CardContent } from "~/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "~/components/ui/select";
import type { SMTPStatus } from "~/lib/types";

export function meta() {
  return [{ title: "Chapter | GDGoC Admin" }];
}

export async function clientLoader({ params }: Route.ClientLoaderArgs) {
  const me = await getMe();
  const isSuperAdmin = isSuperAdminRole(me.role);

  const [chapter, users] = await Promise.all([
    getChapter(params.id),
    isSuperAdmin ? listUsers() : Promise.resolve([]),
  ]);

  const canManageSMTP = isSuperAdmin || me.chapter_id === chapter.id;
  const smtpStatus: SMTPStatus | null = canManageSMTP
    ? await getChapterSMTPStatus(params.id).catch(() => null)
    : null;

  return { chapter, users, me, smtpStatus };
}

// ---------------------------------------------------------------------------
// SMTP section sub-component
// ---------------------------------------------------------------------------

type SMTPTab = "status" | "manual" | "gmail" | "outlook";

function SMTPSection({
  chapterId,
  status,
  onChanged,
}: {
  chapterId: string;
  status: SMTPStatus | null;
  onChanged: () => void;
}) {
  const [tab, setTab] = useState<SMTPTab>("status");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  // When status becomes connected (e.g. after OAuth redirect + revalidation),
  // snap back to the status view so the Disconnect button is visible.
  useEffect(() => {
    if (status?.connected) setTab("status");
  }, [status?.connected]);

  // Manual SMTP form state
  const [host, setHost] = useState("");
  const [port, setPort] = useState("587");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [fromEmail, setFromEmail] = useState("");
  const [showPw, setShowPw] = useState(false);

  const clearMessages = () => { setError(""); setSuccess(""); };

  const handleManualSave = async (e: React.FormEvent) => {
    e.preventDefault();
    clearMessages();
    setBusy(true);
    try {
      await updateManualSMTP(chapterId, {
        host: host.trim(),
        port: parseInt(port, 10),
        username: username.trim(),
        password: password.trim(),
        email: fromEmail.trim() || undefined,
      });
      setSuccess("Manual SMTP configured successfully.");
      onChanged();
      setTab("status");
    } catch {
      setError("Failed to save. Check the credentials and try again.");
    } finally {
      setBusy(false);
    }
  };

  const handleOAuthConnect = async (provider: "gmail" | "outlook") => {
    clearMessages();
    setBusy(true);
    try {
      const url = await getOAuthConnectURL(chapterId, provider);
      window.location.href = url;
    } catch {
      setError(`Failed to start ${provider === "gmail" ? "Gmail" : "Outlook"} OAuth. Is it configured on the server?`);
      setBusy(false);
    }
  };

  const handleDisconnect = async () => {
    clearMessages();
    setBusy(true);
    try {
      await disconnectSMTP(chapterId);
      setSuccess("SMTP disconnected.");
      onChanged();
      setTab("status");
    } catch {
      setError("Failed to disconnect.");
    } finally {
      setBusy(false);
    }
  };

  const providerLabel: Record<string, string> = {
    gmail: "Gmail",
    outlook: "Outlook",
    manual: "Manual SMTP",
  };

  return (
    <Card>
      <CardContent className="p-5 space-y-4">
        <h2 className="font-semibold text-foreground">Email (SMTP)</h2>

        {/* Current status */}
        {status?.connected ? (
          <div className="flex items-center justify-between rounded-md border border-border bg-muted/40 px-4 py-3">
            <div>
              <p className="text-sm font-medium text-foreground">
                {providerLabel[status.provider] ?? status.provider}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">{status.from_email}</p>
            </div>
            <Badge variant="success">Connected</Badge>
          </div>
        ) : (
          <div className="rounded-md border border-border bg-muted/40 px-4 py-3">
            <p className="text-sm text-muted-foreground">No email provider configured.</p>
          </div>
        )}

        {/* Tab bar */}
        <div className="flex gap-1 border-b border-border">
          {(["manual", "gmail", "outlook"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => { setTab(t); clearMessages(); }}
              className={`px-3 py-1.5 text-sm font-medium rounded-t-md transition-colors ${
                tab === t
                  ? "border-b-2 border-primary text-primary"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {t === "manual" ? "Manual" : t === "gmail" ? "Gmail" : "Outlook"}
            </button>
          ))}
        </div>

        {/* Manual SMTP form */}
        {tab === "manual" && (
          <form onSubmit={handleManualSave} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="smtp-host">Host</Label>
                <Input
                  id="smtp-host"
                  placeholder="smtp.example.com"
                  value={host}
                  onChange={(e) => setHost(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="smtp-port">Port</Label>
                <Input
                  id="smtp-port"
                  type="number"
                  placeholder="587"
                  value={port}
                  onChange={(e) => setPort(e.target.value)}
                  required
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="smtp-user">Username</Label>
              <Input
                id="smtp-user"
                placeholder="user@example.com"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="smtp-pw">Password</Label>
              <div className="relative">
                <Input
                  id="smtp-pw"
                  type={showPw ? "text" : "password"}
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pr-16 font-mono"
                  autoComplete="new-password"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPw((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground hover:text-foreground"
                  tabIndex={-1}
                >
                  {showPw ? "Hide" : "Show"}
                </button>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="smtp-from">From address <span className="text-muted-foreground">(optional)</span></Label>
              <Input
                id="smtp-from"
                type="email"
                placeholder="noreply@example.com"
                value={fromEmail}
                onChange={(e) => setFromEmail(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">Defaults to Username when left blank.</p>
            </div>
            <Button type="submit" disabled={busy}>
              {busy ? "Saving…" : "Save Manual SMTP"}
            </Button>
          </form>
        )}

        {/* Gmail OAuth */}
        {tab === "gmail" && (
          <div className="space-y-3">
            {status?.connected && status.provider === "gmail" ? (
              <p className="text-sm text-status-green font-medium">✓ Gmail connected as {status.from_email}. Use Disconnect below to remove it.</p>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">
                  Connect a Google account to send emails via Gmail using OAuth2. No App Password needed.
                </p>
                <Button
                  onClick={() => handleOAuthConnect("gmail")}
                  disabled={busy}
                  className="flex items-center gap-2"
                >
                  <svg viewBox="0 0 24 24" className="w-4 h-4" fill="currentColor">
                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                  </svg>
                  {busy ? "Redirecting…" : "Connect with Google"}
                </Button>
              </>
            )}
          </div>
        )}

        {/* Outlook OAuth */}
        {tab === "outlook" && (
          <div className="space-y-3">
            {status?.connected && status.provider === "outlook" ? (
              <p className="text-sm text-status-green font-medium">✓ Outlook connected as {status.from_email}. Use Disconnect below to remove it.</p>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">
                  Connect a Microsoft account to send emails via Outlook / Office 365 using OAuth2.
                </p>
                <Button
                  onClick={() => handleOAuthConnect("outlook")}
                  disabled={busy}
                  className="flex items-center gap-2"
                >
                  <svg viewBox="0 0 24 24" className="w-4 h-4" fill="currentColor">
                    <path d="M21.886 10.976A2 2 0 0 0 20 10h-1V7a1 1 0 0 0-1-1H7.414L5.707 4.293A1 1 0 0 0 5 4H3a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h16a1 1 0 0 0 .97-.757l2-8a2 2 0 0 0-.084-1.267z" fill="#0078D4"/>
                  </svg>
                  {busy ? "Redirecting…" : "Connect with Microsoft"}
                </Button>
              </>
            )}
          </div>
        )}

        {/* Feedback */}
        {error && <p className="text-sm text-destructive">{error}</p>}
        {success && <p className="text-sm text-status-green">{success}</p>}

        {/* Disconnect */}
        {status?.connected && (
          <div className="pt-2 border-t border-border">
            <Button
              variant="outline"
              size="sm"
              onClick={handleDisconnect}
              disabled={busy}
              className="text-destructive hover:text-destructive"
            >
              Disconnect
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ChapterDetailPage() {
  const { chapter, users, me, smtpStatus } = useLoaderData<typeof clientLoader>();
  const revalidator = useRevalidator();
  const [searchParams, setSearchParams] = useSearchParams();
  const [leaderId, setLeaderId] = useState(chapter.leader_id ?? "");
  const [saving, setSaving] = useState(false);
  const [sinceYear, setSinceYear] = useState(chapter.since_year?.toString() ?? "");
  const [leaderCodename, setLeaderCodename] = useState(chapter.leader_codename ?? "");
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileMessage, setProfileMessage] = useState("");
  const [profileError, setProfileError] = useState("");

  // OAuth callback result banner
  const [oauthBanner, setOauthBanner] = useState<{ type: "success" | "error"; message: string } | null>(null);

  useEffect(() => {
    const connected = searchParams.get("smtp_connected");
    const smtpError = searchParams.get("smtp_error");
    const provider = searchParams.get("smtp_provider");
    const email = searchParams.get("smtp_email");
    if (connected) {
      const label = provider === "gmail" ? "Gmail" : provider === "outlook" ? "Outlook" : "SMTP";
      setOauthBanner({ type: "success", message: `${label} connected${email ? ` (${email})` : ""}.` });
      setSearchParams({}, { replace: true });
      revalidator.revalidate();
    } else if (smtpError) {
      setOauthBanner({ type: "error", message: `OAuth failed: ${smtpError}` });
      setSearchParams({}, { replace: true });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isSuperAdmin = isSuperAdminRole(me.role);
  const isChapterMember = me.chapter_id === chapter.id;
  const isChapterLeader = isChapterLeaderRole(me.role) && isChapterMember;
  const canManageSMTP = isSuperAdmin || isChapterMember;
  const canEditLeaderProfile = isSuperAdmin || isChapterLeader;

  const handleSaveLeaderProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setProfileBusy(true);
    setProfileMessage("");
    setProfileError("");
    try {
      const parsedSinceYear = sinceYear.trim() === "" ? undefined : Number.parseInt(sinceYear, 10);
      await updateChapterLeaderProfile(chapter.id, {
        since_year: Number.isFinite(parsedSinceYear) ? parsedSinceYear : undefined,
        leader_codename: leaderCodename.toUpperCase().trim(),
      });
      setProfileMessage("Chapter metadata updated.");
      revalidator.revalidate();
    } catch {
      setProfileError("Failed to update chapter metadata.");
    } finally {
      setProfileBusy(false);
    }
  };

  const handleAssignLeader = async () => {
    if (!leaderId) return;
    setSaving(true);
    try {
      await assignLeader(chapter.id, leaderId);
      revalidator.revalidate();
    } finally {
      setSaving(false);
    }
  };

  const eligibleUsers = users.filter((u) => u.role === ROLE_CHAPTER_LEADER || u.role === ROLE_SUPER_ADMIN);

  return (
    <div className="p-4 sm:p-8 max-w-2xl mx-auto space-y-6">
      {oauthBanner && (
        <div
          className={`rounded-md px-4 py-3 text-sm flex items-center justify-between ${
            oauthBanner.type === "success"
              ? "bg-status-green/10 text-status-green border border-status-green/30"
              : "bg-destructive/10 text-destructive border border-destructive/30"
          }`}
        >
          <span>{oauthBanner.type === "success" ? "✓ " : "✗ "}{oauthBanner.message}</span>
          <button type="button" onClick={() => setOauthBanner(null)} className="ml-4 text-xs opacity-70 hover:opacity-100">Dismiss</button>
        </div>
      )}

      <div className="flex items-start justify-between flex-wrap gap-3">
        <div className="flex items-center gap-4">
          <img
            src={chapter.profile_picture_url ?? "/avatar.png"}
            alt={chapter.name}
            className="w-14 h-14 rounded-full object-cover"
          />
          <h1 className="text-xl font-semibold text-foreground">{chapter.name}</h1>
        </div>
        <div className="flex gap-2 items-center">
          <Badge variant={chapter.status === "active" ? "success" : "neutral"}>{chapter.status}</Badge>
          {isSuperAdmin && (
            <Button asChild variant="outline" size="sm">
              <Link to={`/chapters/${chapter.id}/edit`}>Edit</Link>
            </Button>
          )}
        </div>
      </div>

      <Card>
        <CardContent className="p-5 space-y-4">
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Email</p>
            <p className="font-medium text-sm">{chapter.email}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Since Year</p>
            <p className="font-medium text-sm">{chapter.since_year ?? "-"}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Leader Codename</p>
            <p className="font-medium text-sm font-mono">{chapter.leader_codename || "-"}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Created</p>
            <p className="font-medium text-sm">{formatDate(chapter.created_at)}</p>
          </div>
        </CardContent>
      </Card>

      {canEditLeaderProfile && (
        <Card>
          <CardContent className="p-5 space-y-4">
            <h2 className="font-semibold text-foreground">Chapter Leader Metadata</h2>
            <form onSubmit={handleSaveLeaderProfile} className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="detail-since-year">Since Year</Label>
                <Input
                  id="detail-since-year"
                  type="number"
                  min={1900}
                  max={9999}
                  value={sinceYear}
                  onChange={(e) => setSinceYear(e.target.value)}
                  placeholder="e.g. 2020"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="detail-leader-codename">Leader Codename</Label>
                <Input
                  id="detail-leader-codename"
                  value={leaderCodename}
                  onChange={(e) => setLeaderCodename(e.target.value.toUpperCase())}
                  placeholder="e.g. NCTU-LDR"
                  className="font-mono uppercase"
                />
              </div>
              {profileError && <p className="text-sm text-destructive">{profileError}</p>}
              {profileMessage && <p className="text-sm text-status-green">{profileMessage}</p>}
              <Button type="submit" disabled={profileBusy}>
                {profileBusy ? "Saving…" : "Save Metadata"}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      {canManageSMTP && (
        <SMTPSection
          chapterId={chapter.id}
          status={smtpStatus}
          onChanged={() => revalidator.revalidate()}
        />
      )}

      {/* Assign leader — super admin only */}
      {isSuperAdmin && (
        <Card>
          <CardContent className="p-5">
            <h2 className="font-semibold mb-4 text-foreground">Assign Chapter Leader</h2>
            <div className="flex gap-3">
              <Select value={leaderId} onValueChange={setLeaderId}>
                <SelectTrigger className="flex-1">
                  <SelectValue placeholder="— Select a user —" />
                </SelectTrigger>
                <SelectContent>
                  {eligibleUsers.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.name} ({u.email})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button onClick={handleAssignLeader} disabled={saving || !leaderId}>
                {saving ? "Saving…" : "Assign"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}


