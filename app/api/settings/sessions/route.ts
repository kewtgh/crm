import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { getAccessToken, supabaseRequest } from "@/lib/supabase-server";
import { mutationIsTrusted } from "@/lib/request-security";

export async function DELETE(request: Request) {
  if (!mutationIsTrusted(request)) return NextResponse.json({ code: "UNTRUSTED_ORIGIN" }, { status: 403 });
  await requireUser();
  try { await supabaseRequest("/auth/v1/logout?scope=others", { method: "POST" }, await getAccessToken()); return NextResponse.json({ ok: true }); }
  catch { return NextResponse.json({ code: "SESSION_REVOKE_FAILED" }, { status: 500 }); }
}
