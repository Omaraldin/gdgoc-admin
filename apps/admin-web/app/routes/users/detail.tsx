import { useLoaderData, useRevalidator } from "react-router";
import { useState } from "react";
import type { Route } from "./+types/detail";
import { listUsers, updateUser } from "~/lib/api/admin";
import { ROLES, ROLE_LABELS } from "~/lib/roles";
import { formatDate } from "~/lib/utils";
import type { User } from "~/lib/types";

export function meta() {
  return [{ title: "User | GDGoC Admin" }];
}

export async function clientLoader({ params }: Route.ClientLoaderArgs) {
  const users = await listUsers();
  const user = users.find((u) => u.id === params.id);
  if (!user) throw new Response("User not found", { status: 404 });
  return user;
}

export default function UserDetailPage() {
  const user = useLoaderData<typeof clientLoader>() as User;
  const revalidator = useRevalidator();
  const [role, setRole] = useState(user.role);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateUser(user.id, { role });
      revalidator.revalidate();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-4 sm:p-8">
      <h1 className="text-2xl font-bold mb-6">User Detail</h1>
      <div className="bg-surface border rounded-lg p-6 space-y-4">
        <div>
          <p className="text-xs text-text-2 uppercase tracking-wide">Name</p>
          <p className="font-medium">{user.name}</p>
        </div>
        <div>
          <p className="text-xs text-text-2 uppercase tracking-wide">Email</p>
          <p className="font-medium">{user.email}</p>
        </div>
        <div>
          <p className="text-xs text-text-2 uppercase tracking-wide">Joined</p>
          <p className="font-medium">{formatDate(user.created_at)}</p>
        </div>
        <div>
          <label className="block text-xs text-text-2 uppercase tracking-wide mb-1">Role</label>
          <select
            className="w-full border rounded px-3 py-2 text-sm"
            value={role}
            onChange={(e) => setRole(e.target.value as User["role"])}
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>{ROLE_LABELS[r]}</option>
            ))}
          </select>
        </div>
        <button
          onClick={handleSave}
          disabled={saving || role === user.role}
          className="w-full py-2 bg-g-blue text-white rounded text-sm disabled:opacity-50 hover:bg-g-blue-hover"
        >
          {saving ? "Saving…" : "Save Changes"}
        </button>
      </div>
    </div>
  );
}

