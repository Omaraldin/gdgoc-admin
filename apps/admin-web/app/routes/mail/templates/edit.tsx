import { useState } from "react";
import { useLoaderData, useNavigate, Link, useOutletContext } from "react-router";
import type { Route } from "./+types/edit";
import { getMailTemplate, updateMailTemplate, cloneMailTemplate } from "~/lib/api/mail";
import { MailTemplateForm } from "./_form";
import { isSuperAdminRole } from "~/lib/roles";
import type { User } from "~/lib/types";

export function meta() {
  return [{ title: "Edit Mail Template | GDGoC Admin" }];
}

export async function clientLoader({ params }: Route.ClientLoaderArgs) {
  return getMailTemplate(params.id);
}

export default function EditMailTemplatePage() {
  const template = useLoaderData<typeof clientLoader>();
  const navigate = useNavigate();
  const { user } = useOutletContext<{ user: User }>();

  const isOwner = isSuperAdminRole(user.role) || user.id === template.created_by;

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [cloning, setCloning] = useState(false);

  // Non-owners get a clone-and-edit experience instead
  if (!isOwner) {
    return (
      <div className="p-4 sm:p-8 max-w-2xl mx-auto">
        <Link to="/mail/templates" className="text-xs text-muted-foreground hover:text-foreground">← Back to Templates</Link>
        <h1 className="text-xl font-semibold mt-1 text-foreground">Edit: {template.name}</h1>
        <div className="mt-6 rounded-lg border border-border bg-muted/40 p-6 text-center space-y-3">
          <p className="text-sm text-muted-foreground">
            You are not the author of this template. Clone it to create your own editable copy.
          </p>
          <button
            type="button"
            disabled={cloning}
            onClick={async () => {
              setCloning(true);
              try {
                const copy = await cloneMailTemplate(template.id);
                navigate(`/mail/templates/${copy.id}/edit`);
              } finally {
                setCloning(false);
              }
            }}
            className="px-4 py-2 rounded bg-primary text-primary-foreground text-sm hover:opacity-90 disabled:opacity-50"
          >
            {cloning ? "Cloning…" : "Clone & Edit"}
          </button>
        </div>
      </div>
    );
}

  const handleSave = async (data: {
    name: string;
    subject: string;
    body: string;
    variables: string[];
  }) => {
    setError("");
    setSaving(true);
    try {
      await updateMailTemplate(template.id, data);
      navigate("/mail/templates");
    } catch {
      setError("Failed to save template. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-4 sm:p-8 max-w-2xl mx-auto">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <Link to="/mail/templates" className="text-xs text-muted-foreground hover:text-foreground">← Back to Templates</Link>
          <h1 className="text-xl font-semibold mt-1 text-foreground">Edit: {template.name}</h1>
        </div>
        <button
          type="button"
          disabled={cloning}
          onClick={async () => {
            setCloning(true);
            try {
              const copy = await cloneMailTemplate(template.id);
              navigate(`/mail/templates/${copy.id}/edit`);
            } finally {
              setCloning(false);
            }
          }}
          className="shrink-0 px-3 py-1.5 rounded border border-border text-sm hover:bg-muted transition-colors disabled:opacity-50"
        >
          {cloning ? "Cloning…" : "Clone"}
        </button>
      </div>
      <MailTemplateForm initial={template} onSave={handleSave} saving={saving} error={error} />
    </div>
  );
}
