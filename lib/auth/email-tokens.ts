import { applicationOrigin } from "../application-origin.mjs";
import { poolQuery, withPoolClient } from "../db/pools";
import { hashOpaqueValue, randomOpaqueToken } from "./session-store";

type EmailPurpose = "EMAIL_VERIFICATION" | "DEVICE_VERIFICATION" | "PASSWORD_RESET";

function numericCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, (byte) => String(byte % 10)).join("");
}

export async function issueEmailToken({
  userId,
  email,
  purpose,
  payload = {},
}: {
  userId: string;
  email: string;
  purpose: EmailPurpose;
  payload?: Record<string, unknown>;
}) {
  const token = purpose === "DEVICE_VERIFICATION" ? numericCode() : randomOpaqueToken();
  const ttlSeconds = purpose === "PASSWORD_RESET" ? 30 * 60 : purpose === "DEVICE_VERIFICATION" ? 10 * 60 : 24 * 60 * 60;
  await withPoolClient("system", async (client) => {
    await client.query("begin");
    try {
      await client.query(
        `update app_auth.email_tokens set consumed_at = now()
         where user_id = $1 and purpose = $2 and consumed_at is null`,
        [userId, purpose],
      );
      await client.query(
        `insert into app_auth.email_tokens(user_id, purpose, token_hash, payload, expires_at)
         values($1, $2, $3, $4, now() + ($5::text || ' seconds')::interval)`,
        [userId, purpose, hashOpaqueValue(token), payload, ttlSeconds],
      );
      await client.query("commit");
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    }
  });

  const endpoint = process.env.EMAIL_DELIVERY_WEBHOOK_URL?.trim();
  if (!endpoint) throw new Error("EMAIL_DELIVERY_NOT_CONFIGURED");
  const appOrigin = applicationOrigin();
  const template = purpose === "PASSWORD_RESET"
    ? "password-reset"
    : purpose === "DEVICE_VERIFICATION"
      ? "device-verification"
      : "email-verification";
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(process.env.EMAIL_DELIVERY_WEBHOOK_TOKEN
        ? { authorization: `Bearer ${process.env.EMAIL_DELIVERY_WEBHOOK_TOKEN}` }
        : {}),
    },
    body: JSON.stringify({
      id: crypto.randomUUID(),
      to: email,
      template,
      payload: {
        code: purpose === "DEVICE_VERIFICATION" ? token : undefined,
        url: purpose === "PASSWORD_RESET"
          ? new URL(`/reset-password?token=${encodeURIComponent(token)}`, appOrigin).toString()
          : purpose === "EMAIL_VERIFICATION"
            ? new URL(`/api/auth/email-verification?token=${encodeURIComponent(token)}`, appOrigin).toString()
            : undefined,
        expiresInSeconds: ttlSeconds,
      },
    }),
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);
  if (!response?.ok) {
    await poolQuery(
      "system",
      "update app_auth.email_tokens set consumed_at = now() where token_hash = $1",
      [hashOpaqueValue(token)],
    ).catch(() => undefined);
    throw new Error("EMAIL_DELIVERY_FAILED");
  }
  return token;
}

export async function consumeEmailToken(token: string, purpose: EmailPurpose) {
  if (!/^[A-Za-z0-9_-]{6,128}$/.test(token)) return null;
  const result = await poolQuery<{ id: string; user_id: string; payload: Record<string, unknown> }>(
    "system",
    `update app_auth.email_tokens
     set consumed_at = now()
     where id = (
       select id from app_auth.email_tokens
       where token_hash = $1 and purpose = $2
         and consumed_at is null and expires_at > now()
       for update skip locked
       limit 1
     )
     returning id, user_id, payload`,
    [hashOpaqueValue(token), purpose],
  );
  return result.rows[0] ?? null;
}
