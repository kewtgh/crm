-- Administrative reporting configuration is not a current business assignment.
-- Preserve immutable eligibility history through a disabled, de-identified stub;
-- current ownership, approved allocations and unknown references still block.
set search_path=public,app_auth,extensions;

do $$
declare definition text; needle text;
begin
 definition:=pg_get_functiondef('public.staff_lifecycle_eligibility(uuid)'::regprocedure);
 needle:='retain_audit_identity boolean:=false;';
 if strpos(definition,needle)=0 then raise exception 'STAFF_LIFECYCLE_DEFINITION_CHANGED';end if;
 definition:=replace(definition,needle,needle||' retain_reporting_identity boolean:=false;');
 needle:='elsif reference.table_name=''audit_events'' and reference.column_name=''entity_id'' then';
 if strpos(definition,needle)=0 then raise exception 'STAFF_LIFECYCLE_DEFINITION_CHANGED';end if;
 definition:=replace(definition,needle,
  'elsif reference.table_name=''staff_sales_eligibility_events'' and reference.column_name=''member_id'' then
   select exists(select 1 from public.staff_sales_eligibility_events where member_id=any(identities)) into retain_reporting_identity;
   present:=false;
  '||needle);
 needle:='case when retain_audit_identity then ''AUDIT_IDENTITY'' else ''NONE'' end';
 if strpos(definition,needle)=0 then raise exception 'STAFF_LIFECYCLE_DEFINITION_CHANGED';end if;
 definition:=replace(definition,needle,'case when retain_audit_identity or retain_reporting_identity then ''AUDIT_IDENTITY'' else ''NONE'' end,''retainedReportingIdentity'',retain_reporting_identity');
 execute definition;

 definition:=pg_get_functiondef('public.remove_unused_staff_account(uuid,text)'::regprocedure);
 needle:='delete from public.sales_team_members where auth_user_id=target_user;';
 if strpos(definition,needle)=0 then raise exception 'STAFF_REMOVAL_DEFINITION_CHANGED';end if;
 definition:=replace(definition,needle,
  'if coalesce((eligibility->>''retainedReportingIdentity'')::boolean,false) then
   update public.sales_team_members set active=false,name_zh=''已移除账户'',name_en=''Removed account'',team='''' where auth_user_id=target_user;
  else
   delete from public.sales_team_members where auth_user_id=target_user;
  end if;');
 execute definition;
end $$;

-- An identity retained solely for configuration history must not reappear as a
-- reporting participant. Actual allocations/contributions still prevent removal.
create or replace function public.staff_reporting_at(member uuid,business_date date) returns boolean
language sql stable security definer set search_path=public,app_auth as $$
 select not exists(select 1 from public.sales_team_members m join app_auth.accounts a on a.id=m.auth_user_id where m.id=member and a.purged_at is not null)
 and (exists(select 1 from public.staff_sales_period_scopes s where s.member_id=member and business_date between s.period_start and s.period_end)
 or coalesce((select e.eligible from public.staff_sales_eligibility_events e where e.member_id=member and e.effective_from<=business_date order by e.effective_from desc,e.created_at desc,e.id desc limit 1),false));
$$;
create or replace function public.staff_reporting_in_period(member uuid,period_from date,period_to date) returns boolean
language sql stable security definer set search_path=public,app_auth as $$
 select not exists(select 1 from public.sales_team_members m join app_auth.accounts a on a.id=m.auth_user_id where m.id=member and a.purged_at is not null)
 and (public.staff_reporting_current(member) or exists(select 1 from public.staff_sales_period_scopes s where s.member_id=member and s.period_start<period_to and s.period_end>=period_from)
 or exists(select 1 from (select e.*,lead(e.effective_from,1,date '9999-12-31') over(order by e.effective_from) until_date from (select distinct on(effective_from) * from public.staff_sales_eligibility_events where member_id=member order by effective_from,created_at desc,id desc) e) scope where scope.eligible and scope.effective_from<period_to and scope.until_date>period_from));
$$;

-- Retained member IDs cannot become new business owners or be reactivated.
-- Lock the account as well as the member to serialize against identity removal.
create function public.guard_removed_staff_member_reference() returns trigger
language plpgsql security definer set search_path=public,app_auth as $$
declare column_name text; linked uuid; linked_user uuid; removed_at timestamptz;
begin
 foreach column_name in array tg_argv loop
  if tg_op='UPDATE' and (to_jsonb(new)->column_name) is not distinct from (to_jsonb(old)->column_name) then continue;end if;
  linked:=(to_jsonb(new)->>column_name)::uuid;
  if linked is null then continue;end if;
  select auth_user_id into linked_user from public.sales_team_members where id=linked for key share;
  if linked_user is null then continue;end if;
  select purged_at into removed_at from app_auth.accounts where id=linked_user for key share;
  if removed_at is not null then raise exception 'STAFF_IDENTITY_REMOVED';end if;
 end loop;
 return new;
end $$;

do $$declare relation record; arguments text;begin
 for relation in
  select n.nspname,c.relname,array_agg(distinct a.attname order by a.attname) columns
  from pg_constraint fk join pg_class c on c.oid=fk.conrelid join pg_namespace n on n.oid=c.relnamespace
  join pg_attribute a on a.attrelid=c.oid and a.attnum=any(fk.conkey)
  where fk.contype='f' and fk.confrelid='public.sales_team_members'::regclass
   and n.nspname in('public','app_auth') group by n.nspname,c.relname loop
  select string_agg(quote_literal(name),',') into arguments from unnest(relation.columns) name;
  execute format('create trigger guard_removed_staff_member_reference before insert or update on %I.%I for each row execute function public.guard_removed_staff_member_reference(%s)',relation.nspname,relation.relname,arguments);
 end loop;
end $$;

create function public.guard_removed_staff_member_update() returns trigger
language plpgsql security definer set search_path=public,app_auth as $$
begin
 if exists(select 1 from app_auth.accounts where id=old.auth_user_id and purged_at is not null) then
  raise exception 'STAFF_IDENTITY_REMOVED';
 end if;
 return new;
end $$;
create trigger guard_removed_staff_member_update before update on public.sales_team_members
for each row execute function public.guard_removed_staff_member_update();
revoke all on function public.guard_removed_staff_member_reference(),public.guard_removed_staff_member_update() from public,crm_app,crm_system,crm_worker;
