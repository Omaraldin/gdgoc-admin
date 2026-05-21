import { useLoaderData } from "react-router";
import { useState } from "react";
import { CheckCircle2, XCircle } from "lucide-react";
import { verifyCertificate } from "~/lib/api/verification";
import type { VerificationResult } from "~/lib/types";
import type { Route } from "./+types/verify";
import { formatDate } from "~/lib/utils";
import { cn } from "~/lib/utils";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8080/api/v1";

// The OG share URL is on the API so LinkedIn's crawler gets real meta tags + a redirect.
// The verify page itself lives on the frontend — use window.location.href when available.
function getOgShareUrl(result?: VerificationResult): string | undefined {
  if (!result?.code) return undefined;
  return result.share_url ?? `${API_BASE_URL}/verify/${encodeURIComponent(result.code)}/share`;
}

function getFrontendVerifyUrl(): string {
  if (typeof window !== "undefined") return window.location.href;
  return "";
}

export function meta({ loaderData }: Route.MetaArgs): Route.MetaDescriptors {
  const result = loaderData as VerificationResult | undefined;
  const isValid = Boolean(result?.valid);
  const certName = result?.cert_name ?? result?.batch_name ?? result?.template_name ?? "a certificate";
  const title = isValid
    ? `${result?.recipient_name ?? "Recipient"} earned ${certName}`
    : "Verify Certificate | GDGoC Admin";
  const description = isValid
    ? `Verified certificate issued by ${result?.chapter_name ?? "GDGoC"}.`
    : "Verify whether a GDGoC certificate is valid.";
  const shareUrl = getOgShareUrl(result);
  const imageUrl = result?.preview_image_url;

  const tags: Route.MetaDescriptors = [
    { title },
    { name: "description", content: description },
    { property: "og:type", content: "website" },
    { property: "og:title", content: title },
    { property: "og:description", content: description },
    { name: "twitter:card", content: imageUrl ? "summary_large_image" : "summary" },
    { name: "twitter:title", content: title },
    { name: "twitter:description", content: description },
  ];

  if (shareUrl) {
    tags.push({ property: "og:url", content: shareUrl });
  }
  if (imageUrl) {
    tags.push({ property: "og:image", content: imageUrl });
    tags.push({ name: "twitter:image", content: imageUrl });
  }

  return tags;
}

export async function clientLoader({ params }: Route.ClientLoaderArgs): Promise<VerificationResult> {
  return verifyCertificate(params.code);
}

export default function VerifyPage() {
  const result = useLoaderData<typeof clientLoader>();
  const [copiedText, setCopiedText] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [shareBusy, setShareBusy] = useState(false);
  // ogShareUrl  → API endpoint (/api/v1/verify/:code/share) — serves OG HTML for LinkedIn crawler
  // verifyUrl   → actual frontend page URL — used for copy link & native share
  const ogShareUrl = getOgShareUrl(result) ?? "";
  const verifyUrl = getFrontendVerifyUrl();
  const pdfUrl = `${API_BASE_URL}/certificates/${encodeURIComponent(result.code)}/render?format=pdf`;
  const certName = result.cert_name ?? result.batch_name ?? result.template_name ?? "a certificate";
  const shareText = result.valid
    ? `I just earned ${certName} certification ${result.chapter_name ? ` from ${result.chapter_name}` : ""}.`
    : "Verify this certificate.";
  const linkedinShareURL = `https://www.linkedin.com/feed/?shareActive=true&text=${encodeURIComponent(`${shareText}\n${verifyUrl}`)}`;

  const copyShareLink = async () => {
    if (!verifyUrl) return;
    await navigator.clipboard.writeText(verifyUrl);
    setCopiedLink(true);
    window.setTimeout(() => setCopiedLink(false), 1800);
  };

  const shareNatively = async () => {
    if (!verifyUrl || !navigator.share) return;
    setShareBusy(true);
    try {
      await navigator.share({
        title: "Certificate Verification",
        text: shareText,
        url: verifyUrl,
      });
    } catch {
      // User may cancel share; no action needed.
    } finally {
      setShareBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-[var(--canvas)] flex items-center justify-center p-8">
      <div className="bg-card rounded-xl border p-8 max-w-md w-full text-center shadow-[0_1px_2px_rgba(60,64,67,.15),0_1px_3px_1px_rgba(60,64,67,.07)]">
        {result.valid && result.preview_image_url && (
          <div className="mb-6 rounded-lg overflow-hidden border bg-[var(--canvas)]">
            <img
              src={result.preview_image_url}
              alt="Certificate preview"
              className="w-full object-contain"
            />
          </div>
        )}
        <div className={cn("mb-4", result.valid ? "text-status-green" : "text-destructive")}>
          {result.valid
            ? <CheckCircle2 className="mx-auto w-14 h-14" strokeWidth={1.5} />
            : <XCircle className="mx-auto w-14 h-14" strokeWidth={1.5} />}
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
            {(result.batch_name || result.template_name) && (
              <div>
                <dt className="text-xs text-muted-foreground">Certification</dt>
                <dd className="font-medium text-sm">{certName}</dd>
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

        {result.valid && (ogShareUrl || verifyUrl) && (
          <div className="border-t pt-4 mt-6 flex flex-wrap gap-2 justify-center">
            <a
              href={pdfUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-muted"
            >
              Download PDF
            </a>
            <a
              href={linkedinShareURL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-muted"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#0A66C2" className="size-3.5 shrink-0">
                <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
              </svg>
              Share on LinkedIn
            </a>
            {typeof navigator !== "undefined" && "share" in navigator && (
              <button
                type="button"
                onClick={shareNatively}
                disabled={shareBusy}
                className="inline-flex items-center rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-60"
              >
                {shareBusy ? "Opening share..." : "Share"}
              </button>
            )}
            <button
              type="button"
              onClick={async () => {
                await navigator.clipboard.writeText(shareText);
                setCopiedText(true);
                window.setTimeout(() => setCopiedText(false), 1800);
              }}
              className="inline-flex items-center rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-muted"
            >
              {copiedText ? "Copied!" : "Copy post text"}
            </button>
            <button
              type="button"
              onClick={copyShareLink}
              className="inline-flex items-center rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-muted"
            >
              {copiedLink ? "Link copied" : "Copy share link"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

