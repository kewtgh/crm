import { createHash } from "node:crypto";

export function schemaEvidence(rows) {
  const ordered = [...rows].sort((left, right) => left.name.localeCompare(right.name, "en"));
  if (ordered.some(row => !/^\d{3,}_[a-z0-9_-]+\.sql$/i.test(row.name)
    || !/^[0-9a-f]{64}$/.test(row.checksum))
    || new Set(ordered.map(row => row.name)).size !== ordered.length) throw new Error("SCHEMA_EVIDENCE_INVALID");
  return { head: ordered.at(-1)?.name ?? null, count: ordered.length,
    digest: createHash("sha256").update(JSON.stringify(ordered.map(({ name, checksum }) => [name, checksum]))).digest("hex") };
}

export function schemasMatch(database, image) {
  return Boolean(database && image && /^[0-9a-f]{64}$/.test(database.digest)
    && database.digest === image.digest && database.count === image.count && database.head === image.head);
}

export function applicationRollbackDecision({ migrationState, database, previousImageSchema }) {
  if (!["NOT_STARTED", "COMPLETED"].includes(migrationState)) {
    return { status: "UNSAFE", reason: "MIGRATION_OUTCOME_UNCERTAIN" };
  }
  if (!schemasMatch(database, previousImageSchema)) return { status: "UNSAFE", reason: "APPLICATION_ROLLBACK_UNSAFE" };
  return { status: "REQUIRED", reason: "EXACT_SCHEMA_COMPATIBILITY_PROVEN" };
}

export async function readDatabaseSchema(client) {
  await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
  try {
    const exists = await client.query("select to_regclass('app_meta.schema_migrations') as ledger");
    const result = exists.rows[0]?.ledger
      ? await client.query("select name, checksum from app_meta.schema_migrations order by name") : { rows: [] };
    const evidence = schemaEvidence(result.rows);
    await client.query("COMMIT");
    return evidence;
  } catch {
    await client.query("ROLLBACK").catch(() => {});
    throw new Error("DATABASE_SCHEMA_EVIDENCE_UNAVAILABLE");
  }
}
