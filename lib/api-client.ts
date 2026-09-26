import { boundedSignal } from "./fetch-timeout";
import { createSingleFlight } from "./single-flight.mjs";

export type ApiFailurePayload = {
  code?: string;
  field?: string;
  error?: {
    code?: string;
    message?: string;
    requestId?: string;
    details?: Record<string, unknown>;
  };
};

export class ApiClientError extends Error {
  constructor(
    public code: string,
    public status: number,
    public requestId?: string,
    public details?: Record<string, unknown>,
  ) {
    super(code);
  }
}

function transportFailure(error: unknown, signal: AbortSignal): ApiClientError {
  const reason = signal.aborted ? signal.reason : error;
  const name = reason instanceof Error ? reason.name : "";
  return new ApiClientError(name === "TimeoutError" ? "REQUEST_TIMEOUT" : signal.aborted || name === "AbortError" ? "REQUEST_ABORTED" : "NETWORK_ERROR", 0);
}

async function payloadFrom(response: Response, signal: AbortSignal) {
  try { return await response.json() as ApiFailurePayload; }
  catch (error) {
    if (signal.aborted || error instanceof Error && ["AbortError", "TimeoutError"].includes(error.name)) throw transportFailure(error, signal);
    return {};
  }
}

// A caller may stop waiting without cancelling the refresh shared by other calls.
function waitForRefresh(promise: Promise<boolean>, signal: AbortSignal): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(transportFailure(signal.reason, signal));
    if (signal.aborted) { abort(); return; }
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

const refreshSession = createSingleFlight(async () => {
  try {
    const response = await fetch("/api/auth/refresh?mode=json", {
      method: "GET",
      headers: { accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    return response.ok;
  } catch {
    return false;
  }
});

function csrfToken() {
  if (typeof document === "undefined") return undefined;
  const match = document.cookie.match(/(?:^|;\s*)crm_csrf=([^;]+)/);
  return match?.[1] ? decodeURIComponent(match[1]) : undefined;
}

export async function apiFetch<T>(
  input: RequestInfo | URL,
  init: RequestInit = {},
  retry = true,
  timeoutMs = 15_000,
): Promise<T> {
  let response: Response;
  const request = input instanceof Request ? input : undefined;
  const method = (init.method ?? request?.method ?? "GET").toUpperCase();
  const headers = new Headers(request?.headers);
  new Headers(init.headers).forEach((value, key) => headers.set(key, value));
  if (!headers.has("accept")) headers.set("accept", "application/json");
  const signal = init.signal ?? request?.signal;
  const attemptSignal = boundedSignal(signal, timeoutMs);
  try {
    const csrf = !["GET", "HEAD", "OPTIONS"].includes(method) ? csrfToken() : undefined;
    if (csrf) headers.set("x-csrf-token", csrf);
    // Keep Request bodies available for the single authenticated retry below.
    response = await fetch(request ? request.clone() : input, {
      ...init,
      method,
      headers,
      signal: attemptSignal,
    });
  } catch (error) {
    throw transportFailure(error, attemptSignal);
  }

  if (!response.ok) {
    const payload = await payloadFrom(response, attemptSignal);
    const code = payload.error?.code ?? payload.code ?? `HTTP_${response.status}`;
    if (retry && response.status === 401 && code === "SESSION_REFRESH_REQUIRED" && await waitForRefresh(refreshSession(), attemptSignal)) {
      return apiFetch<T>(input, init, false, timeoutMs);
    }
    throw new ApiClientError(
      code,
      response.status,
      payload.error?.requestId ?? response.headers.get("x-request-id") ?? undefined,
      payload.error?.details ?? (payload.field ? { field: payload.field } : undefined),
    );
  }

  if (response.status === 204) return undefined as T;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) throw new ApiClientError("INVALID_API_RESPONSE", 502);
  try {
    return await response.json() as T;
  } catch (error) {
    if (attemptSignal.aborted || error instanceof Error && ["AbortError", "TimeoutError"].includes(error.name)) throw transportFailure(error, attemptSignal);
    throw new ApiClientError(
      "INVALID_API_RESPONSE",
      502,
      response.headers.get("x-request-id") ?? undefined,
    );
  }
}
