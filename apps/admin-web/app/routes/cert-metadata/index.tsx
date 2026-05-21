import { useState } from "react";
import { useLoaderData } from "react-router";
import { listCertMetadata, createCertMetadata, updateCertMetadata, deleteCertMetadata } from "~/lib/api/issuance";
import { getMe } from "~/lib/api/auth";
import type { CertMetadata, User } from "~/lib/types";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Card, CardContent } from "~/components/ui/card";
import { ConfirmModal } from "~/components/ConfirmModal";
import { BookOpen, Plus, Pencil, Trash2 } from "lucide-react";
import { formatDate } from "~/lib/utils";

export function meta() {
  return [{ title: "Certification Metadata | GDGoC Admin" }];
}

export async function clientLoader() {
  const [user, items] = await Promise.all([getMe(), listCertMetadata()]);
  return { user, items };
}

export default function CertMetadataPage() {
  const initial = useLoaderData<typeof clientLoader>();
  const user = initial.user as User;

  const [items, setItems] = useState<CertMetadata[]>(initial.items as CertMetadata[]);

  // Create / edit form state
  const [editing, setEditing] = useState<CertMetadata | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Delete confirm state
  const [deleteTarget, setDeleteTarget] = useState<CertMetadata | null>(null);
  const [deleting, setDeleting] = useState(false);

  function openCreate() {
    setEditing(null);
    setName("");
    setDescription("");
    setFormError(null);
    setShowForm(true);
  }

  function openEdit(item: CertMetadata) {
    setEditing(item);
    setName(item.name);
    setDescription(item.description ?? "");
    setFormError(null);
    setShowForm(true);
  }

  function closeForm() {
    setShowForm(false);
    setEditing(null);
    setFormError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setFormError("Name is required.");
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      if (editing) {
        const updated = await updateCertMetadata(editing.id, { name: name.trim(), description: description.trim() });
        setItems((prev) => prev.map((i) => (i.id === updated.id ? updated : i)));
      } else {
        const created = await createCertMetadata({ name: name.trim(), description: description.trim() });
        setItems((prev) => [...prev, created]);
      }
      closeForm();
    } catch {
      setFormError("Failed to save. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteCertMetadata(deleteTarget.id);
      setItems((prev) => prev.filter((i) => i.id !== deleteTarget.id));
      setDeleteTarget(null);
    } catch {
      // silently ignore; user can retry
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="p-4 sm:p-8 max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-xl font-semibold text-foreground flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-primary" />
            Certification Metadata
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage named certification programmes for your chapter.
          </p>
        </div>
        <Button size="sm" onClick={openCreate}>
          <Plus className="w-4 h-4 mr-1.5" />
          New Certification
        </Button>
      </div>

      {/* Create / Edit form (inline card) */}
      {showForm && (
        <Card className="mb-6 border-primary/40">
          <CardContent className="p-5">
            <h2 className="text-sm font-semibold mb-4 text-foreground">
              {editing ? "Edit Certification" : "New Certification"}
            </h2>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="cert-name">Name</Label>
                <Input
                  id="cert-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Cloud Study Jam 2025"
                  required
                  autoFocus
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cert-desc">Description <span className="text-muted-foreground font-normal">(optional)</span></Label>
                <textarea
                  id="cert-desc"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Short description of this certification"
                  rows={3}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-y"
                />
              </div>
              {formError && (
                <p className="text-sm text-destructive">{formError}</p>
              )}
              <div className="flex gap-2 justify-end">
                <Button type="button" variant="outline" size="sm" onClick={closeForm} disabled={saving}>
                  Cancel
                </Button>
                <Button type="submit" size="sm" disabled={saving}>
                  {saving ? "Saving…" : editing ? "Save Changes" : "Create"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* List */}
      {items.length === 0 ? (
        <p className="text-muted-foreground text-center py-20 text-sm">
          No certification metadata yet. Create one to start grouping batches.
        </p>
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <Card key={item.id}>
              <CardContent className="p-4 flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-foreground truncate">{item.name}</p>
                  {item.description && (
                    <p className="text-sm text-muted-foreground mt-0.5 line-clamp-2">{item.description}</p>
                  )}
                  <p className="text-xs text-muted-foreground mt-1">Created {formatDate(item.created_at)}</p>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => openEdit(item)}
                    aria-label="Edit"
                  >
                    <Pencil className="w-4 h-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="text-destructive hover:text-destructive"
                    onClick={() => setDeleteTarget(item)}
                    aria-label="Delete"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Delete confirm */}
      {deleteTarget && (
        <ConfirmModal
          title="Delete Certification?"
          message={`"${deleteTarget.name}" will be permanently deleted. Existing batches linked to it will remain but lose the association.`}
          confirmLabel={deleting ? "Deleting…" : "Delete"}
          destructive
          onConfirm={handleDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}
