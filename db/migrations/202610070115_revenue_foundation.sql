-- R5A only: configuration, policy, accepted service and binding. No recognition.
set search_path=public,app_auth,extensions;

-- Existing workspace helper selects the first active membership. Reject a
-- mismatched explicit context rather than leaking another workspace's records.
create function public.revenue_workspace_id() returns uuid language sql stable security definer set search_path=public,app_auth as $$
 select public.current_workspace_id() where nullif(current_setting('app.workspace_id',true),'')::uuid=public.current_workspace_id()
$$;

create table public.revenue_reporting_profiles (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id),
 reporting_entity_id uuid not null, legal_name text not null check(length(trim(legal_name)) between 1 and 200),
 accounting_framework text not null, business_timezone text not null,
 allowed_currencies text[] not null, precision_scale integer not null default 2 check(precision_scale=2),
 cutoff_reference text not null, correction_reference text not null, retention_reference text not null,
 maker_checker_required boolean not null default true check(maker_checker_required),
 status text not null default 'DRAFT' check(status in ('DRAFT','IN_REVIEW','ACTIVE','RETIRED')),
 revision integer not null default 1, created_by uuid not null references app_auth.accounts(id),
 approval_reference uuid, created_at timestamptz not null default clock_timestamp(),
 unique(workspace_id,id), unique(workspace_id,reporting_entity_id),
 check(cardinality(allowed_currencies)>0 and length(accounting_framework)>0 and length(cutoff_reference)>0 and length(correction_reference)>0 and length(retention_reference)>0)
);
create unique index revenue_one_active_profile on public.revenue_reporting_profiles(workspace_id) where status='ACTIVE';
create table public.revenue_authority_assignments (
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null,reporting_entity_id uuid not null,
 user_id uuid not null references app_auth.accounts(id), authority text not null check(authority in ('POLICY_OWNER','POLICY_APPROVER','POSTING_AUTHORITY')),
 effective_from timestamptz not null,effective_to timestamptz,authority_reference text not null check(length(trim(authority_reference))>0),
 assigned_by uuid not null references app_auth.accounts(id),approval_reference uuid,
 status text not null default 'ACTIVE' check(status in ('IN_REVIEW','ACTIVE','REJECTED','REVOKED')),
 revision integer not null default 1,revoked_at timestamptz,created_at timestamptz not null default clock_timestamp(),
 unique(workspace_id,id),foreign key(workspace_id,reporting_entity_id) references public.revenue_reporting_profiles(workspace_id,reporting_entity_id),
 foreign key(workspace_id,user_id) references public.workspace_memberships(workspace_id,user_id),
 check(effective_to is null or effective_to>effective_from)
);
create table public.revenue_accounting_periods (
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null,reporting_entity_id uuid not null,
 period_key text not null,start_on date not null,end_on date not null,status text not null default 'OPEN' check(status in ('OPEN','CLOSED')),
 revision integer not null default 1,closed_by uuid references app_auth.accounts(id),closed_at timestamptz,close_reference text,
 created_by uuid not null references app_auth.accounts(id),created_at timestamptz not null default clock_timestamp(),
 unique(workspace_id,id),unique(workspace_id,reporting_entity_id,period_key),
 foreign key(workspace_id,reporting_entity_id) references public.revenue_reporting_profiles(workspace_id,reporting_entity_id),
 check(start_on<=end_on),check(status<>'CLOSED' or (closed_by is not null and closed_at is not null and length(trim(close_reference))>0))
);
create table public.revenue_policy_versions (
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null,reporting_entity_id uuid not null,
 policy_key text not null check(policy_key~'^[A-Z][A-Z0-9_]{2,79}$'),version integer not null check(version>0),
 recognition_strategy text not null check(recognition_strategy in ('POINT_IN_TIME_ON_APPROVED_EVIDENCE','OVER_TIME_BY_VERIFIED_UNITS','OVER_TIME_BY_APPROVED_MILESTONES')),
 amount_strategy text not null check(amount_strategy in ('ACCEPTED_SERVICE_CONSIDERATION','APPROVED_AGENT_FEE','APPROVED_ALLOCATED_CONSIDERATION')),
 presentation text not null check(presentation in ('GROSS','NET')),fulfillment_rule_reference text not null,
 refund_correction_reference text not null,currency text not null check(currency~'^[A-Z]{3}$'),
 effective_from date not null,effective_to date,test_only boolean not null default false,
 status text not null default 'DRAFT' check(status in ('DRAFT','IN_REVIEW','APPROVED','REJECTED','RETIRED')),
 revision integer not null default 1,created_by uuid not null references app_auth.accounts(id),
 approval_reference uuid,approved_by uuid references app_auth.accounts(id),approved_at timestamptz,
 created_at timestamptz not null default clock_timestamp(),unique(workspace_id,id),unique(workspace_id,reporting_entity_id,id),unique(workspace_id,policy_key,version),
 foreign key(workspace_id,reporting_entity_id) references public.revenue_reporting_profiles(workspace_id,reporting_entity_id),
 check(effective_to is null or effective_to>=effective_from),check(length(trim(fulfillment_rule_reference))>0 and length(trim(refund_correction_reference))>0),
 check(status<>'APPROVED' or (not test_only and approved_by is not null and approved_by<>created_by and approval_reference is not null))
);

-- Commercial acceptance is explicit; operational snapshots remain operational.
alter table public.contract_versions add constraint revenue_contract_version_scope unique(workspace_id,contract_id,id);
alter table public.quote_versions add constraint revenue_quote_version_scope unique(workspace_id,quote_id,id);
alter table public.contracts add column source_quote_version_id uuid;
alter table public.contracts add constraint revenue_contract_quote_scope foreign key(workspace_id,quote_id,source_quote_version_id) references public.quote_versions(workspace_id,quote_id,id);
create function public.pin_contract_quote_version() returns trigger language plpgsql security definer set search_path=public,app_auth as $$begin
 if tg_op='UPDATE' then
  if new.source_quote_version_id is distinct from old.source_quote_version_id or (old.source_quote_version_id is not null and new.quote_id is distinct from old.quote_id) then raise exception 'revenue_quote_provenance_immutable';end if;
 elsif new.quote_id is not null then
  select v.id into new.source_quote_version_id from public.quotes q join public.quote_versions v on v.quote_id=q.id and v.version=q.current_version where q.id=new.quote_id and q.workspace_id=new.workspace_id and q.status='ACCEPTED';
  if new.source_quote_version_id is null then raise exception 'revenue_quote_provenance_invalid';end if;
 end if;return new;end $$;
create trigger revenue_pin_quote before insert or update on public.contracts for each row execute function public.pin_contract_quote_version();
alter table public.contract_versions add column commercial_accepted_at timestamptz;
alter table public.contract_versions add column commercial_accepted_by uuid references app_auth.accounts(id);
alter table public.contract_versions add column commercial_acceptance_reference text;
alter table public.contract_versions add column accepted_quote_id uuid;
alter table public.contract_versions add column accepted_quote_version_id uuid;
alter table public.contract_versions add column accepted_quote_snapshot jsonb;
alter table public.contract_versions add constraint revenue_accepted_quote_scope foreign key(workspace_id,accepted_quote_id,accepted_quote_version_id) references public.quote_versions(workspace_id,quote_id,id);

create table public.contract_specified_services (
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null,reporting_entity_id uuid not null,
 contract_id uuid not null,contract_version_id uuid not null,stable_service_key text not null check(stable_service_key~'^[A-Z0-9_-]{1,80}$'),
 supersedes_service_id uuid,source_quote_id uuid,source_quote_version_id uuid,source_quote_line_reference text,
 product_id uuid,cohort_id uuid,service_classification text not null,description_snapshot text not null,
 accepted_quantity numeric(18,6) not null check(accepted_quantity>0),accepted_amount numeric(14,2) not null check(accepted_amount>=0),
 currency text not null check(currency~'^[A-Z]{3}$'),accepted_price_source text not null check(accepted_price_source in ('CONTRACT_VERSION','QUOTE_VERSION','PRODUCT_PRICE_SNAPSHOT','APPROVED_NEGOTIATED_AMOUNT')),
 accepted_price_reference text not null,accepted_price_snapshot jsonb not null,accepted_price_snapshot_digest text not null,
 created_by uuid not null references app_auth.accounts(id),created_at timestamptz not null default clock_timestamp(),
 unique(workspace_id,id),unique(workspace_id,reporting_entity_id,id),unique(workspace_id,contract_version_id,stable_service_key),
 foreign key(workspace_id,reporting_entity_id) references public.revenue_reporting_profiles(workspace_id,reporting_entity_id),
 foreign key(workspace_id,contract_id,contract_version_id) references public.contract_versions(workspace_id,contract_id,id),
 foreign key(workspace_id,reporting_entity_id,supersedes_service_id) references public.contract_specified_services(workspace_id,reporting_entity_id,id),
 foreign key(workspace_id,source_quote_id,source_quote_version_id) references public.quote_versions(workspace_id,quote_id,id),
 foreign key(workspace_id,product_id) references public.products(workspace_id,id),
 foreign key(workspace_id,product_id,cohort_id) references public.product_cohorts(workspace_id,product_id,id),
 check(cohort_id is null or product_id is not null)
);
create unique index revenue_service_single_successor on public.contract_specified_services(supersedes_service_id) where supersedes_service_id is not null;
create table public.revenue_service_bindings (
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null,reporting_entity_id uuid not null,
 specified_service_id uuid not null,policy_version_id uuid not null,version integer not null,predecessor_id uuid,
 principal_agent_role text not null check(principal_agent_role in ('PRINCIPAL','AGENT','NOT_APPLICABLE','UNRESOLVED')),
 assessment_basis_reference text not null,assessment_source_digest text not null,assessment_sources jsonb not null,
 presentation text not null check(presentation in ('GROSS','NET')),amount_basis_snapshot jsonb not null,
 allocation_decision_reference text,agent_fee numeric(14,2),refund_contract_version_id uuid not null,
 scenario_reference text,reference_fallback text,has_variance boolean not null default false,variance_review_reference text,
 recognition_unit_schedule jsonb not null,status text not null default 'DRAFT' check(status in ('DRAFT','IN_REVIEW','APPROVED','REJECTED','SUPERSEDED')),
 revision integer not null default 1,created_by uuid not null references app_auth.accounts(id),reviewed_by uuid references app_auth.accounts(id),
 approved_by uuid references app_auth.accounts(id),approved_at timestamptz,approval_reference uuid,
 created_at timestamptz not null default clock_timestamp(),unique(workspace_id,id),unique(workspace_id,reporting_entity_id,id),unique(specified_service_id,version),
 foreign key(workspace_id,reporting_entity_id) references public.revenue_reporting_profiles(workspace_id,reporting_entity_id),
 foreign key(workspace_id,reporting_entity_id,specified_service_id) references public.contract_specified_services(workspace_id,reporting_entity_id,id),
 foreign key(workspace_id,reporting_entity_id,policy_version_id) references public.revenue_policy_versions(workspace_id,reporting_entity_id,id),
 foreign key(workspace_id,reporting_entity_id,predecessor_id) references public.revenue_service_bindings(workspace_id,reporting_entity_id,id),
 check(status<>'APPROVED' or (approved_by is not null and approved_by<>created_by and approval_reference is not null and principal_agent_role<>'UNRESOLVED'))
);
alter table public.approval_requests add constraint revenue_approval_scope unique(workspace_id,id);
alter table public.revenue_reporting_profiles add constraint revenue_reporting_profiles_approval_scope foreign key(workspace_id,approval_reference) references public.approval_requests(workspace_id,id);
alter table public.revenue_authority_assignments add constraint revenue_authority_assignments_approval_scope foreign key(workspace_id,approval_reference) references public.approval_requests(workspace_id,id);
alter table public.revenue_policy_versions add constraint revenue_policy_versions_approval_scope foreign key(workspace_id,approval_reference) references public.approval_requests(workspace_id,id);
alter table public.revenue_service_bindings add constraint revenue_service_bindings_approval_scope foreign key(workspace_id,approval_reference) references public.approval_requests(workspace_id,id);
create unique index revenue_one_approved_binding on public.revenue_service_bindings(specified_service_id) where status='APPROVED';

create function public.revenue_period_no_overlap() returns trigger language plpgsql security definer set search_path=public as $$begin
 perform pg_advisory_xact_lock(hashtextextended('revenue:'||new.workspace_id::text,0));
 if exists(select 1 from public.revenue_accounting_periods p where p.workspace_id=new.workspace_id and p.reporting_entity_id=new.reporting_entity_id and p.id<>new.id and daterange(p.start_on,p.end_on,'[]') && daterange(new.start_on,new.end_on,'[]')) then raise exception 'revenue_period_overlap';end if;return new;end $$;
create trigger revenue_period_ranges before insert or update on public.revenue_accounting_periods for each row execute function public.revenue_period_no_overlap();

-- Canonical JSON v1: sorted object keys, array order retained, explicit nulls.
-- All monetary inputs are normalized decimal strings before hashing.
create function public.revenue_canonical_json(value jsonb) returns text language plpgsql immutable set search_path=public,extensions as $$
declare result text;begin
 case jsonb_typeof(value)
 when 'object' then select '{'||coalesce(string_agg(to_jsonb(key)::text||':'||public.revenue_canonical_json(v),',' order by key collate "C"),'')||'}' into result from jsonb_each(value) e(key,v);
 when 'array' then select '['||coalesce(string_agg(public.revenue_canonical_json(v),',' order by n),'')||']' into result from jsonb_array_elements(value) with ordinality e(v,n);
 else result:=coalesce(value::text,'null');end case;return result;end $$;
create function public.revenue_digest(value jsonb) returns text language sql immutable set search_path=public,extensions as $$select encode(digest(public.revenue_canonical_json(value),'sha256'),'hex')$$;
create function public.revenue_decimal(value jsonb,quantity boolean default false) returns numeric language plpgsql immutable set search_path=public as $$
begin
 if jsonb_typeof(value) is distinct from 'string' or (not quantity and (value#>>'{}') !~ '^(0|[1-9][0-9]{0,11})(\.[0-9]{1,2})?$') or (quantity and (value#>>'{}') !~ '^(0|[1-9][0-9]{0,11})(\.[0-9]{1,6})?$') then raise exception 'revenue_decimal_invalid';end if;
 return (value#>>'{}')::numeric;end $$;
create function public.revenue_has_authority(entity uuid,kind text) returns boolean language sql stable security definer set search_path=public,app_auth as $$
 select public.current_crm_role() in ('ADMIN','SUPER_ADMIN') and exists(
 select 1 from public.revenue_authority_assignments a join public.workspace_memberships m on m.workspace_id=a.workspace_id and m.user_id=a.user_id
 where a.workspace_id=public.revenue_workspace_id() and m.status='ACTIVE' and a.reporting_entity_id=entity and a.user_id=app_auth.current_user_id() and a.authority=kind
 and a.status='ACTIVE' and a.revoked_at is null and a.effective_from<=now() and (a.effective_to is null or a.effective_to>now()))
$$;
create function public.revenue_require(entity uuid,kind text) returns void language plpgsql security definer set search_path=public,app_auth as $$begin
 if not coalesce(public.revenue_has_authority(entity,kind),false) then raise exception 'revenue_authority_required';end if;
 if current_setting('app.aal',true) is distinct from 'aal2' then raise exception 'revenue_aal2_required';end if;
 perform pg_advisory_xact_lock(hashtextextended('revenue:'||public.revenue_workspace_id()::text,0));
end $$;

-- New approval types are dispatched by a BEFORE UPDATE guard, so generic
-- decide_approval cannot approve Revenue without executing the same checks.
alter table public.approval_requests drop constraint approval_requests_request_type_check;
alter table public.approval_requests add constraint approval_requests_request_type_check check(request_type in (
 'CONTRACT_SIGN','CONTRACT_EXPORT','PERFORMANCE_SUMMARY','PERFORMANCE_ALLOCATION','QUOTE_DISCOUNT','REFUND','MARKETING_CONTACT_EXPORT','CRM_EXPORT',
 'REVENUE_REPORTING_PROFILE','REVENUE_POLICY_VERSION','REVENUE_SERVICE_BINDING','REVENUE_AUTHORITY_ASSIGNMENT'));
create function public.guard_revenue_approval() returns trigger language plpgsql security definer set search_path=public,app_auth,extensions as $$
declare entity uuid;target uuid;basis jsonb;relation text;b public.revenue_service_bindings;begin
 if old.request_type not like 'REVENUE_%' then return new;end if;
 if (to_jsonb(new)-array['status','decision_reason','decided_by','decided_at','updated_at','execution_status','executed_at','execution_error']) is distinct from (to_jsonb(old)-array['status','decision_reason','decided_by','decided_at','updated_at','execution_status','executed_at','execution_error']) then raise exception 'revenue_approval_immutable';end if;
 if new.status=old.status then return new;end if;
 if old.status<>'PENDING' or new.status not in ('APPROVED','REJECTED') or old.expires_at<=now() then raise exception 'revenue_review_invalid';end if;
 entity:=(old.request_payload->>'entity')::uuid;target:=old.business_object_id::uuid;
 perform public.revenue_require(entity,'POLICY_APPROVER');
 if old.workspace_id<>public.revenue_workspace_id() or old.requester_id=app_auth.current_user_id() or new.decided_by is distinct from app_auth.current_user_id() then raise exception 'revenue_self_approval_forbidden';end if;
 relation:=case old.request_type when 'REVENUE_REPORTING_PROFILE' then 'revenue_reporting_profiles' when 'REVENUE_POLICY_VERSION' then 'revenue_policy_versions' when 'REVENUE_SERVICE_BINDING' then 'revenue_service_bindings' when 'REVENUE_AUTHORITY_ASSIGNMENT' then 'revenue_authority_assignments' end;
 if relation is null then raise exception 'revenue_review_invalid';end if;
 execute format('select to_jsonb(t) from public.%I t where workspace_id=$1 and reporting_entity_id=$2 and id=$3 for update',relation) into basis using old.workspace_id,entity,target;
 if basis is null or basis->>'status'<>'IN_REVIEW' or coalesce(basis->>'created_by',basis->>'assigned_by')<>old.requester_id::text or basis->>'approval_reference'<>old.id::text or basis->'revision' is distinct from old.request_payload->'revision' or public.revenue_digest(basis-'approval_reference') is distinct from old.request_payload->>'digest' then raise exception 'revenue_stale_approval';end if;
 if old.request_type<>'REVENUE_REPORTING_PROFILE' and not exists(select 1 from public.revenue_reporting_profiles where workspace_id=old.workspace_id and reporting_entity_id=entity and status='ACTIVE') then raise exception 'revenue_profile_inactive';end if;
 if old.request_type='REVENUE_AUTHORITY_ASSIGNMENT' then
  if basis->>'user_id'=app_auth.current_user_id()::text then raise exception 'revenue_self_assignment_forbidden';end if;
  update public.revenue_authority_assignments set status=case when new.status='APPROVED' then 'ACTIVE' else 'REJECTED' end,revision=revision+1 where id=target;
 elsif old.request_type='REVENUE_POLICY_VERSION' then
  if (basis->>'test_only')::boolean then raise exception 'revenue_test_only_forbidden';end if;
  update public.revenue_policy_versions set status=new.status,approved_by=case when new.status='APPROVED' then new.decided_by end,approved_at=case when new.status='APPROVED' then new.decided_at end,revision=revision+1 where id=target;
 elsif old.request_type='REVENUE_SERVICE_BINDING' then
  if new.status='APPROVED' then
   perform public.revenue_validate_binding(target);
   select * into b from public.revenue_service_bindings where id=target;
   update public.revenue_service_bindings set status='SUPERSEDED',revision=revision+1 where specified_service_id=b.specified_service_id and id<>target and status='APPROVED';
  end if;
  update public.revenue_service_bindings set status=new.status,reviewed_by=new.decided_by,approved_by=case when new.status='APPROVED' then new.decided_by end,approved_at=case when new.status='APPROVED' then new.decided_at end,revision=revision+1 where id=target;
 else
  if new.status='REJECTED' then
   update public.revenue_reporting_profiles set status='DRAFT',revision=revision+1,approval_reference=null where id=target;
  else
   if not exists(select 1 from public.revenue_authority_assignments where workspace_id=old.workspace_id and reporting_entity_id=entity and authority='POLICY_OWNER' and revoked_at is null and effective_from<=now() and (effective_to is null or effective_to>now())) then raise exception 'revenue_authority_required';end if;
   update public.revenue_reporting_profiles set status='ACTIVE',revision=revision+1 where id=target;
  end if;
 end if;
 perform public.revenue_audit('REVENUE_'||new.status,target,jsonb_build_object('entity',entity,'approval',old.id,'basis_digest',old.request_payload->>'digest'));return new;
end $$;
create trigger revenue_approval_guard before update on public.approval_requests for each row execute function public.guard_revenue_approval();

create function public.decide_revenue_approval(request_id uuid,expected_revision integer,decision text,reference text,request_key text) returns jsonb
language plpgsql security definer set search_path=public,app_auth,extensions as $$
declare a public.approval_requests;result jsonb;payload jsonb:=jsonb_build_object('request',request_id,'revision',expected_revision,'decision',decision,'reference',reference);begin
 if current_setting('app.aal',true) is distinct from 'aal2' then raise exception 'revenue_aal2_required';end if;
 select * into a from public.approval_requests where workspace_id=public.revenue_workspace_id() and id=request_id;
 if not found or a.request_type not like 'REVENUE_%' then raise exception 'revenue_review_invalid';end if;
 perform public.revenue_require((a.request_payload->>'entity')::uuid,'POLICY_APPROVER');
 result:=public.commission_receipt(request_key,'REVENUE_APPROVAL_DECIDE',payload);if result is not null then return result;end if;
 if (a.request_payload->>'revision')::integer is distinct from expected_revision or nullif(trim(reference),'') is null then raise exception 'revenue_version_conflict';end if;
 a:=public.decide_approval(request_id,decision,reference);
 return public.commission_finish(request_key,'REVENUE_APPROVAL_DECIDE',payload,to_jsonb(a));end $$;

create function public.guard_revenue_foundation_row() returns trigger language plpgsql set search_path=public,app_auth as $$
declare frozen boolean;begin
 if tg_op='DELETE' then raise exception 'revenue_retention_required';end if;
 if tg_table_name='contract_specified_services' then raise exception 'revenue_service_immutable';end if;
 frozen:=tg_table_name in ('revenue_policy_versions','revenue_service_bindings','revenue_reporting_profiles');
 if frozen and (to_jsonb(new)-array['status','revision','approval_reference','approved_by','approved_at','reviewed_by']) is distinct from (to_jsonb(old)-array['status','revision','approval_reference','approved_by','approved_at','reviewed_by']) then raise exception 'revenue_version_immutable';end if;
 if tg_table_name='revenue_authority_assignments' and (to_jsonb(new)-array['revoked_at','revision','authority_reference','status','approval_reference']) is distinct from (to_jsonb(old)-array['revoked_at','revision','authority_reference','status','approval_reference']) then raise exception 'revenue_authority_immutable';end if;
 if tg_table_name='revenue_accounting_periods' and (old.status='CLOSED' or (to_jsonb(new)-array['status','revision','closed_by','closed_at','close_reference']) is distinct from (to_jsonb(old)-array['status','revision','closed_by','closed_at','close_reference'])) then raise exception 'revenue_period_immutable';end if;
 return new;end $$;
create function public.guard_revenue_contract_version() returns trigger language plpgsql security definer set search_path=public,app_auth as $$begin
 if old.commercial_accepted_at is not null then
  if tg_op='DELETE' or new is distinct from old then raise exception 'revenue_accepted_version_immutable';end if;
 end if;
 if tg_op='DELETE' then return old;end if;return new;end $$;
create trigger revenue_contract_version_retention before update or delete on public.contract_versions for each row execute function public.guard_revenue_contract_version();

create function public.revenue_audit(action text,target uuid,data jsonb) returns void language sql security definer set search_path=public,app_auth as $$
 insert into public.audit_events(workspace_id,actor_id,action,entity_type,entity_id,after_data) values(public.revenue_workspace_id(),app_auth.current_user_id(),action,'REVENUE_FOUNDATION',target,data)
$$;

-- Provisioning is NOT an application-admin capability. This function is migrator-only.
-- The external authority reference records the verified onboarding decision.
create function public.provision_revenue_profile(entity uuid,owner_user uuid,approver_user uuid,data jsonb,request_key text) returns jsonb
language plpgsql security definer set search_path=public,app_auth,extensions as $$
declare ws uuid:=public.revenue_workspace_id();r public.revenue_reporting_profiles;payload jsonb:=jsonb_build_object('entity',entity,'owner',owner_user,'approver',approver_user,'data',data);result jsonb;begin
 if owner_user=approver_user or app_auth.current_user_id() is null or current_setting('app.aal',true) is distinct from 'aal2' then raise exception 'revenue_provisioning_invalid';end if;
 if (select count(*) from public.workspace_memberships where workspace_id=ws and user_id in(owner_user,approver_user) and role in ('ADMIN','SUPER_ADMIN'))<>2 then raise exception 'revenue_membership_required';end if;
 perform pg_advisory_xact_lock(hashtextextended('revenue:'||ws::text,0));result:=public.commission_receipt(request_key,'REVENUE_PROFILE_PROVISION',payload);if result is not null then return result;end if;
 if not exists(select 1 from pg_timezone_names where name=data->>'business_timezone') or not exists(select 1 from public.workspaces where id=ws and business_timezone=data->>'business_timezone') then raise exception 'revenue_timezone_invalid';end if;
 if jsonb_typeof(data->'allowed_currencies') is distinct from 'array' or exists(select 1 from jsonb_array_elements_text(data->'allowed_currencies') c where c !~ '^[A-Z]{3}$') then raise exception 'revenue_currency_invalid';end if;
 insert into public.revenue_reporting_profiles(workspace_id,reporting_entity_id,legal_name,accounting_framework,business_timezone,allowed_currencies,cutoff_reference,correction_reference,retention_reference,created_by)
 values(ws,entity,data->>'legal_name',data->>'accounting_framework',data->>'business_timezone',array(select jsonb_array_elements_text(data->'allowed_currencies')),data->>'cutoff_reference',data->>'correction_reference',data->>'retention_reference',owner_user) returning * into r;
 insert into public.revenue_authority_assignments(workspace_id,reporting_entity_id,user_id,authority,effective_from,authority_reference,assigned_by)
 values(ws,entity,owner_user,'POLICY_OWNER',now(),data->>'authority_reference',app_auth.current_user_id()),(ws,entity,approver_user,'POLICY_APPROVER',now(),data->>'authority_reference',app_auth.current_user_id());
 perform public.revenue_audit('REVENUE_PROFILE_PROVISIONED',r.id,jsonb_build_object('reference',data->>'authority_reference','entity',entity));
 return public.commission_finish(request_key,'REVENUE_PROFILE_PROVISION',payload,to_jsonb(r));end $$;

create function public.revenue_validate_binding(target uuid) returns void language plpgsql security definer set search_path=public,app_auth as $$
declare b public.revenue_service_bindings;s public.contract_specified_services;p public.revenue_policy_versions;unit jsonb;seen text[]:='{}';total numeric:=0;begin
 select * into strict b from public.revenue_service_bindings where id=target and workspace_id=public.revenue_workspace_id();
 select * into strict s from public.contract_specified_services where id=b.specified_service_id;
 select * into strict p from public.revenue_policy_versions where id=b.policy_version_id;
 if p.status<>'APPROVED' or p.test_only or p.currency<>s.currency or current_date<p.effective_from or (p.effective_to is not null and current_date>p.effective_to) then raise exception 'revenue_policy_not_applicable';end if;
 if not ((b.principal_agent_role='PRINCIPAL' and b.presentation='GROSS') or (b.principal_agent_role='AGENT' and b.presentation='NET')) or b.presentation<>p.presentation then raise exception 'revenue_assessment_required';end if;
 if length(trim(b.assessment_basis_reference))=0 or b.refund_contract_version_id<>s.contract_version_id or (b.has_variance and nullif(trim(b.variance_review_reference),'') is null) then raise exception 'revenue_variance_or_basis_required';end if;
 if b.amount_basis_snapshot->>'currency' is distinct from s.currency or b.amount_basis_snapshot->>'strategy' is distinct from p.amount_strategy then raise exception 'revenue_amount_basis_invalid';end if;
 total:=public.revenue_decimal(b.amount_basis_snapshot->'amount');
 if total>s.accepted_amount or (p.amount_strategy='ACCEPTED_SERVICE_CONSIDERATION' and total<>s.accepted_amount) or (p.amount_strategy='APPROVED_AGENT_FEE' and (b.agent_fee is null or b.agent_fee<>total or b.principal_agent_role<>'AGENT')) or (p.amount_strategy='APPROVED_ALLOCATED_CONSIDERATION' and nullif(trim(b.allocation_decision_reference),'') is null) then raise exception 'revenue_allocation_required';end if;
 if jsonb_typeof(b.recognition_unit_schedule) is distinct from 'array' or jsonb_array_length(b.recognition_unit_schedule) not between 1 and 120 then raise exception 'revenue_units_invalid';end if;
 if p.recognition_strategy='POINT_IN_TIME_ON_APPROVED_EVIDENCE' and jsonb_array_length(b.recognition_unit_schedule)<>1 then raise exception 'revenue_units_invalid';end if;
 total:=0;
 for unit in select value from jsonb_array_elements(b.recognition_unit_schedule) loop
  if jsonb_typeof(unit) is distinct from 'object' or exists(select 1 from jsonb_object_keys(unit) k where k not in ('key','units','from','to')) or unit->>'key' is null or unit->>'key' !~ '^[A-Z0-9_-]{1,80}$' or unit->>'key'=any(seen) then raise exception 'revenue_units_invalid';end if;
  seen:=array_append(seen,unit->>'key');if public.revenue_decimal(unit->'units',true)<=0 then raise exception 'revenue_units_invalid';end if;
  if p.recognition_strategy='OVER_TIME_BY_VERIFIED_UNITS' and (unit->>'from' is null or unit->>'to' is null) then raise exception 'revenue_units_invalid';end if;
  if (unit->>'from' is null)<>(unit->>'to' is null) or (unit->>'from' is not null and ((unit->>'from') !~ '^\d{4}-\d{2}-\d{2}$' or (unit->>'to') !~ '^\d{4}-\d{2}-\d{2}$' or (unit->>'from')::date>(unit->>'to')::date)) then raise exception 'revenue_units_invalid';end if;
 end loop;
 if exists(select 1 from jsonb_array_elements(b.recognition_unit_schedule) with ordinality a(u,n) join jsonb_array_elements(b.recognition_unit_schedule) with ordinality c(u,n) on a.n<c.n where a.u->>'from' is not null and c.u->>'from' is not null and daterange((a.u->>'from')::date,(a.u->>'to')::date,'[]') && daterange((c.u->>'from')::date,(c.u->>'to')::date,'[]')) then raise exception 'revenue_units_overlap';end if;
end $$;

create function public.revenue_foundation_command(entity uuid,command text,target uuid,expected_revision integer,data jsonb,request_key text) returns jsonb
language plpgsql security definer set search_path=public,app_auth,extensions as $$
declare ws uuid:=public.revenue_workspace_id();actor uuid:=app_auth.current_user_id();result jsonb;payload jsonb:=jsonb_build_object('entity',entity,'command',command,'target',target,'revision',expected_revision,'data',data);
 p public.revenue_policy_versions;b public.revenue_service_bindings;s public.contract_specified_services;previous public.contract_specified_services;
 cv public.contract_versions;qv public.quote_versions;c public.contracts;profile public.revenue_reporting_profiles;period public.revenue_accounting_periods;assignment public.revenue_authority_assignments;
 amount numeric(14,2);quantity numeric(18,6);snapshot jsonb;next_version integer;kind text;approval public.approval_requests;
begin
 perform public.revenue_require(entity,case when command in ('PERIOD_CLOSE','AUTHORITY_REVOKE','PROFILE_RETIRE') then 'POLICY_APPROVER' else 'POLICY_OWNER' end);
 select * into strict profile from public.revenue_reporting_profiles where workspace_id=ws and reporting_entity_id=entity;
 if jsonb_typeof(data) is distinct from 'object' or target is null then raise exception 'revenue_input_invalid';end if;
 result:=public.commission_receipt(request_key,'REVENUE_'||command,payload);if result is not null then return result;end if;
 if profile.status<>'ACTIVE' and command not in ('PROFILE_SUBMIT') then raise exception 'revenue_profile_inactive';end if;
 if command='POLICY_CREATE' then
  if expected_revision is not null or exists(select 1 from jsonb_object_keys(data) k where k not in ('policy_key','recognition_strategy','amount_strategy','presentation','fulfillment_rule_reference','refund_correction_reference','currency','effective_from','effective_to','test_only')) then raise exception 'revenue_input_invalid';end if;
  if not (data->>'currency'=any(profile.allowed_currencies)) then raise exception 'revenue_currency_invalid';end if;
  select coalesce(max(version),0)+1 into next_version from public.revenue_policy_versions where workspace_id=ws and policy_key=data->>'policy_key';
  insert into public.revenue_policy_versions(id,workspace_id,reporting_entity_id,policy_key,version,recognition_strategy,amount_strategy,presentation,fulfillment_rule_reference,refund_correction_reference,currency,effective_from,effective_to,test_only,created_by)
  values(target,ws,entity,data->>'policy_key',next_version,data->>'recognition_strategy',data->>'amount_strategy',data->>'presentation',data->>'fulfillment_rule_reference',data->>'refund_correction_reference',data->>'currency',(data->>'effective_from')::date,(data->>'effective_to')::date,coalesce((data->>'test_only')::boolean,false),actor) returning to_jsonb(revenue_policy_versions.*) into result;
 elsif command='CONTRACT_ACCEPT' then
  select * into cv from public.contract_versions where workspace_id=ws and id=target for update;
  if not found or cv.version is distinct from expected_revision then raise exception 'revenue_version_conflict';end if;
  select * into strict c from public.contracts where workspace_id=ws and id=cv.contract_id for update;
  if not public.can_access_owned_record(ws,'CONTRACT',c.id,c.owner_id,true) or c.archived_at is not null then raise exception 'revenue_source_forbidden';end if;
  if cv.commercial_accepted_at is not null or nullif(trim(data->>'reference'),'') is null then raise exception 'revenue_acceptance_invalid';end if;
  if c.quote_id is not null then
   select * into qv from public.quote_versions where workspace_id=ws and quote_id=c.quote_id and id=(data->>'quote_version_id')::uuid;
   if not found or qv.id::text is distinct from cv.snapshot->>'source_quote_version_id' or qv.total_amount<>(cv.snapshot->>'contract_value')::numeric then raise exception 'revenue_quote_provenance_invalid';end if;
  elsif data->>'quote_version_id' is not null then raise exception 'revenue_quote_provenance_invalid';end if;
  update public.contract_versions set commercial_accepted_at=clock_timestamp(),commercial_accepted_by=actor,commercial_acceptance_reference=data->>'reference',accepted_quote_id=c.quote_id,accepted_quote_version_id=qv.id,accepted_quote_snapshot=case when qv.id is not null then to_jsonb(qv) else null end where id=target returning to_jsonb(contract_versions.*) into result;
 elsif command='SERVICE_CREATE' then
  if expected_revision is not null then raise exception 'revenue_version_conflict';end if;
  select * into cv from public.contract_versions where workspace_id=ws and id=(data->>'contract_version_id')::uuid for update;
  if not found or cv.commercial_accepted_at is null or cv.contract_id<>(data->>'contract_id')::uuid then raise exception 'revenue_accepted_version_required';end if;
  select * into strict c from public.contracts where workspace_id=ws and id=cv.contract_id;
  if not public.can_access_owned_record(ws,'CONTRACT',c.id,c.owner_id,true) or c.archived_at is not null then raise exception 'revenue_source_forbidden';end if;
  amount:=public.revenue_decimal(data->'accepted_amount');quantity:=public.revenue_decimal(data->'accepted_quantity',true);
  if data->>'currency' is distinct from cv.snapshot->>'currency' or not (data->>'currency'=any(profile.allowed_currencies)) or amount+(select coalesce(sum(accepted_amount),0) from public.contract_specified_services where workspace_id=ws and contract_version_id=cv.id)>(cv.snapshot->>'contract_value')::numeric then raise exception 'revenue_amount_exceeds_contract';end if;
  if exists(select 1 from public.contract_specified_services where contract_id=cv.contract_id and reporting_entity_id<>entity) then raise exception 'revenue_contract_entity_conflict';end if;
  if data->>'supersedes_service_id' is not null then
   select * into previous from public.contract_specified_services where workspace_id=ws and reporting_entity_id=entity and id=(data->>'supersedes_service_id')::uuid;
   if not found or previous.contract_id<>cv.contract_id or previous.stable_service_key is distinct from data->>'stable_service_key' or previous.contract_version_id=cv.id or (select version from public.contract_versions where id=previous.contract_version_id)>=cv.version then raise exception 'revenue_amendment_invalid';end if;
  elsif exists(select 1 from public.contract_specified_services where workspace_id=ws and contract_id=cv.contract_id and stable_service_key=data->>'stable_service_key') then raise exception 'revenue_amendment_predecessor_required';end if;
  if cv.accepted_quote_version_id is not null then
   if coalesce(data->>'source_quote_line_reference','') !~ '^LINE_[1-9][0-9]{0,3}$' then raise exception 'revenue_quote_line_required';end if;
   if (substring(data->>'source_quote_line_reference' from 6))::integer>jsonb_array_length(cv.accepted_quote_snapshot->'line_items') then raise exception 'revenue_quote_line_required';end if;
  end if;
  snapshot:=jsonb_build_object('contract_version_id',cv.id,'quote_id',cv.accepted_quote_id,'quote_version_id',cv.accepted_quote_version_id,'quote_snapshot',cv.accepted_quote_snapshot,'line_reference',data->>'source_quote_line_reference','amount',amount::text,'quantity',quantity::text,'currency',data->>'currency','source',data->>'accepted_price_source','reference',data->>'accepted_price_reference');
  insert into public.contract_specified_services(id,workspace_id,reporting_entity_id,contract_id,contract_version_id,stable_service_key,supersedes_service_id,source_quote_id,source_quote_version_id,source_quote_line_reference,product_id,cohort_id,service_classification,description_snapshot,accepted_quantity,accepted_amount,currency,accepted_price_source,accepted_price_reference,accepted_price_snapshot,accepted_price_snapshot_digest,created_by)
  values(target,ws,entity,cv.contract_id,cv.id,data->>'stable_service_key',previous.id,cv.accepted_quote_id,cv.accepted_quote_version_id,data->>'source_quote_line_reference',(data->>'product_id')::uuid,(data->>'cohort_id')::uuid,data->>'service_classification',data->>'description_snapshot',quantity,amount,data->>'currency',data->>'accepted_price_source',data->>'accepted_price_reference',snapshot,public.revenue_digest(snapshot),actor) returning to_jsonb(contract_specified_services.*) into result;
 elsif command='BINDING_CREATE' then
  if expected_revision is not null then raise exception 'revenue_version_conflict';end if;
  select * into s from public.contract_specified_services where workspace_id=ws and reporting_entity_id=entity and id=(data->>'specified_service_id')::uuid;
  if not found then raise exception 'revenue_service_not_found';end if;
  select * into p from public.revenue_policy_versions where workspace_id=ws and reporting_entity_id=entity and id=(data->>'policy_version_id')::uuid;
  if not found or p.status<>'APPROVED' or p.test_only then raise exception 'revenue_policy_not_applicable';end if;
  select * into b from public.revenue_service_bindings where specified_service_id=s.id order by version desc limit 1;
  if b.id is distinct from (data->>'predecessor_id')::uuid then raise exception 'revenue_binding_predecessor_required';end if;
  amount:=public.revenue_decimal(data->'amount');
  if jsonb_typeof(data->'assessment_sources') is distinct from 'array' or jsonb_array_length(data->'assessment_sources') not between 1 and 30 or exists(select 1 from jsonb_array_elements(data->'assessment_sources') v where jsonb_typeof(v) is distinct from 'string' or length(v#>>'{}') not between 1 and 160) then raise exception 'revenue_assessment_invalid';end if;
  snapshot:=jsonb_build_object('amount',amount::text,'currency',s.currency,'strategy',p.amount_strategy,'service_price_digest',s.accepted_price_snapshot_digest);
  insert into public.revenue_service_bindings(id,workspace_id,reporting_entity_id,specified_service_id,policy_version_id,version,predecessor_id,principal_agent_role,assessment_basis_reference,assessment_sources,assessment_source_digest,presentation,amount_basis_snapshot,allocation_decision_reference,agent_fee,refund_contract_version_id,scenario_reference,reference_fallback,has_variance,variance_review_reference,recognition_unit_schedule,created_by)
  values(target,ws,entity,s.id,p.id,coalesce(b.version,0)+1,b.id,data->>'principal_agent_role',data->>'assessment_basis_reference',data->'assessment_sources',public.revenue_digest(jsonb_build_object('service_digest',s.accepted_price_snapshot_digest,'sources',data->'assessment_sources')),data->>'presentation',snapshot,data->>'allocation_decision_reference',case when data->>'agent_fee' is not null then public.revenue_decimal(data->'agent_fee') else null end,s.contract_version_id,data->>'scenario_reference',data->>'reference_fallback',coalesce((data->>'has_variance')::boolean,false),data->>'variance_review_reference',data->'recognition_unit_schedule',actor) returning to_jsonb(revenue_service_bindings.*) into result;
  perform public.revenue_validate_binding(target);
 elsif command in ('POLICY_SUBMIT','BINDING_SUBMIT','PROFILE_SUBMIT') then
  if command='POLICY_SUBMIT' then
   select * into p from public.revenue_policy_versions where workspace_id=ws and reporting_entity_id=entity and id=target for update;
   if not found or p.status<>'DRAFT' or p.revision is distinct from expected_revision or p.created_by<>actor or p.test_only then raise exception 'revenue_review_invalid';end if;
   update public.revenue_policy_versions set status='IN_REVIEW',revision=revision+1 where id=target returning to_jsonb(revenue_policy_versions.*) into result;kind:='REVENUE_POLICY_VERSION';
  elsif command='BINDING_SUBMIT' then
   select * into b from public.revenue_service_bindings where workspace_id=ws and reporting_entity_id=entity and id=target for update;
   if not found or b.status<>'DRAFT' or b.revision is distinct from expected_revision or b.created_by<>actor then raise exception 'revenue_review_invalid';end if;
   perform public.revenue_validate_binding(target);
   update public.revenue_service_bindings set status='IN_REVIEW',revision=revision+1 where id=target returning to_jsonb(revenue_service_bindings.*) into result;kind:='REVENUE_SERVICE_BINDING';
  else
   if profile.id<>target or profile.status<>'DRAFT' or profile.revision is distinct from expected_revision or profile.created_by<>actor then raise exception 'revenue_review_invalid';end if;
   update public.revenue_reporting_profiles set status='IN_REVIEW',revision=revision+1 where id=target returning to_jsonb(revenue_reporting_profiles.*) into result;kind:='REVENUE_REPORTING_PROFILE';
  end if;
  insert into public.approval_requests(workspace_id,request_number,request_type,business_object_type,business_object_id,requester_id,reason,expires_at,request_payload)
  values(ws,'REV-'||gen_random_uuid(),kind,kind,target::text,actor,'Revenue foundation review',now()+interval '7 days',jsonb_build_object('entity',entity,'revision',result->'revision','digest',public.revenue_digest(result-'approval_reference'))) returning * into approval;
  if command='POLICY_SUBMIT' then update public.revenue_policy_versions set approval_reference=approval.id where id=target;
  elsif command='BINDING_SUBMIT' then update public.revenue_service_bindings set approval_reference=approval.id where id=target;
  else update public.revenue_reporting_profiles set approval_reference=approval.id where id=target;end if;
  insert into public.approval_actions(approval_request_id,actor_id,action) values(approval.id,actor,'SUBMITTED');result:=result||jsonb_build_object('approval_reference',approval.id);
 elsif command='PERIOD_CREATE' then
  if expected_revision is not null or (data->>'start_on')::date>(data->>'end_on')::date then raise exception 'revenue_period_invalid';end if;
  if exists(select 1 from public.revenue_accounting_periods where workspace_id=ws and reporting_entity_id=entity and daterange(start_on,end_on,'[]') && daterange((data->>'start_on')::date,(data->>'end_on')::date,'[]')) then raise exception 'revenue_period_overlap';end if;
  insert into public.revenue_accounting_periods(id,workspace_id,reporting_entity_id,period_key,start_on,end_on,created_by) values(target,ws,entity,data->>'period_key',(data->>'start_on')::date,(data->>'end_on')::date,actor) returning to_jsonb(revenue_accounting_periods.*) into result;
 elsif command='PERIOD_CLOSE' then
  select * into period from public.revenue_accounting_periods where workspace_id=ws and reporting_entity_id=entity and id=target for update;
  if not found or period.status<>'OPEN' or period.revision is distinct from expected_revision or nullif(trim(data->>'reference'),'') is null then raise exception 'revenue_version_conflict';end if;
  update public.revenue_accounting_periods set status='CLOSED',closed_by=actor,closed_at=clock_timestamp(),close_reference=data->>'reference',revision=revision+1 where id=target returning to_jsonb(revenue_accounting_periods.*) into result;
 elsif command='AUTHORITY_ASSIGN' then
  if expected_revision is not null or not exists(select 1 from public.workspace_memberships where workspace_id=ws and user_id=(data->>'user_id')::uuid and role in ('ADMIN','SUPER_ADMIN')) then raise exception 'revenue_membership_required';end if;
  insert into public.revenue_authority_assignments(id,workspace_id,reporting_entity_id,user_id,authority,effective_from,effective_to,authority_reference,assigned_by,status)
  values(target,ws,entity,(data->>'user_id')::uuid,data->>'authority',(data->>'effective_from')::timestamptz,(data->>'effective_to')::timestamptz,data->>'reference',actor,'IN_REVIEW') returning to_jsonb(revenue_authority_assignments.*) into result;
  insert into public.approval_requests(workspace_id,request_number,request_type,business_object_type,business_object_id,requester_id,reason,expires_at,request_payload)
  values(ws,'REV-'||gen_random_uuid(),'REVENUE_AUTHORITY_ASSIGNMENT','REVENUE_AUTHORITY_ASSIGNMENT',target::text,actor,'Revenue authority review',now()+interval '7 days',jsonb_build_object('entity',entity,'revision',result->'revision','digest',public.revenue_digest(result-'approval_reference'))) returning * into approval;
  update public.revenue_authority_assignments set approval_reference=approval.id where id=target;
  insert into public.approval_actions(approval_request_id,actor_id,action) values(approval.id,actor,'SUBMITTED');result:=result||jsonb_build_object('approval_reference',approval.id);
 elsif command='AUTHORITY_REVOKE' then
  select * into assignment from public.revenue_authority_assignments where workspace_id=ws and reporting_entity_id=entity and id=target for update;
  if not found or assignment.revoked_at is not null or assignment.revision is distinct from expected_revision or assignment.user_id=actor or nullif(trim(data->>'reference'),'') is null then raise exception 'revenue_authority_change_invalid';end if;
  update public.revenue_authority_assignments set status='REVOKED',revoked_at=clock_timestamp(),revision=revision+1,authority_reference=data->>'reference' where id=target returning to_jsonb(revenue_authority_assignments.*) into result;
 elsif command='POLICY_RETIRE' then
  update public.revenue_policy_versions set status='RETIRED',revision=revision+1 where workspace_id=ws and reporting_entity_id=entity and id=target and status='APPROVED' and revision=expected_revision returning to_jsonb(revenue_policy_versions.*) into result;
  if result is null then raise exception 'revenue_version_conflict';end if;
 elsif command='PROFILE_RETIRE' then
  update public.revenue_reporting_profiles set status='RETIRED',revision=revision+1 where workspace_id=ws and reporting_entity_id=entity and id=target and status='ACTIVE' and revision=expected_revision returning to_jsonb(revenue_reporting_profiles.*) into result;
  if result is null then raise exception 'revenue_version_conflict';end if;
 else raise exception 'revenue_command_invalid';end if;
 perform public.revenue_audit('REVENUE_'||command,target,jsonb_build_object('entity',entity,'revision',result->'revision'));
 -- Never serialize money/quantity as JavaScript numbers across the RPC boundary.
 if result ? 'accepted_amount' then result:=result||jsonb_build_object('accepted_amount',(result->>'accepted_amount')::numeric(14,2)::text,'accepted_quantity',(result->>'accepted_quantity')::numeric(18,6)::text);end if;
 if result->>'agent_fee' is not null then result:=result||jsonb_build_object('agent_fee',(result->>'agent_fee')::numeric(14,2)::text);end if;
 result:=result-array['snapshot','accepted_quote_snapshot','accepted_price_snapshot'];
 return public.commission_finish(request_key,'REVENUE_'||command,payload,result);
end $$;

do $security$ declare relation text;f record;begin
 foreach relation in array array['revenue_reporting_profiles','revenue_authority_assignments','revenue_accounting_periods','revenue_policy_versions','contract_specified_services','revenue_service_bindings'] loop
  execute format('alter table public.%I enable row level security',relation);
  execute format('revoke all on public.%I from public,crm_app,crm_system,crm_worker',relation);
  execute format('grant select on public.%I to crm_app',relation);
  execute format('create policy revenue_designated_read on public.%I for select to crm_app using(workspace_id=public.revenue_workspace_id() and (public.revenue_has_authority(reporting_entity_id,''POLICY_OWNER'') or public.revenue_has_authority(reporting_entity_id,''POLICY_APPROVER'')))',relation);
  execute format('create trigger revenue_immutable before update or delete on public.%I for each row execute function public.guard_revenue_foundation_row()',relation);
 end loop;
  for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and (p.proname like 'revenue_%' or p.proname in ('provision_revenue_profile','decide_revenue_approval','guard_revenue_approval','guard_revenue_foundation_row','guard_revenue_contract_version','pin_contract_quote_version')) loop
  execute format('revoke all on function %s from public,crm_app,crm_system,crm_worker',f.signature);
 end loop;
end $security$;
grant execute on function public.revenue_workspace_id(),public.revenue_has_authority(uuid,text),public.revenue_foundation_command(uuid,text,uuid,integer,jsonb,text),public.decide_revenue_approval(uuid,integer,text,text,text) to crm_app;
grant execute on function public.provision_revenue_profile(uuid,uuid,uuid,jsonb,text) to crm_migrator;
