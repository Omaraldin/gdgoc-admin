import { apiClient } from "./client";
import type { DynamicImage, DynamicImageDetail } from "~/lib/types";

export async function listDynamicImages(): Promise<DynamicImage[]> {
  const res = await apiClient.get<DynamicImage[]>("/dynamic-images");
  return res.data ?? [];
}

export async function getDynamicImage(id: string): Promise<DynamicImageDetail> {
  const res = await apiClient.get<DynamicImageDetail>(`/dynamic-images/${id}`);
  return res.data;
}

export async function createDynamicImage(data: {
  name: string;
  description?: string;
  scene: object;
}): Promise<DynamicImage> {
  const res = await apiClient.post<DynamicImage>("/dynamic-images", data);
  return res.data;
}

export async function updateDynamicImage(
  id: string,
  data: { name: string; description?: string; scene: object },
): Promise<DynamicImage> {
  const res = await apiClient.patch<DynamicImage>(`/dynamic-images/${id}`, data);
  return res.data;
}

export async function deleteDynamicImage(id: string): Promise<void> {
  await apiClient.delete(`/dynamic-images/${id}`);
}

export async function publishDynamicImage(id: string): Promise<DynamicImage> {
  const res = await apiClient.post<DynamicImage>(`/dynamic-images/${id}/publish`);
  return res.data;
}

export async function unpublishDynamicImage(id: string): Promise<DynamicImage> {
  const res = await apiClient.post<DynamicImage>(`/dynamic-images/${id}/unpublish`);
  return res.data;
}

/** Returns the public render URL for a dynamic image with given variable values. */
export function getDynamicImageUrl(
  id: string,
  vars: Record<string, string> = {},
): string {
  const base = `${import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8080/api/v1"}/images/${id}`;
  const params = new URLSearchParams(vars);
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}
