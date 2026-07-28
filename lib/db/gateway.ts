import { cookies } from "next/headers";
import type { PoolClient } from "pg";
import { loadSession, sessionCookieName } from "../auth/session-store";
import { withDatabaseContext, type DatabaseContext } from "./context";

export class DatabaseRequestError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

const postgresCodeMap: Record<string, string> = {
  "23503": "RELATED_RECORD_CONFLICT",
  "23505": "RECORD_CONFLICT",
  "23514": "CONSTRAINT_VIOLATION",
  "22P02": "INVALID_INPUT",
  "42501": "DATABASE_PERMISSION_DENIED",
  "57014": "DATABASE_TIMEOUT",
};

export function normalizeDatabaseErrorCode(code?: string, message?: string) {
  if (code === "P0001" && message && /^[a-z][a-z0-9_]{2,80}$/.test(message)) {
    return message.toUpperCase();
  }
  return postgresCodeMap[code ?? ""] ?? code ?? "DATABASE_REQUEST_FAILED";
}

const identifierPattern = /^[a-z_][a-z0-9_]*$/i;
const quoteIdentifier = (value: string) => {
  if (!identifierPattern.test(value)) throw new DatabaseRequestError(400, "INVALID_DATABASE_IDENTIFIER", "Invalid database identifier");
  return `"${value}"`;
};

type NestedSelection = {
  alias: string;
  table: string;
  constraint?: string;
  children: NestedSelection[];
};

type Relation = {
  constraint: string;
  childTable: string;
  childColumn: string;
  parentTable: string;
  parentColumn: string;
  childUnique: boolean;
};

const relationCache = new Map<string, Relation | null>();
const functionSetCache = new Map<string, boolean>();

function splitTopLevel(value: string) {
  const values: string[] = [];
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

function nestedSelections(select: string | null): NestedSelection[] {
  if (!select) return [];
  const selections: NestedSelection[] = [];
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
    const constraint = constraintPart && constraintPart !== "inner" && identifierPattern.test(constraintPart)
      ? constraintPart
      : undefined;
    selections.push({
      alias: aliasPart,
      table,
      constraint,
      children: nestedSelections(nested),
    });
  }
  return selections;
}

async function resolveRelation(
  client: PoolClient,
  baseTable: string,
  targetTable: string,
  constraint?: string,
) {
  const cacheKey = `${baseTable}:${targetTable}:${constraint ?? ""}`;
  if (relationCache.has(cacheKey)) return relationCache.get(cacheKey) ?? null;
  const result = await client.query<Relation>(
    `select
      constraint_record.conname as constraint,
      child.relname as "childTable",
      child_column.attname as "childColumn",
      parent.relname as "parentTable",
      parent_column.attname as "parentColumn",
      exists(
        select 1 from pg_index index_record
        where index_record.indrelid = child.oid
          and index_record.indisunique
          and child_column.attnum = any(index_record.indkey)
      ) as "childUnique"
    from pg_constraint constraint_record
    join pg_class child on child.oid = constraint_record.conrelid
    join pg_namespace child_namespace on child_namespace.oid = child.relnamespace
    join pg_class parent on parent.oid = constraint_record.confrelid
    join pg_namespace parent_namespace on parent_namespace.oid = parent.relnamespace
    join pg_attribute child_column
      on child_column.attrelid = child.oid
      and child_column.attnum = constraint_record.conkey[1]
    join pg_attribute parent_column
      on parent_column.attrelid = parent.oid
      and parent_column.attnum = constraint_record.confkey[1]
    where constraint_record.contype = 'f'
      and child_namespace.nspname = 'public'
      and parent_namespace.nspname = 'public'
      and (
        (child.relname = $1 and parent.relname = $2)
        or (child.relname = $2 and parent.relname = $1)
      )
      and ($3::text is null or constraint_record.conname = $3)
    order by (constraint_record.conname = $3) desc, constraint_record.oid
    limit 1`,
    [baseTable, targetTable, constraint ?? null],
  );
  const relation = result.rows[0] ?? null;
  relationCache.set(cacheKey, relation);
  return relation;
}

async function hydrateRelations(
  client: PoolClient,
  table: string,
  rows: Array<Record<string, unknown>>,
  selections: NestedSelection[],
) {
  if (!rows.length || !selections.length) return rows;
  for (const selection of selections) {
    const relation = await resolveRelation(client, table, selection.table, selection.constraint);
    if (!relation) continue;
    const baseIsChild = relation.childTable === table;
    const baseColumn = baseIsChild ? relation.childColumn : relation.parentColumn;
    const targetColumn = baseIsChild ? relation.parentColumn : relation.childColumn;
    const values = [...new Set(rows.map((row) => row[baseColumn]).filter((value) => value !== null && value !== undefined))];
    if (!values.length) {
      for (const row of rows) row[selection.alias] = baseIsChild || relation.childUnique ? null : [];
      continue;
    }
    const targetRows = (await client.query<Record<string, unknown>>(
      `select * from public.${quoteIdentifier(selection.table)}
       where ${quoteIdentifier(targetColumn)} = any($1)`,
      [values],
    )).rows;
    await hydrateRelations(client, selection.table, targetRows, selection.children);
    const grouped = new Map<unknown, Array<Record<string, unknown>>>();
    for (const target of targetRows) {
      const key = target[targetColumn];
      const group = grouped.get(key) ?? [];
      group.push(target);
      grouped.set(key, group);
    }
    for (const row of rows) {
      const matches = grouped.get(row[baseColumn]) ?? [];
      row[selection.alias] = baseIsChild || relation.childUnique ? matches[0] ?? null : matches;
    }
  }
  return rows;
}

function parseList(value: string) {
  const inner = value.startsWith("(") && value.endsWith(")") ? value.slice(1, -1) : value;
  return splitTopLevel(inner).map((entry) => entry.replace(/^"(.*)"$/, "$1"));
}

function filterSql(
  column: string,
  rawValue: string,
  values: unknown[],
): string {
  const quoted = quoteIdentifier(column);
  if (rawValue.startsWith("not.")) {
    return `not (${filterSql(column, rawValue.slice(4), values)})`;
  }
  const separator = rawValue.indexOf(".");
  if (separator < 1) throw new DatabaseRequestError(400, "INVALID_DATABASE_FILTER", "Invalid database filter");
  const operator = rawValue.slice(0, separator);
  const raw = rawValue.slice(separator + 1);
  if (operator === "is") {
    if (raw === "null") return `${quoted} is null`;
    if (raw === "true") return `${quoted} is true`;
    if (raw === "false") return `${quoted} is false`;
  }
  if (operator === "in") {
    values.push(parseList(raw));
    return `${quoted} = any($${values.length})`;
  }
  if (operator === "cs" || operator === "ov") {
    values.push(raw.startsWith("{") && raw.endsWith("}") ? parseList(`(${raw.slice(1, -1)})`) : raw);
    return `${quoted} ${operator === "cs" ? "@>" : "&&"} $${values.length}`;
  }
  const operators: Record<string, string> = {
    eq: "=",
    neq: "<>",
    gt: ">",
    gte: ">=",
    lt: "<",
    lte: "<=",
    like: "like",
    ilike: "ilike",
  };
  const sqlOperator = operators[operator];
  if (!sqlOperator) throw new DatabaseRequestError(400, "INVALID_DATABASE_FILTER", "Unsupported database filter");
  values.push(operator === "like" || operator === "ilike" ? raw.replaceAll("*", "%") : raw);
  return `${quoted} ${sqlOperator} $${values.length}`;
}

function parseOrFilters(value: string, values: unknown[]) {
  const entries = splitTopLevel(value.startsWith("(") && value.endsWith(")") ? value.slice(1, -1) : value);
  const clauses = entries.map((entry) => {
    const first = entry.indexOf(".");
    if (first < 1) throw new DatabaseRequestError(400, "INVALID_DATABASE_FILTER", "Invalid OR filter");
    return filterSql(entry.slice(0, first), entry.slice(first + 1), values);
  });
  return clauses.length ? `(${clauses.join(" or ")})` : "false";
}

function queryParts(searchParams: URLSearchParams) {
  const values: unknown[] = [];
  const filters: string[] = [];
  const reserved = new Set(["select", "order", "limit", "offset", "on_conflict"]);
  for (const [column, value] of searchParams.entries()) {
    if (reserved.has(column)) continue;
    if (column === "or") {
      filters.push(parseOrFilters(value, values));
      continue;
    }
    filters.push(filterSql(column, value, values));
  }
  const where = filters.length ? ` where ${filters.join(" and ")}` : "";
  return { values, where };
}

function orderSql(value: string | null) {
  if (!value) return "";
  const clauses = splitTopLevel(value).map((entry) => {
    const [column, direction = "asc", nulls] = entry.split(".");
    const normalizedDirection = direction.toLowerCase() === "desc" ? "desc" : "asc";
    const normalizedNulls = nulls === "nullsfirst"
      ? " nulls first"
      : nulls === "nullslast"
        ? " nulls last"
        : "";
    return `${quoteIdentifier(column)} ${normalizedDirection}${normalizedNulls}`;
  });
  return clauses.length ? ` order by ${clauses.join(", ")}` : "";
}

function limitSql(searchParams: URLSearchParams, headers: Headers) {
  const range = headers.get("range");
  if (range && /^\d+-\d+$/.test(range)) {
    const [start, end] = range.split("-").map(Number);
    return { sql: ` limit ${end - start + 1} offset ${start}`, start, end };
  }
  const limit = Number(searchParams.get("limit") ?? 0);
  const offset = Number(searchParams.get("offset") ?? 0);
  const safeLimit = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 100_000) : null;
  const safeOffset = Number.isInteger(offset) && offset > 0 ? offset : 0;
  return {
    sql: `${safeLimit ? ` limit ${safeLimit}` : ""}${safeOffset ? ` offset ${safeOffset}` : ""}`,
    start: safeOffset,
    end: safeLimit ? safeOffset + safeLimit - 1 : null,
  };
}

function jsonResponse(value: unknown, status = 200, headers: HeadersInit = {}) {
  if (status === 204) return new Response(null, { status, headers });
  return Response.json(value, { status, headers });
}

async function selectRows(
  client: PoolClient,
  table: string,
  searchParams: URLSearchParams,
  headers: Headers,
) {
  const { values, where } = queryParts(searchParams);
  const limit = limitSql(searchParams, headers);
  const order = orderSql(searchParams.get("order"));
  const rows = (await client.query<Record<string, unknown>>(
    `select * from public.${quoteIdentifier(table)}${where}${order}${limit.sql}`,
    values,
  )).rows;
  await hydrateRelations(client, table, rows, nestedSelections(searchParams.get("select")));
  const responseHeaders = new Headers();
  if (headers.get("prefer")?.toLowerCase().includes("count=exact")) {
    const countResult = await client.query<{ count: string }>(
      `select count(*)::text as count from public.${quoteIdentifier(table)}${where}`,
      values,
    );
    const count = Number(countResult.rows[0]?.count ?? rows.length);
    const end = rows.length ? limit.start + rows.length - 1 : limit.start;
    responseHeaders.set("content-range", `${limit.start}-${end}/${count}`);
  }
  return jsonResponse(rows, 200, responseHeaders);
}

function bodyRows(init: RequestInit) {
  if (typeof init.body !== "string") throw new DatabaseRequestError(400, "INVALID_DATABASE_BODY", "A JSON body is required");
  const parsed = JSON.parse(init.body) as unknown;
  const rows = Array.isArray(parsed) ? parsed : [parsed];
  if (!rows.length || rows.some((row) => !row || typeof row !== "object" || Array.isArray(row))) {
    throw new DatabaseRequestError(400, "INVALID_DATABASE_BODY", "A JSON object or array is required");
  }
  return rows as Array<Record<string, unknown>>;
}

async function insertRows(
  client: PoolClient,
  table: string,
  searchParams: URLSearchParams,
  headers: Headers,
  init: RequestInit,
) {
  const rows = bodyRows(init);
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  if (!columns.length) throw new DatabaseRequestError(400, "INVALID_DATABASE_BODY", "No database columns were provided");
  columns.forEach(quoteIdentifier);
  const values: unknown[] = [];
  const tuples = rows.map((row) => `(${columns.map((column) => {
    values.push(row[column] ?? null);
    return `$${values.length}`;
  }).join(", ")})`);
  const prefer = headers.get("prefer")?.toLowerCase() ?? "";
  const conflictColumns = searchParams.get("on_conflict")?.split(",").map((column) => column.trim()).filter(Boolean) ?? [];
  conflictColumns.forEach(quoteIdentifier);
  const conflict = prefer.includes("resolution=merge-duplicates") && conflictColumns.length
    ? ` on conflict (${conflictColumns.map(quoteIdentifier).join(", ")}) do update set ${
      columns.filter((column) => !conflictColumns.includes(column))
        .map((column) => `${quoteIdentifier(column)} = excluded.${quoteIdentifier(column)}`)
        .join(", ") || `${quoteIdentifier(conflictColumns[0])} = excluded.${quoteIdentifier(conflictColumns[0])}`
    }`
    : "";
  const result = await client.query<Record<string, unknown>>(
    `insert into public.${quoteIdentifier(table)} (${columns.map(quoteIdentifier).join(", ")})
     values ${tuples.join(", ")}${conflict}
     returning *`,
    values,
  );
  if (prefer.includes("return=minimal")) return jsonResponse(undefined, 204);
  return jsonResponse(result.rows, 200);
}

async function updateRows(
  client: PoolClient,
  table: string,
  searchParams: URLSearchParams,
  headers: Headers,
  init: RequestInit,
) {
  const [body] = bodyRows(init);
  const columns = Object.keys(body);
  if (!columns.length) throw new DatabaseRequestError(400, "INVALID_DATABASE_BODY", "No database columns were provided");
  const values: unknown[] = [];
  const assignments = columns.map((column) => {
    values.push(body[column]);
    return `${quoteIdentifier(column)} = $${values.length}`;
  });
  const filters = queryParts(searchParams);
  const where = filters.where.replace(/\$(\d+)/g, (_, index) => `$${Number(index) + values.length}`);
  if (!where) throw new DatabaseRequestError(400, "DATABASE_FILTER_REQUIRED", "Update filters are required");
  const result = await client.query<Record<string, unknown>>(
    `update public.${quoteIdentifier(table)} set ${assignments.join(", ")}${where} returning *`,
    [...values, ...filters.values],
  );
  if (headers.get("prefer")?.toLowerCase().includes("return=minimal")) return jsonResponse(undefined, 204);
  return jsonResponse(result.rows, 200);
}

async function deleteRows(
  client: PoolClient,
  table: string,
  searchParams: URLSearchParams,
  headers: Headers,
) {
  const { values, where } = queryParts(searchParams);
  if (!where) throw new DatabaseRequestError(400, "DATABASE_FILTER_REQUIRED", "Delete filters are required");
  const result = await client.query<Record<string, unknown>>(
    `delete from public.${quoteIdentifier(table)}${where} returning *`,
    values,
  );
  if (headers.get("prefer")?.toLowerCase().includes("return=representation")) return jsonResponse(result.rows, 200);
  return jsonResponse(undefined, 204);
}

async function functionReturnsSet(client: PoolClient, name: string) {
  if (functionSetCache.has(name)) return functionSetCache.get(name) ?? false;
  const result = await client.query<{ proretset: boolean }>(
    `select procedure.proretset
     from pg_proc procedure
     join pg_namespace namespace on namespace.oid = procedure.pronamespace
     where namespace.nspname = 'public' and procedure.proname = $1
     order by procedure.oid desc
     limit 1`,
    [name],
  );
  const returnsSet = result.rows[0]?.proretset ?? false;
  functionSetCache.set(name, returnsSet);
  return returnsSet;
}

async function callFunction(client: PoolClient, name: string, init: RequestInit) {
  quoteIdentifier(name);
  const body = typeof init.body === "string" && init.body.trim()
    ? JSON.parse(init.body) as Record<string, unknown>
    : {};
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new DatabaseRequestError(400, "INVALID_DATABASE_BODY", "RPC arguments must be an object");
  }
  const entries = Object.entries(body);
  for (const [argument] of entries) quoteIdentifier(argument);
  const argumentsSql = entries
    .map(([argument], index) => `${quoteIdentifier(argument)} => $${index + 1}`)
    .join(", ");
  const result = await client.query<Record<string, unknown>>(
    `select * from public.${quoteIdentifier(name)}(${argumentsSql})`,
    entries.map(([, value]) => value),
  );
  const returnsSet = await functionReturnsSet(client, name);
  if (returnsSet) return jsonResponse(result.rows, 200);
  const row = result.rows[0];
  if (!row) return jsonResponse(null, 200);
  const keys = Object.keys(row);
  return jsonResponse(keys.length === 1 && keys[0] === name ? row[name] : row, 200);
}

function parsePath(path: string) {
  const url = new URL(path, "http://database.local");
  const rpcMatch = url.pathname.match(/^\/db\/rpc\/([a-z_][a-z0-9_]*)$/i);
  if (rpcMatch) return { kind: "rpc" as const, name: rpcMatch[1], searchParams: url.searchParams };
  const tableMatch = url.pathname.match(/^\/db\/table\/([a-z_][a-z0-9_]*)$/i);
  if (tableMatch) return { kind: "table" as const, name: tableMatch[1], searchParams: url.searchParams };
  throw new DatabaseRequestError(400, "INVALID_DATABASE_PATH", "Unsupported database path");
}

async function executeRequest(
  context: DatabaseContext,
  path: string,
  init: RequestInit,
) {
  const parsed = parsePath(path);
  const headers = new Headers(init.headers);
  try {
    return await withDatabaseContext(context, async (client) => {
      if (parsed.kind === "rpc") return callFunction(client, parsed.name, init);
      const method = (init.method ?? "GET").toUpperCase();
      if (method === "GET") return selectRows(client, parsed.name, parsed.searchParams, headers);
      if (method === "POST") return insertRows(client, parsed.name, parsed.searchParams, headers, init);
      if (method === "PATCH" || method === "PUT") return updateRows(client, parsed.name, parsed.searchParams, headers, init);
      if (method === "DELETE") return deleteRows(client, parsed.name, parsed.searchParams, headers);
      throw new DatabaseRequestError(405, "DATABASE_METHOD_NOT_ALLOWED", "Unsupported database method");
    });
  } catch (error) {
    if (error instanceof DatabaseRequestError) throw error;
    const detail = error as { code?: string; message?: string };
    throw new DatabaseRequestError(
      detail.code === "57014" ? 504 : detail.code === "42501" ? 403 : 400,
      normalizeDatabaseErrorCode(detail.code, detail.message),
      detail.message ?? "Database request failed",
    );
  }
}

export async function getSessionToken() {
  return (await cookies()).get(sessionCookieName)?.value ?? null;
}

export async function databaseRequest(
  path: string,
  init: RequestInit = {},
  token?: string | null,
) {
  const sessionToken = token === undefined ? await getSessionToken() : token;
  const session = await loadSession(sessionToken);
  if (!session) throw new DatabaseRequestError(401, "AUTH_REQUIRED", "Authentication is required");
  return executeRequest({ kind: "user", authorization: session.authorization }, path, init);
}

export async function databaseJson<T>(
  path: string,
  init: RequestInit = {},
  token?: string | null,
): Promise<T> {
  const response = await databaseRequest(path, init, token);
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export async function databaseSystemRequest(path: string, init: RequestInit = {}) {
  return executeRequest({ kind: "system" }, path, init);
}

export async function databaseSystemJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await databaseSystemRequest(path, init);
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export async function databaseWorkerJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await executeRequest({ kind: "worker" }, path, init);
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export function jsonBody(value: unknown): RequestInit {
  return {
    method: "POST",
    body: JSON.stringify(value),
    headers: { Prefer: "return=representation" },
  };
}
