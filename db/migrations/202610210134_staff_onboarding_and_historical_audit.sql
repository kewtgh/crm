set search_path=public,app_auth,extensions;

-- A historical audit describes the past; live ownership and financial foreign
-- keys, rather than an audit action allowlist, determine removal eligibility.
do $$declare definition text; line text;begin
 definition:=pg_get_functiondef('public.staff_lifecycle_eligibility(uuid)'::regprocedure);
 select value into strict line from unnest(string_to_array(definition,E'\n')) value
 where strpos(value,'if exists(select 1 from public.audit_events where entity_id::text=any(')>0;
 definition:=replace(definition,line,$replacement$
 retain_audit_identity:=retain_audit_identity or exists(select 1 from public.audit_events where entity_id::text=any(array(select x::text from unnest(identities) x)) and entity_type not in('staff_user','user_preferences'));
 -- Keep a disabled member stub when history points at the member UUID itself.
 retain_reporting_identity:=exists(select 1 from public.audit_events where entity_id::text in(select id::text from public.sales_team_members where auth_user_id=target_user));
 $replacement$);
 select value into strict line from unnest(string_to_array(definition,E'\n')) value
 where strpos(value,'select exists(select 1 from public.audit_events where entity_id=any(identities)')>0;
 definition:=replace(definition,line,'   present:=false;');
 -- A later catalog branch must accumulate, not erase, member-history retention.
 definition:=replace(definition,'into retain_reporting_identity;',
  'into present; retain_reporting_identity:=retain_reporting_identity or present;');
 execute definition;
end $$;

create function public.staff_onboarding_complete(member uuid) returns boolean
language sql stable security definer set search_path=public,app_auth as $$
 select exists(select 1 from public.sales_team_members m
 join app_auth.accounts a on a.id=m.auth_user_id
 join public.workspace_memberships w on w.user_id=a.id and w.workspace_id=m.workspace_id
 where m.id=member and a.last_sign_in_at is not null and a.purged_at is null and not w.must_change_password);
$$;
revoke all on function public.staff_onboarding_complete(uuid) from public;
grant execute on function public.staff_onboarding_complete(uuid) to crm_app,crm_system,crm_worker;

do $$declare definition text; name text;needle text;begin
 foreach name in array array['staff_reporting_current(uuid,date)','staff_reporting_at(uuid,date)','staff_reporting_in_period(uuid,date,date)'] loop
  definition:=pg_get_functiondef(('public.'||name)::regprocedure);
  needle:=case when name like 'staff_reporting_current%' then 'select coalesce(' else 'select not exists(' end;
  if strpos(definition,needle)=0 then raise exception 'STAFF_REPORTING_DEFINITION_CHANGED';end if;
  definition:=replace(definition,needle,replace(needle,'select ','select public.staff_onboarding_complete(member) and '));
  execute definition;
 end loop;
 definition:=pg_get_functiondef('public.save_performance_plan(uuid,uuid,date,date,text,numeric,jsonb)'::regprocedure);
 needle:='if period_to<period_from';
 if strpos(definition,needle)=0 then raise exception 'PERFORMANCE_PLAN_DEFINITION_CHANGED';end if;
 definition:=replace(definition,needle,$replacement$
 if not exists(select 1 from app_auth.accounts a join public.workspace_memberships w on w.user_id=a.id
 where a.id=manager and w.workspace_id=public.current_workspace_id() and a.status='ACTIVE' and w.status='ACTIVE'
 and a.last_sign_in_at is not null and a.purged_at is null and not w.must_change_password) then raise exception 'STAFF_ONBOARDING_REQUIRED';end if;
 $replacement$||needle);
 execute definition;
end $$;
