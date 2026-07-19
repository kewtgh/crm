begin;
select plan(49);

create temp table test_ids(kind text primary key,id uuid not null);
grant select,insert,update,delete on test_ids to authenticated,service_role;

insert into auth.users(
  instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) values (
  '00000000-0000-0000-0000-000000000000',
  '90000000-0000-4000-8000-000000000001','authenticated','authenticated',
  'v100-admin@example.test',crypt('TestPassword1!',gen_salt('bf')),now(),
  '{"role":"ADMIN","account_status":"ACTIVE","workspace_id":"00000000-0000-4000-8000-000000000001"}',
  '{"username":"v100.admin","chinese_name":"发布管理员","english_name":"Release Admin"}',
  now(),now()
);

insert into public.workspaces(id,slug,name)
values('00000000-0000-4000-8000-000000000002','v100-other','V100 Other');

insert into auth.users(
  instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) values (
  '00000000-0000-0000-0000-000000000000',
  '90000000-0000-4000-8000-000000000002','authenticated','authenticated',
  'v100-suspended@example.test',crypt('TestPassword1!',gen_salt('bf')),now(),
  '{"role":"SALES_SPECIALIST","account_status":"ACTIVE","workspace_id":"00000000-0000-4000-8000-000000000001"}',
  '{"username":"v100.suspended","chinese_name":"停用用户","english_name":"Suspended User"}',
  now(),now()
);
update public.workspace_memberships set status='SUSPENDED'
where user_id='90000000-0000-4000-8000-000000000002';
update auth.users set raw_app_meta_data=
  '{"role":"SALES_MANAGER","account_status":"SUSPENDED","workspace_id":"00000000-0000-4000-8000-000000000001"}'
where id='90000000-0000-4000-8000-000000000002';

insert into auth.users(
  instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) values (
  '00000000-0000-0000-0000-000000000000',
  '90000000-0000-4000-8000-000000000003','authenticated','authenticated',
  'v100-two-step@example.test',crypt('TestPassword1!',gen_salt('bf')),now(),
  '{"provider":"email","providers":["email"]}',
  '{"username":"v100.two.step","chinese_name":"两步建档","english_name":"Two Step Provisioning"}',
  now(),now()
);
update auth.users set raw_app_meta_data=
  '{"role":"SALES_SUPPORT","account_status":"ACTIVE","workspace_id":"00000000-0000-4000-8000-000000000001"}'
where id='90000000-0000-4000-8000-000000000003';

insert into public.organizations(
  id,workspace_id,name_zh,name_en,status,owner_id,last_contact_at,created_by
) values(
  '91000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000001',
  '版本一客户','Version One Customer','HEALTHY',
  '90000000-0000-4000-8000-000000000001',now(),
  '90000000-0000-4000-8000-000000000001'
);

insert into public.contacts(
  id,workspace_id,organization_id,name_zh,name_en,email,status,owner_id,created_by
) values
(
  '92000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000001',
  '91000000-0000-4000-8000-000000000001',
  '主记录','Master Record','master@example.test','ACTIVE',
  '90000000-0000-4000-8000-000000000001',
  '90000000-0000-4000-8000-000000000001'
),(
  '92000000-0000-4000-8000-000000000002',
  '00000000-0000-4000-8000-000000000001',
  '91000000-0000-4000-8000-000000000001',
  '来源记录','Source Record','source@example.test','ACTIVE',
  '90000000-0000-4000-8000-000000000001',
  '90000000-0000-4000-8000-000000000001'
);

insert into public.contact_consents(
  workspace_id,contact_id,channel,purpose,status,source,obtained_at,created_by,updated_by
) values(
  '00000000-0000-4000-8000-000000000001',
  '92000000-0000-4000-8000-000000000001',
  'EMAIL','MARKETING','GRANTED','target-grant',now()-interval '2 days',
  '90000000-0000-4000-8000-000000000001',
  '90000000-0000-4000-8000-000000000001'
);
insert into public.contact_consents(
  workspace_id,contact_id,channel,purpose,status,source,revoked_at,created_by,updated_by
) values(
  '00000000-0000-4000-8000-000000000001',
  '92000000-0000-4000-8000-000000000002',
  'EMAIL','MARKETING','REVOKED','source-strict',now(),
  '90000000-0000-4000-8000-000000000001',
  '90000000-0000-4000-8000-000000000001'
);

insert into public.products(
  id,workspace_id,code,name_zh,name_en,billing_unit,duration_zh,duration_en,active
) values(
  '93000000-0000-4000-8000-000000000002',
  '00000000-0000-4000-8000-000000000002',
  'FOREIGN-PRODUCT','外部产品','Foreign Product','PROJECT','1 周','1 week',true
);

insert into public.webhook_inbox(
  id,workspace_id,provider,event_id,event_type,payload,signature_digest,status,
  attempts,last_error,available_at
) values
(
  '94000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000002',
  'EMAIL','foreign-event','TEST','{}','digest','FAILED',1,'foreign failure',now()
),(
  '94000000-0000-4000-8000-000000000002',
  '00000000-0000-4000-8000-000000000001',
  'EMAIL','local-event','TEST','{}','digest','FAILED',1,'local failure',now()
);

insert into public.notification_outbox(
  id,workspace_id,recipient_id,channel,template_key,payload,status,attempts,
  next_attempt_at,locked_at,lease_expires_at,locked_by,lease_token
) values(
  '95000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000001',
  '90000000-0000-4000-8000-000000000001',
  'EMAIL','lease-test','{}','SENDING',1,now()-interval '1 hour',
  now()-interval '10 minutes',now()-interval '5 minutes','crashed-worker',
  '95000000-0000-4000-8000-000000000099'
);

insert into public.contracts(
  id,workspace_id,contract_number,organization_id,product_id,start_date,end_date,
  currency,contract_value,status,relationship_level,owner_id,created_by
) select
  '96000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000001','V100-RENEWAL',
  '91000000-0000-4000-8000-000000000001',id,current_date-300,current_date+18,
  'CNY',100000,'ACTIVE',3,
  '90000000-0000-4000-8000-000000000001',
  '90000000-0000-4000-8000-000000000001'
from public.products
where workspace_id='00000000-0000-4000-8000-000000000001'
order by code limit 1;

select has_function(
  'public','create_quote_v100',
  array['text','uuid','uuid','uuid','uuid','uuid','text','numeric','numeric','date','text','text'],
  'the release quote entry point exists'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.create_quote_v091(text,uuid,uuid,uuid,uuid,uuid,text,numeric,numeric,date,text,text)',
    'EXECUTE'
  ),
  'authenticated clients cannot bypass v1 quote relationship checks'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.create_quote(text,uuid,uuid,uuid,text,numeric,numeric,date,text,text)',
    'EXECUTE'
  ),
  'authenticated clients cannot create legacy drafts without currency locks'
);
select ok(
  has_function_privilege(
    'authenticated',
    'public.create_quote_v100(text,uuid,uuid,uuid,uuid,uuid,text,numeric,numeric,date,text,text)',
    'EXECUTE'
  ),
  'authenticated clients use the v1 quote boundary'
);
select ok(
  has_function_privilege(
    'service_role','public.confirm_integration_connection(uuid,text,text,text)','EXECUTE'
  ),
  'provider callbacks can confirm integration connections'
);
select ok(
  not has_function_privilege(
    'authenticated','public.confirm_integration_connection(uuid,text,text,text)','EXECUTE'
  ),
  'browser sessions cannot fabricate connected integration state'
);
select ok(
  pg_get_triggerdef(oid) like '%UPDATE OF raw_app_meta_data%',
  'Auth metadata updates can complete an initial two-step membership provision'
) from pg_trigger where tgname='on_auth_user_created_crm_membership';
select is(
  (select status from public.workspace_memberships
    where user_id='90000000-0000-4000-8000-000000000001'),
  'ACTIVE',
  'new staff membership is active'
);
select is(
  (select status from public.workspace_memberships
    where user_id='90000000-0000-4000-8000-000000000002'),
  'SUSPENDED',
  'Auth metadata updates do not reactivate a suspended staff member'
);
select is(
  (select role from public.workspace_memberships
    where user_id='90000000-0000-4000-8000-000000000003'),
  'SALES_SUPPORT',
  'two-step Auth provisioning creates the first workspace membership'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"90000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}',
  true
);
set local role authenticated;

select is(public.current_crm_role(),'ADMIN','the test actor has the expected administrator role');
select throws_ok(
  $$select public.retry_operational_job(
    'WEBHOOK_INBOX','94000000-0000-4000-8000-000000000001'
  )$$,
  'P0001','operational_job_not_retryable',
  'an administrator cannot retry another workspace job'
);
reset role;
select is(
  (select status from public.webhook_inbox
    where id='94000000-0000-4000-8000-000000000001'),
  'FAILED',
  'the foreign workspace job remains unchanged'
);
set local role authenticated;
select lives_ok(
  $$select public.retry_operational_job(
    'WEBHOOK_INBOX','94000000-0000-4000-8000-000000000002'
  )$$,
  'a current-workspace webhook can be retried'
);
select is(
  (select status from public.webhook_inbox
    where id='94000000-0000-4000-8000-000000000002'),
  'RECEIVED',
  'the authorized webhook returns to the receive queue'
);
select ok(
  exists(select 1 from public.audit_events
    where entity_type='operational_job'
      and entity_id='94000000-0000-4000-8000-000000000002'
      and action='RETRY'),
  'the authorized retry creates an audit event'
);

select throws_ok(
  $$select public.idempotent_merge_duplicate_records(
    'CONTACTS',
    '92000000-0000-4000-8000-000000000001',
    '92000000-0000-4000-8000-000000000002',
    '{"unknown":"SOURCE"}',
    'v100-invalid-merge'
  )$$,
  'P0001','duplicate_field_choice_invalid',
  'unknown merge-field choices are rejected'
);
select lives_ok(
  $$select public.idempotent_merge_duplicate_records(
    'CONTACTS',
    '92000000-0000-4000-8000-000000000001',
    '92000000-0000-4000-8000-000000000002',
    '{"nameZh":"TARGET","nameEn":"TARGET","email":"TARGET","status":"TARGET"}',
    'v100-controlled-merge'
  )$$,
  'a controlled contact merge succeeds'
);
select ok(
  not exists(select 1 from public.contacts
    where id='92000000-0000-4000-8000-000000000002'),
  'the source contact is removed after relationship migration'
);
select is(
  (select status from public.contact_consents
    where contact_id='92000000-0000-4000-8000-000000000001'
      and channel='EMAIL' and purpose='MARKETING'),
  'REVOKED',
  'the more restrictive consent status wins'
);
select is(
  (select source from public.contact_consents
    where contact_id='92000000-0000-4000-8000-000000000001'
      and channel='EMAIL' and purpose='MARKETING'),
  'source-strict',
  'the restrictive consent evidence source is preserved'
);

select throws_ok(
  $$select public.create_quote_v100(
    'V100-NO-PRODUCT','91000000-0000-4000-8000-000000000001',
    null,null,null,null,'CNY',1000,0,current_date+30,'条款','Terms'
  )$$,
  'P0001','quote_product_or_bundle_required',
  'a quote requires exactly one product or bundle'
);
select throws_ok(
  $$select public.create_quote_v100(
    'V100-FOREIGN','91000000-0000-4000-8000-000000000001',
    null,'93000000-0000-4000-8000-000000000002',null,null,
    'CNY',1000,0,current_date+30,'条款','Terms'
  )$$,
  'P0001','quote_product_invalid',
  'a quote cannot reference a foreign-workspace product'
);
select lives_ok(
  $$insert into test_ids(kind,id)
    select 'quote',id from public.create_quote_v100(
      'V100-LOCAL','91000000-0000-4000-8000-000000000001',
      null,(select id from public.products
        where workspace_id='00000000-0000-4000-8000-000000000001'
        order by code limit 1),
      null,null,'CNY',1000,0,current_date+30,'条款','Terms'
    )$$,
  'a current-workspace product quote is created'
);
select is(
  (select base_total_amount from public.quote_versions
    where quote_id=(select id from test_ids where kind='quote')),
  1000.00::numeric,
  'a base-currency quote stores its locked base amount'
);
select lives_ok(
  $$insert into test_ids(kind,id)
    select 'bundle',id from public.create_product_bundle(
      'BUNDLE-V1','发布组合','Release Bundle',
      jsonb_build_array(jsonb_build_object(
        'productId',(select id from public.products
          where workspace_id='00000000-0000-4000-8000-000000000001'
          order by code limit 1),
        'quantity',1,'optional',false,'discountCeiling',10
      ))
    )$$,
  'a versioned product bundle is created'
);
select is(
  (select version from public.product_bundles
    where id=(select id from test_ids where kind='bundle')),
  1,
  'the first product-bundle release is version one'
);
select throws_ok(
  $$select public.create_quote_v100(
    'V100-BUNDLE-DISCOUNT','91000000-0000-4000-8000-000000000001',
    null,null,(select id from test_ids where kind='bundle'),null,
    'CNY',1000,110,current_date+30,'条款','Terms'
  )$$,
  'P0001','quote_bundle_discount_exceeded',
  'the database rejects a discount above the bundle ceiling'
);

select is(
  (public.renewal_playbook_context(
    '96000000-0000-4000-8000-000000000001'
  )->'suggestion'->>'windowDays')::integer,
  14,
  'an 18-day renewal receives the 14-day preparation window'
);
select is(
  public.renewal_playbook_context(
    '96000000-0000-4000-8000-000000000001'
  )->'suggestion'->>'stage',
  'NEGOTIATION',
  'the renewal stage is derived from the contract window'
);

select throws_ok(
  $$select public.configure_integration(
    'EMAIL','CONNECTED','BIDIRECTIONAL','manual fake'
  )$$,
  'P0001','integration_connection_confirmation_required',
  'an administrator cannot manually fabricate a connected provider'
);

reset role;
set local role service_role;
select lives_ok(
  $$select public.confirm_integration_connection(
    '00000000-0000-4000-8000-000000000001',
    'EMAIL','verified-mailer','BIDIRECTIONAL'
  )$$,
  'a service-side provider callback can confirm a connection'
);
reset role;
select is(
  (select status from public.integration_connections
    where workspace_id='00000000-0000-4000-8000-000000000001'
      and provider='EMAIL'),
  'CONNECTED',
  'provider confirmation sets the connection state'
);

set local role authenticated;
select lives_ok(
  $$select public.request_integration_sync('EMAIL')$$,
  'an administrator can request sync for a confirmed connection'
);
select is(
  (select status from public.integration_sync_jobs
    where provider='EMAIL' order by created_at desc limit 1),
  'QUEUED',
  'the integration request creates a queued job'
);

reset role;
set local role service_role;
select is(
  (select count(*)::integer from public.claim_integration_sync_jobs(
    10,'v100-integration-worker',300
  )),
  1,
  'the integration worker leases the queued job'
);
reset role;
select is(
  (select status from public.integration_sync_jobs
    where provider='EMAIL' order by created_at desc limit 1),
  'PROCESSING',
  'the leased integration job enters processing'
);
set local role service_role;
select is(
  (select count(*)::integer from public.claim_notification_outbox_leased(
    10,'v100-outbox-worker',300
  ) where id='95000000-0000-4000-8000-000000000001'),
  1,
  'an expired outbox lease is reclaimed'
);
reset role;
select isnt(
  (select lease_token from public.notification_outbox
    where id='95000000-0000-4000-8000-000000000001'),
  '95000000-0000-4000-8000-000000000099'::uuid,
  'lease recovery rotates the fencing token'
);
select is(
  (select status from public.notification_outbox
    where id='95000000-0000-4000-8000-000000000001'),
  'SENDING',
  'the reclaimed outbox record remains exclusively leased for sending'
);

set local role authenticated;
select ok(
  public.operational_snapshot()->'queues' @> '[{"key":"INTEGRATION_SYNC"}]'::jsonb,
  'the operations snapshot exposes the integration queue'
);
select ok(
  public.business_improvement_snapshot() ?& array[
    'retention','renewal','forecast','queueSla','nextBestAction'
  ],
  'the business-improvement snapshot exposes all five outcome groups'
);
select lives_ok(
  $$select public.generate_next_best_actions(
    '91000000-0000-4000-8000-000000000001'
  )$$,
  'the rules engine records a generation batch'
);
select is(
  (select count(*)::integer from public.next_action_evaluations
    where organization_id='91000000-0000-4000-8000-000000000001'),
  4,
  'each organization records applicable or not-applicable results for four rules'
);

reset role;
set local role service_role;
delete from public.worker_heartbeats;
select is(
  (public.service_readiness_snapshot(
    '00000000-0000-4000-8000-000000000001'
  )->>'missingWorkers')::integer,
  6,
  'readiness requires all six worker classes'
);
select is(
  public.service_readiness_snapshot(
    '00000000-0000-4000-8000-000000000001'
  )->>'ready',
  'false',
  'readiness fails closed while production workers are missing'
);
select throws_ok(
  $$select public.service_readiness_snapshot(null)$$,
  'P0001','workspace_required',
  'readiness never falls back to an implicit workspace'
);
select is(
  public.ingest_webhook_event(
    '00000000-0000-4000-8000-000000000001','EMAIL','pg-tap-idempotent',
    'delivery.test','{"ok":true}',repeat('a',64),repeat('b',64),now()
  )->>'duplicate',
  'false',
  'the first valid webhook envelope is inserted'
);
select is(
  public.ingest_webhook_event(
    '00000000-0000-4000-8000-000000000001','EMAIL','pg-tap-idempotent',
    'delivery.test','{"ok":true}',repeat('a',64),repeat('b',64),now()
  )->>'duplicate',
  'true',
  'the same provider event is acknowledged as a duplicate'
);

select * from finish();
rollback;
