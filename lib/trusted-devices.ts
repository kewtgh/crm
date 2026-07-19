import { supabaseAdminJson, supabaseJson } from "./supabase-server";
import { requireTrustedDeviceSecret } from "./runtime-environment";

export const securityCookieNames = {
  trustedDevice: "crm_trusted_device",
  pendingDeviceVerification: "crm_pending_device_verification",
  mfaRemember: "crm_mfa_remember",
} as const;

export const trustedDeviceMaxAge = 60 * 60 * 24 * 30;
export const pendingDeviceVerificationMaxAge = 60 * 10;

type PendingDeviceVerification = {
  userId: string;
  remember: boolean;
  expiresAt: number;
};

export type TrustedDevice = {
  id: string;
  label: string;
  createdAt: string;
  lastUsedAt: string;
  expiresAt: string;
  current: boolean;
};

type TrustedDeviceRow = {
  id: string;
  device_label: string;
  created_at: string;
  last_used_at: string;
  expires_at: string;
};

const encoder = new TextEncoder();

function bytesToBase64Url(bytes: Uint8Array) {
  let value = "";
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const decoded = atob(normalized);
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
}

async function hmac(value: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(requireTrustedDeviceSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
}

async function verifyHmac(value: string, signature: Uint8Array) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(requireTrustedDeviceSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  return crypto.subtle.verify("HMAC", key, new Uint8Array(signature).buffer, encoder.encode(value));
}

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function randomToken() {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

export async function createPendingDeviceVerification(userId: string, remember: boolean) {
  const payload: PendingDeviceVerification = {
    userId,
    remember,
    expiresAt: Date.now() + pendingDeviceVerificationMaxAge * 1000,
  };
  const encoded = bytesToBase64Url(encoder.encode(JSON.stringify(payload)));
  return `${encoded}.${bytesToBase64Url(await hmac(`pending:${encoded}`))}`;
}

export async function readPendingDeviceVerification(value?: string | null) {
  if (!value) return null;
  const [encoded, signature, extra] = value.split(".");
  if (!encoded || !signature || extra) return null;
  try {
    if (!await verifyHmac(`pending:${encoded}`, base64UrlToBytes(signature))) return null;
    const payload = JSON.parse(new TextDecoder().decode(base64UrlToBytes(encoded))) as PendingDeviceVerification;
    if (
      !/^[0-9a-f-]{36}$/i.test(payload.userId)
      || typeof payload.remember !== "boolean"
      || !Number.isFinite(payload.expiresAt)
      || payload.expiresAt <= Date.now()
    ) return null;
    return payload;
  } catch {
    return null;
  }
}

function parseTrustedDeviceCookie(value?: string | null) {
  if (!value) return null;
  const [id, token, extra] = value.split(".");
  if (!id || !token || extra || !/^[0-9a-f-]{36}$/i.test(id) || !/^[A-Za-z0-9_-]{40,80}$/.test(token)) return null;
  return { id, token };
}

async function trustedDeviceDigest(id: string, token: string) {
  return bytesToHex(await hmac(`trusted:${id}:${token}`));
}

export async function consumeTrustedDevice(userId: string, cookieValue?: string | null) {
  const parsed = parseTrustedDeviceCookie(cookieValue);
  if (!parsed) return false;
  try {
    return await supabaseAdminJson<boolean>("/rest/v1/rpc/service_consume_trusted_login_device", {
      method: "POST",
      body: JSON.stringify({
        target_device: parsed.id,
        target_user: userId,
        target_token_hash: await trustedDeviceDigest(parsed.id, parsed.token),
      }),
    });
  } catch {
    return false;
  }
}

export async function registerTrustedDevice(userId: string, label: string) {
  const id = crypto.randomUUID();
  const token = randomToken();
  await supabaseAdminJson<string>("/rest/v1/rpc/service_register_trusted_login_device", {
    method: "POST",
    body: JSON.stringify({
      target_device: id,
      target_user: userId,
      target_token_hash: await trustedDeviceDigest(id, token),
      target_device_label: label,
      target_expires_at: new Date(Date.now() + trustedDeviceMaxAge * 1000).toISOString(),
    }),
  });
  return { id, cookieValue: `${id}.${token}` };
}

export async function revokeUserTrustedDevices(userId: string, reason: string) {
  return supabaseAdminJson<number>("/rest/v1/rpc/service_revoke_user_trusted_login_devices", {
    method: "POST",
    body: JSON.stringify({ target_user: userId, revoke_reason: reason }),
  });
}

export async function listTrustedDevices(accessToken: string, currentCookie?: string | null) {
  const currentId = parseTrustedDeviceCookie(currentCookie)?.id;
  const rows = await supabaseJson<TrustedDeviceRow[]>(
    "/rest/v1/rpc/list_current_user_trusted_login_devices",
    { method: "POST", body: "{}" },
    accessToken,
  );
  return rows.map((row): TrustedDevice => ({
    id: row.id,
    label: row.device_label,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    expiresAt: row.expires_at,
    current: row.id === currentId,
  }));
}

export async function revokeTrustedDevice(accessToken: string, id: string) {
  return supabaseJson<boolean>("/rest/v1/rpc/revoke_current_user_trusted_login_device", {
    method: "POST",
    body: JSON.stringify({ target_device: id }),
  }, accessToken);
}

export async function revokeOtherTrustedDevices(accessToken: string, currentCookie?: string | null) {
  return supabaseJson<number>("/rest/v1/rpc/revoke_other_current_user_trusted_login_devices", {
    method: "POST",
    body: JSON.stringify({ keep_device: parseTrustedDeviceCookie(currentCookie)?.id ?? null }),
  }, accessToken);
}

export function describeLoginDevice(request: Request) {
  const userAgent = request.headers.get("user-agent") ?? "";
  const browser = /Edg\//.test(userAgent) ? "Microsoft Edge"
    : /Firefox\//.test(userAgent) ? "Firefox"
      : /Chrome\//.test(userAgent) ? "Chrome"
        : /Safari\//.test(userAgent) ? "Safari"
          : "Web browser";
  const platform = /Windows/i.test(userAgent) ? "Windows"
    : /Android/i.test(userAgent) ? "Android"
      : /iPhone|iPad/i.test(userAgent) ? "iOS/iPadOS"
        : /Mac OS/i.test(userAgent) ? "macOS"
          : /Linux/i.test(userAgent) ? "Linux"
            : "Unknown platform";
  return `${browser} · ${platform}`;
}
