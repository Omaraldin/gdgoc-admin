import { useLoaderData, Link, useRevalidator, useNavigate } from "react-router";
import { useEffect, useState } from "react";
import type { Route } from "./+types/detail";
import { getBatch, getBatchProgress, cancelBatch, downloadBatchArchive, deleteBatch } from "~/lib/api/issuance";
import { getTemplate } from "~/lib/api/templates";
import { formatDate } from "~/lib/utils";
import { ConfirmModal } from "~/components/ConfirmModal";
import { Button } from "~/components/ui/button";
import { Badge } from "~/components/ui/badge";
import { Card, CardContent } from "~/components/ui/card";

export function meta() {
  return [{ title: "Batch | GDGoC Admin" }];
}

export async function clientLoader({ params }: Route.ClientLoaderArgs) {
  const batch = await getBatch(params.id);
  const [progress, template] = await Promise.all([
    getBatchProgress(params.id),
    getTemplate(batch.template_id),
  ]);
  return { batch, progress, template };
}

export default function BatchDetailPage() {
  const { batch, progress, template } = useLoaderData<typeof clientLoader>();
  const revalidator = useRevalidator();
  const navigate = useNavigate();
  const [downloading, setDownloading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [modal, setModal] = useState<{ title: string; message?: string; destructive?: boolean; confirmLabel?: string; onConfirm: () => void } | null>(null);

  const handleDownload = async () => {
    setDownloading(true);
    try {
      await downloadBatchArchive(batch.id, batch.name);
    } finally {
      setDownloading(false);
    }
  };

  // Poll for progress while processing
  useEffect(() => {
    if (progress.status !== "pending" && progress.status !== "processing") return;
    const interval = setInterval(() => revalidator.revalidate(), 3000);
    return () => clearInterval(interval);
    // revalidator intentionally excluded — its reference changes every render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress.status]);

  const handleCancel = () => {
    setModal({
      title: "Cancel this batch?",
      confirmLabel: "Cancel Batch",
      onConfirm: async () => {
        await cancelBatch(batch.id);
        revalidator.revalidate();
      },
    });
  };

  const handleDelete = () => {
    setModal({
      title: "Delete batch?",
      message: `Delete batch "${batch.name}" and all its certificates? This cannot be undone.`,
      destructive: true,
      confirmLabel: "Delete",
      onConfirm: async () => {
        setDeleting(true);
        try {
          await deleteBatch(batch.id);
          navigate("/batches");
        } finally {
          setDeleting(false);
        }
      },
    });
  };

  const pct = progress.total_count > 0
    ? Math.round(((progress.success_count + progress.failed_count) / progress.total_count) * 100)
    : 0;

  return (
    <div className="p-4 sm:p-8 max-w-3xl mx-auto">
      <div className="flex items-start justify-between gap-4 mb-6 flex-wrap">
        <div>
          <Link to="/batches" className="text-xs text-muted-foreground hover:text-foreground">← Batches</Link>
          <h1 className="text-xl font-semibold mt-1 text-foreground">{batch.name}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Template: {template?.name ?? "Unknown"}</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {(batch.status === "pending" || batch.status === "processing") && (
            <Button variant="outline" size="sm" onClick={handleCancel} className="text-destructive border-destructive/30 hover:bg-red-soft">
              Cancel Batch
            </Button>
          )}
          {batch.status === "completed" && (
            <Button size="sm" onClick={handleDownload} disabled={downloading}>
              {downloading ? "Preparing…" : "Download All Certificates"}
            </Button>
          )}
          {(batch.status === "completed" || batch.status === "cancelled" || batch.status === "failed") && (
            <Button variant="outline" size="sm" onClick={handleDelete} disabled={deleting} className="text-destructive border-destructive/30 hover:bg-red-soft">
              {deleting ? "Deleting…" : "Delete Batch"}
            </Button>
          )}
        </div>
      </div>

      {/* Progress */}
      <Card className="mb-6">
        <CardContent className="p-5">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <StatusBadge status={progress.status} />
              {batch.is_printable && (
                <Badge variant="info" title="Colors were CMYK-mapped using Google Brand Guidelines">🖨 Print-ready</Badge>
              )}
            </div>
            <span className="text-sm text-muted-foreground">{pct}%</span>
          </div>
          <div className="w-full bg-[var(--canvas)] rounded-full h-1.5">
            <div className="bg-primary h-1.5 rounded-full transition-all" style={{ width: `${pct}%` }} />
          </div>
          <div className="flex gap-6 mt-4 text-sm">
            <div><span className="text-muted-foreground">Total: </span><strong>{progress.total_count}</strong></div>
            <div><span className="text-status-green">Success: </span><strong>{progress.success_count}</strong></div>
            <div><span className="text-status-red">Failed: </span><strong>{progress.failed_count}</strong></div>
          </div>
        </CardContent>
      </Card>

      <div className="flex gap-4 mt-2">
        <Link to={`/batches/${batch.id}/recipients`} className="text-primary hover:underline text-sm font-medium">
          View Recipients →
        </Link>
        {(batch.status === "completed" || batch.status === "failed") && (
          <Link to={`/batches/${batch.id}/certificates`} className="text-primary hover:underline text-sm font-medium">
            View Certificates →
          </Link>
        )}
      </div>

      {modal && (
        <ConfirmModal
          title={modal.title}
          message={modal.message}
          destructive={modal.destructive}
          confirmLabel={modal.confirmLabel}
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
