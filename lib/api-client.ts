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

async function refreshSession() {
  const response = await fetch("/api/auth/refresh?mode=json", {
    method: "GET",
    headers: { accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  return response.ok;
}

function requestSignal(signal?: AbortSignal | null, timeoutMs = 15_000) {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

export async function apiFetch<T>(
  input: RequestInfo | URL,
  init: RequestInit = {},
  retry = true,
  timeoutMs = 15_000,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(input, {
      ...init,
      headers: { accept: "application/json", ...init.headers },
      signal: requestSignal(init.signal, timeoutMs),
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
  return response.json() as Promise<T>;
}
