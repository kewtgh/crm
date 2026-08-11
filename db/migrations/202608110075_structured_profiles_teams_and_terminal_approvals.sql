-- Structured education profiles, reusable teams, editable catalog records, and
-- terminal administrator / scoped team-lead approval authority.
set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- Teams are first-class records. The legacy text remains as a compatibility
-- label for reports and older integrations while team_id is the source of truth.
-- ---------------------------------------------------------------------------
create table if not exists public.sales_teams (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default public.current_workspace_id() references public.workspaces(id),
  code citext not null,
  name_zh text not null,
  name_en text not null,
  description_markdown text not null default '',
  active boolean not null default true,
  created_by uuid references app_auth.accounts(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(workspace_id, code),
  unique(workspace_id, name_en)
);

alter table public.sales_team_members add column if not exists team_id uuid references public.sales_teams(id) on delete set null;
alter table public.sales_teams add column if not exists lead_member_id uuid references public.sales_team_members(id) on delete set null;

insert into public.sales_teams(workspace_id,code,name_zh,name_en)
select distinct m.workspace_id,
  coalesce(nullif(trim(both '-' from left(regexp_replace(lower(trim(m.team)),'[^a-z0-9]+','-','g'),40)),''),'legacy-'||substr(md5(lower(trim(m.team))),1,12)),
  trim(m.team),trim(m.team)
from public.sales_team_members m
where nullif(trim(m.team),'') is not null
on conflict do nothing;

update public.sales_team_members m set team_id=t.id
from public.sales_teams t
where m.team_id is null and t.workspace_id=m.workspace_id
  and (lower(t.name_en)=lower(trim(m.team)) or lower(t.name_zh)=lower(trim(m.team)));

update public.sales_teams t
set lead_member_id=(
  select m.id from public.sales_team_members m
  where m.team_id=t.id and m.active and m.role in ('SALES_MANAGER','SALES_DIRECTOR')
  order by case m.role when 'SALES_DIRECTOR' then 0 else 1 end,m.created_at limit 1
)
where t.lead_member_id is null
  and exists(select 1 from public.sales_team_members m where m.team_id=t.id and m.active and m.role in ('SALES_MANAGER','SALES_DIRECTOR'));

create index if not exists sales_team_members_team_idx on public.sales_team_members(workspace_id,team_id,active);
create index if not exists sales_teams_lead_idx on public.sales_teams(workspace_id,lead_member_id) where active;
alter table public.sales_teams enable row level security;
drop policy if exists sales_teams_workspace_read on public.sales_teams;
create policy sales_teams_workspace_read on public.sales_teams for select to crm_app
  using(public.is_workspace_member(workspace_id));
revoke all on public.sales_teams from public;
grant select on public.sales_teams to crm_app;
grant select,insert,update,delete on public.sales_teams to crm_system;

-- ---------------------------------------------------------------------------
-- Structured education/customer profiles. Free-form narrative fields are
-- explicitly Markdown; values that can be filtered or validated stay typed.
-- ---------------------------------------------------------------------------
alter table public.households
  add column if not exists primary_parent_occupation text not null default '',
  add column if not exists secondary_parent_occupation text not null default '',
  add column if not exists annual_income_amount numeric(14,2),
  add column if not exists income_currency text not null default 'CNY',
  add column if not exists preferred_contact_method text not null default 'EMAIL',
  add column if not exists preferred_language text not null default '',
  add column if not exists education_expectations_markdown text not null default '',
  add column if not exists family_background_markdown text not null default '';
alter table public.households drop constraint if exists households_income_currency_check;
alter table public.households add constraint households_income_currency_check check(income_currency ~ '^[A-Z]{3}$');
alter table public.households drop constraint if exists households_contact_method_check;
alter table public.households add constraint households_contact_method_check
  check(preferred_contact_method in ('EMAIL','PHONE','SMS','WECHAT','WHATSAPP','IN_PERSON'));
alter table public.households drop constraint if exists households_income_amount_check;
alter table public.households add constraint households_income_amount_check check(annual_income_amount is null or annual_income_amount>=0);

alter table public.students
  add column if not exists personality_markdown text not null default '',
  add column if not exists current_class text not null default '',
  add column if not exists learning_expectations_markdown text not null default '',
  add column if not exists strengths_markdown text not null default '',
  add column if not exists support_needs_markdown text not null default '',
  add column if not exists interests text[] not null default '{}',
  add column if not exists preferred_learning_style text not null default 'UNSPECIFIED';
alter table public.students drop constraint if exists students_learning_style_check;
alter table public.students add constraint students_learning_style_check
  check(preferred_learning_style in ('UNSPECIFIED','VISUAL','AUDITORY','READ_WRITE','KINESTHETIC','MIXED'));

alter table public.organizations
  add column if not exists course_categories text[] not null default '{}',
  add column if not exists affiliation_type text not null default 'INDEPENDENT',
  add column if not exists parent_organization_id uuid references public.organizations(id) on delete set null,
  add column if not exists organization_overview_markdown text not null default '',
  add column if not exists structure_overview_markdown text not null default '',
  add column if not exists website text not null default '',
  add column if not exists founded_year integer,
  add column if not exists student_count integer,
  add column if not exists faculty_count integer,
  add column if not exists campus_count integer;
alter table public.organizations drop constraint if exists organizations_affiliation_type_check;
alter table public.organizations add constraint organizations_affiliation_type_check
  check(affiliation_type in ('INDEPENDENT','EDUCATION_GROUP','GOVERNMENT','UNIVERSITY','RELIGIOUS','OTHER'));
alter table public.organizations drop constraint if exists organizations_profile_counts_check;
alter table public.organizations add constraint organizations_profile_counts_check check(
  (founded_year is null or founded_year between 1000 and 9999)
  and (student_count is null or student_count>=0)
  and (faculty_count is null or faculty_count>=0)
  and (campus_count is null or campus_count>=0)
);

-- Product base fields use optimistic concurrency. Price history remains a
-- separate versioned operation.
create or replace function public.update_product_record(
  target_product uuid,expected_updated_at timestamptz,product_code text,
  product_name_zh text,product_name_en text,product_billing text,
  product_duration_zh text,product_duration_en text,product_is_default boolean
) returns public.products
language plpgsql security definer set search_path=public,app_auth,extensions
as $$
declare result public.products;
begin
  if public.current_crm_role() not in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR')
    or nullif(trim(product_code),'') is null
    or nullif(trim(product_name_zh),'') is null or nullif(trim(product_name_en),'') is null
    or upper(product_billing) not in ('PROJECT','TERM','MONTH','YEAR','SCHOOL_YEAR','SEASON')
    or nullif(trim(product_duration_zh),'') is null or nullif(trim(product_duration_en),'') is null then
    raise exception 'product_update_forbidden';
  end if;
  if coalesce(product_is_default,false) then
    update public.products set is_default=false,updated_at=now()
    where workspace_id=public.current_workspace_id() and is_default and id<>target_product;
  end if;
  update public.products set code=upper(trim(product_code)),name_zh=trim(product_name_zh),
    name_en=trim(product_name_en),billing_unit=upper(product_billing),
    duration_zh=trim(product_duration_zh),duration_en=trim(product_duration_en),
    is_default=coalesce(product_is_default,false),updated_at=now()
  where id=target_product and workspace_id=public.current_workspace_id() and updated_at=expected_updated_at
  returning * into result;
  if not found then
    if exists(select 1 from public.products where id=target_product and workspace_id=public.current_workspace_id())
      then raise exception 'product_version_conflict'; else raise exception 'product_not_found'; end if;
  end if;
  return result;
end;
$$;

create or replace function public.product_catalog_snapshot()
returns jsonb language sql stable security definer set search_path=public,app_auth,extensions
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',p.id,'nameZh',p.name_zh,'nameEn',p.name_en,'code',p.code,
    'billing',p.billing_unit,'durationZh',p.duration_zh,'durationEn',p.duration_en,
    'active',p.active,'isDefault',p.is_default,'updatedAt',p.updated_at,
    'prices',coalesce(price_rows.items,'[]'::jsonb),'metrics',coalesce(metric_rows.items,'{}'::jsonb)
  ) order by p.is_default desc,p.name_en),'[]'::jsonb)
  from public.products p
  left join lateral (
    select jsonb_agg(jsonb_build_object('currency',pp.currency,'amount',pp.amount,'effectiveFrom',pp.effective_from)
      order by case when pp.currency='CNY' then 0 else 1 end,pp.currency) items
    from public.product_prices pp where pp.product_id=p.id and pp.effective_from<=current_date
      and (pp.effective_to is null or pp.effective_to>=current_date)
  ) price_rows on true
  left join lateral (
    select jsonb_object_agg(m.currency,jsonb_build_object('revenue',m.revenue,'customers',m.customers)) items
    from (select pay.currency,sum(greatest(pay.amount-coalesce(pay.refunded_amount,0),0)) revenue,
      count(distinct con.organization_id) customers from public.payments pay
      join public.contracts con on con.id=pay.contract_id
      where pay.workspace_id=p.workspace_id and pay.product_id=p.id and pay.status='CONFIRMED'
      group by pay.currency) m
  ) metric_rows on true
  where p.workspace_id=public.current_workspace_id();
$$;

create or replace function public.update_student_profile(
  target_student uuid,expected_updated_at timestamptz,next_student_number text,next_birth_date date,
  next_grade text,next_class text,next_academic_year text,next_household uuid,next_status text,
  next_personality_markdown text,next_learning_expectations_markdown text,next_strengths_markdown text,
  next_support_needs_markdown text,next_interests text[],next_learning_style text
) returns public.students language plpgsql security definer set search_path=public,app_auth,extensions
as $$
declare result public.students; normalized_status text:=upper(trim(coalesce(next_status,'')));
begin
  if public.current_crm_role() not in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER','SALES_SPECIALIST','SALES_SUPPORT')
    or normalized_status not in ('ACTIVE','ON_LEAVE','ALUMNI','WITHDRAWN','ARCHIVED')
    or nullif(trim(next_grade),'') is null or nullif(trim(next_academic_year),'') is null
    or upper(next_learning_style) not in ('UNSPECIFIED','VISUAL','AUDITORY','READ_WRITE','KINESTHETIC','MIXED') then
    raise exception 'education_update_forbidden';
  end if;
  if next_household is not null and not exists(select 1 from public.households where id=next_household and workspace_id=public.current_workspace_id() and archived_at is null)
    then raise exception 'education_household_not_found'; end if;
  update public.students set student_number=nullif(trim(next_student_number),''),birth_date=next_birth_date,
    current_grade=trim(next_grade),current_class=trim(coalesce(next_class,'')),academic_year=trim(next_academic_year),
    household_id=next_household,status=normalized_status,personality_markdown=coalesce(next_personality_markdown,''),
    learning_expectations_markdown=coalesce(next_learning_expectations_markdown,''),strengths_markdown=coalesce(next_strengths_markdown,''),
    support_needs_markdown=coalesce(next_support_needs_markdown,''),interests=coalesce(next_interests,'{}'),
    preferred_learning_style=upper(next_learning_style),archived_at=case when normalized_status='ARCHIVED' then now() else null end,updated_at=now()
  where id=target_student and workspace_id=public.current_workspace_id() and updated_at=expected_updated_at returning * into result;
  if not found then raise exception 'education_version_conflict'; end if;
  return result;
end;
$$;

create or replace function public.update_household_profile(
  target_household uuid,expected_updated_at timestamptz,next_name_zh text,next_name_en text,next_address text,next_status text,
  next_primary_parent_occupation text,next_secondary_parent_occupation text,next_annual_income_amount numeric,next_income_currency text,
  next_preferred_contact_method text,next_preferred_language text,next_education_expectations_markdown text,next_family_background_markdown text
) returns public.households language plpgsql security definer set search_path=public,app_auth,extensions
as $$
declare result public.households; normalized_status text:=upper(trim(coalesce(next_status,'')));
begin
  if public.current_crm_role() not in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER','SALES_SPECIALIST','SALES_SUPPORT')
    or normalized_status not in ('ACTIVE','INACTIVE','ARCHIVED') or nullif(trim(next_name_zh),'') is null or nullif(trim(next_name_en),'') is null
    or upper(next_income_currency)!~'^[A-Z]{3}$' or upper(next_preferred_contact_method) not in ('EMAIL','PHONE','SMS','WECHAT','WHATSAPP','IN_PERSON')
    or next_annual_income_amount<0 then raise exception 'education_update_forbidden'; end if;
  update public.households set name_zh=trim(next_name_zh),name_en=trim(next_name_en),address=trim(coalesce(next_address,'')),status=normalized_status,
    primary_parent_occupation=trim(coalesce(next_primary_parent_occupation,'')),secondary_parent_occupation=trim(coalesce(next_secondary_parent_occupation,'')),
    annual_income_amount=next_annual_income_amount,income_currency=upper(next_income_currency),preferred_contact_method=upper(next_preferred_contact_method),
    preferred_language=trim(coalesce(next_preferred_language,'')),education_expectations_markdown=coalesce(next_education_expectations_markdown,''),
    family_background_markdown=coalesce(next_family_background_markdown,''),archived_at=case when normalized_status='ARCHIVED' then now() else null end,updated_at=now()
  where id=target_household and workspace_id=public.current_workspace_id() and updated_at=expected_updated_at returning * into result;
  if not found then raise exception 'education_version_conflict'; end if;
  return result;
end;
$$;

create or replace function public.update_school_profile(
  target_school uuid,expected_updated_at timestamptz,next_name_zh text,next_name_en text,next_city text,next_curriculum text,next_status text,
  next_course_categories text[],next_affiliation_type text,next_parent_organization uuid,next_overview_markdown text,next_structure_markdown text,
  next_website text,next_founded_year integer,next_student_count integer,next_faculty_count integer,next_campus_count integer
) returns public.organizations language plpgsql security definer set search_path=public,app_auth,extensions
as $$
declare result public.organizations;
begin
  select * into result from public.organizations where id=target_school and workspace_id=public.current_workspace_id() for update;
  if not found or not public.can_access_owned_record(result.workspace_id,'ORGANIZATION',result.id,result.owner_id,true)
    or nullif(trim(next_name_zh),'') is null or nullif(trim(next_name_en),'') is null or nullif(trim(next_city),'') is null
    or upper(next_affiliation_type) not in ('INDEPENDENT','EDUCATION_GROUP','GOVERNMENT','UNIVERSITY','RELIGIOUS','OTHER') then
    raise exception 'crm_update_forbidden'; end if;
  if result.updated_at<>expected_updated_at then raise exception 'crm_version_conflict'; end if;
  if next_parent_organization=target_school or (next_parent_organization is not null and not exists(select 1 from public.organizations where id=next_parent_organization and workspace_id=result.workspace_id))
    then raise exception 'school_parent_invalid'; end if;
  update public.organizations set name_zh=trim(next_name_zh),name_en=trim(next_name_en),city=trim(next_city),curriculum=trim(coalesce(next_curriculum,'')),
    status=case when next_status in ('HEALTHY','ATTENTION','DEVELOPING','RISK','UNVERIFIED') then next_status else status end,
    course_categories=coalesce(next_course_categories,'{}'),affiliation_type=upper(next_affiliation_type),parent_organization_id=next_parent_organization,
    organization_overview_markdown=coalesce(next_overview_markdown,''),structure_overview_markdown=coalesce(next_structure_markdown,''),website=trim(coalesce(next_website,'')),
    founded_year=next_founded_year,student_count=next_student_count,faculty_count=next_faculty_count,campus_count=next_campus_count,updated_at=now()
  where id=target_school returning * into result;
  return result;
end;
$$;

-- ---------------------------------------------------------------------------
-- Approval hierarchy: administrators are terminal authorities and therefore
-- execute their own requests immediately. Team leads can decide only ordinary
-- requests from their own team. Exports and money-affecting requests stay with
-- administrators.
-- ---------------------------------------------------------------------------
alter table public.approval_requests drop constraint if exists approval_no_self_decision;
alter table public.approval_requests drop constraint if exists approval_requests_required_role_check;
alter table public.approval_requests add constraint approval_requests_required_role_check
  check(required_role in ('TEAM_LEAD','ADMIN','SUPER_ADMIN'));

create or replace function public.set_approval_required_role()
returns trigger language plpgsql set search_path=public,app_auth,extensions
as $$
declare requester_team uuid;
begin
  if new.request_type in ('CONTRACT_SIGN','CONTRACT_EXPORT','PERFORMANCE_SUMMARY','PERFORMANCE_ALLOCATION','QUOTE_DISCOUNT','REFUND','MARKETING_CONTACT_EXPORT','CRM_EXPORT') then
    new.required_role:='ADMIN';
    return new;
  end if;
  select m.team_id into requester_team from public.sales_team_members m
    join public.sales_teams t on t.id=m.team_id and t.active and t.lead_member_id is not null
    where m.workspace_id=new.workspace_id and m.auth_user_id=new.requester_id and m.active limit 1;
  new.required_role:=case when requester_team is null then 'ADMIN' else 'TEAM_LEAD' end;
  return new;
end;
$$;

update public.approval_requests set required_role='ADMIN',updated_at=now()
where status='PENDING' and request_type in ('CONTRACT_SIGN','CONTRACT_EXPORT','PERFORMANCE_SUMMARY','PERFORMANCE_ALLOCATION','QUOTE_DISCOUNT','REFUND','MARKETING_CONTACT_EXPORT','CRM_EXPORT');

drop policy if exists "approval participants can read" on public.approval_requests;
create policy "approval participants can read" on public.approval_requests for select to crm_app using(
  public.is_workspace_member(workspace_id) and (
    requester_id=app_auth.current_user_id() or public.current_crm_role() in ('ADMIN','SUPER_ADMIN') or
    exists(select 1 from public.sales_teams t join public.sales_team_members requester on requester.team_id=t.id
      join public.sales_team_members leader on leader.id=t.lead_member_id
      where requester.auth_user_id=approval_requests.requester_id and requester.active
        and leader.auth_user_id=app_auth.current_user_id() and leader.active and t.workspace_id=approval_requests.workspace_id)
  )
);

-- The terminal function keeps the established name for API compatibility, but
-- accepts both administrator roles.
create or replace function public.super_admin_execute_approval(request_id uuid)
returns public.approval_requests language plpgsql security definer set search_path=public,app_auth,extensions
as $$
declare request public.approval_requests; object_uuid uuid;
begin
  if app_auth.current_user_id() is null or public.current_crm_role() not in ('SUPER_ADMIN','ADMIN') then raise exception 'administrator_required'; end if;
  select * into request from public.approval_requests where id=request_id and workspace_id=public.current_workspace_id() for update;
  if not found or request.status<>'PENDING' then raise exception 'approval_not_pending'; end if;
  if request.requester_id<>app_auth.current_user_id() then raise exception 'approval_requester_mismatch'; end if;
  update public.approval_requests set status='APPROVED',decision_reason='管理员直接终审',decided_by=app_auth.current_user_id(),decided_at=now(),updated_at=now()
    where id=request_id returning * into request;
  insert into public.approval_actions(approval_request_id,actor_id,action,comment) values(request_id,app_auth.current_user_id(),'APPROVED','ADMIN_TERMINAL_EXECUTION');
  begin
    if request.request_type in ('CONTRACT_SIGN','CONTRACT_EXPORT','PERFORMANCE_ALLOCATION') then object_uuid:=request.business_object_id::uuid; end if;
    if request.request_type='CONTRACT_SIGN' then
      update public.contracts set status='ACTIVE',signed_at=coalesce(signed_at,now()),updated_at=now() where id=object_uuid and workspace_id=request.workspace_id and status='PENDING_APPROVAL';
      if not found then raise exception 'contract_state_changed'; end if;
    elsif request.request_type='PERFORMANCE_ALLOCATION' then
      update public.performance_targets set status='ACTIVE',updated_at=now() where id=object_uuid and workspace_id=request.workspace_id and status='PENDING_APPROVAL';
      if not found then raise exception 'performance_state_changed'; end if;
    elsif request.request_type in ('CONTRACT_EXPORT','PERFORMANCE_SUMMARY','MARKETING_CONTACT_EXPORT','CRM_EXPORT') then
      insert into public.generated_jobs(workspace_id,approval_request_id,job_type,parameters,created_by)
      values(request.workspace_id,request.id,request.request_type,case when request.request_type='CRM_EXPORT' then request.request_payload else jsonb_build_object('objectType',request.business_object_type,'objectId',request.business_object_id) end,request.requester_id)
      on conflict(approval_request_id) do nothing;
    end if;
    update public.approval_requests set execution_status='SUCCEEDED',executed_at=now(),execution_error=null where id=request.id returning * into request;
  exception when others then
    update public.approval_requests set execution_status='FAILED',executed_at=now(),execution_error=left(sqlerrm,500) where id=request.id returning * into request;
  end;
  return request;
end;
$$;

create or replace function public.decide_approval(request_id uuid,decision text,decision_comment text default null)
returns public.approval_requests language plpgsql security definer set search_path=public,app_auth,extensions
as $$
declare request public.approval_requests; actor_role text:=public.current_crm_role(); object_uuid uuid; is_team_lead boolean:=false;
begin
  if app_auth.current_user_id() is null or actor_role not in ('ADMIN','SUPER_ADMIN','SALES_DIRECTOR','SALES_MANAGER') then raise exception 'approval_not_authorized'; end if;
  if decision not in ('APPROVED','REJECTED') or (decision='REJECTED' and nullif(trim(decision_comment),'') is null) then raise exception 'approval_invalid_decision'; end if;
  select * into request from public.approval_requests where id=request_id and workspace_id=public.current_workspace_id() for update;
  if not found or request.status<>'PENDING' or request.expires_at<=now() then raise exception 'approval_not_pending'; end if;
  if actor_role not in ('ADMIN','SUPER_ADMIN') then
    select exists(select 1 from public.sales_teams t join public.sales_team_members requester on requester.team_id=t.id
      join public.sales_team_members leader on leader.id=t.lead_member_id
      where requester.auth_user_id=request.requester_id and requester.active and leader.auth_user_id=app_auth.current_user_id() and leader.active
        and t.workspace_id=request.workspace_id and request.required_role='TEAM_LEAD') into is_team_lead;
    if not is_team_lead or request.requester_id=app_auth.current_user_id() then raise exception 'approval_not_authorized'; end if;
  end if;
  update public.approval_requests set status=decision,decision_reason=nullif(trim(decision_comment),''),decided_by=app_auth.current_user_id(),decided_at=now(),updated_at=now()
    where id=request_id returning * into request;
  insert into public.approval_actions(approval_request_id,actor_id,action,comment) values(request_id,app_auth.current_user_id(),decision,nullif(trim(decision_comment),''));
  begin
    if request.request_type in ('CONTRACT_SIGN','CONTRACT_EXPORT','PERFORMANCE_ALLOCATION') then object_uuid:=request.business_object_id::uuid; end if;
    if decision='APPROVED' and request.request_type='CONTRACT_SIGN' then
      update public.contracts set status='ACTIVE',signed_at=coalesce(signed_at,now()),updated_at=now() where id=object_uuid and workspace_id=request.workspace_id and status='PENDING_APPROVAL';
      if not found then raise exception 'contract_state_changed'; end if;
    elsif decision='REJECTED' and request.request_type='CONTRACT_SIGN' then
      update public.contracts set status='DRAFT',updated_at=now() where id=object_uuid and workspace_id=request.workspace_id and status='PENDING_APPROVAL';
    elsif decision='APPROVED' and request.request_type='PERFORMANCE_ALLOCATION' then
      update public.performance_targets set status='ACTIVE',updated_at=now() where id=object_uuid and workspace_id=request.workspace_id and status='PENDING_APPROVAL';
    elsif decision='REJECTED' and request.request_type='PERFORMANCE_ALLOCATION' then
      update public.performance_targets set status='DRAFT',updated_at=now() where id=object_uuid and workspace_id=request.workspace_id and status='PENDING_APPROVAL';
    elsif decision='APPROVED' and request.request_type in ('CONTRACT_EXPORT','PERFORMANCE_SUMMARY','MARKETING_CONTACT_EXPORT','CRM_EXPORT') then
      insert into public.generated_jobs(workspace_id,approval_request_id,job_type,parameters,created_by)
      values(request.workspace_id,request.id,request.request_type,case when request.request_type='CRM_EXPORT' then request.request_payload else jsonb_build_object('objectType',request.business_object_type,'objectId',request.business_object_id) end,request.requester_id)
      on conflict(approval_request_id) do nothing;
    end if;
    update public.approval_requests set execution_status='SUCCEEDED',executed_at=now(),execution_error=null where id=request.id returning * into request;
  exception when others then
    update public.approval_requests set execution_status='FAILED',executed_at=now(),execution_error=left(sqlerrm,500) where id=request.id returning * into request;
  end;
  return request;
end;
$$;

revoke all on function public.update_product_record(uuid,timestamptz,text,text,text,text,text,text,boolean),
  public.update_student_profile(uuid,timestamptz,text,date,text,text,text,uuid,text,text,text,text,text,text[],text),
  public.update_household_profile(uuid,timestamptz,text,text,text,text,text,text,numeric,text,text,text,text,text),
  public.update_school_profile(uuid,timestamptz,text,text,text,text,text,text[],text,uuid,text,text,text,integer,integer,integer,integer)
from public,crm_system;
grant execute on function public.update_product_record(uuid,timestamptz,text,text,text,text,text,text,boolean),
  public.update_student_profile(uuid,timestamptz,text,date,text,text,text,uuid,text,text,text,text,text,text[],text),
  public.update_household_profile(uuid,timestamptz,text,text,text,text,text,text,numeric,text,text,text,text,text),
  public.update_school_profile(uuid,timestamptz,text,text,text,text,text,text[],text,uuid,text,text,text,integer,integer,integer,integer)
to crm_app;

-- Rich import templates use the same resumable batch engine for schools,
-- households and students. Student imports intentionally reference existing
-- person/household UUIDs so those relationships remain structured.
alter table public.import_batches drop constraint if exists import_batches_resource_type_check;
alter table public.import_batches add constraint import_batches_resource_type_check
  check(resource_type in ('ORGANIZATIONS','CONTACTS','HOUSEHOLDS','STUDENTS'));

create or replace function public.create_import_batch(
  resource text,filename text,content_hash text,request_key text,mapping jsonb,rows jsonb
) returns public.import_batches language plpgsql security definer set search_path=public,app_auth,extensions
as $$
declare batch public.import_batches; item jsonb; row_no integer:=0; normalized jsonb; errors jsonb; duplicate_id uuid; duplicate_score integer; reasons jsonb;
begin
  resource:=upper(trim(resource));
  if public.current_crm_role() not in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER')
    or resource not in ('ORGANIZATIONS','CONTACTS','HOUSEHOLDS','STUDENTS') or jsonb_typeof(rows)<>'array'
    or jsonb_array_length(rows)=0 or jsonb_array_length(rows)>10000 then raise exception 'import_invalid'; end if;
  insert into public.import_batches(workspace_id,resource_type,original_filename,file_hash,idempotency_key,field_mapping,created_by)
  values(public.current_workspace_id(),resource,left(filename,180),content_hash,request_key,mapping,app_auth.current_user_id())
  on conflict(workspace_id,idempotency_key) do update set idempotency_key=excluded.idempotency_key returning * into batch;
  if batch.total_rows>0 then return batch; end if;
  for item in select * from jsonb_array_elements(rows) loop
    row_no:=row_no+1;normalized:=item;errors:='[]';duplicate_id:=null;duplicate_score:=null;reasons:='[]';
    if nullif(trim(normalized->>'nameZh'),'') is null then errors:=errors||'[{"code":"NAME_ZH_REQUIRED"}]'; end if;
    if nullif(trim(normalized->>'nameEn'),'') is null then errors:=errors||'[{"code":"NAME_EN_REQUIRED"}]'; end if;
    if resource='CONTACTS' and nullif(trim(normalized->>'email'),'') is null and nullif(trim(normalized->>'phone'),'') is null then errors:=errors||'[{"code":"CONTACT_METHOD_REQUIRED"}]'; end if;
    if resource='STUDENTS' then
      if coalesce(normalized->>'personId','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        or not exists(select 1 from public.contacts where id=(normalized->>'personId')::uuid and workspace_id=batch.workspace_id)
        then errors:=errors||'[{"code":"PERSON_ID_REQUIRED"}]'; end if;
      if nullif(trim(normalized->>'currentGrade'),'') is null or nullif(trim(normalized->>'academicYear'),'') is null then errors:=errors||'[{"code":"ACADEMIC_PROFILE_REQUIRED"}]'; end if;
    end if;
    if jsonb_array_length(errors)=0 then
      if resource='CONTACTS' then select id,90,'["CONTACT_MATCH"]' into duplicate_id,duplicate_score,reasons from public.contacts where workspace_id=batch.workspace_id and ((normalized->>'email'<>'' and email=normalized->>'email') or (normalized->>'phone'<>'' and phone=normalized->>'phone')) limit 1;
      elsif resource='ORGANIZATIONS' then select id,90,'["BILINGUAL_NAME"]' into duplicate_id,duplicate_score,reasons from public.organizations where workspace_id=batch.workspace_id and (lower(name_zh)=lower(normalized->>'nameZh') or lower(name_en)=lower(normalized->>'nameEn')) limit 1;
      elsif resource='HOUSEHOLDS' then select id,90,'["BILINGUAL_NAME"]' into duplicate_id,duplicate_score,reasons from public.households where workspace_id=batch.workspace_id and (lower(name_zh)=lower(normalized->>'nameZh') or lower(name_en)=lower(normalized->>'nameEn')) limit 1;
      else select id,100,'["PERSON_ID"]' into duplicate_id,duplicate_score,reasons from public.students where workspace_id=batch.workspace_id and person_id=(normalized->>'personId')::uuid limit 1; end if;
    end if;
    insert into public.import_rows(workspace_id,batch_id,row_number,raw_data,normalized_data,status,errors,duplicate_entity_id,duplicate_score,duplicate_reasons)
    values(batch.workspace_id,batch.id,row_no,item,normalized,case when jsonb_array_length(errors)>0 then 'INVALID' when duplicate_id is not null then 'DUPLICATE' else 'VALID' end,errors,duplicate_id,duplicate_score,reasons);
  end loop;
  update public.import_batches b set total_rows=(select count(*) from public.import_rows where batch_id=b.id),valid_rows=(select count(*) from public.import_rows where batch_id=b.id and status='VALID'),invalid_rows=(select count(*) from public.import_rows where batch_id=b.id and status='INVALID'),duplicate_rows=(select count(*) from public.import_rows where batch_id=b.id and status='DUPLICATE'),status=case when exists(select 1 from public.import_rows where batch_id=b.id and status='DUPLICATE') then 'NEEDS_DECISION' when exists(select 1 from public.import_rows where batch_id=b.id and status='INVALID') then 'PARTIAL_FAILED' else 'READY' end,updated_at=now() where b.id=batch.id returning * into batch;
  return batch;
end;
$$;

create or replace function public.process_import_batch(target_batch uuid,batch_size integer default 50)
returns public.import_batches language plpgsql security definer set search_path=public,app_auth,extensions
as $$
declare batch public.import_batches;item public.import_rows;entity_id uuid;before_row jsonb;after_row jsonb;values_array text[];
begin
  select * into batch from public.import_batches where id=target_batch and workspace_id=public.current_workspace_id() and created_by=app_auth.current_user_id() for update;
  if not found or batch.status not in ('READY','PROCESSING','PARTIAL_FAILED') or exists(select 1 from public.import_rows where batch_id=batch.id and status='DUPLICATE') then raise exception 'import_not_ready'; end if;
  update public.import_batches set status='PROCESSING',updated_at=now() where id=batch.id;
  for item in select * from public.import_rows where batch_id=batch.id and status in ('VALID','DECIDED') order by row_number for update skip locked limit greatest(1,least(batch_size,100)) loop
    begin
      entity_id:=null;before_row:=null;
      if item.decision in ('UPDATE','MERGE') then
        if batch.resource_type='CONTACTS' then select to_jsonb(x) into before_row from public.contacts x where id=item.duplicate_entity_id and workspace_id=batch.workspace_id for update;
        elsif batch.resource_type='ORGANIZATIONS' then select to_jsonb(x) into before_row from public.organizations x where id=item.duplicate_entity_id and workspace_id=batch.workspace_id for update;
        elsif batch.resource_type='HOUSEHOLDS' then select to_jsonb(x) into before_row from public.households x where id=item.duplicate_entity_id and workspace_id=batch.workspace_id for update;
        else select to_jsonb(x) into before_row from public.students x where id=item.duplicate_entity_id and workspace_id=batch.workspace_id for update; end if;
        if not found then raise exception 'import_duplicate_scope_invalid'; end if;
      end if;
      if batch.resource_type='CONTACTS' then
        if coalesce(item.decision,'CREATE')='CREATE' then insert into public.contacts(workspace_id,name_zh,name_en,email,phone,title,status,owner_id,created_by) values(batch.workspace_id,item.normalized_data->>'nameZh',item.normalized_data->>'nameEn',nullif(item.normalized_data->>'email','')::citext,nullif(item.normalized_data->>'phone',''),coalesce(item.normalized_data->>'title',''),'UNVERIFIED',app_auth.current_user_id(),app_auth.current_user_id()) returning id into entity_id;
        else update public.contacts set name_zh=item.normalized_data->>'nameZh',name_en=item.normalized_data->>'nameEn',email=coalesce(nullif(item.normalized_data->>'email','')::citext,email),phone=coalesce(nullif(item.normalized_data->>'phone',''),phone),title=coalesce(nullif(item.normalized_data->>'title',''),title),updated_at=now() where id=item.duplicate_entity_id returning id into entity_id; end if;
        select to_jsonb(x) into after_row from public.contacts x where id=entity_id;
      elsif batch.resource_type='ORGANIZATIONS' then
        values_array:=array_remove(regexp_split_to_array(coalesce(item.normalized_data->>'courseCategories',''),'\s*[,，]\s*'), '');
        if coalesce(item.decision,'CREATE')='CREATE' then insert into public.organizations(workspace_id,name_zh,name_en,city,curriculum,course_categories,affiliation_type,parent_organization_id,website,founded_year,student_count,faculty_count,campus_count,organization_overview_markdown,structure_overview_markdown,status,owner_id,created_by) values(batch.workspace_id,item.normalized_data->>'nameZh',item.normalized_data->>'nameEn',coalesce(item.normalized_data->>'city',''),coalesce(item.normalized_data->>'curriculum',''),values_array,coalesce(nullif(upper(item.normalized_data->>'affiliationType'),''),'INDEPENDENT'),nullif(item.normalized_data->>'parentOrganizationId','')::uuid,coalesce(item.normalized_data->>'website',''),nullif(item.normalized_data->>'foundedYear','')::integer,nullif(item.normalized_data->>'studentCount','')::integer,nullif(item.normalized_data->>'facultyCount','')::integer,nullif(item.normalized_data->>'campusCount','')::integer,coalesce(item.normalized_data->>'organizationOverviewMarkdown',''),coalesce(item.normalized_data->>'structureOverviewMarkdown',''),'UNVERIFIED',app_auth.current_user_id(),app_auth.current_user_id()) returning id into entity_id;
        else update public.organizations set name_zh=item.normalized_data->>'nameZh',name_en=item.normalized_data->>'nameEn',city=coalesce(item.normalized_data->>'city',city),curriculum=coalesce(item.normalized_data->>'curriculum',curriculum),course_categories=values_array,affiliation_type=coalesce(nullif(upper(item.normalized_data->>'affiliationType'),''),affiliation_type),parent_organization_id=nullif(item.normalized_data->>'parentOrganizationId','')::uuid,website=coalesce(item.normalized_data->>'website',website),founded_year=nullif(item.normalized_data->>'foundedYear','')::integer,student_count=nullif(item.normalized_data->>'studentCount','')::integer,faculty_count=nullif(item.normalized_data->>'facultyCount','')::integer,campus_count=nullif(item.normalized_data->>'campusCount','')::integer,organization_overview_markdown=coalesce(item.normalized_data->>'organizationOverviewMarkdown',''),structure_overview_markdown=coalesce(item.normalized_data->>'structureOverviewMarkdown',''),updated_at=now() where id=item.duplicate_entity_id returning id into entity_id; end if;
        select to_jsonb(x) into after_row from public.organizations x where id=entity_id;
      elsif batch.resource_type='HOUSEHOLDS' then
        if coalesce(item.decision,'CREATE')='CREATE' then insert into public.households(workspace_id,name_zh,name_en,address,primary_parent_occupation,secondary_parent_occupation,annual_income_amount,income_currency,preferred_contact_method,preferred_language,education_expectations_markdown,family_background_markdown,created_by) values(batch.workspace_id,item.normalized_data->>'nameZh',item.normalized_data->>'nameEn',coalesce(item.normalized_data->>'address',''),coalesce(item.normalized_data->>'primaryParentOccupation',''),coalesce(item.normalized_data->>'secondaryParentOccupation',''),nullif(item.normalized_data->>'annualIncomeAmount','')::numeric,coalesce(nullif(upper(item.normalized_data->>'incomeCurrency'),''),'CNY'),coalesce(nullif(upper(item.normalized_data->>'preferredContactMethod'),''),'EMAIL'),coalesce(item.normalized_data->>'preferredLanguage',''),coalesce(item.normalized_data->>'educationExpectationsMarkdown',''),coalesce(item.normalized_data->>'familyBackgroundMarkdown',''),app_auth.current_user_id()) returning id into entity_id;
        else update public.households set name_zh=item.normalized_data->>'nameZh',name_en=item.normalized_data->>'nameEn',address=coalesce(item.normalized_data->>'address',''),primary_parent_occupation=coalesce(item.normalized_data->>'primaryParentOccupation',''),secondary_parent_occupation=coalesce(item.normalized_data->>'secondaryParentOccupation',''),annual_income_amount=nullif(item.normalized_data->>'annualIncomeAmount','')::numeric,income_currency=coalesce(nullif(upper(item.normalized_data->>'incomeCurrency'),''),'CNY'),preferred_contact_method=coalesce(nullif(upper(item.normalized_data->>'preferredContactMethod'),''),'EMAIL'),preferred_language=coalesce(item.normalized_data->>'preferredLanguage',''),education_expectations_markdown=coalesce(item.normalized_data->>'educationExpectationsMarkdown',''),family_background_markdown=coalesce(item.normalized_data->>'familyBackgroundMarkdown',''),updated_at=now() where id=item.duplicate_entity_id returning id into entity_id; end if;
        select to_jsonb(x) into after_row from public.households x where id=entity_id;
      else
        values_array:=array_remove(regexp_split_to_array(coalesce(item.normalized_data->>'interests',''),'\s*[,，]\s*'), '');
        if coalesce(item.decision,'CREATE')='CREATE' then insert into public.students(workspace_id,person_id,household_id,student_number,birth_date,current_grade,current_class,academic_year,interests,preferred_learning_style,personality_markdown,learning_expectations_markdown,strengths_markdown,support_needs_markdown,created_by) values(batch.workspace_id,(item.normalized_data->>'personId')::uuid,nullif(item.normalized_data->>'householdId','')::uuid,nullif(item.normalized_data->>'studentNumber',''),nullif(item.normalized_data->>'birthDate','')::date,item.normalized_data->>'currentGrade',coalesce(item.normalized_data->>'currentClass',''),item.normalized_data->>'academicYear',values_array,coalesce(nullif(upper(item.normalized_data->>'preferredLearningStyle'),''),'UNSPECIFIED'),coalesce(item.normalized_data->>'personalityMarkdown',''),coalesce(item.normalized_data->>'learningExpectationsMarkdown',''),coalesce(item.normalized_data->>'strengthsMarkdown',''),coalesce(item.normalized_data->>'supportNeedsMarkdown',''),app_auth.current_user_id()) returning id into entity_id;
        else update public.students set household_id=nullif(item.normalized_data->>'householdId','')::uuid,student_number=nullif(item.normalized_data->>'studentNumber',''),birth_date=nullif(item.normalized_data->>'birthDate','')::date,current_grade=item.normalized_data->>'currentGrade',current_class=coalesce(item.normalized_data->>'currentClass',''),academic_year=item.normalized_data->>'academicYear',interests=values_array,preferred_learning_style=coalesce(nullif(upper(item.normalized_data->>'preferredLearningStyle'),''),'UNSPECIFIED'),personality_markdown=coalesce(item.normalized_data->>'personalityMarkdown',''),learning_expectations_markdown=coalesce(item.normalized_data->>'learningExpectationsMarkdown',''),strengths_markdown=coalesce(item.normalized_data->>'strengthsMarkdown',''),support_needs_markdown=coalesce(item.normalized_data->>'supportNeedsMarkdown',''),updated_at=now() where id=item.duplicate_entity_id returning id into entity_id; end if;
        select to_jsonb(x) into after_row from public.students x where id=entity_id;
      end if;
      update public.import_rows set status='APPLIED',applied_entity_id=entity_id,before_snapshot=before_row,after_snapshot=after_row,applied_at=now(),last_error=null where id=item.id;
    exception when others then update public.import_rows set status='FAILED',last_error=left(sqlerrm,500) where id=item.id; end;
  end loop;
  update public.import_batches b set applied_rows=(select count(*) from public.import_rows where batch_id=b.id and status='APPLIED'),failed_rows=(select count(*) from public.import_rows where batch_id=b.id and status='FAILED'),status=case when exists(select 1 from public.import_rows where batch_id=b.id and status in ('VALID','DECIDED')) then 'PROCESSING' when exists(select 1 from public.import_rows where batch_id=b.id and status in ('INVALID','FAILED')) then 'PARTIAL_FAILED' else 'COMPLETED' end,completed_at=case when not exists(select 1 from public.import_rows where batch_id=b.id and status in ('VALID','DECIDED')) then now() end,updated_at=now() where b.id=batch.id returning * into batch;
  return batch;
end;
$$;

-- Rich education rows retain the same repair and rollback guarantees as the
-- original contact and organization imports.
create or replace function public.repair_import_row(target_row uuid,replacement jsonb)
returns public.import_rows language plpgsql security definer set search_path=public,app_auth,extensions
as $$
declare row_record public.import_rows;batch_record public.import_batches;normalized jsonb;validation_errors jsonb:='[]'::jsonb;duplicate_id uuid;matched_score numeric;reasons jsonb:='[]'::jsonb;
begin
  select * into row_record from public.import_rows where id=target_row and workspace_id=public.current_workspace_id() for update;
  if not found or row_record.status not in ('INVALID','FAILED') then raise exception 'import_row_not_repairable'; end if;
  select * into batch_record from public.import_batches where id=row_record.batch_id and workspace_id=row_record.workspace_id for update;
  if batch_record.created_by<>app_auth.current_user_id() and public.current_crm_role() not in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER') then raise exception 'import_repair_forbidden'; end if;
  if replacement is null or jsonb_typeof(replacement)<>'object' or exists(
    select 1 from jsonb_object_keys(replacement) key where key not in (
      'nameZh','nameEn','email','phone','title','city','curriculum','courseCategories','affiliationType','parentOrganizationId','website','foundedYear','studentCount','facultyCount','campusCount','organizationOverviewMarkdown','structureOverviewMarkdown',
      'address','primaryParentOccupation','secondaryParentOccupation','annualIncomeAmount','incomeCurrency','preferredContactMethod','preferredLanguage','educationExpectationsMarkdown','familyBackgroundMarkdown',
      'personId','householdId','studentNumber','birthDate','currentGrade','currentClass','academicYear','interests','preferredLearningStyle','personalityMarkdown','learningExpectationsMarkdown','strengthsMarkdown','supportNeedsMarkdown'
    )
  ) then raise exception 'import_repair_invalid'; end if;
  normalized:=row_record.normalized_data||replacement;
  if nullif(trim(normalized->>'nameZh'),'') is null or nullif(trim(normalized->>'nameEn'),'') is null then validation_errors:=validation_errors||'[{"code":"NAME_REQUIRED"}]'::jsonb; end if;
  if batch_record.resource_type='CONTACTS' and nullif(trim(normalized->>'email'),'') is null and nullif(trim(normalized->>'phone'),'') is null then validation_errors:=validation_errors||'[{"code":"CONTACT_METHOD_REQUIRED"}]'::jsonb; end if;
  if batch_record.resource_type='STUDENTS' and (nullif(normalized->>'personId','') is null or nullif(normalized->>'currentGrade','') is null or nullif(normalized->>'academicYear','') is null) then validation_errors:=validation_errors||'[{"code":"STUDENT_FIELDS_REQUIRED"}]'::jsonb; end if;
  if jsonb_array_length(validation_errors)=0 then
    if batch_record.resource_type='CONTACTS' then select id,90,'["CONTACT_MATCH"]'::jsonb into duplicate_id,matched_score,reasons from public.contacts where workspace_id=batch_record.workspace_id and ((normalized->>'email'<>'' and email=normalized->>'email') or (normalized->>'phone'<>'' and phone=normalized->>'phone')) limit 1;
    elsif batch_record.resource_type='ORGANIZATIONS' then select id,90,'["BILINGUAL_NAME"]'::jsonb into duplicate_id,matched_score,reasons from public.organizations where workspace_id=batch_record.workspace_id and (lower(name_zh)=lower(normalized->>'nameZh') or lower(name_en)=lower(normalized->>'nameEn')) limit 1;
    elsif batch_record.resource_type='HOUSEHOLDS' then select id,90,'["BILINGUAL_NAME"]'::jsonb into duplicate_id,matched_score,reasons from public.households where workspace_id=batch_record.workspace_id and (lower(name_zh)=lower(normalized->>'nameZh') or lower(name_en)=lower(normalized->>'nameEn')) limit 1;
    else select id,100,'["PERSON_ID"]'::jsonb into duplicate_id,matched_score,reasons from public.students where workspace_id=batch_record.workspace_id and person_id=(normalized->>'personId')::uuid limit 1; end if;
  end if;
  update public.import_rows set normalized_data=normalized,status=case when jsonb_array_length(validation_errors)>0 then 'INVALID' when duplicate_id is not null then 'DUPLICATE' else 'VALID' end,errors=validation_errors,duplicate_entity_id=duplicate_id,duplicate_score=matched_score,duplicate_reasons=reasons,decision=null,last_error=null where id=row_record.id returning * into row_record;
  update public.import_batches b set valid_rows=(select count(*) from public.import_rows where batch_id=b.id and status='VALID'),invalid_rows=(select count(*) from public.import_rows where batch_id=b.id and status='INVALID'),duplicate_rows=(select count(*) from public.import_rows where batch_id=b.id and status='DUPLICATE'),failed_rows=(select count(*) from public.import_rows where batch_id=b.id and status='FAILED'),status=case when exists(select 1 from public.import_rows where batch_id=b.id and status='DUPLICATE') then 'NEEDS_DECISION' when exists(select 1 from public.import_rows where batch_id=b.id and status in ('INVALID','FAILED')) then 'PARTIAL_FAILED' else 'READY' end,updated_at=now() where b.id=batch_record.id;
  return row_record;
end;
$$;

create or replace function public.rollback_import_batch(target_batch uuid)
returns public.import_batches language plpgsql security definer set search_path=public,app_auth,extensions
as $$
declare batch public.import_batches;item public.import_rows;current_row jsonb;
begin
  select * into batch from public.import_batches where id=target_batch and workspace_id=public.current_workspace_id() and created_by=app_auth.current_user_id() and status in ('COMPLETED','PARTIAL_FAILED') for update;
  if not found then raise exception 'import_not_rollbackable'; end if;
  for item in select * from public.import_rows where batch_id=batch.id and workspace_id=batch.workspace_id and status='APPLIED' order by row_number desc for update loop
    if batch.resource_type='CONTACTS' then select to_jsonb(x) into current_row from public.contacts x where id=item.applied_entity_id and workspace_id=batch.workspace_id for update;
    elsif batch.resource_type='ORGANIZATIONS' then select to_jsonb(x) into current_row from public.organizations x where id=item.applied_entity_id and workspace_id=batch.workspace_id for update;
    elsif batch.resource_type='HOUSEHOLDS' then select to_jsonb(x) into current_row from public.households x where id=item.applied_entity_id and workspace_id=batch.workspace_id for update;
    else select to_jsonb(x) into current_row from public.students x where id=item.applied_entity_id and workspace_id=batch.workspace_id for update; end if;
    if not found then raise exception 'import_rollback_target_missing'; end if;
    if (current_row->>'updated_at') is distinct from (item.after_snapshot->>'updated_at') then raise exception 'import_rollback_conflict_row_%',item.row_number; end if;
    if item.before_snapshot is null then
      if batch.resource_type='CONTACTS' then delete from public.contacts where id=item.applied_entity_id and workspace_id=batch.workspace_id;
      elsif batch.resource_type='ORGANIZATIONS' then delete from public.organizations where id=item.applied_entity_id and workspace_id=batch.workspace_id;
      elsif batch.resource_type='HOUSEHOLDS' then delete from public.households where id=item.applied_entity_id and workspace_id=batch.workspace_id;
      else delete from public.students where id=item.applied_entity_id and workspace_id=batch.workspace_id; end if;
    elsif batch.resource_type='CONTACTS' then
      update public.contacts set name_zh=item.before_snapshot->>'name_zh',name_en=item.before_snapshot->>'name_en',email=nullif(item.before_snapshot->>'email','')::citext,phone=coalesce(item.before_snapshot->>'phone',''),title=coalesce(item.before_snapshot->>'title',''),status=item.before_snapshot->>'status',updated_at=(item.before_snapshot->>'updated_at')::timestamptz where id=item.applied_entity_id and workspace_id=batch.workspace_id;
    elsif batch.resource_type='ORGANIZATIONS' then
      update public.organizations set name_zh=item.before_snapshot->>'name_zh',name_en=item.before_snapshot->>'name_en',city=coalesce(item.before_snapshot->>'city',''),curriculum=coalesce(item.before_snapshot->>'curriculum',''),course_categories=array(select jsonb_array_elements_text(coalesce(item.before_snapshot->'course_categories','[]'::jsonb))),affiliation_type=item.before_snapshot->>'affiliation_type',parent_organization_id=nullif(item.before_snapshot->>'parent_organization_id','')::uuid,website=coalesce(item.before_snapshot->>'website',''),founded_year=nullif(item.before_snapshot->>'founded_year','')::integer,student_count=nullif(item.before_snapshot->>'student_count','')::integer,faculty_count=nullif(item.before_snapshot->>'faculty_count','')::integer,campus_count=nullif(item.before_snapshot->>'campus_count','')::integer,organization_overview_markdown=coalesce(item.before_snapshot->>'organization_overview_markdown',''),structure_overview_markdown=coalesce(item.before_snapshot->>'structure_overview_markdown',''),status=item.before_snapshot->>'status',updated_at=(item.before_snapshot->>'updated_at')::timestamptz where id=item.applied_entity_id and workspace_id=batch.workspace_id;
    elsif batch.resource_type='HOUSEHOLDS' then
      update public.households set name_zh=item.before_snapshot->>'name_zh',name_en=item.before_snapshot->>'name_en',address=coalesce(item.before_snapshot->>'address',''),primary_parent_occupation=coalesce(item.before_snapshot->>'primary_parent_occupation',''),secondary_parent_occupation=coalesce(item.before_snapshot->>'secondary_parent_occupation',''),annual_income_amount=nullif(item.before_snapshot->>'annual_income_amount','')::numeric,income_currency=item.before_snapshot->>'income_currency',preferred_contact_method=item.before_snapshot->>'preferred_contact_method',preferred_language=coalesce(item.before_snapshot->>'preferred_language',''),education_expectations_markdown=coalesce(item.before_snapshot->>'education_expectations_markdown',''),family_background_markdown=coalesce(item.before_snapshot->>'family_background_markdown',''),status=item.before_snapshot->>'status',updated_at=(item.before_snapshot->>'updated_at')::timestamptz where id=item.applied_entity_id and workspace_id=batch.workspace_id;
    else
      update public.students set household_id=nullif(item.before_snapshot->>'household_id','')::uuid,student_number=nullif(item.before_snapshot->>'student_number',''),birth_date=nullif(item.before_snapshot->>'birth_date','')::date,current_grade=item.before_snapshot->>'current_grade',current_class=coalesce(item.before_snapshot->>'current_class',''),academic_year=item.before_snapshot->>'academic_year',interests=array(select jsonb_array_elements_text(coalesce(item.before_snapshot->'interests','[]'::jsonb))),preferred_learning_style=item.before_snapshot->>'preferred_learning_style',personality_markdown=coalesce(item.before_snapshot->>'personality_markdown',''),learning_expectations_markdown=coalesce(item.before_snapshot->>'learning_expectations_markdown',''),strengths_markdown=coalesce(item.before_snapshot->>'strengths_markdown',''),support_needs_markdown=coalesce(item.before_snapshot->>'support_needs_markdown',''),status=item.before_snapshot->>'status',updated_at=(item.before_snapshot->>'updated_at')::timestamptz where id=item.applied_entity_id and workspace_id=batch.workspace_id;
    end if;
    update public.import_rows set status='ROLLED_BACK' where id=item.id and workspace_id=batch.workspace_id;
  end loop;
  update public.import_batches set status='ROLLED_BACK',rolled_back_at=now(),updated_at=now() where id=batch.id and workspace_id=batch.workspace_id returning * into batch;
  return batch;
end;
$$;

revoke all on function public.repair_import_row(uuid,jsonb) from public,crm_system;
grant execute on function public.repair_import_row(uuid,jsonb) to crm_app;
