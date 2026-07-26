import { requireTrustedDeviceSecret } from "./runtime-environment";

export const enterpriseSsoCookie = "crm_sso_pkce";
export const enterpriseSsoMaxAge = 5 * 60;

type SsoState = { verifier: string; issuedAt: number };

function featureEnabled(value: string | undefined) {
  return /^(1|true|yes|on)$/i.test(value?.trim() ?? "");
}

function base64Url(bytes: Uint8Array) {
  let value = "";
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function decodeBase64Url(value: string) {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(atob(normalized), (character) => character.charCodeAt(0));
}

async function signingKey() {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(requireTrustedDeviceSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export function enterpriseSsoConfiguration(environment: NodeJS.ProcessEnv = process.env) {
  const domains = [...new Set((environment.SSO_ALLOWED_DOMAINS ?? "")
    .split(",")
    .map((domain) => domain.trim().toLowerCase())
    .filter((domain) => /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain)))];
  return { enabled: featureEnabled(environment.SSO_ENABLED) && domains.length > 0, domains };
}

export async function createEnterpriseSsoState() {
  const verifier = base64Url(crypto.getRandomValues(new Uint8Array(48)));
  const encoded = base64Url(new TextEncoder().encode(JSON.stringify({ verifier, issuedAt: Date.now() } satisfies SsoState)));
  const signature = base64Url(new Uint8Array(await crypto.subtle.sign("HMAC", await signingKey(), new TextEncoder().encode(encoded))));
  const challenge = base64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
  return { cookie: `${encoded}.${signature}`, verifier, challenge };
}

export async function readEnterpriseSsoState(cookie: string | undefined) {
  if (!cookie) return null;
  const [encoded, signature, extra] = cookie.split(".");
  if (!encoded || !signature || extra) return null;
  let signatureBytes: Uint8Array;
  try { signatureBytes = decodeBase64Url(signature); } catch { return null; }
  const valid = await crypto.subtle.verify(
    "HMAC",
    await signingKey(),
    new Uint8Array(signatureBytes),
    new TextEncoder().encode(encoded),
  );
  if (!valid) return null;
  try {
    const state = JSON.parse(new TextDecoder().decode(decodeBase64Url(encoded))) as SsoState;
    if (!/^[A-Za-z0-9_-]{43,128}$/.test(state.verifier)) return null;
    if (!Number.isFinite(state.issuedAt) || Date.now() - state.issuedAt > enterpriseSsoMaxAge * 1_000) return null;
    return state;
  } catch { return null; }
}
