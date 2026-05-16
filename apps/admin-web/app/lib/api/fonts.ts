import { apiClient } from "./client";
import type { FontRecord } from "~/lib/types";

export async function listFonts(): Promise<FontRecord[]> {
  const res = await apiClient.get<FontRecord[]>("/fonts");
  return res.data ?? [];
}

export async function uploadFont(file: File): Promise<FontRecord> {
  const form = new FormData();
  form.append("file", file);
  const res = await apiClient.post<FontRecord>("/fonts", form, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return res.data;
}

export async function deleteFont(id: string): Promise<void> {
  await apiClient.delete(`/fonts/${id}`);
}
