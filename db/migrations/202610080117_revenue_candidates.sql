-- R5C: immutable ORIGINAL candidate basis only. No posting, corrections or cash.
set search_path=public,app_auth,extensions;
alter table public.revenue_authority_assignments drop constraint revenue_authority_assignments_authority_check;
alter table public.revenue_authority_assignments add constraint revenue_authority_assignments_authority_check check(authority in ('POLICY_OWNER','POLICY_APPROVER','POSTING_AUTHORITY','EVIDENCE_VERIFIER','RECOGNITION_PREPARER','RECOGNITION_REVIEWER'));
alter table public.revenue_accounting_periods add constraint revenue_period_entity_scope unique(workspace_id,reporting_entity_id,id);
alter table public.contract_specified_services add constraint revenue_candidate_service_scope unique(workspace_id,reporting_entity_id,contract_id,contract_version_id,stable_service_key,id);
create table public.revenue_recognition_candidates (
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null,reporting_entity_id uuid not null,
 contract_id uuid not null,contract_version_id uuid not null,specified_service_id uuid not null,stable_service_key text not null,
 binding_id uuid not null,binding_version integer not null,policy_version_id uuid not null,
 recognition_unit_key text not null,business_date date not null,accounting_period_id uuid not null,
 evidence_references jsonb not null,source_fact_references jsonb not null,amount_basis_snapshot jsonb not null,
 amount numeric(14,2) not null check(amount>=0),currency text not null check(currency~'^[A-Z]{3}$'),
 basis_digest text not null check(basis_digest~'^[0-9a-f]{64}$'),evaluation_version text not null check(evaluation_version='R5C_EVALUATOR_V1'),
 status text not null default 'DRAFT' check(status in ('DRAFT','BLOCKED','READY_FOR_REVIEW','APPROVED','REJECTED','STALE')),
 revision integer not null default 1,approval_reference uuid,created_by uuid not null references app_auth.accounts(id),created_at timestamptz not null default clock_timestamp(),
 reviewed_by uuid references app_auth.accounts(id),reviewed_at timestamptz,state_reference text,
 unique(workspace_id,id),unique(workspace_id,reporting_entity_id,id),
 unique(workspace_id,reporting_entity_id,contract_id,stable_service_key,recognition_unit_key,basis_digest),
 foreign key(workspace_id,reporting_entity_id,contract_id,contract_version_id,stable_service_key,specified_service_id) references public.contract_specified_services(workspace_id,reporting_entity_id,contract_id,contract_version_id,stable_service_key,id),
 foreign key(workspace_id,reporting_entity_id,specified_service_id,binding_id) references public.revenue_service_bindings(workspace_id,reporting_entity_id,specified_service_id,id),
 foreign key(workspace_id,reporting_entity_id,policy_version_id) references public.revenue_policy_versions(workspace_id,reporting_entity_id,id),
 foreign key(workspace_id,reporting_entity_id,accounting_period_id) references public.revenue_accounting_periods(workspace_id,reporting_entity_id,id),
 foreign key(workspace_id,approval_reference) references public.approval_requests(workspace_id,id),
 check(jsonb_typeof(evidence_references)='array' and jsonb_array_length(evidence_references)>0),
 check(status not in ('APPROVED','REJECTED') or (approval_reference is not null and reviewed_by is not null and reviewed_by<>created_by and reviewed_at is not null))
);
create unique index revenue_candidate_live_unit on public.revenue_recognition_candidates(workspace_id,reporting_entity_id,contract_id,stable_service_key,recognition_unit_key) where status in ('DRAFT','READY_FOR_REVIEW','APPROVED');

-- Integer minor units, exact numeric weights, deterministic schedule order.
create function public.revenue_allocate_units(total numeric,schedule jsonb) returns jsonb
language plpgsql immutable set search_path=public as $$
declare result jsonb;begin
 if total<0 or total<>round(total,2) or jsonb_typeof(schedule) is distinct from 'array' or jsonb_array_length(schedule)=0 then raise exception 'revenue_allocation_invalid';end if;
 with weights as (select u->>'key' key,n,public.revenue_decimal(u->'units',true) weight from jsonb_array_elements(schedule) with ordinality x(u,n)),
 shares as (select *,total*100*weight*1000000 numerator,sum(weight*1000000) over() denominator from weights),
 floors as (select *,div(numerator,denominator) base,mod(numerator,denominator) fractional_numerator from shares),
 ranked as (select *,row_number() over(order by fractional_numerator desc,n,key collate "C") priority,total*100-sum(base) over() remainder from floors)
 select jsonb_agg(jsonb_build_object('key',key,'units',weight::text,'minor_units',(base+case when priority<=remainder then 1 else 0 end)::text) order by n) into result from ranked;
 return result;end $$;

-- Internal evaluator. Target references only; no caller amount/date/evidence input.
create function public.revenue_candidate_basis(entity uuid,service uuid,binding uuid,unit_key text) returns jsonb
language plpgsql security definer set search_path=public,app_auth,extensions as $$
declare ws uuid:=public.revenue_workspace_id();s public.contract_specified_services;b public.revenue_service_bindings;p public.revenue_policy_versions;
 profile public.revenue_reporting_profiles;cv public.contract_versions;period public.revenue_accounting_periods;a public.revenue_fulfillment_attestations;
 unit jsonb;allocations jsonb;allocation jsonb;resolved jsonb;evidence jsonb:='[]';sources jsonb;basis jsonb;
 total numeric;verified numeric:=0;denominator numeric;minor numeric;day date;begin
 perform set_config('TimeZone','UTC',true);
 select * into profile from public.revenue_reporting_profiles where workspace_id=ws and reporting_entity_id=entity for share;
 if not found or profile.status<>'ACTIVE' then raise exception 'revenue_profile_inactive';end if;
 select * into s from public.contract_specified_services where workspace_id=ws and reporting_entity_id=entity and id=service for share;
 if not found then raise exception 'revenue_service_not_found';end if;
 select * into b from public.revenue_service_bindings where workspace_id=ws and reporting_entity_id=entity and specified_service_id=s.id and id=binding for share;
 if not found or b.status<>'APPROVED' then raise exception 'revenue_binding_not_approved';end if;
 select * into p from public.revenue_policy_versions where workspace_id=ws and reporting_entity_id=entity and id=b.policy_version_id for share;
 -- Retirement prevents new bindings, not use of an already approved binding.
 if not found or p.test_only or p.status not in ('APPROVED','RETIRED') or p.approved_by is null then raise exception 'revenue_policy_not_applicable';end if;
 select * into cv from public.contract_versions where workspace_id=ws and contract_id=s.contract_id and id=s.contract_version_id for share;
 if not found or cv.commercial_accepted_at is null then raise exception 'revenue_contract_not_accepted';end if;
 if exists(select 1 from public.contract_specified_services x join public.revenue_service_bindings y on y.specified_service_id=x.id and y.status='APPROVED'
  where x.workspace_id=ws and x.reporting_entity_id=entity and x.contract_id=s.contract_id and x.stable_service_key=s.stable_service_key and x.created_at>s.created_at
  and exists(select 1 from jsonb_array_elements(y.recognition_unit_schedule) u where u->>'key'=unit_key)) then raise exception 'revenue_service_unit_superseded';end if;
 select value into unit from jsonb_array_elements(b.recognition_unit_schedule) where value->>'key'=unit_key;
 if unit is null or b.fulfillment_requirements->unit_key is null then raise exception 'revenue_unit_unknown';end if;
 if profile.precision_scale<>2 or s.currency<>all(profile.allowed_currencies) or s.currency not in ('USD','CNY','EUR','GBP','HKD','AUD','CAD','NZD','SGD','CHF') then raise exception 'revenue_currency_precision_unsupported';end if;
 if b.amount_basis_snapshot->>'currency' is distinct from s.currency or b.amount_basis_snapshot->>'strategy' is distinct from p.amount_strategy or p.currency<>s.currency then raise exception 'revenue_amount_basis_invalid';end if;
 total:=public.revenue_decimal(b.amount_basis_snapshot->'amount');
 if total is null or total>s.accepted_amount or
  (p.amount_strategy='ACCEPTED_SERVICE_CONSIDERATION' and (total<>s.accepted_amount or b.principal_agent_role<>'PRINCIPAL')) or
  (p.amount_strategy='APPROVED_AGENT_FEE' and (b.agent_fee is null or total<>b.agent_fee or b.principal_agent_role<>'AGENT')) or
  (p.amount_strategy='APPROVED_ALLOCATED_CONSIDERATION' and nullif(trim(b.allocation_decision_reference),'') is null) then raise exception 'revenue_allocation_required';end if;
 if not ((b.principal_agent_role='PRINCIPAL' and b.presentation='GROSS') or (b.principal_agent_role='AGENT' and b.presentation='NET')) or b.presentation<>p.presentation then raise exception 'revenue_assessment_required';end if;
 for a in select * from public.revenue_fulfillment_attestations where workspace_id=ws and reporting_entity_id=entity and specified_service_id=s.id and binding_id=b.id and recognition_unit_key=unit_key and status='ACCEPTED' order by id for share loop
  resolved:=public.revenue_resolve_evidence(s.id,a.source_domain,a.source_id);
  if resolved->>'hash' is distinct from a.source_hash or resolved->>'version' is distinct from a.source_version then raise exception 'revenue_source_changed';end if;
  if a.policy_version_id<>p.id or a.requirement_digest<>public.revenue_digest(jsonb_build_object('rule',b.fulfillment_requirements->unit_key,'unit',unit,'binding',b.id,'policy',p.id)) then raise exception 'revenue_evidence_basis_invalid';end if;
  verified:=verified+a.verified_units;day:=greatest(day,a.business_date);
  evidence:=evidence||jsonb_build_array(jsonb_build_object('id',a.id,'digest',a.basis_digest,'source_domain',a.source_domain,'source_id',a.source_id,'source_version',a.source_version,'source_hash',a.source_hash,'business_date',a.business_date,'units',a.verified_units::text,'coverage_from',a.coverage_from,'coverage_to',a.coverage_to));
 end loop;
 if jsonb_array_length(evidence)=0 then raise exception 'revenue_fulfillment_required';end if;
 denominator:=public.revenue_decimal(unit->'units',true);
 if verified>denominator or (p.recognition_strategy<>'OVER_TIME_BY_VERIFIED_UNITS' and verified<>denominator) then raise exception 'revenue_units_invalid';end if;
 if day<p.effective_from or (p.effective_to is not null and day>p.effective_to) then raise exception 'revenue_policy_not_applicable';end if;
 select * into period from public.revenue_accounting_periods where workspace_id=ws and reporting_entity_id=entity and day between start_on and end_on for share;
 if not found then raise exception 'revenue_period_missing';end if;
 if period.status<>'OPEN' then raise exception 'revenue_period_closed';end if;
 -- A cumulative unit cannot silently shift earlier-period fulfillment forward.
 -- Bindings must enumerate separate period units when coverage crosses periods.
 if exists(select 1 from jsonb_array_elements(evidence) e where (e->>'business_date')::date not between period.start_on and period.end_on) then raise exception 'revenue_unit_cross_period_unsupported';end if;
 allocations:=public.revenue_allocate_units(total,b.recognition_unit_schedule);
 select value into allocation from jsonb_array_elements(allocations) where value->>'key'=unit_key;
 -- Partial coverage is cumulative within one semantic unit, never additive snapshots.
 -- Floor partial minor units; the final verified unit receives the exact residual.
 minor:=div((allocation->>'minor_units')::numeric*verified*1000000,denominator*1000000);
 sources:=jsonb_build_object('accepted_contract_version',cv.id,'accepted_quote_version',s.source_quote_version_id,'quote_line',s.source_quote_line_reference,'price_source',s.accepted_price_source,'price_reference',s.accepted_price_reference,'price_digest',s.accepted_price_snapshot_digest);
 basis:=jsonb_build_object('workspace',ws,'entity',entity,'contract',s.contract_id,'contract_version',cv.id,'service',s.id,'stable_service_key',s.stable_service_key,'binding',b.id,'binding_version',b.version,'policy',p.id,'policy_version',p.version,'role',b.principal_agent_role,'presentation',b.presentation,'unit',unit_key,'evidence',evidence,'sources',sources,'amount_basis',jsonb_build_object('approved',b.amount_basis_snapshot,'allocation_reference',b.allocation_decision_reference,'agent_fee',b.agent_fee::text,'assessment_digest',b.assessment_source_digest,'schedule',b.recognition_unit_schedule,'allocations',allocations,'verified_units',verified::text),'amount',(minor/100)::numeric(14,2)::text,'currency',s.currency,'business_date',day,'period',period.id,'period_revision',period.revision,'evaluation_version','R5C_EVALUATOR_V1');
 return basis||jsonb_build_object('digest',public.revenue_digest(basis));
end $$;

create function public.revenue_candidate_current(target uuid) returns boolean language plpgsql security definer set search_path=public,app_auth as $$
declare c public.revenue_recognition_candidates;b jsonb;begin
 select * into c from public.revenue_recognition_candidates where workspace_id=public.revenue_workspace_id() and id=target;
 if not found then return false;end if;
 begin b:=public.revenue_candidate_basis(c.reporting_entity_id,c.specified_service_id,c.binding_id,c.recognition_unit_key);
 exception when raise_exception then return false;end;
 return c.basis_digest=b->>'digest';end $$;

create function public.revenue_candidate_health(target uuid) returns text language plpgsql security definer set search_path=public,app_auth as $$
declare c public.revenue_recognition_candidates;begin
 select * into c from public.revenue_recognition_candidates where workspace_id=public.revenue_workspace_id() and id=target;
 if not found or not (public.revenue_has_authority(c.reporting_entity_id,'RECOGNITION_PREPARER') or public.revenue_has_authority(c.reporting_entity_id,'RECOGNITION_REVIEWER')) then raise exception 'revenue_authority_required';end if;
 if c.status='BLOCKED' then return 'BLOCKED';end if;
 if c.status='STALE' or not public.revenue_candidate_current(target) then return 'STALE';end if;return 'CURRENT';end $$;

create function public.guard_revenue_candidate_row() returns trigger language plpgsql set search_path=public as $$begin
 if tg_op='DELETE' then raise exception 'revenue_retention_required';end if;
 if (to_jsonb(new)-array['status','revision','approval_reference','reviewed_by','reviewed_at','state_reference']) is distinct from (to_jsonb(old)-array['status','revision','approval_reference','reviewed_by','reviewed_at','state_reference']) then raise exception 'revenue_candidate_immutable';end if;return new;end $$;
create trigger revenue_candidate_retention before update or delete on public.revenue_recognition_candidates for each row execute function public.guard_revenue_candidate_row();

alter table public.approval_requests drop constraint approval_requests_request_type_check;
alter table public.approval_requests add constraint approval_requests_request_type_check check(request_type in (
 'CONTRACT_SIGN','CONTRACT_EXPORT','PERFORMANCE_SUMMARY','PERFORMANCE_ALLOCATION','QUOTE_DISCOUNT','REFUND','MARKETING_CONTACT_EXPORT','CRM_EXPORT',
 'REVENUE_REPORTING_PROFILE','REVENUE_POLICY_VERSION','REVENUE_SERVICE_BINDING','REVENUE_AUTHORITY_ASSIGNMENT','REVENUE_RECOGNITION_CANDIDATE'));
-- Keep foundation guard implementation unchanged; route the new exact type separately.
drop trigger revenue_approval_guard on public.approval_requests;
create trigger revenue_approval_guard before update on public.approval_requests for each row when (old.request_type<>'REVENUE_RECOGNITION_CANDIDATE' and new.request_type<>'REVENUE_RECOGNITION_CANDIDATE') execute function public.guard_revenue_approval();
create function public.guard_revenue_candidate_approval() returns trigger language plpgsql security definer set search_path=public,app_auth as $$
declare c public.revenue_recognition_candidates;entity uuid;begin
 if old.request_type<>'REVENUE_RECOGNITION_CANDIDATE' or (to_jsonb(new)-array['status','decision_reason','decided_by','decided_at','updated_at','execution_status','executed_at','execution_error']) is distinct from (to_jsonb(old)-array['status','decision_reason','decided_by','decided_at','updated_at','execution_status','executed_at','execution_error']) then raise exception 'revenue_approval_immutable';end if;
 if new.status=old.status then return new;end if;
 entity:=(old.request_payload->>'entity')::uuid;
 perform public.revenue_require(entity,'RECOGNITION_REVIEWER');
 if not public.revenue_has_authority(entity,'RECOGNITION_REVIEWER') then raise exception 'revenue_authority_required';end if;
 select * into c from public.revenue_recognition_candidates where workspace_id=public.revenue_workspace_id() and reporting_entity_id=entity and id=old.business_object_id::uuid for update;
 if not found or old.workspace_id<>c.workspace_id or c.status<>'READY_FOR_REVIEW' or c.approval_reference is distinct from old.id or old.requester_id<>c.created_by or c.created_by=app_auth.current_user_id() or new.decided_by is distinct from app_auth.current_user_id() or old.status<>'PENDING' or old.expires_at<=now() or new.status not in ('APPROVED','REJECTED') or nullif(trim(new.decision_reason),'') is null or (old.request_payload->>'revision')::integer<>c.revision or old.request_payload->>'digest' is distinct from c.basis_digest then raise exception 'revenue_review_invalid';end if;
 if new.status='APPROVED' and not public.revenue_candidate_current(c.id) then raise exception 'revenue_stale_basis';end if;
 update public.revenue_recognition_candidates set status=new.status,revision=revision+1,reviewed_by=new.decided_by,reviewed_at=new.decided_at,state_reference=new.decision_reason where id=c.id;
 perform public.revenue_audit('REVENUE_CANDIDATE_'||new.status,c.id,jsonb_build_object('basis_digest',c.basis_digest,'amount',c.amount::text,'currency',c.currency,'business_date',c.business_date,'approval',old.id,'reviewer',new.decided_by));
 return new;end $$;
create trigger revenue_candidate_approval_guard before update on public.approval_requests for each row when (old.request_type='REVENUE_RECOGNITION_CANDIDATE' or new.request_type='REVENUE_RECOGNITION_CANDIDATE') execute function public.guard_revenue_candidate_approval();

-- Generic decision entry must acquire the same lock BEFORE its Approval row lock.
alter function public.decide_approval(uuid,text,text) rename to decide_approval_before_r5c;
revoke all on function public.decide_approval_before_r5c(uuid,text,text) from public,crm_app,crm_system,crm_worker;
create function public.decide_approval(request_id uuid,decision text,decision_comment text default null) returns public.approval_requests language plpgsql security definer set search_path=public,app_auth,extensions as $$
declare a public.approval_requests;begin
 select * into a from public.approval_requests where id=request_id;
 if a.request_type='REVENUE_RECOGNITION_CANDIDATE' then perform public.revenue_require((a.request_payload->>'entity')::uuid,'RECOGNITION_REVIEWER');end if;
 return public.decide_approval_before_r5c(request_id,decision,decision_comment);end $$;
revoke all on function public.decide_approval(uuid,text,text) from public;
grant execute on function public.decide_approval(uuid,text,text) to crm_app;

create function public.revenue_candidate_command(entity uuid,command text,target uuid,expected_revision integer,data jsonb,request_key text) returns jsonb
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
   for old in select * from public.revenue_recognition_candidates where workspace_id=ws and reporting_entity_id=entity and contract_id=(basis->>'contract')::uuid and stable_service_key=basis->>'stable_service_key' and recognition_unit_key=basis->>'unit' and status in ('DRAFT','READY_FOR_REVIEW','APPROVED') for update loop
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

alter table public.revenue_recognition_candidates enable row level security;
revoke all on public.revenue_recognition_candidates from public,crm_app,crm_system,crm_worker;
grant select on public.revenue_recognition_candidates to crm_app;
create policy revenue_candidate_read on public.revenue_recognition_candidates for select to crm_app using(workspace_id=public.revenue_workspace_id() and (public.revenue_has_authority(reporting_entity_id,'RECOGNITION_PREPARER') or public.revenue_has_authority(reporting_entity_id,'RECOGNITION_REVIEWER')));
revoke all on function public.revenue_allocate_units(numeric,jsonb),public.revenue_candidate_basis(uuid,uuid,uuid,text),public.revenue_candidate_current(uuid),public.revenue_candidate_health(uuid),public.guard_revenue_candidate_row(),public.guard_revenue_candidate_approval(),public.revenue_candidate_command(uuid,text,uuid,integer,jsonb,text) from public,crm_app,crm_system,crm_worker;
grant execute on function public.revenue_candidate_health(uuid),public.revenue_candidate_command(uuid,text,uuid,integer,jsonb,text) to crm_app;
