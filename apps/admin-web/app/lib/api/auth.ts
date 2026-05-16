import { apiClient } from "./client";
import type { User } from "~/lib/types";

export async function getMe(): Promise<User> {
  const res = await apiClient.get<User>("/me");
  return res.data;
}

export function loginUrl(): string {
  const base = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8080/api/v1";
  const redirect = encodeURIComponent(window.location.origin);
  return `${base}/auth/login?redirect=${redirect}`;
}
