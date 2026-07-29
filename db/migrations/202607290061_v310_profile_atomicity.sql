create or replace function public.update_own_profile(
  target_display_name_zh text,
  target_display_name_en text,
  target_honorific text,
  target_bio text
)
returns boolean
language plpgsql
security invoker
set search_path = pg_catalog, public, app_auth
as $$
declare
  actor uuid := app_auth.current_user_id();
  workspace uuid := public.current_workspace_id();
begin
  if actor is null then
    raise exception 'authentication_required';
  end if;

  update public.user_profiles
  set display_name_zh = target_display_name_zh,
      display_name_en = target_display_name_en,
      updated_at = now()
  where user_id = actor;
  if not found then
    raise exception 'profile_not_found';
  end if;

  update public.user_preferences
  set honorific = target_honorific,
      bio = target_bio,
      updated_at = now()
  where user_id = actor
    and workspace_id = workspace;
  if not found then
    raise exception 'preferences_not_found';
  end if;

  return true;
end;
$$;

revoke all on function public.update_own_profile(text,text,text,text)
  from public, crm_system, crm_worker;
grant update (updated_at) on table public.user_profiles to crm_app;
grant execute on function public.update_own_profile(text,text,text,text) to crm_app;
