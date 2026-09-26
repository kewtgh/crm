import { CsvParseError, type CsvDocument } from "./csv";

function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  return value instanceof Date ? value.toISOString() : String(value).trim();
}

// Spreadsheet rows may be padded to the widest row or have omitted empty cells.
export function normalizeImportSheet(sheet: readonly (readonly unknown[])[], maxRows = 10_000): CsvDocument {
  const headers = Array.from(sheet[0] ?? [], cellText);
  while (headers.length && !headers.at(-1)) headers.pop();
  if (!headers.length) throw new CsvParseError("EMPTY", 1);
  if (headers.some(header => !header) || new Set(headers.map(header => header.toLowerCase())).size !== headers.length) {
    throw new CsvParseError("DUPLICATE_HEADER", 1);
  }
  const rows: CsvDocument["rows"] = [];
  for (let index = 1; index < sheet.length; index++) {
    const cells = Array.from(sheet[index], cellText);
    if (!cells.some(Boolean)) continue;
    if (cells.slice(headers.length).some(Boolean)) throw new CsvParseError("COLUMN_COUNT", index + 1);
    if (rows.length >= maxRows) throw new CsvParseError("TOO_MANY_ROWS", index + 1);
    rows.push(Object.fromEntries(headers.map((header, column) => [header, cells[column] ?? ""])));
  }
  if (!rows.length) throw new CsvParseError("EMPTY");
  return { headers, rows, delimiter: "xlsx" };
}
