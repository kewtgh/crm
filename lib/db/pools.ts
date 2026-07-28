import { Kysely, PostgresDialect } from "kysely";
import pg, { type PoolClient, type QueryResult, type QueryResultRow } from "pg";

const { Pool } = pg;

export type DatabasePoolKind = "app" | "system" | "worker";

type UntypedDatabase = {
  [table: string]: Record<string, unknown>;
};

const globalPools = globalThis as typeof globalThis & {
  __luminaPgPools?: Partial<Record<DatabasePoolKind, pg.Pool>>;
  __luminaKysely?: Partial<Record<DatabasePoolKind, Kysely<UntypedDatabase>>>;
};

function connectionString(kind: DatabasePoolKind) {
  const key = kind === "app"
    ? "DATABASE_URL"
    : kind === "system"
      ? "SYSTEM_DATABASE_URL"
      : "WORKER_DATABASE_URL";
  const configured = process.env[key]?.trim();
  if (configured) return configured;
  if (process.env.NODE_ENV !== "production") {
    const fallback = process.env.DATABASE_URL?.trim();
    if (fallback) return fallback;
  }
  throw new Error(`${key}_NOT_CONFIGURED`);
}

function sslConfiguration() {
  if (!/^(1|true|yes|on)$/i.test(process.env.DATABASE_SSL ?? "")) return undefined;
  return {
    rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== "false",
  };
}

function maxConnections(kind: DatabasePoolKind) {
  const key = kind === "app"
    ? "DATABASE_POOL_MAX"
    : kind === "system"
      ? "SYSTEM_DATABASE_POOL_MAX"
      : "WORKER_DATABASE_POOL_MAX";
  const parsed = Number(process.env[key] ?? (kind === "app" ? 12 : 4));
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 50 ? parsed : kind === "app" ? 12 : 4;
}

export function databasePool(kind: DatabasePoolKind = "app") {
  globalPools.__luminaPgPools ??= {};
  const existing = globalPools.__luminaPgPools[kind];
  if (existing) return existing;
  const pool = new Pool({
    connectionString: connectionString(kind),
    ssl: sslConfiguration(),
    max: maxConnections(kind),
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000,
    maxLifetimeSeconds: 60 * 30,
    allowExitOnIdle: process.env.NODE_ENV !== "production",
    application_name: `lumina-crm-${kind}`,
  });
  pool.on("error", (error) => {
    console.error(`[database:${kind}] idle client error`, error);
  });
  globalPools.__luminaPgPools[kind] = pool;
  return pool;
}

export function kyselyDatabase(kind: DatabasePoolKind = "app") {
  globalPools.__luminaKysely ??= {};
  const existing = globalPools.__luminaKysely[kind];
  if (existing) return existing;
  const database = new Kysely<UntypedDatabase>({
    dialect: new PostgresDialect({ pool: databasePool(kind) }),
  });
  globalPools.__luminaKysely[kind] = database;
  return database;
}

export async function withPoolClient<T>(
  kind: DatabasePoolKind,
  callback: (client: PoolClient) => Promise<T>,
) {
  const client = await databasePool(kind).connect();
  try {
    return await callback(client);
  } finally {
    client.release();
  }
}

export async function poolQuery<Row extends QueryResultRow = QueryResultRow>(
  kind: DatabasePoolKind,
  text: string,
  values: unknown[] = [],
): Promise<QueryResult<Row>> {
  return databasePool(kind).query<Row>(text, values);
}

export async function closeDatabasePools() {
  const pools = Object.values(globalPools.__luminaPgPools ?? {});
  await Promise.all(pools.map((pool) => pool?.end()));
  globalPools.__luminaPgPools = {};
  globalPools.__luminaKysely = {};
}
