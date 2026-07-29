export const IMPORT_MAX_ROWS = 10_000;
export const IMPORT_EXECUTION_BATCH_SIZE = 100;

export function importExecutionPassLimit(totalRows: number) {
  const normalizedTotal = Number.isFinite(totalRows) ? Math.max(0, Math.floor(totalRows)) : 0;
  return Math.max(1, Math.ceil(normalizedTotal / IMPORT_EXECUTION_BATCH_SIZE) + 1);
}

export function isImportExecutionTerminal(status: string) {
  return ["COMPLETED", "PARTIAL_FAILED", "FAILED", "ROLLED_BACK"].includes(status);
}
