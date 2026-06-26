import { useLoaderData, Link } from "react-router";
import { useState } from "react";
import type { Route } from "./+types/certificates";
import { listCertificates, type CertificateEntry } from "~/lib/api/issuance";
import { getBatch } from "~/lib/api/issuance";
import { Badge } from "~/components/ui/badge";

export function meta() {
  return [{ title: "Certificates | GDGoC Admin" }];
}

export async function clientLoader({ params }: Route.ClientLoaderArgs) {
  const [batch, certificates] = await Promise.all([
    getBatch(params.id),
    listCertificates(params.id),
  ]);
  return { batch, certificates };
}

const statusVariant: Record<string, "info" | "success" | "neutral" | "warning" | "error"> = {
  rendered:  "info",
  emailed:   "success",
  failed:    "error",
  revoked:   "neutral",
  rendering: "warning",
  queued:    "neutral",
};

export default function BatchCertificatesPage() {
  const { batch, certificates } = useLoaderData<typeof clientLoader>();

  const rendered = certificates.filter(
    (c) => c.status === "rendered" || c.status === "emailed"
  );

  return (
    <div className="p-4 sm:p-8 max-w-5xl mx-auto">
      <div className="flex items-center gap-3 mb-6 flex-wrap">
        <Link to={`/batches/${batch.id}`} className="text-muted-foreground hover:text-foreground text-sm">
          ← {batch.name}
        </Link>
        <span className="text-muted-foreground text-sm">/</span>
        <h1 className="text-xl font-semibold text-foreground">Certificates</h1>
        <span className="ml-auto text-sm text-muted-foreground">
          {rendered.length} / {certificates.length} rendered
        </span>
      </div>

      {certificates.length === 0 ? (
        <div className="text-muted-foreground text-sm py-12 text-center border rounded-lg bg-card">
          No recipients in this batch yet.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {certificates.map((cert) => (
            <CertificateCard key={cert.id} cert={cert} />
          ))}
        </div>
      )}
    </div>
  );
}

function CertificateCard({ cert }: { cert: CertificateEntry }) {
  const nameVar =
    cert.variables?.name ??
    cert.variables?.full_name ??
    cert.variables?.recipient_name ??
    null;
  const [previewLoaded, setPreviewLoaded] = useState(false);

  return (
    <div className="bg-card border rounded-lg overflow-hidden flex flex-col">
      {/* Preview image */}
      <div className="bg-[var(--canvas)] aspect-[16/10] flex items-center justify-center overflow-hidden">
        {cert.png_url ? (
          previewLoaded ? (
            <img src={cert.png_url} alt={cert.email} className="w-full h-full object-contain" />
          ) : (
            <button
              onClick={() => setPreviewLoaded(true)}
              className="text-xs text-primary hover:underline font-medium"
            >
              Load preview
            </button>
          )
        ) : (
          <span className="text-muted-foreground text-xs">No preview</span>
        )}
      </div>

      {/* Info */}
      <div className="p-3 flex flex-col gap-1 flex-1">
        <p className="font-medium text-sm truncate">{nameVar ?? cert.email}</p>
        {nameVar && <p className="text-xs text-muted-foreground truncate">{cert.email}</p>}
        <div className="mt-0.5">
          <Badge variant={statusVariant[cert.status] ?? "neutral"} className="text-xs">{cert.status}</Badge>
        </div>
        {cert.failure_reason && (
          <p className="text-xs text-destructive mt-1 truncate" title={cert.failure_reason}>{cert.failure_reason}</p>
        )}
        <Link
            to={`/verify/${cert.id}`}
            target="_blank"
            rel="noreferrer"
            className="text-xs font-mono text-primary hover:underline truncate"
          >
            {cert.id}
          </Link>
      </div>

      {/* Actions */}
      {(cert.pdf_url || cert.png_url) && (
        <div className="border-t px-3 py-2 flex gap-3 text-xs">
          {cert.pdf_url && (
            <a href={cert.pdf_url} target="_blank" rel="noreferrer" className="text-primary hover:underline font-medium">PDF ↓</a>
          )}
          {cert.png_url && (
            <a href={cert.png_url} target="_blank" rel="noreferrer" className="text-primary hover:underline font-medium">PNG ↓</a>
          )}
        </div>
      )}
    </div>
  );
}
