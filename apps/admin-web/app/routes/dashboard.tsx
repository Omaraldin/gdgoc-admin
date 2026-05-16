import { useLoaderData } from "react-router";
import { listBatches } from "~/lib/api/issuance";
import { listTemplates } from "~/lib/api/templates";
import { Card, CardContent } from "~/components/ui/card";
import { Badge } from "~/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "~/components/ui/table";

export function meta() {
  return [{ title: "Dashboard | GDGoC Admin" }];
}

export async function clientLoader() {
  const [batches, templates] = await Promise.all([listBatches(), listTemplates()]);
  return { batches, templates };
}

export default function DashboardPage() {
  const { batches, templates } = useLoaderData<typeof clientLoader>();

  const safeBatches = batches ?? [];
  const safeTemplates = templates ?? [];
  const recentBatches = safeBatches.slice(0, 5);

  return (
    <div className="p-4 sm:p-8 max-w-5xl mx-auto">
      <h1 className="text-xl font-semibold mb-6 text-foreground">Dashboard</h1>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        <StatCard label="Templates" value={safeTemplates.length} />
        <StatCard label="Issuance Batches" value={safeBatches.length} />
        <StatCard
          label="Certificates Issued"
          value={safeBatches.reduce((sum, b) => sum + b.success_count, 0)}
        />
      </div>

      <section>
        <h2 className="text-sm font-semibold mb-3 text-foreground">Recent Batches</h2>
        {recentBatches.length === 0 ? (
          <p className="text-muted-foreground text-sm">No batches yet.</p>
        ) : (
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Success</TableHead>
                  <TableHead className="text-right">Failed</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentBatches.map((b) => (
                  <TableRow key={b.id}>
                    <TableCell className="font-medium">{b.name}</TableCell>
                    <TableCell><StatusBadge status={b.status} /></TableCell>
                    <TableCell className="text-right">{b.total_count}</TableCell>
                    <TableCell className="text-right text-status-green">{b.success_count}</TableCell>
                    <TableCell className="text-right text-status-red">{b.failed_count}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        )}
      </section>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardContent className="p-5">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="text-3xl font-semibold mt-1 text-foreground">{value}</p>
      </CardContent>
    </Card>
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
  return (
    <Badge variant={variantMap[status] ?? "neutral"}>
      {status}
    </Badge>
  );
}
