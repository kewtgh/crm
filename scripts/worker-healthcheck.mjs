import { readdir } from "node:fs/promises";
import path from "node:path";
import { closeWorkerDatabase, workerJson, workerQuery } from "./lib/worker-database.mjs";

const allWorkers = [
  "REMINDERS",
  "NOTIFICATION_OUTBOX",
  "CALENDAR_DELIVERIES",
  "COMMUNICATION_DELIVERY",
  "GENERATED_JOBS",
  ...(/^(1|true|yes|on)$/i.test(process.env.WEBHOOKS_ENABLED ?? "") ? ["WEBHOOK_INBOX"] : []),
  ...(/^(1|true|yes|on)$/i.test(process.env.INTEGRATION_SYNC_ENABLED ?? "") ? ["INTEGRATION_SYNC"] : []),
];

try {
  const migrationFiles = (await readdir(path.resolve("db", "migrations")))
    .filter((name) => /^\d{12,}_[a-z0-9_]+\.sql$/.test(name))
    .sort();
  const expected = migrationFiles.at(-1);
  const schema = await workerQuery("select public.service_schema_version() as version");
  if (!expected || schema.rows[0]?.version !== expected) {
    throw new Error("WORKER_SCHEMA_NOT_CURRENT");
  }
  const snapshot = await workerJson("/db/rpc/service_readiness_snapshot_for_workers", {
    method: "POST",
    body: JSON.stringify({
      target_workspace: process.env.CRM_WORKSPACE_ID,
      enabled_workers: allWorkers,
    }),
  });
  if (snapshot?.database !== true) throw new Error("WORKER_DATABASE_NOT_READY");
  for (const key of ["missingWorkers", "staleWorkers", "failedJobs", "stuckJobs"]) {
    if (Number(snapshot?.[key] ?? 0) !== 0) throw new Error(`WORKER_HEALTH_${key.toUpperCase()}`);
  }
  process.stdout.write("[worker-health] heartbeat, queue, database and schema are healthy.\n");
} finally {
  await closeWorkerDatabase().catch(() => undefined);
}
