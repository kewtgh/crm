import { readdir } from "node:fs/promises";
import path from "node:path";
import { closeWorkerDatabase, workerQuery } from "./lib/worker-database.mjs";

try {
  const expected = (await readdir(path.resolve("db", "migrations")))
    .filter((name) => /^\d{12,}_[a-z0-9_]+\.sql$/.test(name))
    .sort()
    .at(-1);
  const result = await workerQuery("select public.service_schema_version() as version");
  if (!expected || result.rows[0]?.version !== expected) {
    throw new Error("WORKER_SCHEMA_NOT_CURRENT");
  }
  process.stdout.write(`[worker-schema] current migration ${expected} is applied.\n`);
} finally {
  await closeWorkerDatabase().catch(() => undefined);
}
