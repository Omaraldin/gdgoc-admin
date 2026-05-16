import { useLoaderData } from "react-router";
import { verifyCertificate } from "~/lib/api/verification";
import type { VerificationResult } from "~/lib/types";
import type { Route } from "./+types/verify";
import { formatDate } from "~/lib/utils";
import { cn } from "~/lib/utils";

export function meta() {
  return [{ title: "Verify Certificate | GDGoC Admin" }];
}

export async function clientLoader({ params }: Route.ClientLoaderArgs): Promise<VerificationResult> {
  return verifyCertificate(params.code);
}

export default function VerifyPage() {
  const result = useLoaderData<typeof clientLoader>();

  return (
    <div className="min-h-screen bg-[var(--canvas)] flex items-center justify-center p-8">
      <div className="bg-card rounded-xl border p-8 max-w-md w-full text-center shadow-[0_1px_2px_rgba(60,64,67,.15),0_1px_3px_1px_rgba(60,64,67,.07)]">
        <div className={cn("text-5xl mb-4", result.valid ? "text-status-green" : "text-destructive")}>
          {result.valid ? "✓" : "✗"}
        </div>
        <h1 className="text-xl font-semibold mb-2 text-foreground">
          {result.valid ? "Certificate Valid" : "Certificate Invalid"}
        </h1>
        <p className="text-muted-foreground text-sm mb-6">Code: {result.code}</p>

        {result.valid && (
          <dl className="text-left space-y-3 border-t pt-4">
            {result.recipient_name && (
              <div>
                <dt className="text-xs text-muted-foreground">Recipient</dt>
                <dd className="font-medium text-sm">{result.recipient_name}</dd>
              </div>
            )}
            {result.template_name && (
              <div>
                <dt className="text-xs text-muted-foreground">Certificate</dt>
                <dd className="font-medium text-sm">{result.template_name}</dd>
              </div>
            )}
            {result.chapter_name && (
              <div>
                <dt className="text-xs text-muted-foreground">Issued by</dt>
                <dd className="font-medium text-sm">{result.chapter_name}</dd>
              </div>
            )}
            {result.issued_at && (
              <div>
                <dt className="text-xs text-muted-foreground">Issued</dt>
                <dd className="font-medium text-sm">{formatDate(result.issued_at)}</dd>
              </div>
            )}
          </dl>
        )}

        {!result.valid && (
          <p className="text-sm text-muted-foreground">
            {result.status === "revoked"
              ? "This certificate has been revoked."
              : "This certificate could not be verified. It may be invalid or expired."}
          </p>
        )}
      </div>
    </div>
  );
}

