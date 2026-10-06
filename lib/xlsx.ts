import { readSheet } from "read-excel-file/browser";
import type { CsvDocument } from "./csv";
import { normalizeImportSheet } from "./import-sheet";

export async function parseXlsxDocument(file: File, maxRows = 10_000,expected?:{resource:string;templateVersion:"2"|"SET_V1"}): Promise<CsvDocument> {
  if(!expected)return normalizeImportSheet(await readSheet(file),maxRows);
  const metadata=await readSheet(file,"Metadata");
  const values=Object.fromEntries(metadata.map(row=>[String(row[0]),String(row[1])]));
  if(values.resource!==expected.resource||values.template_version!==expected.templateVersion)throw new Error("TEMPLATE_VERSION_UNSUPPORTED");
  const sheet=await readSheet(file,"Data",{parseNumber:value=>value});
  // v2 template cells are strings. Timestamp/date ambiguity is rejected rather than guessed.
  if(sheet.slice(1).some(row=>row.some(value=>value instanceof Date)))throw new Error("INVALID_DATE");
  return {...normalizeImportSheet(sheet,maxRows,true),sheet:"Data",resource:values.resource,templateVersion:values.template_version};
}
