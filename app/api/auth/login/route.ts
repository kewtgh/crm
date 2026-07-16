import { NextResponse } from "next/server";
import { authCookieNames, userFromSupabase } from "@/lib/auth";
import { loginSchema } from "@/lib/validation";

export async function POST(request: Request) {
  const parsed = loginSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { code: parsed.error.issues[0]?.message ?? "INVALID_INPUT", field: String(parsed.error.issues[0]?.path[0] ?? "form") },
      { status: 400 },
    );
  }

  const { email, password } = parsed.data;
  if (process.env.CRM_DEMO_MODE === "true") {
    const isDemoUser =
      email.toLowerCase() === "admin@lumina-edu.com" && password === "Demo123!";
    if (!isDemoUser) {
      return NextResponse.json(
        { code: "INVALID_CREDENTIALS" },
        { status: 401 },
      );
    }
    const response = NextResponse.json({ ok: true });
    response.cookies.set(authCookieNames.demo, "demo-admin", {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 60 * 60 * 8,
      path: "/",
    });
    return response;
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) {
    return NextResponse.json(
      { code: "AUTH_NOT_CONFIGURED" },
      { status: 503 },
    );
  }

  const upstream = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: anonKey, "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const result = (await upstream.json()) as Record<string, unknown>;
  if (!upstream.ok) {
    return NextResponse.json(
      { code: "INVALID_CREDENTIALS" },
      { status: 401 },
    );
  }

  const authorizedUser = userFromSupabase((result.user ?? {}) as Record<string, unknown>);
  if (!authorizedUser) {
    return NextResponse.json(
      { code: "STAFF_ACCESS_DENIED" },
      { status: 403 },
    );
  }

  const response = NextResponse.json({ ok: true });
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
}
