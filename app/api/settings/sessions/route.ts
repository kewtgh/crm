import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { apiRoute, requireApiUser } from "@/lib/api";
import { authCookieNames } from "@/lib/auth";
import { revokeOtherSessions } from "@/lib/auth/session-store";
import { mutationIsTrusted } from "@/lib/request-security";
import { revokeOtherTrustedDevices, securityCookieNames } from "@/lib/trusted-devices";

async function del(request: Request) {
  if (!mutationIsTrusted(request)) return NextResponse.json({ code: "UNTRUSTED_ORIGIN" }, { status: 403 });
  const user = await requireApiUser();
  const cookieStore = await cookies();
  const token = cookieStore.get(authCookieNames.session)?.value;
  if (!token) return NextResponse.json({ code: "AUTH_REQUIRED" }, { status: 401 });
  try {
    await Promise.all([
      revokeOtherSessions(user.id, token),
      revokeOtherTrustedDevices(
        token,
        cookieStore.get(securityCookieNames.trustedDevice)?.value,
      ),
    ]);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ code: "SESSION_REVOKE_FAILED" }, { status: 500 });
  }
}

export const DELETE = apiRoute(del, "SESSION_REVOKE_FAILED");
