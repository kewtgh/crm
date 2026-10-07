-- R5D: immutable earned facts and governed net corrections. No cash/GL owner.
set search_path=public,app_auth,extensions;
alter table public.revenue_policy_versions add column correction_rule jsonb not null default '{"method":"BLOCKED","allow_prior_period":false}';
alter table public.revenue_policy_versions add constraint revenue_correction_rule_shape check(
 jsonb_typeof(correction_rule)='object' and correction_rule->>'method' in ('BLOCKED','REVISED_ENTITLEMENT') and jsonb_typeof(correction_rule->'allow_prior_period')='boolean');

create or replace function public.guard_revenue_foundation_row() returns trigger language plpgsql set search_path=public,app_auth as $$
declare frozen boolean;begin
 if tg_op='DELETE' then raise exception 'revenue_retention_required';end if;
 if tg_table_name='revenue_policy_versions' then
  if old.status='DRAFT' and new.status='DRAFT' and new.revision=old.revision+1 and (to_jsonb(new)-array['correction_rule','revision'])=(to_jsonb(old)-array['correction_rule','revision']) then return new;end if;
 end if;
 if tg_table_name='revenue_service_bindings' then
  if old.status='DRAFT' and new.status='DRAFT' and new.revision=old.revision+1 and (to_jsonb(new)-array['fulfillment_requirements','revision'])=(to_jsonb(old)-array['fulfillment_requirements','revision']) then return new;end if;
 end if;
 if tg_table_name='contract_specified_services' then raise exception 'revenue_service_immutable';end if;
 frozen:=tg_table_name in ('revenue_policy_versions','revenue_service_bindings','revenue_reporting_profiles');
 if frozen and (to_jsonb(new)-array['status','revision','approval_reference','approved_by','approved_at','reviewed_by']) is distinct from (to_jsonb(old)-array['status','revision','approval_reference','approved_by','approved_at','reviewed_by']) then raise exception 'revenue_version_immutable';end if;
 if tg_table_name='revenue_authority_assignments' and (to_jsonb(new)-array['revoked_at','revision','authority_reference','status','approval_reference']) is distinct from (to_jsonb(old)-array['revoked_at','revision','authority_reference','status','approval_reference']) then raise exception 'revenue_authority_immutable';end if;
 if tg_table_name='revenue_accounting_periods' and (old.status='CLOSED' or (to_jsonb(new)-array['status','revision','closed_by','closed_at','close_reference']) is distinct from (to_jsonb(old)-array['status','revision','closed_by','closed_at','close_reference'])) then raise exception 'revenue_period_immutable';end if;
 return new;end $$;

create function public.revenue_set_correction_rule(entity uuid,target uuid,expected_revision integer,rule jsonb,request_key text) returns jsonb
language plpgsql security definer set search_path=public,app_auth as $$
declare p public.revenue_policy_versions;result jsonb;payload jsonb:=jsonb_build_object('entity',entity,'target',target,'revision',expected_revision,'rule',rule);begin
 perform public.revenue_require(entity,'POLICY_OWNER');
 if not public.revenue_has_authority(entity,'POLICY_OWNER') then raise exception 'revenue_authority_required';end if;
 result:=public.commission_receipt(request_key,'REVENUE_CORRECTION_RULE',payload);if result is not null then return result;end if;
 select * into p from public.revenue_policy_versions where workspace_id=public.revenue_workspace_id() and reporting_entity_id=entity and id=target for update;
 if not found or p.created_by<>app_auth.current_user_id() or p.status<>'DRAFT' or p.revision is distinct from expected_revision then raise exception 'revenue_version_conflict';end if;
 if jsonb_typeof(rule) is distinct from 'object' or coalesce(rule->>'method','') not in ('BLOCKED','REVISED_ENTITLEMENT') or jsonb_typeof(rule->'allow_prior_period') is distinct from 'boolean' or nullif(trim(rule->>'reference'),'') is null or exists(select 1 from jsonb_object_keys(rule) k where k not in ('method','allow_prior_period','reference')) then raise exception 'revenue_correction_rule_invalid';end if;
 update public.revenue_policy_versions set correction_rule=rule,revision=revision+1 where id=target returning jsonb_build_object('id',id,'revision',revision) into result;
 perform public.revenue_audit('REVENUE_CORRECTION_RULE',target,jsonb_build_object('digest',public.revenue_digest(rule)));
 return public.commission_finish(request_key,'REVENUE_CORRECTION_RULE',payload,result);end $$;

-- ORIGINAL is a deterministic classification of all R5C rows, not a financial backfill.
alter table public.revenue_recognition_candidates add column candidate_kind text not null default 'ORIGINAL' check(candidate_kind in ('ORIGINAL','ADJUSTMENT','REVERSAL','REPLACEMENT'));
alter table public.revenue_recognition_candidates add column original_fact_id uuid;
alter table public.revenue_recognition_candidates add column prior_fact_id uuid;
alter table public.revenue_recognition_candidates add column correction_intent_key text;
alter table public.revenue_recognition_candidates add column correction_reason_reference text;
alter table public.revenue_recognition_candidates add column revised_entitlement_snapshot jsonb;
alter table public.revenue_recognition_candidates drop constraint revenue_recognition_candidates_amount_check;
alter table public.revenue_recognition_candidates add constraint revenue_candidate_signed_amount check((candidate_kind='ORIGINAL' and amount>=0 and original_fact_id is null and prior_fact_id is null and correction_intent_key is null and revised_entitlement_snapshot is null) or (candidate_kind<>'ORIGINAL' and amount<>0 and original_fact_id is not null and prior_fact_id is not null and length(correction_intent_key) between 8 and 120 and length(trim(correction_reason_reference))>0 and revised_entitlement_snapshot is not null));
alter table public.revenue_recognition_candidates drop constraint revenue_recognition_candidates_evaluation_version_check;
alter table public.revenue_recognition_candidates add constraint revenue_candidate_evaluator check((candidate_kind='ORIGINAL' and evaluation_version='R5C_EVALUATOR_V1') or (candidate_kind<>'ORIGINAL' and evaluation_version='R5D_CORRECTION_V1'));
drop index public.revenue_candidate_live_unit;
create unique index revenue_candidate_live_unit on public.revenue_recognition_candidates(workspace_id,reporting_entity_id,contract_id,stable_service_key,recognition_unit_key) where candidate_kind='ORIGINAL' and status in ('DRAFT','READY_FOR_REVIEW','APPROVED');
create unique index revenue_correction_intent on public.revenue_recognition_candidates(workspace_id,reporting_entity_id,original_fact_id,correction_intent_key) where candidate_kind<>'ORIGINAL';

create table public.recognized_revenue_facts (
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null,reporting_entity_id uuid not null,candidate_id uuid not null unique,
 contract_id uuid not null,contract_version_id uuid not null,specified_service_id uuid not null,stable_service_key text not null,
 binding_id uuid not null,policy_version_id uuid not null,recognition_unit_key text not null,
 amount numeric(14,2) not null,currency text not null check(currency~'^[A-Z]{3}$'),business_date date not null,accounting_period_id uuid not null,
 fact_kind text not null check(fact_kind in ('ORIGINAL','ADJUSTMENT','REVERSAL','REPLACEMENT')),
 original_fact_id uuid,prior_fact_id uuid,correction_intent_key text,prior_period_flag boolean not null default false,
 original_business_date date not null,posted_by uuid not null references app_auth.accounts(id),posted_at timestamptz not null default clock_timestamp(),
 approval_reference uuid not null,posting_reference text not null check(length(trim(posting_reference))>0),source_basis_digest text not null,created_at timestamptz not null default clock_timestamp(),
 unique(workspace_id,reporting_entity_id,id),unique(workspace_id,reporting_entity_id,contract_id,stable_service_key,recognition_unit_key,currency,id),
 foreign key(workspace_id,reporting_entity_id,candidate_id) references public.revenue_recognition_candidates(workspace_id,reporting_entity_id,id),
 foreign key(workspace_id,reporting_entity_id,contract_id,contract_version_id,stable_service_key,specified_service_id) references public.contract_specified_services(workspace_id,reporting_entity_id,contract_id,contract_version_id,stable_service_key,id),
 foreign key(workspace_id,reporting_entity_id,specified_service_id,binding_id) references public.revenue_service_bindings(workspace_id,reporting_entity_id,specified_service_id,id),
 foreign key(workspace_id,reporting_entity_id,policy_version_id) references public.revenue_policy_versions(workspace_id,reporting_entity_id,id),
 foreign key(workspace_id,reporting_entity_id,accounting_period_id) references public.revenue_accounting_periods(workspace_id,reporting_entity_id,id),
 foreign key(workspace_id,approval_reference) references public.approval_requests(workspace_id,id),
 foreign key(workspace_id,reporting_entity_id,contract_id,stable_service_key,recognition_unit_key,currency,original_fact_id) references public.recognized_revenue_facts(workspace_id,reporting_entity_id,contract_id,stable_service_key,recognition_unit_key,currency,id),
 foreign key(workspace_id,reporting_entity_id,contract_id,stable_service_key,recognition_unit_key,currency,prior_fact_id) references public.recognized_revenue_facts(workspace_id,reporting_entity_id,contract_id,stable_service_key,recognition_unit_key,currency,id),
 check((fact_kind='ORIGINAL' and amount>=0 and original_fact_id is null and prior_fact_id is null and correction_intent_key is null and not prior_period_flag) or (fact_kind<>'ORIGINAL' and original_fact_id is not null and prior_fact_id is not null and amount<>0 and correction_intent_key is not null)),
 check(fact_kind<>'REVERSAL' or amount<0)
);
create unique index revenue_original_earning_unit on public.recognized_revenue_facts(workspace_id,reporting_entity_id,contract_id,stable_service_key,recognition_unit_key) where fact_kind='ORIGINAL';
create unique index revenue_fact_correction_intent on public.recognized_revenue_facts(workspace_id,reporting_entity_id,original_fact_id,correction_intent_key) where fact_kind<>'ORIGINAL';
alter table public.revenue_recognition_candidates add constraint revenue_candidate_original_fact foreign key(workspace_id,reporting_entity_id,original_fact_id) references public.recognized_revenue_facts(workspace_id,reporting_entity_id,id);
alter table public.revenue_recognition_candidates add constraint revenue_candidate_prior_fact foreign key(workspace_id,reporting_entity_id,prior_fact_id) references public.recognized_revenue_facts(workspace_id,reporting_entity_id,id);

create function public.revenue_fact_immutable() returns trigger language plpgsql as $$begin raise exception 'revenue_fact_immutable';end $$;
create trigger revenue_fact_retention before update or delete on public.recognized_revenue_facts for each row execute function public.revenue_fact_immutable();

create function public.revenue_unit_consumption(entity uuid,contract uuid,service_key text,unit_key text) returns jsonb
language plpgsql security definer set search_path=public,app_auth as $$
declare root public.recognized_revenue_facts;total numeric;last_id uuid;history jsonb;begin
 select * into root from public.recognized_revenue_facts where workspace_id=public.revenue_workspace_id() and reporting_entity_id=entity and contract_id=contract and stable_service_key=service_key and recognition_unit_key=unit_key and fact_kind='ORIGINAL';
 if not found then return jsonb_build_object('root',null,'current_amount','0.00','currency',null,'prior',null,'facts','[]'::jsonb);end if;
 select sum(amount),jsonb_agg(jsonb_build_object('id',id,'kind',fact_kind,'amount',amount::text,'candidate',candidate_id,'digest',source_basis_digest) order by posted_at,id) into total,history from public.recognized_revenue_facts where workspace_id=root.workspace_id and reporting_entity_id=entity and currency=root.currency and (id=root.id or original_fact_id=root.id);
 select id into last_id from public.recognized_revenue_facts where workspace_id=root.workspace_id and (id=root.id or original_fact_id=root.id) order by posted_at desc,id desc limit 1;
 return jsonb_build_object('root',root.id,'current_amount',total::numeric(14,2)::text,'currency',root.currency,'prior',last_id,'facts',history);end $$;

-- A revised ORIGINAL candidate is an approved cumulative entitlement, not a new earning.
create function public.revenue_correction_basis(entity uuid,root_id uuid,revised_id uuid,kind text,intent text,reason text,refund_id uuid default null) returns jsonb
language plpgsql security definer set search_path=public,app_auth as $$
declare root public.recognized_revenue_facts;r public.revenue_recognition_candidates;root_policy public.revenue_policy_versions;new_policy public.revenue_policy_versions;
 consumption jsonb;basis jsonb;rf public.refunds;pay public.payments;refund_ref jsonb;delta numeric(14,2);prior_period boolean;begin
 select * into root from public.recognized_revenue_facts where workspace_id=public.revenue_workspace_id() and reporting_entity_id=entity and id=root_id and fact_kind='ORIGINAL' for share;
 if not found then raise exception 'revenue_original_fact_required';end if;
 select * into r from public.revenue_recognition_candidates where workspace_id=root.workspace_id and reporting_entity_id=entity and id=revised_id for share;
 if not found or r.candidate_kind<>'ORIGINAL' or r.status<>'APPROVED' or r.contract_id<>root.contract_id or r.stable_service_key<>root.stable_service_key or r.recognition_unit_key<>root.recognition_unit_key or r.currency<>root.currency then raise exception 'revenue_revised_entitlement_required';end if;
 if not public.revenue_candidate_current(r.id) then raise exception 'revenue_stale_basis';end if;
 select * into strict root_policy from public.revenue_policy_versions where id=root.policy_version_id;
 select * into strict new_policy from public.revenue_policy_versions where id=r.policy_version_id;
 if root_policy.test_only or new_policy.test_only or root_policy.correction_rule->>'method'<>'REVISED_ENTITLEMENT' or new_policy.correction_rule->>'method'<>'REVISED_ENTITLEMENT' then raise exception 'revenue_correction_policy_required';end if;
 prior_period:=r.accounting_period_id<>root.accounting_period_id;
 if prior_period and (not (root_policy.correction_rule->>'allow_prior_period')::boolean or not (new_policy.correction_rule->>'allow_prior_period')::boolean) then raise exception 'revenue_prior_period_policy_required';end if;
 if kind not in ('ADJUSTMENT','REVERSAL','REPLACEMENT') or length(coalesce(intent,'')) not between 8 and 120 or nullif(trim(reason),'') is null then raise exception 'revenue_correction_input_invalid';end if;
 consumption:=public.revenue_unit_consumption(entity,root.contract_id,root.stable_service_key,root.recognition_unit_key);
 delta:=r.amount-(consumption->>'current_amount')::numeric;
 if delta=0 or r.amount<0 or (consumption->>'current_amount')::numeric<0 or (kind='REVERSAL' and delta>=0) then raise exception 'revenue_correction_amount_invalid';end if;
 if refund_id is not null then
  select * into rf from public.refunds where workspace_id=root.workspace_id and id=refund_id for share;
  if not found or rf.status<>'PAID' then raise exception 'revenue_refund_reference_invalid';end if;
  select * into pay from public.payments where workspace_id=root.workspace_id and id=rf.payment_id for share;
  if not found or pay.contract_id<>root.contract_id or pay.currency<>root.currency then raise exception 'revenue_refund_reference_invalid';end if;
  refund_ref:=jsonb_build_object('id',rf.id,'payment',pay.id,'digest',public.revenue_digest(jsonb_build_object('id',rf.id,'status',rf.status,'amount',rf.amount::text,'currency',pay.currency,'refunded_at',rf.refunded_at)));
 end if;
 basis:=jsonb_build_object('entity',entity,'root',root.id,'original_business_date',root.business_date,'original_digest',root.source_basis_digest,'prior',consumption->'prior','consumption',consumption,'revised_candidate',r.id,'revised_digest',r.basis_digest,'revised_revision',r.revision,'target_amount',r.amount::text,'delta',delta::text,'currency',r.currency,'business_date',r.business_date,'period',r.accounting_period_id,'prior_period',prior_period,'root_rule',root_policy.correction_rule,'revised_rule',new_policy.correction_rule,'refund',refund_ref,'kind',kind,'intent',intent,'reason',reason,'evaluation_version','R5D_CORRECTION_V1');
 return basis||jsonb_build_object('digest',public.revenue_digest(basis));end $$;

create or replace function public.revenue_candidate_current(target uuid) returns boolean language plpgsql security definer set search_path=public,app_auth as $$
declare c public.revenue_recognition_candidates;b jsonb;begin
 select * into c from public.revenue_recognition_candidates where workspace_id=public.revenue_workspace_id() and id=target;
 if not found then return false;end if;
 begin
  if c.candidate_kind='ORIGINAL' then b:=public.revenue_candidate_basis(c.reporting_entity_id,c.specified_service_id,c.binding_id,c.recognition_unit_key);
  else b:=public.revenue_correction_basis(c.reporting_entity_id,c.original_fact_id,(c.revised_entitlement_snapshot->>'revised_candidate')::uuid,c.candidate_kind,c.correction_intent_key,c.correction_reason_reference,(c.revised_entitlement_snapshot->'refund'->>'id')::uuid);end if;
 exception when raise_exception then return false;end;
 return c.basis_digest=b->>'digest';end $$;

create function public.revenue_evaluate_correction(entity uuid,data jsonb,request_key text) returns jsonb
language plpgsql security definer set search_path=public,app_auth as $$
declare c public.revenue_recognition_candidates;r public.revenue_recognition_candidates;b jsonb;result jsonb;payload jsonb:=jsonb_build_object('entity',entity,'data',data);begin
 perform public.revenue_require(entity,'RECOGNITION_PREPARER');if not public.revenue_has_authority(entity,'RECOGNITION_PREPARER') then raise exception 'revenue_authority_required';end if;
 result:=public.commission_receipt(request_key,'REVENUE_CORRECTION_EVALUATE',payload);if result is not null then return result;end if;
 if jsonb_typeof(data) is distinct from 'object' or exists(select 1 from jsonb_object_keys(data) k where k not in ('original_fact_id','revised_candidate_id','candidate_kind','correction_intent_key','reason_reference','refund_id')) then raise exception 'revenue_input_invalid';end if;
 select * into c from public.revenue_recognition_candidates where workspace_id=public.revenue_workspace_id() and reporting_entity_id=entity and original_fact_id=(data->>'original_fact_id')::uuid and correction_intent_key=data->>'correction_intent_key';
 if found then
  if c.candidate_kind is distinct from data->>'candidate_kind' or c.revised_entitlement_snapshot->>'revised_candidate' is distinct from data->>'revised_candidate_id' or c.correction_reason_reference is distinct from data->>'reason_reference' or c.revised_entitlement_snapshot->'refund'->>'id' is distinct from data->>'refund_id' then raise exception 'revenue_correction_intent_conflict';end if;
 else
  b:=public.revenue_correction_basis(entity,(data->>'original_fact_id')::uuid,(data->>'revised_candidate_id')::uuid,data->>'candidate_kind',data->>'correction_intent_key',data->>'reason_reference',(data->>'refund_id')::uuid);
  select * into strict r from public.revenue_recognition_candidates where id=(data->>'revised_candidate_id')::uuid;
  insert into public.revenue_recognition_candidates(workspace_id,reporting_entity_id,contract_id,contract_version_id,specified_service_id,stable_service_key,binding_id,binding_version,policy_version_id,recognition_unit_key,business_date,accounting_period_id,evidence_references,source_fact_references,amount_basis_snapshot,amount,currency,basis_digest,evaluation_version,created_by,candidate_kind,original_fact_id,prior_fact_id,correction_intent_key,correction_reason_reference,revised_entitlement_snapshot)
  values(r.workspace_id,entity,r.contract_id,r.contract_version_id,r.specified_service_id,r.stable_service_key,r.binding_id,r.binding_version,r.policy_version_id,r.recognition_unit_key,r.business_date,r.accounting_period_id,r.evidence_references,r.source_fact_references,r.amount_basis_snapshot,(b->>'delta')::numeric,r.currency,b->>'digest','R5D_CORRECTION_V1',app_auth.current_user_id(),data->>'candidate_kind',(b->>'root')::uuid,(b->>'prior')::uuid,data->>'correction_intent_key',data->>'reason_reference',b-'digest') returning * into c;
  perform public.revenue_audit('REVENUE_CORRECTION_CREATED',c.id,jsonb_build_object('root',c.original_fact_id,'basis_digest',c.basis_digest,'amount',c.amount::text));
 end if;
 result:=to_jsonb(c)||jsonb_build_object('amount',c.amount::text);return public.commission_finish(request_key,'REVENUE_CORRECTION_EVALUATE',payload,result);end $$;

create function public.revenue_post_candidate(entity uuid,target uuid,expected_revision integer,posting_reference text,request_key text) returns jsonb
language plpgsql security definer set search_path=public,app_auth as $$
declare c public.revenue_recognition_candidates;f public.recognized_revenue_facts;p public.revenue_policy_versions;approval public.approval_requests;consumption jsonb;result jsonb;actor uuid:=app_auth.current_user_id();
 payload jsonb:=jsonb_build_object('entity',entity,'candidate',target,'revision',expected_revision,'reference',posting_reference);begin
 perform public.revenue_require(entity,'POSTING_AUTHORITY');if not public.revenue_has_authority(entity,'POSTING_AUTHORITY') then raise exception 'revenue_authority_required';end if;
 result:=public.commission_receipt(request_key,'REVENUE_POST',payload);if result is not null then return result;end if;
 if nullif(trim(posting_reference),'') is null then raise exception 'revenue_posting_reference_required';end if;
 select * into f from public.recognized_revenue_facts where workspace_id=public.revenue_workspace_id() and reporting_entity_id=entity and candidate_id=target;
 if found then return public.commission_finish(request_key,'REVENUE_POST',payload,to_jsonb(f)||jsonb_build_object('amount',f.amount::text));end if;
 select * into c from public.revenue_recognition_candidates where workspace_id=public.revenue_workspace_id() and reporting_entity_id=entity and id=target for update;
 if not found or c.status<>'APPROVED' or c.revision is distinct from expected_revision then raise exception 'revenue_candidate_not_approved';end if;
 if actor=c.created_by or actor=c.reviewed_by then raise exception 'revenue_independent_poster_required';end if;
 select * into p from public.revenue_policy_versions where id=c.policy_version_id for share;
 if p.test_only then raise exception 'revenue_test_only_forbidden';end if;
 select * into approval from public.approval_requests where workspace_id=c.workspace_id and id=c.approval_reference for share;
 if not found or approval.status<>'APPROVED' or approval.request_type<>'REVENUE_RECOGNITION_CANDIDATE' or approval.business_object_id<>c.id::text or approval.request_payload->>'digest' is distinct from c.basis_digest or approval.request_payload->>'entity'<>entity::text or (approval.request_payload->>'revision')::integer+1<>c.revision or approval.decided_by is distinct from c.reviewed_by then raise exception 'revenue_posting_approval_invalid';end if;
 if not public.revenue_candidate_current(c.id) then raise exception 'revenue_stale_basis';end if;
 perform 1 from public.revenue_accounting_periods where workspace_id=c.workspace_id and reporting_entity_id=entity and id=c.accounting_period_id and status='OPEN' for share;
 if not found then raise exception 'revenue_period_closed';end if;
 consumption:=public.revenue_unit_consumption(entity,c.contract_id,c.stable_service_key,c.recognition_unit_key);
 if c.candidate_kind='ORIGINAL' and consumption->>'root' is not null then raise exception 'revenue_correction_required';end if;
 if c.candidate_kind<>'ORIGINAL' and (consumption->>'root' is distinct from c.original_fact_id::text or consumption->>'prior' is distinct from c.prior_fact_id::text or (consumption->>'current_amount')::numeric+c.amount<0 or (consumption->>'current_amount')::numeric+c.amount<>(c.revised_entitlement_snapshot->>'target_amount')::numeric) then raise exception 'revenue_correction_balance_conflict';end if;
 insert into public.recognized_revenue_facts(workspace_id,reporting_entity_id,candidate_id,contract_id,contract_version_id,specified_service_id,stable_service_key,binding_id,policy_version_id,recognition_unit_key,amount,currency,business_date,accounting_period_id,fact_kind,original_fact_id,prior_fact_id,correction_intent_key,prior_period_flag,original_business_date,posted_by,approval_reference,posting_reference,source_basis_digest)
 values(c.workspace_id,entity,c.id,c.contract_id,c.contract_version_id,c.specified_service_id,c.stable_service_key,c.binding_id,c.policy_version_id,c.recognition_unit_key,c.amount,c.currency,c.business_date,c.accounting_period_id,c.candidate_kind,c.original_fact_id,c.prior_fact_id,c.correction_intent_key,coalesce((c.revised_entitlement_snapshot->>'prior_period')::boolean,false),coalesce((c.revised_entitlement_snapshot->>'original_business_date')::date,c.business_date),actor,c.approval_reference,posting_reference,c.basis_digest) returning * into f;
 perform public.revenue_audit('REVENUE_FACT_POSTED',f.id,jsonb_build_object('candidate',c.id,'contract',c.contract_id,'contract_version',c.contract_version_id,'service',c.stable_service_key,'unit',c.recognition_unit_key,'amount',c.amount::text,'currency',c.currency,'business_date',c.business_date,'period',c.accounting_period_id,'policy',c.policy_version_id,'binding',c.binding_id,'basis_digest',c.basis_digest,'poster',actor,'posting_reference',posting_reference,'root',f.original_fact_id));
 return public.commission_finish(request_key,'REVENUE_POST',payload,to_jsonb(f)||jsonb_build_object('amount',f.amount::text));end $$;

-- Direct inserts cannot commit without the atomic canonical posting receipt/audit.
create function public.revenue_fact_receipt_guard() returns trigger language plpgsql security definer set search_path=public as $$begin
 if not exists(select 1 from public.mutation_receipts where workspace_id=new.workspace_id and operation='REVENUE_POST' and created_by=new.posted_by and result->'item'->>'id'=new.id::text) or not exists(select 1 from public.audit_events where workspace_id=new.workspace_id and action='REVENUE_FACT_POSTED' and entity_id=new.id::text) then raise exception 'revenue_posting_receipt_required';end if;return null;end $$;
create constraint trigger revenue_fact_atomic_receipt after insert on public.recognized_revenue_facts deferrable initially deferred for each row execute function public.revenue_fact_receipt_guard();

create function public.revenue_recognized_lineage(entity uuid,contract uuid,service_key text,unit_key text) returns jsonb language plpgsql security definer set search_path=public,app_auth as $$begin
 if not (public.revenue_has_authority(entity,'RECOGNITION_PREPARER') or public.revenue_has_authority(entity,'RECOGNITION_REVIEWER') or public.revenue_has_authority(entity,'POSTING_AUTHORITY')) then raise exception 'revenue_authority_required';end if;
 return public.revenue_unit_consumption(entity,contract,service_key,unit_key);end $$;
alter table public.recognized_revenue_facts enable row level security;
revoke all on public.recognized_revenue_facts from public,crm_app,crm_system,crm_worker;
grant select on public.recognized_revenue_facts to crm_app;
create policy revenue_fact_read on public.recognized_revenue_facts for select to crm_app using(workspace_id=public.revenue_workspace_id() and (public.revenue_has_authority(reporting_entity_id,'RECOGNITION_PREPARER') or public.revenue_has_authority(reporting_entity_id,'RECOGNITION_REVIEWER') or public.revenue_has_authority(reporting_entity_id,'POSTING_AUTHORITY')));
revoke all on function public.revenue_set_correction_rule(uuid,uuid,integer,jsonb,text),public.revenue_fact_immutable(),public.revenue_unit_consumption(uuid,uuid,text,text),public.revenue_correction_basis(uuid,uuid,uuid,text,text,text,uuid),public.revenue_evaluate_correction(uuid,jsonb,text),public.revenue_post_candidate(uuid,uuid,integer,text,text),public.revenue_fact_receipt_guard(),public.revenue_recognized_lineage(uuid,uuid,text,text) from public,crm_app,crm_system,crm_worker;
grant execute on function public.revenue_set_correction_rule(uuid,uuid,integer,jsonb,text),public.revenue_evaluate_correction(uuid,jsonb,text),public.revenue_post_candidate(uuid,uuid,integer,text,text),public.revenue_recognized_lineage(uuid,uuid,text,text) to crm_app;

-- Original evaluation never consumes or invalidates a separate correction review.
create or replace function public.revenue_candidate_command(entity uuid,command text,target uuid,expected_revision integer,data jsonb,request_key text) returns jsonb
language plpgsql security definer set search_path=public,app_auth,extensions as $$
declare ws uuid:=public.revenue_workspace_id();actor uuid:=app_auth.current_user_id();kind text;c public.revenue_recognition_candidates;old public.revenue_recognition_candidates;
 basis jsonb;result jsonb;approval public.approval_requests;payload jsonb:=jsonb_build_object('entity',entity,'command',command,'target',target,'revision',expected_revision,'data',data);begin
 kind:=case when command in ('APPROVE','REJECT') then 'RECOGNITION_REVIEWER' else 'RECOGNITION_PREPARER' end;
 perform public.revenue_require(entity,kind);
 if not public.revenue_has_authority(entity,kind) then raise exception 'revenue_authority_required';end if;
 result:=public.commission_receipt(request_key,'REVENUE_CANDIDATE_'||command,payload);if result is not null then return result;end if;
 if jsonb_typeof(data) is distinct from 'object' then raise exception 'revenue_input_invalid';end if;
 if command='EVALUATE' then
  if target is not null or expected_revision is not null or exists(select 1 from jsonb_object_keys(data) k where k not in ('specified_service_id','binding_id','recognition_unit_key')) then raise exception 'revenue_input_invalid';end if;
  basis:=public.revenue_candidate_basis(entity,(data->>'specified_service_id')::uuid,(data->>'binding_id')::uuid,data->>'recognition_unit_key');
  select * into c from public.revenue_recognition_candidates where workspace_id=ws and reporting_entity_id=entity and contract_id=(basis->>'contract')::uuid and stable_service_key=basis->>'stable_service_key' and recognition_unit_key=basis->>'unit' and basis_digest=basis->>'digest';
  if not found then
   for old in select * from public.revenue_recognition_candidates where workspace_id=ws and reporting_entity_id=entity and contract_id=(basis->>'contract')::uuid and stable_service_key=basis->>'stable_service_key' and recognition_unit_key=basis->>'unit' and candidate_kind='ORIGINAL' and status in ('DRAFT','READY_FOR_REVIEW','APPROVED') for update loop
    if public.revenue_candidate_current(old.id) then raise exception 'revenue_unit_occupied';end if;
    update public.revenue_recognition_candidates set status='STALE',revision=revision+1,state_reference='BASIS_REPLACED' where id=old.id;
    perform public.revenue_audit('REVENUE_CANDIDATE_STALE',old.id,jsonb_build_object('basis_digest',old.basis_digest));
   end loop;
   insert into public.revenue_recognition_candidates(workspace_id,reporting_entity_id,contract_id,contract_version_id,specified_service_id,stable_service_key,binding_id,binding_version,policy_version_id,recognition_unit_key,business_date,accounting_period_id,evidence_references,source_fact_references,amount_basis_snapshot,amount,currency,basis_digest,evaluation_version,created_by)
   values(ws,entity,(basis->>'contract')::uuid,(basis->>'contract_version')::uuid,(basis->>'service')::uuid,basis->>'stable_service_key',(basis->>'binding')::uuid,(basis->>'binding_version')::integer,(basis->>'policy')::uuid,basis->>'unit',(basis->>'business_date')::date,(basis->>'period')::uuid,basis->'evidence',basis->'sources',basis->'amount_basis',(basis->>'amount')::numeric,basis->>'currency',basis->>'digest',basis->>'evaluation_version',actor) returning * into c;
   perform public.revenue_audit('REVENUE_CANDIDATE_CREATED',c.id,jsonb_build_object('basis_digest',c.basis_digest));
  end if;
 else
  if exists(select 1 from jsonb_object_keys(data) k where k<>'reference') then raise exception 'revenue_input_invalid';end if;
  select * into c from public.revenue_recognition_candidates where workspace_id=ws and reporting_entity_id=entity and id=target for update;
  if not found or c.revision is distinct from expected_revision then raise exception 'revenue_version_conflict';end if;
  if command in ('APPROVE','REJECT') and (c.created_by=actor or c.status<>'READY_FOR_REVIEW') then raise exception 'revenue_review_invalid';end if;
  if command='SUBMIT' and (c.created_by<>actor or c.status<>'DRAFT') then raise exception 'revenue_review_invalid';end if;
  if command not in ('SUBMIT','APPROVE','REJECT','REVALIDATE') then raise exception 'revenue_command_invalid';end if;
  if command<>'REJECT' and c.status in ('DRAFT','READY_FOR_REVIEW','APPROVED') and not public.revenue_candidate_current(c.id) then
   update public.revenue_recognition_candidates set status='STALE',revision=revision+1,state_reference='BASIS_INVALIDATED' where id=c.id returning * into c;
   perform public.revenue_audit('REVENUE_CANDIDATE_STALE',c.id,jsonb_build_object('basis_digest',c.basis_digest));
  elsif command='SUBMIT' then
   insert into public.approval_requests(workspace_id,request_number,request_type,business_object_type,business_object_id,requester_id,reason,expires_at,request_payload)
   values(ws,'REV-'||gen_random_uuid(),'REVENUE_RECOGNITION_CANDIDATE','REVENUE_RECOGNITION_CANDIDATE',c.id::text,actor,'Recognition candidate review',now()+interval '7 days',jsonb_build_object('entity',entity,'revision',c.revision+1,'digest',c.basis_digest)) returning * into approval;
   update public.revenue_recognition_candidates set status='READY_FOR_REVIEW',revision=revision+1,approval_reference=approval.id where id=c.id returning * into c;
   insert into public.approval_actions(approval_request_id,actor_id,action) values(approval.id,actor,'SUBMITTED');
   perform public.revenue_audit('REVENUE_CANDIDATE_SUBMITTED',c.id,jsonb_build_object('basis_digest',c.basis_digest,'approval',approval.id));
  elsif command in ('APPROVE','REJECT') then
   perform public.decide_approval(c.approval_reference,case when command='APPROVE' then 'APPROVED' else 'REJECTED' end,data->>'reference');
   select * into c from public.revenue_recognition_candidates where id=c.id;
  end if;
 end if;
 result:=to_jsonb(c)||jsonb_build_object('amount',c.amount::text);
 return public.commission_finish(request_key,'REVENUE_CANDIDATE_'||command,payload,result);
end $$;

