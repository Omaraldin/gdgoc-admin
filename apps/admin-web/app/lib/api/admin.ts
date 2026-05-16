import { apiClient } from "./client";
import type { Chapter, User, WhitelistEntry, SMTPStatus } from "~/lib/types";

export async function listChapters(): Promise<Chapter[]> {
  const res = await apiClient.get<Chapter[]>("/chapters");
  return res.data ?? [];
}

export async function getChapter(id: string): Promise<Chapter> {
  const res = await apiClient.get<Chapter>(`/chapters/${id}`);
  return res.data;
}

export async function createChapter(data: {
  name: string;
  email: string;
  code?: string;
  since_year?: number;
  leader_codename?: string;
}): Promise<Chapter> {
  const res = await apiClient.post<Chapter>("/chapters", data);
  return res.data;
}

export async function assignLeader(chapterId: string, userId: string): Promise<void> {
  await apiClient.post(`/chapters/${chapterId}/leader`, { user_id: userId });
}

export async function updateChapterLeaderProfile(
  chapterId: string,
  data: { since_year?: number; leader_codename?: string },
): Promise<Chapter> {
  const res = await apiClient.patch<Chapter>(`/chapters/${chapterId}/leader-profile`, data);
  return res.data;
}

export async function uploadChapterProfilePicture(chapterId: string, file: File): Promise<Chapter> {
  const form = new FormData();
  form.append("file", file);
  const res = await apiClient.post<Chapter>(`/chapters/${chapterId}/profile-picture`, form, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return res.data;
}

// ---------------------------------------------------------------------------
// SMTP
// ---------------------------------------------------------------------------

export async function getChapterSMTPStatus(chapterId: string): Promise<SMTPStatus> {
  const res = await apiClient.get<SMTPStatus>(`/chapters/${chapterId}/smtp`);
  return res.data;
}

export interface ManualSMTPInput {
  host: string;
  port: number;
  username: string;
  password: string;
  email?: string;
}

export async function updateManualSMTP(chapterId: string, input: ManualSMTPInput): Promise<void> {
  await apiClient.patch(`/chapters/${chapterId}/smtp`, input);
}

export async function disconnectSMTP(chapterId: string): Promise<void> {
  await apiClient.delete(`/chapters/${chapterId}/smtp`);
}

export async function getOAuthConnectURL(
  chapterId: string,
  provider: "gmail" | "outlook",
): Promise<string> {
  const res = await apiClient.get<{ auth_url: string }>(
    `/chapters/${chapterId}/smtp/oauth/connect?provider=${provider}`,
  );
  return res.data.auth_url;
}

/** @deprecated use updateManualSMTP instead */
export async function updateChapterSMTP(chapterId: string, smtpPassword: string): Promise<Chapter> {
  const res = await apiClient.patch<Chapter>(`/chapters/${chapterId}/smtp`, { smtp_password: smtpPassword });
  return res.data;
}

// ---------------------------------------------------------------------------

export async function listUsers(): Promise<User[]> {
  const res = await apiClient.get<User[]>("/users");
  return res.data ?? [];
}

export async function updateUser(id: string, data: Partial<User>): Promise<User> {
  const res = await apiClient.patch<User>(`/users/${id}`, data);
  return res.data;
}

export async function listWhitelist(): Promise<WhitelistEntry[]> {
  const res = await apiClient.get<WhitelistEntry[]>("/whitelist");
  return res.data;
}

export async function addToWhitelist(email: string): Promise<void> {
  await apiClient.post("/whitelist", { email });
}

export async function removeFromWhitelist(id: string): Promise<void> {
  await apiClient.delete(`/whitelist/${id}`);
}
