import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { hasCapability, type Capability } from "./capabilities";
import { loadSession, sessionCookieName } from "./auth/session-store";
import type { AppRole } from "./roles";
import type { AppUser } from "./user";

export type { AppRole } from "./roles";
export type { AppUser } from "./user";

export const authCookieNames = {
  session: sessionCookieName,
  csrf: "crm_csrf",
  persistence: "crm_session_persistent",
} as const;

export class AuthSecurityError extends Error {
  constructor(public code: string, public status = 403) {
    super(code);
  }
}

async function loadCurrentSession() {
  const token = (await cookies()).get(authCookieNames.session)?.value;
  return loadSession(token);
}

export const getCurrentSession = cache(loadCurrentSession);

async function loadCurrentUser(): Promise<AppUser | null> {
  return (await getCurrentSession())?.user ?? null;
}

export const getCurrentUser = cache(loadCurrentUser);

export async function requireAal2() {
  const user = await getCurrentUser();
  if (!user || user.aal !== "aal2") throw new AuthSecurityError("MFA_REQUIRED");
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

export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
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
}
