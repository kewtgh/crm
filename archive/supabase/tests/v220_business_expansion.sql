begin;
select plan(158);

select has_table('public','automation_rules','automation rules are durable');
select has_table('public','automation_events','automation events are idempotent records');
select has_table('public','automation_runs','automation runs retain outcomes');
select has_table('public','growth_campaigns','growth campaigns are durable');
select has_table('public','lead_attribution_touches','lead attribution touches are durable');
select has_table('public','admission_journeys','admissions journeys are durable');
select has_table('public','portal_invitations','portal invitations store access metadata');
select has_table('public','portal_update_requests','portal changes require staff review');
select has_table('public','communication_threads','communication threads are durable');
select has_table('public','communication_messages','communication delivery outcomes are durable');
select has_table('public','data_quality_daily_snapshots','data quality trends are durable');
select has_table('public','privacy_executions','privacy execution evidence is durable');
select has_table('public','privacy_restrictions','privacy processing restrictions are durable');
select has_table('public','portal_access_consents','portal consent evidence is durable');
select has_table('public','data_quality_rule_configs','data-quality rules are configurable');
select has_table('public','connector_reconciliation_receipts','connector reconciliation receipts are durable');
select has_column('public','automation_rules','version','automation rules carry version evidence');
select has_column('public','automation_runs','attempt_count','automation retries are counted');
select has_column('public','communication_messages','idempotency_key','communication writes are idempotent');
select has_column('public','portal_update_requests','applied_changes','portal decisions disclose applied fields');
select has_column('public','generated_jobs','expected_row_count','export jobs record expected rows');
select has_column('public','generated_jobs','exported_row_count','export jobs record exported rows');
select has_column('public','generated_jobs','artifact_sha256','export jobs record artifact integrity');
select has_column('public','generated_jobs','query_snapshot','export jobs record the immutable query scope');
select has_column('public','generated_jobs','currency_scope','export jobs record their currency scope');
select ok((select relrowsecurity from pg_class where oid='public.automation_rules'::regclass),'automation rules enforce RLS');
select ok((select relrowsecurity from pg_class where oid='public.portal_invitations'::regclass),'portal invitations enforce RLS');
select ok((select relrowsecurity from pg_class where oid='public.communication_messages'::regclass),'communications enforce RLS');
select ok((select relrowsecurity from pg_class where oid='public.data_quality_daily_snapshots'::regclass),'quality trends enforce RLS');
select ok(has_function_privilege('authenticated','public.run_automation_event(text,text,jsonb)','EXECUTE'),'authenticated leaders can invoke guarded automation');
select ok(not has_function_privilege('anon','public.run_automation_event(text,text,jsonb)','EXECUTE'),'anonymous users cannot invoke automation');
select ok(has_function_privilege('service_role','public.service_portal_snapshot(text)','EXECUTE'),'the portal service can resolve token digests');
select ok(not has_function_privilege('authenticated','public.service_portal_snapshot(text)','EXECUTE'),'staff sessions cannot bypass the portal service boundary');
select ok(not has_function_privilege('authenticated','public.service_complete_communication(uuid,text)','EXECUTE'),'staff cannot forge provider delivery receipts');
select ok(has_table_privilege('service_role','public.appointments','SELECT'),'calendar worker can read appointment delivery context');
select ok(has_table_privilege('service_role','public.appointment_attendees','SELECT'),'calendar and export workers can read attendee context');
select ok(has_table_privilege('service_role','public.contacts','SELECT'),'privacy export worker can read the verified subject');
select ok(has_table_privilege('service_role','public.privacy_requests','SELECT'),'privacy export worker can read request scope');
select ok(has_table_privilege('service_role','public.contact_consents','SELECT'),'privacy export worker can read consent evidence');
select ok(has_table_privilege('service_role','public.crm_activities','SELECT'),'privacy export worker can read subject activities');
select ok(has_table_privilege('service_role','public.household_members','SELECT'),'privacy export worker can read household memberships');
select ok(has_table_privilege('service_role','public.student_guardian_relationships','SELECT'),'privacy export worker can read guardian relationships');
select ok(has_table_privilege('service_role','public.students','SELECT'),'privacy export worker can read linked students');
select ok(has_table_privilege('service_role','public.student_academic_records','SELECT'),'privacy export worker can read linked academic records');
select is((select count(*)::integer from public.integration_connections where provider='PAYMENT'),(select count(*)::integer from public.workspaces),'every workspace receives the payment connector');
select ok(pg_get_functiondef('public.sales_performance_report_v220(text,text,text)'::regprocedure) like '%currency_filter%','sales performance accepts an explicit currency scope');
select ok(pg_get_functiondef('public.performance_export_rows_v220(uuid,date,date)'::regprocedure) like '%base_currency%','performance export includes base-currency context');
select has_function('public','service_readiness_snapshot_for_workers',array['uuid','text[]'],'readiness accepts the enabled worker set');
select has_function('public','preview_automation_rule',array['uuid','jsonb'],'automation has a side-effect-free preview');
select has_function('public','retry_automation_run',array['uuid'],'failed automation runs are retryable');
select has_function('public','create_guardian_portal_invitation',array['uuid','text','text','timestamptz'],'portal invites verify a household recipient');
select has_function('public','service_accept_portal_consent',array['text','text','text','text'],'portal access records explicit consent');
select has_function('public','record_inbound_communication',array['uuid','text','text'],'inbound communication can be recorded');
select has_function('public','retry_communication_message',array['uuid'],'failed communications can be retried');
select has_function('public','communication_inbox_snapshot',array['text','integer'],'communication search runs against the durable inbox');
select has_function('public','configure_data_quality_rule',array['text','boolean','text'],'quality rules are configurable');
select has_function('public','seed_data_quality_rule_configs',array[]::text[],'future workspaces receive quality rule defaults');
select has_function('public','seed_workspace_connector_defaults',array[]::text[],'future workspaces receive disabled connector defaults');
select has_function('public','growth_performance_snapshot',array[]::text[],'growth exposes performance metrics');
select has_function('public','service_record_connector_reconciliation',array['uuid','text','text','text','text','uuid','numeric','text','text','text'],'connector reconciliation is idempotently receipted');
select ok(pg_get_functiondef('public.retry_operational_job(text,uuid)'::regprocedure) like '%INTEGRATION_SYNC%','integration sync failures are manually retryable');
select ok(not has_table_privilege('authenticated','public.privacy_requests','UPDATE'),'privacy request state cannot be updated directly');
select ok(has_function_privilege('authenticated','public.manage_privacy_request(uuid,text,text,text)','EXECUTE'),'privacy state changes use the guarded workflow');
select ok(not has_table_privilege('authenticated','public.portal_invitations','UPDATE'),'portal invitations cannot be changed directly');
select ok(not has_table_privilege('authenticated','public.portal_update_requests','UPDATE'),'portal decisions must use the guarded function');
select ok(not has_function_privilege('authenticated','public.service_accept_portal_consent(text,text,text,text)','EXECUTE'),'staff cannot forge public portal consent');
select ok((select relrowsecurity from pg_class where oid='public.portal_access_consents'::regclass),'portal consent evidence enforces RLS');
select ok((select relrowsecurity from pg_class where oid='public.data_quality_rule_configs'::regclass),'quality rule configuration enforces RLS');
select ok((select relrowsecurity from pg_class where oid='public.connector_reconciliation_receipts'::regclass),'connector receipts enforce RLS');

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('00000000-0000-0000-0000-000000000000','98000000-0000-4000-8000-000000000001','authenticated','authenticated','v220-director@example.test',crypt('TestPassword1!',gen_salt('bf')),now(),
  '{"role":"SALES_DIRECTOR","account_status":"ACTIVE","workspace_id":"00000000-0000-4000-8000-000000000001"}',
  '{"username":"v220.director","chinese_name":"扩展主管","english_name":"Expansion Director"}',now(),now());
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('00000000-0000-0000-0000-000000000000','98000000-0000-4000-8000-000000000002','authenticated','authenticated','v220-reviewer@example.test',crypt('TestPassword1!',gen_salt('bf')),now(),
  '{"role":"SALES_DIRECTOR","account_status":"ACTIVE","workspace_id":"00000000-0000-4000-8000-000000000001"}',
  '{"username":"v220.reviewer","chinese_name":"扩展复核人","english_name":"Expansion Reviewer"}',now(),now());
insert into public.workspace_memberships(workspace_id,user_id,role,status)
values('00000000-0000-4000-8000-000000000001','98000000-0000-4000-8000-000000000001','SALES_DIRECTOR','ACTIVE')
on conflict(workspace_id,user_id) do update set role=excluded.role,status='ACTIVE';
insert into public.workspace_memberships(workspace_id,user_id,role,status)
values('00000000-0000-4000-8000-000000000001','98000000-0000-4000-8000-000000000002','SALES_DIRECTOR','ACTIVE')
on conflict(workspace_id,user_id) do update set role=excluded.role,status='ACTIVE';
insert into public.contacts(id,workspace_id,name_zh,name_en,contact_type,status,email,owner_id,created_by)
values('98100000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001','扩展联系人','Expansion Contact','PARENT','ACTIVE','guardian-v220@example.test','98000000-0000-4000-8000-000000000001','98000000-0000-4000-8000-000000000001');
insert into public.households(id,workspace_id,name_zh,name_en,address,owner_id,created_by)
values('98200000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001','扩展家庭','Expansion Household','Taipei','98000000-0000-4000-8000-000000000001','98000000-0000-4000-8000-000000000001');
insert into public.household_members(workspace_id,household_id,contact_id,member_role,primary_contact,created_by)
values('00000000-0000-4000-8000-000000000001','98200000-0000-4000-8000-000000000001','98100000-0000-4000-8000-000000000001','GUARDIAN',true,'98000000-0000-4000-8000-000000000001');
insert into public.leads(id,workspace_id,subject_type,household_id,name_zh,name_en,source,status,qualification_score,qualification_note,pipeline_key,owner_id,created_by)
values('98300000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001','HOUSEHOLD','98200000-0000-4000-8000-000000000001','扩展线索','Expansion Lead','REFERRAL','QUALIFIED',90,'Verified','HOUSEHOLD_DEFAULT','98000000-0000-4000-8000-000000000001','98000000-0000-4000-8000-000000000001');

select set_config('request.jwt.claims','{"sub":"98000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}',true);
set local role authenticated;
select lives_ok($$insert into public.automation_rules(name_zh,name_en,trigger_key,conditions,action_type,action_config)
  values('合格线索跟进','Qualified lead follow-up','LEAD_STATUS_CHANGED','{"status":"QUALIFIED"}','TASK','{"titleZh":"联系合格线索","titleEn":"Contact qualified lead","priority":"HIGH","dueHours":12}')$$,'a leader can create a deterministic automation rule');
select lives_ok($$select public.run_automation_event('LEAD_STATUS_CHANGED','v220-lead-qualified','{"status":"QUALIFIED","relatedType":"LEAD","relatedId":"98300000-0000-4000-8000-000000000001","relatedLabel":"Expansion Lead"}')$$,'a matching automation event executes');
select is((select count(*)::integer from public.crm_tasks where title_en='Contact qualified lead'),1,'automation creates exactly one task');
select lives_ok($$select public.run_automation_event('LEAD_STATUS_CHANGED','v220-lead-qualified','{"status":"QUALIFIED","relatedType":"LEAD","relatedId":"98300000-0000-4000-8000-000000000001"}')$$,'a duplicate event is a safe retry');
select is((select count(*)::integer from public.crm_tasks where title_en='Contact qualified lead'),1,'the duplicate event does not duplicate its task');
select is((select status from public.automation_runs order by created_at desc limit 1),'SUCCEEDED','automation records the successful outcome');
select is((public.preview_automation_rule((select id from public.automation_rules where name_en='Qualified lead follow-up'),'{}')->>'sideEffects')::boolean,false,'automation preview is side-effect free');
select is((public.preview_automation_rule((select id from public.automation_rules where name_en='Qualified lead follow-up'),' {"status":"QUALIFIED"}')->>'matches')::boolean,true,'automation preview explains a matching payload');
select lives_ok($$update public.automation_rules set name_en='Qualified lead follow-up v2' where name_en='Qualified lead follow-up'$$,'automation rules can be versioned');
select is((select version from public.automation_rules where name_en='Qualified lead follow-up v2'),2,'a material automation edit increments its version');
reset role;
insert into public.automation_events(id,workspace_id,trigger_key,event_key,payload,actor_id)
values('98500000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001','LEAD_STATUS_CHANGED','v220-retry-event','{"status":"QUALIFIED"}','98000000-0000-4000-8000-000000000001');
insert into public.automation_runs(id,workspace_id,rule_id,event_id,status,error_code)
values('98500000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001',(select id from public.automation_rules where name_en='Qualified lead follow-up v2'),'98500000-0000-4000-8000-000000000001','FAILED','TEST_FAILURE');
select set_config('request.jwt.claims','{"sub":"98000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}',true);
set local role authenticated;
select lives_ok($$select public.retry_automation_run('98500000-0000-4000-8000-000000000002')$$,'a failed automation run can be safely retried');
select is((select status from public.automation_runs where id='98500000-0000-4000-8000-000000000002'),'SUCCEEDED','the retried automation records success');
select is((select attempt_count from public.automation_runs where id='98500000-0000-4000-8000-000000000002'),2,'automation retry increments the attempt count');
select is((select count(*)::integer from public.crm_tasks where title_en='Contact qualified lead'),2,'the retry creates exactly one additional action');

select lives_ok($$select public.create_communication_thread('98100000-0000-4000-8000-000000000001','Admissions planning','EMAIL','SERVICE')$$,'staff can create a governed communication thread');
select throws_ok($$select public.queue_communication_message((select id from public.communication_threads where subject='Admissions planning'),'Hello','v220-without-consent')$$,'communication_consent_required','sending without matching consent is rejected');
reset role;
insert into public.contact_consents(workspace_id,contact_id,channel,purpose,status,source,obtained_at,created_by,updated_by)
values('00000000-0000-4000-8000-000000000001','98100000-0000-4000-8000-000000000001','EMAIL','SERVICE','GRANTED','TEST',now(),'98000000-0000-4000-8000-000000000001','98000000-0000-4000-8000-000000000001');
set local role authenticated;
select lives_ok($$select public.queue_communication_message((select id from public.communication_threads where subject='Admissions planning'),'Consent-approved hello','v220-outbound-1')$$,'matching consent allows the message to queue');
select is((select delivery_status from public.communication_messages where body='Consent-approved hello'),'QUEUED','the queued message awaits a real provider receipt');
select lives_ok($$select public.queue_communication_message((select id from public.communication_threads where subject='Admissions planning'),'Consent-approved hello','v220-outbound-1')$$,'a repeated communication request key is idempotent');
select is((select count(*)::integer from public.communication_messages where idempotency_key='v220-outbound-1'),1,'an idempotent outbound retry creates one message');
select throws_ok($$select public.queue_communication_message((select id from public.communication_threads where subject='Admissions planning'),'Different body','v220-outbound-1')$$,'communication_idempotency_conflict','an idempotency key cannot be reused for different content');
select lives_ok($$select public.record_inbound_communication((select id from public.communication_threads where subject='Admissions planning'),'Guardian reply','v220-inbound-1')$$,'staff can record an inbound message');
select is((select delivery_status from public.communication_messages where idempotency_key='v220-inbound-1'),'RECEIVED','inbound messages retain a received status');
select is(jsonb_array_length(public.communication_inbox_snapshot('Guardian reply',100)),1,'communication search includes durable message content');
reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select lives_ok($$select public.service_fail_communication((select id from public.communication_messages where idempotency_key='v220-outbound-1'),'TEST_PROVIDER_FAILURE')$$,'the provider boundary records a failed delivery');
reset role;
select set_config('request.jwt.claims','{"sub":"98000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}',true);
set local role authenticated;
select lives_ok($$select public.retry_communication_message((select id from public.communication_messages where idempotency_key='v220-outbound-1'))$$,'staff can retry a failed consent-approved message');
select is((select delivery_status from public.communication_messages where idempotency_key='v220-outbound-1'),'QUEUED','a communication retry returns to the queued state');
select is((select attempt_count from public.communication_messages where idempotency_key='v220-outbound-1'),2,'a communication retry increments its attempt count');

select lives_ok($$insert into public.growth_campaigns(code,name_zh,name_en,channel,status,budget,currency) values('V220-CAMPAIGN','扩展活动','Expansion Campaign','REFERRAL','ACTIVE',1000,'CNY')$$,'a leader can create a growth campaign');
select lives_ok($$insert into public.lead_attribution_touches(lead_id,campaign_id,touch_type,channel,source) values('98300000-0000-4000-8000-000000000001',(select id from public.growth_campaigns where code='V220-CAMPAIGN'),'FIRST','REFERRAL','PARTNER')$$,'a lead can receive a governed attribution touch');
select is(((public.growth_snapshot()->'campaigns'->0->>'touches')::integer),1,'growth snapshot reports campaign touches');
select is(((public.growth_performance_snapshot()->'summary'->>'activeCampaigns')::integer),1,'growth performance reports active campaigns');
select is(((public.growth_performance_snapshot()->'summary'->>'attributedLeads')::integer),1,'growth performance reports attributed leads');

select lives_ok($$select public.create_guardian_portal_invitation('98200000-0000-4000-8000-000000000001','guardian-v220@example.test',repeat('a',64),now()+interval '1 day')$$,'staff can create a verified digest-only portal invitation');
reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select is((public.service_portal_snapshot(repeat('a',64))->'household'->>'id'),'98200000-0000-4000-8000-000000000001','the service resolves only the invited household');
select is((public.service_portal_snapshot(repeat('a',64))->>'consentRequired')::boolean,true,'the portal withholds household data before consent');
select throws_ok($$select public.service_submit_portal_update(repeat('a',64),'v220-update-request','{"address":"New address"}')$$,'portal_consent_required','a public update cannot bypass access consent');
select lives_ok($$select public.service_accept_portal_consent(repeat('a',64),'v220-consent','terms-v1','privacy-v1')$$,'the portal records explicit consent');
select is((public.service_portal_snapshot(repeat('a',64))->>'consentRequired')::boolean,false,'the consented portal releases its scoped snapshot');
select ok(public.service_submit_portal_update(repeat('a',64),'v220-update-request','{"address":"New address"}') is not null,'the portal can submit a review request');
reset role;
select is((select count(*)::integer from public.portal_update_requests where status='PENDING'),1,'portal updates remain pending for staff review');
select set_config('request.jwt.claims','{"sub":"98000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}',true);
set local role authenticated;
select lives_ok($$select public.decide_portal_update((select id from public.portal_update_requests where status='PENDING'),'APPROVED','Verified guardian correction')$$,'an authorised decision applies supported portal changes');
select is((select address from public.households where id='98200000-0000-4000-8000-000000000001'),'New address','approved address changes update the household master');
select is((select applied_changes->>'address' from public.portal_update_requests limit 1),'New address','the decision records exactly what was applied');

select lives_ok($$insert into public.privacy_requests(id,requester_contact_id,request_type,request_note,requested_changes) values('98400000-0000-4000-8000-000000000001','98100000-0000-4000-8000-000000000001','CORRECTION','Correct the verified phone number','{"phone":"+886900000000"}')$$,'a correction request records explicit changes');
select lives_ok($$select public.manage_privacy_request('98400000-0000-4000-8000-000000000001','IDENTITY_REVIEW','PENDING','Begin identity review')$$,'privacy request enters identity review');
select lives_ok($$select public.manage_privacy_request('98400000-0000-4000-8000-000000000001','IN_PROGRESS','VERIFIED','Identity evidence verified')$$,'verified privacy request enters processing');
select lives_ok($$select public.manage_privacy_request('98400000-0000-4000-8000-000000000001','FULFILLED','VERIFIED','Apply verified correction')$$,'fulfillment executes the requested correction');
select is((select status from public.privacy_requests where id='98400000-0000-4000-8000-000000000001'),'FULFILLED','privacy status closes only after execution');
select is((select status from public.privacy_executions where request_id='98400000-0000-4000-8000-000000000001'),'COMPLETED','privacy execution records completion');
select is((select length(receipt_sha256) from public.privacy_executions where request_id='98400000-0000-4000-8000-000000000001'),64,'privacy execution emits a SHA-256 receipt');

select lives_ok($$insert into public.privacy_requests(id,requester_contact_id,request_type,request_note) values('98400000-0000-4000-8000-000000000003','98100000-0000-4000-8000-000000000001','ACCESS','Provide access to the verified data subject record')$$,'an access request records its scope');
select lives_ok($$select public.manage_privacy_request('98400000-0000-4000-8000-000000000003','IDENTITY_REVIEW','PENDING','Begin access identity review')$$,'access request enters identity review');
select lives_ok($$select public.manage_privacy_request('98400000-0000-4000-8000-000000000003','IN_PROGRESS','VERIFIED','Access identity verified')$$,'verified access request enters processing');
select lives_ok($$select public.manage_privacy_request('98400000-0000-4000-8000-000000000003','FULFILLED','VERIFIED','Queue verified access package')$$,'access fulfillment queues a private package');
select is((select status from public.privacy_requests where id='98400000-0000-4000-8000-000000000003'),'EXECUTING','access remains executing until its private artifact exists');

select lives_ok($$insert into public.privacy_requests(id,requester_contact_id,request_type,request_note) values('98400000-0000-4000-8000-000000000004','98100000-0000-4000-8000-000000000001','RESTRICTION','Restrict marketing, export, and communication processing')$$,'a restriction request records explicit scope');
select lives_ok($$select public.manage_privacy_request('98400000-0000-4000-8000-000000000004','IDENTITY_REVIEW','PENDING','Begin restriction identity review')$$,'restriction request enters identity review');
select lives_ok($$select public.manage_privacy_request('98400000-0000-4000-8000-000000000004','IN_PROGRESS','VERIFIED','Restriction identity verified')$$,'verified restriction enters processing');
select lives_ok($$select public.manage_privacy_request('98400000-0000-4000-8000-000000000004','FULFILLED','VERIFIED','Apply requested processing restriction')$$,'restriction fulfillment applies operational controls');
select ok((select active from public.privacy_restrictions where request_id='98400000-0000-4000-8000-000000000004'),'restriction execution creates an active control');
select ok((select do_not_contact from public.contacts where id='98100000-0000-4000-8000-000000000001'),'restriction immediately blocks direct contact');

select lives_ok($$insert into public.privacy_requests(id,requester_contact_id,request_type,request_note) values('98400000-0000-4000-8000-000000000002','98100000-0000-4000-8000-000000000001','EXPORT','Export the verified data subject record')$$,'an export request records its requested scope');
select lives_ok($$select public.manage_privacy_request('98400000-0000-4000-8000-000000000002','IDENTITY_REVIEW','PENDING','Begin export identity review')$$,'export request enters identity review');
select lives_ok($$select public.manage_privacy_request('98400000-0000-4000-8000-000000000002','IN_PROGRESS','VERIFIED','Export identity verified')$$,'verified export request enters processing');
select lives_ok($$select public.manage_privacy_request('98400000-0000-4000-8000-000000000002','WAITING_APPROVAL','VERIFIED','Request independent export review')$$,'export waits for an independent reviewer');
select set_config('request.jwt.claims','{"sub":"98000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}',true);
select lives_ok($$select public.manage_privacy_request('98400000-0000-4000-8000-000000000002','FULFILLED','VERIFIED','Independent reviewer queued verified export')$$,'export fulfillment queues the execution instead of closing early');
select is((select status from public.privacy_requests where id='98400000-0000-4000-8000-000000000002'),'EXECUTING','queued export remains executing until an artifact exists');
reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select lives_ok($$update public.generated_jobs set status='READY' where privacy_request_id='98400000-0000-4000-8000-000000000002'$$,'the export worker can mark the artifact ready');
select lives_ok($$select public.complete_privacy_export_execution(
  '98400000-0000-4000-8000-000000000002',
  (select id from public.generated_jobs where privacy_request_id='98400000-0000-4000-8000-000000000002'),
  'privacy/98400000-0000-4000-8000-000000000002.xlsx',now()+interval '15 minutes',1,repeat('a',64)
)$$,'the export worker completes an artifact without an ambiguous expiry assignment');
reset role;
select is((select status from public.privacy_requests where id='98400000-0000-4000-8000-000000000002'),'FULFILLED','export request closes only after artifact completion');
select ok((select artifact_expires_at is not null from public.privacy_executions where request_id='98400000-0000-4000-8000-000000000002'),'export execution persists the artifact expiry');

select set_config('request.jwt.claims','{"sub":"98000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}',true);
set local role authenticated;
select lives_ok($$insert into public.privacy_requests(id,requester_contact_id,request_type,request_note) values('98400000-0000-4000-8000-000000000005','98100000-0000-4000-8000-000000000001','DELETION','Delete non-retained personal data and preserve legal evidence')$$,'a deletion request records its legal scope');
select lives_ok($$select public.manage_privacy_request('98400000-0000-4000-8000-000000000005','IDENTITY_REVIEW','PENDING','Begin deletion identity review')$$,'deletion request enters identity review');
select lives_ok($$select public.manage_privacy_request('98400000-0000-4000-8000-000000000005','IN_PROGRESS','VERIFIED','Deletion identity verified')$$,'verified deletion enters processing');
select lives_ok($$select public.manage_privacy_request('98400000-0000-4000-8000-000000000005','WAITING_APPROVAL','VERIFIED','Request independent deletion review')$$,'deletion waits for an independent reviewer');
select set_config('request.jwt.claims','{"sub":"98000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}',true);
select lives_ok($$select public.manage_privacy_request('98400000-0000-4000-8000-000000000005','FULFILLED','VERIFIED','Independent reviewer approved deletion')$$,'a different reviewer can execute approved deletion');
select is((select name_en from public.contacts where id='98100000-0000-4000-8000-000000000001'),'Deleted contact','deletion anonymizes the contact master');
select ok((select legal_hold<> '{}'::jsonb from public.privacy_executions where request_id='98400000-0000-4000-8000-000000000005'),'deletion preserves an explicit legal-hold manifest');
select is((select length(receipt_sha256) from public.privacy_executions where request_id='98400000-0000-4000-8000-000000000005'),64,'deletion leaves an immutable execution receipt');

reset role;
insert into public.data_quality_issues(workspace_id,rule_key,entity_type,entity_id,severity,title_key,details)
values('00000000-0000-4000-8000-000000000001','V220_TEST','CONTACT','98100000-0000-4000-8000-000000000001','HIGH','quality.test','{}');
select ok(exists(select 1 from public.data_quality_daily_snapshots where workspace_id='00000000-0000-4000-8000-000000000001' and snapshot_date=current_date),'quality mutations capture a daily snapshot');
select ok((select open_high from public.data_quality_daily_snapshots where workspace_id='00000000-0000-4000-8000-000000000001' and snapshot_date=current_date)>=1,'quality trend includes open high-severity issues');
select set_config('request.jwt.claims','{"sub":"98000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}',true);
set local role authenticated;
select is((select count(*)::integer from public.data_quality_rule_configs where workspace_id='00000000-0000-4000-8000-000000000001'),8,'every workspace receives the expanded quality rules');
select lives_ok($$select public.configure_data_quality_rule('LEAD_ATTRIBUTION_MISSING',false,'LOW')$$,'quality leaders can configure a rule');
select is((select severity from public.data_quality_rule_configs where rule_key='LEAD_ATTRIBUTION_MISSING'),'LOW','quality rule severity is persisted');
select lives_ok($$select public.assign_data_quality_issue((select id from public.data_quality_issues where rule_key='V220_TEST'),'98000000-0000-4000-8000-000000000001')$$,'a quality issue can be assigned to an active member');
select is((select status from public.data_quality_issues where rule_key='V220_TEST'),'ASSIGNED','assigned quality issues carry an owned status');
reset role;
select ok(
  (public.service_readiness_snapshot_for_workers('00000000-0000-4000-8000-000000000001',array['REMINDERS'])->>'missingWorkers')::integer
  <=(public.service_readiness_snapshot_for_workers('00000000-0000-4000-8000-000000000001',array['REMINDERS','NOTIFICATION_OUTBOX','CALENDAR_DELIVERIES','GENERATED_JOBS','WEBHOOK_INBOX','INTEGRATION_SYNC'])->>'missingWorkers')::integer,
  'disabled optional workers cannot increase the readiness blocker count'
);
select lives_ok($$select public.sales_performance_report_v220('quarter','all','CNY')$$,'sales performance accepts an explicit currency');

select * from finish();
rollback;
