import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";
import { poolQuery } from "../db/pools";

const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function encryptionKey() {
  const configured = process.env.TOTP_ENCRYPTION_KEY?.trim() ?? "";
  const key = /^[a-f0-9]{64}$/i.test(configured)
    ? Buffer.from(configured, "hex")
    : Buffer.from(configured, "base64");
  if (key.length !== 32) throw new Error("TOTP_ENCRYPTION_KEY_NOT_CONFIGURED");
  return key;
}

function base32Encode(value: Uint8Array) {
  let bits = 0;
  let buffer = 0;
  let output = "";
  for (const byte of value) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += alphabet[(buffer >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += alphabet[(buffer << (5 - bits)) & 31];
  return output;
}

function base32Decode(value: string) {
  let bits = 0;
  let buffer = 0;
  const output: number[] = [];
  for (const character of value.replace(/=+$/g, "").toUpperCase()) {
    const index = alphabet.indexOf(character);
    if (index < 0) throw new Error("INVALID_TOTP_SECRET");
    buffer = (buffer << 5) | index;
    bits += 5;
    if (bits >= 8) {
      output.push((buffer >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(output);
}

function encryptSecret(secret: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return { ciphertext, iv, tag: cipher.getAuthTag() };
}

function decryptSecret(row: { secret_ciphertext: Buffer; secret_iv: Buffer; secret_tag: Buffer }) {
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), row.secret_iv);
  decipher.setAuthTag(row.secret_tag);
  return Buffer.concat([decipher.update(row.secret_ciphertext), decipher.final()]).toString("utf8");
}

function codeAt(secret: string, step: number) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const digest = createHmac("sha1", base32Decode(secret)).update(counter).digest();
  const offset = digest[digest.length - 1] & 15;
  const binary = ((digest[offset] & 127) << 24)
    | ((digest[offset + 1] & 255) << 16)
    | ((digest[offset + 2] & 255) << 8)
    | (digest[offset + 3] & 255);
  return String(binary % 1_000_000).padStart(6, "0");
}

export async function enrollTotp(userId: string, friendlyName = "Lumina CRM") {
  const secret = base32Encode(randomBytes(20));
  const encrypted = encryptSecret(secret);
  await poolQuery(
    "system",
    `update app_auth.totp_factors
     set status = 'REVOKED', revoked_at = now()
     where user_id = $1 and status = 'UNVERIFIED'`,
    [userId],
  );
  const result = await poolQuery<{ id: string }>(
    "system",
    `insert into app_auth.totp_factors(
      user_id, friendly_name, secret_ciphertext, secret_iv, secret_tag
    ) values($1, $2, $3, $4, $5) returning id`,
    [userId, friendlyName, encrypted.ciphertext, encrypted.iv, encrypted.tag],
  );
  return { id: result.rows[0].id, secret };
}

export async function listTotpFactors(userId: string) {
  const result = await poolQuery<{
    id: string;
    friendly_name: string;
    status: string;
    created_at: string;
  }>(
    "system",
    `select id, friendly_name, lower(status) as status, created_at
     from app_auth.totp_factors
     where user_id = $1 and status <> 'REVOKED'
     order by created_at`,
    [userId],
  );
  return result.rows.map((row) => ({
    id: row.id,
    factor_type: "totp",
    friendly_name: row.friendly_name,
    status: row.status === "verified" ? "verified" : "unverified",
    created_at: row.created_at,
  }));
}

export async function verifyTotp(userId: string, factorId: string, code: string) {
  if (!/^\d{6}$/.test(code)) return false;
  const result = await poolQuery<{
    secret_ciphertext: Buffer;
    secret_iv: Buffer;
    secret_tag: Buffer;
    last_used_step: string | null;
  }>(
    "system",
    `select secret_ciphertext, secret_iv, secret_tag, last_used_step
     from app_auth.totp_factors
     where id = $1 and user_id = $2 and status in ('UNVERIFIED', 'VERIFIED')`,
    [factorId, userId],
  );
  const row = result.rows[0];
  if (!row) return false;
  const secret = decryptSecret(row);
  const currentStep = Math.floor(Date.now() / 30_000);
  const priorStep = row.last_used_step === null ? -1 : Number(row.last_used_step);
  const matchedStep = [currentStep - 1, currentStep, currentStep + 1]
    .find((step) => step > priorStep && codeAt(secret, step) === code);
  if (matchedStep === undefined) return false;
  const update = await poolQuery(
    "system",
    `update app_auth.totp_factors
     set status = 'VERIFIED', verified_at = coalesce(verified_at, now()), last_used_step = $3
     where id = $1 and user_id = $2
       and coalesce(last_used_step, -1) < $3`,
    [factorId, userId, matchedStep],
  );
  return (update.rowCount ?? 0) === 1;
}

export async function deleteTotpFactor(userId: string, factorId: string) {
  const result = await poolQuery(
    "system",
    `update app_auth.totp_factors
     set status = 'REVOKED', revoked_at = now()
     where id = $1 and user_id = $2 and status <> 'REVOKED'`,
    [factorId, userId],
  );
  return (result.rowCount ?? 0) === 1;
}
