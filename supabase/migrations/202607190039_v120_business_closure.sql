-- v1.2.0: close core CRM editing, task delegation, shared views,
-- approved CRM exports, account-recovery throttling, and task operations.

alter table public.organizations add column if not exists archived_at timestamptz;
alter table public.contacts add column if not exists archived_at timestamptz;
alter table public.crm_tasks add column if not exists archived_at timestamptz;
alter table public.crm_tasks add column if not exists sla_due_at timestamptz;

create index if not exists organizations_active_workspace_idx
  on public.organizations(workspace_id,updated_at desc) where archived_at is null;
create index if not exists contacts_active_workspace_idx
  on public.contacts(workspace_id,updated_at desc) where archived_at is null;
create index if not exists crm_tasks_active_owner_due_idx
  on public.crm_tasks(workspace_id,owner_id,status,due_at) where archived_at is null;

create or replace function public.set_crm_task_sla()
returns trigger
language plpgsql
set search_path=public
as $$
begin
  if tg_op='INSERT' or new.priority is distinct from old.priority or new.sla_due_at is null then
    new.sla_due_at:=coalesce(new.created_at,now())+case new.priority
      when 'URGENT' then interval '4 hours'
      when 'HIGH' then interval '24 hours'
      when 'NORMAL' then interval '72 hours'
      else interval '120 hours'
    end;
  end if;
  return new;
end;
$$;
drop trigger if exists crm_task_sla_before_write on public.crm_tasks;
create trigger crm_task_sla_before_write
before insert or update of priority,sla_due_at on public.crm_tasks
for each row execute procedure public.set_crm_task_sla();
update public.crm_tasks
set sla_due_at=created_at+case priority
  when 'URGENT' then interval '4 hours'
  when 'HIGH' then interval '24 hours'
  when 'NORMAL' then interval '72 hours'
  else interval '120 hours'
end
where sla_due_at is null;

create or replace function public.can_assign_crm_task(target_owner uuid)
returns boolean
language plpgsql
stable
security definer
set search_path=public
as $$
declare
  actor_role text:=public.current_crm_role();
  actor_team text;
  target_team text;
begin
  if auth.uid() is null or target_owner is null then return false; end if;
  if target_owner=auth.uid() then return true; end if;
  if not exists(
    select 1 from public.workspace_memberships
    where workspace_id=public.current_workspace_id()
      and user_id=target_owner and status='ACTIVE'
  ) then return false; end if;
  if actor_role in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR') then return true; end if;
  if actor_role<>'SALES_MANAGER' then return false; end if;
  select team into actor_team from public.sales_team_members
    where workspace_id=public.current_workspace_id() and auth_user_id=auth.uid() and active limit 1;
  select team into target_team from public.sales_team_members
    where workspace_id=public.current_workspace_id() and auth_user_id=target_owner and active limit 1;
  return actor_team is not null and actor_team=target_team;
end;
$$;

create or replace function public.list_assignable_crm_users(search_query text default '')
returns table(user_id uuid,display_name_zh text,display_name_en text,role text,team text)
language sql
stable
security definer
set search_path=public
as $$
  select m.user_id,p.display_name_zh,p.display_name_en,m.role,coalesce(s.team,'')
  from public.workspace_memberships m
  join public.user_profiles p on p.user_id=m.user_id
  left join public.sales_team_members s
    on s.workspace_id=m.workspace_id and s.auth_user_id=m.user_id and s.active
  where m.workspace_id=public.current_workspace_id()
    and m.status='ACTIVE'
    and public.can_assign_crm_task(m.user_id)
    and (
      nullif(trim(search_query),'') is null
      or concat_ws(' ',p.display_name_zh,p.display_name_en,m.role,s.team)
        ilike '%'||replace(replace(trim(search_query),'%',''),'_','')||'%'
    )
  order by case when m.user_id=auth.uid() then 0 else 1 end,p.display_name_en,m.user_id
  limit 30;
$$;

create or replace function public.create_crm_task(
  task_title_zh text,task_title_en text,relation_type text,relation_id uuid,
  relation_label text,task_priority text,task_due_at timestamptz,task_owner uuid
)
returns public.crm_tasks
language plpgsql
security definer
set search_path=public
as $$
declare
  result public.crm_tasks;
  owner_id uuid:=coalesce(task_owner,auth.uid());
  ws uuid:=public.current_workspace_id();
begin
  if auth.uid() is null or ws is null or not public.can_assign_crm_task(owner_id) then
    raise exception 'task_owner_not_assignable';
  end if;
  if nullif(trim(task_title_zh),'') is null or nullif(trim(task_title_en),'') is null
    or relation_type not in ('ORGANIZATION','CONTACT')
    or task_priority not in ('LOW','NORMAL','HIGH','URGENT')
    or task_due_at is null then
    raise exception 'task_input_invalid';
  end if;
  if relation_type='ORGANIZATION' and not exists(
    select 1 from public.organizations
    where id=relation_id and workspace_id=ws and archived_at is null
  ) then raise exception 'task_related_record_not_found';
  elsif relation_type='CONTACT' and not exists(
    select 1 from public.contacts
    where id=relation_id and workspace_id=ws and archived_at is null
  ) then raise exception 'task_related_record_not_found';
  end if;
  insert into public.crm_tasks(
    workspace_id,title_zh,title_en,related_type,related_id,related_label,
    status,priority,owner_id,due_at,created_by
  ) values(
    ws,trim(task_title_zh),trim(task_title_en),relation_type,relation_id,
    trim(relation_label),'TODO',task_priority,owner_id,task_due_at,auth.uid()
  ) returning * into result;
  return result;
end;
$$;

create or replace function public.save_crm_record(
  resource_key text,target_id uuid,expected_updated_at timestamptz,patch jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  ws uuid:=public.current_workspace_id();
  organization_row public.organizations;
  contact_row public.contacts;
  task_row public.crm_tasks;
  next_owner uuid;
begin
  if auth.uid() is null or ws is null or patch is null or jsonb_typeof(patch)<>'object' then
    raise exception 'crm_update_invalid';
  end if;
  resource_key:=lower(trim(resource_key));
  if resource_key='schools' then
    select * into organization_row from public.organizations
      where id=target_id and workspace_id=ws for update;
    if not found or not public.can_access_owned_record(
      organization_row.workspace_id,'ORGANIZATION',organization_row.id,organization_row.owner_id,true
    ) then raise exception 'crm_update_forbidden'; end if;
    if expected_updated_at is null or organization_row.updated_at<>expected_updated_at then
      raise exception 'crm_version_conflict';
    end if;
    update public.organizations set
      name_zh=coalesce(nullif(trim(patch->>'nameZh'),''),name_zh),
      name_en=coalesce(nullif(trim(patch->>'nameEn'),''),name_en),
      city=coalesce(nullif(trim(patch->>'city'),''),city),
      curriculum=coalesce(nullif(trim(patch->>'curriculum'),''),curriculum),
      status=case when patch->>'status' in ('HEALTHY','ATTENTION','DEVELOPING','RISK','UNVERIFIED')
        then patch->>'status' else status end,
      archived_at=case when patch ? 'archived'
        then case when (patch->>'archived')::boolean then now() else null end
        else archived_at end,
      updated_at=now()
    where id=target_id returning * into organization_row;
    return to_jsonb(organization_row);
  elsif resource_key='people' then
    select * into contact_row from public.contacts
      where id=target_id and workspace_id=ws for update;
    if not found or not public.can_access_owned_record(
      contact_row.workspace_id,'CONTACT',contact_row.id,contact_row.owner_id,true
    ) then raise exception 'crm_update_forbidden'; end if;
    if expected_updated_at is null or contact_row.updated_at<>expected_updated_at then
      raise exception 'crm_version_conflict';
    end if;
    update public.contacts set
      name_zh=coalesce(nullif(trim(patch->>'nameZh'),''),name_zh),
      name_en=coalesce(nullif(trim(patch->>'nameEn'),''),name_en),
      email=case when patch ? 'email' then nullif(trim(patch->>'email'),'') else email end,
      phone=case when patch ? 'phone' then nullif(trim(patch->>'phone'),'') else phone end,
      title=case when patch ? 'title' then trim(patch->>'title') else title end,
      status=case when patch->>'status' in ('ACTIVE','FOLLOW_UP','VERIFIED','PROTECTED','UNVERIFIED')
        then patch->>'status' else status end,
      archived_at=case when patch ? 'archived'
        then case when (patch->>'archived')::boolean then now() else null end
        else archived_at end,
      updated_at=now()
    where id=target_id returning * into contact_row;
    if contact_row.email is null and contact_row.phone is null then
      raise exception 'contact_method_required';
    end if;
    return to_jsonb(contact_row)-'email'-'phone';
  elsif resource_key='tasks' then
    select * into task_row from public.crm_tasks
      where id=target_id and workspace_id=ws for update;
    if not found or not public.can_access_owned_record(
      task_row.workspace_id,'TASK',task_row.id,task_row.owner_id,true
    ) then raise exception 'crm_update_forbidden'; end if;
    if expected_updated_at is null or task_row.updated_at<>expected_updated_at then
      raise exception 'crm_version_conflict';
    end if;
    next_owner:=case when patch ? 'ownerId' then (patch->>'ownerId')::uuid else task_row.owner_id end;
    if not public.can_assign_crm_task(next_owner) then raise exception 'task_owner_not_assignable'; end if;
    update public.crm_tasks set
      title_zh=coalesce(nullif(trim(patch->>'nameZh'),''),title_zh),
      title_en=coalesce(nullif(trim(patch->>'nameEn'),''),title_en),
      priority=case when patch->>'priority' in ('LOW','NORMAL','HIGH','URGENT')
        then patch->>'priority' else priority end,
      status=case when patch->>'status' in ('TODO','IN_PROGRESS','WAITING_APPROVAL','DONE','OVERDUE')
        then patch->>'status' else status end,
      due_at=case when patch ? 'dueAt' then (patch->>'dueAt')::timestamptz else due_at end,
      owner_id=next_owner,
      completed_at=case
        when patch->>'status'='DONE' then coalesce(completed_at,now())
        when patch ? 'status' then null
        else completed_at end,
      archived_at=case when patch ? 'archived'
        then case when (patch->>'archived')::boolean then now() else null end
        else archived_at end,
      updated_at=now()
    where id=target_id returning * into task_row;
    return to_jsonb(task_row);
  end if;
  raise exception 'crm_resource_invalid';
end;
$$;

create or replace function public.crm_record_history(
  resource_key text,target_id uuid,page_size integer default 20
)
returns table(action text,changed_at timestamptz,actor_id uuid,actor_name text)
language plpgsql
stable
security definer
set search_path=public
as $$
declare
  ws uuid:=public.current_workspace_id();
  owner_id uuid;
  audit_entity_type text;
begin
  resource_key:=lower(trim(resource_key));
  if resource_key='schools' then
    audit_entity_type:='organizations';
    select o.owner_id into owner_id from public.organizations o where o.id=target_id and o.workspace_id=ws;
    if not found or not public.can_access_owned_record(ws,'ORGANIZATION',target_id,owner_id,false) then
      raise exception 'crm_history_forbidden';
    end if;
  elsif resource_key='people' then
    audit_entity_type:='contacts';
    select c.owner_id into owner_id from public.contacts c where c.id=target_id and c.workspace_id=ws;
    if not found or not public.can_access_owned_record(ws,'CONTACT',target_id,owner_id,false) then
      raise exception 'crm_history_forbidden';
    end if;
  elsif resource_key='tasks' then
    audit_entity_type:='crm_tasks';
    select t.owner_id into owner_id from public.crm_tasks t where t.id=target_id and t.workspace_id=ws;
    if not found or not public.can_access_owned_record(ws,'TASK',target_id,owner_id,false) then
      raise exception 'crm_history_forbidden';
    end if;
  else raise exception 'crm_resource_invalid';
  end if;
  return query
    select a.action,a.created_at,a.actor_id,
      coalesce(p.display_name_zh||' / '||p.display_name_en,'SYSTEM')
    from public.audit_events a
    left join public.user_profiles p on p.user_id=a.actor_id
    where a.workspace_id=ws and a.entity_type=audit_entity_type and a.entity_id=target_id::text
    order by a.created_at desc
    limit least(greatest(page_size,1),100);
end;
$$;

create or replace function public.sync_crm_task_notifications()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  update public.reminders set status='CANCELLED'
  where source_type='TASK' and source_id=new.id and status in ('PENDING','FAILED');
  if new.owner_id is not null and new.archived_at is null and new.status<>'DONE' and new.due_at>now() then
    insert into public.reminders(
      workspace_id,recipient_id,source_type,source_id,reminder_type,scheduled_at
    ) values(
      new.workspace_id,new.owner_id,'TASK',new.id,'TASK_DUE',
      greatest(now()+interval '1 minute',new.due_at-interval '1 hour')
    ) on conflict do nothing;
  end if;
  if new.owner_id is not null and (tg_op='INSERT' or new.owner_id is distinct from old.owner_id)
    and new.owner_id<>coalesce(auth.uid(),new.created_by) then
    insert into public.user_notifications(
      workspace_id,user_id,kind,title_key,body_key,values,source_type,source_id
    ) values(
      new.workspace_id,new.owner_id,'TASK','notification.taskAssigned.title',
      'notification.taskAssigned.body',
      jsonb_build_object('titleZh',new.title_zh,'titleEn',new.title_en,'dueAt',new.due_at),
      'TASK',new.id
    );
  end if;
  return new;
end;
$$;
drop trigger if exists crm_task_notification_after_write on public.crm_tasks;
create trigger crm_task_notification_after_write
after insert or update of owner_id,due_at,status,archived_at on public.crm_tasks
for each row execute procedure public.sync_crm_task_notifications();

create or replace function public.crm_task_workspace()
returns jsonb
language plpgsql
stable
security definer
set search_path=public
as $$
declare
  actor_role text:=public.current_crm_role();
  can_view_team boolean:=actor_role in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER');
  result jsonb;
begin
  if auth.uid() is null then raise exception 'task_workspace_forbidden'; end if;
  select jsonb_build_object(
    'canViewTeam',can_view_team,
    'items',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',task_rows.id,'titleZh',task_rows.title_zh,'titleEn',task_rows.title_en,
        'related',task_rows.related_label,'status',task_rows.status,'priority',task_rows.priority,
        'ownerId',task_rows.owner_id,
        'ownerName',coalesce(task_rows.owner_name,'—'),
        'dueAt',task_rows.due_at,'slaDueAt',task_rows.sla_due_at
      ) order by task_rows.sort_bucket,task_rows.due_at nulls last,task_rows.created_at)
      from (
        select t.*,p.display_name_zh||' / '||p.display_name_en owner_name,
          case when t.due_at<now() then 0 when t.sla_due_at<now() then 1 else 2 end sort_bucket
        from public.crm_tasks t
        left join public.user_profiles p on p.user_id=t.owner_id
        where t.workspace_id=public.current_workspace_id()
          and t.archived_at is null and t.status<>'DONE'
          and (t.owner_id=auth.uid() or (can_view_team and public.can_assign_crm_task(t.owner_id)))
        order by sort_bucket,t.due_at nulls last,t.created_at
        limit 100
      ) task_rows
    ),'[]'::jsonb),
    'capacity',case when can_view_team then coalesce((
      select jsonb_agg(jsonb_build_object(
        'userId',directory.user_id,
        'name',directory.display_name_zh||' / '||directory.display_name_en,
        'role',directory.role,'team',directory.team,
        'open',coalesce(counts.open_count,0),
        'overdue',coalesce(counts.overdue_count,0),
        'dueThisWeek',coalesce(counts.week_count,0),
        'slaBreached',coalesce(counts.sla_count,0)
      ) order by coalesce(counts.open_count,0) desc,directory.display_name_en)
      from public.list_assignable_crm_users('') directory
      left join lateral(
        select
          count(*) filter(where t.status<>'DONE' and t.archived_at is null) open_count,
          count(*) filter(where t.status<>'DONE' and t.archived_at is null and t.due_at<now()) overdue_count,
          count(*) filter(where t.status<>'DONE' and t.archived_at is null and t.due_at>=now() and t.due_at<now()+interval '7 days') week_count,
          count(*) filter(where t.status<>'DONE' and t.archived_at is null and t.sla_due_at<now()) sla_count
        from public.crm_tasks t
        where t.workspace_id=public.current_workspace_id() and t.owner_id=directory.user_id
      ) counts on true
    ),'[]'::jsonb) else '[]'::jsonb end
  ) into result;
  return result;
end;
$$;

create or replace function public.bulk_complete_crm_tasks(
  task_ids uuid[],completion_reason text
)
returns integer
language plpgsql
security definer
set search_path=public
as $$
declare affected integer;
begin
  if auth.uid() is null or cardinality(task_ids) not between 1 and 50
    or nullif(trim(completion_reason),'') is null then
    raise exception 'task_bulk_input_invalid';
  end if;
  update public.crm_tasks t set status='DONE',completed_at=coalesce(completed_at,now()),updated_at=now()
  where t.id=any(task_ids) and t.workspace_id=public.current_workspace_id()
    and t.archived_at is null and t.status<>'DONE'
    and public.can_access_owned_record(t.workspace_id,'TASK',t.id,t.owner_id,true);
  get diagnostics affected=row_count;
  if affected<>cardinality(task_ids) then raise exception 'task_bulk_scope_conflict'; end if;
  insert into public.audit_events(
    workspace_id,actor_id,entity_type,entity_id,action,after_data,request_id
  ) values(
    public.current_workspace_id(),auth.uid(),'crm_task_bulk',gen_random_uuid()::text,
    'BULK_COMPLETE',jsonb_build_object('taskIds',task_ids,'reason',trim(completion_reason)),
    txid_current()::text
  );
  return affected;
end;
$$;

create table if not exists public.shared_views(
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default public.current_workspace_id() references public.workspaces(id),
  resource_key text not null check(resource_key in ('schools','people','tasks','opportunities','contracts','finance','data-quality')),
  name text not null check(length(trim(name)) between 1 and 60),
  visibility text not null default 'PERSONAL' check(visibility in ('PERSONAL','TEAM')),
  config jsonb not null default '{}'::jsonb check(jsonb_typeof(config)='object'),
  owner_id uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(workspace_id,owner_id,resource_key,name)
);
alter table public.shared_views enable row level security;
create policy "members read visible shared views" on public.shared_views for select to authenticated
  using(public.is_workspace_member(workspace_id) and (owner_id=auth.uid() or visibility='TEAM'));
create policy "members create owned shared views" on public.shared_views for insert to authenticated
  with check(public.is_workspace_member(workspace_id) and owner_id=auth.uid());
create policy "owners update shared views" on public.shared_views for update to authenticated
  using(owner_id=auth.uid()) with check(owner_id=auth.uid() and public.is_workspace_member(workspace_id));
create policy "owners delete shared views" on public.shared_views for delete to authenticated
  using(owner_id=auth.uid());

create or replace function public.save_shared_view(
  p_resource_key text,p_view_name text,p_view_visibility text,p_view_config jsonb
)
returns public.shared_views
language plpgsql
security definer
set search_path=public
as $$
declare result public.shared_views;
begin
  p_resource_key:=lower(trim(p_resource_key));
  p_view_visibility:=upper(trim(p_view_visibility));
  if auth.uid() is null
    or p_resource_key not in ('schools','people','tasks','opportunities','contracts','finance','data-quality')
    or length(trim(p_view_name)) not between 1 and 60
    or p_view_visibility not in ('PERSONAL','TEAM')
    or jsonb_typeof(p_view_config)<>'object' then
    raise exception 'shared_view_invalid';
  end if;
  insert into public.shared_views(
    workspace_id,resource_key,name,visibility,config,owner_id
  ) values(
    public.current_workspace_id(),p_resource_key,trim(p_view_name),p_view_visibility,p_view_config,auth.uid()
  ) on conflict(workspace_id,owner_id,resource_key,name) do update set
    visibility=excluded.visibility,config=excluded.config,updated_at=now()
  returning * into result;
  return result;
end;
$$;

create or replace function public.delete_shared_view(target_view uuid)
returns void
language plpgsql
security definer
set search_path=public
as $$
begin
  delete from public.shared_views
  where id=target_view and workspace_id=public.current_workspace_id() and owner_id=auth.uid();
  if not found then raise exception 'shared_view_delete_forbidden'; end if;
end;
$$;

create table if not exists public.recovery_throttle_buckets(
  scope text not null check(scope in ('ACCOUNT','SOURCE')),
  key_hash text not null check(length(key_hash)=64),
  window_started_at timestamptz not null default now(),
  attempts integer not null default 0 check(attempts>=0),
  updated_at timestamptz not null default now(),
  primary key(scope,key_hash)
);
alter table public.recovery_throttle_buckets enable row level security;

create table if not exists public.mutation_receipts(
  workspace_id uuid not null references public.workspaces(id),
  request_key text not null check(length(request_key) between 8 and 160),
  operation text not null check(length(operation) between 3 and 80),
  result jsonb not null default '{}'::jsonb,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  primary key(workspace_id,request_key)
);
alter table public.mutation_receipts enable row level security;

create or replace function public.get_mutation_receipt(p_request_key text,p_operation_name text)
returns jsonb
language sql
stable
security definer
set search_path=public
as $$
  select result from public.mutation_receipts
  where workspace_id=public.current_workspace_id()
    and mutation_receipts.request_key=p_request_key
    and operation=p_operation_name and created_by=auth.uid();
$$;

create or replace function public.save_mutation_receipt(
  p_request_key text,p_operation_name text,p_operation_result jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare saved jsonb;
begin
  if auth.uid() is null or length(p_request_key) not between 8 and 160
    or length(p_operation_name) not between 3 and 80 then
    raise exception 'mutation_receipt_invalid';
  end if;
  insert into public.mutation_receipts(
    workspace_id,request_key,operation,result,created_by
  ) values(
    public.current_workspace_id(),p_request_key,p_operation_name,coalesce(p_operation_result,'{}'::jsonb),auth.uid()
  ) on conflict(workspace_id,request_key) do nothing;
  select result into saved from public.mutation_receipts
    where workspace_id=public.current_workspace_id()
      and mutation_receipts.request_key=p_request_key
      and operation=p_operation_name and created_by=auth.uid();
  if saved is null then raise exception 'mutation_receipt_conflict'; end if;
  return saved;
end;
$$;

create or replace function public.apply_account_recovery_throttle(
  account_hash text,source_hash text
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  account_row public.recovery_throttle_buckets;
  source_row public.recovery_throttle_buckets;
  window_size interval:=interval '30 minutes';
  allowed boolean;
  retry_after integer:=0;
begin
  if account_hash!~'^[a-f0-9]{64}$' or source_hash!~'^[a-f0-9]{64}$' then
    raise exception 'recovery_throttle_invalid';
  end if;
  insert into public.recovery_throttle_buckets(scope,key_hash,attempts)
    values('ACCOUNT',account_hash,1)
  on conflict(scope,key_hash) do update set
    attempts=case
      when recovery_throttle_buckets.window_started_at+window_size<=now() then 1
      else recovery_throttle_buckets.attempts+1 end,
    window_started_at=case
      when recovery_throttle_buckets.window_started_at+window_size<=now() then now()
      else recovery_throttle_buckets.window_started_at end,
    updated_at=now()
  returning * into account_row;
  insert into public.recovery_throttle_buckets(scope,key_hash,attempts)
    values('SOURCE',source_hash,1)
  on conflict(scope,key_hash) do update set
    attempts=case
      when recovery_throttle_buckets.window_started_at+window_size<=now() then 1
      else recovery_throttle_buckets.attempts+1 end,
    window_started_at=case
      when recovery_throttle_buckets.window_started_at+window_size<=now() then now()
      else recovery_throttle_buckets.window_started_at end,
    updated_at=now()
  returning * into source_row;
  allowed:=account_row.attempts<=5 and source_row.attempts<=20;
  if not allowed then
    retry_after:=greatest(
      extract(epoch from account_row.window_started_at+window_size-now())::integer,
      extract(epoch from source_row.window_started_at+window_size-now())::integer,
      1
    );
  end if;
  delete from public.recovery_throttle_buckets where updated_at<now()-interval '2 days';
  return jsonb_build_object('allowed',allowed,'retryAfterSeconds',retry_after);
end;
$$;

create or replace function public.idempotent_merge_duplicate_records(
  resource text,target_record uuid,source_record uuid,field_choices jsonb,p_request_key text
)
returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare existing_operation text;existing_result jsonb;merged_id uuid;
begin
  if auth.uid() is null or length(p_request_key) not between 8 and 160
    or coalesce(auth.jwt()->>'aal','aal1')<>'aal2' then
    raise exception 'mutation_receipt_invalid';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(public.current_workspace_id()::text||':'||p_request_key,0));
  select operation,result into existing_operation,existing_result
  from public.mutation_receipts
  where workspace_id=public.current_workspace_id() and request_key=p_request_key;
  if found then
    if existing_operation<>'DUPLICATE_MERGE' then raise exception 'mutation_receipt_conflict'; end if;
    return (existing_result->>'id')::uuid;
  end if;
  merged_id:=public.merge_duplicate_records(resource,target_record,source_record,field_choices);
  insert into public.mutation_receipts(workspace_id,request_key,operation,result,created_by)
  values(public.current_workspace_id(),p_request_key,'DUPLICATE_MERGE',jsonb_build_object('id',merged_id),auth.uid());
  return merged_id;
end;
$$;

create or replace function public.idempotent_rollback_import_batch(
  target_batch uuid,p_request_key text
)
returns public.import_batches
language plpgsql
security definer
set search_path=public
as $$
declare existing_operation text;existing_result jsonb;result public.import_batches;
begin
  if auth.uid() is null or length(p_request_key) not between 8 and 160 then
    raise exception 'mutation_receipt_invalid';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(public.current_workspace_id()::text||':'||p_request_key,0));
  select operation,mutation_receipts.result into existing_operation,existing_result
  from public.mutation_receipts
  where workspace_id=public.current_workspace_id() and request_key=p_request_key;
  if found then
    if existing_operation<>'IMPORT_ROLLBACK' then raise exception 'mutation_receipt_conflict'; end if;
    return jsonb_populate_record(null::public.import_batches,existing_result);
  end if;
  result:=public.rollback_import_batch(target_batch);
  insert into public.mutation_receipts(workspace_id,request_key,operation,result,created_by)
  values(public.current_workspace_id(),p_request_key,'IMPORT_ROLLBACK',to_jsonb(result),auth.uid());
  return result;
end;
$$;

create or replace function public.idempotent_accept_quote(
  target_quote uuid,p_request_key text
)
returns public.quotes
language plpgsql
security definer
set search_path=public
as $$
declare existing_operation text;existing_result jsonb;result public.quotes;
begin
  if auth.uid() is null or length(p_request_key) not between 8 and 160 then
    raise exception 'mutation_receipt_invalid';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(public.current_workspace_id()::text||':'||p_request_key,0));
  select operation,mutation_receipts.result into existing_operation,existing_result
  from public.mutation_receipts
  where workspace_id=public.current_workspace_id() and request_key=p_request_key;
  if found then
    if existing_operation<>'QUOTE_ACCEPT' then raise exception 'mutation_receipt_conflict'; end if;
    return jsonb_populate_record(null::public.quotes,existing_result);
  end if;
  result:=public.accept_quote(target_quote);
  insert into public.mutation_receipts(workspace_id,request_key,operation,result,created_by)
  values(public.current_workspace_id(),p_request_key,'QUOTE_ACCEPT',to_jsonb(result),auth.uid());
  return result;
end;
$$;

create or replace function public.idempotent_set_product_active(
  target_product uuid,target_active boolean,p_request_key text
)
returns public.products
language plpgsql
security definer
set search_path=public
as $$
declare existing_operation text;existing_result jsonb;result public.products;
begin
  if auth.uid() is null or length(p_request_key) not between 8 and 160
    or public.current_crm_role() not in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR')
    or coalesce(auth.jwt()->>'aal','aal1')<>'aal2' then
    raise exception 'product_update_not_authorized';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(public.current_workspace_id()::text||':'||p_request_key,0));
  select operation,mutation_receipts.result into existing_operation,existing_result
  from public.mutation_receipts
  where workspace_id=public.current_workspace_id() and request_key=p_request_key;
  if found then
    if existing_operation<>'PRODUCT_ACTIVE' then raise exception 'mutation_receipt_conflict'; end if;
    return jsonb_populate_record(null::public.products,existing_result);
  end if;
  update public.products set active=target_active,updated_at=now()
  where id=target_product and workspace_id=public.current_workspace_id()
  returning * into result;
  if not found then raise exception 'product_not_found'; end if;
  insert into public.mutation_receipts(workspace_id,request_key,operation,result,created_by)
  values(public.current_workspace_id(),p_request_key,'PRODUCT_ACTIVE',to_jsonb(result),auth.uid());
  return result;
end;
$$;

create or replace function public.resolve_data_quality_issue(
  target_issue uuid,resolution text,dismiss boolean default false
)
returns public.data_quality_issues
language plpgsql
security definer
set search_path=public
as $$
declare result public.data_quality_issues;
begin
  if public.current_crm_role() not in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER')
    or nullif(trim(resolution),'') is null then
    raise exception 'quality_not_authorized';
  end if;
  select * into result from public.data_quality_issues
    where id=target_issue and workspace_id=public.current_workspace_id()
      and status in ('OPEN','ASSIGNED') for update;
  if not found then raise exception 'quality_resolution_invalid'; end if;
  if dismiss then
    update public.data_quality_issues set status='DISMISSED',
      resolution_note=trim(resolution),resolved_by=auth.uid(),resolved_at=now()
    where id=target_issue returning * into result;
    return result;
  end if;
  perform public.run_data_quality_rules();
  select * into result from public.data_quality_issues where id=target_issue;
  if result.status<>'RESOLVED' then raise exception 'quality_source_not_fixed'; end if;
  update public.data_quality_issues
    set resolution_note=trim(resolution),resolved_by=auth.uid(),resolved_at=now()
    where id=target_issue returning * into result;
  return result;
end;
$$;

alter table public.approval_requests drop constraint if exists approval_requests_request_type_check;
alter table public.approval_requests add constraint approval_requests_request_type_check
  check(request_type in (
    'CONTRACT_SIGN','CONTRACT_EXPORT','PERFORMANCE_SUMMARY','PERFORMANCE_ALLOCATION',
    'QUOTE_DISCOUNT','REFUND','MARKETING_CONTACT_EXPORT','CRM_EXPORT'
  ));
alter table public.approval_requests add column if not exists request_payload jsonb not null default '{}'::jsonb;
alter table public.generated_jobs drop constraint if exists generated_jobs_job_type_check;
alter table public.generated_jobs add constraint generated_jobs_job_type_check
  check(job_type in ('CONTRACT_EXPORT','PERFORMANCE_SUMMARY','MARKETING_CONTACT_EXPORT','CRM_EXPORT'));

create or replace function public.set_approval_required_role()
returns trigger language plpgsql set search_path=public
as $$
begin
  new.required_role:=case
    when new.request_type in ('CONTRACT_EXPORT','MARKETING_CONTACT_EXPORT','CRM_EXPORT')
      then 'SUPER_ADMIN'
    else 'ADMIN'
  end;
  return new;
end;
$$;

create or replace function public.create_crm_export_approval(
  resource_key text,search_query text,status_filter text,sort_key text,
  sort_direction text,business_reason text
)
returns public.approval_requests
language plpgsql
security definer
set search_path=public
as $$
declare
  created public.approval_requests;
  next_number text;
  actor_role text:=public.current_crm_role();
  scope_value text;
begin
  resource_key:=lower(trim(resource_key));
  if auth.uid() is null or resource_key not in ('schools','people','tasks')
    or nullif(trim(business_reason),'') is null then
    raise exception 'approval_not_authorized';
  end if;
  scope_value:=case when actor_role in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR') then 'WORKSPACE' else 'OWNER' end;
  next_number:='APR-'||to_char(clock_timestamp(),'YYMMDD')||'-'||lpad(nextval('public.approval_actions_id_seq')::text,6,'0');
  insert into public.approval_requests(
    workspace_id,request_number,request_type,business_object_type,business_object_id,
    requester_id,reason,expires_at,request_payload
  ) values(
    public.current_workspace_id(),next_number,'CRM_EXPORT','CRM_EXPORT',
    resource_key||':'||gen_random_uuid(),auth.uid(),trim(business_reason),now()+interval '7 days',
    jsonb_build_object(
      'resource',resource_key,'query',left(coalesce(search_query,''),100),
      'status',left(coalesce(status_filter,'all'),40),
      'sort',left(coalesce(sort_key,'primary'),40),
      'direction',case when sort_direction='desc' then 'desc' else 'asc' end,
      'scope',scope_value,'requesterId',auth.uid()
    )
  ) returning * into created;
  insert into public.approval_actions(approval_request_id,actor_id,action,comment)
    values(created.id,auth.uid(),'SUBMITTED',trim(business_reason));
  return created;
exception when unique_violation then raise exception 'approval_already_pending';
end;
$$;

create or replace function public.decide_approval(
  request_id uuid,decision text,decision_comment text default null
)
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
  select * into request from public.approval_requests
    where id=request_id and workspace_id=public.current_workspace_id() for update;
  if not found or request.status<>'PENDING' then raise exception 'approval_not_pending'; end if;
  if request.expires_at<=now() then raise exception 'approval_expired'; end if;
  if request.requester_id=auth.uid() then raise exception 'approval_self_decision_forbidden'; end if;
  if request.required_role='SUPER_ADMIN' and actor_role<>'SUPER_ADMIN' then raise exception 'approval_super_admin_required'; end if;
  update public.approval_requests set
    status=decision,decision_reason=nullif(trim(decision_comment),''),
    decided_by=auth.uid(),decided_at=now(),updated_at=now()
  where id=request_id returning * into request;
  insert into public.approval_actions(approval_request_id,actor_id,action,comment)
    values(request_id,auth.uid(),decision,nullif(trim(decision_comment),''));
  begin
    if request.request_type in ('CONTRACT_SIGN','CONTRACT_EXPORT','PERFORMANCE_ALLOCATION') then
      object_uuid:=request.business_object_id::uuid;
    end if;
    if decision='APPROVED' and request.request_type='CONTRACT_SIGN' then
      update public.contracts set status='ACTIVE',signed_at=coalesce(signed_at,now()),updated_at=now()
        where id=object_uuid and workspace_id=request.workspace_id and status='PENDING_APPROVAL';
      if not found then raise exception 'contract_state_changed'; end if;
    elsif decision='REJECTED' and request.request_type='CONTRACT_SIGN' then
      update public.contracts set status='DRAFT',updated_at=now()
        where id=object_uuid and workspace_id=request.workspace_id and status='PENDING_APPROVAL';
    elsif decision='APPROVED' and request.request_type='PERFORMANCE_ALLOCATION' then
      update public.performance_targets set status='ACTIVE',updated_at=now()
        where id=object_uuid and workspace_id=request.workspace_id and status='PENDING_APPROVAL';
      if not found then raise exception 'performance_state_changed'; end if;
    elsif decision='REJECTED' and request.request_type='PERFORMANCE_ALLOCATION' then
      update public.performance_targets set status='DRAFT',updated_at=now()
        where id=object_uuid and workspace_id=request.workspace_id and status='PENDING_APPROVAL';
    elsif decision='APPROVED' and request.request_type in (
      'CONTRACT_EXPORT','PERFORMANCE_SUMMARY','MARKETING_CONTACT_EXPORT','CRM_EXPORT'
    ) then
      insert into public.generated_jobs(
        workspace_id,approval_request_id,job_type,parameters,created_by
      ) values(
        request.workspace_id,request.id,request.request_type,
        case when request.request_type='CRM_EXPORT' then request.request_payload
          else jsonb_build_object('objectType',request.business_object_type,'objectId',request.business_object_id) end,
        request.requester_id
      ) on conflict(approval_request_id) do nothing;
    end if;
    update public.approval_requests set execution_status='SUCCEEDED',
      executed_at=now(),execution_error=null where id=request.id returning * into request;
  exception when others then
    update public.approval_requests set execution_status='FAILED',
      executed_at=now(),execution_error=left(sqlerrm,500)
      where id=request.id returning * into request;
  end;
  return request;
end;
$$;

revoke all on function public.can_assign_crm_task(uuid),
  public.list_assignable_crm_users(text),
  public.create_crm_task(text,text,text,uuid,text,text,timestamptz,uuid),
  public.save_crm_record(text,uuid,timestamptz,jsonb),
  public.crm_record_history(text,uuid,integer),
  public.get_mutation_receipt(text,text),
  public.save_mutation_receipt(text,text,jsonb),
  public.idempotent_merge_duplicate_records(text,uuid,uuid,jsonb,text),
  public.idempotent_rollback_import_batch(uuid,text),
  public.idempotent_accept_quote(uuid,text),
  public.idempotent_set_product_active(uuid,boolean,text),
  public.save_shared_view(text,text,text,jsonb),
  public.delete_shared_view(uuid),
  public.crm_task_workspace(),
  public.bulk_complete_crm_tasks(uuid[],text),
  public.apply_account_recovery_throttle(text,text),
  public.create_crm_export_approval(text,text,text,text,text,text)
from public;
revoke all on function
  public.merge_duplicate_records(text,uuid,uuid,jsonb),
  public.rollback_import_batch(uuid),
  public.accept_quote(uuid)
from authenticated;
grant execute on function public.can_assign_crm_task(uuid),
  public.list_assignable_crm_users(text),
  public.create_crm_task(text,text,text,uuid,text,text,timestamptz,uuid),
  public.save_crm_record(text,uuid,timestamptz,jsonb),
  public.crm_record_history(text,uuid,integer),
  public.save_shared_view(text,text,text,jsonb),
  public.delete_shared_view(uuid),
  public.crm_task_workspace(),
  public.bulk_complete_crm_tasks(uuid[],text),
  public.create_crm_export_approval(text,text,text,text,text,text)
to authenticated;
grant execute on function
  public.idempotent_merge_duplicate_records(text,uuid,uuid,jsonb,text),
  public.idempotent_rollback_import_batch(uuid,text),
  public.idempotent_accept_quote(uuid,text),
  public.idempotent_set_product_active(uuid,boolean,text)
to authenticated;
grant execute on function public.apply_account_recovery_throttle(text,text) to service_role;
grant select,insert,update,delete on public.shared_views to authenticated;
grant select on public.recovery_throttle_buckets to service_role;
