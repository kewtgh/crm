import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { authCookieNames } from "@/lib/auth";
import { getAccessToken, supabaseJson } from "@/lib/supabase-server";
import { mutationIsTrusted } from "@/lib/request-security";

const schema = z.object({ currentPassword: z.string().min(1), newPassword: z.string().min(10).max(128) });

export async function POST(request: Request) {
  if (!mutationIsTrusted(request)) return NextResponse.json({ code: "UNTRUSTED_ORIGIN" }, { status: 403 });
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ code: "INVALID_PASSWORD" }, { status: 400 });
  const user = await requireUser();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL; const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return NextResponse.json({ code: "AUTH_NOT_CONFIGURED" }, { status: 503 });
  const verification = await fetch(`${url}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: key, "content-type": "application/json" }, body: JSON.stringify({ email: user.email, password: parsed.data.currentPassword }), cache: "no-store" });
  if (!verification.ok) return NextResponse.json({ code: "CURRENT_PASSWORD_INCORRECT" }, { status: 400 });
  try {
    await supabaseJson("/auth/v1/user", { method: "PUT", body: JSON.stringify({ password: parsed.data.newPassword }) }, await getAccessToken());
    const response = NextResponse.json({ ok: true });
    response.cookies.delete(authCookieNames.refresh);
    return response;
  } catch { return NextResponse.json({ code: "PASSWORD_UPDATE_FAILED" }, { status: 500 }); }
}
