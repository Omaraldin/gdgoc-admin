import { useLoaderData, Link } from "react-router";
import type { Route } from "./+types/versions";
import { getTemplate, listTemplateVersions } from "~/lib/api/templates";
import { formatDate } from "~/lib/utils";
import { Badge } from "~/components/ui/badge";
import { Card, CardContent } from "~/components/ui/card";

export function meta() {
  return [{ title: "Template Versions | GDGoC Admin" }];
}

export async function clientLoader({ params }: Route.ClientLoaderArgs) {
  const [template, versions] = await Promise.all([
    getTemplate(params.id),
    listTemplateVersions(params.id),
  ]);
  return { template, versions };
}

export default function TemplateVersionsPage() {
  const { template, versions } = useLoaderData<typeof clientLoader>();

  return (
    <div className="p-4 sm:p-8 max-w-2xl mx-auto">
      <div className="flex items-center gap-4 mb-6 flex-wrap">
        <Link to={`/templates/${template.id}`} className="text-sm text-muted-foreground hover:text-foreground">
          ← {template.name}
        </Link>
        <h1 className="text-xl font-semibold text-foreground">Version History</h1>
      </div>

      {versions.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <p>No versions saved yet.</p>
          <p className="text-sm mt-1">Save from the editor to create a version.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {[...versions].reverse().map((v, i) => (
            <Card key={v.id}>
              <CardContent className="p-5 flex items-center justify-between">
                <div>
                  <p className="font-semibold">Version {v.version}</p>
                  <p className="text-sm text-muted-foreground">{formatDate(v.created_at)}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {v.scene.layers.length} layer{v.scene.layers.length !== 1 ? "s" : ""} · {v.scene.width}×{v.scene.height}
                  </p>
                </div>
                {i === 0 && <Badge variant="info">Latest</Badge>}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

