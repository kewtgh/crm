begin;
select plan(8);

insert into auth.users(
  instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) values (
  '00000000-0000-0000-0000-000000000000',
  '98000000-0000-4000-8000-000000000001','authenticated','authenticated',
  'pagination-admin@example.test',crypt('TestPassword1!',gen_salt('bf')),now(),
  '{"role":"ADMIN","account_status":"ACTIVE","workspace_id":"00000000-0000-4000-8000-000000000001"}',
  '{"username":"pagination.admin","chinese_name":"分页管理员","english_name":"Pagination Admin"}',
  now(),now()
);

insert into public.workspaces(id,slug,name)
values('00000000-0000-4000-8000-000000000098','pagination-other','Pagination Other');

insert into public.webhook_inbox(
  workspace_id,provider,event_id,event_type,payload,signature_digest,status,attempts,last_error
)
select
  '00000000-0000-4000-8000-000000000001','EMAIL',
  'pagination-event-'||value,'PAGINATION_TEST','{}',
  'pagination-digest-'||value,'FAILED',1,'test failure'
from generate_series(1,21) value;

insert into public.webhook_inbox(
  workspace_id,provider,event_id,event_type,payload,signature_digest,status,attempts,last_error
) values (
  '00000000-0000-4000-8000-000000000098','EMAIL',
  'pagination-foreign-event','PAGINATION_TEST','{}',
  'pagination-foreign-digest','FAILED',1,'foreign failure'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"98000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}',
  true
);
set local role authenticated;

select has_function(
  'public','operational_retryable_jobs_page',array['integer','integer'],
  'the paged operational recovery RPC exists'
);
select ok(
  has_function_privilege(
    'authenticated','public.operational_retryable_jobs_page(integer,integer)','EXECUTE'
  ),
  'authenticated administrators can call the paged recovery RPC'
);
select is(
  (public.operational_retryable_jobs_page(1,10)->>'total')::integer,
  21,
  'the total is exact and excludes another workspace'
);
select is(
  jsonb_array_length(public.operational_retryable_jobs_page(1,10)->'items'),
  10,
  'the first 10-row page contains ten jobs'
);
select is(
  jsonb_array_length(public.operational_retryable_jobs_page(2,10)->'items'),
  10,
  'the second 10-row page contains ten jobs'
);
select is(
  jsonb_array_length(public.operational_retryable_jobs_page(3,10)->'items'),
  1,
  'the final 10-row page contains the remaining job'
);
select is(
  jsonb_array_length(public.operational_retryable_jobs_page(1,20)->'items'),
  20,
  'the 20-row page-size option is supported'
);
select throws_ok(
  $$select public.operational_retryable_jobs_page(1,25)$$,
  'P0001','invalid_pagination',
  'unsupported page sizes are rejected'
);

select * from finish();
rollback;
