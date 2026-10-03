-- Student × Cohort and business attribution; no name/text backfill.
set search_path=public,app_auth,extensions;

-- Existing identities for students/households/contacts/organizations/cohorts/opportunities
-- come from migrations 025, 087 and 091. Add only the missing source identities.
alter table public.growth_campaigns add constraint growth_campaigns_workspace_identity unique(workspace_id,id);
alter table public.education_family_referrals add constraint education_family_referrals_workspace_identity unique(workspace_id,id);

create table public.student_enrollments(
  id uuid primary key default gen_random_uuid(),workspace_id uuid not null default public.current_workspace_id() references public.workspaces(id),
  student_id uuid not null,cohort_id uuid not null,household_id uuid,opportunity_id uuid,
  status text not null default 'LEAD' check(status in ('LEAD','INTERESTED','REGISTERING','ACTIVE','COMPLETED','WITHDRAWN','CANCELLED')),
  owner_id uuid not null default app_auth.current_user_id(),sales_owner_id uuid,
  enrolled_at timestamptz,completed_at timestamptz,withdrawn_at timestamptz,
  withdrawal_reason text not null default '' check(length(withdrawal_reason)<=1000),
  revision integer not null default 1 check(revision>0),created_by uuid references app_auth.accounts(id),
  created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),
  unique(workspace_id,id),unique(workspace_id,student_id,cohort_id),
  foreign key(workspace_id,student_id) references public.students(workspace_id,id) on delete cascade,
  foreign key(workspace_id,cohort_id) references public.product_cohorts(workspace_id,id),
  foreign key(workspace_id,household_id) references public.households(workspace_id,id) on delete set null(household_id),
  foreign key(workspace_id,opportunity_id) references public.opportunities(workspace_id,id) on delete set null(opportunity_id),
  foreign key(workspace_id,owner_id) references public.workspace_memberships(workspace_id,user_id),
  foreign key(workspace_id,sales_owner_id) references public.workspace_memberships(workspace_id,user_id),
  constraint student_enrollments_lifecycle_check check(
    (status not in ('ACTIVE','COMPLETED') or enrolled_at is not null)
    and (status<>'COMPLETED' or completed_at is not null)
    and (completed_at is null or (enrolled_at is not null and completed_at>=enrolled_at))
    and (status<>'WITHDRAWN' or (withdrawn_at is not null and length(trim(withdrawal_reason))>0))
    and (withdrawn_at is null or enrolled_at is null or withdrawn_at>=enrolled_at))
);
create index student_enrollments_student_idx on public.student_enrollments(workspace_id,student_id,updated_at desc,id);
create index student_enrollments_cohort_status_idx on public.student_enrollments(workspace_id,cohort_id,status,updated_at desc,id);
create index student_enrollments_owner_status_idx on public.student_enrollments(workspace_id,owner_id,status,updated_at desc,id);
create index student_enrollments_status_idx on public.student_enrollments(workspace_id,status,updated_at desc,id);
create index student_enrollments_opportunity_idx on public.student_enrollments(workspace_id,opportunity_id) where opportunity_id is not null;

create table public.student_enrollment_status_history(
  id bigint generated always as identity primary key,workspace_id uuid not null references public.workspaces(id),enrollment_id uuid not null,
  enrollment_revision integer not null check(enrollment_revision>0),
  from_status text check(from_status in ('LEAD','INTERESTED','REGISTERING','ACTIVE','COMPLETED','WITHDRAWN','CANCELLED')),
  to_status text not null check(to_status in ('LEAD','INTERESTED','REGISTERING','ACTIVE','COMPLETED','WITHDRAWN','CANCELLED')),
  changed_at timestamptz not null default clock_timestamp(),changed_by uuid references app_auth.accounts(id),
  reason text not null default '' check(length(reason)<=1000),check(from_status is null or from_status<>to_status),
  unique(workspace_id,enrollment_id,enrollment_revision),
  foreign key(workspace_id,enrollment_id) references public.student_enrollments(workspace_id,id) on delete cascade
);
create index enrollment_status_history_time_idx on public.student_enrollment_status_history(workspace_id,enrollment_id,changed_at,id);

create table public.enrollment_attributions(
  id uuid primary key default gen_random_uuid(),workspace_id uuid not null default public.current_workspace_id() references public.workspaces(id),enrollment_id uuid not null,
  attribution_type text not null check(attribution_type in ('PRIMARY','ASSIST')),
  source_organization_id uuid,source_contact_id uuid,source_event_id uuid,source_campaign_id uuid,source_referral_id uuid,
  note text not null default '' check(length(note)<=1000),created_by uuid references app_auth.accounts(id),created_at timestamptz not null default clock_timestamp(),
  foreign key(workspace_id,enrollment_id) references public.student_enrollments(workspace_id,id) on delete cascade,
  foreign key(workspace_id,source_organization_id) references public.organizations(workspace_id,id),
  foreign key(workspace_id,source_contact_id) references public.contacts(workspace_id,id),
  foreign key(workspace_id,source_event_id) references public.education_outreach_events(workspace_id,id),
  foreign key(workspace_id,source_campaign_id) references public.growth_campaigns(workspace_id,id),
  foreign key(workspace_id,source_referral_id) references public.education_family_referrals(workspace_id,id),
  constraint enrollment_attributions_source_check check(num_nonnulls(source_organization_id,source_contact_id,source_event_id,source_campaign_id,source_referral_id)>0)
);
create unique index enrollment_attributions_primary_uidx on public.enrollment_attributions(workspace_id,enrollment_id) where attribution_type='PRIMARY';
create index enrollment_attributions_enrollment_idx on public.enrollment_attributions(workspace_id,enrollment_id,created_at,id);
create index enrollment_attributions_contact_idx on public.enrollment_attributions(workspace_id,source_contact_id) where source_contact_id is not null;

create function public.student_enrollment_access(record jsonb,edit boolean default false) returns boolean
language plpgsql stable security definer set search_path=public,app_auth,extensions as $$
begin
  if app_auth.current_user_id() is null or record->>'workspace_id' is distinct from public.current_workspace_id()::text
    or not public.is_workspace_member(public.current_workspace_id()) then return false; end if;
  if edit and public.current_crm_role() not in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER','SALES_SPECIALIST','SALES_SUPPORT') then return false; end if;
  return public.education_business_student_access((record->>'student_id')::uuid,edit)
    and exists(select 1 from public.product_cohorts c where c.id=(record->>'cohort_id')::uuid and c.workspace_id=public.current_workspace_id())
    and (record->>'household_id' is null or public.customer_subject_access('HOUSEHOLD',(record->>'household_id')::uuid,false))
    and (record->>'opportunity_id' is null or exists(select 1 from public.opportunities o where o.id=(record->>'opportunity_id')::uuid
      and o.workspace_id=public.current_workspace_id() and public.can_access_owned_record(o.workspace_id,'OPPORTUNITY',o.id,o.owner_id,false)))
    and (public.can_access_owned_record(public.current_workspace_id(),'ENROLLMENT',(record->>'id')::uuid,(record->>'owner_id')::uuid,edit)
      or (record->>'sales_owner_id' is not null and public.can_access_owned_record(public.current_workspace_id(),'ENROLLMENT',(record->>'id')::uuid,(record->>'sales_owner_id')::uuid,edit)));
end $$;
revoke all on function public.student_enrollment_access(jsonb,boolean) from public;
grant execute on function public.student_enrollment_access(jsonb,boolean) to crm_app;

create function public.enrollment_attribution_access(record jsonb,edit boolean default false) returns boolean
language plpgsql stable security definer set search_path=public,app_auth,extensions as $$
begin
  if record->>'workspace_id' is distinct from public.current_workspace_id()::text
    or not exists(select 1 from public.student_enrollments e where e.id=(record->>'enrollment_id')::uuid
      and e.workspace_id=public.current_workspace_id() and public.student_enrollment_access(to_jsonb(e),edit)) then return false; end if;
  return (record->>'source_organization_id' is null or public.customer_subject_access('ORGANIZATION',(record->>'source_organization_id')::uuid,false))
    and (record->>'source_contact_id' is null or (public.customer_subject_access('CONTACT',(record->>'source_contact_id')::uuid,false)
      and exists(select 1 from public.contacts c where c.id=(record->>'source_contact_id')::uuid and c.workspace_id=public.current_workspace_id()
        and coalesce(c.do_not_contact_reason,'') not like 'PRIVACY_DELETION:%')))
    and (record->>'source_event_id' is null or exists(select 1 from public.education_outreach_events x where x.id=(record->>'source_event_id')::uuid
      and x.workspace_id=public.current_workspace_id() and public.education_business_access('events',to_jsonb(x),false)))
    and (record->>'source_campaign_id' is null or exists(select 1 from public.growth_campaigns x where x.id=(record->>'source_campaign_id')::uuid and x.workspace_id=public.current_workspace_id()))
    and (record->>'source_referral_id' is null or exists(select 1 from public.education_family_referrals x where x.id=(record->>'source_referral_id')::uuid
      and x.workspace_id=public.current_workspace_id() and public.education_business_access('referrals',to_jsonb(x),false)));
end $$;
revoke all on function public.enrollment_attribution_access(jsonb,boolean) from public;
grant execute on function public.enrollment_attribution_access(jsonb,boolean) to crm_app;

do $$ declare tbl text; begin
  foreach tbl in array array['student_enrollments','student_enrollment_status_history','enrollment_attributions'] loop
    execute format('alter table public.%I enable row level security',tbl);
    execute format('revoke all on public.%I from public,crm_app',tbl);
    execute format('grant select on public.%I to crm_app,crm_worker',tbl);
    execute format('create policy enrollment_privacy_worker_read on public.%I for select to crm_worker using(true)',tbl);
  end loop;
end $$;
create policy enrollment_read on public.student_enrollments for select to crm_app using(public.student_enrollment_access(to_jsonb(student_enrollments),false));
create policy enrollment_history_read on public.student_enrollment_status_history for select to crm_app using(exists(
  select 1 from public.student_enrollments e where e.id=enrollment_id and e.workspace_id=student_enrollment_status_history.workspace_id));
create policy enrollment_attribution_read on public.enrollment_attributions for select to crm_app using(public.enrollment_attribution_access(to_jsonb(enrollment_attributions),false));

create function public.guard_enrollment_identity() returns trigger language plpgsql set search_path=public,app_auth,extensions as $$
begin
  if new.id is distinct from old.id or new.workspace_id is distinct from old.workspace_id or new.student_id is distinct from old.student_id or new.cohort_id is distinct from old.cohort_id
    then raise exception 'enrollment_parent_immutable'; end if;
  return new;
end $$;
create trigger enrollment_identity_immutable before update on public.student_enrollments for each row execute function public.guard_enrollment_identity();
create function public.guard_enrollment_history() returns trigger language plpgsql set search_path=public,app_auth,extensions as $$
begin raise exception 'enrollment_history_immutable'; end $$;
create trigger enrollment_history_immutable before update on public.student_enrollment_status_history for each row execute function public.guard_enrollment_history();
revoke all on function public.guard_enrollment_identity(),public.guard_enrollment_history() from public;

-- The operational history is recorded by a trigger in the same transaction, even
-- for maintenance status writes. Ordinary-field edits do not create stage entries.
create function public.record_enrollment_status() returns trigger
language plpgsql security definer set search_path=public,app_auth,extensions as $$
begin
  if tg_op='INSERT' or new.status is distinct from old.status then
    insert into public.student_enrollment_status_history(workspace_id,enrollment_id,enrollment_revision,from_status,to_status,changed_at,changed_by,reason)
      values(new.workspace_id,new.id,new.revision,case when tg_op='INSERT' then null else old.status end,new.status,new.updated_at,app_auth.current_user_id(),
        case when new.status='WITHDRAWN' then new.withdrawal_reason else coalesce(current_setting('app.enrollment_status_reason',true),'') end);
  end if;
  return new;
end $$;
revoke all on function public.record_enrollment_status() from public;
create trigger enrollment_status_record after insert or update of status on public.student_enrollments for each row execute function public.record_enrollment_status();

create function public.save_student_enrollment(record_id uuid,expected_revision integer,data jsonb,p_request_key text,status_reason text default '')
returns public.student_enrollments language plpgsql security definer set search_path=public,app_auth,extensions as $$
declare ws uuid:=public.current_workspace_id(); actor uuid:=app_auth.current_user_id();
  previous public.student_enrollments; candidate public.student_enrollments; result public.student_enrollments; receipt public.mutation_receipts;
  request_hash text; cohort public.product_cohorts; op public.opportunities;
  fields text[]:=array['student_id','cohort_id','household_id','opportunity_id','status','owner_id','sales_owner_id','enrolled_at','completed_at','withdrawn_at','withdrawal_reason'];
begin
  if actor is null or ws is null or not public.is_workspace_member(ws) or public.current_crm_role() not in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER','SALES_SPECIALIST','SALES_SUPPORT') then raise exception 'enrollment_update_forbidden'; end if;
  if record_id is null or expected_revision<=0 or p_request_key is null or length(p_request_key) not between 8 and 160
    or status_reason is null or length(status_reason)>1000 or jsonb_typeof(data) is distinct from 'object' or not data ?& fields
    or exists(select 1 from jsonb_object_keys(data) k where not k=any(fields)) then raise exception 'enrollment_input_invalid'; end if;
  request_hash:=encode(extensions.digest(jsonb_build_object('actor',actor,'id',record_id,'revision',expected_revision,'data',data,'reason',status_reason)::text,'sha256'),'hex');
  perform pg_advisory_xact_lock(hashtextextended(ws::text||':'||p_request_key,0));
  candidate:=jsonb_populate_record(null::public.student_enrollments,data);
  candidate.id:=record_id;candidate.workspace_id:=ws;
  -- Contact locks serialize privacy pseudonymization with enrollment saves.
  perform 1 from public.students s join public.contacts c on c.id=s.person_id and c.workspace_id=s.workspace_id
    where s.id=candidate.student_id and s.workspace_id=ws for share of s,c;
  if not found or not public.education_business_student_access(candidate.student_id,true) then raise exception 'enrollment_student_not_found'; end if;
  select * into cohort from public.product_cohorts where id=candidate.cohort_id and workspace_id=ws for share;
  if not found then raise exception 'enrollment_cohort_not_found'; end if;
  select * into receipt from public.mutation_receipts where workspace_id=ws and request_key=p_request_key;
  if found then
    if receipt.operation<>'ENROLLMENT_SAVE' or receipt.created_by<>actor or receipt.result->>'request_hash' is distinct from request_hash then raise exception 'enrollment_request_conflict'; end if;
    if not exists(select 1 from public.student_enrollments e where e.id=record_id and e.workspace_id=ws and public.student_enrollment_access(to_jsonb(e),true)) then raise exception 'enrollment_update_forbidden'; end if;
    return jsonb_populate_record(null::public.student_enrollments,receipt.result->'item');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('student-enrollment:'||record_id::text,0));
  select * into previous from public.student_enrollments where id=record_id and workspace_id=ws for update;
  if found then
    if not public.student_enrollment_access(to_jsonb(previous),true) then raise exception 'enrollment_update_forbidden'; end if;
    if previous.student_id is distinct from candidate.student_id or previous.cohort_id is distinct from candidate.cohort_id then raise exception 'enrollment_parent_immutable'; end if;
    if expected_revision is null or previous.revision<>expected_revision then raise exception 'enrollment_version_conflict'; end if;
  else
    if expected_revision is not null then raise exception 'enrollment_not_found'; end if;
    if cohort.status not in ('DRAFT','RECRUITING','ACTIVE') then raise exception 'enrollment_cohort_closed'; end if;
  end if;
  if candidate.owner_id is null or not exists(select 1 from public.workspace_memberships where workspace_id=ws and user_id=candidate.owner_id and status='ACTIVE')
    or (candidate.sales_owner_id is not null and not exists(select 1 from public.workspace_memberships where workspace_id=ws and user_id=candidate.sales_owner_id and status='ACTIVE'))
    or ((previous.id is null or previous.owner_id is distinct from candidate.owner_id) and not public.can_assign_crm_task(candidate.owner_id))
    or (candidate.sales_owner_id is not null and (previous.id is null or previous.sales_owner_id is distinct from candidate.sales_owner_id) and not public.can_assign_crm_task(candidate.sales_owner_id))
    then raise exception 'enrollment_owner_invalid'; end if;
  if not public.student_enrollment_access(to_jsonb(candidate),true) then raise exception 'enrollment_related_forbidden'; end if;
  if candidate.opportunity_id is not null then
    select * into op from public.opportunities where id=candidate.opportunity_id and workspace_id=ws for share;
    if not found or (op.product_id is not null and op.product_id<>cohort.product_id)
      or (to_jsonb(op)->>'cohort_id' is not null and to_jsonb(op)->>'cohort_id'<>cohort.id::text) then raise exception 'enrollment_opportunity_mismatch'; end if;
  end if;
  perform set_config('app.enrollment_status_reason',status_reason,true);
  if previous.id is null then
    insert into public.student_enrollments(id,workspace_id,student_id,cohort_id,household_id,opportunity_id,status,owner_id,sales_owner_id,enrolled_at,completed_at,withdrawn_at,withdrawal_reason,created_by)
      values(record_id,ws,candidate.student_id,candidate.cohort_id,candidate.household_id,candidate.opportunity_id,candidate.status,candidate.owner_id,candidate.sales_owner_id,
        candidate.enrolled_at,candidate.completed_at,candidate.withdrawn_at,trim(candidate.withdrawal_reason),actor) returning * into result;
  else
    update public.student_enrollments set household_id=candidate.household_id,opportunity_id=candidate.opportunity_id,status=candidate.status,
      owner_id=candidate.owner_id,sales_owner_id=candidate.sales_owner_id,enrolled_at=candidate.enrolled_at,completed_at=candidate.completed_at,
      withdrawn_at=candidate.withdrawn_at,withdrawal_reason=trim(candidate.withdrawal_reason),revision=previous.revision+1,updated_at=clock_timestamp()
      where id=record_id and workspace_id=ws returning * into result;
  end if;
  perform set_config('app.enrollment_status_reason','',true);
  -- Governance metadata only; no names, reasons, notes or duplicated student profile.
  insert into public.audit_events(workspace_id,actor_id,action,entity_type,entity_id,before_data,after_data)
    values(ws,actor,case when previous.id is null then 'STUDENT_ENROLLMENT_CREATED' else 'STUDENT_ENROLLMENT_UPDATED' end,'STUDENT_ENROLLMENT',record_id,
      case when previous.id is null then null else jsonb_build_object('revision',previous.revision,'status',previous.status) end,
      jsonb_build_object('revision',result.revision,'status',result.status));
  insert into public.mutation_receipts(workspace_id,request_key,operation,result,created_by)
    values(ws,p_request_key,'ENROLLMENT_SAVE',jsonb_build_object('request_hash',request_hash,'item',to_jsonb(result)),actor);
  return result;
end $$;
revoke all on function public.save_student_enrollment(uuid,integer,jsonb,text,text) from public;
grant execute on function public.save_student_enrollment(uuid,integer,jsonb,text,text) to crm_app;

-- Attribution is additive in this phase. No hard-delete or source-rewrite endpoint.
create function public.save_enrollment_attribution(record_id uuid,data jsonb,p_request_key text) returns public.enrollment_attributions
language plpgsql security definer set search_path=public,app_auth,extensions as $$
declare ws uuid:=public.current_workspace_id();actor uuid:=app_auth.current_user_id();candidate public.enrollment_attributions;result public.enrollment_attributions;
  receipt public.mutation_receipts;request_hash text;
  fields text[]:=array['enrollment_id','attribution_type','source_organization_id','source_contact_id','source_event_id','source_campaign_id','source_referral_id','note'];
begin
  if actor is null or ws is null or not public.is_workspace_member(ws) then raise exception 'enrollment_update_forbidden'; end if;
  if record_id is null or p_request_key is null or length(p_request_key) not between 8 and 160 or jsonb_typeof(data) is distinct from 'object'
    or not data ?& fields or exists(select 1 from jsonb_object_keys(data) k where not k=any(fields)) then raise exception 'enrollment_input_invalid'; end if;
  candidate:=jsonb_populate_record(null::public.enrollment_attributions,data);candidate.id:=record_id;candidate.workspace_id:=ws;
  perform pg_advisory_xact_lock(hashtextextended(ws::text||':'||p_request_key,0));
  perform 1 from public.students s join public.student_enrollments e on e.student_id=s.id and e.workspace_id=s.workspace_id
    join public.contacts c on c.id=s.person_id and c.workspace_id=s.workspace_id where e.id=candidate.enrollment_id and e.workspace_id=ws for share of s,c;
  if candidate.source_contact_id is not null then perform 1 from public.contacts where id=candidate.source_contact_id and workspace_id=ws for share; end if;
  if not public.enrollment_attribution_access(to_jsonb(candidate),true) then raise exception 'enrollment_source_forbidden'; end if;
  request_hash:=encode(extensions.digest(jsonb_build_object('actor',actor,'id',record_id,'data',data)::text,'sha256'),'hex');
  select * into receipt from public.mutation_receipts where workspace_id=ws and request_key=p_request_key;
  if found then
    if receipt.operation<>'ENROLLMENT_ATTRIBUTION_SAVE' or receipt.created_by<>actor or receipt.result->>'request_hash' is distinct from request_hash then raise exception 'enrollment_request_conflict'; end if;
    return jsonb_populate_record(null::public.enrollment_attributions,receipt.result->'item');
  end if;
  insert into public.enrollment_attributions(id,workspace_id,enrollment_id,attribution_type,source_organization_id,source_contact_id,source_event_id,source_campaign_id,source_referral_id,note,created_by)
    values(record_id,ws,candidate.enrollment_id,candidate.attribution_type,candidate.source_organization_id,candidate.source_contact_id,candidate.source_event_id,candidate.source_campaign_id,candidate.source_referral_id,trim(candidate.note),actor) returning * into result;
  insert into public.audit_events(workspace_id,actor_id,action,entity_type,entity_id,after_data)
    values(ws,actor,'ENROLLMENT_ATTRIBUTION_CREATED','ENROLLMENT_ATTRIBUTION',result.id,jsonb_build_object('enrollmentId',result.enrollment_id,'type',result.attribution_type));
  insert into public.mutation_receipts(workspace_id,request_key,operation,result,created_by)
    values(ws,p_request_key,'ENROLLMENT_ATTRIBUTION_SAVE',jsonb_build_object('request_hash',request_hash,'item',to_jsonb(result)),actor);
  return result;
end $$;
revoke all on function public.save_enrollment_attribution(uuid,jsonb,text) from public;
grant execute on function public.save_enrollment_attribution(uuid,jsonb,text) to crm_app;

-- Invoker views preserve the RLS of every joined business record.
create function public.student_enrollment_has_primary(record_id uuid) returns boolean
language sql stable security definer set search_path=public,app_auth,extensions as $$
  select exists(select 1 from public.student_enrollments e where e.id=record_id and e.workspace_id=public.current_workspace_id()
    and public.student_enrollment_access(to_jsonb(e),false) and exists(select 1 from public.enrollment_attributions a
      where a.workspace_id=e.workspace_id and a.enrollment_id=e.id and a.attribution_type='PRIMARY'));
$$;
revoke all on function public.student_enrollment_has_primary(uuid) from public;
grant execute on function public.student_enrollment_has_primary(uuid) to crm_app;
create view public.student_enrollment_records with(security_invoker=true) as
  select e.*,c.name_zh student_name_zh,c.name_en student_name_en,s.student_number,
    co.name_zh cohort_name_zh,co.name_en cohort_name_en,p.name_zh product_name_zh,p.name_en product_name_en,
    h.name_zh household_name_zh,h.name_en household_name_en,u.display_name_zh owner_name_zh,u.display_name_en owner_name_en,
    su.display_name_zh sales_owner_name_zh,su.display_name_en sales_owner_name_en,op.title_zh opportunity_title_zh,op.title_en opportunity_title_en,
    public.student_enrollment_access(to_jsonb(e),true) can_edit,public.student_enrollment_has_primary(e.id) has_primary_attribution
  from public.student_enrollments e join public.students s on s.id=e.student_id and s.workspace_id=e.workspace_id
    join public.contacts c on c.id=s.person_id and c.workspace_id=e.workspace_id
    join public.product_cohorts co on co.id=e.cohort_id and co.workspace_id=e.workspace_id
    join public.products p on p.id=co.product_id and p.workspace_id=e.workspace_id
    left join public.households h on h.id=e.household_id and h.workspace_id=e.workspace_id
    left join public.user_profiles u on u.user_id=e.owner_id
    left join public.user_profiles su on su.user_id=e.sales_owner_id
    left join public.opportunities op on op.id=e.opportunity_id and op.workspace_id=e.workspace_id;
create view public.enrollment_attribution_records with(security_invoker=true) as
  select a.*,o.name_zh organization_name_zh,o.name_en organization_name_en,c.name_zh contact_name_zh,c.name_en contact_name_en,
    ev.name event_name,ca.name_zh campaign_name_zh,ca.name_en campaign_name_en,r.referred_on referral_on,
    ro.name_zh referral_organization_name_zh,ro.name_en referral_organization_name_en,rh.name_zh referral_household_name_zh,rh.name_en referral_household_name_en
  from public.enrollment_attributions a
    left join public.organizations o on o.id=a.source_organization_id and o.workspace_id=a.workspace_id
    left join public.contacts c on c.id=a.source_contact_id and c.workspace_id=a.workspace_id
    left join public.education_outreach_events ev on ev.id=a.source_event_id and ev.workspace_id=a.workspace_id
    left join public.growth_campaigns ca on ca.id=a.source_campaign_id and ca.workspace_id=a.workspace_id
    left join public.education_family_referrals r on r.id=a.source_referral_id and r.workspace_id=a.workspace_id
    left join public.organizations ro on ro.id=r.source_organization_id and ro.workspace_id=r.workspace_id
    left join public.households rh on rh.id=r.household_id and rh.workspace_id=r.workspace_id;
create view public.enrollment_referral_options with(security_invoker=true) as
  select r.id,r.workspace_id,r.referred_on,r.updated_at,o.name_zh organization_name_zh,o.name_en organization_name_en,h.name_zh household_name_zh,h.name_en household_name_en
  from public.education_family_referrals r
    join public.organizations o on o.id=r.source_organization_id and o.workspace_id=r.workspace_id
    join public.households h on h.id=r.household_id and h.workspace_id=r.workspace_id;
grant select on public.student_enrollment_records,public.enrollment_attribution_records,public.enrollment_referral_options to crm_app;

-- Explicit privacy/maintenance boundary: ordinary roles have no DELETE grant.
-- Cascades clean enrollment/history/attribution when a Student is physically purged.
create function public.cleanup_enrollment_receipts() returns trigger
language plpgsql security definer set search_path=public,app_auth,extensions as $$
begin
  delete from public.mutation_receipts where workspace_id=old.workspace_id
    and operation=case when tg_table_name='student_enrollments' then 'ENROLLMENT_SAVE' else 'ENROLLMENT_ATTRIBUTION_SAVE' end
    and result->'item'->>'id'=old.id::text;
  return old;
end $$;
revoke all on function public.cleanup_enrollment_receipts() from public;
create trigger enrollment_receipt_cleanup before delete on public.student_enrollments for each row execute function public.cleanup_enrollment_receipts();
create trigger attribution_receipt_cleanup before delete on public.enrollment_attributions for each row execute function public.cleanup_enrollment_receipts();
create function public.cleanup_student_enrollment_privacy() returns trigger
language plpgsql security definer set search_path=public,app_auth,extensions as $$
begin
  if new.do_not_contact_reason like 'PRIVACY_DELETION:%' and old.do_not_contact_reason is distinct from new.do_not_contact_reason then
    delete from public.student_enrollments where workspace_id=new.workspace_id and student_id in(select id from public.students where person_id=new.id and workspace_id=new.workspace_id);
    -- Erase a deleted counselor's personal attribution context on other enrollments too.
    delete from public.enrollment_attributions where workspace_id=new.workspace_id and source_contact_id=new.id;
  end if;
  return new;
end $$;
revoke all on function public.cleanup_student_enrollment_privacy() from public;
create trigger student_enrollment_privacy_cleanup after update of do_not_contact_reason on public.contacts for each row execute function public.cleanup_student_enrollment_privacy();
