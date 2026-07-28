create extension if not exists pgcrypto;
create extension if not exists citext;

create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  slug citext not null unique,
  name text not null,
  default_currency text not null default 'CNY' check (default_currency ~ '^[A-Z]{3}$'),
  created_at timestamptz not null default now()
);

insert into public.workspaces(id, slug, name)
values ('00000000-0000-4000-8000-000000000001', 'lumina', 'Lumina Education CRM')
on conflict (id) do nothing;

create table if not exists public.workspace_memberships (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER','SALES_SPECIALIST','SALES_SUPPORT')),
  status text not null default 'ACTIVE' check (status in ('ACTIVE','SUSPENDED')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

insert into public.workspace_memberships(workspace_id, user_id, role)
select '00000000-0000-4000-8000-000000000001', id, upper(raw_app_meta_data->>'role')
from auth.users
where upper(coalesce(raw_app_meta_data->>'role','')) in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER','SALES_SPECIALIST','SALES_SUPPORT')
on conflict (workspace_id, user_id) do update set role = excluded.role, status = 'ACTIVE';

create or replace function public.is_workspace_member(target_workspace uuid)
returns boolean language sql stable security definer set search_path = public
as $$ select exists(select 1 from public.workspace_memberships m where m.workspace_id = target_workspace and m.user_id = auth.uid() and m.status = 'ACTIVE'); $$;

create or replace function public.current_workspace_id()
returns uuid language sql stable security definer set search_path = public
as $$ select workspace_id from public.workspace_memberships where user_id = auth.uid() and status = 'ACTIVE' order by created_at limit 1; $$;

create or replace function public.handle_new_crm_membership()
returns trigger language plpgsql security definer set search_path = public
as $$
declare new_role text := upper(coalesce(new.raw_app_meta_data->>'role',''));
begin
  if new_role in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER','SALES_SPECIALIST','SALES_SUPPORT') then
    insert into public.workspace_memberships(workspace_id,user_id,role)
    values ('00000000-0000-4000-8000-000000000001',new.id,new_role)
    on conflict (workspace_id,user_id) do update set role=excluded.role,status='ACTIVE';
  end if;
  return new;
end; $$;
drop trigger if exists on_auth_user_created_crm_membership on auth.users;
create trigger on_auth_user_created_crm_membership after insert or update of raw_app_meta_data on auth.users for each row execute procedure public.handle_new_crm_membership();

create table if not exists public.audit_events (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces(id),
  actor_id uuid references auth.users(id),
  entity_type text not null,
  entity_id text not null,
  action text not null,
  before_data jsonb,
  after_data jsonb,
  request_id text,
  created_at timestamptz not null default now()
);
create index if not exists audit_events_workspace_time_idx on public.audit_events(workspace_id,created_at desc);

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default public.current_workspace_id() references public.workspaces(id),
  name_zh text not null,
  name_en text not null,
  city text not null default '',
  curriculum text not null default '',
  status text not null default 'DEVELOPING' check (status in ('HEALTHY','ATTENTION','DEVELOPING','RISK','UNVERIFIED')),
  owner_id uuid references auth.users(id),
  key_contact_coverage smallint not null default 0 check (key_contact_coverage between 0 and 100),
  completeness smallint not null default 50 check (completeness between 0 and 100),
  last_contact_at timestamptz,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists organizations_workspace_name_en_uidx on public.organizations(workspace_id,lower(name_en));
create index if not exists organizations_search_idx on public.organizations(workspace_id,status,updated_at desc);

create table if not exists public.contacts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default public.current_workspace_id() references public.workspaces(id),
  organization_id uuid references public.organizations(id) on delete set null,
  name_zh text not null,
  name_en text not null,
  contact_type text not null default 'CONTACT' check (contact_type in ('CONTACT','PARENT','STUDENT','SCHOOL_STAFF','PAYER')),
  email citext,
  phone text,
  title text not null default '',
  status text not null default 'ACTIVE' check (status in ('ACTIVE','FOLLOW_UP','VERIFIED','PROTECTED','UNVERIFIED')),
  owner_id uuid references auth.users(id),
  completeness smallint not null default 50 check (completeness between 0 and 100),
  last_interaction_at timestamptz,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists contacts_workspace_email_uidx on public.contacts(workspace_id,email) where email is not null;
create index if not exists contacts_search_idx on public.contacts(workspace_id,status,updated_at desc);

create table if not exists public.crm_tasks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default public.current_workspace_id() references public.workspaces(id),
  title_zh text not null,
  title_en text not null,
  related_type text not null default 'GENERAL',
  related_id uuid,
  related_label text not null default '',
  status text not null default 'TODO' check (status in ('TODO','IN_PROGRESS','WAITING_APPROVAL','DONE','OVERDUE')),
  priority text not null default 'NORMAL' check (priority in ('LOW','NORMAL','HIGH','URGENT')),
  owner_id uuid references auth.users(id),
  due_at timestamptz,
  completed_at timestamptz,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists crm_tasks_workspace_due_idx on public.crm_tasks(workspace_id,status,due_at);

create table if not exists public.sales_team_members (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default public.current_workspace_id() references public.workspaces(id),
  auth_user_id uuid references auth.users(id) on delete set null,
  name_zh text not null,
  name_en text not null,
  role text not null check (role in ('SALES_DIRECTOR','SALES_MANAGER','SALES_SPECIALIST','SALES_SUPPORT')),
  team text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists sales_team_member_auth_uidx on public.sales_team_members(workspace_id,auth_user_id) where auth_user_id is not null;

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default public.current_workspace_id() references public.workspaces(id),
  code citext not null,
  name_zh text not null,
  name_en text not null,
  billing_unit text not null check (billing_unit in ('PROJECT','TERM','MONTH','YEAR','SCHOOL_YEAR','SEASON')),
  duration_zh text not null,
  duration_en text not null,
  active boolean not null default true,
  is_default boolean not null default false,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(workspace_id,code)
);

create table if not exists public.product_prices (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  amount numeric(14,2) not null check (amount >= 0),
  effective_from date not null,
  effective_to date,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  check (effective_to is null or effective_to >= effective_from)
);
create unique index if not exists product_prices_current_uidx on public.product_prices(product_id,currency) where effective_to is null;

create table if not exists public.contracts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default public.current_workspace_id() references public.workspaces(id),
  contract_number text not null,
  organization_id uuid not null references public.organizations(id),
  product_id uuid references public.products(id),
  start_date date not null,
  end_date date not null,
  currency text not null default 'CNY' check (currency ~ '^[A-Z]{3}$'),
  contract_value numeric(14,2) not null check (contract_value >= 0),
  status text not null default 'DRAFT' check (status in ('DRAFT','PENDING_APPROVAL','ACTIVE','RENEWAL_PREP','NEGOTIATING','EXPIRED','CANCELLED','RISK')),
  relationship_level smallint not null default 1 check (relationship_level between 1 and 4),
  owner_id uuid references auth.users(id),
  signed_at timestamptz,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(workspace_id,contract_number),
  check (end_date >= start_date)
);
create index if not exists contracts_renewal_idx on public.contracts(workspace_id,status,end_date);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default public.current_workspace_id() references public.workspaces(id),
  contract_id uuid not null references public.contracts(id),
  product_id uuid references public.products(id),
  amount numeric(14,2) not null check (amount > 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  status text not null default 'PENDING' check (status in ('PENDING','CONFIRMED','REFUNDED','FAILED')),
  paid_at timestamptz,
  reference text,
  verified_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create unique index if not exists payments_reference_uidx on public.payments(workspace_id,reference) where reference is not null;
create index if not exists payments_reporting_idx on public.payments(workspace_id,status,paid_at);

create table if not exists public.user_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  workspace_id uuid not null default public.current_workspace_id() references public.workspaces(id),
  honorific text not null default '',
  bio text not null default '',
  avatar_path text,
  locale text not null default 'zh-CN' check (locale in ('zh-CN','en')),
  timezone text not null default 'Asia/Taipei',
  date_format text not null default 'yyyy-MM-dd' check (date_format in ('yyyy-MM-dd','dd/MM/yyyy','MM/dd/yyyy')),
  quiet_hours_start time,
  quiet_hours_end time,
  notifications jsonb not null default '{"tasks":{"email":true,"inApp":true},"relationship":{"email":true,"inApp":true},"sales":{"email":false,"inApp":true},"security":{"email":true,"inApp":true},"ai":{"email":false,"inApp":true}}'::jsonb,
  updated_at timestamptz not null default now()
);

insert into public.user_preferences(user_id,workspace_id)
select user_id,workspace_id from public.workspace_memberships
on conflict (user_id) do nothing;

create table if not exists public.appointments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default public.current_workspace_id() references public.workspaces(id),
  title_zh text not null,
  title_en text not null,
  appointment_type text not null check (appointment_type in ('MEETING','CONSULTATION','FOLLOW_UP','DEADLINE')),
  related_type text,
  related_id uuid,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  owner_id uuid not null default auth.uid() references auth.users(id),
  reminder_minutes integer[] not null default '{1440,60}',
  status text not null default 'SCHEDULED' check (status in ('SCHEDULED','COMPLETED','CANCELLED')),
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

create table if not exists public.reminders (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id),
  recipient_id uuid not null references auth.users(id),
  source_type text not null check (source_type in ('CONTRACT','APPOINTMENT','TASK')),
  source_id uuid not null,
  reminder_type text not null,
  scheduled_at timestamptz not null,
  status text not null default 'PENDING' check (status in ('PENDING','PROCESSING','DELIVERED','CANCELLED','FAILED')),
  attempts integer not null default 0,
  last_error text,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  unique(recipient_id,source_type,source_id,reminder_type,scheduled_at)
);
create index if not exists reminders_due_idx on public.reminders(status,scheduled_at);

create table if not exists public.user_notifications (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id),
  user_id uuid not null references auth.users(id),
  kind text not null,
  title_key text not null,
  body_key text not null,
  values jsonb not null default '{}'::jsonb,
  source_type text,
  source_id uuid,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists user_notifications_user_idx on public.user_notifications(user_id,read_at,created_at desc);

create table if not exists public.notification_outbox (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id),
  recipient_id uuid not null references auth.users(id),
  channel text not null check (channel in ('EMAIL')),
  template_key text not null,
  payload jsonb not null,
  status text not null default 'PENDING' check (status in ('PENDING','SENDING','SENT','FAILED')),
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  last_error text,
  created_at timestamptz not null default now()
);

insert into public.products(workspace_id,code,name_zh,name_en,billing_unit,duration_zh,duration_en,is_default)
values
('00000000-0000-4000-8000-000000000001','CAMP-SUMMER','夏令营','Summer Camp','TERM','2–4 周','2–4 weeks',true),
('00000000-0000-4000-8000-000000000001','ADMISSION','升学','Admissions Planning','YEAR','12–24 个月','12–24 months',true),
('00000000-0000-4000-8000-000000000001','COMPETE','竞赛','Competition Program','PROJECT','8–16 周','8–16 weeks',true),
('00000000-0000-4000-8000-000000000001','SUMMER-SCHOOL','夏校','Summer School Application','SEASON','6–12 周','6–12 weeks',true),
('00000000-0000-4000-8000-000000000001','FOUNDATION','预科','Foundation Program','SCHOOL_YEAR','9–12 个月','9–12 months',true)
on conflict (workspace_id,code) do nothing;

insert into public.product_prices(product_id,currency,amount,effective_from)
select id,'CNY',case code::text when 'CAMP-SUMMER' then 28000 when 'ADMISSION' then 120000 when 'COMPETE' then 45000 when 'SUMMER-SCHOOL' then 32000 else 180000 end,current_date
from public.products where workspace_id='00000000-0000-4000-8000-000000000001' and is_default
on conflict do nothing;

alter table public.approval_requests add column if not exists workspace_id uuid references public.workspaces(id);
update public.approval_requests set workspace_id='00000000-0000-4000-8000-000000000001' where workspace_id is null;
alter table public.approval_requests alter column workspace_id set default public.current_workspace_id();
alter table public.approval_requests alter column workspace_id set not null;
alter table public.performance_targets add column if not exists workspace_id uuid references public.workspaces(id);
update public.performance_targets set workspace_id='00000000-0000-4000-8000-000000000001' where workspace_id is null;
alter table public.performance_targets alter column workspace_id set default public.current_workspace_id();
alter table public.performance_targets alter column workspace_id set not null;

alter table public.performance_allocations alter column contributor_id drop not null;
alter table public.performance_allocations add column if not exists contributor_member_id uuid references public.sales_team_members(id);
alter table public.performance_allocations drop constraint if exists performance_allocations_target_id_contributor_id_key;
alter table public.performance_allocations drop constraint if exists performance_allocation_contributor_required;
alter table public.performance_allocations add constraint performance_allocation_contributor_required check ((contributor_id is not null)::int + (contributor_member_id is not null)::int = 1);
create unique index if not exists performance_allocations_target_user_uidx on public.performance_allocations(target_id,contributor_id) where contributor_id is not null;
create unique index if not exists performance_allocations_target_member_uidx on public.performance_allocations(target_id,contributor_member_id) where contributor_member_id is not null;

create or replace function public.create_approval(request_kind text, object_type text, object_id text, business_reason text)
returns public.approval_requests language plpgsql security definer set search_path=public
as $$
declare created public.approval_requests; next_number text;
begin
  if auth.uid() is null or not public.is_workspace_member(public.current_workspace_id()) then raise exception 'approval_not_authorized'; end if;
  if request_kind not in ('CONTRACT_SIGN','CONTRACT_EXPORT','PERFORMANCE_SUMMARY','PERFORMANCE_ALLOCATION') then raise exception 'approval_invalid_type'; end if;
  if nullif(trim(business_reason),'') is null then raise exception 'approval_reason_required'; end if;
  next_number := 'APR-' || to_char(clock_timestamp(),'YYMMDD') || '-' || lpad(nextval('public.approval_actions_id_seq')::text,6,'0');
  insert into public.approval_requests(workspace_id,request_number,request_type,business_object_type,business_object_id,requester_id,reason)
  values(public.current_workspace_id(),next_number,request_kind,object_type,object_id,auth.uid(),trim(business_reason)) returning * into created;
  insert into public.approval_actions(approval_request_id,actor_id,action,comment) values(created.id,auth.uid(),'SUBMITTED',trim(business_reason));
  return created;
end; $$;

create or replace function public.save_performance_plan(plan_id uuid, manager uuid, period_from date, period_to date, plan_currency text, plan_amount numeric, plan_allocations jsonb)
returns public.performance_targets language plpgsql security definer set search_path=public
as $$
declare target public.performance_targets; item jsonb; member public.sales_team_members; actor_role text:=public.crm_role();
begin
  if auth.uid() is null or actor_role not in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER') then raise exception 'performance_not_authorized'; end if;
  if manager<>auth.uid() and actor_role not in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR') then raise exception 'performance_manager_scope'; end if;
  if period_to<period_from or plan_amount<=0 or plan_currency !~ '^[A-Z]{3}$' then raise exception 'performance_invalid_target'; end if;
  if plan_id is null then
    insert into public.performance_targets(workspace_id,manager_id,period_start,period_end,currency,target_amount,status,created_by)
    values(public.current_workspace_id(),manager,period_from,period_to,plan_currency,plan_amount,'DRAFT',auth.uid()) returning * into target;
  else
    select * into target from public.performance_targets where id=plan_id and workspace_id=public.current_workspace_id() for update;
    if not found or target.status not in ('DRAFT','PENDING_APPROVAL') then raise exception 'performance_plan_locked'; end if;
    update public.performance_targets set manager_id=manager,period_start=period_from,period_end=period_to,currency=plan_currency,target_amount=plan_amount,status='DRAFT',version=version+1,updated_at=now() where id=plan_id returning * into target;
    delete from public.performance_allocations where target_id=target.id;
  end if;
  for item in select * from jsonb_array_elements(coalesce(plan_allocations,'[]'::jsonb)) loop
    select * into member from public.sales_team_members where id=(item->>'contributorMemberId')::uuid and workspace_id=target.workspace_id and active;
    if not found or member.role not in ('SALES_SPECIALIST','SALES_SUPPORT') then raise exception 'performance_invalid_contributor'; end if;
    insert into public.performance_allocations(target_id,contributor_member_id,contributor_role,attribution_type,allocated_amount,created_by)
    values(target.id,member.id,member.role,upper(item->>'attributionType'),(item->>'amount')::numeric,auth.uid());
  end loop;
  return target;
end; $$;

create or replace function public.submit_performance_plan(plan_id uuid, business_reason text)
returns public.approval_requests language plpgsql security definer set search_path=public
as $$
declare target public.performance_targets; request public.approval_requests;
begin
  select * into target from public.performance_targets where id=plan_id and workspace_id=public.current_workspace_id() for update;
  if not found or target.status<>'DRAFT' then raise exception 'performance_plan_not_draft'; end if;
  if target.manager_id<>auth.uid() and public.crm_role() not in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR') then raise exception 'performance_not_authorized'; end if;
  update public.performance_targets set status='PENDING_APPROVAL',updated_at=now() where id=plan_id;
  request:=public.create_approval('PERFORMANCE_ALLOCATION','PERFORMANCE_TARGET',plan_id::text,business_reason);
  return request;
end; $$;

create or replace function public.create_product_with_price(product_code text, product_name_zh text, product_name_en text, product_billing text, product_duration_zh text, product_duration_en text, price_currency text, price_amount numeric)
returns public.products language plpgsql security definer set search_path=public
as $$
declare created public.products;
begin
  if public.crm_role() not in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER') then raise exception 'product_not_authorized'; end if;
  if product_code !~ '^[A-Za-z0-9-]{2,40}$' or price_amount<0 then raise exception 'product_invalid'; end if;
  insert into public.products(workspace_id,code,name_zh,name_en,billing_unit,duration_zh,duration_en,created_by)
  values(public.current_workspace_id(),upper(product_code),trim(product_name_zh),trim(product_name_en),upper(product_billing),trim(product_duration_zh),trim(product_duration_en),auth.uid()) returning * into created;
  insert into public.product_prices(product_id,currency,amount,effective_from,created_by) values(created.id,upper(price_currency),price_amount,current_date,auth.uid());
  return created;
end; $$;

create or replace function public.crm_duplicate_check(resource text, candidate_email text default null, candidate_phone text default null, candidate_name_zh text default null, candidate_name_en text default null)
returns jsonb language plpgsql stable security definer set search_path=public
as $$
declare result jsonb;
begin
  if not public.is_workspace_member(public.current_workspace_id()) then raise exception 'not_authorized'; end if;
  if resource='schools' then
    select coalesce(jsonb_agg(jsonb_build_object('id',id,'nameZh',name_zh,'nameEn',name_en,'reason','NAME')), '[]'::jsonb) into result
    from public.organizations where workspace_id=public.current_workspace_id() and (lower(name_zh)=lower(coalesce(candidate_name_zh,'')) or lower(name_en)=lower(coalesce(candidate_name_en,''))) limit 10;
  elsif resource='people' then
    select coalesce(jsonb_agg(jsonb_build_object('id',id,'nameZh',name_zh,'nameEn',name_en,'reason',case when email=candidate_email::citext then 'EMAIL' when phone=candidate_phone then 'PHONE' else 'NAME' end)), '[]'::jsonb) into result
    from public.contacts where workspace_id=public.current_workspace_id() and ((candidate_email is not null and email=candidate_email::citext) or (candidate_phone is not null and phone=candidate_phone) or (lower(name_zh)=lower(coalesce(candidate_name_zh,'')) and lower(name_en)=lower(coalesce(candidate_name_en,'')))) limit 10;
  else result := '[]'::jsonb;
  end if;
  return result;
end; $$;

create or replace function public.generate_contract_reminders(target_contract uuid)
returns void language plpgsql security definer set search_path=public
as $$
declare c public.contracts; days_before integer;
begin
  select * into c from public.contracts where id=target_contract;
  if not found or c.owner_id is null then return; end if;
  update public.reminders set status='CANCELLED' where source_type='CONTRACT' and source_id=c.id and status='PENDING';
  foreach days_before in array array[90,60,30,14,7] loop
    if c.end_date - days_before >= current_date then
      insert into public.reminders(workspace_id,recipient_id,source_type,source_id,reminder_type,scheduled_at)
      values(c.workspace_id,c.owner_id,'CONTRACT',c.id,'RENEWAL_'||days_before,(c.end_date-days_before)::timestamp + time '09:00') on conflict do nothing;
    end if;
  end loop;
end; $$;

create or replace function public.contract_reminder_trigger()
returns trigger language plpgsql security definer set search_path=public as $$ begin perform public.generate_contract_reminders(new.id); return new; end; $$;
drop trigger if exists contracts_generate_reminders on public.contracts;
create trigger contracts_generate_reminders after insert or update of end_date,owner_id,status on public.contracts for each row execute procedure public.contract_reminder_trigger();

create or replace function public.generate_appointment_reminders(target_appointment uuid)
returns void language plpgsql security definer set search_path=public
as $$
declare a public.appointments; minutes_before integer;
begin
  select * into a from public.appointments where id=target_appointment;
  if not found then return; end if;
  update public.reminders set status='CANCELLED' where source_type='APPOINTMENT' and source_id=a.id and status='PENDING';
  if a.status <> 'SCHEDULED' then return; end if;
  foreach minutes_before in array a.reminder_minutes loop
    if a.starts_at - make_interval(mins=>minutes_before) > now() then
      insert into public.reminders(workspace_id,recipient_id,source_type,source_id,reminder_type,scheduled_at)
      values(a.workspace_id,a.owner_id,'APPOINTMENT',a.id,'BEFORE_'||minutes_before,a.starts_at-make_interval(mins=>minutes_before)) on conflict do nothing;
    end if;
  end loop;
end; $$;

create or replace function public.appointment_reminder_trigger()
returns trigger language plpgsql security definer set search_path=public as $$ begin perform public.generate_appointment_reminders(new.id); return new; end; $$;
drop trigger if exists appointments_generate_reminders on public.appointments;
create trigger appointments_generate_reminders after insert or update of starts_at,reminder_minutes,status on public.appointments for each row execute procedure public.appointment_reminder_trigger();

create or replace function public.process_due_reminders(batch_size integer default 50)
returns integer language plpgsql security definer set search_path=public
as $$
declare processed integer:=0; item public.reminders; wants_email boolean;
begin
  for item in select * from public.reminders where status in ('PENDING','FAILED') and scheduled_at<=now() and attempts<5 order by scheduled_at for update skip locked limit greatest(1,least(batch_size,200)) loop
    update public.reminders set status='PROCESSING',attempts=attempts+1 where id=item.id;
    insert into public.user_notifications(workspace_id,user_id,kind,title_key,body_key,values,source_type,source_id)
    values(item.workspace_id,item.recipient_id,'REMINDER','notification.reminder.title','notification.reminder.body',jsonb_build_object('type',item.reminder_type),item.source_type,item.source_id);
    select coalesce((notifications->'tasks'->>'email')::boolean,false) into wants_email from public.user_preferences where user_id=item.recipient_id;
    if wants_email then insert into public.notification_outbox(workspace_id,recipient_id,channel,template_key,payload) values(item.workspace_id,item.recipient_id,'EMAIL','reminder',jsonb_build_object('reminderId',item.id)); end if;
    update public.reminders set status='DELIVERED',delivered_at=now(),last_error=null where id=item.id;
    processed:=processed+1;
  end loop;
  return processed;
end; $$;

create or replace view public.monthly_consumption as
select p.workspace_id,date_trunc('month',p.paid_at)::date report_month,p.currency,sum(case when p.status='CONFIRMED' then p.amount else 0 end) confirmed_amount,count(distinct c.organization_id) customer_count,count(*) filter(where p.status='CONFIRMED') payment_count
from public.payments p join public.contracts c on c.id=p.contract_id
where p.paid_at is not null group by p.workspace_id,date_trunc('month',p.paid_at),p.currency;

create or replace function public.audit_row_change()
returns trigger language plpgsql security definer set search_path=public
as $$
declare ws uuid; entity text; before_row jsonb; after_row jsonb;
begin
  before_row:=case when tg_op='INSERT' then null else to_jsonb(old) end;
  after_row:=case when tg_op='DELETE' then null else to_jsonb(new) end;
  ws:=coalesce((after_row->>'workspace_id')::uuid,(before_row->>'workspace_id')::uuid,public.current_workspace_id());
  entity:=coalesce(after_row->>'id',before_row->>'id');
  insert into public.audit_events(workspace_id,actor_id,entity_type,entity_id,action,before_data,after_data)
  values(ws,auth.uid(),tg_table_name,entity,tg_op,before_row,after_row);
  return coalesce(new,old);
end; $$;

do $$ declare table_name text; begin
  foreach table_name in array array['organizations','contacts','crm_tasks','products','product_prices','contracts','payments','user_preferences','appointments','performance_targets','performance_allocations'] loop
    execute format('drop trigger if exists %I_audit on public.%I',table_name,table_name);
    execute format('create trigger %I_audit after insert or update or delete on public.%I for each row execute procedure public.audit_row_change()',table_name,table_name);
  end loop;
end $$;

alter table public.workspaces enable row level security;
alter table public.workspace_memberships enable row level security;
alter table public.audit_events enable row level security;
alter table public.organizations enable row level security;
alter table public.contacts enable row level security;
alter table public.crm_tasks enable row level security;
alter table public.sales_team_members enable row level security;
alter table public.products enable row level security;
alter table public.product_prices enable row level security;
alter table public.contracts enable row level security;
alter table public.payments enable row level security;
alter table public.user_preferences enable row level security;
alter table public.appointments enable row level security;
alter table public.reminders enable row level security;
alter table public.user_notifications enable row level security;
alter table public.notification_outbox enable row level security;

create policy "members read workspaces" on public.workspaces for select to authenticated using(public.is_workspace_member(id));
create policy "members read memberships" on public.workspace_memberships for select to authenticated using(user_id=auth.uid() or (public.is_workspace_member(workspace_id) and public.crm_role() in ('SUPER_ADMIN','ADMIN')));
create policy "admins manage memberships" on public.workspace_memberships for all to authenticated using(public.is_workspace_member(workspace_id) and public.crm_role() in ('SUPER_ADMIN','ADMIN')) with check(public.is_workspace_member(workspace_id) and public.crm_role() in ('SUPER_ADMIN','ADMIN'));
create policy "admins read audit" on public.audit_events for select to authenticated using(public.is_workspace_member(workspace_id) and public.crm_role() in ('SUPER_ADMIN','ADMIN'));

do $$ declare table_name text; begin
  foreach table_name in array array['organizations','contacts','crm_tasks','sales_team_members','products','contracts','payments','appointments'] loop
    execute format('create policy "workspace members read %1$s" on public.%1$I for select to authenticated using(public.is_workspace_member(workspace_id))',table_name);
    execute format('create policy "workspace members insert %1$s" on public.%1$I for insert to authenticated with check(public.is_workspace_member(workspace_id))',table_name);
    execute format('create policy "workspace members update %1$s" on public.%1$I for update to authenticated using(public.is_workspace_member(workspace_id)) with check(public.is_workspace_member(workspace_id))',table_name);
    execute format('create policy "workspace admins delete %1$s" on public.%1$I for delete to authenticated using(public.is_workspace_member(workspace_id) and public.crm_role() in (''SUPER_ADMIN'',''ADMIN''))',table_name);
  end loop;
end $$;

create policy "members read product prices" on public.product_prices for select to authenticated using(exists(select 1 from public.products p where p.id=product_id and public.is_workspace_member(p.workspace_id)));
create policy "admins manage product prices" on public.product_prices for all to authenticated using(exists(select 1 from public.products p where p.id=product_id and public.is_workspace_member(p.workspace_id) and public.crm_role() in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR'))) with check(exists(select 1 from public.products p where p.id=product_id and public.is_workspace_member(p.workspace_id) and public.crm_role() in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR')));
create policy "users read preferences" on public.user_preferences for select to authenticated using(user_id=auth.uid());
create policy "users insert preferences" on public.user_preferences for insert to authenticated with check(user_id=auth.uid() and public.is_workspace_member(workspace_id));
create policy "users update preferences" on public.user_preferences for update to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid() and public.is_workspace_member(workspace_id));
create policy "users read reminders" on public.reminders for select to authenticated using(recipient_id=auth.uid());
create policy "users manage reminders" on public.reminders for update to authenticated using(recipient_id=auth.uid()) with check(recipient_id=auth.uid());
create policy "users read notifications" on public.user_notifications for select to authenticated using(user_id=auth.uid());
create policy "users update notifications" on public.user_notifications for update to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
create policy "admins read outbox" on public.notification_outbox for select to authenticated using(public.is_workspace_member(workspace_id) and public.crm_role() in ('SUPER_ADMIN','ADMIN'));

drop policy if exists "approval participants can read" on public.approval_requests;
create policy "approval participants can read" on public.approval_requests for select to authenticated using(public.is_workspace_member(workspace_id) and (requester_id=auth.uid() or public.crm_role() in ('ADMIN','SUPER_ADMIN')));
drop policy if exists "authenticated users submit approvals" on public.approval_requests;
create policy "authenticated users submit approvals" on public.approval_requests for insert to authenticated with check(public.is_workspace_member(workspace_id) and requester_id=auth.uid() and status='PENDING' and decided_by is null);
drop policy if exists "sales hierarchy reads targets" on public.performance_targets;
create policy "sales hierarchy reads targets" on public.performance_targets for select to authenticated using(public.is_workspace_member(workspace_id) and (manager_id=auth.uid() or public.crm_role() in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR')));
drop policy if exists "allocation participants read" on public.performance_allocations;
create policy "allocation participants read" on public.performance_allocations for select to authenticated using(contributor_id=auth.uid() or exists(select 1 from public.sales_team_members m where m.id=contributor_member_id and m.auth_user_id=auth.uid()) or exists(select 1 from public.performance_targets t where t.id=target_id and t.manager_id=auth.uid()) or public.crm_role() in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR'));

grant select on public.workspaces,public.workspace_memberships,public.organizations,public.contacts,public.crm_tasks,public.sales_team_members,public.products,public.product_prices,public.contracts,public.payments,public.user_preferences,public.appointments,public.reminders,public.user_notifications,public.monthly_consumption to authenticated;
grant insert,update on public.organizations,public.contacts,public.crm_tasks,public.products,public.contracts,public.payments,public.user_preferences,public.appointments to authenticated;
grant delete on public.organizations,public.contacts,public.crm_tasks,public.products,public.contracts,public.payments,public.appointments to authenticated;
grant insert,update,delete on public.sales_team_members,public.product_prices to authenticated;
grant update on public.reminders,public.user_notifications to authenticated;
grant select on public.audit_events,public.notification_outbox to authenticated;
grant usage,select on sequence public.audit_events_id_seq to authenticated;
revoke all on function public.create_approval(text,text,text,text) from public;
grant execute on function public.create_approval(text,text,text,text) to authenticated;
revoke all on function public.save_performance_plan(uuid,uuid,date,date,text,numeric,jsonb),public.submit_performance_plan(uuid,text),public.create_product_with_price(text,text,text,text,text,text,text,numeric) from public;
grant execute on function public.save_performance_plan(uuid,uuid,date,date,text,numeric,jsonb),public.submit_performance_plan(uuid,text),public.create_product_with_price(text,text,text,text,text,text,text,numeric) to authenticated;
revoke all on function public.crm_duplicate_check(text,text,text,text,text) from public;
grant execute on function public.crm_duplicate_check(text,text,text,text,text) to authenticated;
revoke all on function public.process_due_reminders(integer) from public,anon,authenticated;
grant execute on function public.process_due_reminders(integer) to service_role;
grant execute on function public.is_workspace_member(uuid),public.current_workspace_id() to authenticated;
