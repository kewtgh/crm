-- Let administrators choose the external or self-hosted CAPTCHA path without weakening verification.
set search_path = public, app_auth, extensions;

alter table public.workspaces
  add column if not exists turnstile_enabled boolean not null default true;

comment on column public.workspaces.turnstile_enabled is
  'When false, public authentication uses the self-hosted ALTCHA verifier instead of Cloudflare Turnstile.';

create function public.set_workspace_turnstile_enabled(next_enabled boolean)
returns boolean
language plpgsql
security definer
set search_path = public, app_auth, extensions
as $$
declare
  ws uuid := public.current_workspace_id();
  previous_enabled boolean;
begin
  if ws is null
    or public.current_crm_role() not in ('SUPER_ADMIN', 'ADMIN')
    or coalesce(app_auth.current_claims()->>'aal', 'aal1') <> 'aal2'
  then
    raise exception 'workspace_turnstile_not_authorized';
  end if;

  if next_enabled is null then
    raise exception 'workspace_turnstile_invalid';
  end if;

  select turnstile_enabled
  into previous_enabled
  from public.workspaces
  where id = ws
  for update;

  if not found then
    raise exception 'workspace_not_found';
  end if;

  if previous_enabled <> next_enabled then
    update public.workspaces
    set turnstile_enabled = next_enabled
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
      'WORKSPACE_TURNSTILE_POLICY_CHANGED',
      jsonb_build_object('turnstileEnabled', previous_enabled),
      jsonb_build_object('turnstileEnabled', next_enabled)
    );
  end if;

  return next_enabled;
end;
$$;

revoke all on function public.set_workspace_turnstile_enabled(boolean) from public;
grant execute on function public.set_workspace_turnstile_enabled(boolean) to crm_app;
