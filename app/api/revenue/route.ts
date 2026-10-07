import {NextResponse} from 'next/server';
import {z} from 'zod';
import {apiRoute,ApiError,requireApiCapability} from '@/lib/api';
import {mutationIsTrusted} from '@/lib/request-security';
import {databaseJson} from '@/lib/db/gateway';
import {loadRevenueWorkspace} from '@/lib/revenue-workspace-repository';
import type {Capability} from '@/lib/capabilities';

const query=z.object({entity:z.uuid().optional(),contract:z.uuid().optional(),page:z.coerce.number().int().min(1).max(100000).optional(),status:z.string().max(32).optional(),currency:z.string().regex(/^[A-Z]{3}$/).optional(),q:z.string().max(80).optional()});
const base={entity:z.uuid(),target:z.uuid().nullable(),revision:z.number().int().positive().nullable(),requestKey:z.string().min(8).max(160)};
const reference=z.string().trim().min(1).max(200);
const decimal=z.string().regex(/^\d{1,12}(\.\d{1,2})?$/);
const unit=z.object({key:z.string().regex(/^[A-Z0-9_-]{1,80}$/),units:z.string().regex(/^\d{1,12}(\.\d{1,6})?$/),from:z.iso.date().optional(),to:z.iso.date().optional()});
const schema=z.discriminatedUnion('operation',[
 z.object({...base,operation:z.literal('requirements'),requirements:z.record(z.string().max(80),z.object({source_domain:z.enum(['CRM_ACTIVITY','STUDENT_ENROLLMENT']),source_ids:z.array(z.uuid()).min(1).max(50),evidence_type:z.enum(['DELIVERABLE','COVERAGE','MILESTONE','SERVICE_DELIVERY']),condition:z.enum(['MEETING','CALL','NOTE','COMPLETED']),date_basis:z.enum(['OCCURRED_ON','COMPLETED_ON'])}).strict())}),
 z.object({...base,operation:z.literal('correctionRule'),method:z.enum(['BLOCKED','REVISED_ENTITLEMENT']),priorPeriod:z.boolean(),reference}),
 z.object({...base,operation:z.literal('candidate'),command:z.enum(['SUBMIT','APPROVE','REJECT','REVALIDATE']),reference:reference.optional()}),
 z.object({...base,operation:z.literal('evaluate'),service:z.uuid(),binding:z.uuid(),unit:z.string().min(1).max(80)}),
 z.object({...base,operation:z.literal('post'),reference}),
 z.object({...base,operation:z.literal('correction'),root:z.uuid(),revised:z.uuid(),kind:z.enum(['ADJUSTMENT','REVERSAL','REPLACEMENT']),intent:z.string().min(8).max(120),reference}),
 z.object({...base,operation:z.literal('evidence'),command:z.enum(['CREATE','SUBMIT','ACCEPT','REJECT','WITHDRAW']),data:z.object({specified_service_id:z.uuid().optional(),binding_id:z.uuid().optional(),recognition_unit_key:z.string().max(80).optional(),source_domain:z.enum(['CRM_ACTIVITY','STUDENT_ENROLLMENT']).optional(),source_id:z.uuid().optional(),evidence_type:z.enum(['SERVICE_DELIVERY','DELIVERABLE','COVERAGE','MILESTONE']).optional(),business_date:z.iso.date().optional(),verified_units:z.string().regex(/^\d+(\.\d{1,6})?$/).optional(),coverage_from:z.iso.date().optional(),coverage_to:z.iso.date().optional(),reference:reference.optional()}).strict()}),
 z.object({...base,operation:z.literal('foundation'),command:z.enum(['POLICY_SUBMIT','BINDING_SUBMIT','PERIOD_CLOSE']),reference:reference.optional()}),
 z.object({...base,operation:z.literal('approval'),decision:z.enum(['APPROVED','REJECTED']),reference}),
 z.object({...base,operation:z.literal('policy'),data:z.object({policy_key:z.string().regex(/^[A-Z][A-Z0-9_]{2,79}$/),recognition_strategy:z.enum(['POINT_IN_TIME_ON_APPROVED_EVIDENCE','OVER_TIME_BY_VERIFIED_UNITS','OVER_TIME_BY_APPROVED_MILESTONES']),amount_strategy:z.enum(['ACCEPTED_SERVICE_CONSIDERATION','APPROVED_AGENT_FEE','APPROVED_ALLOCATED_CONSIDERATION']),presentation:z.enum(['GROSS','NET']),fulfillment_rule_reference:reference,refund_correction_reference:reference,currency:z.string().regex(/^[A-Z]{3}$/),effective_from:z.iso.date(),effective_to:z.iso.date().optional()}).strict()}),
 z.object({...base,operation:z.literal('binding'),data:z.object({specified_service_id:z.uuid(),policy_version_id:z.uuid(),predecessor_id:z.uuid().optional(),principal_agent_role:z.enum(['PRINCIPAL','AGENT']),presentation:z.enum(['GROSS','NET']),assessment_basis_reference:reference,assessment_sources:z.array(reference).min(1).max(30),amount:decimal,agent_fee:decimal.optional(),allocation_decision_reference:reference.optional(),scenario_reference:reference.optional(),reference_fallback:reference.optional(),has_variance:z.boolean(),variance_review_reference:reference.optional(),recognition_unit_schedule:z.array(unit).min(1).max(24)}).strict()}),
 z.object({...base,operation:z.literal('cash'),command:z.enum(['APPLY','REVERSE']),data:z.object({service_id:z.uuid().optional(),receivable_id:z.uuid().optional(),application_id:z.uuid().optional(),amount:decimal,intent:z.string().min(8).max(120),reference}).strict()}),
]);
async function get(request:Request){await requireApiCapability('revenue.recognition.view');const params=new URL(request.url).searchParams;if(params.has('service')){await requireApiCapability('revenue.binding.manage');const p=z.object({entity:z.uuid(),service:z.uuid(),binding:z.uuid().optional()}).safeParse(Object.fromEntries(params));if(!p.success)throw new ApiError('REVENUE_INPUT_INVALID',400);return NextResponse.json(await databaseJson('/db/rpc/revenue_source_options',{method:'POST',body:JSON.stringify(p.data)}));}const parsed=query.safeParse(Object.fromEntries(params));if(!parsed.success)throw new ApiError('REVENUE_INPUT_INVALID',400);return NextResponse.json(await loadRevenueWorkspace(parsed.data));}
async function post(request:Request){
 if(!mutationIsTrusted(request))throw new ApiError('UNTRUSTED_ORIGIN',403);
 const parsed=schema.safeParse(await request.json().catch(()=>null));if(!parsed.success)throw new ApiError('REVENUE_INPUT_INVALID',400);
 const v=parsed.data;let capability:Capability='revenue.recognition.manage';
 if(v.operation==='post')capability='revenue.recognition.post';
 else if(v.operation==='candidate'&&['APPROVE','REJECT'].includes(v.command))capability='revenue.recognition.review';
 else if(v.operation==='approval')capability='revenue.policy.approve';
 else if(v.operation==='foundation')capability=v.command==='PERIOD_CLOSE'?'revenue.configuration.manage':v.command==='BINDING_SUBMIT'?'revenue.binding.manage':'revenue.policy.manage';
 else if(v.operation==='policy'||v.operation==='correctionRule')capability='revenue.policy.manage';
 else if(v.operation==='binding'||v.operation==='requirements')capability='revenue.binding.manage';
 else if(v.operation==='evidence')capability=['ACCEPT','REJECT','WITHDRAW'].includes(v.command)?'revenue.fulfillment.verify':'revenue.fulfillment.manage';
 else if(v.operation==='cash')capability='finance.cashApplication.manage';
 const user=await requireApiCapability(capability);
 if(user.aal!=='aal2')throw new ApiError('MFA_REQUIRED',403);
 let rpc='';let args:Record<string,unknown>={entity:v.entity,target:v.target,expected_revision:v.revision,request_key:v.requestKey};
 switch(v.operation){
  case 'requirements':rpc='revenue_set_fulfillment_requirements';args={...args,requirements:v.requirements};break;
  case 'correctionRule':rpc='revenue_set_correction_rule';args={...args,rule:{method:v.method,allow_prior_period:v.priorPeriod,reference:v.reference}};break;
  case 'candidate':rpc='revenue_candidate_command';args={...args,command:v.command,data:v.reference?{reference:v.reference}:{}};break;
  case 'evaluate':rpc='revenue_candidate_command';args={...args,target:null,expected_revision:null,command:'EVALUATE',data:{specified_service_id:v.service,binding_id:v.binding,recognition_unit_key:v.unit}};break;
  case 'post':rpc='revenue_post_candidate';args={...args,posting_reference:v.reference};break;
  case 'correction':rpc='revenue_evaluate_correction';args={entity:v.entity,data:{original_fact_id:v.root,revised_candidate_id:v.revised,candidate_kind:v.kind,correction_intent_key:v.intent,reason_reference:v.reference},request_key:v.requestKey};break;
  case 'evidence':rpc='revenue_attestation_command';args={...args,command:v.command,data:v.data};break;
  case 'foundation':rpc='revenue_foundation_command';args={...args,command:v.command,data:v.reference?{reference:v.reference}:{}};break;
  case 'approval':rpc='decide_revenue_approval';args={request_id:v.target,expected_revision:v.revision,decision:v.decision,reference:v.reference,request_key:v.requestKey};break;
  case 'policy':case 'binding':rpc='revenue_foundation_command';args={...args,command:v.operation==='policy'?'POLICY_CREATE':'BINDING_CREATE',data:v.data};break;
  case 'cash':rpc='cash_application_command';args={entity:v.entity,command:v.command,source:v.target,data:v.data,request_key:v.requestKey};break;
 }
 const item=await databaseJson<Record<string,unknown>>(`/db/rpc/${rpc}`,{method:'POST',body:JSON.stringify(args)});
 // Mutation response does not expose the raw canonical source payload.
 return NextResponse.json({accepted:true,item:{id:item.id??v.target,status:item.status??'ACCEPTED',revision:item.revision??null}});
}
export const GET=apiRoute(get,'REVENUE_LOAD_FAILED');
export const POST=apiRoute(post,'REVENUE_OPERATION_FAILED');
