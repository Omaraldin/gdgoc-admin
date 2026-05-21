import { useLoaderData, Link, useRevalidator } from "react-router";
import { useState } from "react";
import { listBatches, deleteBatch } from "~/lib/api/issuance";
import { formatDate } from "~/lib/utils";
import { ConfirmModal } from "~/components/ConfirmModal";
import { Button } from "~/components/ui/button";
import { Badge } from "~/components/ui/badge";
import { Card } from "~/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "~/components/ui/table";

export function meta() {
  return [{ title: "Batches | GDGoC Admin" }];
}

export async function clientLoader() {
  return listBatches();
}

export default function BatchesPage() {
  const batches = useLoaderData<typeof clientLoader>();
  const revalidator = useRevalidator();
  const [modal, setModal] = useState<{ title: string; message?: string; onConfirm: () => void } | null>(null);

  const handleDelete = (id: string, name: string) => {
    setModal({
      title: "Delete batch?",
      message: `Delete batch "${name}" and all its certificates? This cannot be undone.`,
      onConfirm: async () => {
        await deleteBatch(id);
        revalidator.revalidate();
      },
    });
  };

  return (
    <div className="p-4 sm:p-8 max-w-6xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <h1 className="text-xl font-semibold text-foreground">Issuance Batches</h1>
        <Button asChild size="sm">
          <Link to="/batches/new">+ New Batch</Link>
        </Button>
      </div>

      {batches.length === 0 ? (
        <p className="text-muted-foreground text-center py-20">No batches yet.</p>
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Batch Name</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">Done</TableHead>
                <TableHead className="text-right">Failed</TableHead>
                <TableHead>Created By</TableHead>
                <TableHead>Created</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {batches.map((b) => (
                <TableRow key={b.id}>
                  <TableCell className="font-medium">{b.name}</TableCell>
                  <TableCell><StatusBadge status={b.status} /></TableCell>
                  <TableCell className="text-right">{b.total_count}</TableCell>
                  <TableCell className="text-right text-status-green">{b.success_count}</TableCell>
                  <TableCell className="text-right text-status-red">{b.failed_count}</TableCell>
                  <TableCell className="text-muted-foreground text-xs">{b.created_by_name || "—"}</TableCell>
                  <TableCell className="text-muted-foreground text-xs">{formatDate(b.created_at)}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-3">
                      <Link to={`/batches/${b.id}`} className="text-primary hover:underline text-xs font-medium">
                        View
                      </Link>
                      {(b.status === "completed" || b.status === "cancelled" || b.status === "failed") && (
                        <button
                          onClick={() => handleDelete(b.id, b.name)}
                          className="text-destructive hover:underline text-xs"
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      {modal && (
        <ConfirmModal
          title={modal.title}
          message={modal.message}
          destructive
          confirmLabel="Delete"
          onConfirm={() => { modal.onConfirm(); setModal(null); }}
          onCancel={() => setModal(null)}
        />
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const variantMap: Record<string, "info" | "success" | "neutral" | "warning" | "error"> = {
    pending:    "warning",
    processing: "info",
    completed:  "success",
    cancelled:  "neutral",
    failed:     "error",
  };
  return <Badge variant={variantMap[status] ?? "neutral"}>{status}</Badge>;
}
