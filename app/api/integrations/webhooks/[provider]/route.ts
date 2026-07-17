import { NextResponse } from "next/server";
import { ApiError, apiRoute } from "@/lib/api";
import { supabaseAdminJson } from "@/lib/supabase-server";

const providerConfig = {
  "microsoft-365": { provider: "MICROSOFT_365", secret: "WEBHOOK_MICROSOFT_365_SECRET" },
  "google-calendar": { provider: "GOOGLE_CALENDAR", secret: "WEBHOOK_GOOGLE_CALENDAR_SECRET" },
  email: { provider: "EMAIL", secret: "WEBHOOK_EMAIL_SECRET" },
  "e-signature": { provider: "E_SIGNATURE", secret: "WEBHOOK_E_SIGNATURE_SECRET" },
  accounting: { provider: "ACCOUNTING", secret: "WEBHOOK_ACCOUNTING_SECRET" },
} as const;

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function constantTimeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

async function post(request: Request, context: { params: Promise<{ provider: string }> }) {
  const { provider: providerSlug } = await context.params;
  const config = providerConfig[providerSlug as keyof typeof providerConfig];
  if (!config) throw new ApiError("WEBHOOK_PROVIDER_NOT_FOUND", 404);
  const secret = process.env[config.secret];
  if (!secret) throw new ApiError("WEBHOOK_NOT_CONFIGURED", 503);
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > 1_048_576) throw new ApiError("WEBHOOK_PAYLOAD_TOO_LARGE", 413);
  const rawBody = await request.text();
  if (new TextEncoder().encode(rawBody).byteLength > 1_048_576) {
    throw new ApiError("WEBHOOK_PAYLOAD_TOO_LARGE", 413);
  }

  const eventId = request.headers.get("x-event-id")?.trim();
  const eventType = request.headers.get("x-event-type")?.trim();
  const timestampHeader = request.headers.get("x-event-timestamp")?.trim() ?? "";
  if (!eventId || eventId.length > 200 || !eventType || eventType.length > 200) {
    throw new ApiError("WEBHOOK_HEADERS_INVALID", 400);
  }
  if (!/^\d{10}$/.test(timestampHeader)) throw new ApiError("WEBHOOK_TIMESTAMP_INVALID", 400);
  const signedAt = new Date(Number(timestampHeader) * 1000);
  if (!Number.isFinite(signedAt.getTime())
    || Math.abs(Date.now() - signedAt.getTime()) > 5 * 60 * 1000) {
    throw new ApiError("WEBHOOK_REPLAY_WINDOW_EXCEEDED", 401);
  }
  const bodyDigest = bytesToHex(new Uint8Array(await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(rawBody),
  )));
  const canonicalEnvelope = [
    "v1",
    config.provider,
    eventId,
    eventType,
    timestampHeader,
    bodyDigest,
  ].join("\n");
  const suppliedSignature = (request.headers.get("x-webhook-signature") ?? "")
    .trim()
    .toLowerCase()
    .replace(/^sha256=/, "");
  const signingKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const expectedSignature = bytesToHex(new Uint8Array(
    await crypto.subtle.sign("HMAC", signingKey, new TextEncoder().encode(canonicalEnvelope)),
  ));
  if (!/^[a-f0-9]{64}$/.test(suppliedSignature) || !constantTimeEqual(suppliedSignature, expectedSignature)) {
    throw new ApiError("WEBHOOK_SIGNATURE_INVALID", 401);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody) as unknown;
  } catch {
    throw new ApiError("WEBHOOK_PAYLOAD_INVALID", 400);
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new ApiError("WEBHOOK_PAYLOAD_INVALID", 400);
  }
  const digest = bytesToHex(new Uint8Array(await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(suppliedSignature),
  )));
  const canonicalDigest = bytesToHex(new Uint8Array(await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonicalEnvelope),
  )));
  const workspaceId = process.env.CRM_WORKSPACE_ID;
  if (!workspaceId || !/^[0-9a-f-]{36}$/i.test(workspaceId)) {
    throw new ApiError("WEBHOOK_WORKSPACE_NOT_CONFIGURED", 503);
  }
  const ingested = await supabaseAdminJson<{ id: string; duplicate: boolean }>(
    "/rest/v1/rpc/ingest_webhook_event",
    {
    method: "POST",
    body: JSON.stringify({
      target_workspace: workspaceId,
      target_provider: config.provider,
      target_event_id: eventId,
      target_event_type: eventType,
      event_payload: payload,
      signature_hash: digest,
      envelope_hash: canonicalDigest,
      event_signed_at: signedAt.toISOString(),
    }),
  });
  return NextResponse.json({ accepted: true, duplicate: ingested.duplicate }, { status: 202 });
}

export const POST = apiRoute(post, "WEBHOOK_INGEST_FAILED");
