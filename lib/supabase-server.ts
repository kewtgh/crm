import { cookies } from "next/headers";
import { authCookieNames } from "./auth";

export class SupabaseRequestError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

export async function getAccessToken() {
  return (await cookies()).get(authCookieNames.access)?.value ?? null;
}

export async function supabaseRequest(path: string, init: RequestInit = {}, token?: string | null) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const accessToken = token === undefined ? await getAccessToken() : token;
  if (!url || !key) throw new SupabaseRequestError(503, "SUPABASE_NOT_CONFIGURED", "Supabase is not configured");
  if (!accessToken) throw new SupabaseRequestError(401, "AUTH_REQUIRED", "Authentication is required");
  const response = await fetch(`${url}${path}`, {
    ...init,
    headers: {
      apikey: key,
      authorization: `Bearer ${accessToken}`,
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...init.headers,
    },
    cache: "no-store",
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => ({})) as { code?: string; message?: string; hint?: string };
    throw new SupabaseRequestError(response.status, detail.code ?? "SUPABASE_REQUEST_FAILED", detail.message ?? detail.hint ?? "Supabase request failed");
  }
  return response;
}

export async function supabaseJson<T>(path: string, init: RequestInit = {}, token?: string | null): Promise<T> {
  const response = await supabaseRequest(path, init, token);
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export async function supabaseAdminRequest(path: string, init: RequestInit = {}) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) throw new SupabaseRequestError(503, "ADMIN_SERVICE_NOT_CONFIGURED", "The Supabase administration service is not configured");
  const response = await fetch(`${url}${path}`, {
    ...init,
    headers: {
      apikey: serviceKey,
      authorization: `Bearer ${serviceKey}`,
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...init.headers,
    },
    cache: "no-store",
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => ({})) as { code?: string; error_code?: string; message?: string; msg?: string };
    throw new SupabaseRequestError(response.status, detail.code ?? detail.error_code ?? "SUPABASE_ADMIN_FAILED", detail.message ?? detail.msg ?? "Supabase administration request failed");
  }
  return response;
}

export async function supabaseAdminJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await supabaseAdminRequest(path, init);
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export function jsonBody(value: unknown): RequestInit {
  return { method: "POST", body: JSON.stringify(value), headers: { Prefer: "return=representation" } };
}
