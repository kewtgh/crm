-- Lumina CRM v2.1 identity closure:
-- administrator-only mandatory MFA, optional MFA for all other staff, and
-- server-verified trusted devices for the email-OTP fallback.

create or replace function public.current_crm_role()
returns text language sql stable security definer set search_path=public
as $$
  select coalesce((
    select upper(role) from public.workspace_memberships
    where user_id=auth.uid() and status='ACTIVE'
      and (
        upper(role) not in ('SUPER_ADMIN','ADMIN')
        or coalesce(auth.jwt()->>'aal','aal1')='aal2'
      )
    order by created_at limit 1
  ),'');
$$;

create or replace function public.is_workspace_member(target_workspace uuid)
returns boolean language sql stable security definer set search_path=public
as $$
  select exists(
    select 1 from public.workspace_memberships
    where workspace_id=target_workspace and user_id=auth.uid() and status='ACTIVE'
      and (
        upper(role) not in ('SUPER_ADMIN','ADMIN')
        or coalesce(auth.jwt()->>'aal','aal1')='aal2'
      )
  );
$$;

create or replace function public.current_workspace_id()
returns uuid language sql stable security definer set search_path=public
as $$
  select workspace_id from public.workspace_memberships
  where user_id=auth.uid() and status='ACTIVE'
    and (
      upper(role) not in ('SUPER_ADMIN','ADMIN')
      or coalesce(auth.jwt()->>'aal','aal1')='aal2'
    )
  order by created_at limit 1;
$$;

create table if not exists public.trusted_login_devices (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  token_hash text not null unique check(token_hash ~ '^[0-9a-f]{64}$'),
  device_label text not null check(char_length(device_label) between 1 and 160),
  created_at timestamptz not null default now(),
  last_used_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  check(expires_at > created_at)
);

create index if not exists trusted_login_devices_user_active_idx
  on public.trusted_login_devices(user_id,expires_at desc)
  where revoked_at is null;

alter table public.trusted_login_devices enable row level security;
revoke all on public.trusted_login_devices from public,anon,authenticated;
grant select,insert,update,delete on public.trusted_login_devices to service_role;

create or replace function public.service_register_trusted_login_device(
  target_device uuid,
  target_user uuid,
  target_token_hash text,
  target_device_label text,
  target_expires_at timestamptz
)
returns uuid language plpgsql security definer set search_path=public
as $$
declare ws uuid; result uuid;
begin
  select workspace_id into ws from public.workspace_memberships
  where user_id=target_user and status='ACTIVE'
  order by created_at limit 1;
  if ws is null
    or target_token_hash !~ '^[0-9a-f]{64}$'
    or nullif(trim(target_device_label),'') is null
    or target_expires_at<=now()
    or target_expires_at>now()+interval '90 days' then
    raise exception 'trusted_device_invalid';
  end if;
  insert into public.trusted_login_devices(
    id,workspace_id,user_id,token_hash,device_label,expires_at
  ) values(
    target_device,ws,target_user,target_token_hash,left(trim(target_device_label),160),target_expires_at
  ) returning id into result;
  insert into public.audit_events(
    workspace_id,actor_id,entity_type,entity_id,action,after_data
  ) values(
    ws,target_user,'trusted_login_device',result::text,'TRUSTED_DEVICE_REGISTERED',
    jsonb_build_object('deviceLabel',left(trim(target_device_label),160),'expiresAt',target_expires_at)
  );
  return result;
end;
$$;

create or replace function public.service_consume_trusted_login_device(
  target_device uuid,
  target_user uuid,
  target_token_hash text
)
returns boolean language plpgsql security definer set search_path=public
as $$
declare accepted boolean:=false;
begin
  update public.trusted_login_devices
  set last_used_at=now()
  where id=target_device and user_id=target_user and token_hash=target_token_hash
    and revoked_at is null and expires_at>now()
  returning true into accepted;
  update public.trusted_login_devices
  set revoked_at=coalesce(revoked_at,now())
  where user_id=target_user and revoked_at is null and expires_at<=now();
  return coalesce(accepted,false);
end;
$$;

create or replace function public.service_revoke_user_trusted_login_devices(
  target_user uuid,
  revoke_reason text default 'SECURITY_CHANGE'
)
returns integer language plpgsql security definer set search_path=public
as $$
declare affected integer; ws uuid;
begin
  update public.trusted_login_devices set revoked_at=now()
  where user_id=target_user and revoked_at is null;
  get diagnostics affected=row_count;
  if affected>0 then
    select workspace_id into ws from public.workspace_memberships
    where user_id=target_user order by created_at limit 1;
    insert into public.audit_events(
      workspace_id,actor_id,entity_type,entity_id,action,after_data
    ) values(
      ws,target_user,'trusted_login_device',target_user::text,'TRUSTED_DEVICES_REVOKED',
      jsonb_build_object('count',affected,'reason',left(coalesce(nullif(trim(revoke_reason),''),'SECURITY_CHANGE'),80))
    );
  end if;
  return affected;
end;
$$;

create or replace function public.list_current_user_trusted_login_devices()
returns table(
  id uuid,
  device_label text,
  created_at timestamptz,
  last_used_at timestamptz,
  expires_at timestamptz
) language sql stable security definer set search_path=public
as $$
  select device.id,device.device_label,device.created_at,device.last_used_at,device.expires_at
  from public.trusted_login_devices device
  where device.user_id=auth.uid() and device.revoked_at is null and device.expires_at>now()
  order by device.last_used_at desc,device.created_at desc;
$$;

create or replace function public.revoke_current_user_trusted_login_device(target_device uuid)
returns boolean language plpgsql security definer set search_path=public
as $$
declare changed boolean:=false; ws uuid:=public.current_workspace_id();
begin
  update public.trusted_login_devices set revoked_at=now()
  where id=target_device and user_id=auth.uid() and revoked_at is null
  returning true into changed;
  if coalesce(changed,false) then
    insert into public.audit_events(
      workspace_id,actor_id,entity_type,entity_id,action
    ) values(ws,auth.uid(),'trusted_login_device',target_device::text,'TRUSTED_DEVICE_REVOKED');
  end if;
  return coalesce(changed,false);
end;
$$;

create or replace function public.revoke_other_current_user_trusted_login_devices(keep_device uuid)
returns integer language plpgsql security definer set search_path=public
as $$
declare affected integer; ws uuid:=public.current_workspace_id();
begin
  update public.trusted_login_devices set revoked_at=now()
  where user_id=auth.uid() and revoked_at is null
    and (keep_device is null or id<>keep_device);
  get diagnostics affected=row_count;
  if affected>0 then
    insert into public.audit_events(
      workspace_id,actor_id,entity_type,entity_id,action,after_data
    ) values(
      ws,auth.uid(),'trusted_login_device',auth.uid()::text,'OTHER_TRUSTED_DEVICES_REVOKED',
      jsonb_build_object('count',affected)
    );
  end if;
  return affected;
end;
$$;

revoke all on function public.service_register_trusted_login_device(uuid,uuid,text,text,timestamptz),
  public.service_consume_trusted_login_device(uuid,uuid,text),
  public.service_revoke_user_trusted_login_devices(uuid,text),
  public.list_current_user_trusted_login_devices(),
  public.revoke_current_user_trusted_login_device(uuid),
  public.revoke_other_current_user_trusted_login_devices(uuid)
from public,anon;

grant execute on function public.service_register_trusted_login_device(uuid,uuid,text,text,timestamptz),
  public.service_consume_trusted_login_device(uuid,uuid,text),
  public.service_revoke_user_trusted_login_devices(uuid,text)
to service_role;

grant execute on function public.list_current_user_trusted_login_devices(),
  public.revoke_current_user_trusted_login_device(uuid),
  public.revoke_other_current_user_trusted_login_devices(uuid)
to authenticated;

create or replace function public.admin_dashboard_metrics()
returns jsonb
language plpgsql stable security definer set search_path=public,auth
as $$
declare ws uuid:=public.current_workspace_id(); result jsonb;
begin
  if public.current_crm_role() not in ('SUPER_ADMIN','ADMIN') then
    raise exception 'admin_required' using errcode='42501';
  end if;
  select jsonb_build_object(
    'staff_total',count(*),
    'active_staff',count(*) filter(where m.status='ACTIVE'),
    'privileged_total',count(*) filter(where m.role in ('SUPER_ADMIN','ADMIN')),
    'privileged_mfa',count(*) filter(where m.role in ('SUPER_ADMIN','ADMIN') and exists(
      select 1 from auth.mfa_factors f where f.user_id=m.user_id and f.status='verified'
    )),
    'mfa_missing',count(*) filter(where m.role in ('SUPER_ADMIN','ADMIN') and not exists(
      select 1 from auth.mfa_factors f where f.user_id=m.user_id and f.status='verified'
    )),
    'pending_approvals',(select count(*) from public.approval_requests a where a.workspace_id=ws and a.status='PENDING'),
    'failed_jobs',(select count(*) from public.generated_jobs j where j.workspace_id=ws and j.status='FAILED'),
    'unread_notifications',(select count(*) from public.user_notifications n where n.workspace_id=ws and n.user_id=auth.uid() and n.read_at is null)
  ) into result
  from public.workspace_memberships m where m.workspace_id=ws;
  return result;
end;
$$;
