import { useLoaderData, Link, useRevalidator } from "react-router";
import { useRef, useState } from "react";
import { listTemplates, exportTemplate, importTemplate } from "~/lib/api/templates";
import { formatDate } from "~/lib/utils";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { Badge } from "~/components/ui/badge";
import type { Template } from "~/lib/types";

export function meta() {
  return [{ title: "Templates | GDGoC Admin" }];
}

export async function clientLoader() {
  return listTemplates();
}

export default function TemplatesPage() {
  const templates = useLoaderData<typeof clientLoader>();
  const { revalidate } = useRevalidator();
  const importInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);

  const handleExport = (t: Template) => exportTemplate(t.id, t.name);

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    try {
      await importTemplate(file);
      revalidate();
    } catch {
      alert("Failed to import template. Make sure the file is a valid exported template JSON.");
    } finally {
      setImporting(false);
      e.target.value = "";
    }
  };

  return (
    <div className="p-4 sm:p-8 max-w-6xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <h1 className="text-xl font-semibold text-foreground">My Templates</h1>
        <div className="flex gap-2">
          <input ref={importInputRef} type="file" accept=".json" className="hidden" onChange={handleImport} />
          <Button variant="outline" size="sm" onClick={() => importInputRef.current?.click()} disabled={importing}>
            {importing ? "Importing..." : "Import JSON"}
          </Button>
          <Button asChild size="sm">
            <Link to="/templates/new">+ New Template</Link>
          </Button>
        </div>
      </div>

      {templates.length === 0 ? (
        <div className="text-center py-20 text-muted-foreground">
          <p className="text-base">No templates yet.</p>
          <p className="text-sm mt-1">Create your first certificate template to get started.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {templates.map((t) => (
            <Card key={t.id} className="hover:shadow-md transition-shadow flex flex-col">
              <CardContent className="p-5 flex flex-col flex-1">
                <div className="flex items-start justify-between mb-3">
                  <h2 className="font-semibold truncate text-foreground">{t.name}</h2>
                  <div className="flex gap-1 flex-shrink-0">
                    <TemplateBadge value={t.status} />
                    <TemplateBadge value={t.visibility} variant="secondary" />
                  </div>
                </div>
                <p className="text-sm text-muted-foreground mb-4 line-clamp-2">{t.description || "No description"}</p>
                <div className="flex-1" />
                <div className="flex items-center justify-between gap-2 pt-3 border-t border-border text-xs text-muted-foreground">
                  <div className="flex flex-col gap-0.5">
                    <span>Updated {formatDate(t.updated_at)}</span>
                    {t.created_by_name && <span>By {t.created_by_name}</span>}
                  </div>
                  <div className="flex gap-3">
                    <Link to={`/templates/${t.id}/editor`} className="text-primary hover:underline font-medium">
                      Edit
                    </Link>
                    <Link to={`/templates/${t.id}`} className="text-muted-foreground hover:underline">
                      Details
                    </Link>
                    <button onClick={() => handleExport(t)} className="text-muted-foreground hover:underline">
                      Export
                    </button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function TemplateBadge({ value, variant = "primary" }: { value: string; variant?: "primary" | "secondary" }) {
  type BadgeVariant = "info" | "success" | "neutral" | "warning" | "error";
  const primaryMap: Record<string, BadgeVariant> = {
    draft: "warning",
    published: "success",
    archived: "neutral",
  };
  const secondaryMap: Record<string, BadgeVariant> = {
    private: "neutral",
    public: "info",
  };
  const v = variant === "primary" ? (primaryMap[value] ?? "neutral") : (secondaryMap[value] ?? "neutral");
  return <Badge variant={v}>{value}</Badge>;
}
