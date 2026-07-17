import { NextResponse } from "next/server";
import { passwordResetRequestSchema } from "@/lib/validation";
import { mutationIsTrusted } from "@/lib/request-security";
import { ApiError, apiRoute } from "@/lib/api";

async function post(request: Request) {
  if (!mutationIsTrusted(request)) throw new ApiError("UNTRUSTED_ORIGIN", 403);
  const parsed = passwordResetRequestSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    throw new ApiError(parsed.error.issues[0]?.message ?? "INVALID_EMAIL", 400, "INVALID_EMAIL", { field: "email" });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) {
    throw new ApiError("AUTH_NOT_CONFIGURED", 503);
  }

  const origin = process.env.APP_URL?.replace(/\/$/, "") ?? new URL(request.url).origin;
  try {
    const upstream = await fetch(`${supabaseUrl}/auth/v1/recover?redirect_to=${encodeURIComponent(`${origin}/reset-password`)}`, {
      method: "POST",
      headers: { apikey: anonKey, "content-type": "application/json" },
      body: JSON.stringify({ email: parsed.data.email }),
    });
    if (upstream.status >= 500 || upstream.status === 429) throw new Error("AUTH_UNAVAILABLE");
  } catch {
    throw new ApiError("AUTH_UNAVAILABLE", 502);
  }

  return NextResponse.json({
    ok: true,
    code: "RESET_SENT",
  });
}

export const POST = apiRoute(post, "PASSWORD_RESET_FAILED");
