-- R5F: bounded, designated, minimal read projections only. No financial owner or mutation.
set search_path=public,app_auth;

-- Operational cancellation/removal must not erase retained accounting history.
-- Cash target applicability is deliberately stricter and continues using R5E's guard.
create function public.revenue_ui_contract_read(target uuid) returns boolean
language sql stable security definer set search_path=public,app_auth as $$
 select exists(select 1 from public.contracts c where c.workspace_id=public.revenue_workspace_id() and c.id=target
  and public.can_access_owned_record(c.workspace_id,'CONTRACT',c.id,c.owner_id,false))
$$;

create function public.revenue_ui_health(target uuid) returns jsonb
language plpgsql security definer set search_path=public,app_auth as $$
declare c public.revenue_recognition_candidates;b jsonb;reason text;begin
 select * into c from public.revenue_recognition_candidates where workspace_id=public.revenue_workspace_id() and id=target;
 if not found then return jsonb_build_object('health','BLOCKED','reason','revenue_candidate_not_found');end if;
 begin
  if c.candidate_kind='ORIGINAL' then b:=public.revenue_candidate_basis(c.reporting_entity_id,c.specified_service_id,c.binding_id,c.recognition_unit_key);
  else b:=public.revenue_correction_basis(c.reporting_entity_id,c.original_fact_id,(c.revised_entitlement_snapshot->>'revised_candidate')::uuid,c.candidate_kind,c.correction_intent_key,c.correction_reason_reference,(c.revised_entitlement_snapshot->'refund'->>'id')::uuid);end if;
 exception when raise_exception then
  get stacked diagnostics reason=message_text;
  return jsonb_build_object('health','STALE','reason',case when reason~'^revenue_[a-z_]+$' then reason else 'revenue_stale_basis' end);
 end;
 return jsonb_build_object('health',case when c.status='BLOCKED' then 'BLOCKED' when c.status='STALE' or c.basis_digest<>b->>'digest' then 'STALE' else 'CURRENT' end,'reason',case when c.basis_digest<>b->>'digest' then 'revenue_stale_basis' else null end);
end $$;

create function public.revenue_workspace_read(entity uuid default null,contract_filter uuid default null,page_number integer default 1,filters jsonb default '{}') returns jsonb
language plpgsql security definer set search_path=public,app_auth as $$
declare ws uuid:=public.revenue_workspace_id();actor uuid:=app_auth.current_user_id();entities jsonb;profile jsonb;roles text[];result jsonb;
 c record;b record;a record;src text;resolved jsonb;health jsonb;actions jsonb;queue jsonb:='[]';bindings jsonb:='[]';evidence jsonb:='[]';cash jsonb:='[]';sources jsonb;rowdata jsonb;
 owner boolean;approver boolean;preparer boolean;reviewer boolean;poster boolean;verifier boolean;cash_manager boolean;active boolean;
begin
 if ws is null or public.current_crm_role() not in ('ADMIN','SUPER_ADMIN') then raise exception 'revenue_authority_required';end if;
 if page_number not between 1 and 100000 or jsonb_typeof(filters)<>'object' then raise exception 'revenue_input_invalid';end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',p.reporting_entity_id,'name',p.legal_name,'status',p.status) order by p.created_at),'[]') into entities
 from public.revenue_reporting_profiles p where p.workspace_id=ws and exists(select 1 from public.revenue_authority_assignments x where x.reporting_entity_id=p.reporting_entity_id and x.workspace_id=ws and x.user_id=actor and public.revenue_has_authority(p.reporting_entity_id,x.authority));
 if entity is null then entity:=(entities->0->>'id')::uuid;end if;
 if entity is null then return jsonb_build_object('entities',entities,'state',case when exists(select 1 from public.revenue_reporting_profiles where workspace_id=ws) then 'NO_DESIGNATION' else 'NO_CONFIGURATION' end);end if;
 if not exists(select 1 from jsonb_array_elements(entities) e where e->>'id'=entity::text) then raise exception 'revenue_authority_required';end if;
 select array_agg(distinct authority) into roles from public.revenue_authority_assignments where workspace_id=ws and reporting_entity_id=entity and user_id=actor and public.revenue_has_authority(entity,authority);
 owner:='POLICY_OWNER'=any(roles);approver:='POLICY_APPROVER'=any(roles);preparer:='RECOGNITION_PREPARER'=any(roles);reviewer:='RECOGNITION_REVIEWER'=any(roles);poster:='POSTING_AUTHORITY'=any(roles);verifier:='EVIDENCE_VERIFIER'=any(roles);cash_manager:='CASH_APPLICATION_MANAGER'=any(roles);
 select to_jsonb(p)-array['workspace_id','cutoff_reference','correction_reference','retention_reference'] into profile from public.revenue_reporting_profiles p where workspace_id=ws and reporting_entity_id=entity;
 active:=profile->>'status'='ACTIVE';
 if contract_filter is not null and not public.revenue_ui_contract_read(contract_filter) then raise exception 'revenue_source_forbidden';end if;

 -- Health is evaluated only for this bounded queue page, never a workspace-wide per-row scan.
 for c in select x.*,s.description_snapshot,cx.contract_number,p.recognition_strategy,p.version policy_version,ap.period_key,ap.status period_status
 from public.revenue_recognition_candidates x join public.contract_specified_services s on s.id=x.specified_service_id
 join public.contracts cx on cx.id=x.contract_id join public.revenue_policy_versions p on p.id=x.policy_version_id
 join public.revenue_accounting_periods ap on ap.id=x.accounting_period_id
 where x.workspace_id=ws and x.reporting_entity_id=entity and (preparer or reviewer or poster)
 and public.revenue_ui_contract_read(x.contract_id) and (contract_filter is null or x.contract_id=contract_filter)
 and (nullif(filters->>'status','') is null or x.status=filters->>'status')
 and (nullif(filters->>'currency','') is null or x.currency=filters->>'currency')
 and (nullif(filters->>'q','') is null or cx.contract_number ilike '%'||left(filters->>'q',80)||'%' or s.description_snapshot ilike '%'||left(filters->>'q',80)||'%')
 order by x.created_at desc,x.id limit 25 offset (page_number-1)*25 loop
  select id into src from public.recognized_revenue_facts where candidate_id=c.id;
  health:=case when src is not null then jsonb_build_object('health','HISTORICAL','reason',null) else public.revenue_ui_health(c.id) end;
  actions:='[]';
  if active and src is null then
   if preparer and c.created_by=actor and c.status='DRAFT' and health->>'health'='CURRENT' then actions:=actions||'"SUBMIT"'::jsonb;end if;
   if reviewer and c.created_by<>actor and c.status='READY_FOR_REVIEW' then
    actions:=actions||'"REJECT"'::jsonb;
    if health->>'health'='CURRENT' then actions:=actions||'"APPROVE"'::jsonb;end if;
   end if;
   if preparer and c.status in ('DRAFT','READY_FOR_REVIEW','APPROVED') and health->>'health'<>'CURRENT' then actions:=actions||'"REVALIDATE"'::jsonb;end if;
   if poster and c.created_by<>actor and c.reviewed_by<>actor and c.status='APPROVED' and health->>'health'='CURRENT' and c.period_status='OPEN'
    and (c.candidate_kind<>'ORIGINAL' or not exists(select 1 from public.recognized_revenue_facts f where f.workspace_id=ws and f.reporting_entity_id=entity and f.contract_id=c.contract_id and f.stable_service_key=c.stable_service_key and f.recognition_unit_key=c.recognition_unit_key and f.fact_kind='ORIGINAL')) then actions:=actions||'"POST"'::jsonb;end if;
  end if;
  queue:=queue||jsonb_build_array((to_jsonb(c)-array['workspace_id'])||health||jsonb_build_object('amount',c.amount::text,'actions',actions,'fact_id',src));
 end loop;

 for b in select x.*,s.contract_id,s.description_snapshot,s.contract_version_id,s.accepted_amount,s.currency,p.recognition_strategy,p.policy_key,p.version policy_version
 from public.revenue_service_bindings x join public.contract_specified_services s on s.id=x.specified_service_id join public.revenue_policy_versions p on p.id=x.policy_version_id
 where x.workspace_id=ws and x.reporting_entity_id=entity and public.revenue_ui_contract_read(s.contract_id) and (contract_filter is null or s.contract_id=contract_filter)
 order by x.created_at desc,x.id limit 100 loop
  sources:='[]';
  bindings:=bindings||jsonb_build_array((to_jsonb(b)-array['workspace_id','assessment_sources'])||jsonb_build_object('accepted_amount',b.accepted_amount::text,'agent_fee',b.agent_fee::text,'can_attest',active and owner and b.status='APPROVED',
   'can_evaluate',active and preparer and b.status='APPROVED','can_submit',active and owner and b.created_by=actor and b.status='DRAFT' and b.fulfillment_requirements<>'{}',
   'can_configure',active and owner and b.created_by=actor and b.status='DRAFT',
   'can_review',active and approver and b.created_by<>actor and b.status='IN_REVIEW'));
 end loop;

 for a in select x.* from public.revenue_fulfillment_attestations x join public.contract_specified_services s on s.id=x.specified_service_id
 where x.workspace_id=ws and x.reporting_entity_id=entity and public.revenue_ui_contract_read(s.contract_id) and (contract_filter is null or s.contract_id=contract_filter)
 order by x.created_at desc,x.id limit 100 loop
  health:=jsonb_build_object('health','SOURCE_UNAVAILABLE');
  begin
   resolved:=public.revenue_resolve_evidence(a.specified_service_id,a.source_domain,a.source_id);
   health:=jsonb_build_object('health',case when a.status='WITHDRAWN' then 'WITHDRAWN' when resolved->>'hash' is distinct from a.source_hash or resolved->>'version' is distinct from a.source_version then 'SOURCE_CHANGED' else 'CURRENT' end);
  exception when raise_exception then null;end;
  evidence:=evidence||jsonb_build_array((to_jsonb(a)-array['workspace_id'])||health||jsonb_build_object('verified_units',a.verified_units::text,
   'source_href',case when health->>'health'='SOURCE_UNAVAILABLE' then null when a.source_domain='STUDENT_ENROLLMENT' then '/enrollments?focus='||a.source_id::text when a.source_domain='CRM_ACTIVITY' then (select '/schools/'||organization_id::text from public.crm_activities where id=a.source_id and workspace_id=ws) end,
   'can_submit',active and owner and a.attested_by=actor and a.status='DRAFT',
   'can_review',active and verifier and a.attested_by<>actor and a.status='IN_REVIEW',
   'can_withdraw',active and verifier and a.status='ACCEPTED'));
 end loop;

 if cash_manager then
  for a in select d.* from public.cash_applications d where d.workspace_id=ws and d.reporting_entity_id=entity and d.entry_kind='DECLARE_CUSTODY' and public.cash_contract_access(d.terms_contract_id)
   and (contract_filter is null or d.terms_contract_id=contract_filter) order by d.created_at desc,d.id limit 25 loop
   select coalesce(jsonb_agg(public.cash_target_status(entity,s.id,r.id)),'[]') into sources
   from public.contract_specified_services s join public.receivable_schedules r on r.contract_id=s.contract_id and r.workspace_id=ws
   where s.workspace_id=ws and s.reporting_entity_id=entity and s.id=any(a.permitted_service_ids) and s.currency=a.currency and r.paid_amount<r.amount and public.cash_contract_access(s.contract_id);
   select coalesce(jsonb_agg(to_jsonb(x)),'[]') into rowdata from (
    select ap.id,ap.currency,ap.amount::text amount,(ap.amount-coalesce((select sum(r.amount) from public.cash_applications r where r.reverses_application_id=ap.id and r.entry_kind='REVERSE'),0))::numeric(14,2)::text available_to_release
    from public.cash_applications ap where ap.source_payment_id=a.source_payment_id and ap.entry_kind='APPLY' order by ap.created_at,ap.id limit 100
   ) x;
   resolved:=public.cash_source_status(entity,a.source_payment_id);
   cash:=cash||jsonb_build_array(resolved||jsonb_build_object('purpose','CUSTODY_RECEIPT','targets',sources,'reversible_applications',rowdata,'can_manage',active,
    'can_apply',active and (resolved->>'available')::numeric>0 and jsonb_array_length(sources)>0,
    'can_reverse',active and exists(select 1 from jsonb_array_elements(rowdata) x where (x->>'available_to_release')::numeric>0)));
  end loop;
 end if;

 result:=jsonb_build_object('state','READY','entities',entities,'entity',entity,'profile',profile,'authorities',to_jsonb(roles),'actor',actor,'aal2',current_setting('app.aal',true)='aal2','page',page_number,
  'queue',queue,'bindings',bindings,'evidence',evidence,'cash',cash,'bounded',true,
  'can_create_policy',active and owner,'can_create_binding',active and owner,'can_prepare_correction',active and preparer);
 -- Amounts remain decimal strings. Corrections are included. No cross-currency total.
 select result||jsonb_build_object('recognized',coalesce(jsonb_agg(to_jsonb(x)),'[]')) into result from (
  select f.currency,sum(f.amount)::text amount from public.recognized_revenue_facts f where f.workspace_id=ws and f.reporting_entity_id=entity and (preparer or reviewer or poster)
  and public.revenue_ui_contract_read(f.contract_id) and (contract_filter is null or f.contract_id=contract_filter) group by f.currency order by f.currency
 ) x;
 select result||jsonb_build_object('candidate_totals',coalesce(jsonb_agg(to_jsonb(x)),'[]')) into result from (
  select q->>'currency' currency,q->>'status' status,sum((q->>'amount')::numeric)::text amount,count(*) count from jsonb_array_elements(queue) q
  where q->>'fact_id' is null and q->>'health'='CURRENT' and q->>'status' in ('DRAFT','READY_FOR_REVIEW','APPROVED')
  and not (q->>'candidate_kind'='ORIGINAL' and exists(select 1 from public.recognized_revenue_facts f where f.workspace_id=ws and f.reporting_entity_id=entity and f.contract_id=(q->>'contract_id')::uuid and f.stable_service_key=q->>'stable_service_key' and f.recognition_unit_key=q->>'recognition_unit_key' and f.fact_kind='ORIGINAL'))
  -- Multiple correction intents may be reviewed, but cannot be summed as separate earnings.
  -- Select the latest unconsumed live basis globally, before applying page-local totals.
  and not exists(select 1 from public.revenue_recognition_candidates newer where newer.workspace_id=ws and newer.reporting_entity_id=entity
   and newer.contract_id=(q->>'contract_id')::uuid and newer.stable_service_key=q->>'stable_service_key' and newer.recognition_unit_key=q->>'recognition_unit_key'
   and newer.status in ('DRAFT','READY_FOR_REVIEW','APPROVED') and (newer.created_at,newer.id)>((q->>'created_at')::timestamptz,(q->>'id')::uuid)
   and not exists(select 1 from public.recognized_revenue_facts consumed where consumed.candidate_id=newer.id)
   and (newer.candidate_kind<>'ORIGINAL' or not exists(select 1 from public.recognized_revenue_facts root where root.workspace_id=ws and root.reporting_entity_id=entity and root.contract_id=newer.contract_id and root.stable_service_key=newer.stable_service_key and root.recognition_unit_key=newer.recognition_unit_key and root.fact_kind='ORIGINAL')))
  group by q->>'currency',q->>'status'
 ) x;
 select result||jsonb_build_object('facts',coalesce(jsonb_agg(to_jsonb(x)),'[]')) into result from (
  with totals as (select coalesce(original_fact_id,id) root,currency,sum(amount)::numeric(14,2)::text current_amount from public.recognized_revenue_facts where workspace_id=ws and reporting_entity_id=entity group by coalesce(original_fact_id,id),currency)
  select f.id,f.candidate_id,f.contract_id,f.contract_version_id,f.specified_service_id,f.stable_service_key,f.binding_id,f.policy_version_id,f.recognition_unit_key,f.amount::text,f.currency,f.business_date,f.accounting_period_id,f.fact_kind,f.original_fact_id,f.prior_fact_id,f.correction_intent_key,f.prior_period_flag,f.posted_by,f.posted_at,f.approval_reference,f.posting_reference,f.source_basis_digest,t.current_amount,ct.contract_number
  from public.recognized_revenue_facts f join public.contracts ct on ct.id=f.contract_id join totals t on t.root=coalesce(f.original_fact_id,f.id) and t.currency=f.currency where f.workspace_id=ws and f.reporting_entity_id=entity and (preparer or reviewer or poster) and public.revenue_ui_contract_read(f.contract_id) and (contract_filter is null or f.contract_id=contract_filter) order by f.posted_at desc,f.id limit 100 offset (page_number-1)*100
 ) x;
 select result||jsonb_build_object('services',coalesce(jsonb_agg(to_jsonb(x)),'[]')) into result from (
  select s.id,s.contract_id,ct.contract_number,s.contract_version_id,s.stable_service_key,s.supersedes_service_id,s.description_snapshot,s.accepted_amount::text,s.accepted_quantity::text,s.currency,s.source_quote_version_id,s.source_quote_line_reference,s.accepted_price_source,s.accepted_price_reference,s.accepted_price_snapshot_digest
  from public.contract_specified_services s join public.contracts ct on ct.id=s.contract_id where s.workspace_id=ws and s.reporting_entity_id=entity and public.revenue_ui_contract_read(s.contract_id) and (contract_filter is null or s.contract_id=contract_filter) order by s.created_at desc,s.id limit 100
 ) x;
 select result||jsonb_build_object('policies',coalesce(jsonb_agg(to_jsonb(x)),'[]')) into result from (
  select p.*,active and owner and not p.test_only and p.created_by=actor and p.status='DRAFT' can_submit,active and approver and not p.test_only and p.created_by<>actor and p.status='IN_REVIEW' can_review
  from public.revenue_policy_versions p where p.workspace_id=ws and p.reporting_entity_id=entity order by p.created_at desc,p.id limit 100
 ) x;
 select result||jsonb_build_object('periods',coalesce(jsonb_agg(to_jsonb(x)),'[]')) into result from (
  select p.id,p.period_key,p.start_on,p.end_on,p.status,p.revision,p.closed_by,p.closed_at,p.close_reference,active and approver and p.status='OPEN' can_close from public.revenue_accounting_periods p where p.workspace_id=ws and p.reporting_entity_id=entity order by p.start_on desc limit 100
 ) x;
 select result||jsonb_build_object('designations',coalesce(jsonb_agg(to_jsonb(x)),'[]')) into result from (
  select user_id,authority,status,effective_from,effective_to from public.revenue_authority_assignments where workspace_id=ws and reporting_entity_id=entity order by created_at desc limit 100
 ) x;
 select result||jsonb_build_object('contracts',coalesce(jsonb_agg(to_jsonb(x)),'[]')) into result from (
  select f.contract_id,f.contract_number,f.currency,f.contracted,f.receivable,f.collected,f.refunded,f.outstanding,f.applied_cash
  from public.contract_finance_snapshot f where f.workspace_id=ws and public.cash_contract_access(f.contract_id) and (contract_filter is null or f.contract_id=contract_filter)
   and exists(select 1 from public.contract_specified_services s where s.contract_id=f.contract_id and s.reporting_entity_id=entity)
  order by f.contract_number,f.contract_id limit 100
 ) x;
 select result||jsonb_build_object('commissions',coalesce(jsonb_agg(to_jsonb(x)),'[]')) into result from (
  select contract_id,currency,sum(commission_amount)::text amount from public.commission_accruals where workspace_id=ws and public.revenue_ui_contract_read(contract_id)
   and (contract_filter is null or contract_id=contract_filter) and exists(select 1 from public.contract_specified_services s where s.contract_id=commission_accruals.contract_id and s.reporting_entity_id=entity)
  group by contract_id,currency order by contract_id,currency limit 100
 ) x;
 return result;
end $$;

create function public.revenue_source_options(entity uuid,service uuid,binding uuid default null) returns jsonb
language plpgsql security definer set search_path=public,app_auth as $$
declare s public.contract_specified_services;c public.contracts;x record;r jsonb;result jsonb:='[]';begin
 if not public.revenue_has_authority(entity,'POLICY_OWNER') then raise exception 'revenue_authority_required';end if;
 select * into s from public.contract_specified_services where workspace_id=public.revenue_workspace_id() and reporting_entity_id=entity and id=service;
 if not found or not public.cash_contract_access(s.contract_id) then raise exception 'revenue_source_forbidden';end if;
 if binding is not null then
  if not exists(select 1 from public.revenue_service_bindings b where b.workspace_id=s.workspace_id and b.reporting_entity_id=entity and b.specified_service_id=service and b.id=binding and b.status='APPROVED') then raise exception 'revenue_binding_not_approved';end if;
  for x in select rule.key unit,rule.value requirement,src.value#>>'{}' source from public.revenue_service_bindings b cross join lateral jsonb_each(b.fulfillment_requirements) rule cross join lateral jsonb_array_elements(rule.value->'source_ids') src where b.id=binding order by rule.key,src.value limit 100 loop
   begin r:=public.revenue_resolve_evidence(service,x.requirement->>'source_domain',x.source::uuid);
    if r->>'condition'=x.requirement->>'condition' and r->>'business_date' is not null then result:=result||jsonb_build_array(jsonb_build_object('id',x.source,'unit',x.unit,'domain',x.requirement->>'source_domain','evidence_type',x.requirement->>'evidence_type','business_date',r->>'business_date'));end if;
   exception when raise_exception then null;end;
  end loop;
  return result;
 end if;
 select * into strict c from public.contracts where id=s.contract_id;
 for x in select id,'CRM_ACTIVITY' domain from public.crm_activities where workspace_id=s.workspace_id and organization_id=c.organization_id and archived_at is null order by occurred_at desc limit 50 loop
  begin r:=public.revenue_resolve_evidence(service,x.domain,x.id);result:=result||jsonb_build_array(jsonb_build_object('id',x.id,'domain',x.domain,'date',r->>'business_date','condition',r->>'condition'));exception when raise_exception then null;end;
 end loop;
 for x in select enrollment_id id,'STUDENT_ENROLLMENT' domain from public.contract_enrollment_links where workspace_id=s.workspace_id and contract_id=c.id and status='ACTIVE' order by id limit 50 loop
  begin r:=public.revenue_resolve_evidence(service,x.domain,x.id);result:=result||jsonb_build_array(jsonb_build_object('id',x.id,'domain',x.domain,'date',r->>'business_date','condition',r->>'condition'));exception when raise_exception then null;end;
 end loop;
 return result;
end $$;
revoke all on function public.revenue_ui_health(uuid),public.revenue_workspace_read(uuid,uuid,integer,jsonb) from public,crm_app,crm_system,crm_worker;
revoke all on function public.revenue_ui_contract_read(uuid) from public,crm_app,crm_system,crm_worker;
grant execute on function public.revenue_workspace_read(uuid,uuid,integer,jsonb) to crm_app;
revoke all on function public.revenue_source_options(uuid,uuid,uuid) from public,crm_system,crm_worker;
grant execute on function public.revenue_source_options(uuid,uuid,uuid) to crm_app;
