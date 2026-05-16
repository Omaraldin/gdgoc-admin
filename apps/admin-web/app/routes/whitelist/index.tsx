import { useState } from "react";
import { useLoaderData, useRevalidator } from "react-router";
import { listWhitelist, addToWhitelist, removeFromWhitelist } from "~/lib/api/admin";
import { formatDate } from "~/lib/utils";
import { ConfirmModal } from "~/components/ConfirmModal";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Card } from "~/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "~/components/ui/table";

export function meta() {
  return [{ title: "Whitelist | GDGoC Admin" }];
}

export async function clientLoader() {
  return listWhitelist();
}

export default function WhitelistPage() {
  const entries = useLoaderData<typeof clientLoader>();
  const revalidator = useRevalidator();
  const [email, setEmail] = useState("");
  const [adding, setAdding] = useState(false);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setAdding(true);
    try {
      await addToWhitelist(email);
      setEmail("");
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
        <Button type="submit" disabled={adding} size="sm">
          {adding ? "Adding…" : "Add Email"}
        </Button>
      </form>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Email</TableHead>
              <TableHead>Added</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.map((e) => (
              <TableRow key={e.id}>
                <TableCell>{e.email}</TableCell>
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
