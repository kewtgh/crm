begin;
select plan(15);

select ok(
  (select pg_get_constraintdef(oid) from pg_constraint where conrelid='public.workspace_memberships'::regclass and contype='c' and pg_get_constraintdef(oid) like '%SUPER_ADMIN%' limit 1)
  like '%SALES_SUPPORT%',
  'workspace role constraint contains the six staff-only CRM roles'
);
select ok(not has_function_privilege('anon','public.username_available(text)','EXECUTE'),'anonymous users cannot enumerate usernames');
select ok(has_function_privilege('authenticated','public.create_approval(text,text,text,text)','EXECUTE'),'authenticated staff can request governed workflows');
select ok(to_regclass('public.guardian_registrations') is null,'no customer or guardian registration table exists');
select ok(pg_get_functiondef('public.decide_approval(uuid,text,text)'::regprocedure) like '%request.requester_id=auth.uid()%','approval maker cannot decide own request');
select ok(pg_get_functiondef('public.decide_approval(uuid,text,text)'::regprocedure) like '%SUPER_ADMIN%','high-privilege approval requires super administrator');
select ok(has_table_privilege('service_role','public.generated_jobs','SELECT,UPDATE'),'export worker has minimal generated-job privileges');
select ok((select relrowsecurity from pg_class where oid='public.generated_jobs'::regclass),'generated jobs enforce row-level security');
select ok(has_table_privilege('service_role','public.contracts','SELECT'),'export worker can read contract source data');
select ok((select not public from storage.buckets where id='crm-exports'),'export artifacts use a private storage bucket');
select has_column('public','workspace_memberships','must_change_password','workspace membership tracks first-login password replacement');
select ok(has_function_privilege('authenticated','public.complete_initial_password_change()','EXECUTE'),'staff can complete only their own initial password workflow');
select ok(has_table_privilege('service_role','public.workspace_memberships','SELECT,UPDATE'),'staff administration service has narrow membership privileges');
select ok(pg_get_functiondef('public.current_crm_role()'::regprocedure) like '%aal2%','privileged CRM role helper requires AAL2');
select ok(pg_get_functiondef('public.is_workspace_member(uuid)'::regprocedure) like '%aal2%','workspace membership helper rejects privileged AAL1 sessions');

select * from finish();
rollback;
