export const financeAmountFields = ["contracted", "receivable", "collected", "refunded", "outstanding", "overdue"] as const;
export type FinanceAmounts = Record<typeof financeAmountFields[number], string>;
export type EnrollmentContractFinance = FinanceAmounts & {
  contract_id: string; contract_number: string; contract_status: string; currency: string;
  organization_id: string | null; household_id: string | null; product_id: string | null;
  active_enrollment_link_count: number | string; has_schedule: boolean;
  allocationMode?: "EXCLUSIVE" | "SHARED_UNALLOCATED";
};
function cents(value: string) {
  if (!/^\d+(\.\d{1,2})?$/.test(value)) throw new Error("FINANCE_AMOUNT_INVALID");
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * BigInt(100) + BigInt(fraction.padEnd(2, "0"));
}
const amount = (value: bigint) => `${value / BigInt(100)}.${String(value % BigInt(100)).padStart(2, "0")}`;
export function formatFinanceAmount(value:string,locale:string) {
  const exact=cents(value),formatter=new Intl.NumberFormat(locale,{maximumFractionDigits:0});
  const separator=new Intl.NumberFormat(locale).formatToParts(1.1).find(part=>part.type==="decimal")?.value??".";
  return `${formatter.format(exact/BigInt(100))}${separator}${String(exact%BigInt(100)).padStart(2,"0")}`;
}
export function enrollmentFinanceProjection(enrollmentId: string, rows: EnrollmentContractFinance[], visibility = {available: true, partial: false}) {
  const seen = new Set<string>();
  const contracts = rows.map(row => {
    if (seen.has(row.contract_id) || Number(row.active_enrollment_link_count) < 1 || !/^[A-Z]{3}$/.test(row.currency)) throw new Error("FINANCE_PROJECTION_INVALID");
    seen.add(row.contract_id);
    financeAmountFields.forEach(field => cents(row[field]));
    return {...row, allocationMode: Number(row.active_enrollment_link_count) === 1 ? "EXCLUSIVE" as const : "SHARED_UNALLOCATED" as const};
  });
  const exclusive = contracts.filter(row => row.allocationMode === "EXCLUSIVE"), sharedContracts = contracts.filter(row => row.allocationMode === "SHARED_UNALLOCATED");
  const totals = new Map<string, Record<typeof financeAmountFields[number], bigint>>();
  for (const row of exclusive) {
    const total = totals.get(row.currency) ?? Object.fromEntries(financeAmountFields.map(field => [field, BigInt(0)])) as Record<typeof financeAmountFields[number], bigint>;
    financeAmountFields.forEach(field => {total[field] += cents(row[field]);});
    totals.set(row.currency, total);
  }
  return {enrollmentId, ...visibility, contracts, sharedContracts,
    exclusiveTotalsByCurrency: [...totals].sort(([a], [b]) => a.localeCompare(b)).map(([currency, total]) => ({currency, ...Object.fromEntries(financeAmountFields.map(field => [field, amount(total[field])])) as FinanceAmounts})),
    allocationStatus: !visibility.available ? null : !contracts.length ? "NONE" as const : !sharedContracts.length ? "EXCLUSIVE" as const : exclusive.length ? "PARTIAL_UNALLOCATED" as const : "SHARED_UNALLOCATED" as const,
  };
}
export type EnrollmentFinanceProjection = ReturnType<typeof enrollmentFinanceProjection>;
