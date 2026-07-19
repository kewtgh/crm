import crypto from "node:crypto";

function decodeBase32(value) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const character of value.toUpperCase().replace(/=+$/g, "")) {
    const index = alphabet.indexOf(character);
    if (index < 0) throw new Error("TOTP enrollment returned an invalid base32 secret");
    bits += index.toString(2).padStart(5, "0");
  }
  const bytes = [];
  for (let offset = 0; offset + 8 <= bits.length; offset += 8) {
    bytes.push(Number.parseInt(bits.slice(offset, offset + 8), 2));
  }
  return Buffer.from(bytes);
}

function totp(secret, timestamp = Date.now()) {
  const counter = Math.floor(timestamp / 30_000);
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = crypto.createHmac("sha1", decodeBase32(secret)).update(message).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = (digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return String(binary).padStart(6, "0");
}

async function jsonRequest(url, anonKey, accessToken, init) {
  const response = await fetch(url, {
    ...init,
    headers: {
      apikey: anonKey,
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(10_000),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`Local MFA bootstrap failed (${response.status}: ${body?.message ?? body?.msg ?? body?.code ?? "unknown"})`);
  }
  return body;
}

export async function elevateQaSessionToAal2({
  supabaseUrl,
  anonKey,
  accessToken,
  friendlyName,
}) {
  const enrolled = await jsonRequest(`${supabaseUrl}/auth/v1/factors`, anonKey, accessToken, {
    method: "POST",
    body: JSON.stringify({ factor_type: "totp", friendly_name: friendlyName }),
  });
  if (!enrolled?.id || !enrolled?.totp?.secret) {
    throw new Error("Local MFA bootstrap did not return a TOTP factor");
  }
  const challenge = await jsonRequest(
    `${supabaseUrl}/auth/v1/factors/${enrolled.id}/challenge`,
    anonKey,
    accessToken,
    { method: "POST", body: "{}" },
  );
  if (!challenge?.id) throw new Error("Local MFA bootstrap did not return a challenge");
  const verified = await jsonRequest(
    `${supabaseUrl}/auth/v1/factors/${enrolled.id}/verify`,
    anonKey,
    accessToken,
    {
      method: "POST",
      body: JSON.stringify({
        challenge_id: challenge.id,
        code: totp(enrolled.totp.secret),
      }),
    },
  );
  if (!verified?.access_token || !verified?.refresh_token) {
    throw new Error("Local MFA bootstrap did not return an AAL2 session");
  }
  return verified;
}
