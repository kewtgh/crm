-- Make the organization business date explicit and independent of host/server timezones.
set search_path = public, app_auth, extensions;

alter table public.workspaces
  add column if not exists business_timezone text not null default 'Asia/Taipei';

alter table public.workspaces
  drop constraint if exists workspaces_business_timezone_check;

alter table public.workspaces
  add constraint workspaces_business_timezone_check
  check (business_timezone in (
    'Asia/Taipei',
    'Asia/Shanghai',
    'Asia/Singapore',
    'Europe/London',
    'America/New_York'
  ));

comment on column public.workspaces.business_timezone is
  'Organization-wide timezone for date-only business rules; distinct from each user display timezone.';

create or replace function public.current_business_date()
returns date
language sql
stable
set search_path = public, app_auth
as $$
  select current_date;
$$;

create or replace function public.set_workspace_business_timezone(next_timezone text)
returns text
language plpgsql
security definer
set search_path = public, app_auth, extensions
as $$
declare
  ws uuid := public.current_workspace_id();
  previous_timezone text;
begin
  if ws is null
    or public.current_crm_role() not in ('SUPER_ADMIN', 'ADMIN')
    or coalesce(app_auth.current_claims()->>'aal', 'aal1') <> 'aal2'
  then
    raise exception 'workspace_timezone_not_authorized';
  end if;

  if next_timezone is null or next_timezone not in (
    'Asia/Taipei',
    'Asia/Shanghai',
    'Asia/Singapore',
    'Europe/London',
    'America/New_York'
  ) then
    raise exception 'workspace_timezone_invalid';
  end if;

  select business_timezone
  into previous_timezone
  from public.workspaces
  where id = ws
  for update;

  if not found then
    raise exception 'workspace_not_found';
  end if;

  if previous_timezone <> next_timezone then
    update public.workspaces
    set business_timezone = next_timezone
    where id = ws;

    insert into public.audit_events(
      workspace_id,
      actor_id,
      entity_type,
      entity_id,
      action,
      before_data,
      after_data
    )
    values (
      ws,
      app_auth.current_user_id(),
      'workspace',
      ws,
      'WORKSPACE_BUSINESS_TIMEZONE_CHANGED',
      jsonb_build_object('businessTimezone', previous_timezone),
      jsonb_build_object('businessTimezone', next_timezone)
    );
  end if;

  return next_timezone;
end;
$$;

revoke all on function public.current_business_date() from public;
revoke all on function public.set_workspace_business_timezone(text) from public;
grant execute on function public.current_business_date() to crm_app;
grant execute on function public.set_workspace_business_timezone(text) to crm_app;
