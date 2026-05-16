import { useState } from "react";
import { useNavigate, Link } from "react-router";
import { createMailTemplate } from "~/lib/api/mail";
import { MailTemplateForm } from "./_form";

export function meta() {
  return [{ title: "New Mail Template | GDGoC Admin" }];
}

export default function NewMailTemplatePage() {
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
      const tmpl = await createMailTemplate(data);
      navigate(`/mail/templates/${tmpl.id}/edit`);
    } catch {
      setError("Failed to create template. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-4 sm:p-8 max-w-2xl mx-auto">
      <div className="mb-6">
        <Link to="/mail/templates" className="text-xs text-muted-foreground hover:text-foreground">← Back to Templates</Link>
        <h1 className="text-xl font-semibold mt-1 text-foreground">New Mail Template</h1>
      </div>
      <MailTemplateForm onSave={handleSave} saving={saving} error={error} />
    </div>
  );
}
