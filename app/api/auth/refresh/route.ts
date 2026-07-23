import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { authCookieNames, userFromSupabase } from "@/lib/auth";
import { clearAuthSessionCookies, setAuthSessionCookies } from "@/lib/auth-session";

function safeReturnTo(value: string | null) {
  return value?.startsWith("/") && !value.startsWith("//") ? value : "/dashboard";
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const returnTo = safeReturnTo(requestUrl.searchParams.get("returnTo"));
  const jsonMode = requestUrl.searchParams.get("mode") === "json"
    || request.headers.get("accept")?.includes("application/json");
  const cookieStore = await cookies();
  const refreshToken = cookieStore.get(authCookieNames.refresh)?.value;
  const persistent = cookieStore.get(authCookieNames.persistence)?.value === "1";
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!refreshToken || !supabaseUrl || !anonKey) {
    const response = jsonMode
      ? NextResponse.json({ code: "AUTH_REQUIRED", error: { code: "AUTH_REQUIRED", message: "AUTH_REQUIRED", requestId: crypto.randomUUID() } }, { status: 401 })
      : NextResponse.redirect(new URL("/login", requestUrl));
    response.headers.set("cache-control", "no-store");
    return response;
  }

  try {
    const upstream = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
      method: "POST",
      headers: { apikey: anonKey, "content-type": "application/json" },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    const result = (await upstream.json()) as Record<string, unknown>;
    const authorizedUser = userFromSupabase((result.user ?? {}) as Record<string, unknown>);
    if (!upstream.ok || !authorizedUser) throw new Error("Session refresh rejected");

    const response = jsonMode
      ? NextResponse.json({ ok: true })
      : NextResponse.redirect(new URL(returnTo, requestUrl));
    setAuthSessionCookies(response, {
      access_token: String(result.access_token),
      refresh_token: String(result.refresh_token),
      expires_in: Number(result.expires_in ?? 3600),
    }, persistent);
    response.headers.set("cache-control", "no-store");
    return response;
  } catch {
    const response = jsonMode
      ? NextResponse.json({ code: "SESSION_REFRESH_FAILED", error: { code: "SESSION_REFRESH_FAILED", message: "SESSION_REFRESH_FAILED", requestId: crypto.randomUUID() } }, { status: 401 })
      : NextResponse.redirect(new URL("/login", requestUrl));
    clearAuthSessionCookies(response);
    response.headers.set("cache-control", "no-store");
    return response;
  }
}
