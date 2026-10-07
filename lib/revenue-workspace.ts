/** Read projections, never financial owners. Money crosses the boundary as decimal strings. */
export type RevenueRow = Record<string, unknown>;
export type RevenueWorkspace = {
  state: 'READY' | 'NO_DESIGNATION' | 'NO_CONFIGURATION';
  entities: RevenueRow[]; entity?: string; actor?: string; aal2?: boolean;
  profile?: RevenueRow; authorities?: string[]; page?: number;
  queue?: RevenueRow[]; facts?: RevenueRow[]; services?: RevenueRow[];
  bindings?: RevenueRow[]; evidence?: RevenueRow[]; policies?: RevenueRow[];
  periods?: RevenueRow[]; designations?: RevenueRow[]; contracts?: RevenueRow[];
  commissions?: RevenueRow[];
  cash?: RevenueRow[]; recognized?: RevenueRow[]; candidate_totals?: RevenueRow[];
  can_create_policy?: boolean; can_create_binding?: boolean; can_prepare_correction?: boolean;
};
export const revenueText = (row: RevenueRow, key: string) => row[key] == null ? '' : String(row[key]);
export const revenueRows = (value: unknown): RevenueRow[] => Array.isArray(value) ? value.filter(v => v && typeof v === 'object') : [];
