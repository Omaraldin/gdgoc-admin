import { useState } from "react";
import { useLoaderData, useNavigate, Link } from "react-router";
import type { Route } from "./+types/edit";
import { getMailTemplate, updateMailTemplate } from "~/lib/api/mail";
import { MailTemplateForm } from "./_form";

export function meta() {
  return [{ title: "Edit Mail Template | GDGoC Admin" }];
}

export async function clientLoader({ params }: Route.ClientLoaderArgs) {
  return getMailTemplate(params.id);
}

export default function EditMailTemplatePage() {
  const template = useLoaderData<typeof clientLoader>();
  const navigate = useNavigate();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

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
      <div className="mb-6">
        <Link to="/mail/templates" className="text-xs text-muted-foreground hover:text-foreground">← Back to Templates</Link>
        <h1 className="text-xl font-semibold mt-1 text-foreground">Edit: {template.name}</h1>
      </div>
      <MailTemplateForm initial={template} onSave={handleSave} saving={saving} error={error} />
    </div>
  );
}
