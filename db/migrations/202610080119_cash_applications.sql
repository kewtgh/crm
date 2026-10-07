-- R5E: existing Payment owns cash; application owns only its governed use.
set search_path=public,app_auth,extensions;
alter table public.payments add column purpose text not null default 'TRADE_RECEIPT' check(purpose in ('TRADE_RECEIPT','CUSTODY_RECEIPT'));
alter table public.payments add column reporting_entity_id uuid;
alter table public.payments alter column contract_id drop not null;
alter table public.payments add constraint payment_cash_purpose check(
 (purpose='TRADE_RECEIPT' and contract_id is not null and reporting_entity_id is null) or
 (purpose='CUSTODY_RECEIPT' and contract_id is null and product_id is null and receivable_schedule_id is null and reporting_entity_id is not null));
alter table public.payments add constraint payment_cash_entity foreign key(workspace_id,reporting_entity_id) references public.revenue_reporting_profiles(workspace_id,reporting_entity_id);
alter table public.payments add constraint payment_cash_source_scope unique(workspace_id,reporting_entity_id,id);
alter table public.receivable_schedules add constraint receivable_cash_target_scope unique(workspace_id,contract_id,id);
alter table public.revenue_authority_assignments drop constraint revenue_authority_assignments_authority_check;
alter table public.revenue_authority_assignments add constraint revenue_authority_assignments_authority_check check(authority in ('POLICY_OWNER','POLICY_APPROVER','POSTING_AUTHORITY','EVIDENCE_VERIFIER','RECOGNITION_PREPARER','RECOGNITION_REVIEWER','CASH_APPLICATION_MANAGER'));

create table public.cash_applications(
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null,reporting_entity_id uuid not null,
 entry_kind text not null check(entry_kind in ('DECLARE_CUSTODY','APPLY','REVERSE')),
 source_payment_id uuid not null,declaration_id uuid,reverses_application_id uuid,
 custody_role text not null check(custody_role in ('COLLECTION_CUSTODIAN','CONDITIONAL_SETTLEMENT_HOLDER','COLLECTION_FOR_BENEFICIARY')),
 beneficiary_kind text not null check(beneficiary_kind in ('REPORTING_ENTITY','CONTRACT_BUYER')),
 beneficiary_organization_id uuid,beneficiary_household_id uuid,
 terms_service_id uuid not null,terms_contract_id uuid not null,terms_contract_version_id uuid not null,
 permitted_service_ids uuid[] not null check(cardinality(permitted_service_ids) between 1 and 100),
 target_contract_id uuid,target_specified_service_id uuid,target_receivable_id uuid,
 amount numeric(14,2) not null check(amount>0),currency text not null check(currency~'^[A-Z]{3}$'),
 application_intent_key text not null check(length(application_intent_key) between 8 and 120),
 business_reference text not null check(length(trim(business_reference))>0),
 approval_reference uuid,request_key text not null,source_basis_digest text not null check(source_basis_digest~'^[0-9a-f]{64}$'),
 basis_references jsonb not null,applied_by uuid not null references app_auth.accounts(id),applied_at timestamptz not null default clock_timestamp(),created_at timestamptz not null default clock_timestamp(),
 unique(workspace_id,reporting_entity_id,id),unique(workspace_id,reporting_entity_id,source_payment_id,id),
 unique(workspace_id,reporting_entity_id,source_payment_id,application_intent_key),
 foreign key(workspace_id,reporting_entity_id,source_payment_id) references public.payments(workspace_id,reporting_entity_id,id),
 foreign key(workspace_id,reporting_entity_id,source_payment_id,declaration_id) references public.cash_applications(workspace_id,reporting_entity_id,source_payment_id,id),
 foreign key(workspace_id,reporting_entity_id,source_payment_id,reverses_application_id) references public.cash_applications(workspace_id,reporting_entity_id,source_payment_id,id),
 foreign key(workspace_id,reporting_entity_id,terms_service_id) references public.contract_specified_services(workspace_id,reporting_entity_id,id),
 foreign key(workspace_id,terms_contract_id,terms_contract_version_id) references public.contract_versions(workspace_id,contract_id,id),
 foreign key(workspace_id,reporting_entity_id,target_specified_service_id) references public.contract_specified_services(workspace_id,reporting_entity_id,id),
 foreign key(workspace_id,target_contract_id,target_receivable_id) references public.receivable_schedules(workspace_id,contract_id,id),
 foreign key(workspace_id,approval_reference) references public.approval_requests(workspace_id,id),
 check((beneficiary_kind='REPORTING_ENTITY' and beneficiary_organization_id is null and beneficiary_household_id is null) or (beneficiary_kind='CONTRACT_BUYER' and num_nonnulls(beneficiary_organization_id,beneficiary_household_id)=1)),
 check((entry_kind='DECLARE_CUSTODY' and declaration_id is null and reverses_application_id is null and target_contract_id is null and target_specified_service_id is null and target_receivable_id is null) or
 (entry_kind in ('APPLY','REVERSE') and declaration_id is not null and target_contract_id is not null and target_specified_service_id is not null and target_receivable_id is not null and (entry_kind='REVERSE')=(reverses_application_id is not null)))
);
create unique index cash_one_declaration on public.cash_applications(source_payment_id) where entry_kind='DECLARE_CUSTODY';
create index cash_target_entries on public.cash_applications(target_receivable_id);

create function public.cash_finance_lock() returns void language sql volatile security definer set search_path=public as $$
 select pg_advisory_xact_lock(hashtextextended('cash-finance:'||public.current_workspace_id()::text,0)) $$;
create function public.cash_require(entity uuid) returns void language plpgsql security definer set search_path=public,app_auth as $$begin
 perform public.revenue_require(entity,'CASH_APPLICATION_MANAGER');
 if not public.revenue_has_authority(entity,'CASH_APPLICATION_MANAGER') then raise exception 'cash_authority_required';end if;
 perform 1 from public.revenue_reporting_profiles where workspace_id=public.revenue_workspace_id() and reporting_entity_id=entity and status='ACTIVE' for share;
 if not found then raise exception 'cash_profile_inactive';end if;
 perform public.cash_finance_lock();end $$;
create function public.cash_contract_access(target uuid,writing boolean default false) returns boolean language sql stable security definer set search_path=public,app_auth as $$
 select exists(select 1 from public.contracts c where c.id=target and c.workspace_id=public.current_workspace_id() and c.archived_at is null and c.status<>'CANCELLED' and public.can_access_owned_record(c.workspace_id,'CONTRACT',c.id,c.owner_id,writing)) $$;
create function public.cash_net_applied(source uuid) returns numeric language sql stable security definer set search_path=public as $$
 select coalesce(sum(case entry_kind when 'APPLY' then amount when 'REVERSE' then -amount else 0 end),0) from public.cash_applications where workspace_id=public.current_workspace_id() and source_payment_id=source $$;
create function public.cash_source_basis(source uuid) returns jsonb language plpgsql security definer set search_path=public,app_auth as $$
declare p public.payments;reserved numeric;used numeric;refs jsonb;begin
 select * into p from public.payments where workspace_id=public.current_workspace_id() and id=source for update;
 if not found or p.purpose<>'CUSTODY_RECEIPT' or p.status not in ('CONFIRMED','REFUNDED') then raise exception 'cash_source_invalid';end if;
 select coalesce(sum(amount) filter(where status in ('PENDING_APPROVAL','APPROVED')),0),coalesce(jsonb_agg(jsonb_build_object('id',id,'status',status,'amount',amount::text) order by id),'[]') into reserved,refs from public.refunds where workspace_id=p.workspace_id and payment_id=p.id and status in ('PENDING_APPROVAL','APPROVED','PAID');
 used:=public.cash_net_applied(p.id);
 return jsonb_build_object('payment',p.id,'entity',p.reporting_entity_id,'status',p.status,'amount',p.amount::text,'currency',p.currency,'refunded',p.refunded_amount::text,'reserved',reserved::numeric(14,2)::text,'applied',used::numeric(14,2)::text,'available',(p.amount-p.refunded_amount-reserved-used)::numeric(14,2)::text,'refunds',refs);end $$;
create function public.cash_immutable() returns trigger language plpgsql set search_path=public as $$begin raise exception 'cash_application_immutable';end $$;
create trigger cash_entry_immutable before update or delete on public.cash_applications for each row execute function public.cash_immutable();
create function public.cash_payment_guard() returns trigger language plpgsql set search_path=public as $$begin
 if tg_op='DELETE' then if old.purpose='CUSTODY_RECEIPT' then raise exception 'cash_payment_retention';end if;return old;end if;
 if new.purpose is distinct from old.purpose or new.reporting_entity_id is distinct from old.reporting_entity_id then raise exception 'cash_purpose_immutable';end if;
 if old.purpose='CUSTODY_RECEIPT' then
  if (to_jsonb(new)-array['status','refunded_amount','settlement_status']) is distinct from (to_jsonb(old)-array['status','refunded_amount','settlement_status']) then raise exception 'cash_payment_immutable';end if;
  if new.refunded_amount<>(select coalesce(sum(amount),0) from public.refunds where payment_id=old.id and status='PAID') or new.status not in ('CONFIRMED','REFUNDED') or (new.status='REFUNDED')<>(new.refunded_amount=new.amount) then raise exception 'cash_refund_balance_invalid';end if;
 end if;return new;end $$;
create trigger cash_payment_retention before update or delete on public.payments for each row execute function public.cash_payment_guard();

-- Receivable remains the only paid-state owner. Application history contributes once.
create or replace function public.refresh_receivable(target_schedule uuid) returns void language plpgsql security definer set search_path=public,app_auth,extensions as $$
declare s public.receivable_schedules;net numeric;applied numeric;begin
 select * into s from public.receivable_schedules where id=target_schedule for update;if not found then return;end if;
 select coalesce(sum(amount-refunded_amount),0) into net from public.payments where receivable_schedule_id=s.id and purpose='TRADE_RECEIPT' and status in ('CONFIRMED','REFUNDED');
 select coalesce(sum(case entry_kind when 'APPLY' then amount when 'REVERSE' then -amount else 0 end),0) into applied from public.cash_applications where workspace_id=s.workspace_id and target_receivable_id=s.id;
 net:=net+applied;if net>s.amount or net<0 then raise exception 'cash_target_ceiling';end if;
 update public.receivable_schedules set paid_amount=net,status=case when net>=amount then 'PAID' when net>0 then 'PARTIALLY_PAID' when due_date<current_date then 'OVERDUE' else 'SCHEDULED' end,updated_at=now() where id=s.id;end $$;

create function public.cash_application_command(entity uuid,command text,source uuid,data jsonb,request_key text) returns jsonb
language plpgsql security definer set search_path=public,app_auth,extensions as $$
declare d public.cash_applications;a public.cash_applications;r public.cash_applications;p public.payments;s public.contract_specified_services;cv public.contract_versions;c public.contracts;t public.receivable_schedules;
 amount_value numeric(14,2);reversed numeric;basis jsonb;result jsonb;services uuid[];payload jsonb:=jsonb_build_object('entity',entity,'command',command,'source',source,'data',data);begin
 perform public.cash_require(entity);result:=public.commission_receipt(request_key,'CASH_'||command,payload);if result is not null then return result;end if;
 if jsonb_typeof(data) is distinct from 'object' or length(coalesce(data->>'intent','')) not between 8 and 120 or nullif(trim(data->>'reference'),'') is null then raise exception 'cash_input_invalid';end if;
 select * into p from public.payments where workspace_id=public.revenue_workspace_id() and reporting_entity_id=entity and id=source and purpose='CUSTODY_RECEIPT' for update;
 if not found then raise exception 'cash_source_invalid';end if;
 select * into r from public.cash_applications where workspace_id=p.workspace_id and reporting_entity_id=entity and source_payment_id=source and application_intent_key=data->>'intent';
 if found then if r.entry_kind<>command or r.basis_references->'request' is distinct from data then raise exception 'cash_intent_conflict';end if;return public.commission_finish(request_key,'CASH_'||command,payload,to_jsonb(r)||jsonb_build_object('amount',r.amount::text));end if;
 if command='DECLARE_CUSTODY' then
  if exists(select 1 from jsonb_object_keys(data) k where k not in ('intent','reference','terms_service_id','custody_role','beneficiary_kind','permitted_service_ids')) then raise exception 'cash_input_invalid';end if;
  select * into s from public.contract_specified_services where workspace_id=p.workspace_id and reporting_entity_id=entity and id=(data->>'terms_service_id')::uuid for share;
  if not found or s.currency<>p.currency or not public.cash_contract_access(s.contract_id,true) then raise exception 'cash_terms_invalid';end if;
  select * into cv from public.contract_versions where id=s.contract_version_id and commercial_accepted_at is not null for share;if not found then raise exception 'cash_terms_invalid';end if;
  select * into c from public.contracts where id=s.contract_id for share;
  if jsonb_typeof(data->'permitted_service_ids') is distinct from 'array' then raise exception 'cash_targets_invalid';end if;
  select array_agg(distinct v::uuid order by v::uuid) into services from jsonb_array_elements_text(data->'permitted_service_ids') v;
  if cardinality(services) not between 1 and 100 or services is null or exists(select 1 from unnest(services) permitted(target_id) where not exists(select 1 from public.contract_specified_services x where x.id=permitted.target_id and x.workspace_id=p.workspace_id and x.reporting_entity_id=entity and x.currency=p.currency and public.cash_contract_access(x.contract_id,true))) then raise exception 'cash_targets_invalid';end if;
  basis:=jsonb_build_object('request',data,'payment',source,'amount',p.amount::text,'currency',p.currency,'terms_version',cv.id,'terms_price_digest',s.accepted_price_snapshot_digest,'payer_organization',c.organization_id,'payer_household',c.household_id,'permitted_services',services);
  insert into public.cash_applications(workspace_id,reporting_entity_id,entry_kind,source_payment_id,custody_role,beneficiary_kind,beneficiary_organization_id,beneficiary_household_id,terms_service_id,terms_contract_id,terms_contract_version_id,permitted_service_ids,amount,currency,application_intent_key,business_reference,request_key,source_basis_digest,basis_references,applied_by)
  values(p.workspace_id,entity,command,source,data->>'custody_role',data->>'beneficiary_kind',case when data->>'beneficiary_kind'='CONTRACT_BUYER' then c.organization_id end,case when data->>'beneficiary_kind'='CONTRACT_BUYER' then c.household_id end,s.id,c.id,cv.id,services,p.amount,p.currency,data->>'intent',data->>'reference',request_key,public.revenue_digest(basis),basis,app_auth.current_user_id()) returning * into r;
 elsif command in ('APPLY','REVERSE') then
  if exists(select 1 from jsonb_object_keys(data) k where k not in ('intent','reference','amount','service_id','receivable_id','application_id')) then raise exception 'cash_input_invalid';end if;
  amount_value:=public.revenue_decimal(data->'amount');if amount_value<=0 or amount_value is null then raise exception 'cash_amount_invalid';end if;
  select * into d from public.cash_applications where source_payment_id=source and entry_kind='DECLARE_CUSTODY';
  if not found or not public.cash_contract_access(d.terms_contract_id,true) then raise exception 'cash_declaration_required';end if;
  if command='REVERSE' then
   if data ? 'service_id' or data ? 'receivable_id' then raise exception 'cash_input_invalid';end if;
   select * into a from public.cash_applications where workspace_id=p.workspace_id and reporting_entity_id=entity and source_payment_id=source and id=(data->>'application_id')::uuid and entry_kind='APPLY' for update;
   if not found then raise exception 'cash_application_required';end if;
   select coalesce(sum(amount),0) into reversed from public.cash_applications where reverses_application_id=a.id;
   if amount_value>a.amount-reversed then raise exception 'cash_reversal_ceiling';end if;
  elsif data ? 'application_id' then raise exception 'cash_input_invalid';end if;
  select * into s from public.contract_specified_services where workspace_id=p.workspace_id and reporting_entity_id=entity and id=case when command='APPLY' then (data->>'service_id')::uuid else a.target_specified_service_id end for share;
  if not found or not (s.id=any(d.permitted_service_ids)) or not public.cash_contract_access(s.contract_id,true) then raise exception 'cash_target_invalid';end if;
  if s.currency<>p.currency then raise exception 'cash_currency_mismatch';end if;
  select * into c from public.contracts where id=s.contract_id for share;
  if c.currency<>p.currency then raise exception 'cash_currency_mismatch';end if;
  select * into t from public.receivable_schedules where workspace_id=p.workspace_id and contract_id=s.contract_id and id=case when command='APPLY' then (data->>'receivable_id')::uuid else a.target_receivable_id end for update;
  if not found or t.status='CANCELLED' then raise exception 'cash_target_invalid';end if;
  perform public.refresh_receivable(t.id);select * into t from public.receivable_schedules where id=t.id;
  basis:=public.cash_source_basis(source);
  if command='APPLY' and amount_value>(basis->>'available')::numeric then raise exception 'cash_source_ceiling';end if;
  if command='APPLY' and amount_value>t.amount-t.paid_amount then raise exception 'cash_target_ceiling';end if;
  basis:=jsonb_build_object('request',data,'source',basis,'declaration',d.id,'declaration_digest',d.source_basis_digest,'target',t.id,'contract',c.id,'service',s.id,'version',s.contract_version_id,'target_amount',t.amount::text,'target_paid',t.paid_amount::text,'target_updated_at',t.updated_at,'reverses',a.id);
  insert into public.cash_applications(workspace_id,reporting_entity_id,entry_kind,source_payment_id,declaration_id,reverses_application_id,custody_role,beneficiary_kind,beneficiary_organization_id,beneficiary_household_id,terms_service_id,terms_contract_id,terms_contract_version_id,permitted_service_ids,target_contract_id,target_specified_service_id,target_receivable_id,amount,currency,application_intent_key,business_reference,request_key,source_basis_digest,basis_references,applied_by)
  values(p.workspace_id,entity,command,source,d.id,case when command='REVERSE' then a.id end,d.custody_role,d.beneficiary_kind,d.beneficiary_organization_id,d.beneficiary_household_id,d.terms_service_id,d.terms_contract_id,d.terms_contract_version_id,d.permitted_service_ids,c.id,s.id,t.id,amount_value,p.currency,data->>'intent',data->>'reference',request_key,public.revenue_digest(basis),basis,app_auth.current_user_id()) returning * into r;
  perform public.refresh_receivable(t.id);
 else raise exception 'cash_command_invalid';end if;
 perform public.revenue_audit('CASH_'||command,r.id,jsonb_build_object('payment',source,'target',r.target_receivable_id,'amount',r.amount::text,'currency',r.currency,'digest',r.source_basis_digest));
 return public.commission_finish(request_key,'CASH_'||command,payload,to_jsonb(r)||jsonb_build_object('amount',r.amount::text));end $$;

-- Extend the canonical writer with optional custody inputs; six-argument trade calls retain their contract.
alter function public.record_payment(uuid,uuid,numeric,text,text,timestamptz) rename to record_payment_before_r5e;
revoke all on function public.record_payment_before_r5e(uuid,uuid,numeric,text,text,timestamptz) from public,crm_app,crm_system,crm_worker;
create function public.record_payment(target_contract uuid,target_schedule uuid,payment_amount numeric,payment_currency text,payment_reference text,paid_on timestamptz,custody jsonb default null,request_key text default null)
returns public.payments language plpgsql security definer set search_path=public,app_auth,extensions as $$
declare entity uuid;p public.payments;result jsonb;payload jsonb:=jsonb_build_object('contract',target_contract,'schedule',target_schedule,'amount',payment_amount::text,'currency',payment_currency,'reference',payment_reference,'paid_on',paid_on,'custody',custody);begin
 if custody is null then perform public.cash_finance_lock();return public.record_payment_before_r5e(target_contract,target_schedule,payment_amount,payment_currency,payment_reference,paid_on);end if;
 if jsonb_typeof(custody) is distinct from 'object' or exists(select 1 from jsonb_object_keys(custody) k where k not in ('entity','intent','reference','terms_service_id','custody_role','beneficiary_kind','permitted_service_ids')) then raise exception 'cash_input_invalid';end if;
 entity:=(custody->>'entity')::uuid;perform public.cash_require(entity);
 if target_contract is not null or target_schedule is not null or payment_amount<=0 or payment_amount<>round(payment_amount,2) or payment_amount is null or payment_currency !~ '^[A-Z]{3}$' or nullif(trim(payment_reference),'') is null or nullif(trim(request_key),'') is null then raise exception 'cash_receipt_invalid';end if;
 result:=public.commission_receipt(request_key,'CUSTODY_RECEIPT',payload);if result is not null then select * into p from public.payments where id=(result->>'id')::uuid;return p;end if;
 insert into public.payments(workspace_id,reporting_entity_id,purpose,amount,currency,status,paid_at,reference,verified_by) values(public.revenue_workspace_id(),entity,'CUSTODY_RECEIPT',payment_amount,payment_currency,'CONFIRMED',coalesce(paid_on,now()),payment_reference,app_auth.current_user_id()) returning * into p;
 perform public.cash_application_command(entity,'DECLARE_CUSTODY',p.id,custody-'entity',request_key||':declaration');
 perform public.revenue_audit('CUSTODY_RECEIPT',p.id,jsonb_build_object('amount',p.amount::text,'currency',p.currency));
 perform public.commission_finish(request_key,'CUSTODY_RECEIPT',payload,jsonb_build_object('id',p.id));return p;end $$;

create function public.cash_commit_guard() returns trigger language plpgsql security definer set search_path=public as $$begin
 if tg_table_name='payments' then
  if new.purpose='CUSTODY_RECEIPT' and not exists(select 1 from public.cash_applications where source_payment_id=new.id and entry_kind='DECLARE_CUSTODY') then raise exception 'cash_declaration_required';end if;
 else
  if not exists(select 1 from public.mutation_receipts where workspace_id=new.workspace_id and request_key=new.request_key and operation='CASH_'||new.entry_kind and result->'item'->>'id'=new.id::text) then raise exception 'cash_receipt_required';end if;
 end if;return null;end $$;
create constraint trigger custody_declaration_required after insert on public.payments deferrable initially deferred for each row execute function public.cash_commit_guard();
create constraint trigger cash_atomic_receipt after insert on public.cash_applications deferrable initially deferred for each row execute function public.cash_commit_guard();

-- Every custody refund reservation/decision, including direct legacy paths, shares the source ceiling.
create function public.cash_refund_guard() returns trigger language plpgsql security definer set search_path=public,app_auth as $$
declare p public.payments;reserved numeric;begin
 select * into p from public.payments where id=new.payment_id;
 if p.purpose<>'CUSTODY_RECEIPT' then return new;end if;
 perform public.cash_require(p.reporting_entity_id);
 select * into p from public.payments where id=new.payment_id for update;
 if new.workspace_id<>p.workspace_id or (tg_op='UPDATE' and (new.payment_id<>old.payment_id or new.amount<>old.amount)) then raise exception 'cash_refund_basis_immutable';end if;
 select coalesce(sum(amount),0) into reserved from public.refunds where payment_id=p.id and id<>new.id and status in ('PENDING_APPROVAL','APPROVED','PAID');
 if new.status in ('PENDING_APPROVAL','APPROVED','PAID') and reserved+new.amount+public.cash_net_applied(p.id)>p.amount then raise exception 'cash_refund_reserved_or_applied';end if;
 return new;end $$;
create trigger cash_refund_source_ceiling before insert or update on public.refunds for each row execute function public.cash_refund_guard();

create function public.cash_refund_approval_guard() returns trigger language plpgsql security definer set search_path=public,app_auth as $$
declare p public.payments;r public.refunds;begin
 if old.request_type<>'REFUND' then return new;end if;
 select * into r from public.refunds where id=old.business_object_id::uuid and workspace_id=old.workspace_id;
 select * into p from public.payments where id=r.payment_id and workspace_id=r.workspace_id;
 if p.purpose is distinct from 'CUSTODY_RECEIPT' then return new;end if;
 if (to_jsonb(new)-array['status','decision_reason','decided_by','decided_at','updated_at','execution_status','executed_at','execution_error']) is distinct from (to_jsonb(old)-array['status','decision_reason','decided_by','decided_at','updated_at','execution_status','executed_at','execution_error']) then raise exception 'cash_refund_approval_immutable';end if;
 if old.status=new.status then return new;end if;
 perform public.cash_require(p.reporting_entity_id);
 if old.status<>'PENDING' or new.status not in ('APPROVED','REJECTED','WITHDRAWN') or old.requester_id=app_auth.current_user_id() or new.decided_by is distinct from app_auth.current_user_id() or old.request_payload->>'amount' is distinct from r.amount::text then raise exception 'cash_refund_review_invalid';end if;
 return new;end $$;
create trigger cash_refund_review before update on public.approval_requests for each row execute function public.cash_refund_approval_guard();

-- Pending/approved refunds reserve cash. PAID refunds are already in Payment.refunded_amount.
alter function public.request_refund(uuid,numeric,text) rename to request_refund_before_r5e;
revoke all on function public.request_refund_before_r5e(uuid,numeric,text) from public,crm_app,crm_system,crm_worker;
create function public.request_refund(target_payment uuid,refund_amount numeric,refund_reason text,request_key text default null) returns public.refunds language plpgsql security definer set search_path=public,app_auth,extensions as $$
declare p public.payments;d public.cash_applications;r public.refunds;a public.approval_requests;b jsonb;result jsonb;payload jsonb:=jsonb_build_object('payment',target_payment,'amount',refund_amount::text,'reason',refund_reason);begin
 select * into p from public.payments where workspace_id=public.current_workspace_id() and id=target_payment;
 if p.purpose is distinct from 'CUSTODY_RECEIPT' then perform public.cash_finance_lock();return public.request_refund_before_r5e(target_payment,refund_amount,refund_reason);end if;
 perform public.cash_require(p.reporting_entity_id);
 if nullif(trim(request_key),'') is null then raise exception 'cash_request_key_required';end if;
 result:=public.commission_receipt(request_key,'CUSTODY_REFUND_REQUEST',payload);if result is not null then select * into r from public.refunds where id=(result->>'id')::uuid;return r;end if;
 b:=public.cash_source_basis(p.id);
 select * into d from public.cash_applications where source_payment_id=p.id and entry_kind='DECLARE_CUSTODY';
 if not public.cash_contract_access(d.terms_contract_id,true) or refund_amount is null or refund_amount<=0 or refund_amount<>round(refund_amount,2) or nullif(trim(refund_reason),'') is null then raise exception 'cash_refund_invalid';end if;
 if refund_amount>(b->>'available')::numeric then raise exception 'cash_refund_reserved_or_applied';end if;
 insert into public.refunds(workspace_id,refund_number,payment_id,amount,reason,requested_by) values(p.workspace_id,'RF-'||gen_random_uuid(),p.id,refund_amount,refund_reason,app_auth.current_user_id()) returning * into r;
 insert into public.approval_requests(workspace_id,request_number,request_type,business_object_type,business_object_id,requester_id,reason,expires_at,request_payload) values(p.workspace_id,'CASH-'||gen_random_uuid(),'REFUND','REFUND',r.id::text,app_auth.current_user_id(),refund_reason,now()+interval '7 days',jsonb_build_object('cash_entity',p.reporting_entity_id,'payment',p.id,'amount',r.amount::text)) returning * into a;
 insert into public.approval_actions(approval_request_id,actor_id,action) values(a.id,app_auth.current_user_id(),'SUBMITTED');
 update public.refunds set approval_request_id=a.id where id=r.id returning * into r;
 perform public.revenue_audit('CUSTODY_REFUND_REQUEST',r.id,jsonb_build_object('payment',p.id,'amount',r.amount::text,'approval',a.id));perform public.commission_finish(request_key,'CUSTODY_REFUND_REQUEST',payload,jsonb_build_object('id',r.id));return r;end $$;
alter function public.complete_refund(uuid,text) rename to complete_refund_before_r5e;
revoke all on function public.complete_refund_before_r5e(uuid,text) from public,crm_app,crm_system,crm_worker;
create function public.complete_refund(target_refund uuid,receipt text,request_key text default null) returns public.refunds language plpgsql security definer set search_path=public,app_auth,extensions as $$
declare p public.payments;r public.refunds;result jsonb;payload jsonb:=jsonb_build_object('refund',target_refund,'reference',receipt);begin
 select * into p from public.payments where workspace_id=public.current_workspace_id() and id=(select payment_id from public.refunds where id=target_refund and workspace_id=public.current_workspace_id());
 if p.purpose='CUSTODY_RECEIPT' then perform public.cash_require(p.reporting_entity_id);
  if nullif(trim(request_key),'') is null then raise exception 'cash_request_key_required';end if;
  result:=public.commission_receipt(request_key,'CUSTODY_REFUND_PAID',payload);if result is not null then select * into r from public.refunds where id=(result->>'id')::uuid;return r;end if;
 else perform public.cash_finance_lock();end if;
 r:=public.complete_refund_before_r5e(target_refund,receipt);
 if p.purpose='CUSTODY_RECEIPT' then perform public.revenue_audit('CUSTODY_REFUND_PAID',r.id,jsonb_build_object('payment',p.id,'amount',r.amount::text));perform public.commission_finish(request_key,'CUSTODY_REFUND_PAID',payload,jsonb_build_object('id',r.id));end if;return r;end $$;

-- Approval reserves no additional cash, but custody decisions still need business authority.
alter function public.decide_approval(uuid,text,text) rename to decide_approval_before_r5e;
revoke all on function public.decide_approval_before_r5e(uuid,text,text) from public,crm_app,crm_system,crm_worker;
create function public.decide_approval(request_id uuid,decision text,decision_comment text default null) returns public.approval_requests language plpgsql security definer set search_path=public,app_auth,extensions as $$
declare p public.payments;a public.approval_requests;begin
 select * into a from public.approval_requests where id=request_id and workspace_id=public.current_workspace_id();
 if a.request_type='REFUND' then
  select * into p from public.payments where id=(select payment_id from public.refunds where id=a.business_object_id::uuid) and workspace_id=a.workspace_id;
  if p.purpose='CUSTODY_RECEIPT' then perform public.cash_require(p.reporting_entity_id);if a.requester_id=app_auth.current_user_id() then raise exception 'cash_independent_refund_review';end if;end if;
 end if;return public.decide_approval_before_r5e(request_id,decision,decision_comment);end $$;

create function public.cash_source_status(entity uuid,source uuid) returns jsonb language plpgsql security definer set search_path=public,app_auth as $$
declare d public.cash_applications;b jsonb;begin
 if not public.revenue_has_authority(entity,'CASH_APPLICATION_MANAGER') then raise exception 'cash_authority_required';end if;
 select * into d from public.cash_applications where workspace_id=public.revenue_workspace_id() and reporting_entity_id=entity and source_payment_id=source and entry_kind='DECLARE_CUSTODY';
 if not found or not public.cash_contract_access(d.terms_contract_id) then raise exception 'cash_source_invalid';end if;
 b:=public.cash_source_basis(source);return b||jsonb_build_object('declaration',d.id,'history',(select jsonb_agg(jsonb_build_object('id',id,'kind',entry_kind,'target',target_receivable_id,'amount',amount::text,'currency',currency,'reverses',reverses_application_id,'digest',source_basis_digest) order by created_at,id) from public.cash_applications where source_payment_id=source));end $$;

-- Finance consumers see target settlement without obtaining custody source/customer details.
create function public.cash_contract_settled(target uuid) returns numeric language sql stable security definer set search_path=public,app_auth as $$
 select case when public.cash_contract_access(target) then coalesce((select sum(case entry_kind when 'APPLY' then amount when 'REVERSE' then -amount else 0 end) from public.cash_applications where workspace_id=public.current_workspace_id() and target_contract_id=target),0) else 0 end $$;
create function public.cash_target_status(entity uuid,service uuid,receivable uuid) returns jsonb language plpgsql security definer set search_path=public,app_auth as $$
declare s public.contract_specified_services;t public.receivable_schedules;net numeric;refs jsonb;begin
 if not public.revenue_has_authority(entity,'CASH_APPLICATION_MANAGER') then raise exception 'cash_authority_required';end if;
 select * into s from public.contract_specified_services where workspace_id=public.revenue_workspace_id() and reporting_entity_id=entity and id=service;
 if not found or not public.cash_contract_access(s.contract_id) then raise exception 'cash_target_invalid';end if;
 select * into t from public.receivable_schedules where workspace_id=s.workspace_id and contract_id=s.contract_id and id=receivable;if not found then raise exception 'cash_target_invalid';end if;
 select coalesce(sum(case entry_kind when 'APPLY' then amount when 'REVERSE' then -amount else 0 end),0),coalesce(jsonb_agg(jsonb_build_object('id',id,'kind',entry_kind,'amount',amount::text,'reverses',reverses_application_id) order by created_at,id),'[]') into net,refs from public.cash_applications where workspace_id=s.workspace_id and reporting_entity_id=entity and target_receivable_id=t.id;
 return jsonb_build_object('receivable',t.id,'service',s.id,'currency',s.currency,'amount',t.amount::text,'paid',t.paid_amount::text,'outstanding',(t.amount-t.paid_amount)::numeric(14,2)::text,'applied_cash',net::numeric(14,2)::text,'applications',refs);end $$;
create or replace view public.contract_finance_snapshot with(security_invoker=true) as
select c.workspace_id,c.id contract_id,c.contract_number,c.status contract_status,c.organization_id,c.household_id,c.product_id,c.currency,c.contract_value::text contracted,
 coalesce(r.receivable,0)::text receivable,(coalesce(p.collected,0)+public.cash_contract_settled(c.id))::text collected,
 coalesce(p.refunded,0)::text refunded,coalesce(r.outstanding,0)::text outstanding,coalesce(r.overdue,0)::text overdue,coalesce(r.schedule_count,0)>0 has_schedule,coalesce(p.gross_confirmed,0)::text gross_confirmed,
 public.cash_contract_settled(c.id)::text applied_cash
from public.contracts c left join lateral(select count(*) schedule_count,sum(amount) receivable,sum(amount-paid_amount) outstanding,sum(amount-paid_amount) filter(where due_date<public.current_business_date()::date) overdue from public.receivable_schedules where workspace_id=c.workspace_id and contract_id=c.id) r on true
left join lateral(select sum(amount-refunded_amount) collected,sum(refunded_amount) refunded,sum(amount) gross_confirmed from public.payments where workspace_id=c.workspace_id and contract_id=c.id and purpose='TRADE_RECEIPT' and status in ('CONFIRMED','REFUNDED')) p on true;

alter table public.cash_applications enable row level security;
revoke all on public.cash_applications from public,crm_app,crm_system,crm_worker;
grant select on public.cash_applications to crm_app;
create policy cash_scoped_read on public.cash_applications for select to crm_app using(workspace_id=public.revenue_workspace_id() and public.revenue_has_authority(reporting_entity_id,'CASH_APPLICATION_MANAGER') and public.cash_contract_access(terms_contract_id) and (target_contract_id is null or public.cash_contract_access(target_contract_id)));
-- Custody is visible through the scoped cash read, not an unclassified legacy Payment list.
create policy cash_payment_read_boundary on public.payments as restrictive for select to crm_app using(purpose='TRADE_RECEIPT');
revoke all on function public.cash_finance_lock(),public.cash_require(uuid),public.cash_contract_access(uuid,boolean),public.cash_net_applied(uuid),public.cash_source_basis(uuid),public.cash_immutable(),public.cash_payment_guard(),public.cash_commit_guard(),public.cash_application_command(uuid,text,uuid,jsonb,text),public.cash_source_status(uuid,uuid),public.cash_contract_settled(uuid) from public,crm_app,crm_system,crm_worker;
revoke all on function public.cash_refund_guard(),public.cash_refund_approval_guard() from public,crm_app,crm_system,crm_worker;
grant execute on function public.cash_contract_access(uuid,boolean),public.cash_contract_settled(uuid),public.cash_application_command(uuid,text,uuid,jsonb,text),public.cash_source_status(uuid,uuid) to crm_app;
revoke all on function public.cash_target_status(uuid,uuid,uuid) from public,crm_system,crm_worker;
grant execute on function public.cash_target_status(uuid,uuid,uuid) to crm_app;
revoke all on function public.record_payment(uuid,uuid,numeric,text,text,timestamptz,jsonb,text),public.request_refund(uuid,numeric,text,text),public.complete_refund(uuid,text,text),public.decide_approval(uuid,text,text) from public,crm_system,crm_worker;
grant execute on function public.record_payment(uuid,uuid,numeric,text,text,timestamptz,jsonb,text),public.request_refund(uuid,numeric,text,text),public.complete_refund(uuid,text,text),public.decide_approval(uuid,text,text) to crm_app;
