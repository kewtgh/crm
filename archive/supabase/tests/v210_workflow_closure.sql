begin;
select plan(38);

select has_table('public','grade_progression_rules','grade progression rules are configurable records');
select has_column('public','opportunities','household_id','opportunities support household subjects');
select is(
  (select count(*)::integer from pg_constraint where conname in (
    'household_members_workspace_household_fk','household_members_workspace_contact_fk',
    'students_workspace_person_fk','students_workspace_household_fk',
    'student_guardians_workspace_student_fk','student_guardians_workspace_contact_fk',
    'student_academics_workspace_student_fk','student_academics_workspace_school_fk',
    'progression_items_workspace_batch_fk','progression_items_workspace_student_fk',
    'leads_workspace_organization_fk','leads_workspace_household_fk',
    'lead_conversions_workspace_lead_fk','lead_conversions_workspace_opportunity_fk'
  )),
  14,
  'education and acquisition relationships have workspace-scoped foreign keys'
);
select ok(
  not exists(select 1 from pg_constraint where conname in (
    'household_members_workspace_household_fk','household_members_workspace_contact_fk',
    'students_workspace_person_fk','students_workspace_household_fk',
    'student_guardians_workspace_student_fk','student_guardians_workspace_contact_fk',
    'student_academics_workspace_student_fk','student_academics_workspace_school_fk',
    'progression_items_workspace_batch_fk','progression_items_workspace_student_fk',
    'leads_workspace_organization_fk','leads_workspace_household_fk',
    'lead_conversions_workspace_lead_fk','lead_conversions_workspace_opportunity_fk'
  ) and not convalidated),
  'workspace-scoped foreign keys are validated'
);
select ok(
  has_function_privilege('authenticated','public.save_progression_rule(uuid,text,text,text,boolean)','EXECUTE'),
  'authenticated leaders can invoke guarded progression-rule maintenance'
);
select ok(
  not has_function_privilege('anon','public.save_progression_rule(uuid,text,text,text,boolean)','EXECUTE'),
  'anonymous sessions cannot maintain progression rules'
);
select is(
  (select to_grade from public.grade_progression_rules
   where workspace_id='00000000-0000-4000-8000-000000000001'
     and lower(from_grade)='g5' and active),
  'G6',
  'default progression mappings are seeded safely'
);

insert into auth.users(
  instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) values
(
  '00000000-0000-0000-0000-000000000000',
  '99000000-0000-4000-8000-000000000001','authenticated','authenticated',
  'v210-manager@example.test',crypt('TestPassword1!',gen_salt('bf')),now(),
  '{"role":"SALES_MANAGER","account_status":"ACTIVE","workspace_id":"00000000-0000-4000-8000-000000000001"}',
  '{"username":"v210.manager","chinese_name":"闭环经理","english_name":"Closure Manager"}',
  now(),now()
),(
  '00000000-0000-0000-0000-000000000000',
  '99000000-0000-4000-8000-000000000002','authenticated','authenticated',
  'v210-support@example.test',crypt('TestPassword1!',gen_salt('bf')),now(),
  '{"role":"SALES_SUPPORT","account_status":"ACTIVE","workspace_id":"00000000-0000-4000-8000-000000000001"}',
  '{"username":"v210.support","chinese_name":"闭环支持","english_name":"Closure Support"}',
  now(),now()
);

insert into public.contacts(
  id,workspace_id,name_zh,name_en,contact_type,status,owner_id,created_by
) values
('99100000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001','映射学生','Mapped Student','STUDENT','ACTIVE','99000000-0000-4000-8000-000000000001','99000000-0000-4000-8000-000000000001'),
('99100000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001','自定义学生','Custom Student','STUDENT','ACTIVE','99000000-0000-4000-8000-000000000001','99000000-0000-4000-8000-000000000001'),
('99100000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000001','第一家长','First Parent','PARENT','ACTIVE','99000000-0000-4000-8000-000000000001','99000000-0000-4000-8000-000000000001'),
('99100000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000001','第二家长','Second Parent','PARENT','ACTIVE','99000000-0000-4000-8000-000000000001','99000000-0000-4000-8000-000000000001');

insert into public.households(
  id,workspace_id,name_zh,name_en,address,owner_id,created_by
) values(
  '99200000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001',
  '闭环家庭','Closure Household','Taipei','99000000-0000-4000-8000-000000000001',
  '99000000-0000-4000-8000-000000000001'
);

insert into public.students(
  id,workspace_id,person_id,household_id,student_number,current_grade,academic_year,status,owner_id,created_by
) values
('99300000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001','99100000-0000-4000-8000-000000000001','99200000-0000-4000-8000-000000000001','V210-1','G5','2025-2026','ACTIVE','99000000-0000-4000-8000-000000000001','99000000-0000-4000-8000-000000000001'),
('99300000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001','99100000-0000-4000-8000-000000000002','99200000-0000-4000-8000-000000000001','V210-2','Studio','2025-2026','ACTIVE','99000000-0000-4000-8000-000000000001','99000000-0000-4000-8000-000000000001');

insert into public.student_academic_records(
  workspace_id,student_id,curriculum,grade,academic_year,valid_from,status,created_by
) values(
  '00000000-0000-4000-8000-000000000001','99300000-0000-4000-8000-000000000001',
  'IB','G5','2025-2026',current_date-90,'CURRENT','99000000-0000-4000-8000-000000000001'
);

insert into public.leads(
  id,workspace_id,subject_type,household_id,name_zh,name_en,source,status,
  qualification_score,qualification_note,pipeline_key,owner_id,created_by
) values(
  '99400000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001',
  'HOUSEHOLD','99200000-0000-4000-8000-000000000001','闭环家庭线索','Closure household lead',
  'REFERRAL','QUALIFIED',88,'Confirmed need','HOUSEHOLD_DEFAULT',
  '99000000-0000-4000-8000-000000000001','99000000-0000-4000-8000-000000000001'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"99000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}',
  true
);
set local role authenticated;
select is(
  (select count(*)::integer from public.leads where id='99400000-0000-4000-8000-000000000001'),
  1,
  'sales support can read leads exposed by its capability'
);

reset role;
select set_config(
  'request.jwt.claims',
  '{"sub":"99000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}',
  true
);
set local role authenticated;

select lives_ok(
  $$select public.preview_student_progression('2025-2026','2026-2027','v210-preview-key')$$,
  'a manager can create a safe progression preview'
);
select is(
  (select status from public.progression_batches where idempotency_key='v210-preview-key'),
  'PREVIEWED',
  'the progression batch awaits review'
);
select is(
  (select to_grade||':'||action||':'||selected::text
   from public.progression_batch_items where student_id='99300000-0000-4000-8000-000000000001'),
  'G6:ADVANCE:true',
  'a mapped grade previews the configured advancement'
);
select is(
  (select to_grade||':'||action||':'||selected::text
   from public.progression_batch_items where student_id='99300000-0000-4000-8000-000000000002'),
  'Studio:HOLD:false',
  'an unknown grade is held instead of guessed'
);
select lives_ok(
  $$select public.update_progression_batch_item(
    (select id from public.progression_batch_items where student_id='99300000-0000-4000-8000-000000000002'),
    true,'Studio 2','ADVANCE','Approved custom progression'
  )$$,
  'a manager can explicitly review and include a held item'
);
select lives_ok(
  $$select public.apply_student_progression(
    (select id from public.progression_batches where idempotency_key='v210-preview-key'),
    'v210-apply-key'
  )$$,
  'application uses a separate idempotency key from preview'
);
select is(
  (select status from public.progression_batches where idempotency_key='v210-preview-key'),
  'APPLIED',
  'the fully successful batch closes as applied'
);
select is(
  (select current_grade from public.students where id='99300000-0000-4000-8000-000000000001'),
  'G6',
  'the mapped student advances exactly once'
);
select is(
  (select current_grade from public.students where id='99300000-0000-4000-8000-000000000002'),
  'Studio 2',
  'the manually reviewed student uses the approved destination'
);
select is(
  (select status from public.student_academic_records
   where student_id='99300000-0000-4000-8000-000000000001' and academic_year='2025-2026'),
  'COMPLETED',
  'the previous current academic snapshot is closed'
);
select is(
  (select count(*)::integer from public.student_academic_records
   where student_id in ('99300000-0000-4000-8000-000000000001','99300000-0000-4000-8000-000000000002')
     and academic_year='2026-2027' and status='CURRENT'),
  2,
  'new current academic snapshots are created for applied students'
);
select lives_ok(
  $$select public.apply_student_progression(
    (select id from public.progression_batches where idempotency_key='v210-preview-key'),
    'a-different-safe-retry-key'
  )$$,
  'a retry returns the already-closed batch without reapplying'
);
select is(
  (select count(*)::integer from public.student_academic_records
   where student_id in ('99300000-0000-4000-8000-000000000001','99300000-0000-4000-8000-000000000002')),
  3,
  'a retry does not duplicate academic snapshots'
);

select lives_ok(
  $$select public.convert_lead_to_opportunity(
    '99400000-0000-4000-8000-000000000001','家庭商机','Household opportunity',12000,'CNY','v210-household-convert'
  )$$,
  'a qualified household lead converts successfully'
);
select is(
  (select subject_type from public.opportunities where household_id='99200000-0000-4000-8000-000000000001'),
  'HOUSEHOLD',
  'the opportunity retains its household subject type'
);
select is(
  (select household_id from public.opportunities where title_en='Household opportunity'),
  '99200000-0000-4000-8000-000000000001'::uuid,
  'the converted opportunity references the household'
);
select is(
  (select organization_id from public.opportunities where title_en='Household opportunity'),
  null,
  'a household opportunity does not carry a school organization'
);
select lives_ok(
  $$select public.convert_lead_to_opportunity(
    '99400000-0000-4000-8000-000000000001','家庭商机','Household opportunity',12000,'CNY','v210-household-convert'
  )$$,
  'lead conversion is idempotent for the same request key'
);
select is(
  (select count(*)::integer from public.lead_conversions where lead_id='99400000-0000-4000-8000-000000000001'),
  1,
  'idempotent conversion creates one evidence record'
);

select lives_ok(
  $$select public.save_household_member(
    '99200000-0000-4000-8000-000000000001','99100000-0000-4000-8000-000000000003','PARENT',true
  )$$,
  'a household member can be saved'
);
select lives_ok(
  $$select public.save_household_member(
    '99200000-0000-4000-8000-000000000001','99100000-0000-4000-8000-000000000004','PAYER',true
  )$$,
  'a new primary household contact replaces the prior primary'
);
select is(
  (select count(*)::integer from public.household_members
   where household_id='99200000-0000-4000-8000-000000000001' and primary_contact),
  1,
  'a household has at most one primary contact'
);
select throws_ok(
  $$select public.remove_household_member(
    (select id from public.household_members
     where household_id='99200000-0000-4000-8000-000000000001' and primary_contact)
  )$$,
  'P0001','education_primary_replacement_required',
  'the current primary household contact requires a replacement before removal'
);
select lives_ok(
  $$select public.save_student_guardian(
    '99300000-0000-4000-8000-000000000001','99100000-0000-4000-8000-000000000003',
    'MOTHER',true,true,true
  )$$,
  'a student guardian relationship can be saved'
);
select is(
  (select primary_guardian::text||':'||emergency_contact::text||':'||legal_authority::text
   from public.student_guardian_relationships
   where student_id='99300000-0000-4000-8000-000000000001'),
  'true:true:true',
  'guardian responsibilities are persisted'
);
select throws_ok(
  $$select public.remove_student_guardian(
    (select id from public.student_guardian_relationships
     where student_id='99300000-0000-4000-8000-000000000001' and primary_guardian)
  )$$,
  'P0001','education_primary_replacement_required',
  'the current primary guardian requires a replacement before removal'
);
select ok(
  (select public.dashboard_snapshot(null) ?& array['newLeads','activeStudents','pendingProgression']),
  'the dashboard snapshot exposes acquisition and education signals'
);
select is(
  (select pipeline_key from public.opportunities where title_en='Household opportunity'),
  'HOUSEHOLD_DEFAULT',
  'household conversion uses the household pipeline'
);
select ok(
  pg_get_functiondef('public.apply_student_progression(uuid,text)'::regprocedure)
    ~ 'updated_at\s*=\s*item.student_updated_at',
  'progression application protects the preview with optimistic concurrency'
);
select ok(
  pg_get_functiondef('public.generate_rule_suggestions()'::regprocedure)
    like '%existing.owner_id=auth.uid()%',
  'suggestion generation deduplicates the current user inbox'
);

select * from finish();
rollback;
