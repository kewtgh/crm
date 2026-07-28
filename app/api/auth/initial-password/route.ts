import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { nextAuthenticatedPath } from "@/lib/auth";
import { setAuthSessionCookies } from "@/lib/auth-session";
import { findAccountById, updateAccountPassword, appUserFromIdentity } from "@/lib/auth/accounts";
import { createSession } from "@/lib/auth/session-store";
import { ApiError, apiRoute, requireApiUser } from "@/lib/api";
import { mutationIsTrusted } from "@/lib/request-security";
import { revokeUserTrustedDevices, securityCookieNames } from "@/lib/trusted-devices";
import { initialPasswordSchema } from "@/lib/validation";

async function post(request: Request) {
  if (!mutationIsTrusted(request)) throw new ApiError("UNTRUSTED_ORIGIN", 403);
  const parsed = initialPasswordSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    throw new ApiError(parsed.error.issues[0]?.message ?? "INVALID_INPUT", 400, "INVALID_INPUT", {
      field: String(parsed.error.issues[0]?.path[0] ?? "form"),
    });
  }
  const user = await requireApiUser();
  if (!user.mustChangePassword) return NextResponse.json({ ok: true, next: nextAuthenticatedPath(user) });

  await updateAccountPassword(user.id, parsed.data.newPassword, {
    clearMustChange: true,
    revokeSessions: true,
  });
  const identity = await findAccountById(user.id);
  if (!identity) throw new ApiError("ACCOUNT_NOT_FOUND", 404);
  const persistent = (await cookies()).get("crm_session_persistent")?.value === "1";
  const session = await createSession({
    userId: user.id,
    passwordVersion: identity.passwordVersion,
    persistent,
    request,
  });
  await revokeUserTrustedDevices(user.id, "PASSWORD_CHANGED").catch(() => undefined);
  const updatedUser = appUserFromIdentity(identity);
  const response = NextResponse.json({ ok: true, next: nextAuthenticatedPath(updatedUser) });
  setAuthSessionCookies(response, session);
  response.cookies.set(securityCookieNames.trustedDevice, "", { path: "/", maxAge: 0 });
  return response;
}

export const POST = apiRoute(post, "PASSWORD_UPDATE_FAILED");
