import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { getAccessToken, supabaseRequest } from "@/lib/supabase-server";

export async function DELETE() {
  await requireUser();
  try { await supabaseRequest("/auth/v1/logout?scope=others", { method: "POST" }, await getAccessToken()); return NextResponse.json({ ok: true }); }
  catch { return NextResponse.json({ code: "SESSION_REVOKE_FAILED" }, { status: 500 }); }
}
