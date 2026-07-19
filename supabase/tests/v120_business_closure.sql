begin;
select plan(37);

insert into auth.users(
  instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) values
(
  '00000000-0000-0000-0000-000000000000',
  '97000000-0000-4000-8000-000000000001','authenticated','authenticated',
  'v120-manager@example.test',crypt('TestPassword1!',gen_salt('bf')),now(),
  '{"role":"SALES_MANAGER","account_status":"ACTIVE","workspace_id":"00000000-0000-4000-8000-000000000001"}',
  '{"username":"v120.manager","chinese_name":"测试经理","english_name":"Test Manager"}',
  now(),now()
),(
  '00000000-0000-0000-0000-000000000000',
  '97000000-0000-4000-8000-000000000002','authenticated','authenticated',
  'v120-specialist@example.test',crypt('TestPassword1!',gen_salt('bf')),now(),
  '{"role":"SALES_SPECIALIST","account_status":"ACTIVE","workspace_id":"00000000-0000-4000-8000-000000000001"}',
  '{"username":"v120.specialist","chinese_name":"测试专员","english_name":"Test Specialist"}',
  now(),now()
),(
  '00000000-0000-0000-0000-000000000000',
  '97000000-0000-4000-8000-000000000003','authenticated','authenticated',
  'v120-other@example.test',crypt('TestPassword1!',gen_salt('bf')),now(),
  '{"role":"SALES_SPECIALIST","account_status":"ACTIVE","workspace_id":"00000000-0000-4000-8000-000000000001"}',
  '{"username":"v120.other","chinese_name":"其他团队","english_name":"Other Team"}',
  now(),now()
),(
  '00000000-0000-0000-0000-000000000000',
  '97000000-0000-4000-8000-000000000004','authenticated','authenticated',
  'v120-super@example.test',crypt('TestPassword1!',gen_salt('bf')),now(),
  '{"role":"SUPER_ADMIN","account_status":"ACTIVE","workspace_id":"00000000-0000-4000-8000-000000000001"}',
  '{"username":"v120.super","chinese_name":"超级管理员","english_name":"Super Admin"}',
  now(),now()
);

insert into public.sales_team_members(
  workspace_id,auth_user_id,name_zh,name_en,role,team
) values
(
  '00000000-0000-4000-8000-000000000001',
  '97000000-0000-4000-8000-000000000001','测试经理','Test Manager','SALES_MANAGER','TEAM-A'
),(
  '00000000-0000-4000-8000-000000000001',
  '97000000-0000-4000-8000-000000000002','测试专员','Test Specialist','SALES_SPECIALIST','TEAM-A'
),(
  '00000000-0000-4000-8000-000000000001',
  '97000000-0000-4000-8000-000000000003','其他团队','Other Team','SALES_SPECIALIST','TEAM-B'
);

insert into public.organizations(
  id,workspace_id,name_zh,name_en,city,curriculum,status,owner_id,created_by
) values(
  '97100000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000001',
  '版本客户','Versioned Customer','台北','IB','HEALTHY',
  '97000000-0000-4000-8000-000000000002',
  '97000000-0000-4000-8000-000000000002'
);

insert into public.contacts(
  id,workspace_id,organization_id,name_zh,name_en,email,phone,status,owner_id,created_by
) values(
  '97200000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000001',
  '97100000-0000-4000-8000-000000000001',
  '待修联系人','Contact To Fix',null,null,'ACTIVE',
  '97000000-0000-4000-8000-000000000001',
  '97000000-0000-4000-8000-000000000001'
);

insert into public.crm_tasks(
  id,workspace_id,title_zh,title_en,related_type,related_id,related_label,
  status,priority,owner_id,due_at,created_by
) values(
  '97300000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000001',
  '专员待办','Specialist task','ORGANIZATION',
  '97100000-0000-4000-8000-000000000001','版本客户 / Versioned Customer',
  'TODO','HIGH','97000000-0000-4000-8000-000000000002',
  now()+interval '2 hours','97000000-0000-4000-8000-000000000002'
);

select has_function(
  'public','create_crm_task',
  array['text','text','text','uuid','text','text','timestamp with time zone','uuid'],
  'the delegated task entry point exists'
);
select ok(
  has_function_privilege(
    'authenticated',
    'public.create_crm_task(text,text,text,uuid,text,text,timestamptz,uuid)',
    'EXECUTE'
  ),
  'authenticated staff can use the guarded task entry point'
);
select ok(
  not has_function_privilege(
    'authenticated','public.apply_account_recovery_throttle(text,text)','EXECUTE'
  ),
  'browser sessions cannot invoke the recovery throttle directly'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"97000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}',
  true
);
set local role authenticated;
select ok(
  public.can_assign_crm_task('97000000-0000-4000-8000-000000000002'),
  'a specialist can assign work to themselves'
);
select ok(
  not public.can_assign_crm_task('97000000-0000-4000-8000-000000000001'),
  'a specialist cannot assign work to a manager'
);
select throws_ok(
  $$select public.create_crm_task(
    '越权任务','Unauthorized task','ORGANIZATION',
    '97100000-0000-4000-8000-000000000001','版本客户','NORMAL',
    now()+interval '1 day','97000000-0000-4000-8000-000000000001'
  )$$,
  'P0001','task_owner_not_assignable',
  'the guarded task RPC rejects an unauthorized owner'
);
select lives_ok(
  $$select public.save_crm_record(
    'schools','97100000-0000-4000-8000-000000000001',
    (select updated_at from public.organizations where id='97100000-0000-4000-8000-000000000001'),
    '{"city":"新北"}'
  )$$,
  'an owner can update a CRM record using its current version'
);
select throws_ok(
  $$select public.save_crm_record(
    'schools','97100000-0000-4000-8000-000000000001',
    now()-interval '1 day','{"city":"高雄"}'
  )$$,
  'P0001','crm_version_conflict',
  'a stale CRM record update is rejected'
);
select ok(
  exists(
    select 1 from public.crm_record_history(
      'schools','97100000-0000-4000-8000-000000000001',20
    ) where action='UPDATE'
  ),
  'record history exposes the audited update'
);
select lives_ok(
  $$select public.save_shared_view(
    'schools','我的客户','PERSONAL',
    '{"version":1,"query":"","status":"all","sort":"primary","direction":"asc","pageSize":10}'
  )$$,
  'a staff member can save a versioned personal view'
);
select is(
  (select count(*)::integer from public.shared_views where name='我的客户'),
  1,
  'the saved view is visible to its owner'
);
select lives_ok(
  $$select public.bulk_complete_crm_tasks(
    array['97300000-0000-4000-8000-000000000001'::uuid],
    '客户跟进已经完成'
  )$$,
  'a specialist can bulk-complete their own task'
);
select is(
  (select status from public.crm_tasks where id='97300000-0000-4000-8000-000000000001'),
  'DONE',
  'bulk completion persists the final task state'
);

reset role;
select set_config(
  'request.jwt.claims',
  '{"sub":"97000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}',
  true
);
set local role authenticated;
select ok(
  public.can_assign_crm_task('97000000-0000-4000-8000-000000000002'),
  'a manager can assign a task inside their team'
);
select ok(
  not public.can_assign_crm_task('97000000-0000-4000-8000-000000000003'),
  'a manager cannot assign a task into another team'
);
select is(
  (
    select count(*)::integer from public.list_assignable_crm_users('')
    where user_id='97000000-0000-4000-8000-000000000003'
  ),
  0,
  'the assignee directory excludes users outside the manager scope'
);
select is(
  (public.crm_task_workspace()->>'canViewTeam')::boolean,
  true,
  'the manager workspace includes team-capacity data'
);
select lives_ok(
  $$select public.create_crm_task(
    '经理委派','Manager delegated','ORGANIZATION',
    '97100000-0000-4000-8000-000000000001','版本客户','URGENT',
    now()+interval '3 hours','97000000-0000-4000-8000-000000000002'
  )$$,
  'a manager can delegate a task within their team'
);
reset role;
select ok(
  exists(
    select 1 from public.crm_tasks
    where title_en='Manager delegated'
      and owner_id='97000000-0000-4000-8000-000000000002'
  ),
  'the delegated owner is persisted'
);
select ok(
  exists(
    select 1 from public.user_notifications
    where user_id='97000000-0000-4000-8000-000000000002'
      and source_type='TASK'
      and title_key='notification.taskAssigned.title'
  ),
  'task delegation creates an in-app notification'
);
select set_config(
  'request.jwt.claims',
  '{"sub":"97000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}',
  true
);
set local role authenticated;
select lives_ok(
  $$select public.run_data_quality_rules()$$,
  'a manager can run the data quality rules'
);
select ok(
  exists(
    select 1 from public.data_quality_issues
    where entity_id='97200000-0000-4000-8000-000000000001'
      and rule_key='CONTACT_METHOD_MISSING' and status='OPEN'
  ),
  'the missing contact method creates an open issue'
);
select throws_ok(
  $$select public.resolve_data_quality_issue(
    (select id from public.data_quality_issues
      where entity_id='97200000-0000-4000-8000-000000000001'
        and rule_key='CONTACT_METHOD_MISSING'),
    '尚未修复',false
  )$$,
  'P0001','quality_source_not_fixed',
  'an issue cannot be resolved while its source still violates the rule'
);
update public.contacts set phone='+886900000000'
where id='97200000-0000-4000-8000-000000000001';
select lives_ok(
  $$select public.resolve_data_quality_issue(
    (select id from public.data_quality_issues
      where entity_id='97200000-0000-4000-8000-000000000001'
        and rule_key='CONTACT_METHOD_MISSING'),
    '已补充电话',false
  )$$,
  'the corrected source record allows verified resolution'
);
select is(
  (
    select status from public.data_quality_issues
    where entity_id='97200000-0000-4000-8000-000000000001'
      and rule_key='CONTACT_METHOD_MISSING'
  ),
  'RESOLVED',
  'verified resolution closes the issue'
);
select lives_ok(
  $$select public.create_crm_export_approval(
    'schools','版本','HEALTHY','primary','asc','客户季度复核'
  )$$,
  'a CRM list export can enter the approval workflow'
);
select is(
  (
    select required_role from public.approval_requests
    where request_type='CRM_EXPORT' and requester_id='97000000-0000-4000-8000-000000000001'
  ),
  'SUPER_ADMIN',
  'CRM exports require super-admin approval'
);

reset role;
select set_config(
  'request.jwt.claims',
  '{"sub":"97000000-0000-4000-8000-000000000004","role":"authenticated","aal":"aal2"}',
  true
);
set local role authenticated;
select lives_ok(
  $$select public.decide_approval(
    (select id from public.approval_requests
      where request_type='CRM_EXPORT'
        and requester_id='97000000-0000-4000-8000-000000000001'),
    'APPROVED','范围和用途已复核'
  )$$,
  'a super-admin can approve the CRM export'
);
select ok(
  exists(
    select 1 from public.generated_jobs
    where job_type='CRM_EXPORT'
      and parameters->>'resource'='schools'
      and created_by='97000000-0000-4000-8000-000000000001'
  ),
  'approval creates a scoped generated export job'
);
select ok(
  not has_function_privilege(
    'authenticated','public.save_mutation_receipt(text,text,jsonb)','EXECUTE'
  ),
  'browser sessions cannot forge mutation receipts'
);
select ok(
  has_function_privilege(
    'authenticated','public.idempotent_merge_duplicate_records(text,uuid,uuid,jsonb,text)','EXECUTE'
  ),
  'authenticated leaders use the transactionally idempotent merge boundary'
);
select ok(
  not has_function_privilege(
    'authenticated','public.merge_duplicate_records(text,uuid,uuid,jsonb)','EXECUTE'
  ),
  'authenticated sessions cannot bypass idempotent duplicate merge'
);
select ok(
  not has_function_privilege(
    'authenticated','public.rollback_import_batch(uuid)','EXECUTE'
  ),
  'authenticated sessions cannot bypass idempotent import rollback'
);
select ok(
  not has_function_privilege(
    'authenticated','public.accept_quote(uuid)','EXECUTE'
  ),
  'authenticated sessions cannot bypass idempotent quote acceptance'
);

reset role;
set local role service_role;
select is(
  (public.apply_account_recovery_throttle(
    repeat('a',64),repeat('b',64)
  )->>'allowed')::boolean,
  true,
  'the first recovery request is allowed'
);
do $$ begin
  perform public.apply_account_recovery_throttle(repeat('a',64),repeat('b',64));
  perform public.apply_account_recovery_throttle(repeat('a',64),repeat('b',64));
  perform public.apply_account_recovery_throttle(repeat('a',64),repeat('b',64));
  perform public.apply_account_recovery_throttle(repeat('a',64),repeat('b',64));
end $$;
select is(
  (public.apply_account_recovery_throttle(
    repeat('a',64),repeat('b',64)
  )->>'allowed')::boolean,
  false,
  'the durable account bucket blocks the sixth recovery request'
);
select ok(
  (public.apply_account_recovery_throttle(
    repeat('a',64),repeat('b',64)
  )->>'retryAfterSeconds')::integer>0,
  'a blocked recovery request returns a positive retry interval'
);

reset role;
select * from finish();
rollback;
