import { NextResponse } from "next/server";
import { registerSchema } from "@/lib/validation";

async function verifyTurnstile(token: string | undefined, remoteIp: string | null) {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return process.env.CRM_DEMO_MODE === "true";
  if (!token) return false;
  const body = new FormData();
  body.set("secret", secret);
  body.set("response", token);
  if (remoteIp) body.set("remoteip", remoteIp);
  const response = await fetch(
    "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    { method: "POST", body },
  );
  const result = (await response.json()) as { success?: boolean; action?: string; hostname?: string };
  const expectedHostname = process.env.TURNSTILE_EXPECTED_HOSTNAME;
  return result.success === true
    && result.action === "guardian_registration"
    && (!expectedHostname || result.hostname === expectedHostname);
}

export async function POST(request: Request) {
  const parsed = registerSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: parsed.error.issues[0]?.message ?? "注册信息无效",
        field: String(parsed.error.issues[0]?.path[0] ?? "form"),
      },
      { status: 400 },
    );
  }

  const validChallenge = await verifyTurnstile(
    parsed.data.turnstileToken,
    request.headers.get("cf-connecting-ip"),
  );
  if (!validChallenge) {
    return NextResponse.json(
      {
        error: "验证已失效，请重新完成验证 / Verification expired, please try again",
        code: "TURNSTILE_FAILED",
      },
      { status: 400 },
    );
  }

  if (process.env.CRM_DEMO_MODE === "true") {
    return NextResponse.json({
      ok: true,
      message: "申请已提交，管理员将在 1 个工作日内审核。",
    });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) {
    return NextResponse.json(
      { error: "认证服务尚未配置，请联系管理员 / Authentication is not configured" },
      { status: 503 },
    );
  }

  const response = await fetch(`${supabaseUrl}/auth/v1/signup`, {
    method: "POST",
    headers: { apikey: anonKey, "content-type": "application/json" },
    body: JSON.stringify({
      email: parsed.data.email,
      password: parsed.data.password,
      data: {
        chinese_name: parsed.data.chineseName,
        english_name: parsed.data.englishName,
        registration_type: "guardian",
        account_status: "PENDING_VERIFICATION",
      },
    }),
  });
  const result = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    const duplicate = String(result.msg ?? result.message ?? "").toLowerCase().includes("registered");
    return NextResponse.json(
      {
        error: duplicate
          ? "此邮箱已注册，请直接登录 / This email is already registered"
          : "注册暂时无法完成，请稍后重试 / Registration is temporarily unavailable",
      },
      { status: duplicate ? 409 : 502 },
    );
  }
  return NextResponse.json({
    ok: true,
    message: "请查收验证邮件。完成邮箱验证后，申请将进入管理员审核。",
  });
}
