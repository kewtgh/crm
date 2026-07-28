import { NextResponse } from "next/server";
import { z } from "zod";
import QRCode from "qrcode";
import { isMfaRequiredRole } from "@/lib/auth";
import { apiRoute, requireApiAal2, requireApiUser } from "@/lib/api";
import { getSessionToken } from "@/lib/db/gateway";
import { elevateSession } from "@/lib/auth/session-store";
import {
  deleteTotpFactor,
  enrollTotp,
  listTotpFactors,
  verifyTotp,
} from "@/lib/auth/totp";
import { mutationIsTrusted } from "@/lib/request-security";
import { revokeUserTrustedDevices, securityCookieNames } from "@/lib/trusted-devices";
import {
  consumeMfaRecoveryCode,
  countMfaRecoveryCodes,
  replaceMfaRecoveryCodes,
} from "@/lib/mfa-recovery";

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("enroll") }),
  z.object({ action: z.literal("challenge"), factorId: z.string().uuid() }),
  z.object({
    action: z.literal("verify"),
    factorId: z.string().uuid(),
    challengeId: z.string().uuid(),
    code: z.string().regex(/^\d{6}$/),
  }),
  z.object({ action: z.literal("recover"), code: z.string().trim().regex(/^[A-Za-z0-9-]{12,20}$/) }),
  z.object({ action: z.literal("rotateRecovery") }),
  z.object({ action: z.literal("unenroll"), factorId: z.string().uuid() }),
]);

async function get() {
  const user = await requireApiUser();
  const [factors, recoveryCodesRemaining] = await Promise.all([
    listTotpFactors(user.id),
    countMfaRecoveryCodes(user.id).catch(() => 0),
  ]);
  return NextResponse.json({ factors, recoveryCodesRemaining });
}

async function post(request: Request) {
  if (!mutationIsTrusted(request)) return NextResponse.json({ code: "UNTRUSTED_ORIGIN" }, { status: 403 });
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ code: "INVALID_MFA_REQUEST" }, { status: 400 });
  const data = parsed.data;
  const user = await requireApiUser();
  const token = await getSessionToken();
  if (!token) return NextResponse.json({ code: "AUTH_REQUIRED" }, { status: 401 });

  try {
    if (data.action === "enroll") {
      const factor = await enrollTotp(user.id);
      const issuer = "Weiai Education";
      const label = `${issuer}:${user.email}`;
      const uri = `otpauth://totp/${encodeURIComponent(label)}?secret=${encodeURIComponent(factor.secret)}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
      return NextResponse.json({
        factor: {
          id: factor.id,
          factor_type: "totp",
          status: "unverified",
          friendly_name: "Lumina CRM",
          totp: {
            secret: factor.secret,
            qr_code: await QRCode.toDataURL(uri, {
              errorCorrectionLevel: "M",
              margin: 2,
              width: 240,
            }),
          },
        },
        challenge: { id: crypto.randomUUID() },
      });
    }
    if (data.action === "challenge") {
      const exists = (await listTotpFactors(user.id)).some((factor) => factor.id === data.factorId);
      if (!exists) return NextResponse.json({ code: "MFA_FACTOR_NOT_FOUND" }, { status: 404 });
      return NextResponse.json({ challenge: { id: crypto.randomUUID() } });
    }
    if (data.action === "verify") {
      const factors = await listTotpFactors(user.id);
      const factor = factors.find((entry) => entry.id === data.factorId);
      const enrollmentVerification = factor?.status !== "verified";
      if (!factor || !await verifyTotp(user.id, factor.id, data.code)) {
        return NextResponse.json({ code: "MFA_CODE_INVALID" }, { status: 400 });
      }
      await elevateSession(token, "aal2");
      const recoveryCodes = enrollmentVerification
        ? await replaceMfaRecoveryCodes(user.id)
        : undefined;
      await revokeUserTrustedDevices(user.id, "MFA_VERIFIED").catch(() => undefined);
      const response = NextResponse.json({ ok: true, next: "/dashboard", recoveryCodes });
      response.cookies.delete(securityCookieNames.trustedDevice);
      response.cookies.set(securityCookieNames.mfaRemember, "", {
        path: "/api/settings/mfa",
        maxAge: 0,
      });
      return response;
    }
    if (data.action === "rotateRecovery") {
      await requireApiAal2();
      const verified = (await listTotpFactors(user.id)).some((factor) => factor.status === "verified");
      if (!verified) return NextResponse.json({ code: "MFA_FACTOR_NOT_FOUND" }, { status: 404 });
      return NextResponse.json({ recoveryCodes: await replaceMfaRecoveryCodes(user.id) });
    }
    if (data.action === "recover") {
      if (!await consumeMfaRecoveryCode(user.id, data.code)) {
        return NextResponse.json({ code: "MFA_RECOVERY_INVALID" }, { status: 400 });
      }
      const verified = (await listTotpFactors(user.id)).filter((factor) => factor.status === "verified");
      for (const factor of verified) await deleteTotpFactor(user.id, factor.id);
      await revokeUserTrustedDevices(user.id, "MFA_RECOVERY_USED").catch(() => undefined);
      const response = NextResponse.json({
        ok: true,
        next: isMfaRequiredRole(user.role) ? "/mfa-setup" : "/dashboard",
      });
      response.cookies.delete(securityCookieNames.trustedDevice);
      return response;
    }
    if (data.action !== "unenroll") {
      return NextResponse.json({ code: "INVALID_MFA_REQUEST" }, { status: 400 });
    }
    const factor = (await listTotpFactors(user.id)).find((entry) => entry.id === data.factorId);
    if (!factor) return NextResponse.json({ code: "MFA_FACTOR_NOT_FOUND" }, { status: 404 });
    if (factor.status === "verified" && isMfaRequiredRole(user.role)) {
      return NextResponse.json({ code: "MFA_REQUIRED_FOR_ROLE" }, { status: 409 });
    }
    await deleteTotpFactor(user.id, factor.id);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ code: "MFA_OPERATION_FAILED" }, { status: 400 });
  }
}

export const GET = apiRoute(get, "MFA_LOAD_FAILED");
export const POST = apiRoute(post, "MFA_OPERATION_FAILED");
