import pg from "pg";

export async function runSchemaContract(label, {
  tables = [],
  functions = [],
  columns = {},
}) {
  const connectionString = process.env.SYSTEM_DATABASE_URL?.trim();
  if (!connectionString) throw new Error("SYSTEM_DATABASE_URL_NOT_CONFIGURED");
  const client = new pg.Client({
    connectionString,
    application_name: `lumina-schema-contract-${label}`,
  });
  await client.connect();
  try {
    const tableResult = await client.query(
      `select table_name from information_schema.tables
       where table_schema='public' and table_name=any($1)`,
      [tables],
    );
    const actualTables = new Set(tableResult.rows.map((row) => row.table_name));
    const missingTables = tables.filter((name) => !actualTables.has(name));
    if (missingTables.length) throw new Error(`${label} missing tables: ${missingTables.join(", ")}`);

    const functionResult = await client.query(
      `select distinct procedure.proname
       from pg_proc procedure join pg_namespace namespace on namespace.oid=procedure.pronamespace
       where namespace.nspname='public' and procedure.proname=any($1)`,
      [functions],
    );
    const actualFunctions = new Set(functionResult.rows.map((row) => row.proname));
    const missingFunctions = functions.filter((name) => !actualFunctions.has(name));
    if (missingFunctions.length) throw new Error(`${label} missing functions: ${missingFunctions.join(", ")}`);

    for (const [table, expectedColumns] of Object.entries(columns)) {
      const result = await client.query(
        `select column_name from information_schema.columns
         where table_schema='public' and table_name=$1`,
        [table],
      );
      const actual = new Set(result.rows.map((row) => row.column_name));
      const missing = expectedColumns.filter((name) => !actual.has(name));
      if (missing.length) throw new Error(`${label} ${table} missing columns: ${missing.join(", ")}`);
    }
    process.stdout.write(
      `[schema:${label}] ${tables.length} tables, ${functions.length} functions, `
      + `${Object.keys(columns).length} column contracts verified.\n`,
    );
  } finally {
    await client.end();
  }
}
