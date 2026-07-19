import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { hasCapability, type Capability } from "./capabilities";
import { APP_ROLES, type AppRole } from "./roles";
import type { AppUser } from "./user";

export type { AppRole } from "./roles";
export type { AppUser } from "./user";

export const authCookieNames = {
  access: "crm_access_token",
  refresh: "crm_refresh_token",
} as const;

export class AuthSecurityError extends Error {
  constructor(public code: string, public status = 403) { super(code); }
}

export function decodeJwtPayload(token: string) {
  try {
    const encoded = token.split(".")[1];
    if (!encoded) return {} as Record<string, unknown>;
    const normalized = encoded.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(encoded.length / 4) * 4, "=");
    return JSON.parse(atob(normalized)) as Record<string, unknown>;
  } catch { return {} as Record<string, unknown>; }
}

export async function requireAal2() {
  const token = (await cookies()).get(authCookieNames.access)?.value;
  if (!token || decodeJwtPayload(token).aal !== "aal2") throw new AuthSecurityError("MFA_REQUIRED");
}

export function isMfaRequiredRole(role: AppRole) {
  return role === "SUPER_ADMIN" || role === "ADMIN";
}

export function shouldChallengeMfa(user: Pick<AppUser, "role" | "mfaEnabled">) {
  return isMfaRequiredRole(user.role) || user.mfaEnabled;
}

export function nextAuthenticatedPath(user: AppUser) {
  if (user.mustChangePassword) return "/change-password";
  if (shouldChallengeMfa(user) && user.aal !== "aal2") {
    return user.mfaEnabled ? "/mfa-challenge" : "/mfa-setup";
  }
  return "/dashboard";
}

export function userFromSupabase(payload: Record<string, unknown>): AppUser | null {
  const metadata = (payload.user_metadata ?? {}) as Record<string, unknown>;
  const appMetadata = (payload.app_metadata ?? {}) as Record<string, unknown>;
  const englishName = String(metadata.english_name ?? metadata.full_name ?? "CRM User");
  const chineseName = String(metadata.chinese_name ?? "");
  const username = String(metadata.username ?? "");
  const role = String(appMetadata.role ?? "").toUpperCase();
  const accountStatus = String(appMetadata.account_status ?? "ACTIVE").toUpperCase();
  if (!APP_ROLES.includes(role as AppRole) || accountStatus !== "ACTIVE") {
    return null;
  }
  return {
    id: String(payload.id ?? ""),
    username,
    email: String(payload.email ?? ""),
    displayName: englishName,
    displayNameZh: chineseName,
    role: role as AppUser["role"],
    initials: englishName
      .split(/\s+/)
      .map((part) => part[0])
      .join("")
      .slice(0, 2)
      .toUpperCase(),
    mustChangePassword: false,
    mfaEnabled: Array.isArray(payload.factors) && payload.factors.some((factor) => (factor as { status?: string }).status === "verified"),
    aal: "aal1",
    emailVerified: Boolean(payload.email_confirmed_at),
    accountStatus: "ACTIVE",
  };
}

export async function hydrateStaffUser(baseUser: AppUser, accessToken: string) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) return null;
  const headers = { apikey: anonKey, authorization: `Bearer ${accessToken}` };
  const [profileResponse, membershipResponse] = await Promise.all([
    fetch(`${supabaseUrl}/rest/v1/user_profiles?select=username,display_name_zh,display_name_en&user_id=eq.${encodeURIComponent(baseUser.id)}&limit=1`, { headers, cache: "no-store" }),
    fetch(`${supabaseUrl}/rest/v1/workspace_memberships?select=role,status,must_change_password&user_id=eq.${encodeURIComponent(baseUser.id)}&limit=1`, { headers, cache: "no-store" }),
  ]);
  if (!membershipResponse.ok) return null;
  const memberships = (await membershipResponse.json()) as { role?: AppRole; status?: string; must_change_password?: boolean }[];
  const membership = memberships[0];
  if (!membership || membership.status !== "ACTIVE" || membership.role !== baseUser.role) return null;
  baseUser.mustChangePassword = Boolean(membership.must_change_password);
  baseUser.aal = decodeJwtPayload(accessToken).aal === "aal2" ? "aal2" : "aal1";
  if (profileResponse.ok) {
    const profiles = (await profileResponse.json()) as { username?: string; display_name_zh?: string; display_name_en?: string }[];
    if (profiles[0]?.username) baseUser.username = profiles[0].username;
    if (profiles[0]?.display_name_zh) baseUser.displayNameZh = profiles[0].display_name_zh;
    if (profiles[0]?.display_name_en) {
      baseUser.displayName = profiles[0].display_name_en;
      baseUser.initials = profiles[0].display_name_en.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
    }
  }
  return baseUser;
}

export async function getCurrentUser(): Promise<AppUser | null> {
  const cookieStore = await cookies();
  const accessToken = cookieStore.get(authCookieNames.access)?.value;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!accessToken || !supabaseUrl || !anonKey) return null;

  try {
    const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: {
        apikey: anonKey,
        authorization: `Bearer ${accessToken}`,
      },
      cache: "no-store",
    });
    if (!response.ok) return null;
    const baseUser = userFromSupabase((await response.json()) as Record<string, unknown>);
    if (!baseUser) return null;
    return hydrateStaffUser(baseUser, accessToken);
  } catch {
    return null;
  }
}

export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) {
    const cookieStore = await cookies();
    if (cookieStore.has(authCookieNames.refresh)) {
      redirect("/api/auth/refresh?returnTo=/dashboard");
    }
    redirect("/login");
  }
  return user;
}

export async function requireRole(...roles: AppRole[]) {
  const user = await requireUser();
  if (!roles.includes(user.role)) redirect("/dashboard");
  return user;
}

export async function requireCapability(capability: Capability) {
  const user = await requireUser();
  if (!hasCapability(user.role, capability)) redirect("/dashboard");
  return user;
}

export async function redirectAuthenticatedUser() {
  const user = await getCurrentUser();
  if (user) redirect(nextAuthenticatedPath(user));
  const cookieStore = await cookies();
  if (cookieStore.has(authCookieNames.refresh)) {
    redirect("/api/auth/refresh?returnTo=/dashboard");
  }
}
