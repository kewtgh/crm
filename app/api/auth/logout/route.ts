import { NextResponse } from "next/server";
import { mutationIsTrusted } from "@/lib/request-security";
import { getAccessToken, supabaseRequest } from "@/lib/supabase-server";
import { apiErrorResponse } from "@/lib/api";
import { securityCookieNames } from "@/lib/trusted-devices";
import { clearAuthSessionCookies } from "@/lib/auth-session";

export async function POST(request: Request) {
  if (!mutationIsTrusted(request)) return apiErrorResponse("UNTRUSTED_ORIGIN", 403);
  const token = await getAccessToken();
  if (token) {
    await supabaseRequest("/auth/v1/logout?scope=local", { method: "POST" }, token).catch(() => undefined);
  }
  const response = NextResponse.redirect(new URL("/login", request.url), 303);
  clearAuthSessionCookies(response);
  response.cookies.set(securityCookieNames.pendingDeviceVerification, "", { path: "/", maxAge: 0 });
  response.cookies.set(securityCookieNames.mfaRemember, "", { path: "/api/settings/mfa", maxAge: 0 });
  response.headers.set("cache-control", "no-store");
  return response;
}
