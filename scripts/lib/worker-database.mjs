import pg from "pg";

const connectionString = process.env.WORKER_DATABASE_URL?.trim();
if (!connectionString) throw new Error("WORKER_DATABASE_URL_NOT_CONFIGURED");

const pool = new pg.Pool({
  connectionString,
  ssl: /^(1|true|yes|on)$/i.test(process.env.DATABASE_SSL ?? "")
    ? { rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== "false" }
    : undefined,
  max: Math.min(20, Math.max(1, Number(process.env.WORKER_DATABASE_POOL_MAX ?? 4))),
  connectionTimeoutMillis: 10_000,
  idleTimeoutMillis: 30_000,
  allowExitOnIdle: true,
  application_name: "lumina-crm-worker",
});

const identifierPattern = /^[a-z_][a-z0-9_]*$/i;
const quoteIdentifier = (value) => {
  if (!identifierPattern.test(value)) throw new Error("INVALID_DATABASE_IDENTIFIER");
  return `"${value}"`;
};

function splitTopLevel(value) {
  const values = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character === "(") depth += 1;
    if (character === ")") depth -= 1;
    if (character === "," && depth === 0) {
      values.push(value.slice(start, index));
      start = index + 1;
    }
  }
  values.push(value.slice(start));
  return values.map((entry) => entry.trim()).filter(Boolean);
}

function nestedSelections(select) {
  if (!select) return [];
  const selections = [];
  for (const entry of splitTopLevel(select)) {
    const open = entry.indexOf("(");
    if (open < 1 || !entry.endsWith(")")) continue;
    const relationSpec = entry.slice(0, open);
    const nested = entry.slice(open + 1, -1);
    const [aliasPart, targetPart] = relationSpec.includes(":")
      ? relationSpec.split(":", 2)
      : [relationSpec, relationSpec];
    const [table, constraintPart] = targetPart.split("!", 2);
    if (!identifierPattern.test(aliasPart) || !identifierPattern.test(table)) continue;
    selections.push({
      alias: aliasPart,
      table,
      constraint: constraintPart && constraintPart !== "inner" && identifierPattern.test(constraintPart)
        ? constraintPart
        : undefined,
      children: nestedSelections(nested),
    });
  }
  return selections;
}

const relationCache = new Map();
async function resolveRelation(client, baseTable, targetTable, constraint) {
  const key = `${baseTable}:${targetTable}:${constraint ?? ""}`;
  if (relationCache.has(key)) return relationCache.get(key);
  const result = await client.query(
    `select
      constraint_record.conname as constraint,
      child.relname as "childTable",
      child_column.attname as "childColumn",
      parent.relname as "parentTable",
      parent_column.attname as "parentColumn",
      exists(
        select 1 from pg_index index_record
        where index_record.indrelid=child.oid
          and index_record.indisunique
          and child_column.attnum=any(index_record.indkey)
      ) as "childUnique"
     from pg_constraint constraint_record
     join pg_class child on child.oid=constraint_record.conrelid
     join pg_namespace child_namespace on child_namespace.oid=child.relnamespace
     join pg_class parent on parent.oid=constraint_record.confrelid
     join pg_namespace parent_namespace on parent_namespace.oid=parent.relnamespace
     join pg_attribute child_column
       on child_column.attrelid=child.oid and child_column.attnum=constraint_record.conkey[1]
     join pg_attribute parent_column
       on parent_column.attrelid=parent.oid and parent_column.attnum=constraint_record.confkey[1]
     where constraint_record.contype='f'
       and child_namespace.nspname='public' and parent_namespace.nspname='public'
       and ((child.relname=$1 and parent.relname=$2) or (child.relname=$2 and parent.relname=$1))
       and ($3::text is null or constraint_record.conname=$3)
     order by (constraint_record.conname=$3) desc,constraint_record.oid
     limit 1`,
    [baseTable, targetTable, constraint ?? null],
  );
  const relation = result.rows[0] ?? null;
  relationCache.set(key, relation);
  return relation;
}

async function hydrateRelations(client, table, rows, selections) {
  for (const selection of selections) {
    const relation = await resolveRelation(client, table, selection.table, selection.constraint);
    if (!relation) continue;
    const baseIsChild = relation.childTable === table;
    const baseColumn = baseIsChild ? relation.childColumn : relation.parentColumn;
    const targetColumn = baseIsChild ? relation.parentColumn : relation.childColumn;
    const values = [...new Set(rows.map((row) => row[baseColumn]).filter((value) => value != null))];
    if (!values.length) {
      for (const row of rows) row[selection.alias] = baseIsChild || relation.childUnique ? null : [];
      continue;
    }
    const targetRows = (await client.query(
      `select * from public.${quoteIdentifier(selection.table)}
       where ${quoteIdentifier(targetColumn)}=any($1)`,
      [values],
    )).rows;
    await hydrateRelations(client, selection.table, targetRows, selection.children);
    const grouped = new Map();
    for (const target of targetRows) {
      const group = grouped.get(target[targetColumn]) ?? [];
      group.push(target);
      grouped.set(target[targetColumn], group);
    }
    for (const row of rows) {
      const matches = grouped.get(row[baseColumn]) ?? [];
      row[selection.alias] = baseIsChild || relation.childUnique ? matches[0] ?? null : matches;
    }
  }
  return rows;
}

function parseList(value) {
  const inner = value.startsWith("(") && value.endsWith(")") ? value.slice(1, -1) : value;
  return splitTopLevel(inner).map((entry) => entry.replace(/^"(.*)"$/, "$1"));
}

function filterSql(column, rawValue, values) {
  const quoted = quoteIdentifier(column);
  if (rawValue.startsWith("not.")) return `not (${filterSql(column, rawValue.slice(4), values)})`;
  const separator = rawValue.indexOf(".");
  if (separator < 1) throw new Error("INVALID_DATABASE_FILTER");
  const operator = rawValue.slice(0, separator);
  const raw = rawValue.slice(separator + 1);
  if (operator === "is") {
    if (raw === "null") return `${quoted} is null`;
    if (raw === "true") return `${quoted} is true`;
    if (raw === "false") return `${quoted} is false`;
  }
  if (operator === "in") {
    values.push(parseList(raw));
    return `${quoted}=any($${values.length})`;
  }
  if (operator === "cs" || operator === "ov") {
    values.push(raw.startsWith("{") && raw.endsWith("}") ? parseList(`(${raw.slice(1, -1)})`) : raw);
    return `${quoted} ${operator === "cs" ? "@>" : "&&"} $${values.length}`;
  }
  const operators = {
    eq: "=", neq: "<>", gt: ">", gte: ">=", lt: "<", lte: "<=", like: "like", ilike: "ilike",
  };
  if (!operators[operator]) throw new Error("INVALID_DATABASE_FILTER");
  values.push(["like", "ilike"].includes(operator) ? raw.replaceAll("*", "%") : raw);
  return `${quoted} ${operators[operator]} $${values.length}`;
}

function queryParts(searchParams) {
  const values = [];
  const filters = [];
  const reserved = new Set(["select", "order", "limit", "offset", "on_conflict"]);
  for (const [column, value] of searchParams.entries()) {
    if (reserved.has(column)) continue;
    if (column === "or") {
      const entries = splitTopLevel(value.startsWith("(") ? value.slice(1, -1) : value);
      filters.push(`(${entries.map((entry) => {
        const first = entry.indexOf(".");
        return filterSql(entry.slice(0, first), entry.slice(first + 1), values);
      }).join(" or ")})`);
    } else {
      filters.push(filterSql(column, value, values));
    }
  }
  return { values, where: filters.length ? ` where ${filters.join(" and ")}` : "" };
}

function orderSql(value) {
  if (!value) return "";
  return ` order by ${splitTopLevel(value).map((entry) => {
    const [column, direction = "asc", nulls] = entry.split(".");
    return `${quoteIdentifier(column)} ${direction === "desc" ? "desc" : "asc"}${
      nulls === "nullsfirst" ? " nulls first" : nulls === "nullslast" ? " nulls last" : ""
    }`;
  }).join(",")}`;
}

function limitSql(searchParams, headers) {
  const range = headers.get("range");
  if (range && /^\d+-\d+$/.test(range)) {
    const [start, end] = range.split("-").map(Number);
    return ` limit ${end - start + 1} offset ${start}`;
  }
  const limit = Number(searchParams.get("limit") ?? 0);
  const offset = Number(searchParams.get("offset") ?? 0);
  return `${Number.isInteger(limit) && limit > 0 ? ` limit ${Math.min(limit, 100_000)}` : ""}${
    Number.isInteger(offset) && offset > 0 ? ` offset ${offset}` : ""
  }`;
}

const functionSetCache = new Map();
async function functionReturnsSet(client, name) {
  if (functionSetCache.has(name)) return functionSetCache.get(name);
  const result = await client.query(
    `select procedure.proretset
     from pg_proc procedure join pg_namespace namespace on namespace.oid=procedure.pronamespace
     where namespace.nspname='public' and procedure.proname=$1
     order by procedure.oid desc limit 1`,
    [name],
  );
  const value = result.rows[0]?.proretset ?? false;
  functionSetCache.set(name, value);
  return value;
}

async function rpc(client, name, options) {
  quoteIdentifier(name);
  const body = typeof options.body === "string" && options.body.trim()
    ? JSON.parse(options.body)
    : options.body ?? {};
  const entries = Object.entries(body);
  entries.forEach(([argument]) => quoteIdentifier(argument));
  const result = await client.query(
    `select * from public.${quoteIdentifier(name)}(${
      entries.map(([argument], index) => `${quoteIdentifier(argument)}=>$${index + 1}`).join(",")
    })`,
    entries.map(([, value]) => value),
  );
  if (await functionReturnsSet(client, name)) return result.rows;
  const row = result.rows[0];
  if (!row) return null;
  const keys = Object.keys(row);
  return keys.length === 1 && keys[0] === name ? row[name] : row;
}

function bodyRows(options) {
  const parsed = typeof options.body === "string" ? JSON.parse(options.body) : options.body;
  const rows = Array.isArray(parsed) ? parsed : [parsed];
  if (!rows.length || rows.some((row) => !row || typeof row !== "object" || Array.isArray(row))) {
    throw new Error("INVALID_DATABASE_BODY");
  }
  return rows;
}

async function table(client, name, searchParams, options) {
  quoteIdentifier(name);
  const method = String(options.method ?? "GET").toUpperCase();
  const headers = new Headers(options.headers);
  if (method === "GET") {
    const filters = queryParts(searchParams);
    const rows = (await client.query(
      `select * from public.${quoteIdentifier(name)}${filters.where}${
        orderSql(searchParams.get("order"))
      }${limitSql(searchParams, headers)}`,
      filters.values,
    )).rows;
    return hydrateRelations(client, name, rows, nestedSelections(searchParams.get("select")));
  }
  if (method === "POST") {
    const rows = bodyRows(options);
    const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
    const values = [];
    const tuples = rows.map((row) => `(${columns.map((column) => {
      values.push(row[column] ?? null);
      return `$${values.length}`;
    }).join(",")})`);
    const result = await client.query(
      `insert into public.${quoteIdentifier(name)}(${columns.map(quoteIdentifier).join(",")})
       values ${tuples.join(",")} returning *`,
      values,
    );
    return headers.get("prefer")?.includes("return=minimal") ? undefined : result.rows;
  }
  if (method === "PATCH" || method === "PUT") {
    const [body] = bodyRows(options);
    const values = [];
    const assignments = Object.entries(body).map(([column, value]) => {
      values.push(value);
      return `${quoteIdentifier(column)}=$${values.length}`;
    });
    const filters = queryParts(searchParams);
    if (!filters.where) throw new Error("DATABASE_FILTER_REQUIRED");
    const where = filters.where.replace(/\$(\d+)/g, (_, index) => `$${Number(index) + values.length}`);
    const result = await client.query(
      `update public.${quoteIdentifier(name)} set ${assignments.join(",")}${where} returning *`,
      [...values, ...filters.values],
    );
    return headers.get("prefer")?.includes("return=minimal") ? undefined : result.rows;
  }
  if (method === "DELETE") {
    const filters = queryParts(searchParams);
    if (!filters.where) throw new Error("DATABASE_FILTER_REQUIRED");
    const result = await client.query(
      `delete from public.${quoteIdentifier(name)}${filters.where} returning *`,
      filters.values,
    );
    return headers.get("prefer")?.includes("return=representation") ? result.rows : undefined;
  }
  throw new Error("DATABASE_METHOD_NOT_ALLOWED");
}

export async function workerJson(path, options = {}) {
  const url = new URL(path, "http://database.local");
  const rpcMatch = url.pathname.match(/^\/db\/rpc\/([a-z_][a-z0-9_]*)$/i);
  const tableMatch = url.pathname.match(/^\/db\/table\/([a-z_][a-z0-9_]*)$/i);
  if (!rpcMatch && !tableMatch) throw new Error("INVALID_DATABASE_PATH");
  const client = await pool.connect();
  try {
    return rpcMatch
      ? await rpc(client, rpcMatch[1], options)
      : await table(client, tableMatch[1], url.searchParams, options);
  } catch (error) {
    const code = error?.code ? ` ${error.code}` : "";
    throw new Error(`${url.pathname} failed${code}: ${error?.message ?? "unknown"}`, { cause: error });
  } finally {
    client.release();
  }
}

export async function workerQuery(text, values = []) {
  return pool.query(text, values);
}

export async function closeWorkerDatabase() {
  await pool.end();
}
