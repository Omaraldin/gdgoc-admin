import { useLoaderData, Link } from "react-router";
import { listCertifications } from "~/lib/api/issuance";
import { formatDate } from "~/lib/utils";
import { Badge } from "~/components/ui/badge";
import { Card, CardContent } from "~/components/ui/card";
import { Award } from "lucide-react";

export function meta() {
  return [{ title: "Certifications | GDGoC Admin" }];
}

export async function clientLoader() {
  return listCertifications();
}

export default function CertificationsPage() {
  const groups = useLoaderData<typeof clientLoader>();

  return (
    <div className="p-4 sm:p-8 max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-foreground flex items-center gap-2">
          <Award className="w-5 h-5 text-primary" />
          Certifications
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Issuance batches grouped by certification programme. Assign a <strong>Certificate Name</strong> when creating a batch to group it here.
        </p>
      </div>

      {groups.length === 0 ? (
        <p className="text-muted-foreground text-center py-20">No certifications yet.</p>
      ) : (
        <div className="space-y-8">
          {groups.map((group) => (
            <section key={group.cert_name}>
              <div className="flex items-center gap-2 mb-3">
                <div>
                  <h2 className="text-base font-semibold text-foreground">{group.cert_name}</h2>
                  {group.description && (
                    <p className="text-xs text-muted-foreground mt-0.5">{group.description}</p>
                  )}
                </div>
                <span className="text-xs text-muted-foreground ml-1">({group.batches.length} batch{group.batches.length !== 1 ? "es" : ""})</span>
              </div>
              <Card>
                <CardContent className="p-0">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Batch Name</th>
                        <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Status</th>
                        <th className="text-right px-4 py-2.5 text-xs font-medium text-muted-foreground">Total</th>
                        <th className="text-right px-4 py-2.5 text-xs font-medium text-muted-foreground">Done</th>
                        <th className="text-right px-4 py-2.5 text-xs font-medium text-muted-foreground">Failed</th>
                        <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Created</th>
                        <th className="px-4 py-2.5" />
                      </tr>
                    </thead>
                    <tbody>
                      {group.batches.map((b, i) => (
                        <tr key={b.id} className={i < group.batches.length - 1 ? "border-b" : ""}>
                          <td className="px-4 py-2.5 font-medium">{b.name}</td>
                          <td className="px-4 py-2.5"><StatusBadge status={b.status} /></td>
                          <td className="px-4 py-2.5 text-right">{b.total_count}</td>
                          <td className="px-4 py-2.5 text-right text-green-600 dark:text-green-400">{b.success_count}</td>
                          <td className="px-4 py-2.5 text-right text-red-600 dark:text-red-400">{b.failed_count}</td>
                          <td className="px-4 py-2.5 text-muted-foreground text-xs">{formatDate(b.created_at)}</td>
                          <td className="px-4 py-2.5 text-right">
                            <Link to={`/batches/${b.id}`} className="text-primary hover:underline text-xs font-medium">
                              View
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </CardContent>
              </Card>
            </section>
          ))}
        </div>
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
