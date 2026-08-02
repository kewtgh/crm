set search_path = public, app_auth, extensions;

create table if not exists public.staff_invitation_deliveries (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references app_auth.accounts(id) on delete cascade,
  requested_by uuid not null references app_auth.accounts(id),
  request_key text not null check(length(request_key) between 8 and 160),
  outbox_id uuid unique,
  status text not null check(status in ('QUEUED','SENT','FAILED','UNCERTAIN')),
  failure_code text,
  provider_http_status integer check(provider_http_status between 100 and 599),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz,
  unique(requested_by,user_id,request_key)
);
create index if not exists staff_invitation_deliveries_user_idx
  on public.staff_invitation_deliveries(workspace_id,user_id,created_at desc);

alter table public.staff_invitation_deliveries enable row level security;
drop policy if exists "admins read staff invitation deliveries" on public.staff_invitation_deliveries;
create policy "admins read staff invitation deliveries"
  on public.staff_invitation_deliveries for select to crm_app
  using(public.is_workspace_member(workspace_id) and public.crm_role() in ('SUPER_ADMIN','ADMIN'));
grant select on public.staff_invitation_deliveries to crm_app;
grant select,insert,update on public.staff_invitation_deliveries to crm_system;
grant insert on public.notification_outbox to crm_system;

create or replace function public.record_staff_invitation_delivery(
  delivery_id uuid, delivery_status text, failure text default null, http_status integer default null
)
returns void language plpgsql security definer set search_path=public,app_auth,extensions
as $$
begin
  if delivery_status not in ('SENT','FAILED','UNCERTAIN') then
    raise exception 'staff_invitation_delivery_status_invalid';
  end if;
  update public.staff_invitation_deliveries set
    status=delivery_status,
    failure_code=case when delivery_status='SENT' then null else left(coalesce(failure,'DELIVERY_FAILED'),80) end,
    provider_http_status=http_status,
    sent_at=case when delivery_status='SENT' then now() else sent_at end,
    updated_at=now()
  where id=delivery_id;
  if not found then raise exception 'staff_invitation_delivery_not_found'; end if;
end;
$$;
revoke all on function public.record_staff_invitation_delivery(uuid,text,text,integer) from public,crm_app,crm_system;
grant execute on function public.record_staff_invitation_delivery(uuid,text,text,integer) to crm_worker;
