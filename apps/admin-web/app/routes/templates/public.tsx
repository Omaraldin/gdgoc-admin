import { useLoaderData, Link } from "react-router";
import { listPublicTemplates } from "~/lib/api/templates";
import { cloneTemplate, exportTemplate } from "~/lib/api/templates";
import { useNavigate } from "react-router";
import { useState } from "react";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import type { Template } from "~/lib/types";

export function meta() {
  return [{ title: "Public Templates | GDGoC Admin" }];
}

export async function clientLoader() {
  return listPublicTemplates();
}

export default function PublicTemplatesPage() {
  const templates = useLoaderData<typeof clientLoader>();
  const navigate = useNavigate();
  const [cloneTarget, setCloneTarget] = useState<Template | null>(null);
  const [cloneName, setCloneName] = useState("");
  const [cloning, setCloning] = useState(false);

  const handleCloneClick = (t: Template) => {
    setCloneName(t.name + " (Clone)");
    setCloneTarget(t);
  };

  const handleCloneConfirm = async () => {
    if (!cloneTarget) return;
    setCloning(true);
    try {
      const cloned = await cloneTemplate(cloneTarget.id, cloneName.trim() || undefined);
      navigate(`/templates/${cloned.id}/editor`);
    } finally {
      setCloning(false);
      setCloneTarget(null);
    }
  };

  return (
    <div className="p-4 sm:p-8 max-w-5xl mx-auto">
      <h1 className="text-xl font-semibold mb-1 text-foreground">Public Templates</h1>
      <p className="text-muted-foreground text-sm mb-6">
        Templates shared by all chapters. Clone to make your own editable copy, or use directly.
      </p>

      {templates.length === 0 ? (
        <p className="text-muted-foreground text-center py-20">No public templates available yet.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {templates.map((t) => (
            <Card key={t.id}>
              <CardContent className="p-5">
                <h2 className="font-semibold mb-1 truncate text-sm">{t.name}</h2>
                <p className="text-sm text-muted-foreground mb-4 line-clamp-2">{t.description}</p>
                <div className="flex gap-2">
                  <Button asChild variant="ghost" size="sm">
                    <Link to={`/templates/${t.id}`}>Preview</Link>
                  </Button>
                  <Button variant="ghost" size="sm" className="text-primary" onClick={() => handleCloneClick(t)}>
                    Clone &amp; Edit
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => exportTemplate(t.id, t.name)}>
                    Export
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={!!cloneTarget} onOpenChange={(open) => { if (!open) setCloneTarget(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Clone template</DialogTitle>
          </DialogHeader>
          <div className="space-y-1.5 py-2">
            <Label htmlFor="clone-name-pub">New template name</Label>
            <Input
              id="clone-name-pub"
              value={cloneName}
              onChange={(e) => setCloneName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleCloneConfirm(); }}
              autoFocus
            />
          </div>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" size="sm" onClick={() => setCloneTarget(null)}>Cancel</Button>
            <Button size="sm" disabled={!cloneName.trim() || cloning} onClick={handleCloneConfirm}>
              {cloning ? "Cloning…" : "Clone"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

