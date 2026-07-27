begin;
select plan(4);

select ok(
  exists(
    select 1
    from pg_constraint
    where conrelid = 'public.user_preferences'::regclass
      and conname = 'user_preferences_timezone_valid'
      and contype = 'c'
  ),
  'user preferences enforce the supported timezone set'
);

select lives_ok(
  $$insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
    values('00000000-0000-0000-0000-000000000000','99600000-0000-4000-8000-000000000001','authenticated','authenticated','v260.timezone@example.test',crypt('TestPassword1!',gen_salt('bf')),now(),'{}','{}',now(),now())$$,
  'a v2.6 timezone contract identity can be created'
);

select lives_ok(
  $$insert into public.user_preferences(user_id,workspace_id,timezone)
    values('99600000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001','Europe/London')$$,
  'a supported timezone can be stored'
);

select throws_ok(
  $$update public.user_preferences
    set timezone='Mars/Olympus'
    where user_id='99600000-0000-4000-8000-000000000001'$$,
  '23514',
  null,
  'an unsupported timezone is rejected by the database'
);

select * from finish();
rollback;
