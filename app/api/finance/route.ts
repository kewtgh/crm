import {getDomainReportFilter} from "@/lib/domain-report-filter";
import { NextResponse } from "next/server";
import { z } from "zod";
import { apiRoute, parsePagination, requireApiCapability } from "@/lib/api";
import { financeOperation,loadFinanceOverview } from "@/lib/phase2-repository";
import { executeSuperAdminApproval } from "@/lib/governance-repository";
import { mutationIsTrusted } from "@/lib/request-security";
import { DatabaseRequestError } from "@/lib/db/gateway";
const createQuote=z.object({operation:z.literal("createQuote"),quote_no:z.string().trim().min(1).max(60),target_organization:z.uuid().nullable().optional(),target_household:z.uuid().nullable().optional(),target_person:z.uuid().nullable().optional(),representative_contact:z.uuid().nullable().optional(),requestKey:z.string().min(8).max(160).optional(),target_opportunity:z.uuid().nullable().optional(),target_product:z.uuid().nullable().optional(),target_cohort:z.uuid().nullable().optional(),target_bundle:z.uuid().nullable().optional(),target_exchange_rate:z.uuid().nullable().optional(),quote_currency:z.string().regex(/^[A-Z]{3}$/),quote_subtotal:z.number().nonnegative().multipleOf(0.01),quote_discount:z.number().nonnegative().multipleOf(0.01),valid_through:z.string().date(),terms_zh:z.string().max(2000).default(""),terms_en:z.string().max(2000).default("")}).refine(v=>[v.target_organization,v.target_household,v.target_person].filter(Boolean).length===1,{path:["target_organization"]}).refine(v=>(!v.target_person&&!v.representative_contact)||!!v.requestKey,{path:["requestKey"]}).refine(v=>!v.representative_contact||!!v.target_organization,{path:["representative_contact"]}).refine(v=>v.quote_discount<=v.quote_subtotal,{path:["quote_discount"]}).refine(v=>Boolean(v.target_product)!==Boolean(v.target_bundle),{path:["target_product"]}).refine(v=>!v.target_cohort||!!v.target_product,{path:["target_cohort"]});
const submit=z.object({operation:z.literal("submitQuote"),target_quote:z.uuid(),business_reason:z.string().trim().min(3).max(500)});const accept=z.object({operation:z.literal("acceptQuote"),target_quote:z.uuid(),requestKey:z.string().trim().min(8).max(160)});const convert=z.object({operation:z.literal("convertQuote"),target_quote:z.uuid(),contract_no:z.string().trim().min(1).max(60),period_start:z.string().date(),period_end:z.string().date()});const schedule=z.object({operation:z.literal("saveReceivables"),target_contract:z.uuid(),installments:z.array(z.object({dueDate:z.string().date(),amount:z.number().positive()})).min(1).max(24)});const payment=z.object({operation:z.literal("recordPayment"),target_contract:z.uuid(),target_schedule:z.uuid(),payment_amount:z.number().positive(),payment_currency:z.string().regex(/^[A-Z]{3}$/),payment_reference:z.string().trim().min(1).max(120),paid_on:z.string().datetime()});const refund=z.object({operation:z.literal("requestRefund"),target_payment:z.uuid(),refund_amount:z.number().positive(),refund_reason:z.string().trim().min(3).max(500)});const complete=z.object({operation:z.literal("completeRefund"),target_refund:z.uuid(),receipt:z.string().trim().min(1).max(200)});const updateQuoteCohort=z.object({operation:z.literal("updateQuoteCohort"),target_quote:z.uuid(),target_product:z.uuid(),target_cohort:z.uuid().nullable(),expected_revision:z.number().int().positive(),requestKey:z.string().min(8).max(160)});const schema=z.discriminatedUnion("operation",[updateQuoteCohort,createQuote,submit,accept,convert,schedule,payment,refund,complete]);
const fail=(error:unknown)=>error instanceof DatabaseRequestError?NextResponse.json({code:error.code},{status:["COMMERCIAL_VERSION_CONFLICT","COMMERCIAL_REQUEST_CONFLICT"].includes(error.code)?409:error.status}):NextResponse.json({code:"FINANCE_OPERATION_FAILED"},{status:500});
async function get(request:Request){await requireApiCapability("finance.view");const url=new URL(request.url);const{page,pageSize}=parsePagination(url.searchParams,10);const sectionPage=(key:string)=>{const value=Number(url.searchParams.get(key)??1);return Number.isSafeInteger(value)&&value>0?Math.min(value,100000):1;};const filters=z.object({buyerType:z.enum(["ORGANIZATION","HOUSEHOLD","CONTACT"]).optional(),buyerId:z.uuid().optional(),studentId:z.uuid().optional(),productId:z.uuid().optional(),cohortId:z.uuid().optional(),enrollmentId:z.uuid().optional()}).refine(v=>!v.buyerId||!!v.buyerType,{path:["buyerType"]}).safeParse(Object.fromEntries(url.searchParams));if(!filters.success)return NextResponse.json({code:"INVALID_FINANCE_INPUT"},{status:400});try{return NextResponse.json(await loadFinanceOverview({...filters.data,reportFilter:getDomainReportFilter(Object.fromEntries(url.searchParams),"/finance"),query:url.searchParams.get("q")??"",page,pageSize,contractPage:sectionPage("contractPage"),receivablePage:sectionPage("receivablePage"),paymentPage:sectionPage("paymentPage"),refundPage:sectionPage("refundPage"),reconciliationPage:sectionPage("reconciliationPage")}));}catch(error){return fail(error);}}
async function post(request:Request){
  if(!mutationIsTrusted(request))return NextResponse.json({code:"UNTRUSTED_ORIGIN"},{status:403});
  const parsed=schema.safeParse(await request.json().catch(()=>({})));
  if(!parsed.success)return NextResponse.json({code:"INVALID_FINANCE_INPUT",field:String(parsed.error.issues[0]?.path[0]??"form")},{status:400});
  const user=parsed.data.operation==="recordPayment"
    ?await requireApiCapability("finance.payment.record")
    :parsed.data.operation==="completeRefund"
      ?await requireApiCapability("finance.refund.complete")
      :await requireApiCapability("finance.quote.create");
  try{
    const item=await financeOperation(parsed.data as unknown as Record<string,unknown>);
    const record=(Array.isArray(item)?item[0]:item) as Record<string,unknown>|undefined;
    const approvalId=parsed.data.operation==="submitQuote"
      ?record?.discount_approval_id
      :parsed.data.operation==="requestRefund"
        ?record?.approval_request_id
        :undefined;
    const direct=["SUPER_ADMIN","ADMIN"].includes(user.role)&&(parsed.data.operation==="submitQuote"||parsed.data.operation==="requestRefund");
    const execution=direct&&typeof approvalId==="string"?await executeSuperAdminApproval(approvalId):undefined;
    return NextResponse.json({item,execution,direct});
  }catch(error){return fail(error);}
}
export const GET=apiRoute(get,"FINANCE_LOAD_FAILED");
export const POST=apiRoute(post,"FINANCE_OPERATION_FAILED");
