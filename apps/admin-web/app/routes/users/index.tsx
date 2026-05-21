import { useLoaderData, useOutletContext } from "react-router";
import { useState, useMemo } from "react";
import { listUsers, listChapters, updateUser, deleteUser } from "~/lib/api/admin";
import { ConfirmModal } from "~/components/ConfirmModal";
import { ROLES, ROLE_LABELS, isSuperAdminRole, isEditorRole } from "~/lib/roles";
import { formatDate } from "~/lib/utils";
import type { User, Chapter } from "~/lib/types";
import { Button } from "~/components/ui/button";
import { Badge } from "~/components/ui/badge";
import { Card } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "~/components/ui/table";

export function meta() {
  return [{ title: "Users | GDGoC Admin" }];
}

export async function clientLoader() {
  const [users, chapters] = await Promise.all([listUsers(), listChapters()]);
  return { users, chapters };
}

// ---------- Inline edit row ----------
function UserRow({
  user,
  chapters,
  canEdit,
  onSaved,
  onDeleted,
}: {
  user: User;
  chapters: Chapter[];
  canEdit: boolean;
  onSaved: (updated: User) => void;
  onDeleted: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [role, setRole] = useState<User["role"]>(user.role);
  const [chapterId, setChapterId] = useState<string>(user.chapter_id ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty = role !== user.role || chapterId !== (user.chapter_id ?? "");

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const updated = await updateUser(user.id, {
        role,
        chapter_id: chapterId || null,
      });
      onSaved(updated);
      setEditing(false);
    } catch {
      setError("Save failed.");
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setRole(user.role);
    setChapterId(user.chapter_id ?? "");
    setError(null);
    setEditing(false);
  };

  if (!editing) {
    return (
      <>
        <tr className="border-t hover:bg-canvas group">
          <td className="px-4 py-2.5 font-medium">{user.name}</td>
          <td className="px-4 py-2.5 text-text-2">{user.email}</td>
          <td className="px-4 py-2.5">
            <RoleBadge role={user.role} />
          </td>
          <td className="px-4 py-2.5 text-text-3 text-xs">
            {chapters.find((c) => c.id === user.chapter_id)?.name ?? (
              <span className="italic text-text-3">none</span>
            )}
          </td>
          <td className="px-4 py-2.5 text-text-3 text-xs">{formatDate(user.created_at)}</td>
          <td className="px-4 py-2.5 text-right space-x-3">
            {canEdit && (
              <>
                <button
                  onClick={() => setEditing(true)}
                  className="text-xs text-g-blue hover:underline opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  Edit
                </button>
                <button
                  onClick={() => setConfirmDelete(true)}
                  className="text-xs text-destructive hover:underline opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  Delete
                </button>
              </>
            )}
          </td>
        </tr>
        {confirmDelete && (
          <ConfirmModal
            title={`Delete ${user.name}?`}
            message="This will permanently remove the user. They will need to be re-whitelisted to log in again."
            destructive
            confirmLabel="Delete"
            onConfirm={async () => { await deleteUser(user.id); setConfirmDelete(false); onDeleted(user.id); }}
            onCancel={() => setConfirmDelete(false)}
          />
        )}
      </>
    );
  }

  return (
    <tr className="border-t bg-blue-soft">
      <td className="px-4 py-2.5 font-medium">{user.name}</td>
      <td className="px-4 py-2.5 text-text-2">{user.email}</td>
      <td className="px-4 py-2.5">
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as User["role"])}
          className="border rounded px-2 py-1 text-sm"
        >
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r]}
            </option>
          ))}
        </select>
      </td>
      <td className="px-4 py-2.5">
        <select
          value={chapterId}
          onChange={(e) => setChapterId(e.target.value)}
          className="border rounded px-2 py-1 text-sm"
        >
          <option value="">— none —</option>
          {chapters.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </td>
      <td className="px-4 py-2.5 text-text-3 text-xs">{formatDate(user.created_at)}</td>
      <td className="px-4 py-2.5 text-right space-x-2">
        {error && <span className="text-red-500 text-xs mr-2">{error}</span>}
        <button
          onClick={handleSave}
          disabled={saving || !dirty}
          className="text-xs bg-g-blue text-white px-3 py-1 rounded disabled:opacity-50 hover:bg-g-blue-hover"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        <button
          onClick={handleCancel}
          className="text-xs text-text-2 hover:text-text-1"
        >
          Cancel
        </button>
      </td>
    </tr>
  );
}

// ---------- Page ----------
export default function UsersPage() {
  const { users: initial, chapters } = useLoaderData<typeof clientLoader>();
  const { user } = useOutletContext<{ user: User }>();
  const canEdit = isSuperAdminRole(user.role);

  const [users, setUsers] = useState<User[]>(initial ?? []);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<"all" | User["role"]>("all");
  const [sortField, setSortField] = useState<"name" | "email" | "role" | "created_at">("created_at");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const handleSaved = (updated: User) =>
    setUsers((prev) => prev.map((u) => (u.id === updated.id ? updated : u)));

  const handleDeleted = (id: string) =>
    setUsers((prev) => prev.filter((u) => u.id !== id));

  const toggleSort = (field: typeof sortField) => {
    if (sortField === field) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortField(field); setSortDir("asc"); }
  };

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return users
      .filter((u) => {
        const matchesSearch =
          !q || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q);
        const matchesRole = roleFilter === "all" || u.role === roleFilter;
        return matchesSearch && matchesRole;
      })
      .sort((a, b) => {
        const va = a[sortField] ?? "";
        const vb = b[sortField] ?? "";
        const cmp = va < vb ? -1 : va > vb ? 1 : 0;
        return sortDir === "asc" ? cmp : -cmp;
      });
  }, [users, search, roleFilter, sortField, sortDir]);

  const SortIcon = ({ field }: { field: typeof sortField }) =>
    sortField !== field ? (
      <span className="ml-1 text-text-3">↕</span>
    ) : sortDir === "asc" ? (
      <span className="ml-1">↑</span>
    ) : (
      <span className="ml-1">↓</span>
    );

  return (
    <div className="p-4 sm:p-8 max-w-6xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <h1 className="text-xl font-semibold text-foreground">Users</h1>
        <span className="text-sm text-muted-foreground">{filtered.length} of {users.length}</span>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap gap-3 mb-4">
        <Input
          type="search"
          placeholder="Search name or email…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full sm:w-64"
        />
        <select
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value as typeof roleFilter)}
          className="border border-input rounded-md px-3 py-1.5 text-sm bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="all">All roles</option>
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r]}
            </option>
          ))}
        </select>
      </div>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="cursor-pointer hover:text-foreground" onClick={() => toggleSort("name")}>
                Name <SortIcon field="name" />
              </TableHead>
              <TableHead className="cursor-pointer hover:text-foreground" onClick={() => toggleSort("email")}>
                Email <SortIcon field="email" />
              </TableHead>
              <TableHead className="cursor-pointer hover:text-foreground" onClick={() => toggleSort("role")}>
                Role <SortIcon field="role" />
              </TableHead>
              <TableHead>Chapter</TableHead>
              <TableHead className="cursor-pointer hover:text-foreground" onClick={() => toggleSort("created_at")}>
                Joined <SortIcon field="created_at" />
              </TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                  No users match your filters.
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((u) => (
                <UserRow key={u.id} user={u} chapters={chapters ?? []} canEdit={canEdit} onSaved={handleSaved} onDeleted={handleDeleted} />
              ))
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

function RoleBadge({ role }: { role: User["role"] }) {
  const v = isSuperAdminRole(role) ? "info" : isEditorRole(role) ? "warning" : "success" as const;
  return <Badge variant={v}>{ROLE_LABELS[role]}</Badge>;
}
