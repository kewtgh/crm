import { NextResponse } from "next/server";
import { consumeEmailToken } from "@/lib/auth/email-tokens";
import { revokeAllUserSessions } from "@/lib/auth/session-store";
import { poolQuery } from "@/lib/db/pools";
import { applicationOrigin } from "@/lib/application-origin.mjs";

export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token") ?? "";
  const consumed = await consumeEmailToken(token, "EMAIL_VERIFICATION");
  if (!consumed) {
    return NextResponse.redirect(new URL("/login?emailVerification=invalid", applicationOrigin(request.url)));
  }
  const email = typeof consumed.payload.email === "string"
    ? consumed.payload.email.trim().toLowerCase()
    : "";
  if (!email || !/^[^@\s]+@[^@\s]+$/.test(email)) {
    return NextResponse.redirect(new URL("/login?emailVerification=invalid", applicationOrigin(request.url)));
  }
  await poolQuery(
    "system",
    `update app_auth.accounts
     set email = $2, email_confirmed_at = now(), updated_at = now()
     where id = $1`,
    [consumed.user_id, email],
  );
  await revokeAllUserSessions(consumed.user_id, "EMAIL_CHANGED");
  return NextResponse.redirect(new URL("/login?emailVerification=complete", applicationOrigin(request.url)));
}
