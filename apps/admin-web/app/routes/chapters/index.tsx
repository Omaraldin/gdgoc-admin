import { useLoaderData, Link } from "react-router";
import { listChapters } from "~/lib/api/admin";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { Badge } from "~/components/ui/badge";

export function meta() {
  return [{ title: "Chapters | GDGoC Admin" }];
}

export async function clientLoader() {
  return listChapters();
}

export default function ChaptersPage() {
  const chapters = useLoaderData<typeof clientLoader>();

  return (
    <div className="p-4 sm:p-8 max-w-5xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <h1 className="text-xl font-semibold text-foreground">Chapters</h1>
        <Button asChild size="sm">
          <Link to="/chapters/new">+ New Chapter</Link>
        </Button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {(chapters ?? []).map((ch) => (
          <Card key={ch.id}>
            <CardContent className="p-5">
              <div className="flex items-start gap-4">
                {ch.profile_picture_url ? (
                  <img
                    src={ch.profile_picture_url}
                    alt={ch.name}
                    className="w-10 h-10 rounded-full object-cover flex-shrink-0"
                  />
                ) : (
                  <div className="w-10 h-10 rounded-full bg-accent flex items-center justify-center flex-shrink-0">
                    <span className="text-primary font-semibold text-sm">{ch.name.charAt(0).toUpperCase()}</span>
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <h2 className="font-semibold truncate text-foreground">{ch.name}</h2>
                    <Badge variant={ch.status === "active" ? "success" : "neutral"}>
                      {ch.status}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground mt-0.5 truncate">{ch.email}</p>
                  <div className="flex gap-4 mt-3 text-sm">
                    <Link to={`/chapters/${ch.id}`} className="text-primary hover:underline font-medium text-xs">Details</Link>
                    <Link to={`/chapters/${ch.id}/edit`} className="text-muted-foreground hover:underline text-xs">Edit</Link>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
