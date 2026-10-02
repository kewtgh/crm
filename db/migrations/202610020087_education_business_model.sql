set search_path=public,extensions;

-- Composite references make tenant consistency a database invariant.
alter table public.organizations add constraint organizations_workspace_identity unique(workspace_id,id);
alter table public.households add constraint households_workspace_identity unique(workspace_id,id);
alter table public.students add constraint students_workspace_identity unique(workspace_id,id);
alter table public.contacts add constraint contacts_workspace_identity unique(workspace_id,id);

create table public.organization_business_profiles(
  id uuid primary key, workspace_id uuid not null default public.current_workspace_id(),
  organization_type text not null check(organization_type in ('SCHOOL','PARTNER','OTHER','FAMILY')),
  roles text[] not null check(roles <@ array['SCHOOL_ENTRY','REFERRAL_PARTNER','TOUR_PARTNER','UNIVERSITY_DESTINATION']::text[]),
  partnership_stage text not null check(partnership_stage in ('PROSPECT','CONTACTING','ACTIVE','PAUSED','ENDED')),
  primary_contact_id uuid, focus_regions text[] not null check(focus_regions <@ array['UK','US','AU','CA','NZ','EU','ASIA','OTHER']::text[]),
  agreement_expires_on date, next_action text not null check(length(next_action)<=1000),
  revision integer not null default 1 check(revision>0), updated_at timestamptz not null default clock_timestamp(),
  foreign key(workspace_id,id) references public.organizations(workspace_id,id) on delete cascade,
  foreign key(workspace_id,primary_contact_id) references public.contacts(workspace_id,id) on delete set null(primary_contact_id)
);
create table public.family_education_needs(
  id uuid primary key, workspace_id uuid not null default public.current_workspace_id(),
  services text[] not null check(services <@ array['FOUNDATION','BRIDGE','STUDY_TOUR']::text[]),
  target_regions text[] not null check(target_regions <@ array['UK','US','AU','CA','NZ','EU','ASIA','OTHER']::text[]),
  budget_min numeric(14,2) check(budget_min between 0 and 1000000000), budget_max numeric(14,2) check(budget_max between 0 and 1000000000),
  budget_currency text not null check(budget_currency in ('CNY','USD','GBP','AUD','CAD','EUR','NZD','HKD','SGD','TWD')),
  target_intake date, decision_stage text not null check(decision_stage in ('DISCOVERY','COMPARING','READY','ON_HOLD','CLOSED')),
  next_action text not null check(length(next_action)<=1000),
  revision integer not null default 1 check(revision>0), updated_at timestamptz not null default clock_timestamp(),
  check(budget_min is null or budget_max is null or budget_min<=budget_max),
  foreign key(workspace_id,id) references public.households(workspace_id,id) on delete cascade
);
create table public.student_pathways(
  id uuid primary key, workspace_id uuid not null default public.current_workspace_id(), student_id uuid not null,
  program_type text not null check(program_type in ('FOUNDATION','BRIDGE')),target_organization_id uuid,
  target_region text not null check(target_region in ('','UK','US','AU','CA','NZ','EU','ASIA','OTHER')),target_major text not null check(length(target_major)<=160),
  intake_date date, application_deadline date,
  language_test text not null check(language_test in ('NONE','IELTS','TOEFL','DUOLINGO','OTHER')),
  language_score numeric check(language_score between 0 and 999),
  stage text not null check(stage in ('EXPLORING','ASSESSING','PREPARING','APPLIED','OFFERED','ENROLLED','CLOSED')),
  next_action text not null check(length(next_action)<=1000),
  revision integer not null default 1 check(revision>0), updated_at timestamptz not null default clock_timestamp(),
  check(application_deadline is null or intake_date is null or application_deadline<=intake_date),
  check(language_score is null or (language_test<>'NONE' and language_score<=case language_test when 'IELTS' then 9 when 'TOEFL' then 120 when 'DUOLINGO' then 160 else 999 end)),
  foreign key(workspace_id,student_id) references public.students(workspace_id,id) on delete cascade,
  foreign key(workspace_id,target_organization_id) references public.organizations(workspace_id,id) on delete set null(target_organization_id)
);
create table public.education_outreach_events(
  id uuid primary key, workspace_id uuid not null default public.current_workspace_id(), organization_id uuid not null,partner_organization_id uuid,
  name text not null check(length(trim(name)) between 1 and 200),kind text not null check(kind in ('SEMINAR','CAMPUS_VISIT','STUDY_TOUR')),
  starts_on date not null,ends_on date not null,location text not null check(length(location)<=160),
  capacity integer check(capacity between 0 and 100000),attendee_count integer check(attendee_count between 0 and 100000),
  status text not null check(status in ('DRAFT','CONFIRMED','COMPLETED','CANCELLED')),next_action text not null check(length(next_action)<=1000),
  revision integer not null default 1 check(revision>0),updated_at timestamptz not null default clock_timestamp(),
  unique(workspace_id,id),check(ends_on>=starts_on),check(partner_organization_id is null or partner_organization_id<>organization_id),
  check(capacity is null or attendee_count is null or attendee_count<=capacity),
  foreign key(workspace_id,organization_id) references public.organizations(workspace_id,id) on delete cascade,
  foreign key(workspace_id,partner_organization_id) references public.organizations(workspace_id,id) on delete set null(partner_organization_id)
);
create table public.education_family_referrals(
  id uuid primary key,workspace_id uuid not null default public.current_workspace_id(),source_organization_id uuid not null,household_id uuid not null,
  event_id uuid,introduced_by_contact_id uuid,referred_on date not null,
  status text not null check(status in ('NEW','CONTACTED','QUALIFIED','CLOSED','DECLINED')),next_action text not null check(length(next_action)<=1000),
  revision integer not null default 1 check(revision>0),updated_at timestamptz not null default clock_timestamp(),
  foreign key(workspace_id,source_organization_id) references public.organizations(workspace_id,id) on delete cascade,
  foreign key(workspace_id,household_id) references public.households(workspace_id,id) on delete cascade,
  foreign key(workspace_id,event_id) references public.education_outreach_events(workspace_id,id) on delete set null(event_id),
  foreign key(workspace_id,introduced_by_contact_id) references public.contacts(workspace_id,id) on delete set null(introduced_by_contact_id)
);
create index student_pathways_subject_idx on public.student_pathways(workspace_id,student_id,updated_at desc,id);
create index outreach_host_idx on public.education_outreach_events(workspace_id,organization_id,updated_at desc,id);
create index outreach_partner_idx on public.education_outreach_events(workspace_id,partner_organization_id);
create index referral_source_idx on public.education_family_referrals(workspace_id,source_organization_id,updated_at desc,id);
create index referral_family_idx on public.education_family_referrals(workspace_id,household_id,updated_at desc,id);
create index referral_event_idx on public.education_family_referrals(workspace_id,event_id);

create function public.education_business_student_access(subject uuid,edit boolean default false) returns boolean
language sql stable security definer set search_path=public,app_auth,extensions as $$
  select exists(select 1 from public.students s join public.contacts c on c.id=s.person_id and c.workspace_id=s.workspace_id
    where s.id=subject and s.workspace_id=public.current_workspace_id() and s.archived_at is null and s.status<>'ARCHIVED'
      and c.archived_at is null and coalesce(c.do_not_contact_reason,'') not like 'PRIVACY_DELETION:%'
      and public.customer_subject_access('CONTACT',c.id,false)
      and (not edit or public.current_crm_role() in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER','SALES_SPECIALIST','SALES_SUPPORT')));
$$;

create function public.education_business_access(resource text,record jsonb,edit boolean default false) returns boolean
language plpgsql stable security definer set search_path=public,app_auth,extensions as $$
begin
  if app_auth.current_user_id() is null or record->>'workspace_id' is distinct from public.current_workspace_id()::text
    or not public.is_workspace_member(public.current_workspace_id()) then return false; end if;
  if edit and public.current_crm_role() not in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER','SALES_SPECIALIST','SALES_SUPPORT') then return false; end if;
  case resource
    when 'organizations' then return public.customer_subject_access('ORGANIZATION',(record->>'id')::uuid,edit);
    when 'needs' then return public.customer_subject_access('HOUSEHOLD',(record->>'id')::uuid,edit);
    when 'pathways' then return public.education_business_student_access((record->>'student_id')::uuid,edit)
      and (record->>'target_organization_id' is null or public.customer_subject_access('ORGANIZATION',(record->>'target_organization_id')::uuid,false));
    when 'events' then return public.customer_subject_access('ORGANIZATION',(record->>'organization_id')::uuid,edit)
      and (record->>'partner_organization_id' is null or public.customer_subject_access('ORGANIZATION',(record->>'partner_organization_id')::uuid,false));
    when 'referrals' then return public.customer_subject_access('HOUSEHOLD',(record->>'household_id')::uuid,edit)
      and public.customer_subject_access('ORGANIZATION',(record->>'source_organization_id')::uuid,false)
      and (record->>'event_id' is null or exists(select 1 from public.education_outreach_events e where e.id=(record->>'event_id')::uuid
        and e.workspace_id=public.current_workspace_id() and public.education_business_access('events',to_jsonb(e),false)));
    else return false;
  end case;
end $$;
revoke all on function public.education_business_student_access(uuid,boolean),public.education_business_access(text,jsonb,boolean) from public,crm_system;
grant execute on function public.education_business_student_access(uuid,boolean),public.education_business_access(text,jsonb,boolean) to crm_app;

do $$
declare pair text[];
begin
  foreach pair slice 1 in array array[
    ['organization_business_profiles','organizations'],['family_education_needs','needs'],['student_pathways','pathways'],
    ['education_outreach_events','events'],['education_family_referrals','referrals']
  ] loop
    execute format('alter table public.%I enable row level security',pair[1]);
    execute format('create policy education_business_read on public.%I for select to crm_app using(public.education_business_access(%L,to_jsonb(%I),false))',pair[1],pair[2],pair[1]);
    execute format('grant select on public.%I to crm_app',pair[1]);
    -- Privacy export is an existing dedicated Worker responsibility; no write grant.
    execute format('grant select on public.%I to crm_worker',pair[1]);
    execute format('create policy education_business_worker_read on public.%I for select to crm_worker using(true)',pair[1]);
  end loop;
end $$;

create function public.save_education_business(resource text,record_id uuid,expected_revision integer,data jsonb) returns jsonb
language plpgsql security definer set search_path=public,app_auth,extensions as $$
declare table_name text; fields text[]; old_row jsonb; candidate jsonb; result jsonb; column_list text; update_list text; related uuid;
begin
  case resource
    when 'organizations' then table_name:='organization_business_profiles';fields:=array['organization_type','roles','partnership_stage','primary_contact_id','focus_regions','agreement_expires_on','next_action'];
    when 'needs' then table_name:='family_education_needs';fields:=array['services','target_regions','budget_min','budget_max','budget_currency','target_intake','decision_stage','next_action'];
    when 'pathways' then table_name:='student_pathways';fields:=array['student_id','program_type','target_organization_id','target_region','target_major','intake_date','application_deadline','language_test','language_score','stage','next_action'];
    when 'events' then table_name:='education_outreach_events';fields:=array['name','organization_id','partner_organization_id','kind','starts_on','ends_on','location','capacity','attendee_count','status','next_action'];
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
    if resource='pathways' and old_row->'student_id' is distinct from data->'student_id'
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
revoke all on function public.save_education_business(text,uuid,integer,jsonb) from public,crm_system;
grant execute on function public.save_education_business(text,uuid,integer,jsonb) to crm_app;

create function public.education_business_permissions(resource text,record_ids uuid[]) returns table(id uuid,can_edit boolean)
language plpgsql stable security definer set search_path=public,app_auth,extensions as $$
declare table_name text;
begin
  if cardinality(record_ids)>50 then raise exception 'business_input_invalid'; end if;
  table_name:=case resource when 'organizations' then 'organization_business_profiles' when 'needs' then 'family_education_needs'
    when 'pathways' then 'student_pathways' when 'events' then 'education_outreach_events' when 'referrals' then 'education_family_referrals' end;
  if table_name is null then raise exception 'business_input_invalid'; end if;
  return query execute format('select r.id,public.education_business_access($1,to_jsonb(r),true) from public.%I r where r.id=any($2) and r.workspace_id=public.current_workspace_id() and public.education_business_access($1,to_jsonb(r),false)',table_name)
    using resource,record_ids;
end $$;
revoke all on function public.education_business_permissions(text,uuid[]) from public,crm_system;
grant execute on function public.education_business_permissions(text,uuid[]) to crm_app;

create function public.education_business_today() returns date language sql stable security invoker as $$select current_date$$;
revoke all on function public.education_business_today() from public,crm_system;
grant execute on function public.education_business_today() to crm_app;

-- Existing privacy deletion pseudonymizes rather than deleting contacts.
-- Remove optional planning data and detach introducer/contact links in that same transaction.
create function public.cleanup_education_business_privacy() returns trigger
language plpgsql security definer set search_path=public,app_auth,extensions as $$
begin
  if new.do_not_contact_reason like 'PRIVACY_DELETION:%' and old.do_not_contact_reason is distinct from new.do_not_contact_reason then
    delete from public.student_pathways where workspace_id=new.workspace_id and student_id in(select id from public.students where person_id=new.id and workspace_id=new.workspace_id);
    update public.organization_business_profiles set primary_contact_id=null,next_action='',revision=revision+1,updated_at=clock_timestamp()
      where workspace_id=new.workspace_id and primary_contact_id=new.id;
    update public.education_family_referrals set introduced_by_contact_id=null,next_action='',revision=revision+1,updated_at=clock_timestamp()
      where workspace_id=new.workspace_id and introduced_by_contact_id=new.id;
  end if;
  return new;
end $$;
revoke all on function public.cleanup_education_business_privacy() from public,crm_app,crm_system;
create trigger education_business_privacy_cleanup after update of do_not_contact_reason on public.contacts
  for each row execute function public.cleanup_education_business_privacy();

-- The existing organization classification remains authoritative for imports and old writers.
create function public.sync_education_organization_classification() returns trigger
language plpgsql security definer set search_path=public,app_auth,extensions as $$
begin
  update public.organization_business_profiles set organization_type=new.organization_type,revision=revision+1,updated_at=clock_timestamp()
    where id=new.id and workspace_id=new.workspace_id and organization_type is distinct from new.organization_type;
  return new;
end $$;
revoke all on function public.sync_education_organization_classification() from public,crm_app,crm_system;
create trigger education_organization_classification_sync after update of organization_type on public.organizations
  for each row execute function public.sync_education_organization_classification();
