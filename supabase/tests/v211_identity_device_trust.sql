begin;
select plan(15);

select has_table('public','trusted_login_devices','trusted login devices are durable');
select ok(
  (select relrowsecurity from pg_class where oid='public.trusted_login_devices'::regclass),
  'trusted login devices enforce RLS'
);
select ok(
  not has_table_privilege('authenticated','public.trusted_login_devices','SELECT'),
  'browser sessions cannot read device token hashes'
);
select ok(
  has_table_privilege('service_role','public.trusted_login_devices','SELECT,INSERT,UPDATE,DELETE'),
  'the identity service has narrow trusted-device table privileges'
);
select ok(
  has_function_privilege('service_role','public.service_register_trusted_login_device(uuid,uuid,text,text,timestamp with time zone)','EXECUTE'),
  'the identity service can register a verified device'
);
select ok(
  not has_function_privilege('authenticated','public.service_register_trusted_login_device(uuid,uuid,text,text,timestamp with time zone)','EXECUTE'),
  'staff sessions cannot forge trusted devices'
);
select ok(
  has_function_privilege('service_role','public.service_consume_trusted_login_device(uuid,uuid,text)','EXECUTE'),
  'the identity service can validate a presented device secret'
);
select ok(
  not has_function_privilege('authenticated','public.service_consume_trusted_login_device(uuid,uuid,text)','EXECUTE'),
  'staff sessions cannot validate token hashes directly'
);
select ok(
  has_function_privilege('authenticated','public.list_current_user_trusted_login_devices()','EXECUTE'),
  'staff can list only their own trusted-device metadata'
);
select ok(
  has_function_privilege('authenticated','public.revoke_current_user_trusted_login_device(uuid)','EXECUTE'),
  'staff can revoke one of their own trusted devices'
);
select ok(
  pg_get_functiondef('public.current_crm_role()'::regprocedure) not like '%SALES_DIRECTOR%SALES_MANAGER%',
  'sales roles are no longer forced through the administrator MFA gate'
);
select ok(
  pg_get_functiondef('public.current_crm_role()'::regprocedure) like '%SUPER_ADMIN%ADMIN%',
  'administrator roles still require AAL2 in database authorization'
);
select ok(
  pg_get_functiondef('public.service_consume_trusted_login_device(uuid,uuid,text)'::regprocedure)
    like '%expires_at>now()%',
  'trusted devices are rejected after expiry'
);
select ok(
  pg_get_functiondef('public.service_register_trusted_login_device(uuid,uuid,text,text,timestamp with time zone)'::regprocedure)
    like '%TRUSTED_DEVICE_REGISTERED%',
  'device registration creates an audit event'
);
select ok(
  pg_get_functiondef('public.admin_dashboard_metrics()'::regprocedure)
    not like '%SALES_DIRECTOR%SALES_MANAGER%',
  'mandatory-MFA metrics count administrators only'
);

select * from finish();
rollback;
