import { supabaseJson } from "./supabase-server";

export type ConsumptionPeriod = "month" | "quarter" | "year";
export type ConsumptionResult = {
  period: ConsumptionPeriod; label: string; total: number; orders: number; average: number; renewal: number; compare: number;
  trend: Array<[string, number]>;
  productMix: Array<{ nameZh: string; nameEn: string; value: number; customers: number; color: string }>;
  topCustomers: Array<{ nameZh: string; nameEn: string; customerType: "school" | "family" | "other"; productsZh: string[]; productsEn: string[]; amount: number }>;
};
type PaymentRow = { amount: number | string; paid_at: string; product_id: string | null; products: { name_zh: string; name_en: string } | null; contracts: { organization_id: string; organizations: { name_zh: string; name_en: string; organization_type: string } | null } | null };

function bounds(period: ConsumptionPeriod, now = new Date()) {
  const year = now.getUTCFullYear(); const month = now.getUTCMonth();
  const start = period === "year" ? new Date(Date.UTC(year, 0, 1)) : period === "quarter" ? new Date(Date.UTC(year, Math.floor(month / 3) * 3, 1)) : new Date(Date.UTC(year, month, 1));
  const months = period === "year" ? 12 : period === "quarter" ? 3 : 1; const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + months, 1));
  return { start, end, previousStart: new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() - months, 1)) };
}

export async function loadConsumption(period: ConsumptionPeriod): Promise<ConsumptionResult> {
  const { start, end, previousStart } = bounds(period);
  const select = "amount,paid_at,product_id,products(name_zh,name_en),contracts(organization_id,organizations(name_zh,name_en,organization_type))";
  const rows = await supabaseJson<PaymentRow[]>(`/rest/v1/payments?select=${encodeURIComponent(select)}&status=eq.CONFIRMED&paid_at=gte.${previousStart.toISOString()}&paid_at=lt.${end.toISOString()}&order=paid_at.asc&limit=5000`);
  const current = rows.filter((row) => new Date(row.paid_at) >= start); const previous = rows.filter((row) => new Date(row.paid_at) < start);
  const total = current.reduce((sum, row) => sum + Number(row.amount), 0); const previousTotal = previous.reduce((sum, row) => sum + Number(row.amount), 0);
  const compare = previousTotal ? Number((((total - previousTotal) / previousTotal) * 100).toFixed(1)) : 0;
  const bucketCount = period === "month" ? 5 : period === "quarter" ? 3 : 4;
  const trend = Array.from({ length: bucketCount }, (_, index): [string, number] => {
    if (period === "month") return [`${start.toISOString().slice(0, 7)} W${index + 1}`, current.filter((row) => Math.min(4, Math.floor((new Date(row.paid_at).getUTCDate() - 1) / 7)) === index).reduce((sum, row) => sum + Number(row.amount), 0)];
    if (period === "quarter") { const month = start.getUTCMonth() + index; const label = new Intl.DateTimeFormat("en", { month: "short" }).format(new Date(Date.UTC(start.getUTCFullYear(), month, 1))); return [label, current.filter((row) => new Date(row.paid_at).getUTCMonth() === month).reduce((sum, row) => sum + Number(row.amount), 0)]; }
    return [`Q${index + 1}`, current.filter((row) => Math.floor(new Date(row.paid_at).getUTCMonth() / 3) === index).reduce((sum, row) => sum + Number(row.amount), 0)];
  });
  const colors = ["green", "purple", "blue", "amber", "coral"];
  const productMap = new Map<string, { nameZh: string; nameEn: string; value: number; customers: Set<string>; color: string }>();
  const customerMap = new Map<string, { nameZh: string; nameEn: string; customerType: "school" | "family" | "other"; productsZh: Set<string>; productsEn: Set<string>; amount: number }>();
  current.forEach((row) => {
    const productKey = row.product_id ?? "other"; const product = productMap.get(productKey) ?? { nameZh: row.products?.name_zh ?? "其他", nameEn: row.products?.name_en ?? "Other", value: 0, customers: new Set<string>(), color: colors[productMap.size % colors.length] };
    product.value += Number(row.amount); if (row.contracts?.organization_id) product.customers.add(row.contracts.organization_id); productMap.set(productKey, product);
    const organization = row.contracts?.organizations; const customerKey = row.contracts?.organization_id ?? "unassigned"; const customer = customerMap.get(customerKey) ?? { nameZh: organization?.name_zh ?? "未分配客户", nameEn: organization?.name_en ?? "Unassigned customer", customerType: organization?.organization_type === "SCHOOL" ? "school" : organization?.organization_type === "FAMILY" ? "family" : "other", productsZh: new Set<string>(), productsEn: new Set<string>(), amount: 0 };
    customer.amount += Number(row.amount); if (row.products?.name_zh) customer.productsZh.add(row.products.name_zh); if (row.products?.name_en) customer.productsEn.add(row.products.name_en); customerMap.set(customerKey, customer);
  });
  const eligibleContracts = await supabaseJson<Array<{ status: string }>>(`/rest/v1/contracts?select=status&end_date=gte.${start.toISOString().slice(0, 10)}&end_date=lt.${end.toISOString().slice(0, 10)}&limit=5000`);
  const renewed = eligibleContracts.filter((item) => ["ACTIVE", "RENEWAL_PREP", "NEGOTIATING"].includes(item.status)).length;
  return { period, label: `${start.toISOString().slice(0, 10)} — ${new Date(end.getTime() - 86400000).toISOString().slice(0, 10)}`, total, orders: current.length, average: current.length ? Math.round(total / current.length) : 0, renewal: eligibleContracts.length ? Math.round(renewed / eligibleContracts.length * 100) : 0, compare, trend, productMix: [...productMap.values()].sort((a, b) => b.value - a.value).map((item) => ({ nameZh: item.nameZh, nameEn: item.nameEn, value: item.value, customers: item.customers.size, color: item.color })), topCustomers: [...customerMap.values()].sort((a, b) => b.amount - a.amount).slice(0, 10).map((item) => ({ nameZh: item.nameZh, nameEn: item.nameEn, customerType: item.customerType, productsZh: [...item.productsZh], productsEn: [...item.productsEn], amount: item.amount })) };
}
