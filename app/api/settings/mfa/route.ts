import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { getAccessToken, supabaseJson, supabaseRequest } from "@/lib/supabase-server";

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("enroll") }),
  z.object({ action: z.literal("challenge"), factorId: z.string().uuid() }),
  z.object({ action: z.literal("verify"), factorId: z.string().uuid(), challengeId: z.string().uuid(), code: z.string().regex(/^\d{6}$/) }),
  z.object({ action: z.literal("unenroll"), factorId: z.string().uuid() }),
]);

export async function GET() {
  try {
    await requireUser();
    const user = await supabaseJson<{ factors?: Array<{ id: string; factor_type: string; status: string; friendly_name?: string; created_at?: string }> }>("/auth/v1/user", {}, await getAccessToken());
    return NextResponse.json({ factors: user.factors ?? [] });
  } catch { return NextResponse.json({ code: "MFA_LOAD_FAILED" }, { status: 500 }); }
}

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ code: "INVALID_MFA_REQUEST" }, { status: 400 });
  await requireUser(); const token = await getAccessToken();
  try {
    if (parsed.data.action === "enroll") {
      const factor = await supabaseJson("/auth/v1/factors", { method: "POST", body: JSON.stringify({ factor_type: "totp", friendly_name: "Lumina CRM" }) }, token);
      return NextResponse.json({ factor });
    }
    if (parsed.data.action === "challenge") {
      const challenge = await supabaseJson(`/auth/v1/factors/${parsed.data.factorId}/challenge`, { method: "POST", body: "{}" }, token);
      return NextResponse.json({ challenge });
    }
    if (parsed.data.action === "verify") {
      await supabaseJson(`/auth/v1/factors/${parsed.data.factorId}/verify`, { method: "POST", body: JSON.stringify({ challenge_id: parsed.data.challengeId, code: parsed.data.code }) }, token);
      return NextResponse.json({ ok: true });
    }
    await supabaseRequest(`/auth/v1/factors/${parsed.data.factorId}`, { method: "DELETE" }, token);
    return NextResponse.json({ ok: true });
  } catch { return NextResponse.json({ code: "MFA_OPERATION_FAILED" }, { status: 400 }); }
}
