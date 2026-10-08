import { v2FieldLabel } from "./import-v2-labels";
import { relationLabels } from "./import-set-labels";

export function localizedImportHeader(key: string, locale: "zh-CN" | "en") {
  const label = relationLabels[key]?.[locale === "en" ? 1 : 0] ?? v2FieldLabel(key, locale);
  // The stable key disambiguates similar labels and keeps archived templates readable.
  return `${label} [${key}]`;
}

export function normalizeLocalizedImport<T extends { headers: string[]; rows: Record<string, string>[] }>(document: T, allowed: readonly string[]): T {
  const aliases = new Map(allowed.flatMap(key => [[key, key], [localizedImportHeader(key, "zh-CN"), key], [localizedImportHeader(key, "en"), key]]));
  const headers = document.headers.map(header => aliases.get(header) ?? header);
  if (new Set(headers).size !== headers.length) throw new Error("TEMPLATE_SCHEMA_INVALID");
  return { ...document, headers, rows: document.rows.map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [aliases.get(key) ?? key, value]))) };
}
