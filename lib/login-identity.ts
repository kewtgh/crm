import { supabaseAdminJson } from "./supabase-server";

type AdminUser = { email?: string; user?: { email?: string } };

export async function resolveStaffLoginEmail(identifier: string) {
  const normalized = identifier.trim().toLowerCase();
  if (normalized.includes("@")) return normalized;
  const matches = await supabaseAdminJson<Array<{ user_id: string }>>(
    `/rest/v1/user_profiles?select=user_id&username=eq.${encodeURIComponent(normalized)}&limit=1`,
  );
  if (!matches[0]?.user_id) return null;
  const account = await supabaseAdminJson<AdminUser>(`/auth/v1/admin/users/${matches[0].user_id}`);
  return account.email?.toLowerCase() ?? account.user?.email?.toLowerCase() ?? null;
}

export async function getStaffAccountEmail(userId: string) {
  const account = await supabaseAdminJson<AdminUser>(`/auth/v1/admin/users/${userId}`);
  return account.email?.toLowerCase() ?? account.user?.email?.toLowerCase() ?? null;
}
