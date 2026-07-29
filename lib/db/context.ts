import type { PoolClient, QueryResult, QueryResultRow } from "pg";
import type { AppRole } from "../roles";
import { withPoolClient, type DatabasePoolKind } from "./pools";

export type AuthorizationContext = {
  userId: string;
  workspaceId: string;
  role: AppRole;
  aal: "aal1" | "aal2";
};

export type DatabaseContext =
  | { kind: "user"; authorization: AuthorizationContext }
  | { kind: "system" }
  | { kind: "worker" };

async function setContext(client: PoolClient, context: DatabaseContext) {
  if (context.kind === "user") {
    const { userId, workspaceId, role, aal } = context.authorization;
    await client.query(
      `select
        set_config('app.user_id', $1, true),
        set_config('app.workspace_id', $2, true),
        set_config('app.role', $3, true),
        set_config('app.aal', $4, true),
        set_config('app.system', 'false', true)`,
      [userId, workspaceId, role, aal],
    );
    const timezone = await client.query<{ business_timezone: string }>(
      `select business_timezone
       from public.workspaces
       where id = $1`,
      [workspaceId],
    );
    const businessTimezone = timezone.rows[0]?.business_timezone;
    if (!businessTimezone) throw new Error("WORKSPACE_BUSINESS_TIMEZONE_NOT_FOUND");
    await client.query("select set_config('TimeZone', $1, true)", [businessTimezone]);
    return;
  }
  await client.query(
    `select
      set_config('app.user_id', '', true),
      set_config('app.workspace_id', '', true),
      set_config('app.role', '', true),
      set_config('app.aal', 'aal2', true),
      set_config('app.system', 'true', true)`,
  );
}

export async function withDatabaseContext<T>(
  context: DatabaseContext,
  callback: (client: PoolClient) => Promise<T>,
) {
  const kind: DatabasePoolKind = context.kind === "user"
    ? "app"
    : context.kind === "worker"
      ? "worker"
      : "system";
  return withPoolClient(kind, async (client) => {
    await client.query("begin");
    try {
      await client.query("set local statement_timeout = '15s'");
      await client.query("set local lock_timeout = '5s'");
      await setContext(client, context);
      const result = await callback(client);
      await client.query("commit");
      return result;
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    }
  });
}

export function contextualQuery<Row extends QueryResultRow = QueryResultRow>(
  client: PoolClient,
  text: string,
  values: unknown[] = [],
): Promise<QueryResult<Row>> {
  return client.query<Row>(text, values);
}
