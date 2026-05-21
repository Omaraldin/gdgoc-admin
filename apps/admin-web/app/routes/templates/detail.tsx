import { useLoaderData, Link, useNavigate, useOutletContext } from "react-router";
import { useState } from "react";
import type { Route } from "./+types/detail";
import { getTemplate, publishTemplate, archiveTemplate, deleteTemplate, cloneTemplate } from "~/lib/api/templates";
import { formatDate } from "~/lib/utils";
import { ConfirmModal } from "~/components/ConfirmModal";
import { Button } from "~/components/ui/button";
import { Badge } from "~/components/ui/badge";
import { Card, CardContent } from "~/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { isSuperAdminRole } from "~/lib/roles";
import type { User } from "~/lib/types";

export function meta() {
  return [{ title: "Template | GDGoC Admin" }];
}

export async function clientLoader({ params }: Route.ClientLoaderArgs) {
  const template = await getTemplate(params.id);
  return { template };
}

export default function TemplateDetailPage() {
  const { template } = useLoaderData<typeof clientLoader>();
  const navigate = useNavigate();
  const { user } = useOutletContext<{ user: User }>();

  const isOwner = isSuperAdminRole(user.role) || user.id === template.owner_user_id;

  const [modal, setModal] = useState<{ title: string; message?: string; destructive?: boolean; confirmLabel?: string; onConfirm: () => void } | null>(null);
  const [cloneDialog, setCloneDialog] = useState(false);
  const [cloneName, setCloneName] = useState("");
  const [cloning, setCloning] = useState(false);

  const handlePublish = () => {
    setModal({
      title: "Publish template?",
      message: "This template will become visible to all chapter members.",
      confirmLabel: "Publish",
      onConfirm: async () => {
        await publishTemplate(template.id);
        navigate(0);
      },
    });
  };

  const handleArchive = () => {
    setModal({
      title: "Archive template?",
      destructive: true,
      confirmLabel: "Archive",
      onConfirm: async () => {
        await archiveTemplate(template.id);
        navigate(0);
      },
    });
  };

  const handleDelete = () => {
    setModal({
      title: "Delete template?",
      message: "If this template has existing batches it will be archived instead of permanently deleted.",
      destructive: true,
      confirmLabel: "Delete",
      onConfirm: async () => {
        const { archived } = await deleteTemplate(template.id);
        if (archived) {
          navigate(0); // reload to show archived status
        } else {
          navigate("/templates");
        }
      },
    });
  };

  const handleClone = () => {
    setCloneName(template.name + " (Clone)");
    setCloneDialog(true);
  };

  const handleCloneConfirm = async () => {
    setCloning(true);
    try {
      const copy = await cloneTemplate(template.id, cloneName.trim() || undefined);
      navigate(`/templates/${copy.id}/editor`);
    } finally {
      setCloning(false);
      setCloneDialog(false);
    }
  };

  return (
    <div className="p-4 sm:p-8 max-w-3xl mx-auto">
      <div className="flex items-start justify-between gap-4 mb-6 flex-wrap">
        <h1 className="text-xl font-semibold text-foreground">{template.name}</h1>
        <div className="flex gap-2 flex-wrap justify-end">
          {isOwner ? (
            <>
              <Button asChild size="sm">
                <Link to={`/templates/${template.id}/editor`}>Open Editor</Link>
              </Button>
              <Button variant="outline" size="sm" onClick={handleClone}>Clone</Button>
              {template.status === "draft" && (
                <Button variant="outline" size="sm" onClick={handlePublish} className="text-status-green border-green-200 hover:bg-green-soft">
                  Publish
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={handleDelete} className="text-destructive border-destructive/30 hover:bg-red-soft">
                Delete
              </Button>
            </>
          ) : (
            <Button variant="outline" size="sm" onClick={handleClone}>Clone &amp; Edit</Button>
          )}
        </div>
      </div>

      <Card className="mb-6">
        <CardContent className="p-6 space-y-4">
          <div className="flex gap-2">
            <TemplateBadge value={template.status} />
            <TemplateBadge value={template.visibility} variant="secondary" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Description</p>
            <p className="text-sm">{template.description || <span className="text-muted-foreground italic">No description</span>}</p>
          </div>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Created</p>
              <p>{formatDate(template.created_at)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Last Updated</p>
              <p>{formatDate(template.updated_at)}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Link to={`/templates/${template.id}/versions`} className="text-primary hover:underline text-sm font-medium">
        View version history →
      </Link>

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

      <Dialog open={cloneDialog} onOpenChange={(open) => { if (!open) setCloneDialog(false); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Clone template</DialogTitle>
          </DialogHeader>
          <div className="space-y-1.5 py-2">
            <Label htmlFor="clone-name">New template name</Label>
            <Input
              id="clone-name"
              value={cloneName}
              onChange={(e) => setCloneName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleCloneConfirm(); }}
              autoFocus
            />
          </div>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" size="sm" onClick={() => setCloneDialog(false)}>Cancel</Button>
            <Button size="sm" disabled={!cloneName.trim() || cloning} onClick={handleCloneConfirm}>
              {cloning ? "Cloning…" : "Clone"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function TemplateBadge({ value, variant = "primary" }: { value: string; variant?: "primary" | "secondary" }) {
  type V = "info" | "success" | "neutral" | "warning" | "error";
  const primaryMap: Record<string, V> = { draft: "warning", published: "success", archived: "neutral" };
  const secondaryMap: Record<string, V> = { private: "neutral", public: "info" };
  const v = variant === "primary" ? (primaryMap[value] ?? "neutral") : (secondaryMap[value] ?? "neutral");
  return <Badge variant={v}>{value}</Badge>;
}

