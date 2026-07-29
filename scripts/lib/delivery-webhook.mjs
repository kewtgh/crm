export const DELIVERY_WEBHOOK_TIMEOUT_MS = 20_000;
export const MAX_DELIVERY_WEBHOOK_TIMEOUT_MS = 120_000;

export function deliveryWebhookHeaders(idempotencyKey, bearerToken) {
  const normalizedKey = String(idempotencyKey ?? "").trim();
  if (!normalizedKey || normalizedKey.length > 200) {
    throw new Error("DELIVERY_IDEMPOTENCY_KEY_INVALID");
  }
  return {
    "content-type": "application/json",
    "idempotency-key": normalizedKey,
    ...(bearerToken ? { authorization: `Bearer ${bearerToken}` } : {}),
  };
}

export async function postDeliveryWebhook({
  endpoint,
  bearerToken,
  idempotencyKey,
  payload,
  timeoutMs = DELIVERY_WEBHOOK_TIMEOUT_MS,
  fetchImplementation = globalThis.fetch,
}) {
  if (typeof fetchImplementation !== "function") throw new Error("DELIVERY_FETCH_UNAVAILABLE");
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > MAX_DELIVERY_WEBHOOK_TIMEOUT_MS) {
    throw new Error("DELIVERY_TIMEOUT_INVALID");
  }
  const url = String(endpoint ?? "").trim();
  if (!url) throw new Error("DELIVERY_ENDPOINT_REQUIRED");
  return fetchImplementation(url, {
    method: "POST",
    headers: deliveryWebhookHeaders(idempotencyKey, bearerToken),
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(timeoutMs),
  });
}
