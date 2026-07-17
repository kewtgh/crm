import { NextResponse } from "next/server";
import { apiRoute, requireApiUser } from "@/lib/api";
import { getAccessToken, supabaseRequest } from "@/lib/supabase-server";
import { mutationIsTrusted } from "@/lib/request-security";

async function del(request: Request) {
  if (!mutationIsTrusted(request)) return NextResponse.json({ code: "UNTRUSTED_ORIGIN" }, { status: 403 });
  await requireApiUser();
  try { await supabaseRequest("/auth/v1/logout?scope=others", { method: "POST" }, await getAccessToken()); return NextResponse.json({ ok: true }); }
  catch { return NextResponse.json({ code: "SESSION_REVOKE_FAILED" }, { status: 500 }); }
}
export const DELETE=apiRoute(del,"SESSION_REVOKE_FAILED");
