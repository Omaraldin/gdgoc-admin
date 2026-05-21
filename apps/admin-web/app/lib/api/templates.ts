import { apiClient } from "./client";
import type { Template, TemplateVersion } from "~/lib/types";

export async function listTemplates(): Promise<Template[]> {
  const res = await apiClient.get<Template[]>("/templates");
  return res.data ?? [];
}

export async function listPublicTemplates(): Promise<Template[]> {
  const res = await apiClient.get<Template[]>("/templates/public");
  return res.data ?? [];
}

export async function getTemplate(id: string): Promise<Template> {
  const res = await apiClient.get<Template>(`/templates/${id}`);
  return res.data;
}

export async function createTemplate(data: {
  name: string;
  description?: string;
  visibility: "private" | "public";
  scene: object;
}): Promise<Template> {
  const res = await apiClient.post<Template>("/templates", data);
  return res.data;
}

export async function publishTemplate(id: string): Promise<void> {
  await apiClient.post(`/templates/${id}/publish`);
}

export async function archiveTemplate(id: string): Promise<void> {
  await apiClient.post(`/templates/${id}/archive`);
}

export async function updateTemplateMeta(id: string, data: { name: string; description?: string }): Promise<void> {
  await apiClient.patch(`/templates/${id}`, data);
}

export async function deleteTemplate(id: string): Promise<{ archived: boolean }> {
  const res = await apiClient.delete<{ archived?: boolean }>(`/templates/${id}`);
  return { archived: res.data?.archived === true };
}

export async function cloneTemplate(id: string, name?: string): Promise<Template> {
  const res = await apiClient.post<Template>(`/templates/${id}/clone`, { name: name ?? "" });
  return res.data;
}

export async function listTemplateVersions(id: string): Promise<TemplateVersion[]> {
  const res = await apiClient.get<TemplateVersion[]>(`/templates/${id}/versions`);
  return res.data ?? [];
}

export async function getTemplateVersion(templateId: string, versionId: string): Promise<TemplateVersion> {
  const res = await apiClient.get<TemplateVersion>(`/templates/${templateId}/versions/${versionId}`);
  return res.data;
}

export async function uploadTemplateAsset(id: string, file: File): Promise<{ object_key: string }> {
  const form = new FormData();
  form.append("file", file);
  const res = await apiClient.post(`/templates/${id}/assets`, form, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return res.data;
}

export async function exportTemplate(id: string, name: string): Promise<void> {
  const res = await apiClient.get(`/templates/${id}/export`);
  const blob = new Blob([JSON.stringify(res.data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name.replace(/[^a-zA-Z0-9\-_]/g, "-") + ".json";
  a.click();
  URL.revokeObjectURL(url);
}

export async function importTemplate(file: File): Promise<Template> {
  const text = await file.text();
  const data = JSON.parse(text);
  const res = await apiClient.post<Template>("/templates/import", data);
  return res.data;
}
