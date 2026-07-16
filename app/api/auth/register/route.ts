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
        code: parsed.error.issues[0]?.message ?? "INVALID_INPUT",
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
        code: "TURNSTILE_FAILED",
      },
      { status: 400 },
    );
  }

  if (process.env.CRM_DEMO_MODE === "true") {
    if (["admin", "olivia.admin", "system", "support"].includes(parsed.data.username)) {
      return NextResponse.json({ code: "USERNAME_TAKEN", field: "username" }, { status: 409 });
    }
    return NextResponse.json({
      ok: true,
      code: "REGISTRATION_SUBMITTED",
    });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) {
    return NextResponse.json(
      { code: "AUTH_NOT_CONFIGURED" },
      { status: 503 },
    );
  }

  const usernameCheck = await fetch(`${supabaseUrl}/rest/v1/rpc/username_available`, {
    method: "POST",
    headers: { apikey: anonKey, authorization: `Bearer ${anonKey}`, "content-type": "application/json" },
    body: JSON.stringify({ candidate: parsed.data.username }),
  }).catch(() => null);
  if (!usernameCheck?.ok) return NextResponse.json({ code: "USERNAME_CHECK_UNAVAILABLE", field: "username" }, { status: 503 });
  if ((await usernameCheck.json()) !== true) return NextResponse.json({ code: "USERNAME_TAKEN", field: "username" }, { status: 409 });

  const response = await fetch(`${supabaseUrl}/auth/v1/signup`, {
    method: "POST",
    headers: { apikey: anonKey, "content-type": "application/json" },
    body: JSON.stringify({
      email: parsed.data.email,
      password: parsed.data.password,
      data: {
        username: parsed.data.username,
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
        code: duplicate ? "DUPLICATE" : "REGISTRATION_UNAVAILABLE",
      },
      { status: duplicate ? 409 : 502 },
    );
  }
  return NextResponse.json({
    ok: true,
    code: "REGISTRATION_SUBMITTED",
  });
}
