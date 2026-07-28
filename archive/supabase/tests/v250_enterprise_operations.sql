begin;
select plan(27);

select has_table('public','enterprise_directory_users','enterprise directory lifecycle is durable');
select has_table('public','connector_validation_receipts','connector validation evidence is durable');
select has_column('public','enterprise_directory_users','auth_user_id','directory users bind to the real SSO identity');
select has_column('public','enterprise_directory_users','external_id','directory users retain the provider identifier');
select has_column('public','enterprise_directory_users','role','directory users carry a bounded staff role');
select has_column('public','enterprise_directory_users','version','directory updates carry an ETag version');
select has_column('public','connector_validation_receipts','response_digest','validation evidence stores a response digest');
select has_column('public','connector_validation_receipts','expires_at','validation evidence has an explicit expiry');
select has_column('public','connector_validation_receipts','duration_ms','validation evidence records bounded adapter latency');
select ok((select relrowsecurity from pg_class where oid='public.enterprise_directory_users'::regclass),'enterprise directory enforces RLS');
select ok((select relrowsecurity from pg_class where oid='public.connector_validation_receipts'::regclass),'connector validation evidence enforces RLS');
select ok(has_table_privilege('service_role','public.enterprise_directory_users','SELECT,INSERT,UPDATE'),'SCIM service can stage and update directory users');
select ok(not has_table_privilege('service_role','public.enterprise_directory_users','DELETE'),'SCIM service deprovisions instead of deleting directory evidence');
select ok(not has_table_privilege('authenticated','public.enterprise_directory_users','INSERT,UPDATE,DELETE'),'browser sessions cannot mutate directory lifecycle');
select ok(has_table_privilege('service_role','public.connector_validation_receipts','SELECT,INSERT'),'connector service can append validation evidence');
select ok(not has_table_privilege('service_role','public.connector_validation_receipts','UPDATE'),'validation receipts are immutable to the service');
select ok(not has_table_privilege('service_role','public.connector_validation_receipts','DELETE'),'validation receipts cannot be deleted by the service');
select ok(not has_table_privilege('authenticated','public.connector_validation_receipts','INSERT'),'browser sessions cannot forge validation evidence');

select throws_ok($$insert into public.enterprise_directory_users(workspace_id,external_id,user_name,display_name_en,role) values('00000000-0000-4000-8000-000000000001','v250-admin','admin@example.test','Admin','ADMIN')$$,'23514',null,'SCIM cannot grant an administrator role');
select lives_ok($$insert into public.enterprise_directory_users(workspace_id,external_id,user_name,display_name_zh,display_name_en,role,team) values('00000000-0000-4000-8000-000000000001','v250-sales','sales@example.test','企业销售','Enterprise Sales','SALES_SPECIALIST','Enterprise')$$,'a bounded sales identity can be staged');
select throws_ok($$insert into public.enterprise_directory_users(workspace_id,external_id,user_name,display_name_en,role) values('00000000-0000-4000-8000-000000000001','v250-sales','other@example.test','Duplicate external ID','SALES_SUPPORT')$$,'23505',null,'external directory identifiers are unique per workspace');
select throws_ok($$insert into public.connector_validation_receipts(workspace_id,provider,status,response_digest,duration_ms,expires_at) values('00000000-0000-4000-8000-000000000001','UNKNOWN','SUCCEEDED',repeat('a',64),125,now()+interval '1 day')$$,'23514',null,'unknown connector providers cannot produce receipts');
select lives_ok($$insert into public.connector_validation_receipts(workspace_id,provider,status,response_digest,capabilities,duration_ms,expires_at) values('00000000-0000-4000-8000-000000000001','PAYMENT','SUCCEEDED',repeat('a',64),'["validate"]',125,now()+interval '1 day')$$,'a successful connector validation receipt is append-only evidence');
select throws_ok($$insert into public.connector_validation_receipts(workspace_id,provider,status,duration_ms,expires_at) values('00000000-0000-4000-8000-000000000001','EMAIL','SUCCEEDED',125,now()+interval '1 day')$$,'23514',null,'a successful validation requires a SHA-256 response digest');

select lives_ok($$insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values('00000000-0000-0000-0000-000000000000','99000000-0000-4000-8000-000000000001','authenticated','authenticated','sso.user@example.test',crypt('TestPassword1!',gen_salt('bf')),now(),'{}','{}',now(),now())$$,'an SSO identity without application metadata can be created');
select ok(exists(select 1 from public.user_profiles where user_id='99000000-0000-4000-8000-000000000001'),'SSO identity creation derives a CRM profile');
select ok((select username::text ~ '^[a-z][a-z0-9._-]{2,31}$' from public.user_profiles where user_id='99000000-0000-4000-8000-000000000001'),'derived SSO username satisfies the stable profile contract');
select * from finish();
rollback;
