import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { authCookieNames } from "@/lib/auth";
import {
  clearAuthSessionCookies,
  persistentSessionMaxAge,
  setAuthSessionCookies,
} from "@/lib/auth-session";
import {
  csrfCookieName,
  loadSession,
  rotateSessionToken,
} from "@/lib/auth/session-store";
import { applicationOrigin } from "@/lib/application-origin.mjs";
import { safeRelativeReturnTo } from "@/lib/return-to";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const returnTo = safeRelativeReturnTo(requestUrl.searchParams.get("returnTo"));
  const jsonMode = requestUrl.searchParams.get("mode") === "json"
    || request.headers.get("accept")?.includes("application/json");
  const cookieStore = await cookies();
  const token = cookieStore.get(authCookieNames.session)?.value;
  const session = await loadSession(token).catch(() => null);
  if (!session) {
    const response = jsonMode
      ? NextResponse.json({
          code: "AUTH_REQUIRED",
          error: { code: "AUTH_REQUIRED", message: "AUTH_REQUIRED", requestId: crypto.randomUUID() },
        }, { status: 401 })
      : NextResponse.redirect(new URL("/login", applicationOrigin(request.url)));
    clearAuthSessionCookies(response);
    response.headers.set("cache-control", "no-store");
    return response;
  }
  const response = jsonMode
    ? NextResponse.json({ ok: true })
    : NextResponse.redirect(new URL(returnTo, applicationOrigin(request.url)));
  const nextToken = await rotateSessionToken(session.token);
  const csrfToken = cookieStore.get(csrfCookieName)?.value;
  if (!nextToken || !csrfToken) {
    const failed = jsonMode
      ? NextResponse.json({
          code: "AUTH_REQUIRED",
          error: { code: "AUTH_REQUIRED", message: "AUTH_REQUIRED", requestId: crypto.randomUUID() },
        }, { status: 401 })
      : NextResponse.redirect(new URL("/login", applicationOrigin(request.url)));
    clearAuthSessionCookies(failed);
    failed.headers.set("cache-control", "no-store");
    return failed;
  }
  setAuthSessionCookies(response, {
    token: nextToken,
    csrfToken,
    maxAge: cookieStore.get(authCookieNames.persistence)
      ? persistentSessionMaxAge
      : 60 * 60 * 12,
  });
  response.headers.set("cache-control", "no-store");
  return response;
}
