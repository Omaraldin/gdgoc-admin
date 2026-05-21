import { useState } from "react";
import { useLoaderData, useNavigate } from "react-router";
import type { Route } from "./+types/edit";
import { getChapter, uploadChapterProfilePicture, assignLeader, listUsers } from "~/lib/api/admin";
import { getMe } from "~/lib/api/auth";
import { apiClient } from "~/lib/api/client";
import { isSuperAdminRole } from "~/lib/roles";
import type { Chapter, User } from "~/lib/types";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Card, CardContent } from "~/components/ui/card";

export function meta() {
  return [{ title: "Edit Chapter | GDGoC Admin" }];
}

export async function clientLoader({ params }: Route.ClientLoaderArgs) {
  const me = await getMe();
  const canManageUsers = isSuperAdminRole(me.role);

  const [chapter, users] = await Promise.all([
    getChapter(params.id),
    canManageUsers ? listUsers() : Promise.resolve([]),
  ]);
  return { chapter, users, canManageUsers };
}

export default function ChapterEditPage() {
  const { chapter, users, canManageUsers } = useLoaderData<typeof clientLoader>() as {
    chapter: Chapter;
    users: User[];
    canManageUsers: boolean;
  };
  const navigate = useNavigate();
  const [name, setName] = useState(chapter.name);
  const [code, setCode] = useState(chapter.code ?? "");
  const [sinceYear, setSinceYear] = useState(chapter.since_year?.toString() ?? "");
  const [leaderCodename, setLeaderCodename] = useState(chapter.leader_codename ?? "");
  const [email, setEmail] = useState(chapter.email ?? "");
  const [status, setStatus] = useState(chapter.status);
  const [leaderId, setLeaderId] = useState(chapter.leader_id ?? "");
  const [saving, setSaving] = useState(false);
  const [picturePreview, setPicturePreview] = useState<string | null>(chapter.profile_picture_url ?? null);
  const [uploadingPic, setUploadingPic] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const parsedSinceYear = sinceYear.trim() === "" ? undefined : Number.parseInt(sinceYear, 10);
      await apiClient.patch(`/chapters/${chapter.id}`, {
        name,
        code: code.toUpperCase(),
        since_year: Number.isFinite(parsedSinceYear) ? parsedSinceYear : undefined,
        leader_codename: leaderCodename.toUpperCase().trim(),
        email: email.trim() || undefined,
        status,
      });
      if (canManageUsers && leaderId && leaderId !== (chapter.leader_id ?? "")) {
        await assignLeader(chapter.id, leaderId);
      }
      navigate(`/chapters/${chapter.id}`);
    } finally {
      setSaving(false);
    }
  };

  const handlePictureChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPicturePreview(URL.createObjectURL(file));
    setUploadingPic(true);
    try {
      await uploadChapterProfilePicture(chapter.id, file);
    } finally {
      setUploadingPic(false);
    }
  };

  return (
    <div className="p-4 sm:p-8 max-w-lg mx-auto">
      <h1 className="text-xl font-semibold mb-6 text-foreground">Edit Chapter</h1>

      {/* Profile Picture */}
      <div className="flex items-center gap-4 mb-6">
        <img src={picturePreview ?? "/avatar.png"} alt={name} className="w-16 h-16 rounded-full object-cover" />
        <label className="cursor-pointer text-sm text-primary hover:underline font-medium">
          {uploadingPic ? "Uploading…" : "Change Photo"}
          <input type="file" accept="image/*" className="hidden" onChange={handlePictureChange} disabled={uploadingPic} />
        </label>
      </div>

      <Card>
        <CardContent className="p-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="ch-name">Chapter Name *</Label>
              <Input
                id="ch-name"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ch-code">Chapter Code</Label>
              <Input
                id="ch-code"
                placeholder="e.g. NCTU"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                className="font-mono uppercase"
              />
              <p className="text-xs text-muted-foreground">Short abbreviation for the chapter (always uppercase).</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ch-since-year">Since Year</Label>
              <Input
                id="ch-since-year"
                type="number"
                min={1900}
                max={9999}
                placeholder="e.g. 2020"
                value={sinceYear}
                onChange={(e) => setSinceYear(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">Year of the chapter's first season.</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ch-leader-codename">Leader Codename</Label>
              <Input
                id="ch-leader-codename"
                placeholder="e.g. NCTU-LDR"
                value={leaderCodename}
                onChange={(e) => setLeaderCodename(e.target.value.toUpperCase())}
                className="font-mono uppercase"
              />
              <p className="text-xs text-muted-foreground">Codename used for certification ID generation.</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ch-email">Chapter Email</Label>
              <Input
                id="ch-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">Optional — connect Gmail or Outlook via SMTP settings to fill automatically.</p>
            </div>
            {canManageUsers && (
              <div className="space-y-1.5">
                <Label htmlFor="ch-leader">Chapter Leader</Label>
                <select
                  id="ch-leader"
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  value={leaderId}
                  onChange={(e) => setLeaderId(e.target.value)}
                >
                  <option value="">— No leader assigned —</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name} ({u.email})
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="ch-status">Status</Label>
              <select
                id="ch-status"
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                value={status}
                onChange={(e) => setStatus(e.target.value as Chapter["status"])}
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>
            <div className="flex gap-3 pt-2">
              <Button
                type="button"
                variant="outline"
                className="flex-1"
                onClick={() => navigate(`/chapters/${chapter.id}`)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={saving} className="flex-1">
                {saving ? "Saving…" : "Save Changes"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
