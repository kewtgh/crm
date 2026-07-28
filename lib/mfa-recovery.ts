import { databaseJson, databaseRequest } from "./db/gateway";

const RECOVERY_CODE_COUNT = 10;

function normalizeRecoveryCode(code: string) {
  return code.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

async function hashRecoveryCode(userId: string, code: string) {
  const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(`${userId}:${normalizeRecoveryCode(code)}`));
  return Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,"0")).join("");
}

function createRecoveryCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  const raw = Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
}

export async function replaceMfaRecoveryCodes(userId: string) {
  const codes = Array.from({ length: RECOVERY_CODE_COUNT }, createRecoveryCode);
  await databaseRequest(`/db/table/mfa_recovery_codes?user_id=eq.${encodeURIComponent(userId)}`, { method: "DELETE" });
  const codeHashes=await Promise.all(codes.map(code=>hashRecoveryCode(userId,code)));
  await databaseRequest("/db/table/mfa_recovery_codes", {
    method: "POST",
    body: JSON.stringify(codes.map((code,index) => ({ user_id: userId, code_hash: codeHashes[index] }))),
    headers: { Prefer: "return=minimal" },
  });
  return codes;
}

export async function countMfaRecoveryCodes(userId: string) {
  const rows = await databaseJson<Array<{ id: string }>>(
    `/db/table/mfa_recovery_codes?select=id&user_id=eq.${encodeURIComponent(userId)}`,
    {},
  );
  return rows.length;
}

export async function consumeMfaRecoveryCode(userId: string, code: string) {
  const rows = await databaseJson<Array<{ id: string }>>(
    `/db/table/mfa_recovery_codes?select=id&user_id=eq.${encodeURIComponent(userId)}&code_hash=eq.${await hashRecoveryCode(userId, code)}&limit=1`,
    {},
  );
  const match = rows[0];
  if (!match) return false;
  await databaseRequest(`/db/table/mfa_recovery_codes?id=eq.${encodeURIComponent(match.id)}&user_id=eq.${encodeURIComponent(userId)}`, { method: "DELETE" });
  return true;
}
