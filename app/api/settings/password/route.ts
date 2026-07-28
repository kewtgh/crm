import { NextResponse } from "next/server";
import { z } from "zod";
import { apiRoute, requireApiUser } from "@/lib/api";
import { clearAuthSessionCookies } from "@/lib/auth-session";
import { authenticateAccount, updateAccountPassword } from "@/lib/auth/accounts";
import { mutationIsTrusted } from "@/lib/request-security";
import { revokeUserTrustedDevices, securityCookieNames } from "@/lib/trusted-devices";
import { passwordValueSchema } from "@/lib/validation";

const schema = z.object({
  currentPassword: z.string().min(1),
  newPassword: passwordValueSchema,
});

async function post(request: Request) {
  if (!mutationIsTrusted(request)) return NextResponse.json({ code: "UNTRUSTED_ORIGIN" }, { status: 403 });
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ code: "INVALID_PASSWORD" }, { status: 400 });
  const user = await requireApiUser();
  const verified = await authenticateAccount(user.email, parsed.data.currentPassword);
  if (!verified || verified.id !== user.id) {
    return NextResponse.json({ code: "CURRENT_PASSWORD_INCORRECT" }, { status: 400 });
  }
  await updateAccountPassword(user.id, parsed.data.newPassword, {
    clearMustChange: true,
    revokeSessions: true,
  });
  const trustedDevicesRevoked = await revokeUserTrustedDevices(user.id, "PASSWORD_CHANGED")
    .then(() => true)
    .catch(() => false);
  const response = NextResponse.json({
    ok: true,
    reauthenticate: true,
    trustedDevicesRevoked,
    sessionsRevoked: true,
  });
  clearAuthSessionCookies(response);
  response.cookies.set(securityCookieNames.trustedDevice, "", { path: "/", maxAge: 0 });
  response.cookies.set(securityCookieNames.pendingDeviceVerification, "", { path: "/", maxAge: 0 });
  response.cookies.set(securityCookieNames.mfaRemember, "", { path: "/api/settings/mfa", maxAge: 0 });
  return response;
}

export const POST = apiRoute(post, "PASSWORD_UPDATE_FAILED");
