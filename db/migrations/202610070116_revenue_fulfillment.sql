-- R5B: minimal evidence lineage; no recognition or money owner.
set search_path=public,app_auth,extensions;
alter table public.revenue_authority_assignments drop constraint revenue_authority_assignments_authority_check;
alter table public.revenue_authority_assignments add constraint revenue_authority_assignments_authority_check check(authority in ('POLICY_OWNER','POLICY_APPROVER','POSTING_AUTHORITY','EVIDENCE_VERIFIER'));
alter table public.revenue_service_bindings add column fulfillment_requirements jsonb not null default '{}';
alter table public.revenue_service_bindings add constraint revenue_binding_service_scope unique(workspace_id,reporting_entity_id,specified_service_id,id);

create table public.revenue_fulfillment_attestations (
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null,reporting_entity_id uuid not null,
 specified_service_id uuid not null,binding_id uuid not null,policy_version_id uuid not null,
 recognition_unit_key text not null,evidence_type text not null check(evidence_type in ('SERVICE_DELIVERY','DELIVERABLE','COVERAGE','MILESTONE')),
 source_domain text not null check(source_domain in ('CRM_ACTIVITY','STUDENT_ENROLLMENT')),source_id uuid not null,
 source_version text,source_hash text not null check(source_hash~'^[0-9a-f]{64}$'),
 business_date date not null,coverage_from date,coverage_to date,verified_units numeric(18,6) not null check(verified_units>0),
 requirement_digest text not null,basis_digest text not null,attested_by uuid not null references app_auth.accounts(id),
 verified_by uuid references app_auth.accounts(id),verified_at timestamptz,verification_reference text,
 supersedes_attestation_id uuid,status text not null default 'DRAFT' check(status in ('DRAFT','IN_REVIEW','ACCEPTED','REJECTED','WITHDRAWN')),
 revision integer not null default 1,created_at timestamptz not null default clock_timestamp(),
 withdrawn_by uuid references app_auth.accounts(id),withdrawn_at timestamptz,withdrawal_reference text,
 unique(workspace_id,id),unique(workspace_id,reporting_entity_id,id),
 foreign key(workspace_id,reporting_entity_id,specified_service_id,binding_id) references public.revenue_service_bindings(workspace_id,reporting_entity_id,specified_service_id,id),
 foreign key(workspace_id,reporting_entity_id,policy_version_id) references public.revenue_policy_versions(workspace_id,reporting_entity_id,id),
 foreign key(workspace_id,reporting_entity_id,supersedes_attestation_id) references public.revenue_fulfillment_attestations(workspace_id,reporting_entity_id,id),
 check((coverage_from is null and coverage_to is null) or (coverage_from is not null and coverage_to is not null and coverage_from<=coverage_to)),
 check(status not in ('ACCEPTED','REJECTED','WITHDRAWN') or (verified_by is not null and verified_by<>attested_by and verified_at is not null and length(trim(verification_reference))>0)),
 check(status<>'WITHDRAWN' or (withdrawn_by is not null and withdrawn_at is not null and length(trim(withdrawal_reference))>0))
);
create index revenue_attestation_unit on public.revenue_fulfillment_attestations(workspace_id,reporting_entity_id,recognition_unit_key,status);

-- Explicit resolver branches; only a hash leaves the source payload boundary.
create function public.revenue_resolve_evidence(service_id uuid,domain text,source uuid) returns jsonb
language plpgsql security definer set search_path=public,app_auth,extensions as $$
declare s public.contract_specified_services;c public.contracts;a public.crm_activities;e public.student_enrollments;tz text;day date;version text;payload jsonb;link_basis jsonb;begin
 perform set_config('TimeZone','UTC',true);
 select * into s from public.contract_specified_services where id=service_id and workspace_id=public.revenue_workspace_id();
 if not found then raise exception 'revenue_source_unavailable';end if;
 select * into c from public.contracts where workspace_id=s.workspace_id and id=s.contract_id and archived_at is null for share;
 if not found or not public.can_access_owned_record(s.workspace_id,'CONTRACT',c.id,c.owner_id,false) then raise exception 'revenue_source_unavailable';end if;
 select business_timezone into strict tz from public.revenue_reporting_profiles where workspace_id=s.workspace_id and reporting_entity_id=s.reporting_entity_id;
 if domain='CRM_ACTIVITY' then
  select * into a from public.crm_activities where workspace_id=s.workspace_id and id=source for share;
  if not found or a.archived_at is not null or c.organization_id is null or a.organization_id is distinct from c.organization_id or not public.customer_subject_access('ORGANIZATION',a.organization_id,false) then raise exception 'revenue_source_unavailable';end if;
  day:=(a.occurred_at at time zone tz)::date;version:=null;payload:=to_jsonb(a);
  return jsonb_build_object('version',version,'hash',public.revenue_digest(payload),'business_date',day,'condition',a.activity_type);
 elsif domain='STUDENT_ENROLLMENT' then
  select * into e from public.student_enrollments where workspace_id=s.workspace_id and id=source for share;
  if not found or e.archived_at is not null or not public.student_enrollment_access(to_jsonb(e),false) or (s.cohort_id is not null and e.cohort_id<>s.cohort_id) then raise exception 'revenue_source_unavailable';end if;
  select jsonb_build_object('id',l.id,'revision',l.revision) into link_basis from public.contract_enrollment_links l where l.workspace_id=s.workspace_id and l.contract_id=s.contract_id and l.enrollment_id=e.id and l.status='ACTIVE' for share;
  if not found then raise exception 'revenue_source_unavailable';end if;
  day:=(e.completed_at at time zone tz)::date;version:=e.revision::text;payload:=jsonb_build_object('source',to_jsonb(e),'contract_link',link_basis);
  return jsonb_build_object('version',version,'hash',public.revenue_digest(payload),'business_date',day,'condition',e.status);
 else raise exception 'revenue_source_domain_unsupported';end if;
end $$;

create function public.revenue_set_fulfillment_requirements(entity uuid,target uuid,expected_revision integer,requirements jsonb,request_key text) returns jsonb
language plpgsql security definer set search_path=public,app_auth,extensions as $$
declare b public.revenue_service_bindings;entry record;r jsonb;src text;resolved jsonb;payload jsonb:=jsonb_build_object('entity',entity,'target',target,'revision',expected_revision,'requirements',requirements);result jsonb;begin
 perform public.revenue_require(entity,'POLICY_OWNER');
 if not public.revenue_has_authority(entity,'POLICY_OWNER') then raise exception 'revenue_authority_required';end if;
 result:=public.commission_receipt(request_key,'REVENUE_EVIDENCE_REQUIREMENTS',payload);if result is not null then return result;end if;
 if not exists(select 1 from public.revenue_reporting_profiles where workspace_id=public.revenue_workspace_id() and reporting_entity_id=entity and status='ACTIVE') then raise exception 'revenue_profile_inactive';end if;
 select * into b from public.revenue_service_bindings where workspace_id=public.revenue_workspace_id() and reporting_entity_id=entity and id=target for update;
 if not found or b.status<>'DRAFT' or b.created_by<>app_auth.current_user_id() or b.revision is distinct from expected_revision then raise exception 'revenue_version_conflict';end if;
 if jsonb_typeof(requirements) is distinct from 'object' or requirements='{}' then raise exception 'revenue_evidence_rule_required';end if;
 for entry in select * from jsonb_each(requirements) loop
  r:=entry.value;
  if not exists(select 1 from jsonb_array_elements(b.recognition_unit_schedule) u where u->>'key'=entry.key) or jsonb_typeof(r) is distinct from 'object' or exists(select 1 from jsonb_object_keys(r) k where k not in ('source_domain','source_ids','evidence_type','condition','date_basis')) then raise exception 'revenue_evidence_rule_invalid';end if;
  if coalesce(r->>'evidence_type','') not in ('SERVICE_DELIVERY','DELIVERABLE','COVERAGE','MILESTONE') or jsonb_typeof(r->'source_ids') is distinct from 'array' or jsonb_array_length(r->'source_ids') not between 1 and 50 then raise exception 'revenue_evidence_rule_invalid';end if;
  if not coalesce(((r->>'source_domain'='CRM_ACTIVITY' and r->>'condition' in ('MEETING','CALL','NOTE') and r->>'date_basis'='OCCURRED_ON') or (r->>'source_domain'='STUDENT_ENROLLMENT' and r->>'condition'='COMPLETED' and r->>'date_basis'='COMPLETED_ON')),false) then raise exception 'revenue_evidence_rule_invalid';end if;
  for src in select jsonb_array_elements_text(r->'source_ids') loop resolved:=public.revenue_resolve_evidence(b.specified_service_id,r->>'source_domain',src::uuid);end loop;
 end loop;
 update public.revenue_service_bindings set fulfillment_requirements=requirements,revision=revision+1 where id=target returning jsonb_build_object('id',id,'revision',revision) into result;
 perform public.revenue_audit('REVENUE_EVIDENCE_REQUIREMENTS',target,jsonb_build_object('digest',public.revenue_digest(requirements)));
 return public.commission_finish(request_key,'REVENUE_EVIDENCE_REQUIREMENTS',payload,result);
end $$;

-- Guard extension is intentionally narrow: only new DRAFT requirement content.
create or replace function public.guard_revenue_foundation_row() returns trigger language plpgsql set search_path=public,app_auth as $$
declare frozen boolean;begin
 if tg_op='DELETE' then raise exception 'revenue_retention_required';end if;
 if tg_table_name='revenue_service_bindings' then
  if old.status='DRAFT' and new.status='DRAFT' and new.revision=old.revision+1 and
  (to_jsonb(new)-array['fulfillment_requirements','revision'])=(to_jsonb(old)-array['fulfillment_requirements','revision']) then return new;end if;
 end if;
 if tg_table_name='contract_specified_services' then raise exception 'revenue_service_immutable';end if;
 frozen:=tg_table_name in ('revenue_policy_versions','revenue_service_bindings','revenue_reporting_profiles');
 if frozen and (to_jsonb(new)-array['status','revision','approval_reference','approved_by','approved_at','reviewed_by']) is distinct from (to_jsonb(old)-array['status','revision','approval_reference','approved_by','approved_at','reviewed_by']) then raise exception 'revenue_version_immutable';end if;
 if tg_table_name='revenue_authority_assignments' and (to_jsonb(new)-array['revoked_at','revision','authority_reference','status','approval_reference']) is distinct from (to_jsonb(old)-array['revoked_at','revision','authority_reference','status','approval_reference']) then raise exception 'revenue_authority_immutable';end if;
 if tg_table_name='revenue_accounting_periods' and (old.status='CLOSED' or (to_jsonb(new)-array['status','revision','closed_by','closed_at','close_reference']) is distinct from (to_jsonb(old)-array['status','revision','closed_by','closed_at','close_reference'])) then raise exception 'revenue_period_immutable';end if;
 return new;end $$;

create function public.revenue_check_attestation(item public.revenue_fulfillment_attestations,accepting boolean default false) returns void
language plpgsql security definer set search_path=public,app_auth,extensions as $$
declare s public.contract_specified_services;b public.revenue_service_bindings;p public.revenue_policy_versions;r jsonb;unit jsonb;resolved jsonb;ceiling numeric;used numeric;cv public.contract_versions;begin
 select * into strict s from public.contract_specified_services where workspace_id=item.workspace_id and reporting_entity_id=item.reporting_entity_id and id=item.specified_service_id;
 select * into b from public.revenue_service_bindings where workspace_id=item.workspace_id and reporting_entity_id=item.reporting_entity_id and specified_service_id=s.id and id=item.binding_id;
 if not found or b.status<>'APPROVED' then raise exception 'revenue_binding_not_approved';end if;
 select * into strict p from public.revenue_policy_versions where id=b.policy_version_id;
 if p.test_only or p.status not in ('APPROVED','RETIRED') or item.policy_version_id<>p.id or item.business_date<p.effective_from or (p.effective_to is not null and item.business_date>p.effective_to) then raise exception 'revenue_policy_not_applicable';end if;
 if not exists(select 1 from public.revenue_reporting_profiles where workspace_id=item.workspace_id and reporting_entity_id=item.reporting_entity_id and status='ACTIVE') then raise exception 'revenue_profile_inactive';end if;
 if exists(select 1 from public.contract_specified_services next join public.revenue_service_bindings nb on nb.specified_service_id=next.id and nb.status='APPROVED' where next.workspace_id=s.workspace_id and next.contract_id=s.contract_id and next.stable_service_key=s.stable_service_key and next.created_at>s.created_at) then raise exception 'revenue_service_superseded';end if;
 select value into unit from jsonb_array_elements(b.recognition_unit_schedule) where value->>'key'=item.recognition_unit_key;
 r:=b.fulfillment_requirements->item.recognition_unit_key;
 if unit is null or r is null then raise exception 'revenue_evidence_rule_required';end if;
 if r->>'source_domain' is distinct from item.source_domain or r->>'evidence_type' is distinct from item.evidence_type or not (r->'source_ids' ? item.source_id::text) then raise exception 'revenue_evidence_rule_invalid';end if;
 if public.revenue_digest(jsonb_build_object('rule',r,'unit',unit,'binding',b.id,'policy',p.id))<>item.requirement_digest then raise exception 'revenue_stale_basis';end if;
 resolved:=public.revenue_resolve_evidence(s.id,item.source_domain,item.source_id);
 if resolved->>'hash' is distinct from item.source_hash or resolved->>'version' is distinct from item.source_version then raise exception 'revenue_source_changed';end if;
 if resolved->>'condition' is distinct from r->>'condition' or resolved->>'business_date' is null or (resolved->>'business_date')::date<>item.business_date then raise exception 'revenue_evidence_meaning_invalid';end if;
 select * into strict cv from public.contract_versions where id=s.contract_version_id;
 if item.business_date<(cv.snapshot->>'start_date')::date or item.business_date>(cv.snapshot->>'end_date')::date or not exists(select 1 from public.revenue_accounting_periods where workspace_id=item.workspace_id and reporting_entity_id=item.reporting_entity_id and item.business_date between start_on and end_on) then raise exception 'revenue_business_date_invalid';end if;
 ceiling:=public.revenue_decimal(unit->'units',true);
 if p.recognition_strategy='OVER_TIME_BY_VERIFIED_UNITS' then
  if item.coverage_from is null or item.coverage_to is null or item.coverage_from<(unit->>'from')::date or item.coverage_to>(unit->>'to')::date or item.business_date<item.coverage_to then raise exception 'revenue_coverage_invalid';end if;
 else
  if item.coverage_from is not null or item.coverage_to is not null or item.verified_units<>ceiling then raise exception 'revenue_units_invalid';end if;
 end if;
 if item.verified_units>ceiling then raise exception 'revenue_units_exceeded';end if;
 if accepting then
  -- Across binding versions AND Contract amendments: evidence IDs/dates cannot reset units.
  select coalesce(sum(a.verified_units),0) into used from public.revenue_fulfillment_attestations a join public.contract_specified_services x on x.id=a.specified_service_id
   where a.workspace_id=item.workspace_id and a.reporting_entity_id=item.reporting_entity_id and x.contract_id=s.contract_id and x.stable_service_key=s.stable_service_key and a.recognition_unit_key=item.recognition_unit_key and a.status='ACCEPTED' and a.id<>item.id;
  if used+item.verified_units>ceiling or (p.recognition_strategy<>'OVER_TIME_BY_VERIFIED_UNITS' and used>0) then raise exception 'revenue_unit_already_satisfied';end if;
  if item.coverage_from is not null and exists(select 1 from public.revenue_fulfillment_attestations a join public.contract_specified_services x on x.id=a.specified_service_id where a.workspace_id=item.workspace_id and a.reporting_entity_id=item.reporting_entity_id and x.contract_id=s.contract_id and x.stable_service_key=s.stable_service_key and a.recognition_unit_key=item.recognition_unit_key and a.status='ACCEPTED' and a.id<>item.id and daterange(a.coverage_from,a.coverage_to,'[]') && daterange(item.coverage_from,item.coverage_to,'[]')) then raise exception 'revenue_coverage_overlap';end if;
 end if;
end $$;

create function public.revenue_attestation_command(entity uuid,command text,target uuid,expected_revision integer,data jsonb,request_key text) returns jsonb
language plpgsql security definer set search_path=public,app_auth,extensions as $$
declare ws uuid:=public.revenue_workspace_id();actor uuid:=app_auth.current_user_id();authority text;item public.revenue_fulfillment_attestations;previous public.revenue_fulfillment_attestations;b public.revenue_service_bindings;resolved jsonb;rule jsonb;unit jsonb;payload jsonb:=jsonb_build_object('entity',entity,'command',command,'target',target,'revision',expected_revision,'data',data);result jsonb;begin
 authority:=case when command in ('ACCEPT','REJECT','WITHDRAW') then 'EVIDENCE_VERIFIER' else 'POLICY_OWNER' end;
 perform public.revenue_require(entity,authority);
 if not public.revenue_has_authority(entity,authority) then raise exception 'revenue_authority_required';end if;
 result:=public.commission_receipt(request_key,'REVENUE_ATTESTATION_'||command,payload);if result is not null then return result;end if;
 if not exists(select 1 from public.revenue_reporting_profiles where workspace_id=ws and reporting_entity_id=entity and status='ACTIVE') then raise exception 'revenue_profile_inactive';end if;
 if jsonb_typeof(data) is distinct from 'object' or target is null then raise exception 'revenue_input_invalid';end if;
 if command='CREATE' then
  if expected_revision is not null or exists(select 1 from jsonb_object_keys(data) k where k not in ('specified_service_id','binding_id','recognition_unit_key','evidence_type','source_domain','source_id','business_date','coverage_from','coverage_to','verified_units','supersedes_attestation_id')) then raise exception 'revenue_input_invalid';end if;
  select * into b from public.revenue_service_bindings where workspace_id=ws and reporting_entity_id=entity and id=(data->>'binding_id')::uuid and specified_service_id=(data->>'specified_service_id')::uuid;
  if not found or b.status<>'APPROVED' then raise exception 'revenue_binding_not_approved';end if;
  resolved:=public.revenue_resolve_evidence(b.specified_service_id,data->>'source_domain',(data->>'source_id')::uuid);
  rule:=b.fulfillment_requirements->(data->>'recognition_unit_key');select value into unit from jsonb_array_elements(b.recognition_unit_schedule) where value->>'key'=data->>'recognition_unit_key';
  item.id:=target;item.workspace_id:=ws;item.reporting_entity_id:=entity;item.specified_service_id:=b.specified_service_id;item.binding_id:=b.id;item.policy_version_id:=b.policy_version_id;
  item.recognition_unit_key:=data->>'recognition_unit_key';item.evidence_type:=data->>'evidence_type';item.source_domain:=data->>'source_domain';item.source_id:=(data->>'source_id')::uuid;item.source_version:=resolved->>'version';item.source_hash:=resolved->>'hash';
  if coalesce(data->>'business_date','') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'revenue_business_date_invalid';end if;
  if (data->>'coverage_from' is not null and data->>'coverage_from' !~ '^\d{4}-\d{2}-\d{2}$') or (data->>'coverage_to' is not null and data->>'coverage_to' !~ '^\d{4}-\d{2}-\d{2}$') then raise exception 'revenue_coverage_invalid';end if;
  item.business_date:=(data->>'business_date')::date;item.coverage_from:=(data->>'coverage_from')::date;item.coverage_to:=(data->>'coverage_to')::date;item.verified_units:=public.revenue_decimal(data->'verified_units',true);
  item.requirement_digest:=public.revenue_digest(jsonb_build_object('rule',rule,'unit',unit,'binding',b.id,'policy',b.policy_version_id));item.attested_by:=actor;item.status:='DRAFT';item.revision:=1;item.created_at:=clock_timestamp();item.supersedes_attestation_id:=(data->>'supersedes_attestation_id')::uuid;
  if item.supersedes_attestation_id is not null then
   select * into previous from public.revenue_fulfillment_attestations where workspace_id=ws and reporting_entity_id=entity and id=item.supersedes_attestation_id;
   if not found or previous.status not in ('WITHDRAWN','REJECTED') or previous.recognition_unit_key<>item.recognition_unit_key or previous.specified_service_id<>item.specified_service_id then raise exception 'revenue_replacement_invalid';end if;
  end if;
  item.basis_digest:=public.revenue_digest((to_jsonb(item)-array['created_at','status','revision','verified_by','verified_at','verification_reference','withdrawn_by','withdrawn_at','withdrawal_reference','basis_digest'])||jsonb_build_object('evaluator_version','R5B_1','binding_version',b.version,'verified_units',item.verified_units::text));
  perform public.revenue_check_attestation(item,false);
  insert into public.revenue_fulfillment_attestations select item.*;
 else
  select * into item from public.revenue_fulfillment_attestations where workspace_id=ws and reporting_entity_id=entity and id=target for update;
  if not found or item.revision is distinct from expected_revision then raise exception 'revenue_version_conflict';end if;
  if exists(select 1 from jsonb_object_keys(data) k where k<>'reference') then raise exception 'revenue_input_invalid';end if;
  if command='SUBMIT' then
   if item.status<>'DRAFT' or item.attested_by<>actor then raise exception 'revenue_review_invalid';end if;
   perform public.revenue_check_attestation(item,false);item.status:='IN_REVIEW';
  elsif command in ('ACCEPT','REJECT') then
   if item.status<>'IN_REVIEW' or actor=item.attested_by or nullif(trim(data->>'reference'),'') is null then raise exception 'revenue_review_invalid';end if;
   if not exists(select 1 from public.revenue_reporting_profiles where workspace_id=ws and reporting_entity_id=entity and status='ACTIVE') then raise exception 'revenue_profile_inactive';end if;
   if command='ACCEPT' then perform public.revenue_check_attestation(item,true);item.status:='ACCEPTED';else item.status:='REJECTED';end if;
   item.verified_by:=actor;item.verified_at:=clock_timestamp();item.verification_reference:=data->>'reference';
  elsif command='WITHDRAW' then
   if item.status<>'ACCEPTED' or nullif(trim(data->>'reference'),'') is null then raise exception 'revenue_review_invalid';end if;
   item.status:='WITHDRAWN';item.withdrawn_by:=actor;item.withdrawn_at:=clock_timestamp();item.withdrawal_reference:=data->>'reference';
  else raise exception 'revenue_command_invalid';end if;
  update public.revenue_fulfillment_attestations set status=item.status,revision=revision+1,verified_by=item.verified_by,verified_at=item.verified_at,verification_reference=item.verification_reference,withdrawn_by=item.withdrawn_by,withdrawn_at=item.withdrawn_at,withdrawal_reference=item.withdrawal_reference where id=target returning * into item;
 end if;
 perform public.revenue_audit('REVENUE_ATTESTATION_'||command,target,jsonb_build_object('revision',item.revision,'basis_digest',item.basis_digest,'supersedes',item.supersedes_attestation_id));
 result:=to_jsonb(item)||jsonb_build_object('verified_units',item.verified_units::text);
 return public.commission_finish(request_key,'REVENUE_ATTESTATION_'||command,payload,result);
end $$;

create function public.revenue_attestation_health(target uuid) returns text language plpgsql security definer set search_path=public,app_auth as $$
declare a public.revenue_fulfillment_attestations;r jsonb;begin
 select * into a from public.revenue_fulfillment_attestations where id=target and workspace_id=public.revenue_workspace_id();
 if not found or not (public.revenue_has_authority(a.reporting_entity_id,'POLICY_OWNER') or public.revenue_has_authority(a.reporting_entity_id,'EVIDENCE_VERIFIER')) then raise exception 'revenue_authority_required';end if;
 begin r:=public.revenue_resolve_evidence(a.specified_service_id,a.source_domain,a.source_id);
 exception when raise_exception then return 'SOURCE_UNAVAILABLE';end;
 if r->>'hash' is distinct from a.source_hash or r->>'version' is distinct from a.source_version then return 'SOURCE_CHANGED';end if;return 'CURRENT';end $$;

create function public.guard_revenue_attestation() returns trigger language plpgsql set search_path=public as $$begin
 if tg_op='DELETE' then raise exception 'revenue_retention_required';end if;
 if (to_jsonb(new)-array['status','revision','verified_by','verified_at','verification_reference','withdrawn_by','withdrawn_at','withdrawal_reference']) is distinct from (to_jsonb(old)-array['status','revision','verified_by','verified_at','verification_reference','withdrawn_by','withdrawn_at','withdrawal_reference']) then raise exception 'revenue_evidence_immutable';end if;return new;end $$;
create trigger revenue_evidence_retention before update or delete on public.revenue_fulfillment_attestations for each row execute function public.guard_revenue_attestation();
alter table public.revenue_fulfillment_attestations enable row level security;
revoke all on public.revenue_fulfillment_attestations from public,crm_app,crm_system,crm_worker;
grant select on public.revenue_fulfillment_attestations to crm_app;
create policy revenue_evidence_read on public.revenue_fulfillment_attestations for select to crm_app using(workspace_id=public.revenue_workspace_id() and (public.revenue_has_authority(reporting_entity_id,'POLICY_OWNER') or public.revenue_has_authority(reporting_entity_id,'EVIDENCE_VERIFIER')));
revoke all on function public.revenue_resolve_evidence(uuid,text,uuid),public.revenue_set_fulfillment_requirements(uuid,uuid,integer,jsonb,text),public.revenue_check_attestation(public.revenue_fulfillment_attestations,boolean),public.revenue_attestation_command(uuid,text,uuid,integer,jsonb,text),public.revenue_attestation_health(uuid),public.guard_revenue_attestation() from public,crm_app,crm_system,crm_worker;
grant execute on function public.revenue_set_fulfillment_requirements(uuid,uuid,integer,jsonb,text),public.revenue_attestation_command(uuid,text,uuid,integer,jsonb,text),public.revenue_attestation_health(uuid) to crm_app;
