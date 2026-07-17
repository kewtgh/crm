-- Role capability enforcement and approval side effects.
-- The membership row, not mutable user metadata, is the authorization source.

create or replace function public.current_crm_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select upper(role)
    from public.workspace_memberships
    where user_id = auth.uid() and status = 'ACTIVE'
    order by created_at
    limit 1
  ), '');
$$;

create or replace function public.crm_role()
returns text
language sql
stable
security definer
set search_path = public
as $$ select public.current_crm_role(); $$;

revoke all on function public.current_crm_role() from public;
grant execute on function public.current_crm_role() to authenticated;

alter table public.sales_team_members
  add column if not exists manager_member_id uuid references public.sales_team_members(id) on delete set null;
create index if not exists sales_team_members_manager_idx
  on public.sales_team_members(workspace_id, manager_member_id, active);

create table if not exists public.record_collaborators (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  resource_type text not null check (resource_type in ('ORGANIZATION','CONTACT','TASK','CONTRACT','APPOINTMENT')),
  resource_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  access_level text not null default 'READ' check (access_level in ('READ','EDIT')),
  granted_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  primary key (workspace_id, resource_type, resource_id, user_id)
);
alter table public.record_collaborators enable row level security;
create policy "collaborators read own grants" on public.record_collaborators for select to authenticated
  using (user_id = auth.uid() or (public.is_workspace_member(workspace_id) and public.current_crm_role() in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR')));
create policy "leaders manage collaborator grants" on public.record_collaborators for all to authenticated
  using (public.is_workspace_member(workspace_id) and public.current_crm_role() in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER'))
  with check (public.is_workspace_member(workspace_id) and public.current_crm_role() in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER') and granted_by = auth.uid());

create or replace function public.can_access_owned_record(target_workspace uuid, target_type text, target_id uuid, target_owner uuid, needs_edit boolean default false)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_workspace_member(target_workspace) and (
    public.current_crm_role() in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR')
    or target_owner = auth.uid()
    or exists (
      select 1
      from public.sales_team_members manager
      join public.sales_team_members report on report.manager_member_id = manager.id
      where manager.workspace_id = target_workspace
        and manager.auth_user_id = auth.uid()
        and manager.active and report.active
        and report.auth_user_id = target_owner
    )
    or exists (
      select 1 from public.record_collaborators c
      where c.workspace_id = target_workspace
        and c.resource_type = target_type
        and c.resource_id = target_id
        and c.user_id = auth.uid()
        and (not needs_edit or c.access_level = 'EDIT')
    )
  );
$$;
revoke all on function public.can_access_owned_record(uuid,text,uuid,uuid,boolean) from public;
grant execute on function public.can_access_owned_record(uuid,text,uuid,uuid,boolean) to authenticated;

-- Replace broad workspace-member write policies with owner/team/role policies.
do $$ declare table_name text; begin
  foreach table_name in array array['organizations','contacts','crm_tasks','sales_team_members','products','contracts','payments','appointments'] loop
    execute format('drop policy if exists "workspace members read %s" on public.%I', table_name, table_name);
    execute format('drop policy if exists "workspace members insert %s" on public.%I', table_name, table_name);
    execute format('drop policy if exists "workspace members update %s" on public.%I', table_name, table_name);
    execute format('drop policy if exists "workspace admins delete %s" on public.%I', table_name, table_name);
  end loop;
end $$;

create policy "scoped read organizations" on public.organizations for select to authenticated
  using (public.can_access_owned_record(workspace_id,'ORGANIZATION',id,owner_id,false));
create policy "sales create owned organizations" on public.organizations for insert to authenticated
  with check (public.is_workspace_member(workspace_id) and created_by=auth.uid() and owner_id=auth.uid() and public.current_crm_role() in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER','SALES_SPECIALIST'));
create policy "scoped update organizations" on public.organizations for update to authenticated
  using (public.can_access_owned_record(workspace_id,'ORGANIZATION',id,owner_id,true))
  with check (public.can_access_owned_record(workspace_id,'ORGANIZATION',id,owner_id,true));
create policy "admins delete organizations" on public.organizations for delete to authenticated
  using (public.is_workspace_member(workspace_id) and public.current_crm_role() in ('SUPER_ADMIN','ADMIN'));

create policy "scoped read contacts" on public.contacts for select to authenticated
  using (public.can_access_owned_record(workspace_id,'CONTACT',id,owner_id,false));
create policy "sales create owned contacts" on public.contacts for insert to authenticated
  with check (public.is_workspace_member(workspace_id) and created_by=auth.uid() and owner_id=auth.uid() and public.current_crm_role() in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER','SALES_SPECIALIST'));
create policy "scoped update contacts" on public.contacts for update to authenticated
  using (public.can_access_owned_record(workspace_id,'CONTACT',id,owner_id,true))
  with check (public.can_access_owned_record(workspace_id,'CONTACT',id,owner_id,true));
create policy "admins delete contacts" on public.contacts for delete to authenticated
  using (public.is_workspace_member(workspace_id) and public.current_crm_role() in ('SUPER_ADMIN','ADMIN'));

create policy "scoped read tasks" on public.crm_tasks for select to authenticated
  using (public.can_access_owned_record(workspace_id,'TASK',id,owner_id,false));
create policy "members create owned tasks" on public.crm_tasks for insert to authenticated
  with check (public.is_workspace_member(workspace_id) and created_by=auth.uid() and owner_id=auth.uid());
create policy "scoped update tasks" on public.crm_tasks for update to authenticated
  using (public.can_access_owned_record(workspace_id,'TASK',id,owner_id,true))
  with check (public.can_access_owned_record(workspace_id,'TASK',id,owner_id,true));
create policy "admins delete tasks" on public.crm_tasks for delete to authenticated
  using (public.is_workspace_member(workspace_id) and public.current_crm_role() in ('SUPER_ADMIN','ADMIN'));

create policy "members read sales directory" on public.sales_team_members for select to authenticated
  using (public.is_workspace_member(workspace_id));
create policy "leaders insert sales members" on public.sales_team_members for insert to authenticated
  with check (public.is_workspace_member(workspace_id) and public.current_crm_role() in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR'));
create policy "leaders update sales members" on public.sales_team_members for update to authenticated
  using (public.is_workspace_member(workspace_id) and public.current_crm_role() in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR'))
  with check (public.is_workspace_member(workspace_id) and public.current_crm_role() in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR'));
create policy "admins delete sales members" on public.sales_team_members for delete to authenticated
  using (public.is_workspace_member(workspace_id) and public.current_crm_role() in ('SUPER_ADMIN','ADMIN'));

create policy "members read products" on public.products for select to authenticated using(public.is_workspace_member(workspace_id));
create policy "catalog leaders create products" on public.products for insert to authenticated
  with check (public.is_workspace_member(workspace_id) and public.current_crm_role() in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR'));
create policy "catalog leaders update products" on public.products for update to authenticated
  using (public.is_workspace_member(workspace_id) and public.current_crm_role() in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR'))
  with check (public.is_workspace_member(workspace_id) and public.current_crm_role() in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR'));
create policy "admins delete products" on public.products for delete to authenticated
  using (public.is_workspace_member(workspace_id) and public.current_crm_role() in ('SUPER_ADMIN','ADMIN'));

create policy "scoped read contracts" on public.contracts for select to authenticated
  using (public.can_access_owned_record(workspace_id,'CONTRACT',id,owner_id,false));
create policy "sales create owned contracts" on public.contracts for insert to authenticated
  with check (public.is_workspace_member(workspace_id) and created_by=auth.uid() and owner_id=auth.uid() and status='DRAFT' and public.current_crm_role() in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER','SALES_SPECIALIST'));
create policy "sales update draft contracts" on public.contracts for update to authenticated
  using (public.can_access_owned_record(workspace_id,'CONTRACT',id,owner_id,true) and status in ('DRAFT','NEGOTIATING','RISK'))
  with check (public.can_access_owned_record(workspace_id,'CONTRACT',id,owner_id,true) and status in ('DRAFT','NEGOTIATING','RISK','PENDING_APPROVAL'));
create policy "admins delete contracts" on public.contracts for delete to authenticated
  using (public.is_workspace_member(workspace_id) and public.current_crm_role() in ('SUPER_ADMIN','ADMIN'));

create policy "finance scoped read payments" on public.payments for select to authenticated
  using (public.is_workspace_member(workspace_id) and (
    public.current_crm_role() in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR')
    or exists(select 1 from public.contracts c where c.id=contract_id and public.can_access_owned_record(c.workspace_id,'CONTRACT',c.id,c.owner_id,false))
  ));

create policy "scoped read appointments" on public.appointments for select to authenticated
  using (public.can_access_owned_record(workspace_id,'APPOINTMENT',id,owner_id,false));
create policy "members create owned appointments" on public.appointments for insert to authenticated
  with check (public.is_workspace_member(workspace_id) and created_by=auth.uid() and owner_id=auth.uid());
create policy "scoped update appointments" on public.appointments for update to authenticated
  using (public.can_access_owned_record(workspace_id,'APPOINTMENT',id,owner_id,true))
  with check (public.can_access_owned_record(workspace_id,'APPOINTMENT',id,owner_id,true));
create policy "admins delete appointments" on public.appointments for delete to authenticated
  using (public.is_workspace_member(workspace_id) and public.current_crm_role() in ('SUPER_ADMIN','ADMIN'));

revoke insert, update, delete on public.payments from authenticated;

-- Approval state machine metadata and idempotent generated work.
alter table public.approval_requests add column if not exists object_version integer not null default 1 check (object_version > 0);
alter table public.approval_requests add column if not exists expires_at timestamptz not null default (now() + interval '7 days');
alter table public.approval_requests add column if not exists execution_status text not null default 'NOT_STARTED'
  check (execution_status in ('NOT_STARTED','SUCCEEDED','FAILED'));
alter table public.approval_requests add column if not exists execution_error text;
alter table public.approval_requests add column if not exists executed_at timestamptz;
create unique index if not exists approval_one_pending_object_uidx
  on public.approval_requests(workspace_id,request_type,business_object_type,business_object_id)
  where status='PENDING';

create table if not exists public.generated_jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id),
  approval_request_id uuid not null unique references public.approval_requests(id),
  job_type text not null check (job_type in ('CONTRACT_EXPORT','PERFORMANCE_SUMMARY')),
  parameters jsonb not null default '{}'::jsonb,
  status text not null default 'QUEUED' check (status in ('QUEUED','PROCESSING','READY','FAILED','EXPIRED')),
  artifact_path text,
  expires_at timestamptz,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.generated_jobs enable row level security;
create policy "job participants read" on public.generated_jobs for select to authenticated
  using (public.is_workspace_member(workspace_id) and (created_by=auth.uid() or public.current_crm_role() in ('SUPER_ADMIN','ADMIN')));

create or replace function public.create_approval(request_kind text, object_type text, object_id text, business_reason text)
returns public.approval_requests
language plpgsql
security definer
set search_path=public
as $$
declare created public.approval_requests; next_number text; object_uuid uuid; ws uuid:=public.current_workspace_id();
begin
  if auth.uid() is null or ws is null then raise exception 'approval_not_authorized'; end if;
  if nullif(trim(business_reason),'') is null then raise exception 'approval_reason_required'; end if;
  if request_kind in ('CONTRACT_SIGN','CONTRACT_EXPORT') then
    if object_type <> 'CONTRACT' then raise exception 'approval_invalid_object'; end if;
    begin object_uuid:=object_id::uuid; exception when invalid_text_representation then raise exception 'approval_invalid_object'; end;
    if not exists(select 1 from public.contracts where id=object_uuid and workspace_id=ws) then raise exception 'approval_object_not_found'; end if;
  elsif request_kind='PERFORMANCE_ALLOCATION' then
    if object_type <> 'PERFORMANCE_TARGET' then raise exception 'approval_invalid_object'; end if;
    begin object_uuid:=object_id::uuid; exception when invalid_text_representation then raise exception 'approval_invalid_object'; end;
    if not exists(select 1 from public.performance_targets where id=object_uuid and workspace_id=ws) then raise exception 'approval_object_not_found'; end if;
  elsif request_kind='PERFORMANCE_SUMMARY' then
    if object_type <> 'PERFORMANCE_SUMMARY' or object_id !~ '^[a-zA-Z0-9_-]{3,80}$' then raise exception 'approval_invalid_object'; end if;
  else raise exception 'approval_invalid_type';
  end if;
  next_number := 'APR-' || to_char(clock_timestamp(),'YYMMDD') || '-' || lpad(nextval('public.approval_actions_id_seq')::text,6,'0');
  insert into public.approval_requests(workspace_id,request_number,request_type,business_object_type,business_object_id,requester_id,reason,expires_at)
  values(ws,next_number,request_kind,object_type,object_id,auth.uid(),trim(business_reason),now()+interval '7 days') returning * into created;
  if request_kind='CONTRACT_SIGN' then update public.contracts set status='PENDING_APPROVAL',updated_at=now() where id=object_uuid and status in ('DRAFT','NEGOTIATING','RISK'); end if;
  insert into public.approval_actions(approval_request_id,actor_id,action,comment) values(created.id,auth.uid(),'SUBMITTED',trim(business_reason));
  return created;
exception when unique_violation then raise exception 'approval_already_pending';
end; $$;

create or replace function public.decide_approval(request_id uuid, decision text, decision_comment text default null)
returns public.approval_requests
language plpgsql
security definer
set search_path=public
as $$
declare request public.approval_requests; actor_role text:=public.current_crm_role(); object_uuid uuid;
begin
  if auth.uid() is null or actor_role not in ('ADMIN','SUPER_ADMIN') then raise exception 'approval_not_authorized'; end if;
  if decision not in ('APPROVED','REJECTED') then raise exception 'approval_invalid_decision'; end if;
  if decision='REJECTED' and nullif(trim(decision_comment),'') is null then raise exception 'approval_rejection_reason_required'; end if;
  select * into request from public.approval_requests where id=request_id and workspace_id=public.current_workspace_id() for update;
  if not found or request.status<>'PENDING' then raise exception 'approval_not_pending'; end if;
  if request.expires_at<=now() then raise exception 'approval_expired'; end if;
  if request.requester_id=auth.uid() then raise exception 'approval_self_decision_forbidden'; end if;
  if request.required_role='SUPER_ADMIN' and actor_role<>'SUPER_ADMIN' then raise exception 'approval_super_admin_required'; end if;

  update public.approval_requests set status=decision,decision_reason=nullif(trim(decision_comment),''),decided_by=auth.uid(),decided_at=now(),updated_at=now() where id=request_id returning * into request;
  insert into public.approval_actions(approval_request_id,actor_id,action,comment) values(request_id,auth.uid(),decision,nullif(trim(decision_comment),''));

  begin
    if request.request_type in ('CONTRACT_SIGN','CONTRACT_EXPORT','PERFORMANCE_ALLOCATION') then object_uuid:=request.business_object_id::uuid; end if;
    if decision='APPROVED' and request.request_type='CONTRACT_SIGN' then
      update public.contracts set status='ACTIVE',signed_at=coalesce(signed_at,now()),updated_at=now() where id=object_uuid and workspace_id=request.workspace_id and status='PENDING_APPROVAL';
      if not found then raise exception 'contract_state_changed'; end if;
    elsif decision='REJECTED' and request.request_type='CONTRACT_SIGN' then
      update public.contracts set status='DRAFT',updated_at=now() where id=object_uuid and workspace_id=request.workspace_id and status='PENDING_APPROVAL';
    elsif decision='APPROVED' and request.request_type='PERFORMANCE_ALLOCATION' then
      update public.performance_targets set status='ACTIVE',updated_at=now() where id=object_uuid and workspace_id=request.workspace_id and status='PENDING_APPROVAL';
      if not found then raise exception 'performance_state_changed'; end if;
    elsif decision='REJECTED' and request.request_type='PERFORMANCE_ALLOCATION' then
      update public.performance_targets set status='DRAFT',updated_at=now() where id=object_uuid and workspace_id=request.workspace_id and status='PENDING_APPROVAL';
    elsif decision='APPROVED' and request.request_type in ('CONTRACT_EXPORT','PERFORMANCE_SUMMARY') then
      insert into public.generated_jobs(workspace_id,approval_request_id,job_type,parameters,created_by)
      values(request.workspace_id,request.id,request.request_type,jsonb_build_object('objectType',request.business_object_type,'objectId',request.business_object_id),request.requester_id)
      on conflict (approval_request_id) do nothing;
    end if;
    update public.approval_requests set execution_status='SUCCEEDED',executed_at=now(),execution_error=null where id=request.id returning * into request;
  exception when others then
    update public.approval_requests set execution_status='FAILED',executed_at=now(),execution_error=left(sqlerrm,500) where id=request.id returning * into request;
  end;
  return request;
end; $$;

create or replace function public.withdraw_approval(request_id uuid, withdrawal_reason text)
returns public.approval_requests language plpgsql security definer set search_path=public
as $$
declare request public.approval_requests; object_uuid uuid;
begin
  select * into request from public.approval_requests where id=request_id and workspace_id=public.current_workspace_id() for update;
  if not found or request.status<>'PENDING' or request.requester_id<>auth.uid() then raise exception 'approval_withdraw_forbidden'; end if;
  if nullif(trim(withdrawal_reason),'') is null then raise exception 'approval_withdraw_reason_required'; end if;
  update public.approval_requests set status='CANCELLED',decision_reason=trim(withdrawal_reason),updated_at=now() where id=request_id returning * into request;
  insert into public.approval_actions(approval_request_id,actor_id,action,comment) values(request_id,auth.uid(),'CANCELLED',trim(withdrawal_reason));
  if request.request_type='CONTRACT_SIGN' then object_uuid:=request.business_object_id::uuid; update public.contracts set status='DRAFT',updated_at=now() where id=object_uuid and status='PENDING_APPROVAL'; end if;
  if request.request_type='PERFORMANCE_ALLOCATION' then object_uuid:=request.business_object_id::uuid; update public.performance_targets set status='DRAFT',updated_at=now() where id=object_uuid and status='PENDING_APPROVAL'; end if;
  return request;
end; $$;

revoke all on function public.create_approval(text,text,text,text), public.decide_approval(uuid,text,text), public.withdraw_approval(uuid,text) from public;
grant execute on function public.create_approval(text,text,text,text), public.decide_approval(uuid,text,text), public.withdraw_approval(uuid,text) to authenticated;

-- Pending plans are immutable. Only a rejected/withdrawn plan returns to DRAFT.
drop policy if exists "target owners update drafts" on public.performance_targets;
create policy "target owners update drafts" on public.performance_targets for update to authenticated
  using ((manager_id=auth.uid() and status='DRAFT') or public.current_crm_role() in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR'))
  with check (status in ('DRAFT','PENDING_APPROVAL','ACTIVE','CLOSED'));

create or replace function public.generate_contract_reminders(target_contract uuid)
returns void language plpgsql security definer set search_path=public
as $$
declare c public.contracts; days_before integer;
begin
  select * into c from public.contracts where id=target_contract;
  if not found then return; end if;
  update public.reminders set status='CANCELLED' where source_type='CONTRACT' and source_id=c.id and status in ('PENDING','FAILED');
  if c.owner_id is null or c.status not in ('ACTIVE','RENEWAL_PREP','NEGOTIATING','RISK') then return; end if;
  foreach days_before in array array[90,60,30,14,7] loop
    if c.end_date-days_before>=current_date then
      insert into public.reminders(workspace_id,recipient_id,source_type,source_id,reminder_type,scheduled_at)
      values(c.workspace_id,c.owner_id,'CONTRACT',c.id,'RENEWAL_'||days_before,(c.end_date-days_before)::timestamp+time '09:00') on conflict do nothing;
    end if;
  end loop;
end; $$;

-- Remove directly identifying values from generic audit snapshots.
create or replace function public.audit_row_change()
returns trigger language plpgsql security definer set search_path=public
as $$
declare ws uuid; entity text; before_row jsonb; after_row jsonb;
begin
  before_row:=case when tg_op='INSERT' then null else to_jsonb(old) end;
  after_row:=case when tg_op='DELETE' then null else to_jsonb(new) end;
  if tg_table_name='contacts' then before_row:=before_row-'email'-'phone'; after_row:=after_row-'email'-'phone'; end if;
  if tg_table_name='payments' then before_row:=before_row-'reference'; after_row:=after_row-'reference'; end if;
  ws:=coalesce((after_row->>'workspace_id')::uuid,(before_row->>'workspace_id')::uuid,public.current_workspace_id());
  entity:=coalesce(after_row->>'id',before_row->>'id');
  insert into public.audit_events(workspace_id,actor_id,entity_type,entity_id,action,before_data,after_data,request_id)
  values(ws,auth.uid(),tg_table_name,entity,tg_op,before_row,after_row,txid_current()::text);
  return coalesce(new,old);
end; $$;

grant select on public.record_collaborators, public.generated_jobs to authenticated;
grant insert,update,delete on public.record_collaborators to authenticated;

create or replace function public.list_staff_users(search_query text default '', page_number integer default 1, page_size integer default 20)
returns table(
  user_id uuid, username text, display_name_zh text, display_name_en text, email text,
  role text, account_status text, last_sign_in_at timestamptz, mfa_enabled boolean,
  total_count bigint
)
language sql
stable
security definer
set search_path=public,auth
as $$
  with staff as (
    select u.id user_id, p.username::text, p.display_name_zh, p.display_name_en, u.email::text,
      m.role, m.status account_status, u.last_sign_in_at,
      exists(select 1 from auth.mfa_factors f where f.user_id=u.id and f.status='verified') mfa_enabled
    from auth.users u
    join public.user_profiles p on p.user_id=u.id
    join public.workspace_memberships m on m.user_id=u.id and m.workspace_id=public.current_workspace_id()
    where public.current_crm_role() in ('SUPER_ADMIN','ADMIN')
      and (coalesce(trim(search_query),'')='' or concat_ws(' ',p.username,p.display_name_zh,p.display_name_en,u.email,m.role) ilike '%'||replace(trim(search_query),'%','')||'%')
  )
  select staff.*,count(*) over() total_count from staff
  order by display_name_en,user_id
  offset (greatest(page_number,1)-1)*least(greatest(page_size,1),100)
  limit least(greatest(page_size,1),100);
$$;
revoke all on function public.list_staff_users(text,integer,integer) from public;
grant execute on function public.list_staff_users(text,integer,integer) to authenticated;

revoke insert,update,delete on public.performance_targets,public.performance_allocations from authenticated;
