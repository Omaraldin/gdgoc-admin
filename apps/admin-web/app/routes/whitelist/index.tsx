import { useState } from "react";
import { useLoaderData, useRevalidator, useOutletContext } from "react-router";
import { listWhitelist, addToWhitelist, removeFromWhitelist } from "~/lib/api/admin";
import { formatDate } from "~/lib/utils";
import { ConfirmModal } from "~/components/ConfirmModal";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Card } from "~/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "~/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "~/components/ui/table";
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
  return listWhitelist();
}

export default function WhitelistPage() {
  const entries = useLoaderData<typeof clientLoader>();
  const { user } = useOutletContext<{ user: User }>();
  const isSuperAdmin = isSuperAdminRole(user.role);
  const revalidator = useRevalidator();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("chapter_leader");
  const [adding, setAdding] = useState(false);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setAdding(true);
    try {
      await addToWhitelist(email, role);
      setEmail("");
      setRole("chapter_leader");
      revalidator.revalidate();
    } finally {
      setAdding(false);
    }
  };

  const [modal, setModal] = useState<{ id: string } | null>(null);

  const handleRemove = (id: string) => {
    setModal({ id });
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
              <TableHead>Added</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.map((e) => (
              <TableRow key={e.id}>
                <TableCell>{e.email}</TableCell>
                <TableCell className="text-xs">{ROLE_LABELS[e.role] ?? e.role}</TableCell>
                <TableCell className="text-muted-foreground text-xs">{formatDate(e.created_at)}</TableCell>
                <TableCell className="text-right">
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
    </div>
  );
}
