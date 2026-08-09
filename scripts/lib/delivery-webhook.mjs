export const DELIVERY_WEBHOOK_TIMEOUT_MS = 20_000;
export const MAX_DELIVERY_WEBHOOK_TIMEOUT_MS = 120_000;
export const MAX_DELIVERY_ERROR_RESPONSE_BYTES = 4_096;

const REMOTE_DELIVERY_FAILURE_CODES = Object.freeze({
  TEMPLATE_VARIABLE_INVALID:"DELIVERY_REMOTE_TEMPLATE_VARIABLE_INVALID",
  TEMPLATE_VARIABLE_MISSING:"DELIVERY_REMOTE_TEMPLATE_VARIABLE_MISSING",
  TEMPLATE_URL_INVALID:"DELIVERY_REMOTE_TEMPLATE_URL_INVALID",
  RECIPIENT_INVALID:"DELIVERY_REMOTE_RECIPIENT_INVALID",
});

async function readBoundedResponseBody(response, maximumBytes) {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) return null;
  if (!response.body) return null;

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return null;
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

export async function deliveryWebhookFailureCode(response, {
  maximumBytes = MAX_DELIVERY_ERROR_RESPONSE_BYTES,
} = {}) {
  const fallback = `DELIVERY_HTTP_${response.status}`;
  if (response.status < 400 || response.status > 499) return fallback;
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1 || maximumBytes > MAX_DELIVERY_ERROR_RESPONSE_BYTES) {
    return fallback;
  }

  const body = await readBoundedResponseBody(response, maximumBytes);
  if (body === null) return fallback;
  try {
    const remoteCode = JSON.parse(body)?.error?.code;
    return typeof remoteCode === "string" && Object.hasOwn(REMOTE_DELIVERY_FAILURE_CODES, remoteCode)
      ? REMOTE_DELIVERY_FAILURE_CODES[remoteCode]
      : fallback;
  } catch {
    return fallback;
  }
}

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
