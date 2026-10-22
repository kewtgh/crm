import pg from "pg";
import { readDatabaseSchema } from "./lib/deployment-schema.mjs";

const client = new pg.Client({ connectionString: process.env.MIGRATION_DATABASE_URL,
  connectionTimeoutMillis: 10_000, statement_timeout: 10_000 });
try {
  await client.connect();
  process.stdout.write(`SCHEMA_EVIDENCE=${JSON.stringify(await readDatabaseSchema(client))}\n`);
} catch {
  throw new Error("DATABASE_SCHEMA_EVIDENCE_UNAVAILABLE");
} finally { await client.end(); }
