import { useLoaderData, Link, useRevalidator, useOutletContext } from "react-router";
import { useState } from "react";
import { listMailTemplates, deleteMailTemplate, publishMailTemplate, unpublishMailTemplate, cloneMailTemplate, type MailTemplate } from "~/lib/api/mail";
import { formatDate } from "~/lib/utils";
import { ConfirmModal } from "~/components/ConfirmModal";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { Badge } from "~/components/ui/badge";
import { isSuperAdminRole } from "~/lib/roles";
import type { User } from "~/lib/types";

export function meta() {
  return [{ title: "Mail Templates | GDGoC Admin" }];
}

export async function clientLoader() {
  return listMailTemplates();
}

export default function MailTemplatesPage() {
  const templates = useLoaderData<typeof clientLoader>();
  const revalidator = useRevalidator();
  const { user } = useOutletContext<{ user: User }>();
  const [modal, setModal] = useState<{ tmpl: MailTemplate } | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);

  const isOwner = (t: MailTemplate) =>
    isSuperAdminRole(user.role) || user.chapter_id === t.chapter_id;

  const togglePublish = async (t: MailTemplate) => {
    setLoadingId(t.id);
    try {
      if (t.status === "published") {
        await unpublishMailTemplate(t.id);
      } else {
        await publishMailTemplate(t.id);
      }
      revalidator.revalidate();
    } finally {
      setLoadingId(null);
    }
  };

  const handleClone = async (t: MailTemplate) => {
    setLoadingId(t.id + "-clone");
    try {
      await cloneMailTemplate(t.id);
      revalidator.revalidate();
    } finally {
      setLoadingId(null);
    }
  };

  return (
    <div className="p-4 sm:p-8 max-w-3xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Mail Templates</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Reusable email templates — only <strong>published</strong> templates appear in the compose picker.
          </p>
        </div>
        <Button asChild size="sm">
          <Link to="/mail/templates/new">+ New Template</Link>
        </Button>
      </div>

      {templates.length === 0 ? (
        <div className="text-center py-20 text-muted-foreground">
          <p className="text-lg">No mail templates yet.</p>
          <p className="text-sm mt-1">Create one to reuse rich HTML emails with dynamic fields.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {templates.map((t) => (
            <Card key={t.id}>
              <CardContent className="p-5 flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h2 className="font-semibold text-sm truncate">{t.name}</h2>
                    <Badge variant={t.status === "published" ? "default" : "secondary"} className="text-[11px] shrink-0">
                      {t.status}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground truncate">Subject: {t.subject}</p>
                  {t.variables.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {t.variables.map((v) => (
                        <code key={v} className="text-xs px-1.5 py-0.5 rounded bg-accent border border-primary/20 text-primary">
                          {"{{"}{v}{"}}"}
                        </code>
                      ))}
                    </div>
                  )}
                  <p className="text-xs text-muted-foreground mt-2">{formatDate(t.created_at)}</p>
                </div>
                <div className="flex gap-2 flex-shrink-0 flex-wrap justify-end">
                  {isOwner(t) ? (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={loadingId === t.id}
                        onClick={() => togglePublish(t)}
                      >
                        {t.status === "published" ? "Unpublish" : "Publish"}
                      </Button>
                      <Button asChild variant="outline" size="sm">
                        <Link to={`/mail/templates/${t.id}/edit`}>Edit</Link>
                      </Button>
                      <Button variant="outline" size="sm" className="text-destructive border-destructive/30 hover:bg-red-soft" onClick={() => setModal({ tmpl: t })}>
                        Delete
                      </Button>
                    </>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={loadingId === t.id + "-clone"}
                      onClick={() => handleClone(t)}
                    >
                      Clone
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {modal && (
        <ConfirmModal
          title="Delete template?"
          message={`Delete "${modal.tmpl.name}"? This cannot be undone.`}
          destructive
          confirmLabel="Delete"
          onConfirm={async () => {
            await deleteMailTemplate(modal.tmpl.id);
            setModal(null);
            revalidator.revalidate();
          }}
          onCancel={() => setModal(null)}
        />
      )}
    </div>
  );
}
