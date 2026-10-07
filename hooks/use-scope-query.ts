"use client";
import { useEffect, useState } from "react";
import { apiFetch, ApiClientError } from "@/lib/api-client";

/** Presentation loading state is bound to the applied query; never relabel old-scope data. */
export function useScopeQuery<T>(endpoint: string, query: string, validate: (value: unknown) => T, refresh = 0) {
  const key = `${endpoint}?${query}`;
  const [stored, setStored] = useState<{ key: string; value: T } | null>(null);
  const [status, setStatus] = useState<{ key: string; pending: boolean; failure?: "restricted" | "unavailable" }>({ key: "", pending: true });
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setStatus({ key, pending: true });
      try {
        const value = validate(await apiFetch<unknown>(key, { signal: controller.signal }));
        if (!controller.signal.aborted) { setStored({ key, value }); setStatus({ key, pending: false }); }
      } catch (error) {
        if (!controller.signal.aborted) setStatus({ key, pending: false, failure: error instanceof ApiClientError && error.status === 403 ? "restricted" : "unavailable" });
      }
    }, 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [key, validate, retry, refresh]);
  return { data: stored?.key === key ? stored.value : null, loading: status.key !== key || status.pending, failure: status.key === key ? status.failure : undefined, retry: () => setRetry(value => value + 1) };
}
