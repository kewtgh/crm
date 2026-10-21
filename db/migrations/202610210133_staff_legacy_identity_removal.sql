-- Completed identity administration is not a current business assignment.
-- Keep its anonymous account reference; unresolved repair work still blocks.
set search_path=public,app_auth,extensions;

do $$
declare definition text; needle text;
begin
 definition:=pg_get_functiondef('public.staff_lifecycle_eligibility(uuid)'::regprocedure);
 needle:='select array_agg(id) into identities';
 if strpos(definition,needle)=0 then raise exception 'STAFF_LIFECYCLE_DEFINITION_CHANGED';end if;
 definition:=replace(definition,needle,$insert$
 perform 1 from public.staff_identity_changes where target_user_id=target_user order by id for update;
 perform 1 from public.staff_identity_repair_jobs where target_user_id=target_user order by id for update;
 if exists(select 1 from public.staff_identity_repair_jobs where target_user_id=target_user and status<>'COMPLETED')
 or exists(select 1 from public.staff_identity_changes c where c.target_user_id=target_user
  and c.state not in('SYNCED','ROLLED_BACK') and not(c.state='FAILED' and exists(
   select 1 from public.staff_identity_repair_jobs j where j.identity_change_id=c.id and j.status='COMPLETED')))
 then return jsonb_build_object('status','IDENTITY_REPAIR_REQUIRED');end if;
 retain_audit_identity:=exists(select 1 from public.staff_identity_changes where target_user_id=target_user)
  or exists(select 1 from public.staff_identity_repair_jobs where target_user_id=target_user);
 $insert$||needle);
 needle:='''STAFF_PROFILE_CHANGE'',''UPDATE''';
 if strpos(definition,needle)=0 then raise exception 'STAFF_LIFECYCLE_DEFINITION_CHANGED';end if;
 definition:=replace(definition,needle,needle||',''IDENTITY_CHANGE_PREPARED'',''IDENTITY_CHANGE_SYNCED'',''IDENTITY_CHANGE_ROLLED_BACK''');
 needle:='elsif reference.table_name=''staff_sales_eligibility_events''';
 if strpos(definition,needle)=0 then raise exception 'STAFF_LIFECYCLE_DEFINITION_CHANGED';end if;
 definition:=replace(definition,needle,$insert$
 elsif reference.schema_name='public' and reference.table_name in('staff_identity_changes','staff_identity_repair_jobs') and reference.column_name='target_user_id' then
  present:=false;
 $insert$||needle);
 -- Accumulate retention: an empty actor audit must not erase retained sync history.
 needle:='into retain_audit_identity;';
 if strpos(definition,needle)=0 then raise exception 'STAFF_LIFECYCLE_DEFINITION_CHANGED';end if;
 definition:=replace(definition,needle,'into present; retain_audit_identity:=retain_audit_identity or present;');
 needle:='if present then return jsonb_build_object(''status'',''BUSINESS_REFERENCES_EXIST'');end if;';
 if strpos(definition,needle)=0 then raise exception 'STAFF_LIFECYCLE_DEFINITION_CHANGED';end if;
 definition:=replace(definition,needle,$insert$
 if present then return jsonb_build_object('status','BUSINESS_REFERENCES_EXIST','blockingArea',case
  when reference.table_name in('organizations','contacts','opportunities','record_collaborators') then 'CUSTOMER_RECORDS'
  when reference.table_name in('performance_targets','performance_allocations','performance_contributions','staff_sales_period_scopes') then 'PERFORMANCE_RECORDS'
  when reference.table_name in('sales_teams','sales_team_members','sales_team_memberships') then 'TEAM_RESPONSIBILITIES'
  when reference.table_name in('staff_identity_changes','staff_identity_repair_jobs') then 'IDENTITY_CONFIGURATION'
  when reference.table_name='audit_events' then 'HISTORICAL_RECORDS'
  when reference.table_name='notification_outbox' then 'NOTIFICATION_RECORDS'
  else 'OTHER_REFERENCES' end);end if;
 $insert$);
 definition:=replace(definition,'jsonb_build_object(''status'',''BUSINESS_REFERENCES_EXIST'');end if;',
  'jsonb_build_object(''status'',''BUSINESS_REFERENCES_EXIST'',''blockingArea'',''HISTORICAL_RECORDS'');end if;');
 execute definition;

 definition:=pg_get_functiondef('public.remove_unused_staff_account(uuid,text)'::regprocedure);
 needle:='delete from public.sales_team_memberships where member_id';
 if strpos(definition,needle)=0 then raise exception 'STAFF_REMOVAL_DEFINITION_CHANGED';end if;
 definition:=replace(definition,needle,$insert$
 -- Historical role/status evidence remains, with personal snapshot fields removed.
 update public.staff_identity_changes set before_team=before_team-'name_zh'-'name_en'-'team',error_message=null where target_user_id=target_user;
 update public.staff_identity_repair_jobs set last_error=null where target_user_id=target_user;
 update public.audit_events set before_data=null,after_data=jsonb_build_object('status','IDENTITY_REMOVED')
 where (entity_type='staff_identity_changes' and entity_id in(select id::text from public.staff_identity_changes where target_user_id=target_user))
 or (entity_type in('staff_identity_repair_jobs','staff_identity_repair') and entity_id in(select id::text from public.staff_identity_repair_jobs where target_user_id=target_user));
 $insert$||needle);
 execute definition;
end $$;

-- Retained, completed operations cannot be retried to restore a removed account.
create function public.guard_removed_staff_identity_operation() returns trigger
language plpgsql security definer set search_path=public,app_auth as $$
begin
 perform 1 from app_auth.accounts where id=new.target_user_id for key share;
 if exists(select 1 from app_auth.accounts where id=new.target_user_id and purged_at is not null) then raise exception 'STAFF_IDENTITY_REMOVED';end if;
 return new;
end $$;
create trigger guard_removed_staff_identity_operation before insert or update on public.staff_identity_changes
 for each row execute function public.guard_removed_staff_identity_operation();
create trigger guard_removed_staff_identity_operation before insert or update on public.staff_identity_repair_jobs
 for each row execute function public.guard_removed_staff_identity_operation();
revoke all on function public.guard_removed_staff_identity_operation() from public,crm_app,crm_system,crm_worker;
