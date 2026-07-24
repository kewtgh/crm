export const DEFAULT_UPSTREAM_TIMEOUT_MS = 15_000;

export function boundedSignal(signal?: AbortSignal | null, timeoutMs = DEFAULT_UPSTREAM_TIMEOUT_MS) {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

export function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = DEFAULT_UPSTREAM_TIMEOUT_MS,
) {
  return fetch(input, { ...init, signal: boundedSignal(init.signal, timeoutMs) });
}

export function isTimeoutError(error: unknown) {
  return error instanceof DOMException && error.name === "TimeoutError";
}
