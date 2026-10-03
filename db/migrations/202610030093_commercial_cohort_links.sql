-- Commercial relations retain separate sales, education and financial identities.
set search_path=public,app_auth,extensions;
alter table public.product_cohorts add constraint product_cohorts_product_identity unique(workspace_id,product_id,id);
alter table public.opportunities add column cohort_id uuid,add column revision integer not null default 1 check(revision>0),
  add constraint opportunity_cohort_product_required check(cohort_id is null or product_id is not null),
  add constraint opportunity_product_cohort_fk foreign key(workspace_id,product_id,cohort_id) references public.product_cohorts(workspace_id,product_id,id);
alter table public.education_outreach_events add column campaign_id uuid,add column product_id uuid,add column cohort_id uuid,
  add constraint event_cohort_product_required check(cohort_id is null or product_id is not null),
  add constraint event_product_fk foreign key(workspace_id,product_id) references public.products(workspace_id,id),
  add constraint event_campaign_fk foreign key(workspace_id,campaign_id) references public.growth_campaigns(workspace_id,id),
  add constraint event_product_cohort_fk foreign key(workspace_id,product_id,cohort_id) references public.product_cohorts(workspace_id,product_id,id);
alter table public.quotes add column cohort_id uuid,add column revision integer not null default 1 check(revision>0),
  add constraint quote_cohort_product_required check(cohort_id is null or product_id is not null),
  add constraint quote_product_cohort_fk foreign key(workspace_id,product_id,cohort_id) references public.product_cohorts(workspace_id,product_id,id);
create index opportunity_cohort_idx on public.opportunities(workspace_id,cohort_id) where cohort_id is not null;
create index education_event_cohort_idx on public.education_outreach_events(workspace_id,cohort_id) where cohort_id is not null;
create index quote_cohort_idx on public.quotes(workspace_id,cohort_id) where cohort_id is not null;

create table public.contract_enrollment_links(
  id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id),contract_id uuid not null,enrollment_id uuid not null,
  status text not null default 'ACTIVE' check(status in ('ACTIVE','UNLINKED')),
  revision integer not null default 1 check(revision>0),linked_at timestamptz not null default clock_timestamp(),linked_by uuid not null references app_auth.accounts(id),
  unlinked_at timestamptz,unlinked_by uuid references app_auth.accounts(id),unlink_reason text not null default '' check(length(unlink_reason)<=1000),
  created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),
  unique(workspace_id,id),
  foreign key(workspace_id,contract_id) references public.contracts(workspace_id,id),
  foreign key(workspace_id,enrollment_id) references public.student_enrollments(workspace_id,id) on delete cascade,
  check((status='ACTIVE' and unlinked_at is null and unlinked_by is null and unlink_reason='') or
    (status='UNLINKED' and unlinked_at is not null and unlinked_at>=linked_at and unlinked_by is not null and length(trim(unlink_reason))>0))
);
create unique index contract_enrollment_active_uidx on public.contract_enrollment_links(workspace_id,contract_id,enrollment_id) where status='ACTIVE';
create index contract_enrollment_contract_idx on public.contract_enrollment_links(workspace_id,contract_id,linked_at desc,id);
create index contract_enrollment_enrollment_idx on public.contract_enrollment_links(workspace_id,enrollment_id,linked_at desc,id);

-- A short transaction-scoped workspace lock gives all participating RPCs one
-- ordering boundary. It serializes relation edits, never counts capacity or money.
create function public.lock_commercial_relations(ws uuid) returns void language sql volatile security definer set search_path=public,extensions as $$
  select pg_advisory_xact_lock(hashtextextended('commercial-relations:'||ws::text,0));
$$;
revoke all on function public.lock_commercial_relations(uuid) from public;

create function public.contract_enrollment_access(contract uuid,enrollment uuid,edit boolean default false) returns boolean
language sql stable security definer set search_path=public,app_auth,extensions as $$
  select app_auth.current_user_id() is not null and public.is_workspace_member(public.current_workspace_id())
    and (not edit or public.current_crm_role() in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER','SALES_SPECIALIST'))
    and exists(select 1 from public.contracts c where c.id=contract and c.workspace_id=public.current_workspace_id()
      and public.can_access_owned_record(c.workspace_id,'CONTRACT',c.id,c.owner_id,edit))
    and exists(select 1 from public.student_enrollments e where e.id=enrollment and e.workspace_id=public.current_workspace_id()
      and public.student_enrollment_access(to_jsonb(e),edit));
$$;
revoke all on function public.contract_enrollment_access(uuid,uuid,boolean) from public;
grant execute on function public.contract_enrollment_access(uuid,uuid,boolean) to crm_app;
alter table public.contract_enrollment_links enable row level security;
grant select on public.contract_enrollment_links to crm_app,crm_worker;
create policy contract_enrollment_read on public.contract_enrollment_links for select to crm_app using(public.contract_enrollment_access(contract_id,enrollment_id,false));
create policy contract_enrollment_privacy_read on public.contract_enrollment_links for select to crm_worker using(true);

create function public.check_commercial_relation_integrity() returns trigger
language plpgsql security definer set search_path=public,app_auth,extensions as $$
declare e public.student_enrollments;co public.product_cohorts;op public.opportunities;ev public.education_outreach_events;c public.contracts;
begin
  perform public.lock_commercial_relations(new.workspace_id);
  if tg_table_name='student_enrollments' then
    select * into co from public.product_cohorts where id=new.cohort_id and workspace_id=new.workspace_id;
    if new.opportunity_id is not null then
      select * into op from public.opportunities where id=new.opportunity_id and workspace_id=new.workspace_id;
      if not found or op.product_id is distinct from co.product_id or (op.cohort_id is not null and op.cohort_id<>new.cohort_id) then raise exception 'commercial_opportunity_mismatch'; end if;
    end if;
    if exists(select 1 from public.contract_enrollment_links l join public.contracts x on x.id=l.contract_id and x.workspace_id=l.workspace_id
      where l.enrollment_id=new.id and l.workspace_id=new.workspace_id and l.status='ACTIVE'
      and (x.product_id is distinct from co.product_id or (x.household_id is not null and new.household_id is not null and x.household_id<>new.household_id)))
      then raise exception 'commercial_contract_mismatch'; end if;
  elsif tg_table_name='opportunities' then
    if exists(select 1 from public.student_enrollments x join public.product_cohorts p on p.id=x.cohort_id and p.workspace_id=x.workspace_id
      where x.opportunity_id=new.id and x.workspace_id=new.workspace_id
      and (new.product_id is distinct from p.product_id or (new.cohort_id is not null and new.cohort_id<>x.cohort_id))) then raise exception 'commercial_opportunity_mismatch'; end if;
  elsif tg_table_name='enrollment_attributions' then
    if new.source_event_id is not null then
      select * into e from public.student_enrollments where id=new.enrollment_id and workspace_id=new.workspace_id;
      select * into co from public.product_cohorts where id=e.cohort_id and workspace_id=e.workspace_id;
      select * into ev from public.education_outreach_events where id=new.source_event_id and workspace_id=new.workspace_id;
      if not found or (ev.product_id is not null and ev.product_id<>co.product_id) or (ev.cohort_id is not null and ev.cohort_id<>e.cohort_id) then raise exception 'commercial_event_mismatch'; end if;
    end if;
  elsif tg_table_name='education_outreach_events' then
    if exists(select 1 from public.enrollment_attributions a join public.student_enrollments x on x.id=a.enrollment_id and x.workspace_id=a.workspace_id
      join public.product_cohorts p on p.id=x.cohort_id and p.workspace_id=x.workspace_id where a.source_event_id=new.id and a.workspace_id=new.workspace_id
      and ((new.product_id is not null and new.product_id<>p.product_id) or (new.cohort_id is not null and new.cohort_id<>x.cohort_id))) then raise exception 'commercial_event_mismatch'; end if;
  elsif tg_table_name='contract_enrollment_links' then
    if tg_op='UPDATE' and (new.id is distinct from old.id or new.workspace_id is distinct from old.workspace_id or new.contract_id is distinct from old.contract_id
      or new.enrollment_id is distinct from old.enrollment_id or new.linked_at is distinct from old.linked_at or new.linked_by is distinct from old.linked_by
      or new.created_at is distinct from old.created_at or old.status='UNLINKED' or new.status<>'UNLINKED') then raise exception 'commercial_link_immutable'; end if;
    if new.status='ACTIVE' then
      select * into e from public.student_enrollments where id=new.enrollment_id and workspace_id=new.workspace_id;
      select * into co from public.product_cohorts where id=e.cohort_id and workspace_id=e.workspace_id;
      select * into c from public.contracts where id=new.contract_id and workspace_id=new.workspace_id;
      if not found or c.product_id is distinct from co.product_id or (c.household_id is not null and e.household_id is not null and c.household_id<>e.household_id)
        then raise exception 'commercial_contract_mismatch'; end if;
    end if;
  elsif tg_table_name='contracts' then
    if exists(select 1 from public.contract_enrollment_links l join public.student_enrollments x on x.id=l.enrollment_id and x.workspace_id=l.workspace_id
      join public.product_cohorts p on p.id=x.cohort_id and p.workspace_id=x.workspace_id where l.contract_id=new.id and l.workspace_id=new.workspace_id and l.status='ACTIVE'
      and (new.product_id is distinct from p.product_id or (new.household_id is not null and x.household_id is not null and new.household_id<>x.household_id))) then raise exception 'commercial_contract_mismatch'; end if;
  end if;
  return new;
end $$;
revoke all on function public.check_commercial_relation_integrity() from public;
do $$ declare tbl text;begin
  foreach tbl in array array['student_enrollments','opportunities','enrollment_attributions','education_outreach_events','contract_enrollment_links','contracts'] loop
    execute format('create trigger commercial_relation_integrity before insert or update on public.%I for each row execute function public.check_commercial_relation_integrity()',tbl);
  end loop;
end $$;

-- The unchanged Enrollment save contracts take the relation lock before row locks.
alter function public.save_student_enrollment(uuid,integer,jsonb,text,text) rename to student_enrollment_save_internal;
revoke all on function public.student_enrollment_save_internal(uuid,integer,jsonb,text,text) from public,crm_app,crm_system;
create function public.save_student_enrollment(record_id uuid,expected_revision integer,data jsonb,p_request_key text,status_reason text default '') returns public.student_enrollments
language plpgsql security definer set search_path=public,app_auth,extensions as $$ begin
  perform public.lock_commercial_relations(public.current_workspace_id());
  return public.student_enrollment_save_internal(record_id,expected_revision,data,p_request_key,status_reason);
end $$;
revoke all on function public.save_student_enrollment(uuid,integer,jsonb,text,text) from public;
grant execute on function public.save_student_enrollment(uuid,integer,jsonb,text,text) to crm_app;
alter function public.save_enrollment_attribution(uuid,jsonb,text) rename to enrollment_attribution_save_internal;
revoke all on function public.enrollment_attribution_save_internal(uuid,jsonb,text) from public,crm_app,crm_system;
create function public.save_enrollment_attribution(record_id uuid,data jsonb,p_request_key text) returns public.enrollment_attributions
language plpgsql security definer set search_path=public,app_auth,extensions as $$ begin
  perform public.lock_commercial_relations(public.current_workspace_id());
  return public.enrollment_attribution_save_internal(record_id,data,p_request_key);
end $$;
revoke all on function public.save_enrollment_attribution(uuid,jsonb,text) from public;
grant execute on function public.save_enrollment_attribution(uuid,jsonb,text) to crm_app;

create function public.record_commercial_context() returns trigger language plpgsql security definer set search_path=public,app_auth,extensions as $$
declare before_context jsonb;after_context jsonb;
begin
  after_context:=jsonb_build_object('productId',new.product_id,'cohortId',new.cohort_id);
  if tg_table_name='education_outreach_events' then after_context:=after_context||jsonb_build_object('campaignId',new.campaign_id); end if;
  if tg_op='UPDATE' then
    before_context:=jsonb_build_object('productId',old.product_id,'cohortId',old.cohort_id);
    if tg_table_name='education_outreach_events' then before_context:=before_context||jsonb_build_object('campaignId',old.campaign_id); end if;
  end if;
  if before_context is distinct from after_context then
    insert into public.audit_events(workspace_id,actor_id,action,entity_type,entity_id,before_data,after_data)
      values(new.workspace_id,app_auth.current_user_id(),case tg_table_name when 'opportunities' then 'OPPORTUNITY_COHORT_CHANGED' when 'quotes' then 'QUOTE_COHORT_CHANGED' else 'EVENT_COMMERCIAL_CONTEXT_CHANGED' end,
        upper(tg_table_name),new.id,before_context,after_context);
  end if;return new;
end $$;
revoke all on function public.record_commercial_context() from public;
create trigger commercial_context_audit after insert or update on public.opportunities for each row execute function public.record_commercial_context();
create trigger commercial_context_audit after insert or update on public.education_outreach_events for each row execute function public.record_commercial_context();
create trigger commercial_context_audit after insert or update on public.quotes for each row execute function public.record_commercial_context();
create function public.bump_commercial_revision() returns trigger language plpgsql set search_path=public,extensions as $$begin new.revision:=old.revision+1;new.updated_at:=clock_timestamp();return new;end $$;
revoke all on function public.bump_commercial_revision() from public;
create trigger commercial_revision before update on public.opportunities for each row execute function public.bump_commercial_revision();
create trigger commercial_revision before update on public.quotes for each row execute function public.bump_commercial_revision();

create function public.link_contract_enrollment(record_id uuid,target_contract uuid,target_enrollment uuid,p_request_key text) returns public.contract_enrollment_links
language plpgsql security definer set search_path=public,app_auth,extensions as $$
declare ws uuid:=public.current_workspace_id();actor uuid:=app_auth.current_user_id();receipt public.mutation_receipts;result public.contract_enrollment_links;fingerprint text;
begin
  if not public.contract_enrollment_access(target_contract,target_enrollment,true) then raise exception 'commercial_link_forbidden'; end if;
  if record_id is null or p_request_key is null or length(p_request_key) not between 8 and 160 then raise exception 'commercial_input_invalid'; end if;
  perform public.lock_commercial_relations(ws);
  -- Serialize with Student privacy deletion using the same contact locks as Enrollment.
  perform 1 from public.students s join public.student_enrollments e on e.student_id=s.id and e.workspace_id=s.workspace_id join public.contacts c on c.id=s.person_id and c.workspace_id=s.workspace_id
    where e.id=target_enrollment and e.workspace_id=ws for share of s,c;
  if not public.contract_enrollment_access(target_contract,target_enrollment,true) then raise exception 'commercial_link_forbidden'; end if;
  perform pg_advisory_xact_lock(hashtextextended(ws::text||':'||p_request_key,0));
  fingerprint:=encode(extensions.digest(jsonb_build_array(actor,record_id,target_contract,target_enrollment)::text,'sha256'),'hex');
  select * into receipt from public.mutation_receipts where workspace_id=ws and request_key=p_request_key;
  if found then
    if receipt.operation<>'CONTRACT_ENROLLMENT_LINK' or receipt.created_by<>actor or receipt.result->>'fingerprint' is distinct from fingerprint then raise exception 'commercial_request_conflict'; end if;
    return jsonb_populate_record(null::public.contract_enrollment_links,receipt.result->'item');
  end if;
  insert into public.contract_enrollment_links(id,workspace_id,contract_id,enrollment_id,linked_by) values(record_id,ws,target_contract,target_enrollment,actor) returning * into result;
  insert into public.audit_events(workspace_id,actor_id,action,entity_type,entity_id,after_data) values(ws,actor,'CONTRACT_ENROLLMENT_LINKED','CONTRACT_ENROLLMENT_LINK',result.id,jsonb_build_object('contractId',target_contract,'enrollmentId',target_enrollment,'status',result.status));
  insert into public.mutation_receipts(workspace_id,request_key,operation,result,created_by) values(ws,p_request_key,'CONTRACT_ENROLLMENT_LINK',jsonb_build_object('fingerprint',fingerprint,'item',to_jsonb(result)),actor);
  return result;
end $$;
create function public.unlink_contract_enrollment(record_id uuid,expected_revision integer,reason text,p_request_key text) returns public.contract_enrollment_links
language plpgsql security definer set search_path=public,app_auth,extensions as $$
declare ws uuid:=public.current_workspace_id();actor uuid:=app_auth.current_user_id();previous public.contract_enrollment_links;result public.contract_enrollment_links;receipt public.mutation_receipts;fingerprint text;
begin
  if expected_revision is null or expected_revision<1 or p_request_key is null or length(p_request_key) not between 8 and 160 or reason is null or length(trim(reason)) not between 1 and 1000 then raise exception 'commercial_input_invalid'; end if;
  perform public.lock_commercial_relations(ws);perform pg_advisory_xact_lock(hashtextextended(ws::text||':'||p_request_key,0));
  select * into previous from public.contract_enrollment_links where id=record_id and workspace_id=ws for update;
  if not found or not public.contract_enrollment_access(previous.contract_id,previous.enrollment_id,true) then raise exception 'commercial_link_forbidden'; end if;
  fingerprint:=encode(extensions.digest(jsonb_build_array(actor,record_id,expected_revision,trim(reason))::text,'sha256'),'hex');
  select * into receipt from public.mutation_receipts where workspace_id=ws and request_key=p_request_key;
  if found then
    if receipt.operation<>'CONTRACT_ENROLLMENT_UNLINK' or receipt.created_by<>actor or receipt.result->>'fingerprint' is distinct from fingerprint then raise exception 'commercial_request_conflict'; end if;
    return jsonb_populate_record(null::public.contract_enrollment_links,receipt.result->'item');
  end if;
  if previous.revision<>expected_revision or previous.status<>'ACTIVE' then raise exception 'commercial_version_conflict'; end if;
  update public.contract_enrollment_links set status='UNLINKED',revision=previous.revision+1,unlinked_at=clock_timestamp(),unlinked_by=actor,unlink_reason=trim(reason),updated_at=clock_timestamp() where id=record_id and workspace_id=ws returning * into result;
  insert into public.audit_events(workspace_id,actor_id,action,entity_type,entity_id,after_data) values(ws,actor,'CONTRACT_ENROLLMENT_UNLINKED','CONTRACT_ENROLLMENT_LINK',result.id,jsonb_build_object('contractId',result.contract_id,'enrollmentId',result.enrollment_id,'status',result.status));
  insert into public.mutation_receipts(workspace_id,request_key,operation,result,created_by) values(ws,p_request_key,'CONTRACT_ENROLLMENT_UNLINK',jsonb_build_object('fingerprint',fingerprint,'item',to_jsonb(result)),actor);
  return result;
end $$;
revoke all on function public.link_contract_enrollment(uuid,uuid,uuid,text),public.unlink_contract_enrollment(uuid,integer,text,text) from public;
grant execute on function public.link_contract_enrollment(uuid,uuid,uuid,text),public.unlink_contract_enrollment(uuid,integer,text,text) to crm_app;
create function public.cleanup_contract_enrollment_receipts() returns trigger language plpgsql security definer set search_path=public,app_auth,extensions as $$ begin
  delete from public.mutation_receipts where workspace_id=old.workspace_id and operation in ('CONTRACT_ENROLLMENT_LINK','CONTRACT_ENROLLMENT_UNLINK') and result->'item'->>'id'=old.id::text;
  return old;
end $$;
revoke all on function public.cleanup_contract_enrollment_receipts() from public;
create trigger contract_enrollment_receipt_cleanup before delete on public.contract_enrollment_links for each row execute function public.cleanup_contract_enrollment_receipts();
create view public.contract_enrollment_records with(security_invoker=true) as
  select l.*,c.contract_number,c.status contract_status,c.contract_value,c.currency,c.product_id,c.organization_id,c.household_id contract_household_id,
    e.student_id,e.cohort_id,e.status enrollment_status,p.name_zh product_name_zh,p.name_en product_name_en,co.name_zh cohort_name_zh,co.name_en cohort_name_en,
    pe.name_zh student_name_zh,pe.name_en student_name_en,o.name_zh buyer_organization_zh,o.name_en buyer_organization_en,h.name_zh buyer_household_zh,h.name_en buyer_household_en,
    public.contract_enrollment_access(l.contract_id,l.enrollment_id,true) can_edit
  from public.contract_enrollment_links l join public.contracts c on c.id=l.contract_id and c.workspace_id=l.workspace_id
    join public.student_enrollments e on e.id=l.enrollment_id and e.workspace_id=l.workspace_id join public.students s on s.id=e.student_id and s.workspace_id=e.workspace_id
    join public.contacts pe on pe.id=s.person_id and pe.workspace_id=s.workspace_id join public.product_cohorts co on co.id=e.cohort_id and co.workspace_id=e.workspace_id
    join public.products p on p.id=co.product_id and p.workspace_id=co.workspace_id
    left join public.organizations o on o.id=c.organization_id and o.workspace_id=c.workspace_id left join public.households h on h.id=c.household_id and h.workspace_id=c.workspace_id;
grant select on public.contract_enrollment_records to crm_app;
create view public.contract_enrollment_candidates with(security_invoker=true) as
  select c.id contract_id,e.id enrollment_id,e.student_name_zh,e.student_name_en,e.cohort_name_zh,e.cohort_name_en
  from public.contracts c join public.product_cohorts co on co.product_id=c.product_id and co.workspace_id=c.workspace_id
    join public.student_enrollment_records e on e.cohort_id=co.id and e.workspace_id=co.workspace_id
  where (c.household_id is null or e.household_id is null or c.household_id=e.household_id)
    and public.contract_enrollment_access(c.id,e.id,true)
    and not exists(select 1 from public.contract_enrollment_links l where l.contract_id=c.id and l.enrollment_id=e.id and l.workspace_id=c.workspace_id and l.status='ACTIVE');
grant select on public.contract_enrollment_candidates to crm_app;

create function public.update_quote_cohort(target_quote uuid,target_product uuid,target_cohort uuid,expected_revision integer,p_request_key text) returns public.quotes
language plpgsql security definer set search_path=public,app_auth,extensions as $$
declare previous public.quotes;result public.quotes;receipt public.mutation_receipts;fingerprint text;ws uuid:=public.current_workspace_id();actor uuid:=app_auth.current_user_id();
begin
  perform public.lock_commercial_relations(ws);
  select * into previous from public.quotes where id=target_quote and workspace_id=ws for update;
  if not found or public.current_crm_role() not in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER','SALES_SPECIALIST')
    or not public.can_access_owned_record(ws,'QUOTE',previous.id,previous.owner_id,true) then raise exception 'commercial_quote_forbidden'; end if;
  if expected_revision is null or expected_revision<1 or p_request_key is null or length(p_request_key) not between 8 and 160 then raise exception 'commercial_input_invalid'; end if;
  perform pg_advisory_xact_lock(hashtextextended(ws::text||':'||p_request_key,0));
  fingerprint:=encode(extensions.digest(jsonb_build_array(actor,target_quote,target_product,target_cohort,expected_revision)::text,'sha256'),'hex');
  select * into receipt from public.mutation_receipts where workspace_id=ws and request_key=p_request_key;
  if found then
    if receipt.operation<>'QUOTE_COHORT_SAVE' or receipt.created_by<>actor or receipt.result->>'fingerprint' is distinct from fingerprint then raise exception 'commercial_request_conflict'; end if;
    return jsonb_populate_record(null::public.quotes,receipt.result->'item');
  end if;
  if previous.revision<>expected_revision then raise exception 'commercial_version_conflict'; end if;
  if previous.status<>'DRAFT' or exists(select 1 from public.quote_versions where quote_id=previous.id and version=previous.current_version and bundle_id is not null) then raise exception 'commercial_quote_locked'; end if;
  if target_product is null or not exists(select 1 from public.products where id=target_product and workspace_id=ws and archived_at is null and active)
    or (target_cohort is not null and not exists(select 1 from public.product_cohorts where id=target_cohort and workspace_id=ws and product_id=target_product)) then raise exception 'commercial_cohort_mismatch'; end if;
  update public.quotes set product_id=target_product,cohort_id=target_cohort where id=previous.id returning * into result;
  insert into public.mutation_receipts(workspace_id,request_key,operation,result,created_by) values(ws,p_request_key,'QUOTE_COHORT_SAVE',jsonb_build_object('fingerprint',fingerprint,'item',to_jsonb(result)),actor);
  return result;
end $$;
revoke all on function public.update_quote_cohort(uuid,uuid,uuid,integer,text) from public,crm_system;
grant execute on function public.update_quote_cohort(uuid,uuid,uuid,integer,text) to crm_app;

-- Extend existing domain save paths; legacy input remains compatible.
create or replace function public.education_business_access(resource text,record jsonb,edit boolean default false) returns boolean
language plpgsql stable security definer set search_path=public,app_auth,extensions as $$
begin
  if app_auth.current_user_id() is null or record->>'workspace_id' is distinct from public.current_workspace_id()::text
    or not public.is_workspace_member(public.current_workspace_id()) then return false; end if;
  if edit and public.current_crm_role() not in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER','SALES_SPECIALIST','SALES_SUPPORT') then return false; end if;
  case resource
    when 'participations' then return public.customer_subject_access('HOUSEHOLD',(record->>'household_id')::uuid,edit)
      and exists(select 1 from public.education_outreach_events e where e.id=(record->>'event_id')::uuid and e.workspace_id=public.current_workspace_id()
        and public.education_business_access('events',to_jsonb(e),false));
    when 'applications' then return public.education_business_student_access((record->>'student_id')::uuid,edit);
    when 'organizations' then return public.customer_subject_access('ORGANIZATION',(record->>'id')::uuid,edit);
    when 'needs' then return public.customer_subject_access('HOUSEHOLD',(record->>'id')::uuid,edit);
    when 'pathways' then return public.education_business_student_access((record->>'student_id')::uuid,edit)
      and (record->>'target_organization_id' is null or public.customer_subject_access('ORGANIZATION',(record->>'target_organization_id')::uuid,false));
    when 'events' then return
      (record->>'campaign_id' is null or exists(select 1 from public.growth_campaigns g where g.id=(record->>'campaign_id')::uuid and g.workspace_id=public.current_workspace_id()))
      and (record->>'product_id' is null or exists(select 1 from public.products p where p.id=(record->>'product_id')::uuid and p.workspace_id=public.current_workspace_id()))
      and (record->>'cohort_id' is null or exists(select 1 from public.product_cohorts c where c.id=(record->>'cohort_id')::uuid and c.workspace_id=public.current_workspace_id() and c.product_id=(record->>'product_id')::uuid))
      and public.customer_subject_access('ORGANIZATION',(record->>'organization_id')::uuid,edit)
      and (record->>'partner_organization_id' is null or public.customer_subject_access('ORGANIZATION',(record->>'partner_organization_id')::uuid,false));
    when 'referrals' then return public.customer_subject_access('HOUSEHOLD',(record->>'household_id')::uuid,edit)
      and public.customer_subject_access('ORGANIZATION',(record->>'source_organization_id')::uuid,false)
      and (record->>'event_id' is null or exists(select 1 from public.education_outreach_events e where e.id=(record->>'event_id')::uuid
        and e.workspace_id=public.current_workspace_id() and public.education_business_access('events',to_jsonb(e),false)));
    else return false;
  end case;
end $$;
create or replace function public.save_education_business(resource text,record_id uuid,expected_revision integer,data jsonb) returns jsonb
language plpgsql security definer set search_path=public,app_auth,extensions as $$
declare table_name text; fields text[]; old_row jsonb; candidate jsonb; result jsonb; column_list text; update_list text; related uuid;
begin
  if resource='events' then perform public.lock_commercial_relations(public.current_workspace_id()); end if;
  if resource='events' and jsonb_typeof(data)='object' and not data ?| array['campaign_id','product_id','cohort_id'] then
    select jsonb_build_object('campaign_id',campaign_id,'product_id',product_id,'cohort_id',cohort_id)
      into old_row from public.education_outreach_events where id=record_id and workspace_id=public.current_workspace_id();
    data:=data||coalesce(old_row,jsonb_build_object('campaign_id',null,'product_id',null,'cohort_id',null));
  end if;
  case resource
    when 'participations' then table_name:='education_event_participations';fields:=array['event_id','household_id','party_size','status','next_action'];
    when 'applications' then table_name:='student_application_tasks';fields:=array['student_id','title','due_on','status','next_action'];
    when 'organizations' then table_name:='organization_business_profiles';fields:=array['organization_type','roles','partnership_stage','primary_contact_id','focus_regions','agreement_expires_on','next_action'];
    when 'needs' then table_name:='family_education_needs';fields:=array['services','target_regions','budget_min','budget_max','budget_currency','target_intake','decision_stage','next_action'];
    when 'pathways' then table_name:='student_pathways';fields:=array['student_id','program_type','target_organization_id','target_region','target_major','intake_date','application_deadline','language_test','language_score','stage','next_action'];
    when 'events' then table_name:='education_outreach_events';fields:=array['campaign_id','product_id','cohort_id','name','organization_id','partner_organization_id','kind','starts_on','ends_on','location','capacity','attendee_count','status','next_action'];
    when 'referrals' then table_name:='education_family_referrals';fields:=array['source_organization_id','household_id','event_id','introduced_by_contact_id','referred_on','status','next_action'];
    else raise exception 'business_input_invalid';
  end case;
  if record_id is null or jsonb_typeof(data) is distinct from 'object' or expected_revision<=0
    or not data ?& fields or exists(select 1 from jsonb_object_keys(data) k where not k=any(fields||case when resource in ('organizations','needs') then array['id'] else array[]::text[] end))
    or (resource in ('organizations','needs') and (data->>'id') is distinct from record_id::text)
    then raise exception 'business_input_invalid'; end if;
  candidate:=data||jsonb_build_object('id',record_id,'workspace_id',public.current_workspace_id(),'revision',1,'updated_at',clock_timestamp());
  if resource='needs' and ((data->>'budget_min')::numeric<>round((data->>'budget_min')::numeric,2)
    or (data->>'budget_max')::numeric<>round((data->>'budget_max')::numeric,2)) then raise exception 'business_input_invalid'; end if;
  if not public.education_business_access(resource,candidate,true) then raise exception 'business_update_forbidden'; end if;
  -- Optional people are checked separately; referential integrity alone is not authorization.
  related:=coalesce((data->>'primary_contact_id')::uuid,(data->>'introduced_by_contact_id')::uuid);
  if related is not null and (not public.customer_subject_access('CONTACT',related,false) or not exists(select 1 from public.contacts c
    where c.id=related and c.workspace_id=public.current_workspace_id() and coalesce(c.do_not_contact_reason,'') not like 'PRIVACY_DELETION:%'))
    then raise exception 'business_related_not_found'; end if;
  if resource='referrals' and data->>'event_id' is not null then
    perform 1 from public.education_outreach_events e where e.id=(data->>'event_id')::uuid and e.workspace_id=public.current_workspace_id() for share;
  end if;
  if resource='referrals' and data->>'event_id' is not null and not exists(select 1 from public.education_outreach_events e
    where e.id=(data->>'event_id')::uuid and e.workspace_id=public.current_workspace_id()
      and (e.organization_id=(data->>'source_organization_id')::uuid or e.partner_organization_id=(data->>'source_organization_id')::uuid))
    then raise exception 'business_event_source_mismatch'; end if;
  -- One workspace/id lock serializes create and edit, including uncertain retries.
  perform pg_advisory_xact_lock(hashtextextended('education-business:'||public.current_workspace_id()::text||resource||record_id::text,0));
  execute format('select to_jsonb(r) from public.%I r where id=$1 and workspace_id=$2 for update',table_name)
    into old_row using record_id,public.current_workspace_id();
  if old_row is not null then
    if not public.education_business_access(resource,old_row,true) then raise exception 'business_update_forbidden'; end if;
    -- Parents of persisted records are immutable; move identity via the existing customer workflows.
    if resource in ('pathways','applications') and old_row->'student_id' is distinct from data->'student_id'
      or resource='participations' and (old_row->'event_id' is distinct from data->'event_id' or old_row->'household_id' is distinct from data->'household_id')
      or resource='events' and old_row->'organization_id' is distinct from data->'organization_id'
      or resource='referrals' and (old_row->'source_organization_id' is distinct from data->'source_organization_id' or old_row->'household_id' is distinct from data->'household_id')
      then raise exception 'business_parent_immutable'; end if;
    if expected_revision is null or (old_row->>'revision')::integer<>expected_revision then
      if (expected_revision is null and (old_row->>'revision')::integer=1 or (old_row->>'revision')::integer=expected_revision+1)
        and not exists(select 1 from unnest(fields) f where old_row->f is distinct from data->f) then return old_row; end if;
      raise exception 'business_version_conflict';
    end if;
    candidate:=candidate||jsonb_build_object('revision',expected_revision+1);
    select string_agg(format('%I=v.%I',f,f),',') into update_list from unnest(fields||array['revision','updated_at']) f;
    execute format('update public.%I t set %s from jsonb_populate_record(null::public.%I,$1) v where t.id=$2 and t.workspace_id=$3 returning to_jsonb(t)',table_name,update_list,table_name)
      into result using candidate,record_id,public.current_workspace_id();
  else
    if expected_revision is not null then raise exception 'business_record_not_found'; end if;
    fields:=fields||array['id','workspace_id','revision','updated_at'];
    select string_agg(format('%I',f),',') into column_list from unnest(fields) f;
    execute format('insert into public.%I(%s) select %s from jsonb_populate_record(null::public.%I,$1) returning to_jsonb(%I)',table_name,column_list,column_list,table_name,table_name)
      into result using candidate;
  end if;
  if resource='organizations' then
    update public.organizations set organization_type=data->>'organization_type',updated_at=clock_timestamp() where id=record_id and workspace_id=public.current_workspace_id();
  end if;
  -- Do not allow an activity edit to invalidate already-recorded attribution.
  if resource='events' and exists(select 1 from public.education_family_referrals r where r.event_id=record_id
    and r.workspace_id=public.current_workspace_id() and r.source_organization_id<>(result->>'organization_id')::uuid
    and r.source_organization_id is distinct from (result->>'partner_organization_id')::uuid)
    then raise exception 'business_event_source_mismatch'; end if;
  insert into public.audit_events(workspace_id,actor_id,action,entity_type,entity_id,after_data)
    values(public.current_workspace_id(),app_auth.current_user_id(),'EDUCATION_BUSINESS_SAVED','EDUCATION_BUSINESS',record_id,
      jsonb_build_object('resource',resource,'revision',result->'revision'));
  return result;
end $$;
drop function public.create_buyer_quote(text,uuid,uuid,uuid,uuid,uuid,uuid,text,numeric,numeric,date,text,text);
create or replace function public.create_buyer_quote(
  quote_no text,target_organization uuid,target_household uuid,target_opportunity uuid,target_product uuid,
  target_bundle uuid,target_exchange_rate uuid,quote_currency text,
  quote_subtotal numeric,quote_discount numeric,valid_through date,
  terms_zh text default '',terms_en text default '',target_cohort uuid default null
)
returns public.quotes
language plpgsql
security definer
set search_path=public,app_auth,extensions
as $$
declare
  result public.quotes;
  organization public.organizations;
  bundle public.product_bundles;
  rate public.exchange_rate_snapshots;
  base text;
  base_total numeric;
  line_items jsonb:='[]'::jsonb;
  ceiling numeric;
begin
  if public.current_crm_role() not in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER','SALES_SPECIALIST')
    then raise exception 'quote_not_authorized'; end if;
  if num_nonnulls(target_organization,target_household)<>1 or not public.customer_subject_access(
    case when target_household is null then 'ORGANIZATION' else 'HOUSEHOLD' end,coalesce(target_household,target_organization),true)
    then raise exception 'quote_not_authorized'; end if;
  organization.workspace_id:=public.current_workspace_id(); organization.id:=target_organization;
  if target_cohort is not null and (target_product is null or not exists(
    select 1 from public.product_cohorts where id=target_cohort and workspace_id=organization.workspace_id and product_id=target_product
  )) then raise exception 'commercial_cohort_mismatch'; end if;
  if (target_product is null)=(target_bundle is null) then raise exception 'quote_product_or_bundle_required'; end if;
  if target_product is not null and not exists(select 1 from public.products where id=target_product and workspace_id=organization.workspace_id and active and archived_at is null)
    then raise exception 'quote_product_invalid'; end if;
  if target_opportunity is not null and not exists(select 1 from public.opportunities o where o.id=target_opportunity and o.workspace_id=organization.workspace_id
    and o.organization_id is not distinct from target_organization and o.household_id is not distinct from target_household
    and public.can_access_owned_record(o.workspace_id,'OPPORTUNITY',o.id,o.owner_id,false)) then raise exception 'quote_opportunity_invalid'; end if;
  if quote_no is null or quote_currency is null or quote_subtotal is null or quote_discount is null or valid_through is null
    or quote_subtotal<>round(quote_subtotal,2) or quote_discount<>round(quote_discount,2) then raise exception 'quote_invalid'; end if;
  select default_currency into base from public.workspaces where id=organization.workspace_id;
  if nullif(trim(quote_no),'') is null or upper(quote_currency)!~'^[A-Z]{3}$'
    or quote_subtotal<0 or quote_discount<0 or quote_discount>quote_subtotal
    or valid_through<current_date then raise exception 'quote_invalid'; end if;
  if target_bundle is not null then
    select * into bundle from public.product_bundles
      where id=target_bundle and workspace_id=organization.workspace_id
        and active and effective_to is null;
    if not found then raise exception 'quote_bundle_invalid'; end if;
    select min(discount_ceiling) into ceiling from public.product_bundle_items
      where bundle_id=bundle.id and not optional;
    if quote_subtotal>0 and quote_discount*100/quote_subtotal>coalesce(ceiling,0) then
      raise exception 'quote_bundle_discount_exceeded';
    end if;
    select coalesce(jsonb_agg(jsonb_build_object(
      'productId',i.product_id,'quantity',i.quantity,'optional',i.optional,
      'discountCeiling',i.discount_ceiling,'bundleId',bundle.id,
      'bundleVersion',bundle.version
    ) order by p.code),'[]'::jsonb) into line_items
    from public.product_bundle_items i join public.products p on p.id=i.product_id
    where i.bundle_id=bundle.id;
  end if;
  if upper(quote_currency)=base then
    if target_exchange_rate is not null then raise exception 'quote_exchange_rate_invalid'; end if;
    base_total:=quote_subtotal-quote_discount;
  else
    select * into rate from public.exchange_rate_snapshots rates
      where rates.id=target_exchange_rate
        and rates.workspace_id=organization.workspace_id
        and rates.base_currency=base
        and rates.quote_currency=upper(create_buyer_quote.quote_currency)
        and rates.effective_at<=now();
    if not found then raise exception 'quote_exchange_rate_required'; end if;
    base_total:=round((quote_subtotal-quote_discount)/rate.rate,2);
  end if;
  insert into public.quotes(
    workspace_id,quote_number,organization_id,household_id,opportunity_id,product_id,cohort_id,
    currency,valid_until,owner_id,created_by
  ) values(
    organization.workspace_id,trim(quote_no),organization.id,target_household,target_opportunity,
    coalesce(target_product,(select product_id from public.product_bundle_items
      where bundle_id=bundle.id and not optional order by product_id limit 1)),
    target_cohort,upper(quote_currency),valid_through,app_auth.current_user_id(),app_auth.current_user_id()
  ) returning * into result;
  insert into public.quote_versions(
    workspace_id,quote_id,version,subtotal,discount_amount,terms_zh,terms_en,
    line_items,bundle_id,bundle_version,exchange_rate_snapshot_id,
    base_currency,base_total_amount,created_by
  ) values(
    result.workspace_id,result.id,1,quote_subtotal,quote_discount,
    trim(coalesce(terms_zh,'')),trim(coalesce(terms_en,'')),line_items,
    bundle.id,bundle.version,rate.id,base,base_total,app_auth.current_user_id()
  );
  return result;
end;
$$;
revoke all on function public.create_buyer_quote(text,uuid,uuid,uuid,uuid,uuid,uuid,text,numeric,numeric,date,text,text,uuid) from public,crm_system;
grant execute on function public.create_buyer_quote(text,uuid,uuid,uuid,uuid,uuid,uuid,text,numeric,numeric,date,text,text,uuid) to crm_app;
drop function public.change_opportunity_stage(uuid,text,integer,date,text,text,text,text);
create or replace function public.change_opportunity_stage(
  target_opportunity uuid,next_stage text,next_probability integer,
  next_expected_close date,next_action_zh text,next_action_en text,
  stage_reason text default '',stage_evidence text default '',commercial_context jsonb default null,expected_revision integer default null,p_request_key text default null
)
returns public.opportunities
language plpgsql
security definer
set search_path=public,app_auth,extensions
as $$
declare
  current public.opportunities;
  result public.opportunities;
  normalized_stage text:=upper(next_stage); receipt public.mutation_receipts; fingerprint text;
begin
  perform public.lock_commercial_relations(public.current_workspace_id());
  select * into current from public.opportunities
    where id=target_opportunity and workspace_id=public.current_workspace_id() for update;
  if not found
    or not public.can_access_owned_record(
      current.workspace_id,'OPPORTUNITY',current.id,current.owner_id,true
    ) then
    raise exception 'opportunity_not_authorized';
  end if;
  if commercial_context is not null then
    if expected_revision is null or expected_revision<1 or p_request_key is null or length(p_request_key) not between 8 and 160
      or jsonb_typeof(commercial_context) is distinct from 'object' or not commercial_context ?& array['product_id','cohort_id']
      or exists(select 1 from jsonb_object_keys(commercial_context) k where k not in ('product_id','cohort_id')) then raise exception 'commercial_input_invalid'; end if;
    perform pg_advisory_xact_lock(hashtextextended(current.workspace_id::text||':'||p_request_key,0));
    fingerprint:=encode(extensions.digest(jsonb_build_array(app_auth.current_user_id(),target_opportunity,next_stage,next_probability,next_expected_close,$5,$6,stage_reason,stage_evidence,commercial_context,expected_revision)::text,'sha256'),'hex');
    select * into receipt from public.mutation_receipts where workspace_id=current.workspace_id and request_key=p_request_key;
    if found then
      if receipt.operation<>'OPPORTUNITY_COMMERCIAL_SAVE' or receipt.created_by<>app_auth.current_user_id() or receipt.result->>'fingerprint' is distinct from fingerprint then raise exception 'commercial_request_conflict'; end if;
      return jsonb_populate_record(null::public.opportunities,receipt.result->'item');
    end if;
    if current.revision<>expected_revision then raise exception 'commercial_version_conflict'; end if;
  end if;
  if commercial_context is not null and normalized_stage<>current.stage then raise exception 'commercial_input_invalid'; end if;
  if normalized_stage not in ('DISCOVERY','EVALUATION','HESITATION','PAYMENT','WON','LOST')
    or next_probability not between 0 and 100 then
    raise exception 'opportunity_stage_invalid';
  end if;
  if normalized_stage='WON' and next_probability<>100 then
    raise exception 'opportunity_probability_invalid';
  end if;
  if normalized_stage='LOST' and next_probability<>0 then
    raise exception 'opportunity_probability_invalid';
  end if;
  update public.opportunities set
    product_id=case when commercial_context is null then current.product_id else (commercial_context->>'product_id')::uuid end,
    cohort_id=case when commercial_context is null then current.cohort_id else (commercial_context->>'cohort_id')::uuid end,
    stage=normalized_stage,probability=next_probability,
    expected_close_date=case
      when normalized_stage in ('WON','LOST') then current.expected_close_date
      else next_expected_close end,
    next_action_zh=case
      when normalized_stage in ('WON','LOST') then current.next_action_zh else trim($5) end,
    next_action_en=case
      when normalized_stage in ('WON','LOST') then current.next_action_en else trim($6) end,
    lost_reason=case when commercial_context is not null then current.lost_reason when normalized_stage='LOST' then trim(stage_reason) else null end,
    won_evidence=case when commercial_context is not null then current.won_evidence when normalized_stage='WON' then trim(stage_evidence) else '' end,
    closed_at=case when normalized_stage in ('WON','LOST') then now() else null end,
    updated_at=now()
  where id=current.id returning * into result;
  if commercial_context is null or current.stage<>result.stage then
  insert into public.opportunity_stage_history(
    workspace_id,opportunity_id,from_stage,to_stage,reason,evidence,changed_by
  ) values(
    result.workspace_id,result.id,current.stage,result.stage,
    trim(coalesce(stage_reason,'')),trim(coalesce(stage_evidence,'')),app_auth.current_user_id()
  );
  end if;
  if commercial_context is not null then
    insert into public.mutation_receipts(workspace_id,request_key,operation,result,created_by) values(current.workspace_id,p_request_key,'OPPORTUNITY_COMMERCIAL_SAVE',jsonb_build_object('fingerprint',fingerprint,'item',to_jsonb(result)),app_auth.current_user_id());
  end if;
  return result;
end;
$$;

revoke all on function public.change_opportunity_stage(uuid,text,integer,date,text,text,text,text,jsonb,integer,text) from public,crm_system;
grant execute on function public.change_opportunity_stage(uuid,text,integer,date,text,text,text,text,jsonb,integer,text) to crm_app;
