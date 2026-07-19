import { NextResponse } from "next/server";
import { apiRoute, requireApiUser } from "@/lib/api";
import { getAccessToken, supabaseRequest } from "@/lib/supabase-server";
import { mutationIsTrusted } from "@/lib/request-security";
import { cookies } from "next/headers";
import { revokeOtherTrustedDevices, securityCookieNames } from "@/lib/trusted-devices";

async function del(request: Request) {
  if (!mutationIsTrusted(request)) return NextResponse.json({ code: "UNTRUSTED_ORIGIN" }, { status: 403 });
  await requireApiUser();
  try {
    const token = await getAccessToken();
    await supabaseRequest("/auth/v1/logout?scope=others", { method: "POST" }, token);
    const cookieStore = await cookies();
    if (token) await revokeOtherTrustedDevices(
      token,
      cookieStore.get(securityCookieNames.trustedDevice)?.value,
    );
    return NextResponse.json({ ok: true });
  }
  catch { return NextResponse.json({ code: "SESSION_REVOKE_FAILED" }, { status: 500 }); }
}
export const DELETE=apiRoute(del,"SESSION_REVOKE_FAILED");
