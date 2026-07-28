import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { authCookieNames } from "@/lib/auth";
import { clearAuthSessionCookies } from "@/lib/auth-session";
import { revokeSession } from "@/lib/auth/session-store";
import { applicationOrigin } from "@/lib/application-origin.mjs";
import { apiErrorResponse } from "@/lib/api";
import { mutationIsTrusted } from "@/lib/request-security";
import { securityCookieNames } from "@/lib/trusted-devices";

export async function POST(request: Request) {
  if (!mutationIsTrusted(request)) return apiErrorResponse("UNTRUSTED_ORIGIN", 403);
  const token = (await cookies()).get(authCookieNames.session)?.value;
  if (token) await revokeSession(token, "LOGOUT").catch(() => undefined);
  const response = NextResponse.redirect(new URL("/login", applicationOrigin(request.url)), 303);
  clearAuthSessionCookies(response);
  response.cookies.set(securityCookieNames.pendingDeviceVerification, "", { path: "/", maxAge: 0 });
  response.cookies.set(securityCookieNames.mfaRemember, "", { path: "/api/settings/mfa", maxAge: 0 });
  response.headers.set("cache-control", "no-store");
  return response;
}
