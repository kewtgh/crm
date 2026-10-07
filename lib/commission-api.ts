import {NextResponse} from "next/server";
import {z} from "zod";
import {ApiError,apiRoute,requireApiCapability} from "./api";
import {mutationIsTrusted} from "./request-security";
import {channelApiError} from "./channel-commercial-api";
import {agreementSaveSchema,agreementTransitionSchema,accrualGenerateSchema,settlementSaveSchema,settlementTransitionSchema} from "./commission-input";
import {getChannelAgreements,saveChannelAgreement,changeChannelAgreementStatus} from "./channel-agreement-repository";
import {getCommissionEligibility,listCommissionAccruals,listCommissionSettlements,generateCommissionAccrual,saveCommissionSettlement,changeCommissionSettlementStatus} from "./commission-repository";
const uuid=(value:string|null)=>{if(!z.uuid().safeParse(value).success)throw new ApiError("COMMISSION_INPUT_INVALID",400);return value!;};
export const commissionListFiltersSchema=z.object({currency:z.string().regex(/^[A-Z]{3}$/).optional(),status:z.enum(["OPEN","DRAFT","APPROVED","PAID","CANCELLED"]).optional(),from:z.iso.date().optional(),to:z.iso.date().optional()}).refine(value=>!value.from||!value.to||value.from<=value.to);
export function commissionRead(kind:"agreements"|"eligibility"|"accruals"|"settlements"){return apiRoute(async(request:Request)=>{await requireApiCapability("finance.view");const q=new URL(request.url).searchParams,org=uuid(q.get("organization"));try{
 if(kind==="agreements")return NextResponse.json(await getChannelAgreements(org),{headers:{"cache-control":"no-store"}});
 if(kind==="eligibility")return NextResponse.json(await getCommissionEligibility(org,q.has("enrollment")?uuid(q.get("enrollment")):null),{headers:{"cache-control":"no-store"}});
 const access=await getChannelAgreements(org);if(!access.canFinance)throw new ApiError("COMMISSION_FORBIDDEN",403);
 const parsed=commissionListFiltersSchema.safeParse(Object.fromEntries(q));if(!parsed.success||kind==="settlements"&&parsed.data.status==="OPEN")throw new ApiError("COMMISSION_INPUT_INVALID",400);
 return NextResponse.json({items:kind==="accruals"?await listCommissionAccruals(org,undefined,parsed.data):await listCommissionSettlements(org,undefined,parsed.data)},{headers:{"cache-control":"no-store"}});
 }catch(e){return channelApiError(e);}},"COMMISSION_LOAD_FAILED");}
export function commissionWrite(kind:"agreement"|"agreement-status"|"accrual"|"settlement"|"settlement-status"){return apiRoute(async(request:Request,context:{params:Promise<{id:string}>})=>{
 if(!mutationIsTrusted(request))throw new ApiError("UNTRUSTED_ORIGIN",403);await requireApiCapability(kind.startsWith("settlement")?"finance.payment.record":"catalog.manage");
 const body=await request.json().catch(()=>({}));const schema=kind==="agreement"?agreementSaveSchema:kind==="agreement-status"?agreementTransitionSchema:kind==="accrual"?accrualGenerateSchema:kind==="settlement"?settlementSaveSchema:settlementTransitionSchema;
 if(!schema.safeParse(body).success)throw new ApiError("COMMISSION_INPUT_INVALID",400);
 try{const item=kind==="agreement"?await saveChannelAgreement(agreementSaveSchema.parse(body)):kind==="agreement-status"?await changeChannelAgreementStatus(uuid((await context.params).id),agreementTransitionSchema.parse(body)):kind==="accrual"?await generateCommissionAccrual(accrualGenerateSchema.parse(body)):kind==="settlement"?await saveCommissionSettlement(settlementSaveSchema.parse(body)):await changeCommissionSettlementStatus(uuid((await context.params).id),settlementTransitionSchema.parse(body));return NextResponse.json({item});}catch(e){return channelApiError(e);}
 },"COMMISSION_SAVE_FAILED");}
