import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, apiRoute, requireApiUser } from "@/lib/api";
import { mutationIsTrusted } from "@/lib/request-security";
import { getAccessToken } from "@/lib/supabase-server";
import {
  listTrustedDevices,
  revokeOtherTrustedDevices,
  revokeTrustedDevice,
  securityCookieNames,
} from "@/lib/trusted-devices";

const schema = z.discriminatedUnion("scope", [
  z.object({ scope: z.literal("device"), id: z.uuid() }),
  z.object({ scope: z.literal("others") }),
]);

async function get() {
  await requireApiUser();
  const accessToken = await getAccessToken();
  if (!accessToken) throw new ApiError("AUTH_REQUIRED", 401);
  const cookieStore = await cookies();
  const devices = await listTrustedDevices(
    accessToken,
    cookieStore.get(securityCookieNames.trustedDevice)?.value,
  );
  return NextResponse.json({ devices });
}

async function del(request: Request) {
  if (!mutationIsTrusted(request)) throw new ApiError("UNTRUSTED_ORIGIN", 403);
  await requireApiUser();
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) throw new ApiError("INVALID_DEVICE_REQUEST", 400);
  const accessToken = await getAccessToken();
  if (!accessToken) throw new ApiError("AUTH_REQUIRED", 401);
  const cookieStore = await cookies();
  const trustedCookie = cookieStore.get(securityCookieNames.trustedDevice)?.value;
  const response = NextResponse.json({ ok: true });
  if (parsed.data.scope === "others") {
    await revokeOtherTrustedDevices(accessToken, trustedCookie);
  } else {
    const changed = await revokeTrustedDevice(accessToken, parsed.data.id);
    if (!changed) throw new ApiError("TRUSTED_DEVICE_NOT_FOUND", 404);
    if (trustedCookie?.startsWith(`${parsed.data.id}.`)) {
      response.cookies.delete(securityCookieNames.trustedDevice);
    }
  }
  return response;
}

export const GET = apiRoute(get, "TRUSTED_DEVICES_LOAD_FAILED");
export const DELETE = apiRoute(del, "TRUSTED_DEVICE_REVOKE_FAILED");
