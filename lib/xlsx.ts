import { readSheet } from "read-excel-file/browser";
import type { CsvDocument } from "./csv";
import { normalizeImportSheet } from "./import-sheet";

export async function parseXlsxDocument(file: File, maxRows = 10_000): Promise<CsvDocument> {
  const sheet = await readSheet(file);
  return normalizeImportSheet(sheet, maxRows);
}
