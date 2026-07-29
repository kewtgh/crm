import { databaseJson } from "./db/gateway";
import { dateKeyFor, normalizeTimezone, type SupportedTimezone } from "./timezone";
import type { AppUser } from "./user";

type WorkspaceRow = {
  id: string;
  name: string;
  default_currency: string;
  business_timezone: string;
  turnstile_enabled: boolean;
};

export type WorkspaceSettings = {
  id: string;
  name: string;
  defaultCurrency: string;
  businessTimezone: SupportedTimezone;
  businessDate: string;
  turnstileEnabled: boolean;
};

export async function loadWorkspaceSettings(user: AppUser): Promise<WorkspaceSettings> {
  void user;
  const workspaceId = await databaseJson<string>("/db/rpc/current_workspace_id", {
    method: "POST",
    body: "{}",
  });
  const rows = await databaseJson<WorkspaceRow[]>(
    `/db/table/workspaces?select=id,name,default_currency,business_timezone,turnstile_enabled&id=eq.${workspaceId}&limit=1`,
  );
  const row = rows[0];
  if (!row) throw new Error("WORKSPACE_SETTINGS_NOT_FOUND");
  const businessTimezone = normalizeTimezone(row.business_timezone);
  return {
    id: row.id,
    name: row.name,
    defaultCurrency: row.default_currency,
    businessTimezone,
    businessDate: dateKeyFor(new Date(), businessTimezone),
    turnstileEnabled: row.turnstile_enabled,
  };
}

export async function updateWorkspaceTurnstileEnabled(
  user: AppUser,
  turnstileEnabled: boolean,
) {
  await databaseJson<boolean>("/db/rpc/set_workspace_turnstile_enabled", {
    method: "POST",
    body: JSON.stringify({ next_enabled: turnstileEnabled }),
  });
  return loadWorkspaceSettings(user);
}

export async function updateWorkspaceBusinessTimezone(
  user: AppUser,
  businessTimezone: SupportedTimezone,
) {
  await databaseJson<string>("/db/rpc/set_workspace_business_timezone", {
    method: "POST",
    body: JSON.stringify({ next_timezone: businessTimezone }),
  });
  return loadWorkspaceSettings(user);
}
