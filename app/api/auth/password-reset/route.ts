import { NextResponse } from "next/server";
import { passwordResetRequestSchema } from "@/lib/validation";

export async function POST(request: Request) {
  const parsed = passwordResetRequestSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "邮箱无效", field: "email" },
      { status: 400 },
    );
  }

  if (process.env.CRM_DEMO_MODE === "true") {
    return NextResponse.json({ ok: true, message: "如果该账号存在，重置邮件已发送。" });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) {
    return NextResponse.json(
      { error: "认证服务尚未配置，请联系管理员 / Authentication is not configured" },
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
      { error: "暂时无法连接认证服务，请稍后重试 / Authentication service unavailable" },
      { status: 502 },
    );
  }

  return NextResponse.json({
    ok: true,
    message: "如果该账号存在，重置邮件已发送。请检查收件箱和垃圾邮件。",
  });
}
