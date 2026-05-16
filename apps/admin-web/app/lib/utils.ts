import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

// Minimal nanoid replacement — no dependency needed for short IDs
export function nanoid(): string {
  return Math.random().toString(36).slice(2, 11);
}

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
