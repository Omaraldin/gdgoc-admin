import { useLoaderData, useRevalidator } from "react-router";
import { useState } from "react";
import type { Route } from "./+types/recipients";
import { listRecipients, revokeCertificate } from "~/lib/api/issuance";
import { ConfirmModal } from "~/components/ConfirmModal";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "~/components/ui/table";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8080/api/v1";

export function meta() {
  return [{ title: "Recipients | GDGoC Admin" }];
}

export async function clientLoader({ params }: Route.ClientLoaderArgs) {
  return listRecipients(params.id);
}

export default function BatchRecipientsPage() {
  const recipients = useLoaderData<typeof clientLoader>();
  const revalidator = useRevalidator();
  const [modal, setModal] = useState<{ id: string } | null>(null);

  const handleRevoke = (id: string) => {
    setModal({ id });
  };

  return (
    <div className="p-4 sm:p-8 max-w-5xl mx-auto">
      <h1 className="text-xl font-semibold mb-6 text-foreground">Recipients</h1>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Code</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {recipients.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>{r.email}</TableCell>
                  <TableCell><RecipientBadge status={r.status} /></TableCell>
                  <TableCell className="font-mono text-xs">
                    <a href={`${API_BASE_URL}/verify/${r.id}/share`} className="text-primary hover:underline" target="_blank" rel="noreferrer">{r.id}</a>
                  </TableCell>
                  <TableCell className="text-destructive text-xs">{r.failure_reason ?? ""}</TableCell>
                  <TableCell className="text-right">
                    {r.status !== "revoked" && (r.status === "rendered" || r.status === "emailed") && (
                      <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => handleRevoke(r.id)}>
                        Revoke
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {modal && (
        <ConfirmModal
          title="Revoke certificate?"
          message="This will mark the certificate as revoked and invalidate the verification link."
          destructive
          confirmLabel="Revoke"
          onConfirm={async () => { await revokeCertificate(modal.id); setModal(null); revalidator.revalidate(); }}
          onCancel={() => setModal(null)}
        />
      )}
    </div>
  );
}

function RecipientBadge({ status }: { status: string }) {
  const map: Record<string, "info" | "success" | "neutral" | "warning" | "error"> = {
    pending:  "warning",
    rendered: "info",
    emailed:  "success",
    failed:   "error",
    revoked:  "neutral",
  };
  return <Badge variant={map[status] ?? "neutral"}>{status}</Badge>;
}

