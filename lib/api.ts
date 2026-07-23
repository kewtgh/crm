import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  authCookieNames,
  decodeJwtPayload,
  getCurrentUser,
  type AppRole,
  type AppUser,
} from "./auth";
import { aal2Capabilities, hasCapability, type Capability } from "./capabilities";
import { SupabaseRequestError } from "./supabase-server";

export type ApiErrorBody = {
  code: string;
  error: {
    code: string;
    message: string;
    requestId: string;
    details?: Record<string, unknown>;
  };
};

export class ApiError extends Error {
  constructor(
    public code: string,
    public status: number,
    message = code,
    public details?: Record<string, unknown>,
    public headers?: HeadersInit,
  ) {
    super(message);
  }
}

function requestIdFor(request: Request) {
  const supplied = request.headers.get("x-request-id");
  return supplied && /^[A-Za-z0-9._-]{1,80}$/.test(supplied) ? supplied : crypto.randomUUID();
}

export function apiErrorResponse(
  code: string,
  status: number,
  requestId = crypto.randomUUID(),
  details?: Record<string, unknown>,
  headers?: HeadersInit,
) {
  const body: ApiErrorBody = {
    code,
    error: { code, message: code, requestId, ...(details ? { details } : {}) },
  };
  return NextResponse.json(body, {
    status,
    headers: {
      ...Object.fromEntries(new Headers(headers)),
      "cache-control": "no-store",
      "x-request-id": requestId,
    },
  });
}

function errorResponse(error: unknown, requestId: string, fallbackCode: string) {
  if (error instanceof ApiError) {
    return apiErrorResponse(error.code, error.status, requestId, error.details, error.headers);
  }
  if (error instanceof SupabaseRequestError) {
    const status = error.status >= 400 && error.status < 600 ? error.status : 502;
    return apiErrorResponse(error.code, status, requestId);
  }
  return apiErrorResponse(fallbackCode, 500, requestId);
}

async function normalizeErrorResponse(response: Response, requestId: string) {
  const payload = await response.clone().json().catch(() => ({})) as {
    code?: string;
    field?: string;
    message?: string;
    error?: ApiErrorBody["error"];
    [key: string]: unknown;
  };
  if (payload.error?.code) {
    const headers = new Headers(response.headers);
    if (!headers.has("cache-control")) headers.set("cache-control", "no-store");
    headers.set("x-request-id", requestId);
    return NextResponse.json(
      { ...payload, code: payload.error.code, error: { ...payload.error, requestId } },
      { status: response.status, headers },
    );
  }
  const code = typeof payload.code === "string" ? payload.code : `HTTP_${response.status}`;
  const details = {
    ...(typeof payload.field === "string" ? { field: payload.field } : {}),
    ...Object.fromEntries(
      Object.entries(payload).filter(([key]) => !["code", "field", "message", "error"].includes(key)),
    ),
  };
  const headers = new Headers(response.headers);
  if (!headers.has("cache-control")) headers.set("cache-control", "no-store");
  headers.set("x-request-id", requestId);
  return NextResponse.json(
    {
      ...payload,
      code,
      error: {
        code,
        message: typeof payload.message === "string" ? payload.message : code,
        requestId,
        ...(Object.keys(details).length ? { details } : {}),
      },
    } satisfies ApiErrorBody & Record<string, unknown>,
    { status: response.status, headers },
  );
}

export function apiRoute<Context = unknown>(
  handler: (request: Request, context: Context) => Promise<Response>,
  fallbackCode = "INTERNAL_SERVER_ERROR",
) {
  return async (request: Request, context: Context) => {
    const requestId = requestIdFor(request);
    try {
      const response = await handler(request, context);
      if (!response.headers.has("cache-control")) response.headers.set("cache-control", "no-store");
      if (response.status >= 300 && response.status < 400) {
        response.headers.set("x-request-id", requestId);
        return response;
      }
      if (!response.ok) return normalizeErrorResponse(response, requestId);
      response.headers.set("x-request-id", requestId);
      return response;
    } catch (error) {
      return errorResponse(error, requestId, fallbackCode);
    }
  };
}

export async function requireApiUser(): Promise<AppUser> {
  const user = await getCurrentUser();
  if (user) return user;
  const cookieStore = await cookies();
  throw new ApiError(
    cookieStore.has(authCookieNames.refresh) ? "SESSION_REFRESH_REQUIRED" : "AUTH_REQUIRED",
    401,
  );
}

export async function requireApiRole(...roles: AppRole[]) {
  const user = await requireApiUser();
  if (!roles.includes(user.role)) throw new ApiError("ROLE_FORBIDDEN", 403);
  return user;
}

export async function requireApiAal2() {
  const token = (await cookies()).get(authCookieNames.access)?.value;
  if (!token || decodeJwtPayload(token).aal !== "aal2") throw new ApiError("MFA_REQUIRED", 403);
}

export async function requireApiCapability(capability: Capability) {
  const user = await requireApiUser();
  if (!hasCapability(user.role, capability)) {
    throw new ApiError("CAPABILITY_FORBIDDEN", 403, "CAPABILITY_FORBIDDEN", { capability });
  }
  if (aal2Capabilities.has(capability)) await requireApiAal2();
  return user;
}

const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export function parsePagination(searchParams: URLSearchParams, defaultPageSize = 20) {
  const parsed = paginationSchema.safeParse({
    page: searchParams.get("page") ?? 1,
    pageSize: searchParams.get("pageSize") ?? defaultPageSize,
  });
  if (!parsed.success) {
    throw new ApiError("INVALID_PAGINATION", 400, "INVALID_PAGINATION", {
      field: String(parsed.error.issues[0]?.path[0] ?? "page"),
    });
  }
  return parsed.data;
}

export function parseUuid(value: string, field = "id") {
  const parsed = z.uuid().safeParse(value);
  if (!parsed.success) throw new ApiError("INVALID_ID", 400, "INVALID_ID", { field });
  return parsed.data;
}
