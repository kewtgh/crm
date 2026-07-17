import { supabaseJson, supabaseRequest } from "./supabase-server";

export type TimelineEvent={occurredAt:string;type:string;entityId:string;titleZh:string;titleEn:string;summary:string;metadata:Record<string,unknown>};
export type TimelinePage={items:TimelineEvent[];total:number;page:number;pageSize:number};
export type Organization360={id:string;nameZh:string;nameEn:string;status:string;city:string;curriculum:string;completeness:number;timeline:TimelinePage};

export async function loadOrganization360(id:string,page=1,pageSize=20,types:string[]=[]):Promise<Organization360>{
  const organizations=await supabaseJson<Array<{id:string;name_zh:string;name_en:string;status:string;city:string;curriculum:string;completeness:number}>>(`/rest/v1/organizations?select=id,name_zh,name_en,status,city,curriculum,completeness&id=eq.${id}&limit=1`);
  if(!organizations[0])throw new Error("ORGANIZATION_NOT_FOUND");
  const timeline=await supabaseJson<TimelinePage>("/rest/v1/rpc/customer_timeline",{method:"POST",body:JSON.stringify({target_organization:id,page_number:page,page_size:pageSize,event_types:types.length?types:null})});
  const organization=organizations[0];return{id:organization.id,nameZh:organization.name_zh,nameEn:organization.name_en,status:organization.status,city:organization.city,curriculum:organization.curriculum,completeness:organization.completeness,timeline};
}

export type ConsentRecord={id:string;channel:string;purpose:string;status:string;source:string;evidenceNote:string;obtainedAt:string|null;revokedAt:string|null;retentionUntil:string|null;quietStart:string|null;quietEnd:string|null};
export type ContactPrivacy={id:string;nameZh:string;nameEn:string;email:string;phone:string;title:string;doNotContact:boolean;doNotContactReason:string;consents:ConsentRecord[]};
export async function loadContactPrivacy(id:string):Promise<ContactPrivacy>{
  const contacts=await supabaseJson<Array<{id:string;name_zh:string;name_en:string;email:string|null;phone:string|null;title:string;do_not_contact:boolean;do_not_contact_reason:string}>>(`/rest/v1/contacts?select=id,name_zh,name_en,email,phone,title,do_not_contact,do_not_contact_reason&id=eq.${id}&limit=1`);const contact=contacts[0];if(!contact)throw new Error("CONTACT_NOT_FOUND");
  const consents=await supabaseJson<Array<{id:string;channel:string;purpose:string;status:string;source:string;evidence_note:string;obtained_at:string|null;revoked_at:string|null;retention_until:string|null;quiet_hours_start:string|null;quiet_hours_end:string|null}>>(`/rest/v1/contact_consents?select=*&contact_id=eq.${id}&order=channel,purpose`);
  return{id:contact.id,nameZh:contact.name_zh,nameEn:contact.name_en,email:contact.email??"",phone:contact.phone??"",title:contact.title,doNotContact:contact.do_not_contact,doNotContactReason:contact.do_not_contact_reason,consents:consents.map(item=>({id:item.id,channel:item.channel,purpose:item.purpose,status:item.status,source:item.source,evidenceNote:item.evidence_note,obtainedAt:item.obtained_at,revokedAt:item.revoked_at,retentionUntil:item.retention_until,quietStart:item.quiet_hours_start,quietEnd:item.quiet_hours_end}))};
}
export async function saveContactConsent(input:{contactId:string;channel:string;purpose:string;status:string;source:string;evidence?:string;retentionUntil?:string|null;quietStart?:string|null;quietEnd?:string|null}){return supabaseJson("/rest/v1/rpc/save_contact_consent",{method:"POST",body:JSON.stringify({target_contact:input.contactId,target_channel:input.channel,target_purpose:input.purpose,target_status:input.status,consent_source:input.source,evidence:input.evidence??"",retained_until:input.retentionUntil||null,quiet_start:input.quietStart||null,quiet_end:input.quietEnd||null})});}
export async function setContactDoNotContact(id:string,enabled:boolean,reason:string){return supabaseJson(`/rest/v1/contacts?id=eq.${id}`,{method:"PATCH",headers:{Prefer:"return=representation"},body:JSON.stringify({do_not_contact:enabled,do_not_contact_reason:enabled?reason:"",updated_at:new Date().toISOString()})});}

type QuoteRow={id:string;quote_number:string;organization_id:string;currency:string;valid_until:string;status:string;current_version:number;created_at:string};
type QuoteVersionRow={quote_id:string;version:number;subtotal:number;discount_amount:number;total_amount:number;terms_zh:string;terms_en:string;bundle_id:string|null;bundle_version:number|null;base_currency:string|null;base_total_amount:number|null};
export type QuoteRecord={id:string;number:string;organizationId:string;organizationZh:string;organizationEn:string;currency:string;validUntil:string;status:string;version:number;subtotal:number;discount:number;total:number;termsZh:string;termsEn:string;bundleId:string|null;bundleVersion:number|null;baseCurrency:string|null;baseTotal:number|null;createdAt:string};
export type ReceivableRecord={id:string;contractId:string;contractNumber:string;installment:number;dueDate:string;amount:number;paidAmount:number;status:string;currency:string};
export type RefundRecord={id:string;number:string;paymentId:string;amount:number;reason:string;status:string;receipt:string;createdAt:string};
export type PaymentRecord={id:string;contractId:string;scheduleId:string|null;amount:number;refundedAmount:number;currency:string;status:string;reference:string;paidAt:string|null};
export type ReconciliationRecord={id:string;contractId:string;paymentId:string|null;expected:number;actual:number;difference:number;status:string;reason:string;updatedAt:string};
export type ContractFinanceRecord={id:string;number:string;currency:string;value:number;status:string;hasSchedule:boolean};
export type FinanceRiskSummary={
  openReceivables:number;
  overdueReceivables:number;
  pendingRefunds:number;
  reconciliationExceptions:number;
};
export type FinanceOverview={
  quotes:QuoteRecord[];
  quoteTotal:number;
  contracts:ContractFinanceRecord[];
  contractTotal:number;
  receivables:ReceivableRecord[];
  receivableTotal:number;
  payments:PaymentRecord[];
  paymentTotal:number;
  refunds:RefundRecord[];
  refundTotal:number;
  reconciliations:ReconciliationRecord[];
  reconciliationTotal:number;
  pageSize:number;
  risk:FinanceRiskSummary;
  products:Array<{id:string;code:string;nameZh:string;nameEn:string}>;
  bundles:Array<{id:string;code:string;nameZh:string;nameEn:string;version:number}>;
  exchangeRates:Array<{id:string;base:string;quote:string;rate:number;source:string;effectiveAt:string}>;
};
type FinancePages={
  quotePage?:number;
  contractPage?:number;
  receivablePage?:number;
  paymentPage?:number;
  refundPage?:number;
  reconciliationPage?:number;
};
type ContractRow={id:string;contract_number:string;currency:string;contract_value:number;status:string};
type ReceivableRow={id:string;contract_id:string;installment_number:number;due_date:string;amount:number;paid_amount:number;status:string};
type PaymentRow={id:string;contract_id:string;receivable_schedule_id:string|null;amount:number;refunded_amount:number;currency:string;status:string;reference:string|null;paid_at:string|null};
type RefundRow={id:string;refund_number:string;payment_id:string;amount:number;reason:string;status:string;receipt_reference:string|null;created_at:string};
type ReconciliationRow={id:string;contract_id:string;payment_id:string|null;expected_amount:number;actual_amount:number;difference:number;status:string;reason:string;updated_at:string};

async function fetchFinancePage<T>(path:string,page:number,pageSize:number){
  const response=await supabaseRequest(path,{headers:{Prefer:"count=exact",Range:`${(page-1)*pageSize}-${page*pageSize-1}`}});
  const items=await response.json() as T[];
  return{items,total:Number((response.headers.get("content-range")??`*/${items.length}`).split("/")[1]??items.length)};
}

async function countFinanceRows(path:string){
  const response=await supabaseRequest(path,{headers:{Prefer:"count=exact",Range:"0-0"}});
  await response.json();
  return Number((response.headers.get("content-range")??"*/0").split("/")[1]??0);
}

export async function loadFinanceOverview(options:{query?:string;page?:number;pageSize?:number}&FinancePages={}):Promise<FinanceOverview>{
  const pageSize=Math.min(50,Math.max(5,options.pageSize??10));
  const page=(value:number|undefined)=>Math.max(1,value??1);
  const quotePage=page(options.quotePage??options.page);
  const quoteParams=new URLSearchParams({select:"id,quote_number,organization_id,currency,valid_until,status,current_version,created_at",order:"created_at.desc"});
  const query=(options.query??"").replace(/[*,()]/g," ").trim();
  if(query)quoteParams.set("quote_number",`ilike.*${query}*`);
  const [
    quoteResult,
    contractResult,
    receivableResult,
    paymentResult,
    refundResult,
    reconciliationResult,
    openReceivables,
    overdueReceivables,
    pendingRefunds,
    reconciliationExceptions,
    productRows,
    bundleRows,
    rateRows,
  ]=await Promise.all([
    fetchFinancePage<QuoteRow>(`/rest/v1/quotes?${quoteParams}`,quotePage,pageSize),
    fetchFinancePage<ContractRow>("/rest/v1/contracts?select=id,contract_number,currency,contract_value,status&order=updated_at.desc",page(options.contractPage),pageSize),
    fetchFinancePage<ReceivableRow>("/rest/v1/receivable_schedules?select=id,contract_id,installment_number,due_date,amount,paid_amount,status&order=due_date.asc",page(options.receivablePage),pageSize),
    fetchFinancePage<PaymentRow>("/rest/v1/payments?select=id,contract_id,receivable_schedule_id,amount,refunded_amount,currency,status,reference,paid_at&status=in.(CONFIRMED,REFUNDED)&order=paid_at.desc",page(options.paymentPage),pageSize),
    fetchFinancePage<RefundRow>("/rest/v1/refunds?select=id,refund_number,payment_id,amount,reason,status,receipt_reference,created_at&order=created_at.desc",page(options.refundPage),pageSize),
    fetchFinancePage<ReconciliationRow>("/rest/v1/reconciliation_items?select=id,contract_id,payment_id,expected_amount,actual_amount,difference,status,reason,updated_at&order=updated_at.desc",page(options.reconciliationPage),pageSize),
    countFinanceRows("/rest/v1/receivable_schedules?select=id&status=neq.PAID"),
    countFinanceRows("/rest/v1/receivable_schedules?select=id&status=eq.OVERDUE"),
    countFinanceRows("/rest/v1/refunds?select=id&status=eq.PENDING_APPROVAL"),
    countFinanceRows("/rest/v1/reconciliation_items?select=id&status=not.in.(MATCHED,RESOLVED)"),
    supabaseJson<Array<{id:string;code:string;name_zh:string;name_en:string}>>("/rest/v1/products?select=id,code,name_zh,name_en&active=eq.true&order=code"),
    supabaseJson<Array<{id:string;code:string;name_zh:string;name_en:string;version:number}>>("/rest/v1/product_bundles?select=id,code,name_zh,name_en,version&active=eq.true&effective_to=is.null&order=code"),
    supabaseJson<Array<{id:string;base_currency:string;quote_currency:string;rate:number;source:string;effective_at:string}>>("/rest/v1/exchange_rate_snapshots?select=id,base_currency,quote_currency,rate,source,effective_at&order=effective_at.desc&limit=100"),
  ]);
  const quoteRows=quoteResult.items;
  const contractRows=contractResult.items;
  const receivableRows=receivableResult.items;
  const paymentRows=paymentResult.items;
  const refundRows=refundResult.items;
  const reconciliationRows=reconciliationResult.items;
  const quoteIds=quoteRows.map(item=>item.id);
  const organizationIds=[...new Set(quoteRows.map(item=>item.organization_id))];
  const relatedContractIds=[...new Set([
    ...contractRows.map(item=>item.id),
    ...receivableRows.map(item=>item.contract_id),
    ...paymentRows.map(item=>item.contract_id),
    ...reconciliationRows.map(item=>item.contract_id),
  ])];
  const [versions,organizations,relatedContracts,scheduleRows]=await Promise.all([
    quoteIds.length?supabaseJson<QuoteVersionRow[]>(`/rest/v1/quote_versions?select=quote_id,version,subtotal,discount_amount,total_amount,terms_zh,terms_en,bundle_id,bundle_version,base_currency,base_total_amount&quote_id=in.(${quoteIds.join(",")})&order=version.desc`):Promise.resolve([]),
    organizationIds.length?supabaseJson<Array<{id:string;name_zh:string;name_en:string}>>(`/rest/v1/organizations?select=id,name_zh,name_en&id=in.(${organizationIds.join(",")})`):Promise.resolve([]),
    relatedContractIds.length?supabaseJson<ContractRow[]>(`/rest/v1/contracts?select=id,contract_number,currency,contract_value,status&id=in.(${relatedContractIds.join(",")})`):Promise.resolve([]),
    contractRows.length?supabaseJson<Array<{contract_id:string}>>(`/rest/v1/receivable_schedules?select=contract_id&contract_id=in.(${contractRows.map(item=>item.id).join(",")})`):Promise.resolve([]),
  ]);
  const versionMap=new Map<string,QuoteVersionRow>();
  versions.forEach(item=>{if(!versionMap.has(item.quote_id))versionMap.set(item.quote_id,item);});
  const orgMap=new Map(organizations.map(item=>[item.id,item]));
  const contractMap=new Map(relatedContracts.map(item=>[item.id,item]));
  const scheduled=new Set(scheduleRows.map(item=>item.contract_id));
  return{
    quotes:quoteRows.map(item=>{const version=versionMap.get(item.id);const org=orgMap.get(item.organization_id);return{id:item.id,number:item.quote_number,organizationId:item.organization_id,organizationZh:org?.name_zh??"",organizationEn:org?.name_en??"",currency:item.currency,validUntil:item.valid_until,status:item.status,version:item.current_version,subtotal:Number(version?.subtotal??0),discount:Number(version?.discount_amount??0),total:Number(version?.total_amount??0),termsZh:version?.terms_zh??"",termsEn:version?.terms_en??"",bundleId:version?.bundle_id??null,bundleVersion:version?.bundle_version??null,baseCurrency:version?.base_currency??null,baseTotal:version?.base_total_amount===null||version?.base_total_amount===undefined?null:Number(version.base_total_amount),createdAt:item.created_at};}),
    quoteTotal:quoteResult.total,
    contracts:contractRows.map(item=>({id:item.id,number:item.contract_number,currency:item.currency,value:Number(item.contract_value),status:item.status,hasSchedule:scheduled.has(item.id)})),
    contractTotal:contractResult.total,
    receivables:receivableRows.map(item=>({id:item.id,contractId:item.contract_id,contractNumber:contractMap.get(item.contract_id)?.contract_number??item.contract_id.slice(0,8),installment:item.installment_number,dueDate:item.due_date,amount:Number(item.amount),paidAmount:Number(item.paid_amount),status:item.status,currency:contractMap.get(item.contract_id)?.currency??""})),
    receivableTotal:receivableResult.total,
    payments:paymentRows.map(item=>({id:item.id,contractId:item.contract_id,scheduleId:item.receivable_schedule_id,amount:Number(item.amount),refundedAmount:Number(item.refunded_amount),currency:item.currency,status:item.status,reference:item.reference??"",paidAt:item.paid_at})),
    paymentTotal:paymentResult.total,
    refunds:refundRows.map(item=>({id:item.id,number:item.refund_number,paymentId:item.payment_id,amount:Number(item.amount),reason:item.reason,status:item.status,receipt:item.receipt_reference??"",createdAt:item.created_at})),
    refundTotal:refundResult.total,
    reconciliations:reconciliationRows.map(item=>({id:item.id,contractId:item.contract_id,paymentId:item.payment_id,expected:Number(item.expected_amount),actual:Number(item.actual_amount),difference:Number(item.difference),status:item.status,reason:item.reason,updatedAt:item.updated_at})),
    reconciliationTotal:reconciliationResult.total,
    pageSize,
    risk:{openReceivables,overdueReceivables,pendingRefunds,reconciliationExceptions},
    products:productRows.map(item=>({id:item.id,code:item.code,nameZh:item.name_zh,nameEn:item.name_en})),
    bundles:bundleRows.map(item=>({id:item.id,code:item.code,nameZh:item.name_zh,nameEn:item.name_en,version:Number(item.version)})),
    exchangeRates:rateRows.map(item=>({id:item.id,base:item.base_currency,quote:item.quote_currency,rate:Number(item.rate),source:item.source,effectiveAt:item.effective_at})),
  };
}
export async function financeOperation(input:Record<string,unknown>){const operation=String(input.operation);const rpc=operation==="createQuote"?"create_quote_v100":operation==="submitQuote"?"submit_quote":operation==="acceptQuote"?"accept_quote":operation==="convertQuote"?"convert_quote_to_contract":operation==="saveReceivables"?"save_receivable_schedule":operation==="recordPayment"?"record_payment":operation==="requestRefund"?"request_refund":operation==="completeRefund"?"complete_refund":"";if(!rpc)throw new Error("INVALID_FINANCE_OPERATION");const {operation:_,...body}=input;void _;return supabaseJson(`/rest/v1/rpc/${rpc}`,{method:"POST",body:JSON.stringify(body)});}

export type ImportBatchRecord={id:string;resourceType:string;filename:string;status:string;total:number;valid:number;invalid:number;duplicates:number;applied:number;failed:number;createdAt:string};
export type ImportRowRecord={id:string;batchId:string;rowNumber:number;normalized:Record<string,string>;status:string;errors:Array<{code:string}>;decision:string|null;duplicateId:string|null;score:number|null;reasons:string[];lastError:string|null};
export async function listImportBatches(page=1,pageSize=10){const start=(Math.max(1,page)-1)*pageSize;const response=await supabaseRequest(`/rest/v1/import_batches?select=*&order=created_at.desc`,{headers:{Prefer:"count=exact",Range:`${start}-${start+pageSize-1}`}});const rows=await response.json() as Array<Record<string,unknown>>;const total=Number((response.headers.get("content-range")??"*/0").split("/")[1]??rows.length);return{items:rows.map(mapImportBatch),total};}
function mapImportBatch(item:Record<string,unknown>):ImportBatchRecord{return{id:String(item.id),resourceType:String(item.resource_type),filename:String(item.original_filename),status:String(item.status),total:Number(item.total_rows),valid:Number(item.valid_rows),invalid:Number(item.invalid_rows),duplicates:Number(item.duplicate_rows),applied:Number(item.applied_rows),failed:Number(item.failed_rows),createdAt:String(item.created_at)};}
export async function listImportRows(batchId:string,page=1,pageSize=50){const size=Math.min(100,Math.max(1,pageSize)),start=(Math.max(1,page)-1)*size;const response=await supabaseRequest(`/rest/v1/import_rows?select=*&batch_id=eq.${batchId}&order=row_number.asc`,{headers:{Prefer:"count=exact",Range:`${start}-${start+size-1}`}});const rows=await response.json() as Array<Record<string,unknown>>;return{items:rows.map(item=>({id:String(item.id),batchId:String(item.batch_id),rowNumber:Number(item.row_number),normalized:item.normalized_data as Record<string,string>,status:String(item.status),errors:item.errors as Array<{code:string}>,decision:item.decision?String(item.decision):null,duplicateId:item.duplicate_entity_id?String(item.duplicate_entity_id):null,score:item.duplicate_score===null?null:Number(item.duplicate_score),reasons:item.duplicate_reasons as string[],lastError:item.last_error?String(item.last_error):null} satisfies ImportRowRecord)),total:Number((response.headers.get("content-range")??"*/0").split("/")[1]??rows.length),page:Math.max(1,page),pageSize:size};}
export async function importOperation(input:Record<string,unknown>){const operation=String(input.operation);const rpc=operation==="create"?"create_import_batch":operation==="decide"?"decide_import_row":operation==="process"?"process_import_batch":operation==="rollback"?"rollback_import_batch":"";if(!rpc)throw new Error("INVALID_IMPORT_OPERATION");const {operation:_,...body}=input;void _;const result=await supabaseJson<Record<string,unknown>>(`/rest/v1/rpc/${rpc}`,{method:"POST",body:JSON.stringify(body)});return operation==="decide"?result:mapImportBatch(result);}

export type QualityIssue={id:string;ruleKey:string;entityType:string;entityId:string;severity:string;titleKey:string;details:Record<string,string>;status:string;assignedTo:string|null;resolution:string;lastSeenAt:string};
export async function listQualityIssues(options:{query?:string;page?:number;pageSize?:number;status?:string}={}){const page=Math.max(1,options.page??1),pageSize=Math.min(50,options.pageSize??10),start=(page-1)*pageSize;const params=new URLSearchParams({select:"*",order:"last_seen_at.desc"});if(options.status&&options.status!=="all")params.set("status",`eq.${options.status}`);const query=(options.query??"").replace(/[*,()]/g," ").trim();if(query)params.set("or",`(rule_key.ilike.*${query}*,entity_type.ilike.*${query}*)`);const response=await supabaseRequest(`/rest/v1/data_quality_issues?${params}`,{headers:{Prefer:"count=exact",Range:`${start}-${start+pageSize-1}`}});const rows=await response.json() as Array<Record<string,unknown>>;return{items:rows.map(item=>({id:String(item.id),ruleKey:String(item.rule_key),entityType:String(item.entity_type),entityId:String(item.entity_id),severity:String(item.severity),titleKey:String(item.title_key),details:item.details as Record<string,string>,status:String(item.status),assignedTo:item.assigned_to?String(item.assigned_to):null,resolution:String(item.resolution_note??""),lastSeenAt:String(item.last_seen_at)} satisfies QualityIssue)),total:Number((response.headers.get("content-range")??"*/0").split("/")[1]??rows.length)};}
export async function qualityOperation(input:{operation:"run"|"resolve";id?:string;resolution?:string;dismiss?:boolean}){return input.operation==="run"?supabaseJson<number>("/rest/v1/rpc/run_data_quality_rules",{method:"POST",body:"{}"}):supabaseJson("/rest/v1/rpc/resolve_data_quality_issue",{method:"POST",body:JSON.stringify({target_issue:input.id,resolution:input.resolution,dismiss:input.dismiss??false})});}

export type CalendarDeliveryRecord={id:string;appointmentId:string;email:string;name:string;type:string;version:number;status:string;attempts:number;lastError:string;deliveredAt:string|null};
export async function listCalendarDeliveries(appointmentId:string){const rows=await supabaseJson<Array<{id:string;appointment_id:string;attendee_id:string;delivery_type:string;event_version:number;status:string;attempts:number;last_error:string|null;delivered_at:string|null}>>(`/rest/v1/calendar_deliveries?select=id,appointment_id,attendee_id,delivery_type,event_version,status,attempts,last_error,delivered_at&appointment_id=eq.${appointmentId}&order=created_at.desc`);const ids=[...new Set(rows.map(item=>item.attendee_id))];const attendees=ids.length?await supabaseJson<Array<{id:string;email:string;name:string}>>(`/rest/v1/appointment_attendees?select=id,email,name&id=in.(${ids.join(",")})`):[];const map=new Map(attendees.map(item=>[item.id,item]));return rows.map(item=>({id:item.id,appointmentId:item.appointment_id,email:map.get(item.attendee_id)?.email??"",name:map.get(item.attendee_id)?.name??"",type:item.delivery_type,version:item.event_version,status:item.status,attempts:item.attempts,lastError:item.last_error??"",deliveredAt:item.delivered_at}));}
