import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import QRCode from "qrcode";
import { isMfaRequiredRole } from "@/lib/auth";
import { apiRoute, requireApiAal2, requireApiUser } from "@/lib/api";
import { getAccessToken, supabaseJson, supabaseRequest, SupabaseRequestError } from "@/lib/supabase-server";
import { mutationIsTrusted } from "@/lib/request-security";
import { revokeUserTrustedDevices, securityCookieNames } from "@/lib/trusted-devices";
import { setAuthSessionCookies } from "@/lib/auth-session";
import { consumeMfaRecoveryCode, countMfaRecoveryCodes, replaceMfaRecoveryCodes } from "@/lib/mfa-recovery";

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("enroll") }),
  z.object({ action: z.literal("challenge"), factorId: z.string().uuid() }),
  z.object({ action: z.literal("verify"), factorId: z.string().uuid(), challengeId: z.string().uuid(), code: z.string().regex(/^\d{6}$/) }),
  z.object({ action: z.literal("recover"), code: z.string().trim().regex(/^[A-Za-z0-9-]{12,20}$/) }),
  z.object({ action: z.literal("rotateRecovery") }),
  z.object({ action: z.literal("unenroll"), factorId: z.string().uuid() }),
]);

type MfaFactor = { id: string; factor_type: string; status: string; friendly_name?: string; created_at?: string };
type MfaIdentity = { factors?: MfaFactor[] };

async function loadFactors(token: string | null | undefined) {
  const identity = await supabaseJson<MfaIdentity>("/auth/v1/user", {}, token);
  return identity.factors ?? [];
}

async function deleteFactor(factorId: string, token: string | null | undefined) {
  await supabaseRequest(`/auth/v1/factors/${encodeURIComponent(factorId)}`, { method: "DELETE" }, token);
}

async function get() {
  const user = await requireApiUser();
  try {
    const token = await getAccessToken();
    const [factors, recoveryCodesRemaining] = await Promise.all([
      loadFactors(token),
      countMfaRecoveryCodes(user.id, token).catch(() => 0),
    ]);
    return NextResponse.json({ factors, recoveryCodesRemaining });
  } catch { return NextResponse.json({ code: "MFA_LOAD_FAILED" }, { status: 500 }); }
}

async function post(request: Request) {
  if (!mutationIsTrusted(request)) return NextResponse.json({ code: "UNTRUSTED_ORIGIN" }, { status: 403 });
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ code: "INVALID_MFA_REQUEST" }, { status: 400 });
  const user = await requireApiUser(); const token = await getAccessToken();
  try {
    if (parsed.data.action === "enroll") {
      const staleFactors = (await loadFactors(token)).filter((factor) => factor.factor_type === "totp" && factor.status !== "verified");
      for (const factor of staleFactors) await deleteFactor(factor.id, token);
      const factor = await supabaseJson<{ id: string; totp?: { qr_code?: string; secret?: string } }>("/auth/v1/factors", { method: "POST", body: JSON.stringify({ factor_type: "totp", friendly_name: "Lumina CRM" }) }, token);
      try {
        const challenge = await supabaseJson<{ id?: string }>(`/auth/v1/factors/${factor.id}/challenge`, { method: "POST", body: "{}" }, token);
        if (!challenge.id) throw new Error("MFA_CHALLENGE_MISSING");
        if (factor.totp?.secret) {
          const issuer = "Weiai Education";
          const label = `${issuer}:${user.email}`;
          const uri = `otpauth://totp/${encodeURIComponent(label)}?secret=${encodeURIComponent(factor.totp.secret)}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
          factor.totp.qr_code = await QRCode.toDataURL(uri, { errorCorrectionLevel: "M", margin: 2, width: 240 });
        }
        return NextResponse.json({ factor, challenge });
      } catch (error) {
        await deleteFactor(factor.id, token).catch(() => undefined);
        throw error;
      }
    }
    if (parsed.data.action === "challenge") {
      const challenge = await supabaseJson(`/auth/v1/factors/${parsed.data.factorId}/challenge`, { method: "POST", body: "{}" }, token);
      return NextResponse.json({ challenge });
    }
    if (parsed.data.action === "verify") {
      const factorId=parsed.data.factorId;
      const currentFactor = (await loadFactors(token)).find((factor) => factor.id === factorId);
      const enrollmentVerification = currentFactor?.status !== "verified";
      const session = await supabaseJson<{ access_token?: string; refresh_token?: string; expires_in?: number }>(`/auth/v1/factors/${factorId}/verify`, { method: "POST", body: JSON.stringify({ challenge_id: parsed.data.challengeId, code: parsed.data.code }) }, token);
      const recoveryCodes = enrollmentVerification
        ? await replaceMfaRecoveryCodes(user.id, session.access_token ?? token)
        : undefined;
      const response = NextResponse.json({ ok: true, next: "/dashboard", recoveryCodes });
      const cookieBase = { httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/" };
      const remember = (await cookies()).get(securityCookieNames.mfaRemember)?.value === "1";
      setAuthSessionCookies(response, session, remember);
      await revokeUserTrustedDevices(user.id, "MFA_VERIFIED").catch(() => undefined);
      response.cookies.delete(securityCookieNames.trustedDevice);
      response.cookies.set(securityCookieNames.mfaRemember, "", {
        ...cookieBase,
        path: "/api/settings/mfa",
        maxAge: 0,
      });
      return response;
    }
    if (parsed.data.action === "rotateRecovery") {
      await requireApiAal2();
      const verified = (await loadFactors(token)).some((factor) => factor.factor_type === "totp" && factor.status === "verified");
      if (!verified) return NextResponse.json({ code: "MFA_FACTOR_NOT_FOUND" }, { status: 404 });
      return NextResponse.json({ recoveryCodes: await replaceMfaRecoveryCodes(user.id, token) });
    }
    if (parsed.data.action === "recover") {
      if (!await consumeMfaRecoveryCode(user.id, parsed.data.code, token)) {
        return NextResponse.json({ code: "MFA_RECOVERY_INVALID" }, { status: 400 });
      }
      const verifiedFactors = (await loadFactors(token)).filter((factor) => factor.factor_type === "totp" && factor.status === "verified");
      for (const factor of verifiedFactors) await deleteFactor(factor.id, token);
      await revokeUserTrustedDevices(user.id, "MFA_RECOVERY_USED").catch(() => undefined);
      const response = NextResponse.json({ ok: true, next: isMfaRequiredRole(user.role) ? "/mfa-setup" : "/dashboard" });
      response.cookies.delete(securityCookieNames.trustedDevice);
      return response;
    }
    if (parsed.data.action !== "unenroll") return NextResponse.json({ code: "INVALID_MFA_REQUEST" }, { status: 400 });
    const factorId = parsed.data.factorId;
    const factor = (await loadFactors(token)).find((entry) => entry.id === factorId);
    if (!factor) return NextResponse.json({ code: "MFA_FACTOR_NOT_FOUND" }, { status: 404 });
    if (factor.status === "verified" && isMfaRequiredRole(user.role)) return NextResponse.json({ code: "MFA_REQUIRED_FOR_ROLE" }, { status: 409 });
    await deleteFactor(factor.id, token);
    return NextResponse.json({ ok: true });
  } catch(error) {
    const upstream=error as Partial<SupabaseRequestError>|null;
    const code=typeof upstream?.code==="string"?upstream.code:"MFA_OPERATION_FAILED";
    const status=typeof upstream?.status==="number"&&upstream.status>=400&&upstream.status<500?upstream.status:400;
    return NextResponse.json({code},{status});
  }
}
export const GET=apiRoute(get,"MFA_LOAD_FAILED");
export const POST=apiRoute(post,"MFA_OPERATION_FAILED");
