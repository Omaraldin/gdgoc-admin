import { redirect } from "react-router";
import { apiClient } from "~/lib/api/client";

async function doLogout() {
  try {
    await apiClient.post("/auth/logout");
  } catch {
    // Best-effort — clear session server-side; redirect regardless.
  }
  throw redirect("/auth/login");
}

export async function clientLoader() {
  return doLogout();
}

export async function clientAction() {
  return doLogout();
}

export default function LogoutPage() {
  return null;
}
