import { supabaseJson } from "./supabase-server";

export type ConsumptionPeriod = "month" | "quarter" | "year";
export type ConsumptionResult = {
  period: ConsumptionPeriod;
  label: string;
  currency: string;
  availableCurrencies: string[];
  total: number;
  orders: number;
  average: number;
  renewal: number;
  compare: number;
  newCustomerTotal: number;
  trend: Array<[string, number]>;
  productMix: Array<{ nameZh: string; nameEn: string; value: number; customers: number; color: string }>;
  topCustomers: Array<{ nameZh: string; nameEn: string; customerType: "school" | "family" | "other"; productsZh: string[]; productsEn: string[]; amount: number }>;
};

type ReportPayload = Omit<ConsumptionResult,"productMix"|"topCustomers"> & {
  productMix:Array<Omit<ConsumptionResult["productMix"][number],"color">>;
  topCustomers:Array<Omit<ConsumptionResult["topCustomers"][number],"customerType"> & {customerType:string}>;
};

export async function loadConsumption(period: ConsumptionPeriod, currency?: string): Promise<ConsumptionResult> {
  const report = await supabaseJson<ReportPayload>("/rest/v1/rpc/consumption_report", {
    method:"POST",
    body:JSON.stringify({report_period:period,report_currency:currency || null}),
  });
  const colors=["green","purple","blue","amber","coral"];
  return {
    ...report,
    period,
    total:Number(report.total),orders:Number(report.orders),average:Number(report.average),renewal:Number(report.renewal),compare:Number(report.compare),newCustomerTotal:Number(report.newCustomerTotal),
    trend:(report.trend??[]).map(([label,value])=>[String(label),Number(value)]),
    productMix:(report.productMix??[]).map((item,index)=>({...item,value:Number(item.value),customers:Number(item.customers),color:colors[index%colors.length]})),
    topCustomers:(report.topCustomers??[]).map((item)=>({...item,amount:Number(item.amount),customerType:item.customerType==="school"?"school":item.customerType==="family"?"family":"other"})),
  };
}
