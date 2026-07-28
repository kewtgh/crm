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

async function payloadFrom(response: Response) {
  return response.json().catch(() => ({})) as Promise<ApiFailurePayload>;
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
  try {
    const method = (init.method ?? "GET").toUpperCase();
    const csrf = !["GET", "HEAD", "OPTIONS"].includes(method) ? csrfToken() : undefined;
    response = await fetch(input, {
      ...init,
      headers: {
        accept: "application/json",
        ...(csrf ? { "x-csrf-token": csrf } : {}),
        ...init.headers,
      },
      signal: boundedSignal(init.signal, timeoutMs),
    });
  } catch (error) {
    const code = error instanceof DOMException && error.name === "TimeoutError"
      ? "REQUEST_TIMEOUT"
      : error instanceof DOMException && error.name === "AbortError"
        ? "REQUEST_ABORTED"
        : "NETWORK_ERROR";
    throw new ApiClientError(code, 0);
  }

  if (!response.ok) {
    const payload = await payloadFrom(response);
    const code = payload.error?.code ?? payload.code ?? `HTTP_${response.status}`;
    if (retry && response.status === 401 && code === "SESSION_REFRESH_REQUIRED" && await refreshSession()) {
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
  } catch {
    throw new ApiClientError(
      "INVALID_API_RESPONSE",
      502,
      response.headers.get("x-request-id") ?? undefined,
    );
  }
}
