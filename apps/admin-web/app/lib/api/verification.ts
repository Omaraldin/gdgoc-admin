import { apiClient } from "./client";
import type { VerificationResult } from "~/lib/types";

export async function verifyCertificate(code: string): Promise<VerificationResult> {
  const res = await apiClient.get<VerificationResult>(`/verify/${code}`);
  return res.data;
}
