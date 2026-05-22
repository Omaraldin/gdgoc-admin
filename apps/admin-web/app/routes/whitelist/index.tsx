import { useState } from "react";
import { useLoaderData, useRevalidator, useOutletContext } from "react-router";
import { listWhitelist, addToWhitelist, removeFromWhitelist, listChapters } from "~/lib/api/admin";
import { formatDate } from "~/lib/utils";
import { ConfirmModal } from "~/components/ConfirmModal";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Card } from "~/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "~/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "~/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "~/components/ui/dialog";
import { isSuperAdminRole } from "~/lib/roles";
import type { User } from "~/lib/types";

const ROLE_LABELS: Record<string, string> = {
  chapter_leader: "Chapter Leader",
  super_admin: "Super Admin",
  editor: "Editor",
};

export function meta() {
  return [{ title: "Whitelist | GDGoC Admin" }];
}

export async function clientLoader() {
  const [entries, chapters] = await Promise.all([listWhitelist(), listChapters()]);
  return { entries, chapters };
}

export default function WhitelistPage() {
  const { entries, chapters } = useLoaderData<typeof clientLoader>();
  const { user } = useOutletContext<{ user: User }>();
  const isSuperAdmin = isSuperAdminRole(user.role);
  const revalidator = useRevalidator();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("chapter_leader");
  const [chapterId, setChapterId] = useState<string>("none");
  const [adding, setAdding] = useState(false);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setAdding(true);
    try {
      await addToWhitelist(email, role, chapterId === "none" ? undefined : chapterId);
      setEmail("");
      setRole("chapter_leader");
      setChapterId("none");
      revalidator.revalidate();
    } finally {
      setAdding(false);
    }
  };

  const [modal, setModal] = useState<{ id: string } | null>(null);
  const [editModal, setEditModal] = useState<{ id: string; email: string; role: string; chapter_id?: string } | null>(null);
  const [editSaving, setEditSaving] = useState(false);

  const handleRemove = (id: string) => {
    setModal({ id });
  };

  const handleEditSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editModal) return;
    setEditSaving(true);
    try {
      await addToWhitelist(editModal.email, editModal.role, editModal.chapter_id === "none" ? undefined : editModal.chapter_id);
      setEditModal(null);
      revalidator.revalidate();
    } finally {
      setEditSaving(false);
    }
  };

  return (
    <div className="p-4 sm:p-8 max-w-3xl mx-auto">
      <h1 className="text-xl font-semibold mb-6 text-foreground">Whitelist</h1>

      <form onSubmit={handleAdd} className="flex flex-wrap gap-3 mb-6">
        <Input
          type="email"
          required
          placeholder="user@example.com"
          className="flex-1 min-w-[200px]"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <Select value={role} onValueChange={setRole}>
          <SelectTrigger className="w-[160px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="chapter_leader">Chapter Leader</SelectItem>
            <SelectItem value="editor">Editor</SelectItem>
            {isSuperAdmin && <SelectItem value="super_admin">Super Admin</SelectItem>}
          </SelectContent>
        </Select>
        {isSuperAdmin && role !== "super_admin" && (
          <Select value={chapterId} onValueChange={setChapterId}>
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="Select Chapter" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">— No Chapter —</SelectItem>
              {chapters.map((ch) => (
                <SelectItem key={ch.id} value={ch.id}>
                  {ch.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Button type="submit" disabled={adding} size="sm">
          {adding ? "Adding…" : "Add Email"}
        </Button>
      </form>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Email</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Chapter</TableHead>
              <TableHead>Added</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.map((e) => (
              <TableRow key={e.id}>
                <TableCell>{e.email}</TableCell>
                <TableCell className="text-xs">{ROLE_LABELS[e.role] ?? e.role}</TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {e.chapter_id ? chapters.find((c) => c.id === e.chapter_id)?.name ?? "Unknown" : "—"}
                </TableCell>
                <TableCell className="text-muted-foreground text-xs">{formatDate(e.created_at)}</TableCell>
                <TableCell className="text-right space-x-3">
                  <button
                    onClick={() => setEditModal({ id: e.id, email: e.email, role: e.role, chapter_id: e.chapter_id ?? "none" })}
                    className="text-xs text-g-blue hover:underline"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => handleRemove(e.id)}
                    className="text-xs text-destructive hover:underline"
                  >
                    Remove
                  </button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      {modal && (
        <ConfirmModal
          title="Remove from whitelist?"
          destructive
          confirmLabel="Remove"
          onConfirm={async () => { await removeFromWhitelist(modal.id); setModal(null); revalidator.revalidate(); }}
          onCancel={() => setModal(null)}
        />
      )}

      {editModal && (
        <Dialog open onOpenChange={(open) => !open && setEditModal(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Edit Whitelist Entry</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleEditSave} className="space-y-4 py-2">
              <div className="space-y-1.5">
                <p className="text-sm font-medium text-muted-foreground">{editModal.email}</p>
              </div>
              <div className="space-y-1.5">
                <Select value={editModal.role} onValueChange={(val) => setEditModal({ ...editModal, role: val })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="chapter_leader">Chapter Leader</SelectItem>
                    <SelectItem value="editor">Editor</SelectItem>
                    {isSuperAdmin && <SelectItem value="super_admin">Super Admin</SelectItem>}
                  </SelectContent>
                </Select>
              </div>
              {isSuperAdmin && editModal.role !== "super_admin" && (
                <div className="space-y-1.5">
                  <Select value={editModal.chapter_id ?? "none"} onValueChange={(val) => setEditModal({ ...editModal, chapter_id: val })}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select Chapter" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">— No Chapter —</SelectItem>
                      {chapters.map((ch) => (
                        <SelectItem key={ch.id} value={ch.id}>
                          {ch.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setEditModal(null)}>Cancel</Button>
                <Button type="submit" disabled={editSaving}>{editSaving ? "Saving…" : "Save"}</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
