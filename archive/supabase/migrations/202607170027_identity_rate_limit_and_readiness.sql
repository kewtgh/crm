-- v0.9.0: durable login throttling, transactional staff membership changes,
-- identity-provider compensation records and production readiness telemetry.

-- ---------------------------------------------------------------------------
-- Durable login throttling
-- ---------------------------------------------------------------------------

create table if not exists public.login_throttle_buckets(
  bucket_key text primary key,
  window_started_at timestamptz not null default now(),
  attempts integer not null default 0 check(attempts>=0),
  blocked_until timestamptz,
  last_attempt_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check(bucket_key~'^(ACCOUNT|SOURCE):[a-f0-9]{64}$')
);
alter table public.login_throttle_buckets enable row level security;

create or replace function public.apply_login_throttle(
  account_hash text,source_hash text,throttle_action text
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  normalized_action text:=upper(trim(throttle_action));
  key_value text;
  threshold_value integer;
  bucket public.login_throttle_buckets;
  next_attempts integer;
  blocked_until_value timestamptz;
  maximum_block timestamptz;
begin
  if account_hash!~'^[a-f0-9]{64}$' or source_hash!~'^[a-f0-9]{64}$'
    or normalized_action not in ('CHECK','FAILURE','SUCCESS') then
    raise exception 'login_throttle_invalid';
  end if;

  if normalized_action='SUCCESS' then
    perform pg_advisory_xact_lock(hashtextextended('ACCOUNT:'||account_hash,0));
    perform pg_advisory_xact_lock(hashtextextended('SOURCE:'||source_hash,0));
    delete from public.login_throttle_buckets
      where bucket_key in ('ACCOUNT:'||account_hash,'SOURCE:'||source_hash);
    return jsonb_build_object('allowed',true,'retryAfterSeconds',0);
  end if;

  if normalized_action='FAILURE' then
    foreach key_value in array array['ACCOUNT:'||account_hash,'SOURCE:'||source_hash] loop
      perform pg_advisory_xact_lock(hashtextextended(key_value,0));
      threshold_value:=case when key_value like 'ACCOUNT:%' then 8 else 25 end;
      select * into bucket from public.login_throttle_buckets
        where bucket_key=key_value for update;
      if not found then
        next_attempts:=1;
        blocked_until_value:=null;
        insert into public.login_throttle_buckets(
          bucket_key,window_started_at,attempts,blocked_until,last_attempt_at,updated_at
        ) values(key_value,now(),next_attempts,blocked_until_value,now(),now());
      else
        if bucket.window_started_at<=now()-interval '15 minutes' then
          next_attempts:=1;
          blocked_until_value:=null;
          update public.login_throttle_buckets set
            window_started_at=now(),attempts=next_attempts,blocked_until=null,
            last_attempt_at=now(),updated_at=now()
          where bucket_key=key_value;
        else
          next_attempts:=bucket.attempts+1;
          blocked_until_value:=case
            when next_attempts>=threshold_value then greatest(
              coalesce(bucket.blocked_until,now()),now()+interval '15 minutes'
            )
          end;
          update public.login_throttle_buckets set
            attempts=next_attempts,blocked_until=blocked_until_value,
            last_attempt_at=now(),updated_at=now()
          where bucket_key=key_value;
        end if;
      end if;
    end loop;
  end if;

  select max(blocked_until) into maximum_block
  from public.login_throttle_buckets
  where bucket_key in ('ACCOUNT:'||account_hash,'SOURCE:'||source_hash)
    and blocked_until>now();
  return jsonb_build_object(
    'allowed',maximum_block is null,
    'retryAfterSeconds',case when maximum_block is null then 0
      else greatest(1,ceil(extract(epoch from maximum_block-now()))::integer) end
  );
end;
$$;

revoke all on function public.apply_login_throttle(text,text,text)
  from public,anon,authenticated;
grant execute on function public.apply_login_throttle(text,text,text) to service_role;

-- ---------------------------------------------------------------------------
-- Transactional membership changes with identity-provider compensation
-- ---------------------------------------------------------------------------

create table if not exists public.staff_identity_changes(
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  target_user_id uuid not null references auth.users(id) on delete cascade,
  actor_user_id uuid not null references auth.users(id),
  before_role text not null,
  before_status text not null,
  after_role text not null,
  after_status text not null,
  before_team jsonb,
  state text not null default 'PENDING'
    check(state in ('PENDING','SYNCED','ROLLED_BACK','FAILED')),
  error_message text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists staff_identity_changes_target_idx
  on public.staff_identity_changes(target_user_id,created_at desc);
alter table public.staff_identity_changes enable row level security;
create policy "administrators read identity changes"
  on public.staff_identity_changes for select to authenticated
  using(public.is_workspace_member(workspace_id)
    and public.current_crm_role() in ('SUPER_ADMIN','ADMIN'));

-- Membership/team mutations are not browser-writable. They are prepared in one
-- database transaction and then synchronized to Supabase Auth by the server.
drop policy if exists "admins manage memberships" on public.workspace_memberships;
drop policy if exists "leaders insert sales members" on public.sales_team_members;
drop policy if exists "leaders update sales members" on public.sales_team_members;
drop policy if exists "admins delete sales members" on public.sales_team_members;
revoke insert,update,delete on public.workspace_memberships,public.sales_team_members from authenticated;

create or replace function public.prepare_staff_identity_change(
  target_user uuid,new_role text,new_status text,actor_user uuid
)
returns public.staff_identity_changes
language plpgsql
security definer
set search_path=public
as $$
declare
  actor_membership public.workspace_memberships;
  target_membership public.workspace_memberships;
  team_row public.sales_team_members;
  profile public.user_profiles;
  change_row public.staff_identity_changes;
  normalized_role text:=upper(new_role);
  normalized_status text:=upper(new_status);
begin
  if normalized_role not in ('ADMIN','SALES_DIRECTOR','SALES_MANAGER','SALES_SPECIALIST','SALES_SUPPORT')
    or normalized_status not in ('ACTIVE','SUSPENDED') then
    raise exception 'staff_identity_change_invalid';
  end if;
  select * into actor_membership from public.workspace_memberships
    where user_id=actor_user and status='ACTIVE' order by created_at limit 1;
  if not found or actor_membership.role not in ('SUPER_ADMIN','ADMIN') then
    raise exception 'staff_identity_change_not_authorized';
  end if;
  select * into target_membership from public.workspace_memberships
    where user_id=target_user and workspace_id=actor_membership.workspace_id for update;
  if not found then raise exception 'staff_user_not_found'; end if;
  if target_membership.role='SUPER_ADMIN' then raise exception 'super_admin_protected'; end if;
  if target_user=actor_user and normalized_status='SUSPENDED' then
    raise exception 'self_suspend_forbidden';
  end if;
  if actor_membership.role='ADMIN'
    and (target_membership.role='ADMIN' or normalized_role='ADMIN') then
    raise exception 'staff_identity_change_not_authorized';
  end if;

  select * into team_row from public.sales_team_members
    where workspace_id=target_membership.workspace_id and auth_user_id=target_user for update;
  insert into public.staff_identity_changes(
    workspace_id,target_user_id,actor_user_id,before_role,before_status,
    after_role,after_status,before_team
  ) values(
    target_membership.workspace_id,target_user,actor_user,target_membership.role,
    target_membership.status,normalized_role,normalized_status,
    case when team_row.id is null then null else to_jsonb(team_row) end
  ) returning * into change_row;

  update public.workspace_memberships set role=normalized_role,status=normalized_status
    where workspace_id=target_membership.workspace_id and user_id=target_user;

  if normalized_role like 'SALES_%' then
    if team_row.id is null then
      select * into profile from public.user_profiles where user_id=target_user;
      insert into public.sales_team_members(
        workspace_id,auth_user_id,name_zh,name_en,role,team,active
      ) values(
        target_membership.workspace_id,target_user,
        coalesce(profile.display_name_zh,''),coalesce(profile.display_name_en,'CRM User'),
        normalized_role,'Unassigned',normalized_status='ACTIVE'
      );
    else
      update public.sales_team_members set
        role=normalized_role,active=normalized_status='ACTIVE'
      where id=team_row.id;
    end if;
  elsif team_row.id is not null then
    update public.sales_team_members set active=false where id=team_row.id;
  end if;

  insert into public.audit_events(
    workspace_id,actor_id,entity_type,entity_id,action,before_data,after_data,request_id
  ) values(
    target_membership.workspace_id,actor_user,'staff_user',target_user::text,
    'IDENTITY_CHANGE_PREPARED',
    jsonb_build_object('role',target_membership.role,'status',target_membership.status),
    jsonb_build_object('role',normalized_role,'status',normalized_status),
    change_row.id::text
  );
  return change_row;
end;
$$;

create or replace function public.complete_staff_identity_change(change_id uuid)
returns public.staff_identity_changes
language plpgsql
security definer
set search_path=public
as $$
declare result public.staff_identity_changes;
begin
  update public.staff_identity_changes
    set state='SYNCED',completed_at=now(),error_message=null
    where id=change_id and state='PENDING' returning * into result;
  if not found then raise exception 'staff_identity_change_not_pending'; end if;
  insert into public.audit_events(
    workspace_id,actor_id,entity_type,entity_id,action,after_data,request_id
  ) values(
    result.workspace_id,result.actor_user_id,'staff_user',result.target_user_id::text,
    'IDENTITY_CHANGE_SYNCED',
    jsonb_build_object('role',result.after_role,'status',result.after_status),
    result.id::text
  );
  return result;
end;
$$;

create or replace function public.rollback_staff_identity_change(change_id uuid,failure text)
returns public.staff_identity_changes
language plpgsql
security definer
set search_path=public
as $$
declare result public.staff_identity_changes;team_id uuid;
begin
  select * into result from public.staff_identity_changes
    where id=change_id and state='PENDING' for update;
  if not found then raise exception 'staff_identity_change_not_pending'; end if;

  update public.workspace_memberships set role=result.before_role,status=result.before_status
    where workspace_id=result.workspace_id and user_id=result.target_user_id;

  if result.before_team is null then
    delete from public.sales_team_members
      where workspace_id=result.workspace_id and auth_user_id=result.target_user_id;
  else
    team_id:=(result.before_team->>'id')::uuid;
    update public.sales_team_members set
      role=result.before_team->>'role',
      team=result.before_team->>'team',
      active=(result.before_team->>'active')::boolean,
      manager_member_id=nullif(result.before_team->>'manager_member_id','')::uuid,
      name_zh=result.before_team->>'name_zh',
      name_en=result.before_team->>'name_en'
    where id=team_id;
    if not found then
      insert into public.sales_team_members(
        id,workspace_id,auth_user_id,name_zh,name_en,role,team,active,manager_member_id,created_at
      ) values(
        team_id,result.workspace_id,result.target_user_id,
        result.before_team->>'name_zh',result.before_team->>'name_en',
        result.before_team->>'role',result.before_team->>'team',
        (result.before_team->>'active')::boolean,
        nullif(result.before_team->>'manager_member_id','')::uuid,
        coalesce((result.before_team->>'created_at')::timestamptz,now())
      );
    end if;
  end if;

  update public.staff_identity_changes set
    state=case when coalesce(failure,'') like 'AUTH_COMPENSATION_FAILED:%'
      then 'FAILED' else 'ROLLED_BACK' end,
    error_message=left(coalesce(failure,'IDENTITY_SYNC_FAILED'),500),
    completed_at=now()
  where id=result.id returning * into result;
  insert into public.audit_events(
    workspace_id,actor_id,entity_type,entity_id,action,after_data,request_id
  ) values(
    result.workspace_id,result.actor_user_id,'staff_user',result.target_user_id::text,
    'IDENTITY_CHANGE_ROLLED_BACK',
    jsonb_build_object('error',result.error_message),result.id::text
  );
  return result;
end;
$$;

grant select on public.staff_identity_changes to authenticated;
revoke all on function public.prepare_staff_identity_change(uuid,text,text,uuid),
  public.complete_staff_identity_change(uuid),
  public.rollback_staff_identity_change(uuid,text)
  from public,anon,authenticated;
grant execute on function public.prepare_staff_identity_change(uuid,text,text,uuid),
  public.complete_staff_identity_change(uuid),
  public.rollback_staff_identity_change(uuid,text)
  to service_role;

-- ---------------------------------------------------------------------------
-- Production readiness snapshot
-- ---------------------------------------------------------------------------

create or replace function public.service_readiness_snapshot(
  target_workspace uuid default '00000000-0000-4000-8000-000000000001'
)
returns jsonb
language plpgsql
stable
security definer
set search_path=public
as $$
declare stale_workers integer;registered_workers integer;missing_workers integer;failed_jobs integer;oldest_pending timestamptz;
begin
  if not exists(select 1 from public.workspaces where id=target_workspace) then
    raise exception 'workspace_not_found';
  end if;
  select count(*) into stale_workers from public.worker_heartbeats
    where last_seen_at<now()-interval '15 minutes' or consecutive_failures>0;
  select count(*) into registered_workers from public.worker_heartbeats;
  missing_workers:=greatest(0,5-registered_workers);
  stale_workers:=stale_workers+missing_workers;
  select
    (select count(*) from public.notification_outbox
      where workspace_id=target_workspace and status in ('FAILED','DEAD'))
    +(select count(*) from public.calendar_deliveries
      where workspace_id=target_workspace and status='FAILED')
    +(select count(*) from public.generated_jobs
      where workspace_id=target_workspace and status='FAILED')
  into failed_jobs;
  select min(value) into oldest_pending from (
    select min(created_at) value from public.notification_outbox
      where workspace_id=target_workspace and status in ('PENDING','SENDING','FAILED')
    union all
    select min(created_at) from public.calendar_deliveries
      where workspace_id=target_workspace and status in ('QUEUED','SENDING','FAILED')
    union all
    select min(created_at) from public.generated_jobs
      where workspace_id=target_workspace and status in ('QUEUED','PROCESSING','FAILED')
  ) pending;
  return jsonb_build_object(
    'database',true,
    'workspaceId',target_workspace,
    'staleWorkers',stale_workers,
    'registeredWorkers',registered_workers,
    'missingWorkers',missing_workers,
    'failedJobs',failed_jobs,
    'oldestPendingAt',oldest_pending,
    'ready',stale_workers=0 and failed_jobs=0,
    'checkedAt',now()
  );
end;
$$;

revoke all on function public.service_readiness_snapshot(uuid)
  from public,anon,authenticated;
grant execute on function public.service_readiness_snapshot(uuid) to service_role;

-- Generic audit trigger for the identity change records. Login buckets are
-- intentionally excluded to avoid filling the business audit trail.
drop trigger if exists audit_staff_identity_changes on public.staff_identity_changes;
create trigger audit_staff_identity_changes
after insert or update or delete on public.staff_identity_changes
for each row execute procedure public.audit_row_change();

-- Remove the hidden notification category from the retired product scope.
alter table public.user_preferences alter column notifications set default
  '{"tasks":{"email":true,"inApp":true},"relationship":{"email":true,"inApp":true},"sales":{"email":false,"inApp":true},"security":{"email":true,"inApp":true}}'::jsonb;
update public.user_preferences
set notifications=notifications-'ai',updated_at=now()
where notifications ? 'ai';
