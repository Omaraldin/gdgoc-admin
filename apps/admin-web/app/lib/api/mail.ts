import { apiClient } from "./client";

export interface MailTemplate {
  id: string;
  chapter_id: string;
  name: string;
  subject: string;
  body: string;           // HTML
  variables: string[];    // dynamic field keys
  status: "draft" | "published";
  created_by: string;
  created_by_name: string;
  created_at: string;
  updated_at: string;
}

export interface CreateMailTemplatePayload {
  name: string;
  subject: string;
  body: string;
  variables: string[];
}

export interface UpdateMailTemplatePayload {
  name: string;
  subject: string;
  body: string;
  variables: string[];
}

export async function listMailTemplates(): Promise<MailTemplate[]> {
  const res = await apiClient.get<MailTemplate[]>("/mail/templates");
  return res.data ?? [];
}

export async function getMailTemplate(id: string): Promise<MailTemplate> {
  const res = await apiClient.get<MailTemplate>(`/mail/templates/${id}`);
  return res.data;
}

export async function createMailTemplate(data: CreateMailTemplatePayload): Promise<MailTemplate> {
  const res = await apiClient.post<MailTemplate>("/mail/templates", data);
  return res.data;
}

export async function updateMailTemplate(id: string, data: UpdateMailTemplatePayload): Promise<MailTemplate> {
  const res = await apiClient.patch<MailTemplate>(`/mail/templates/${id}`, data);
  return res.data;
}

export async function deleteMailTemplate(id: string): Promise<void> {
  await apiClient.delete(`/mail/templates/${id}`);
}

export async function publishMailTemplate(id: string): Promise<MailTemplate> {
  const res = await apiClient.post<MailTemplate>(`/mail/templates/${id}/publish`);
  return res.data;
}

export async function unpublishMailTemplate(id: string): Promise<MailTemplate> {
  const res = await apiClient.post<MailTemplate>(`/mail/templates/${id}/unpublish`);
  return res.data;
}

export async function cloneMailTemplate(id: string): Promise<MailTemplate> {
  const res = await apiClient.post<MailTemplate>(`/mail/templates/${id}/clone`);
  return res.data;
}

export async function sendMail(payload: {
  to: string[];
  subject: string;
  body: string;
  is_html: boolean;
}): Promise<{ job_id: string; message: string }> {
  const res = await apiClient.post("/mail/send", payload);
  return res.data;
}

export async function uploadMailImage(file: File): Promise<{ url: string; object_key: string }> {
  const form = new FormData();
  form.append("file", file);
  const res = await apiClient.post<{ url: string; object_key: string }>("/mail/images", form, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return res.data;
}
