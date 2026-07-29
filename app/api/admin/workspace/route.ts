import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, apiRoute, requireApiAal2, requireApiRole } from "@/lib/api";
import { DatabaseRequestError } from "@/lib/db/gateway";
import { mutationIsTrusted } from "@/lib/request-security";
import { SUPPORTED_TIMEZONES } from "@/lib/timezone";
import {
  loadWorkspaceSettings,
  updateWorkspaceBusinessTimezone,
  updateWorkspaceTurnstileEnabled,
} from "@/lib/workspace-settings-repository";

const schema = z.union([
  z.object({ businessTimezone: z.enum(SUPPORTED_TIMEZONES) }).strict(),
  z.object({ turnstileEnabled: z.boolean() }).strict(),
]);

function failure(error: unknown) {
  if (error instanceof DatabaseRequestError) {
    return NextResponse.json({ code: error.code }, { status: error.status });
  }
  throw error;
}

async function get() {
  const user = await requireApiRole("SUPER_ADMIN", "ADMIN");
  await requireApiAal2();
  try {
    return NextResponse.json({ settings: await loadWorkspaceSettings(user) });
  } catch (error) {
    return failure(error);
  }
}

async function patch(request: Request) {
  if (!mutationIsTrusted(request)) throw new ApiError("UNTRUSTED_ORIGIN", 403);
  const user = await requireApiRole("SUPER_ADMIN", "ADMIN");
  await requireApiAal2();
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) throw new ApiError("WORKSPACE_SETTINGS_INVALID", 400);
  try {
    const settings = "businessTimezone" in parsed.data
      ? await updateWorkspaceBusinessTimezone(user, parsed.data.businessTimezone)
      : await updateWorkspaceTurnstileEnabled(user, parsed.data.turnstileEnabled);
    return NextResponse.json({
      settings,
    });
  } catch (error) {
    return failure(error);
  }
}

export const GET = apiRoute(get, "WORKSPACE_SETTINGS_LOAD_FAILED");
export const PATCH = apiRoute(patch, "WORKSPACE_SETTINGS_SAVE_FAILED");
