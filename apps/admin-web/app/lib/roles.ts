import type { User } from "~/lib/types";

export const ROLE_SUPER_ADMIN: User["role"] = "super_admin";
export const ROLE_CHAPTER_LEADER: User["role"] = "chapter_leader";
export const ROLE_EDITOR: User["role"] = "editor";

export const ROLES: User["role"][] = [ROLE_SUPER_ADMIN, ROLE_CHAPTER_LEADER, ROLE_EDITOR];

export const ROLE_LABELS: Record<User["role"], string> = {
  [ROLE_SUPER_ADMIN]: "Super Admin",
  [ROLE_CHAPTER_LEADER]: "Chapter Leader",
  [ROLE_EDITOR]: "Editor",
};

export function isSuperAdminRole(role: User["role"]): boolean {
  return role === ROLE_SUPER_ADMIN;
}

export function isChapterLeaderRole(role: User["role"]): boolean {
  return role === ROLE_CHAPTER_LEADER;
}

export function isEditorRole(role: User["role"]): boolean {
  return role === ROLE_EDITOR;
}
