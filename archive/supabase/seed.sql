-- Local acceptance data only. Production environments start empty except for the five default products.
do $$
declare
  ws constant uuid := '00000000-0000-4000-8000-000000000001';
  actor uuid;
  org_taipei constant uuid := '10000000-0000-4000-8000-000000000001';
  org_shanghai constant uuid := '10000000-0000-4000-8000-000000000002';
  org_singapore constant uuid := '10000000-0000-4000-8000-000000000003';
  product_admission uuid;
  contract_taipei constant uuid := '30000000-0000-4000-8000-000000000001';
begin
  select user_id into actor from public.workspace_memberships where workspace_id=ws and status='ACTIVE' order by created_at limit 1;
  if actor is null then raise notice 'No CRM staff account exists; skipping local seed.'; return; end if;

  insert into public.organizations(id,workspace_id,name_zh,name_en,city,curriculum,status,owner_id,key_contact_coverage,completeness,last_contact_at,created_by)
  values
  (org_taipei,ws,'台北欧洲学校','Taipei European School','台北','IB / A-Level','ATTENTION',actor,50,78,now()-interval '2 days',actor),
  (org_shanghai,ws,'上海惠灵顿外籍人员子女学校','Wellington College International Shanghai','上海','IB / IGCSE','HEALTHY',actor,83,92,now()-interval '4 hours',actor),
  (org_singapore,ws,'新加坡美国学校','Singapore American School','新加坡','AP','HEALTHY',actor,100,96,now()-interval '1 day',actor)
  on conflict (id) do update set name_zh=excluded.name_zh,name_en=excluded.name_en,updated_at=now();

  insert into public.contacts(id,workspace_id,organization_id,name_zh,name_en,contact_type,email,title,status,owner_id,completeness,last_interaction_at,created_by)
  values
  ('20000000-0000-4000-8000-000000000001',ws,org_taipei,'王若晴','Rachel Wang','SCHOOL_STAFF','rachel.wang@tes.example','升学指导主任','ACTIVE',actor,94,now(),actor),
  ('20000000-0000-4000-8000-000000000002',ws,org_shanghai,'李映雪','Iris Li','SCHOOL_STAFF','iris.li@wellington.example','招生主任','ACTIVE',actor,91,now()-interval '1 day',actor),
  ('20000000-0000-4000-8000-000000000003',ws,null,'周子谦','Leo Chou','PARENT','leo.chou@example.com','付款人','FOLLOW_UP',actor,82,now()-interval '3 days',actor)
  on conflict (id) do update set name_zh=excluded.name_zh,name_en=excluded.name_en,updated_at=now();

  insert into public.crm_tasks(id,workspace_id,title_zh,title_en,related_type,related_id,related_label,status,priority,owner_id,due_at,created_by)
  values
  ('21000000-0000-4000-8000-000000000001',ws,'台北欧洲学校续约回访','Taipei European School renewal follow-up','ORGANIZATION',org_taipei,'台北欧洲学校 / Taipei European School','IN_PROGRESS','HIGH',actor,now()+interval '1 day',actor),
  ('21000000-0000-4000-8000-000000000002',ws,'复核新加坡美国学校消费报告','Review Singapore American School consumption report','ORGANIZATION',org_singapore,'新加坡美国学校 / Singapore American School','TODO','NORMAL',actor,now()+interval '3 days',actor)
  on conflict (id) do update set title_zh=excluded.title_zh,title_en=excluded.title_en,updated_at=now();

  insert into public.sales_team_members(id,workspace_id,auth_user_id,name_zh,name_en,role,team)
  values
  ('40000000-0000-4000-8000-000000000001',ws,null,'郑宇翔','Alex Cheng','SALES_SPECIALIST','上海销售团队'),
  ('40000000-0000-4000-8000-000000000002',ws,null,'陈芷涵','Hannah Chen','SALES_SUPPORT','上海销售团队'),
  ('40000000-0000-4000-8000-000000000003',ws,null,'刘思妤','Grace Liu','SALES_SPECIALIST','上海销售团队'),
  ('40000000-0000-4000-8000-000000000004',ws,null,'何雨乔','Mia Ho','SALES_SUPPORT','上海销售团队')
  on conflict (id) do update set name_zh=excluded.name_zh,name_en=excluded.name_en,active=true;

  select id into product_admission from public.products where workspace_id=ws and code='ADMISSION';
  insert into public.contracts(id,workspace_id,contract_number,organization_id,product_id,start_date,end_date,currency,contract_value,status,relationship_level,owner_id,signed_at,created_by)
  values(contract_taipei,ws,'LUM-2025-TES-001',org_taipei,product_admission,current_date-interval '11 months',current_date+interval '18 days','CNY',680000,'NEGOTIATING',4,actor,now()-interval '11 months',actor)
  on conflict (id) do update set end_date=excluded.end_date,contract_value=excluded.contract_value,updated_at=now();

  insert into public.payments(id,workspace_id,contract_id,product_id,amount,currency,status,paid_at,reference,verified_by)
  values('31000000-0000-4000-8000-000000000001',ws,contract_taipei,product_admission,340000,'CNY','CONFIRMED',date_trunc('month',now())+interval '5 days','LOCAL-TES-2026-01',actor)
  on conflict (id) do nothing;

  insert into public.appointments(id,workspace_id,title_zh,title_en,appointment_type,related_type,related_id,starts_at,ends_at,owner_id,reminder_minutes,created_by)
  values('50000000-0000-4000-8000-000000000001',ws,'台北欧洲学校续约会','Taipei European School renewal meeting','MEETING','ORGANIZATION',org_taipei,now()+interval '2 days',now()+interval '2 days 1 hour',actor,'{1440,60}',actor)
  on conflict (id) do update set starts_at=excluded.starts_at,ends_at=excluded.ends_at,updated_at=now();
end $$;
