import { apiClient } from "./client";
import type { IssuanceBatch, BatchRecipient, BatchProgress } from "~/lib/types";

export interface RecipientInput {
  email: string;
  variables: Record<string, string>;
  /** Original JS source for formula cells, keyed by variable name. Undefined for plain batches. */
  scripts?: Record<string, string>;
}

export interface CreateBatchPayload {
  template_id: string;
  name: string;
  recipients: Array<{ email: string; variables: Record<string, string> }>;
  send_mail: boolean;
  is_printable: boolean;
  mail_template_id?: string;
  mail_variables?: Record<string, string>;
}

export async function listBatches(): Promise<IssuanceBatch[]> {
  const res = await apiClient.get<IssuanceBatch[]>("/batches");
  return res.data ?? [];
}

export async function getBatch(id: string): Promise<IssuanceBatch> {
  const res = await apiClient.get<IssuanceBatch>(`/batches/${id}`);
  return res.data;
}

export async function createBatch(data: CreateBatchPayload): Promise<IssuanceBatch> {
  const res = await apiClient.post<IssuanceBatch>("/batches", data);
  return res.data;
}

export async function listRecipients(batchId: string): Promise<BatchRecipient[]> {
  const res = await apiClient.get<BatchRecipient[]>(`/batches/${batchId}/recipients`);
  return res.data ?? [];
}

export async function getBatchProgress(batchId: string): Promise<BatchProgress> {
  const res = await apiClient.get<BatchProgress>(`/batches/${batchId}/progress`);
  return res.data;
}

export async function cancelBatch(id: string): Promise<void> {
  await apiClient.post(`/batches/${id}/cancel`);
}

export async function downloadBatchArchive(id: string, batchName: string): Promise<void> {
  const res = await apiClient.get(`/batches/${id}/download`, { responseType: "blob" });
  const url = URL.createObjectURL(res.data as Blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${batchName}.zip`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function revokeCertificate(recipientId: string): Promise<void> {
  await apiClient.post(`/certificates/${recipientId}/revoke`);
}

export interface CertificateEntry {
  id: string;
  batch_id: string;
  email: string;
  variables: Record<string, string>;
  status: string;
  pdf_url?: string;
  png_url?: string;
  failure_reason?: string;
}

export async function listCertificates(batchId: string): Promise<CertificateEntry[]> {
  const res = await apiClient.get<CertificateEntry[]>(`/batches/${batchId}/certificates`);
  return res.data ?? [];
}

export async function deleteBatch(id: string): Promise<void> {
  await apiClient.delete(`/batches/${id}`);
}
