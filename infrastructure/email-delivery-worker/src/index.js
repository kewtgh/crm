import {
  renderTemplate,
  TemplateValidationError,
} from "./templates.js";
import {
  validatedRuntimeConfiguration,
} from "./config.js";

const MAX_REQUEST_BYTES = 64 * 1024;
const MAX_PAYLOAD_BYTES = 32 * 1024;
const MAX_JSON_DEPTH = 5;
const MAX_JSON_NODES = 256;
const RESEND_ENDPOINT = "https://api.resend.com/emails";
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const SAFE_IDEMPOTENCY_KEY = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/;
const SAFE_TEMPLATE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const RESPONSE_HEADERS = Object.freeze({
  "cache-control": "no-store",
  "content-type": "application/json; charset=utf-8",
  "x-content-type-options": "nosniff",
});

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: RESPONSE_HEADERS,
  });
}

function errorResponse(status, code) {
  return jsonResponse(status, { error: { code } });
}

async function digest(value) {
  return new Uint8Array(await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  ));
}

async function authorized(request, configuredToken) {
  const authorization = request.headers.get("authorization") ?? "";
  const suppliedToken = authorization.startsWith("Bearer ")
    && !authorization.slice(7).includes(" ")
    ? authorization.slice(7)
    : "";
  const secret = typeof configuredToken === "string" ? configuredToken : "";
  const [suppliedDigest, configuredDigest] = await Promise.all([
    digest(suppliedToken || "invalid-supplied-token"),
    digest(secret || "invalid-configured-token"),
  ]);
  let mismatch = suppliedToken && secret ? 0 : 1;
  for (let index = 0; index < configuredDigest.length; index += 1) {
    mismatch |= suppliedDigest[index] ^ configuredDigest[index];
  }
  return mismatch === 0;
}

function validRecipient(value) {
  return typeof value === "string"
    && value.length >= 3
    && value.length <= 254
    && !/[\r\n,;]/.test(value)
    && /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/.test(value);
}

function validateJsonValue(value, depth, state) {
  state.nodes += 1;
  if (state.nodes > MAX_JSON_NODES || depth > MAX_JSON_DEPTH) return false;
  if (typeof value === "string") return value.length <= 10_000;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "boolean") return true;
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  if (keys.length > 64 || keys.some((key) => key.length > 64)) return false;
  return keys.every((key) => validateJsonValue(value[key], depth + 1, state));
}

function validateDeliveryBody(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return "REQUEST_BODY_INVALID";
  }
  const allowedFields = new Set(["id", "to", "template", "payload"]);
  if (Object.keys(body).some((key) => !allowedFields.has(key))) {
    return "REQUEST_FIELDS_INVALID";
  }
  if (!SAFE_ID.test(body.id ?? "")) return "REQUEST_ID_INVALID";
  if (!validRecipient(body.to)) return "RECIPIENT_INVALID";
  if (typeof body.template !== "string" || !SAFE_TEMPLATE.test(body.template)) {
    return "TEMPLATE_INVALID";
  }
  if (!body.payload || typeof body.payload !== "object" || Array.isArray(body.payload)) {
    return "PAYLOAD_INVALID";
  }
  if (!validateJsonValue(body.payload, 1, { nodes: 0 })) return "PAYLOAD_INVALID";
  if (new TextEncoder().encode(JSON.stringify(body.payload)).byteLength > MAX_PAYLOAD_BYTES) {
    return "PAYLOAD_TOO_LARGE";
  }
  return null;
}

async function readJsonBody(request) {
  const declaredLength = request.headers.get("content-length");
  if (declaredLength && /^\d+$/.test(declaredLength)
    && Number(declaredLength) > MAX_REQUEST_BYTES) {
    return { error: errorResponse(413, "REQUEST_TOO_LARGE") };
  }
  let buffer;
  try {
    buffer = await request.arrayBuffer();
  } catch {
    return { error: errorResponse(400, "REQUEST_BODY_UNREADABLE") };
  }
  if (buffer.byteLength > MAX_REQUEST_BYTES) {
    return { error: errorResponse(413, "REQUEST_TOO_LARGE") };
  }
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    return { body: JSON.parse(text) };
  } catch {
    return { error: errorResponse(400, "INVALID_JSON") };
  }
}

function safeLog(logger, entry) {
  if (typeof logger?.info !== "function") return;
  try {
    logger.info(JSON.stringify(entry));
  } catch {
    // Delivery results must not depend on the logging sink.
  }
}

function providerRequest(body, rendered, configuration, idempotencyKey, signal) {
  const providerBody = {
    from: configuration.from,
    to: [body.to],
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
  };
  if (configuration.replyTo) providerBody.reply_to = configuration.replyTo;
  return {
    method: "POST",
    headers: {
      authorization: `Bearer ${configuration.apiKey}`,
      "content-type": "application/json",
      "idempotency-key": idempotencyKey,
    },
    body: JSON.stringify(providerBody),
    cache: "no-store",
    redirect: "error",
    signal,
  };
}

async function deliver(request, {
  configuration,
  fetchImplementation,
  logger,
  providerTimeoutMs,
}) {
  if (!await authorized(request, configuration.webhookToken)) {
    return errorResponse(401, "UNAUTHORIZED");
  }

  const mediaType = (request.headers.get("content-type") ?? "")
    .split(";", 1)[0]
    .trim()
    .toLowerCase();
  if (mediaType !== "application/json") {
    return errorResponse(415, "CONTENT_TYPE_UNSUPPORTED");
  }

  const idempotencyKey = request.headers.get("idempotency-key") ?? "";
  if (!SAFE_IDEMPOTENCY_KEY.test(idempotencyKey)) {
    return errorResponse(400, "IDEMPOTENCY_KEY_INVALID");
  }

  const parsed = await readJsonBody(request);
  if (parsed.error) return parsed.error;
  const bodyError = validateDeliveryBody(parsed.body);
  if (bodyError) return errorResponse(400, bodyError);

  let rendered;
  try {
    rendered = renderTemplate(parsed.body.template, parsed.body.payload, {
      brandName: configuration.brandName,
      applicationUrl: configuration.applicationUrl,
    });
  } catch (error) {
    if (error instanceof TemplateValidationError) {
      return errorResponse(422, error.code);
    }
    return errorResponse(422, "TEMPLATE_RENDER_FAILED");
  }

  let providerResponse;
  try {
    providerResponse = await fetchImplementation(
      RESEND_ENDPOINT,
      providerRequest(
        parsed.body,
        rendered,
        configuration,
        idempotencyKey,
        AbortSignal.timeout(providerTimeoutMs),
      ),
    );
  } catch {
    safeLog(logger, {
      event: "email_delivery",
      requestId: parsed.body.id,
      template: parsed.body.template,
      httpStatus: 503,
      providerResult: "unavailable",
    });
    return errorResponse(503, "PROVIDER_UNAVAILABLE");
  }

  if (providerResponse.status >= 400 && providerResponse.status < 500) {
    safeLog(logger, {
      event: "email_delivery",
      requestId: parsed.body.id,
      template: parsed.body.template,
      httpStatus: 502,
      providerStatus: providerResponse.status,
      providerResult: "rejected",
    });
    return errorResponse(502, "PROVIDER_REJECTED");
  }
  if (!providerResponse.ok) {
    safeLog(logger, {
      event: "email_delivery",
      requestId: parsed.body.id,
      template: parsed.body.template,
      httpStatus: 503,
      providerStatus: providerResponse.status,
      providerResult: "unavailable",
    });
    return errorResponse(503, "PROVIDER_UNAVAILABLE");
  }

  const receipt = await providerResponse.json().catch(() => null);
  const providerId = typeof receipt?.id === "string" ? receipt.id.trim() : "";
  if (!providerId || providerId.length > 200 || /[\r\n]/.test(providerId)) {
    safeLog(logger, {
      event: "email_delivery",
      requestId: parsed.body.id,
      template: parsed.body.template,
      httpStatus: 502,
      providerStatus: providerResponse.status,
      providerResult: "invalid_response",
    });
    return errorResponse(502, "PROVIDER_INVALID_RESPONSE");
  }

  safeLog(logger, {
    event: "email_delivery",
    requestId: parsed.body.id,
    template: parsed.body.template,
    httpStatus: 200,
    providerStatus: providerResponse.status,
    providerResult: "accepted",
  });
  return jsonResponse(200, { id: providerId });
}

export function createEmailDeliveryWorker({
  fetchImplementation = globalThis.fetch,
  logger = console,
  providerTimeoutMs = 15_000,
} = {}) {
  if (typeof fetchImplementation !== "function") {
    throw new Error("FETCH_IMPLEMENTATION_REQUIRED");
  }
  if (!Number.isSafeInteger(providerTimeoutMs)
    || providerTimeoutMs < 1
    || providerTimeoutMs > 30_000) {
    throw new Error("PROVIDER_TIMEOUT_INVALID");
  }
  return {
    async fetch(request, env = {}) {
      const url = new URL(request.url);
      const configuration = validatedRuntimeConfiguration(env);
      if (!configuration) return errorResponse(503, "SERVICE_NOT_CONFIGURED");
      if (request.method === "GET") {
        if (url.pathname === configuration.healthPath) {
          return jsonResponse(200, {
            status: "ok",
            service: "lumina-email-delivery",
          });
        }
        return errorResponse(404, "NOT_FOUND");
      }
      if (url.pathname !== configuration.deliveryPath) return errorResponse(404, "NOT_FOUND");
      if (request.method !== "POST") return errorResponse(405, "METHOD_NOT_ALLOWED");
      return deliver(request, {
        configuration,
        fetchImplementation,
        logger,
        providerTimeoutMs,
      });
    },
  };
}

export default createEmailDeliveryWorker();
