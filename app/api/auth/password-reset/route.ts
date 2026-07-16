import { NextResponse } from "next/server";
import { passwordResetRequestSchema } from "@/lib/validation";

export async function POST(request: Request) {
  const parsed = passwordResetRequestSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { code: parsed.error.issues[0]?.message ?? "INVALID_EMAIL", field: "email" },
      { status: 400 },
    );
  }

  if (process.env.CRM_DEMO_MODE === "true") {
    return NextResponse.json({ ok: true, code: "RESET_SENT" });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) {
    return NextResponse.json(
      { code: "AUTH_NOT_CONFIGURED" },
      { status: 503 },
    );
  }

  const origin = process.env.APP_URL?.replace(/\/$/, "") ?? new URL(request.url).origin;
  try {
    await fetch(`${supabaseUrl}/auth/v1/recover?redirect_to=${encodeURIComponent(`${origin}/reset-password`)}`, {
      method: "POST",
      headers: { apikey: anonKey, "content-type": "application/json" },
      body: JSON.stringify({ email: parsed.data.email }),
    });
  } catch {
    return NextResponse.json(
      { code: "AUTH_UNAVAILABLE" },
      { status: 502 },
    );
  }

  return NextResponse.json({
    ok: true,
    code: "RESET_SENT",
  });
}
