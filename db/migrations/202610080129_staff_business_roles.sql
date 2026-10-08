set search_path=public,app_auth,extensions;
alter table public.workspace_memberships drop constraint if exists workspace_memberships_role_check;
alter table public.workspace_memberships add constraint workspace_memberships_role_check check(role in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER','SALES_SPECIALIST','SALES_SUPPORT','FINANCE_MANAGER','FINANCE_SPECIALIST','OPERATIONS_MANAGER','OPERATIONS_SPECIALIST','ACADEMIC_SPECIALIST','CUSTOMER_SUCCESS_SPECIALIST'));
alter table public.sales_team_members drop constraint if exists sales_team_members_role_check;
alter table public.sales_team_members add constraint sales_team_members_role_check check(role in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER','SALES_SPECIALIST','SALES_SUPPORT','FINANCE_MANAGER','FINANCE_SPECIALIST','OPERATIONS_MANAGER','OPERATIONS_SPECIALIST','ACADEMIC_SPECIALIST','CUSTOMER_SUCCESS_SPECIALIST'));

create or replace function public.change_staff_role(target_user uuid,new_role text,expected_role text,p_request_key text)
returns jsonb language plpgsql security definer set search_path=public,app_auth,extensions as $$
declare ws uuid:=public.current_workspace_id();actor uuid:=app_auth.current_user_id();actor_role text;target public.workspace_memberships;
 receipt public.mutation_receipts;fingerprint text;result jsonb;
begin
 if current_setting('app.aal',true) is distinct from 'aal2' then raise exception 'MFA_REQUIRED';end if;
 if actor is null or not public.is_workspace_member(ws) then raise exception 'ROLE_ASSIGNMENT_FORBIDDEN';end if;
 if new_role is null or new_role not in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER','SALES_SPECIALIST','SALES_SUPPORT','FINANCE_MANAGER','FINANCE_SPECIALIST','OPERATIONS_MANAGER','OPERATIONS_SPECIALIST','ACADEMIC_SPECIALIST','CUSTOMER_SUCCESS_SPECIALIST')
 or expected_role is null or length(coalesce(p_request_key,'')) not between 8 and 160 then raise exception 'INVALID_INPUT';end if;
 perform pg_advisory_xact_lock(hashtextextended(ws::text||':staff-identity',0));
 perform 1 from public.workspace_memberships where workspace_id=ws and user_id in(actor,target_user) order by user_id for update;
 select role into actor_role from public.workspace_memberships where workspace_id=ws and user_id=actor and status='ACTIVE';
 if actor_role is null or actor_role not in ('SUPER_ADMIN','ADMIN') then raise exception 'ROLE_ASSIGNMENT_FORBIDDEN';end if;
 fingerprint:=encode(digest(jsonb_build_array(target_user,new_role,expected_role)::text,'sha256'),'hex');
 select * into receipt from public.mutation_receipts where workspace_id=ws and request_key=p_request_key;
 if found then
  if receipt.created_by<>actor or receipt.operation<>'STAFF_ROLE_CHANGE' or receipt.result->>'request_hash'<>fingerprint then raise exception 'PAYLOAD_REUSE';end if;
  return receipt.result->'item';
 end if;
 select * into target from public.workspace_memberships where workspace_id=ws and user_id=target_user;
 if not found then raise exception 'STAFF_USER_NOT_FOUND';end if;
 if actor_role='ADMIN' and (target.role in ('ADMIN','SUPER_ADMIN') or new_role in ('ADMIN','SUPER_ADMIN')) then raise exception 'ROLE_ASSIGNMENT_FORBIDDEN';end if;
 if target.role<>expected_role then raise exception 'STALE_TARGET';end if;
 if target.role='SUPER_ADMIN' and new_role<>'SUPER_ADMIN' and target.status='ACTIVE' and not exists(select 1 from public.workspace_memberships where workspace_id=ws and user_id<>target_user and role='SUPER_ADMIN' and status='ACTIVE') then raise exception 'LAST_SUPER_ADMIN_PROTECTED';end if;
 if new_role like 'SALES\_%' escape '\' and not exists(select 1 from public.sales_team_members m join public.sales_team_memberships tm on tm.member_id=m.id and tm.workspace_id=ws and tm.status='ACTIVE' join public.sales_teams t on t.id=tm.team_id and t.workspace_id=ws and t.active where m.auth_user_id=target_user and m.workspace_id=ws) then raise exception 'TEAM_NOT_FOUND';end if;
 update public.workspace_memberships set role=new_role where workspace_id=ws and user_id=target_user;
 update public.sales_team_members set role=new_role where workspace_id=ws and auth_user_id=target_user;
 update app_auth.sessions set revoked_at=now(),revoked_reason='STAFF_ROLE_CHANGED' where user_id=target_user and revoked_at is null;
 result:=jsonb_build_object('id',target_user,'role',new_role,'previousRole',target.role);
 insert into public.audit_events(workspace_id,actor_id,entity_type,entity_id,action,before_data,after_data)
 values(ws,actor,'staff_user',target_user,'ROLE_CHANGE',jsonb_build_object('role',target.role),jsonb_build_object('role',new_role));
 insert into public.mutation_receipts(workspace_id,request_key,operation,result,created_by)
 values(ws,p_request_key,'STAFF_ROLE_CHANGE',jsonb_build_object('request_hash',fingerprint,'item',result),actor);
 return result;
end $$;
revoke all on function public.change_staff_role(uuid,text,text,text) from public,crm_system,crm_worker;
grant execute on function public.change_staff_role(uuid,text,text,text) to crm_app;


-- Bound new non-sales roles at the RLS layer as well as API capabilities.
-- Existing six roles retain their policies; no role is aliased to ADMIN/SALES.
create function public.staff_role_table_access(table_name text,edit boolean default false) returns boolean
language sql stable security definer set search_path=public,app_auth as $$
 select case
 when public.current_crm_role() in('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER','SALES_SPECIALIST','SALES_SUPPORT') then true
 when public.current_crm_role() not in('FINANCE_MANAGER','FINANCE_SPECIALIST','OPERATIONS_MANAGER','OPERATIONS_SPECIALIST','ACADEMIC_SPECIALIST','CUSTOMER_SUCCESS_SPECIALIST') then false
 when table_name in('user_preferences','crm_tasks','appointments','appointment_attendees','reminders','user_notifications') then true
 when not edit and table_name in('workspaces','workspace_memberships','user_profiles','sales_team_members','sales_teams','sales_team_memberships','organizations','contacts','products','product_prices','product_cohorts','crm_task_status_history','appointment_history') then true
 when public.current_crm_role() in('FINANCE_MANAGER','FINANCE_SPECIALIST') and not edit then table_name in('contracts','contract_versions','contract_lines','contract_enrollment_links','quotes','quote_versions','quote_items','payments','refunds','receivable_schedules','reconciliation_items','channel_agreements','channel_agreement_versions','commission_entries','commission_settlements','exchange_rate_snapshots')
 when public.current_crm_role() in('OPERATIONS_MANAGER','OPERATIONS_SPECIALIST','ACADEMIC_SPECIALIST','CUSTOMER_SUCCESS_SPECIALIST') then (not edit or public.current_crm_role()<>'CUSTOMER_SUCCESS_SPECIALIST') and table_name in('students','student_profiles','households','household_members','student_household_links','guardian_authorizations','student_enrollments','enrollment_status_history','student_applications','student_application_status_history','student_success_cases','student_success_goals','student_success_checkins','student_success_risk_signals','student_success_interventions','student_success_outcomes','student_pathways','student_academic_records','student_academic_facts','student_academic_fact_history','student_support_cases','workflow_templates','workflow_template_steps','student_admission_workflows','admission_workflow_steps','workflow_instances','workflow_step_instances','admission_milestones')
 else false end;
$$;
revoke all on function public.staff_role_table_access(text,boolean) from public;
grant execute on function public.staff_role_table_access(text,boolean) to crm_app;
do $$declare t record;begin
 for t in select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and c.relrowsecurity loop
  execute format('create policy staff_role_read_boundary on public.%I as restrictive for select to crm_app using(public.staff_role_table_access(%L,false))',t.relname,t.relname);
  execute format('create policy staff_role_insert_boundary on public.%I as restrictive for insert to crm_app with check(public.staff_role_table_access(%L,true))',t.relname,t.relname);
  execute format('create policy staff_role_update_boundary on public.%I as restrictive for update to crm_app using(public.staff_role_table_access(%L,true)) with check(public.staff_role_table_access(%L,true))',t.relname,t.relname,t.relname);
  execute format('create policy staff_role_delete_boundary on public.%I as restrictive for delete to crm_app using(public.current_crm_role() in (''SUPER_ADMIN'',''ADMIN'',''SALES_DIRECTOR'',''SALES_MANAGER'',''SALES_SPECIALIST'',''SALES_SUPPORT''))',t.relname);
 end loop;
end $$;
-- Financial read scope is explicit, workspace-scoped and never a Contact ACL
-- bypass. Custody source details and Revenue facts remain designation-governed.
do $$declare t text;begin
 foreach t in array array['contracts','contract_versions','contract_lines','contract_enrollment_links','quotes','quote_versions','quote_items','receivable_schedules','refunds','reconciliation_items','channel_agreements','channel_agreement_versions','commission_entries','commission_settlements','exchange_rate_snapshots'] loop
  if to_regclass('public.'||t) is not null then
   execute format('create policy finance_profile_read on public.%I for select to crm_app using(public.is_workspace_member(workspace_id) and public.current_crm_role() in (''FINANCE_MANAGER'',''FINANCE_SPECIALIST''))',t);
  end if;
 end loop;
end $$;
create policy finance_profile_trade_payment_read on public.payments for select to crm_app using(public.is_workspace_member(workspace_id) and purpose='TRADE_RECEIPT' and public.current_crm_role() in('FINANCE_MANAGER','FINANCE_SPECIALIST'));

-- Audited, finite education/parent-person entry points. Only the full employee
-- role guard changes; owner/share/hierarchy, archived-source checks and narrower
-- approval/manager guards are retained byte-for-byte. Customer Success is read-only.
-- Contact access still requires ownership, explicit share or the real hierarchy.
do $$declare f record;definition text;begin
 for f in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind='f' and p.proname in(
  'contact_actor_access','create_household_with_people','create_education_identity',
  'education_business_student_access','education_business_access',
  'student_enrollment_access','student_enrollment_save_internal',
  'student_application_access','save_student_application',
  'student_success_case_access','save_student_success_record',
  'save_student_success_operation','mutate_student_success_outcome'
 ) loop
  definition:=pg_get_functiondef(f.oid);
  definition:=replace(definition,'''SUPER_ADMIN'',''ADMIN'',''SALES_DIRECTOR'',''SALES_MANAGER'',''SALES_SPECIALIST'',''SALES_SUPPORT''','''SUPER_ADMIN'',''ADMIN'',''SALES_DIRECTOR'',''SALES_MANAGER'',''SALES_SPECIALIST'',''SALES_SUPPORT'',''OPERATIONS_MANAGER'',''OPERATIONS_SPECIALIST'',''ACADEMIC_SPECIALIST''');
  execute definition;
 end loop;
end $$;
-- Finance Manager can record ordinary trade settlement, with existing atomic
-- Payment/Receivable/Refund locks and ceilings. Custody still requires designation.
do $$declare definition text;begin
 definition:=pg_get_functiondef('public.record_payment_before_r5e(uuid,uuid,numeric,text,text,timestamptz)'::regprocedure);
 definition:=replace(definition,'''SUPER_ADMIN'',''ADMIN''','''SUPER_ADMIN'',''ADMIN'',''FINANCE_MANAGER''');
 definition:=replace(definition,'begin','begin if current_setting(''app.aal'',true) is distinct from ''aal2'' then raise exception ''MFA_REQUIRED'';end if;');
 execute definition;
end $$;

-- Template owner suggestions use the same access-role vocabulary; they do not grant permissions.
alter table public.workflow_template_steps drop constraint workflow_template_steps_default_owner_role_check;
alter table public.workflow_template_steps add constraint workflow_template_steps_default_owner_role_check check(default_owner_role in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER','SALES_SPECIALIST','SALES_SUPPORT','FINANCE_MANAGER','FINANCE_SPECIALIST','OPERATIONS_MANAGER','OPERATIONS_SPECIALIST','ACADEMIC_SPECIALIST','CUSTOMER_SUCCESS_SPECIALIST'));

-- New education profiles may use the customer writer only for education owners.
-- Their direct profile entry points must also validate the canonical source ACL.
do $$declare f record;definition text;begin
 for f in select p.oid,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in('save_customer_record','update_student_profile','update_household_profile') loop
  definition:=pg_get_functiondef(f.oid);
  definition:=replace(definition,'''SUPER_ADMIN'',''ADMIN'',''SALES_DIRECTOR'',''SALES_MANAGER'',''SALES_SPECIALIST'',''SALES_SUPPORT''','''SUPER_ADMIN'',''ADMIN'',''SALES_DIRECTOR'',''SALES_MANAGER'',''SALES_SPECIALIST'',''SALES_SUPPORT'',''OPERATIONS_MANAGER'',''OPERATIONS_SPECIALIST'',''ACADEMIC_SPECIALIST''');
  if f.proname='save_customer_record' then
   definition:=replace(definition,'begin','begin if public.current_crm_role() in (''OPERATIONS_MANAGER'',''OPERATIONS_SPECIALIST'',''ACADEMIC_SPECIALIST'') and resource not in (''STUDENTS'',''HOUSEHOLDS'') then raise exception ''PERMISSION_DENIED'';end if;');
  elsif f.proname='update_student_profile' then
   definition:=replace(definition,'begin','begin if public.current_crm_role() in (''OPERATIONS_MANAGER'',''OPERATIONS_SPECIALIST'',''ACADEMIC_SPECIALIST'') and not public.import_reference_access(''STUDENT'',target_student,true) then raise exception ''PERMISSION_DENIED'';end if;');
  else
   definition:=replace(definition,'begin','begin if public.current_crm_role() in (''OPERATIONS_MANAGER'',''OPERATIONS_SPECIALIST'',''ACADEMIC_SPECIALIST'') and not public.import_reference_access(''HOUSEHOLD'',target_household,true) then raise exception ''PERMISSION_DENIED'';end if;');
  end if;
  execute definition;
 end loop;
end $$;
-- Read-only analytics/template access includes Customer Success. Existing narrow
-- template-edit and per-record workflow guards remain unchanged.
do $$declare f record;definition text;begin
 for f in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in('student_success_analytics','workflow_template_access','workflow_instance_access') loop
  definition:=pg_get_functiondef(f.oid);
  definition:=replace(definition,'''SUPER_ADMIN'',''ADMIN'',''SALES_DIRECTOR'',''SALES_MANAGER'',''SALES_SPECIALIST'',''SALES_SUPPORT''','''SUPER_ADMIN'',''ADMIN'',''SALES_DIRECTOR'',''SALES_MANAGER'',''SALES_SPECIALIST'',''SALES_SUPPORT'',''OPERATIONS_MANAGER'',''OPERATIONS_SPECIALIST'',''ACADEMIC_SPECIALIST'',''CUSTOMER_SUCCESS_SPECIALIST''');
  execute definition;
 end loop;
end $$;
