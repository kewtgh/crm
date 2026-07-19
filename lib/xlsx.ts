import { readSheet } from "read-excel-file/browser";
import { CsvParseError, type CsvDocument } from "./csv";

function cellText(value: unknown) {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  return String(value).trim();
}

export async function parseXlsxDocument(file: File, maxRows = 10_000): Promise<CsvDocument> {
  const sheet = await readSheet(file);
  if (sheet.length < 2) throw new CsvParseError("EMPTY");
  const headers = sheet[0].map(cellText);
  const normalized = headers.map((header) => header.toLocaleLowerCase());
  if (headers.some((header) => !header) || new Set(normalized).size !== headers.length) {
    throw new CsvParseError("DUPLICATE_HEADER");
  }
  const data = sheet.slice(1).filter((row) => row.some((cell) => cell !== null && cell !== ""));
  if (data.length > maxRows) throw new CsvParseError("TOO_MANY_ROWS");
  return {
    headers,
    delimiter: "xlsx",
    rows: data.map((cells) => Object.fromEntries(
      headers.map((header, index) => [header, cellText(cells[index])]),
    )),
  };
}
