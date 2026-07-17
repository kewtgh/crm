import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { authCookieNames, userFromSupabase } from "@/lib/auth";

function safeReturnTo(value: string | null) {
  return value?.startsWith("/") && !value.startsWith("//") ? value : "/dashboard";
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const returnTo = safeReturnTo(requestUrl.searchParams.get("returnTo"));
  const jsonMode = requestUrl.searchParams.get("mode") === "json"
    || request.headers.get("accept")?.includes("application/json");
  const refreshToken = (await cookies()).get(authCookieNames.refresh)?.value;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!refreshToken || !supabaseUrl || !anonKey) {
    return jsonMode
      ? NextResponse.json({ code: "AUTH_REQUIRED", error: { code: "AUTH_REQUIRED", message: "AUTH_REQUIRED", requestId: crypto.randomUUID() } }, { status: 401 })
      : NextResponse.redirect(new URL("/login", requestUrl));
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
    const cookieBase = {
      httpOnly: true,
      sameSite: "lax" as const,
      secure: process.env.NODE_ENV === "production",
      path: "/",
    };
    response.cookies.set(authCookieNames.access, String(result.access_token), {
      ...cookieBase,
      maxAge: Number(result.expires_in ?? 3600),
    });
    response.cookies.set(authCookieNames.refresh, String(result.refresh_token), {
      ...cookieBase,
      maxAge: 60 * 60 * 24 * 30,
    });
    return response;
  } catch {
    const response = jsonMode
      ? NextResponse.json({ code: "SESSION_REFRESH_FAILED", error: { code: "SESSION_REFRESH_FAILED", message: "SESSION_REFRESH_FAILED", requestId: crypto.randomUUID() } }, { status: 401 })
      : NextResponse.redirect(new URL("/login", requestUrl));
    response.cookies.delete(authCookieNames.access);
    response.cookies.delete(authCookieNames.refresh);
    return response;
  }
}
