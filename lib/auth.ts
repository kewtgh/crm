import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export type AppUser = {
  id: string;
  username: string;
  email: string;
  displayName: string;
  displayNameZh: string;
  role: "ADMIN" | "SALES" | "OPERATIONS";
  initials: string;
};

export type AppRole = AppUser["role"];

const demoUser: AppUser = {
  id: "demo-admin",
  username: "olivia.admin",
  email: "admin@lumina-edu.com",
  displayName: "Olivia Chen",
  displayNameZh: "陈雅雯",
  role: "ADMIN",
  initials: "OC",
};

export const authCookieNames = {
  access: "crm_access_token",
  refresh: "crm_refresh_token",
  demo: "crm_demo_session",
} as const;

export function userFromSupabase(payload: Record<string, unknown>): AppUser | null {
  const metadata = (payload.user_metadata ?? {}) as Record<string, unknown>;
  const appMetadata = (payload.app_metadata ?? {}) as Record<string, unknown>;
  const englishName = String(metadata.english_name ?? metadata.full_name ?? "CRM User");
  const chineseName = String(metadata.chinese_name ?? "");
  const username = String(metadata.username ?? "");
  const role = String(appMetadata.role ?? "").toUpperCase();
  const accountStatus = String(appMetadata.account_status ?? "ACTIVE").toUpperCase();
  if (!["ADMIN", "SALES", "OPERATIONS"].includes(role) || accountStatus !== "ACTIVE") {
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
  };
}

export async function getCurrentUser(): Promise<AppUser | null> {
  const cookieStore = await cookies();
  const demoSession = cookieStore.get(authCookieNames.demo)?.value;
  if (process.env.CRM_DEMO_MODE === "true" && demoSession === "demo-admin") {
    return demoUser;
  }

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
    const profileResponse = await fetch(`${supabaseUrl}/rest/v1/user_profiles?select=username&user_id=eq.${encodeURIComponent(baseUser.id)}&limit=1`, {
      headers: { apikey: anonKey, authorization: `Bearer ${accessToken}` }, cache: "no-store",
    });
    if (profileResponse.ok) {
      const profiles = (await profileResponse.json()) as { username?: string }[];
      if (profiles[0]?.username) baseUser.username = profiles[0].username;
    }
    return baseUser;
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

export async function redirectAuthenticatedUser() {
  const user = await getCurrentUser();
  if (user) redirect("/dashboard");
  const cookieStore = await cookies();
  if (cookieStore.has(authCookieNames.refresh)) {
    redirect("/api/auth/refresh?returnTo=/dashboard");
  }
}
