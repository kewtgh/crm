-- Lumina CRM v2.0: capability-aligned MFA, exact catalog metrics,
-- education relationships, leads, privacy requests and auditable suggestions.

create or replace function public.current_crm_role()
returns text language sql stable security definer set search_path=public
as $$
  select coalesce((
    select upper(role) from public.workspace_memberships
    where user_id=auth.uid() and status='ACTIVE'
      and (
        upper(role) not in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER')
        or coalesce(auth.jwt()->>'aal','aal1')='aal2'
      )
    order by created_at limit 1
  ),'');
$$;

create or replace function public.is_workspace_member(target_workspace uuid)
returns boolean language sql stable security definer set search_path=public
as $$
  select exists(
    select 1 from public.workspace_memberships
    where workspace_id=target_workspace and user_id=auth.uid() and status='ACTIVE'
      and (
        upper(role) not in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER')
        or coalesce(auth.jwt()->>'aal','aal1')='aal2'
      )
  );
$$;

create or replace function public.current_workspace_id()
returns uuid language sql stable security definer set search_path=public
as $$
  select workspace_id from public.workspace_memberships
  where user_id=auth.uid() and status='ACTIVE'
    and (
      upper(role) not in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER')
      or coalesce(auth.jwt()->>'aal','aal1')='aal2'
    )
  order by created_at limit 1;
$$;

create or replace function public.product_catalog_snapshot()
returns jsonb language sql stable security definer set search_path=public
as $$
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id',p.id,'nameZh',p.name_zh,'nameEn',p.name_en,'code',p.code,
      'billing',p.billing_unit,'durationZh',p.duration_zh,'durationEn',p.duration_en,
      'active',p.active,'isDefault',p.is_default,
      'prices',coalesce(price_rows.items,'[]'::jsonb),
      'metrics',coalesce(metric_rows.items,'{}'::jsonb)
    ) order by p.is_default desc,p.name_en
  ),'[]'::jsonb)
  from public.products p
  left join lateral (
    select jsonb_agg(jsonb_build_object(
      'currency',pp.currency,'amount',pp.amount,'effectiveFrom',pp.effective_from
    ) order by case when pp.currency='CNY' then 0 else 1 end,pp.currency) items
    from public.product_prices pp
    where pp.product_id=p.id
      and pp.effective_from<=current_date
      and (pp.effective_to is null or pp.effective_to>=current_date)
  ) price_rows on true
  left join lateral (
    select jsonb_object_agg(m.currency,jsonb_build_object(
      'revenue',m.revenue,'customers',m.customers
    )) items
    from (
      select pay.currency,
        sum(greatest(pay.amount-coalesce(pay.refunded_amount,0),0)) revenue,
        count(distinct con.organization_id) customers
      from public.payments pay
      join public.contracts con on con.id=pay.contract_id
      where pay.workspace_id=p.workspace_id and pay.product_id=p.id and pay.status='CONFIRMED'
      group by pay.currency
    ) m
  ) metric_rows on true
  where p.workspace_id=public.current_workspace_id();
$$;
revoke all on function public.product_catalog_snapshot() from public,anon;
grant execute on function public.product_catalog_snapshot() to authenticated;

create table if not exists public.households (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default public.current_workspace_id() references public.workspaces(id),
  name_zh text not null,
  name_en text not null,
  status text not null default 'ACTIVE' check(status in ('ACTIVE','INACTIVE','ARCHIVED')),
  address text not null default '',
  owner_id uuid references auth.users(id),
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique(workspace_id,name_en)
);

create table if not exists public.household_members (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default public.current_workspace_id() references public.workspaces(id),
  household_id uuid not null references public.households(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  member_role text not null check(member_role in ('PARENT','GUARDIAN','STUDENT','PAYER','OTHER')),
  primary_contact boolean not null default false,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  unique(household_id,contact_id)
);

create table if not exists public.students (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default public.current_workspace_id() references public.workspaces(id),
  person_id uuid not null references public.contacts(id) on delete restrict,
  household_id uuid references public.households(id) on delete set null,
  student_number text,
  birth_date date,
  current_grade text not null default '',
  academic_year text not null default '',
  status text not null default 'ACTIVE' check(status in ('ACTIVE','ON_LEAVE','ALUMNI','WITHDRAWN','ARCHIVED')),
  owner_id uuid references auth.users(id),
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique(workspace_id,person_id),
  unique(workspace_id,student_number)
);

create table if not exists public.student_guardian_relationships (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default public.current_workspace_id() references public.workspaces(id),
  student_id uuid not null references public.students(id) on delete cascade,
  guardian_contact_id uuid not null references public.contacts(id) on delete restrict,
  relationship_type text not null check(relationship_type in ('MOTHER','FATHER','GUARDIAN','RELATIVE','OTHER')),
  primary_guardian boolean not null default false,
  emergency_contact boolean not null default false,
  legal_authority boolean not null default false,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  unique(student_id,guardian_contact_id)
);

create table if not exists public.student_academic_records (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default public.current_workspace_id() references public.workspaces(id),
  student_id uuid not null references public.students(id) on delete cascade,
  school_id uuid references public.organizations(id) on delete set null,
  curriculum text not null,
  grade text not null,
  academic_year text not null,
  valid_from date not null,
  valid_to date,
  status text not null default 'CURRENT' check(status in ('CURRENT','COMPLETED','PLANNED')),
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  check(valid_to is null or valid_to>=valid_from)
);

create table if not exists public.progression_batches (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default public.current_workspace_id() references public.workspaces(id),
  from_academic_year text not null,
  to_academic_year text not null,
  status text not null default 'DRAFT' check(status in ('DRAFT','PREVIEWED','APPLIED','CANCELLED')),
  idempotency_key text not null,
  previewed_at timestamptz,
  applied_at timestamptz,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  unique(workspace_id,idempotency_key)
);

create table if not exists public.progression_batch_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default public.current_workspace_id() references public.workspaces(id),
  batch_id uuid not null references public.progression_batches(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete restrict,
  from_grade text not null,
  to_grade text not null,
  action text not null check(action in ('ADVANCE','GRADUATE','HOLD')),
  selected boolean not null default true,
  status text not null default 'PENDING' check(status in ('PENDING','APPLIED','SKIPPED','FAILED')),
  error_code text,
  unique(batch_id,student_id)
);

create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default public.current_workspace_id() references public.workspaces(id),
  subject_type text not null check(subject_type in ('SCHOOL','HOUSEHOLD')),
  organization_id uuid references public.organizations(id) on delete set null,
  household_id uuid references public.households(id) on delete set null,
  name_zh text not null,
  name_en text not null,
  source text not null,
  source_detail text not null default '',
  status text not null default 'NEW' check(status in ('NEW','QUALIFYING','QUALIFIED','DISQUALIFIED','CONVERTED')),
  qualification_score smallint not null default 0 check(qualification_score between 0 and 100),
  qualification_note text not null default '',
  pipeline_key text not null,
  owner_id uuid not null default auth.uid() references auth.users(id),
  converted_at timestamptz,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check(
    (subject_type='SCHOOL' and organization_id is not null and household_id is null and pipeline_key='SCHOOL_DEFAULT')
    or (subject_type='HOUSEHOLD' and household_id is not null and organization_id is null and pipeline_key='HOUSEHOLD_DEFAULT')
  )
);

create table if not exists public.lead_conversions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default public.current_workspace_id() references public.workspaces(id),
  lead_id uuid not null unique references public.leads(id) on delete restrict,
  opportunity_id uuid not null references public.opportunities(id) on delete restrict,
  evidence jsonb not null default '{}'::jsonb,
  idempotency_key text not null,
  converted_by uuid not null default auth.uid() references auth.users(id),
  converted_at timestamptz not null default now(),
  unique(workspace_id,idempotency_key)
);

create table if not exists public.privacy_requests (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default public.current_workspace_id() references public.workspaces(id),
  requester_contact_id uuid references public.contacts(id) on delete set null,
  request_type text not null check(request_type in ('ACCESS','EXPORT','CORRECTION','RESTRICTION','DELETION')),
  status text not null default 'RECEIVED' check(status in ('RECEIVED','IDENTITY_REVIEW','IN_PROGRESS','WAITING_APPROVAL','FULFILLED','REJECTED','CANCELLED')),
  identity_status text not null default 'PENDING' check(identity_status in ('PENDING','VERIFIED','FAILED')),
  request_note text not null,
  decision_note text,
  due_at timestamptz not null default now()+interval '30 days',
  assigned_to uuid references auth.users(id),
  execution_task_id uuid references public.crm_tasks(id) on delete set null,
  fulfilled_at timestamptz,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.import_mapping_profiles (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default public.current_workspace_id() references public.workspaces(id),
  resource text not null,
  name text not null,
  mapping jsonb not null,
  owned_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(workspace_id,owned_by,resource,name)
);

create table if not exists public.ai_suggestion_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default public.current_workspace_id() references public.workspaces(id),
  engine text not null default 'RULES' check(engine in ('RULES','EXTERNAL')),
  model text not null default 'lumina-rules',
  rule_version text not null,
  prompt_version text,
  input_digest text not null,
  input_summary jsonb not null default '{}'::jsonb,
  status text not null default 'COMPLETED' check(status in ('RUNNING','COMPLETED','FAILED')),
  external_data_sent boolean not null default false,
  error_code text,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.ai_suggestions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default public.current_workspace_id() references public.workspaces(id),
  run_id uuid not null references public.ai_suggestion_runs(id) on delete cascade,
  subject_type text not null,
  subject_id uuid not null,
  recommendation_zh text not null,
  recommendation_en text not null,
  evidence jsonb not null default '[]'::jsonb,
  confidence numeric(4,3) not null check(confidence between 0 and 1),
  status text not null default 'OPEN' check(status in ('OPEN','ACCEPTED','EDITED','REJECTED','EXPIRED')),
  expires_at timestamptz not null default now()+interval '14 days',
  created_at timestamptz not null default now()
);

create table if not exists public.ai_suggestion_decisions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default public.current_workspace_id() references public.workspaces(id),
  suggestion_id uuid not null references public.ai_suggestions(id) on delete restrict,
  decision text not null check(decision in ('ACCEPTED','EDITED','REJECTED')),
  final_text_zh text,
  final_text_en text,
  reason text not null,
  task_id uuid references public.crm_tasks(id) on delete set null,
  idempotency_key text not null,
  decided_by uuid not null default auth.uid() references auth.users(id),
  decided_at timestamptz not null default now(),
  unique(workspace_id,idempotency_key)
);

create index if not exists students_workspace_status_idx on public.students(workspace_id,status,updated_at desc);
create index if not exists households_workspace_status_idx on public.households(workspace_id,status,updated_at desc);
create index if not exists leads_workspace_status_idx on public.leads(workspace_id,status,updated_at desc);
create index if not exists privacy_requests_due_idx on public.privacy_requests(workspace_id,status,due_at);
create index if not exists ai_suggestions_open_idx on public.ai_suggestions(workspace_id,status,expires_at);

do $$ declare table_name text; begin
  foreach table_name in array array[
    'households','household_members','students','student_guardian_relationships',
    'student_academic_records','progression_batches','progression_batch_items',
    'leads','lead_conversions','privacy_requests','import_mapping_profiles',
    'ai_suggestion_runs','ai_suggestions','ai_suggestion_decisions'
  ] loop
    execute format('alter table public.%I enable row level security',table_name);
    execute format('drop trigger if exists %I_audit on public.%I',table_name,table_name);
    execute format('create trigger %I_audit after insert or update or delete on public.%I for each row execute procedure public.audit_row_change()',table_name,table_name);
  end loop;
end $$;

create policy "education members read households" on public.households for select to authenticated
  using(public.is_workspace_member(workspace_id));
create policy "education members manage households" on public.households for all to authenticated
  using(public.is_workspace_member(workspace_id) and public.current_crm_role() in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER','SALES_SPECIALIST','SALES_SUPPORT'))
  with check(public.is_workspace_member(workspace_id) and public.current_crm_role() in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER','SALES_SPECIALIST','SALES_SUPPORT'));
create policy "education members read household members" on public.household_members for select to authenticated using(public.is_workspace_member(workspace_id));
create policy "education members manage household members" on public.household_members for all to authenticated using(public.is_workspace_member(workspace_id)) with check(public.is_workspace_member(workspace_id));
create policy "education members read students" on public.students for select to authenticated using(public.is_workspace_member(workspace_id));
create policy "education members manage students" on public.students for all to authenticated using(public.is_workspace_member(workspace_id)) with check(public.is_workspace_member(workspace_id));
create policy "education members read guardians" on public.student_guardian_relationships for select to authenticated using(public.is_workspace_member(workspace_id));
create policy "education members manage guardians" on public.student_guardian_relationships for all to authenticated using(public.is_workspace_member(workspace_id)) with check(public.is_workspace_member(workspace_id));
create policy "education members read academics" on public.student_academic_records for select to authenticated using(public.is_workspace_member(workspace_id));
create policy "education members manage academics" on public.student_academic_records for all to authenticated using(public.is_workspace_member(workspace_id)) with check(public.is_workspace_member(workspace_id));
create policy "leaders manage progression" on public.progression_batches for all to authenticated
  using(public.is_workspace_member(workspace_id) and public.current_crm_role() in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER'))
  with check(public.is_workspace_member(workspace_id) and public.current_crm_role() in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER'));
create policy "leaders manage progression items" on public.progression_batch_items for all to authenticated
  using(public.is_workspace_member(workspace_id) and public.current_crm_role() in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER'))
  with check(public.is_workspace_member(workspace_id) and public.current_crm_role() in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER'));
create policy "sales read leads" on public.leads for select to authenticated
  using(public.is_workspace_member(workspace_id) and public.current_crm_role()<>'SALES_SUPPORT');
create policy "sales manage leads" on public.leads for all to authenticated
  using(public.is_workspace_member(workspace_id) and public.current_crm_role() in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER','SALES_SPECIALIST'))
  with check(public.is_workspace_member(workspace_id) and public.current_crm_role() in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER','SALES_SPECIALIST'));
create policy "sales read lead conversions" on public.lead_conversions for select to authenticated
  using(public.is_workspace_member(workspace_id) and public.current_crm_role()<>'SALES_SUPPORT');
create policy "privacy owners read requests" on public.privacy_requests for select to authenticated
  using(public.is_workspace_member(workspace_id) and (created_by=auth.uid() or public.current_crm_role() in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR')));
create policy "members create privacy requests" on public.privacy_requests for insert to authenticated
  with check(public.is_workspace_member(workspace_id) and created_by=auth.uid());
create policy "privacy leaders manage requests" on public.privacy_requests for update to authenticated
  using(public.is_workspace_member(workspace_id) and public.current_crm_role() in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR'))
  with check(public.is_workspace_member(workspace_id) and public.current_crm_role() in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR'));
create policy "owners manage mappings" on public.import_mapping_profiles for all to authenticated
  using(public.is_workspace_member(workspace_id) and (owned_by=auth.uid() or public.current_crm_role() in ('SUPER_ADMIN','ADMIN')))
  with check(public.is_workspace_member(workspace_id) and owned_by=auth.uid());
create policy "members read own suggestion runs" on public.ai_suggestion_runs for select to authenticated
  using(public.is_workspace_member(workspace_id) and created_by=auth.uid());
create policy "members read suggestions" on public.ai_suggestions for select to authenticated
  using(public.is_workspace_member(workspace_id) and exists(select 1 from public.ai_suggestion_runs r where r.id=run_id and r.created_by=auth.uid()));
create policy "members read suggestion decisions" on public.ai_suggestion_decisions for select to authenticated
  using(public.is_workspace_member(workspace_id) and decided_by=auth.uid());

create or replace function public.preview_student_progression(
  from_year text,to_year text,p_idempotency_key text
) returns public.progression_batches
language plpgsql security definer set search_path=public
as $$
declare result public.progression_batches; ws uuid:=public.current_workspace_id(); actor_role text:=public.current_crm_role();
begin
  if ws is null or actor_role not in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER') then raise exception 'progression_forbidden'; end if;
  if nullif(trim(from_year),'') is null or nullif(trim(to_year),'') is null or nullif(trim(p_idempotency_key),'') is null then raise exception 'progression_invalid'; end if;
  insert into public.progression_batches(workspace_id,from_academic_year,to_academic_year,status,idempotency_key,previewed_at)
  values(ws,trim(from_year),trim(to_year),'PREVIEWED',trim(p_idempotency_key),now())
  on conflict(workspace_id,idempotency_key) do update set previewed_at=public.progression_batches.previewed_at
  returning * into result;
  insert into public.progression_batch_items(workspace_id,batch_id,student_id,from_grade,to_grade,action)
  select ws,result.id,s.id,s.current_grade,
    case when upper(s.current_grade) in ('12','G12','GRADE 12','YEAR 13') then 'ALUMNI' else regexp_replace(s.current_grade,'([0-9]+)',((substring(s.current_grade from '[0-9]+'))::integer+1)::text) end,
    case when upper(s.current_grade) in ('12','G12','GRADE 12','YEAR 13') then 'GRADUATE' else 'ADVANCE' end
  from public.students s where s.workspace_id=ws and s.status='ACTIVE' and s.academic_year=trim(from_year)
  on conflict(batch_id,student_id) do nothing;
  return result;
end;
$$;

create or replace function public.apply_student_progression(target_batch uuid,p_idempotency_key text)
returns public.progression_batches language plpgsql security definer set search_path=public
as $$
declare result public.progression_batches; item public.progression_batch_items;
begin
  if public.current_crm_role() not in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER') then raise exception 'progression_forbidden'; end if;
  select * into result from public.progression_batches
    where id=target_batch and workspace_id=public.current_workspace_id() for update;
  if not found then raise exception 'progression_not_found'; end if;
  if result.idempotency_key<>trim(p_idempotency_key) then raise exception 'progression_idempotency_mismatch'; end if;
  if result.status='APPLIED' then return result; end if;
  if result.status<>'PREVIEWED' then raise exception 'progression_not_ready'; end if;
  for item in select * from public.progression_batch_items where batch_id=result.id and selected order by id for update loop
    update public.students set
      current_grade=case when item.action='GRADUATE' then current_grade else item.to_grade end,
      academic_year=result.to_academic_year,
      status=case when item.action='GRADUATE' then 'ALUMNI' else status end,
      updated_at=now()
    where id=item.student_id and workspace_id=result.workspace_id;
    update public.progression_batch_items set status='APPLIED' where id=item.id;
  end loop;
  update public.progression_batches set status='APPLIED',applied_at=now()
    where id=result.id returning * into result;
  return result;
end;
$$;

create or replace function public.convert_lead_to_opportunity(
  target_lead uuid,title_zh text,title_en text,amount numeric,currency text,p_idempotency_key text
) returns public.opportunities
language plpgsql security definer set search_path=public
as $$
declare lead public.leads; result public.opportunities; existing_id uuid;
begin
  if public.current_crm_role() not in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER','SALES_SPECIALIST') then raise exception 'lead_forbidden'; end if;
  select lc.opportunity_id into existing_id from public.lead_conversions lc
    where lc.workspace_id=public.current_workspace_id() and lc.idempotency_key=trim(p_idempotency_key);
  if existing_id is not null then select * into result from public.opportunities where id=existing_id; return result; end if;
  select * into lead from public.leads where id=target_lead and workspace_id=public.current_workspace_id() for update;
  if not found then raise exception 'lead_not_found'; end if;
  if lead.status<>'QUALIFIED' or lead.organization_id is null then raise exception 'lead_not_convertible'; end if;
  insert into public.opportunities(workspace_id,organization_id,title_zh,title_en,amount,currency,owner_id,created_by)
  values(lead.workspace_id,lead.organization_id,trim(title_zh),trim(title_en),amount,upper(currency),lead.owner_id,auth.uid())
  returning * into result;
  insert into public.lead_conversions(workspace_id,lead_id,opportunity_id,evidence,idempotency_key)
  values(lead.workspace_id,lead.id,result.id,jsonb_build_object('score',lead.qualification_score,'source',lead.source),trim(p_idempotency_key));
  update public.leads set status='CONVERTED',converted_at=now(),updated_at=now() where id=lead.id;
  return result;
end;
$$;

create or replace function public.generate_rule_suggestions()
returns setof public.ai_suggestions
language plpgsql security definer set search_path=public
as $$
declare run public.ai_suggestion_runs;
begin
  if public.current_workspace_id() is null then raise exception 'suggestion_forbidden'; end if;
  insert into public.ai_suggestion_runs(
    workspace_id,rule_version,input_digest,input_summary,status,external_data_sent,completed_at
  ) values(
    public.current_workspace_id(),'v2.0.0',
    encode(extensions.digest(public.current_workspace_id()::text||current_date::text,'sha256'),'hex'),
    jsonb_build_object('evaluatedAt',now(),'sources',jsonb_build_array('tasks','contracts','leads')),
    'COMPLETED',false,now()
  ) returning * into run;
  insert into public.ai_suggestions(workspace_id,run_id,subject_type,subject_id,recommendation_zh,recommendation_en,evidence,confidence)
  select run.workspace_id,run.id,'CONTRACT',c.id,
    '合同将在 45 天内到期，建议确认续约会议与下一步。',
    'This contract expires within 45 days. Confirm a renewal meeting and next step.',
    jsonb_build_array(jsonb_build_object('type','CONTRACT_END_DATE','value',c.end_date)),0.820
  from public.contracts c
  where c.workspace_id=run.workspace_id and c.status in ('ACTIVE','RENEWAL_PREP','RISK')
    and c.end_date between current_date and current_date+45;
  return query select * from public.ai_suggestions where run_id=run.id order by confidence desc;
end;
$$;

create or replace function public.decide_ai_suggestion(
  target_suggestion uuid,decision_value text,final_zh text,final_en text,decision_reason text,
  create_task boolean,p_idempotency_key text
) returns public.ai_suggestion_decisions
language plpgsql security definer set search_path=public
as $$
declare suggestion public.ai_suggestions; result public.ai_suggestion_decisions; created_task uuid;
begin
  select * into result from public.ai_suggestion_decisions
    where workspace_id=public.current_workspace_id() and idempotency_key=trim(p_idempotency_key);
  if found then return result; end if;
  select s.* into suggestion from public.ai_suggestions s
    join public.ai_suggestion_runs r on r.id=s.run_id
    where s.id=target_suggestion and s.workspace_id=public.current_workspace_id() and r.created_by=auth.uid() for update;
  if not found or suggestion.status<>'OPEN' or suggestion.expires_at<=now() then raise exception 'suggestion_unavailable'; end if;
  if decision_value not in ('ACCEPTED','EDITED','REJECTED') or nullif(trim(decision_reason),'') is null then raise exception 'suggestion_decision_invalid'; end if;
  if create_task and decision_value in ('ACCEPTED','EDITED') then
    insert into public.crm_tasks(workspace_id,title_zh,title_en,related_type,related_id,status,priority,owner_id)
    values(suggestion.workspace_id,coalesce(nullif(trim(final_zh),''),suggestion.recommendation_zh),coalesce(nullif(trim(final_en),''),suggestion.recommendation_en),suggestion.subject_type,suggestion.subject_id,'TODO','NORMAL',auth.uid())
    returning id into created_task;
  end if;
  insert into public.ai_suggestion_decisions(workspace_id,suggestion_id,decision,final_text_zh,final_text_en,reason,task_id,idempotency_key)
  values(suggestion.workspace_id,suggestion.id,decision_value,nullif(trim(final_zh),''),nullif(trim(final_en),''),trim(decision_reason),created_task,trim(p_idempotency_key))
  returning * into result;
  update public.ai_suggestions set status=decision_value where id=suggestion.id;
  return result;
end;
$$;

create or replace function public.list_students_page(
  search_query text,page_number integer,page_size integer,status_filter text
) returns table(
  id uuid,person_id uuid,student_number text,current_grade text,academic_year text,
  status text,updated_at timestamptz,name_zh text,name_en text,
  household_name_zh text,household_name_en text,total_count bigint
)
language sql stable security definer set search_path=public
as $$
  select
    s.id,s.person_id,s.student_number,s.current_grade,s.academic_year,s.status,s.updated_at,
    c.name_zh,c.name_en,h.name_zh,h.name_en,count(*) over()
  from public.students s
  join public.contacts c on c.id=s.person_id and c.workspace_id=s.workspace_id
  left join public.households h on h.id=s.household_id and h.workspace_id=s.workspace_id
  where s.workspace_id=public.current_workspace_id()
    and (coalesce(status_filter,'all')='all' or s.status=upper(status_filter))
    and (
      nullif(trim(coalesce(search_query,'')),'') is null
      or c.name_zh ilike '%'||trim(search_query)||'%'
      or c.name_en ilike '%'||trim(search_query)||'%'
      or coalesce(s.student_number,'') ilike '%'||trim(search_query)||'%'
    )
  order by s.updated_at desc,s.id
  limit least(greatest(coalesce(page_size,20),1),50)
  offset (greatest(coalesce(page_number,1),1)-1)*least(greatest(coalesce(page_size,20),1),50);
$$;

create or replace function public.update_student_record(
  target_student uuid,expected_updated_at timestamptz,next_grade text,next_academic_year text,
  next_household uuid,next_status text
) returns public.students
language plpgsql security definer set search_path=public
as $$
declare result public.students; normalized_status text:=upper(trim(coalesce(next_status,'')));
begin
  if public.current_crm_role() not in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER','SALES_SPECIALIST','SALES_SUPPORT')
    or normalized_status not in ('ACTIVE','ON_LEAVE','ALUMNI','WITHDRAWN','ARCHIVED')
    or nullif(trim(next_grade),'') is null or nullif(trim(next_academic_year),'') is null then
    raise exception 'education_update_forbidden';
  end if;
  if next_household is not null and not exists(
    select 1 from public.households where id=next_household and workspace_id=public.current_workspace_id() and archived_at is null
  ) then raise exception 'education_household_not_found'; end if;
  update public.students set
    current_grade=trim(next_grade),academic_year=trim(next_academic_year),
    household_id=next_household,status=normalized_status,
    archived_at=case when normalized_status='ARCHIVED' then now() else null end,
    updated_at=now()
  where id=target_student and workspace_id=public.current_workspace_id()
    and updated_at=expected_updated_at
  returning * into result;
  if not found then
    if exists(select 1 from public.students where id=target_student and workspace_id=public.current_workspace_id())
      then raise exception 'education_version_conflict';
      else raise exception 'education_student_not_found';
    end if;
  end if;
  return result;
end;
$$;

create or replace function public.update_household_record(
  target_household uuid,expected_updated_at timestamptz,next_name_zh text,next_name_en text,
  next_address text,next_status text
) returns public.households
language plpgsql security definer set search_path=public
as $$
declare result public.households; normalized_status text:=upper(trim(coalesce(next_status,'')));
begin
  if public.current_crm_role() not in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER','SALES_SPECIALIST','SALES_SUPPORT')
    or normalized_status not in ('ACTIVE','INACTIVE','ARCHIVED')
    or nullif(trim(next_name_zh),'') is null or nullif(trim(next_name_en),'') is null then
    raise exception 'education_update_forbidden';
  end if;
  update public.households set
    name_zh=trim(next_name_zh),name_en=trim(next_name_en),address=trim(coalesce(next_address,'')),
    status=normalized_status,
    archived_at=case when normalized_status='ARCHIVED' then now() else null end,
    updated_at=now()
  where id=target_household and workspace_id=public.current_workspace_id()
    and updated_at=expected_updated_at
  returning * into result;
  if not found then
    if exists(select 1 from public.households where id=target_household and workspace_id=public.current_workspace_id())
      then raise exception 'education_version_conflict';
      else raise exception 'education_household_not_found';
    end if;
  end if;
  return result;
end;
$$;

create or replace function public.manage_privacy_request(
  target_request uuid,next_status text,identity_result text,decision text
) returns public.privacy_requests
language plpgsql security definer set search_path=public
as $$
declare
  request_row public.privacy_requests;
  normalized_status text:=upper(trim(coalesce(next_status,'')));
  normalized_identity text:=upper(trim(coalesce(identity_result,'')));
  normalized_decision text:=nullif(trim(coalesce(decision,'')),'');
  actor_role text:=public.current_crm_role();
  created_task uuid;
begin
  if actor_role not in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR') then
    raise exception 'privacy_management_forbidden';
  end if;
  if normalized_identity not in ('PENDING','VERIFIED','FAILED') then
    raise exception 'privacy_identity_invalid';
  end if;
  if normalized_decision is null then
    raise exception 'privacy_decision_note_required';
  end if;

  select * into request_row from public.privacy_requests
  where id=target_request and workspace_id=public.current_workspace_id()
  for update;
  if not found then raise exception 'privacy_request_not_found'; end if;

  if not (
    (request_row.status='RECEIVED' and normalized_status in ('IDENTITY_REVIEW','CANCELLED'))
    or (request_row.status='IDENTITY_REVIEW' and normalized_status in ('IN_PROGRESS','REJECTED','CANCELLED'))
    or (request_row.status='IN_PROGRESS' and normalized_status in ('WAITING_APPROVAL','FULFILLED','REJECTED','CANCELLED'))
    or (request_row.status='WAITING_APPROVAL' and normalized_status in ('FULFILLED','REJECTED'))
  ) then
    raise exception 'privacy_transition_invalid';
  end if;

  if normalized_status in ('IN_PROGRESS','WAITING_APPROVAL','FULFILLED')
    and normalized_identity<>'VERIFIED' then
    raise exception 'privacy_identity_verification_required';
  end if;

  if request_row.request_type in ('EXPORT','DELETION') then
    if request_row.status='IN_PROGRESS' and normalized_status='FULFILLED' then
      raise exception 'privacy_approval_required';
    end if;
    if request_row.status='IN_PROGRESS' and normalized_status='WAITING_APPROVAL' then
      insert into public.crm_tasks(
        workspace_id,title_zh,title_en,related_type,related_id,related_label,
        status,priority,owner_id,due_at,created_by
      ) values(
        request_row.workspace_id,
        case request_row.request_type when 'EXPORT' then '复核隐私数据导出' else '复核隐私删除请求' end,
        case request_row.request_type when 'EXPORT' then 'Review privacy data export' else 'Review privacy deletion request' end,
        'PRIVACY_REQUEST',request_row.id,request_row.request_type,
        'WAITING_APPROVAL','URGENT',null,request_row.due_at,auth.uid()
      ) returning id into created_task;
    elsif request_row.status='WAITING_APPROVAL' and normalized_status='FULFILLED' then
      if request_row.assigned_to=auth.uid() then
        raise exception 'privacy_second_reviewer_required';
      end if;
      if request_row.execution_task_id is null then
        raise exception 'privacy_approval_task_missing';
      end if;
      update public.crm_tasks set
        status='DONE',completed_at=now(),updated_at=now(),owner_id=auth.uid()
      where id=request_row.execution_task_id and workspace_id=request_row.workspace_id;
    end if;
  elsif normalized_status='WAITING_APPROVAL' then
    raise exception 'privacy_approval_not_required';
  end if;

  if normalized_status='REJECTED' and request_row.execution_task_id is not null then
    update public.crm_tasks set
      status='DONE',completed_at=now(),updated_at=now(),owner_id=auth.uid()
    where id=request_row.execution_task_id and workspace_id=request_row.workspace_id;
  end if;

  update public.privacy_requests set
    status=normalized_status,
    identity_status=normalized_identity,
    decision_note=normalized_decision,
    assigned_to=case
      when normalized_status='WAITING_APPROVAL' then auth.uid()
      when normalized_status in ('FULFILLED','REJECTED','CANCELLED') then assigned_to
      else auth.uid()
    end,
    execution_task_id=coalesce(created_task,execution_task_id),
    fulfilled_at=case when normalized_status='FULFILLED' then now() else fulfilled_at end,
    updated_at=now()
  where id=request_row.id returning * into request_row;
  return request_row;
end;
$$;

revoke all on function public.preview_student_progression(text,text,text),
  public.apply_student_progression(uuid,text),
  public.convert_lead_to_opportunity(uuid,text,text,numeric,text,text),
  public.generate_rule_suggestions(),
  public.decide_ai_suggestion(uuid,text,text,text,text,boolean,text),
  public.list_students_page(text,integer,integer,text),
  public.update_student_record(uuid,timestamptz,text,text,uuid,text),
  public.update_household_record(uuid,timestamptz,text,text,text,text),
  public.manage_privacy_request(uuid,text,text,text)
from public,anon;
grant execute on function public.preview_student_progression(text,text,text),
  public.apply_student_progression(uuid,text),
  public.convert_lead_to_opportunity(uuid,text,text,numeric,text,text),
  public.generate_rule_suggestions(),
  public.decide_ai_suggestion(uuid,text,text,text,text,boolean,text),
  public.list_students_page(text,integer,integer,text),
  public.update_student_record(uuid,timestamptz,text,text,uuid,text),
  public.update_household_record(uuid,timestamptz,text,text,text,text),
  public.manage_privacy_request(uuid,text,text,text)
to authenticated;

grant select,insert,update on public.households,public.household_members,public.students,
  public.student_guardian_relationships,public.student_academic_records,
  public.progression_batches,public.progression_batch_items,public.leads,
  public.lead_conversions,public.privacy_requests,public.import_mapping_profiles,
  public.ai_suggestion_runs,public.ai_suggestions,public.ai_suggestion_decisions
to authenticated;

-- v2 import batches keep the existing durable, resumable execution model but
-- raise the validated source limit to 10,000 rows for CSV/XLSX files.
create or replace function public.create_import_batch(
  resource text,filename text,content_hash text,request_key text,mapping jsonb,rows jsonb
) returns public.import_batches
language plpgsql security definer set search_path=public
as $$
declare batch public.import_batches; item jsonb; row_no integer:=0; normalized jsonb; errors jsonb; duplicate_id uuid; duplicate_score integer; reasons jsonb;
begin
  if public.current_crm_role() not in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER') then raise exception 'import_not_authorized'; end if;
  if upper(resource) not in ('ORGANIZATIONS','CONTACTS') or jsonb_typeof(rows)<>'array'
    or jsonb_array_length(rows)=0 or jsonb_array_length(rows)>10000 then raise exception 'import_invalid'; end if;
  insert into public.import_batches(workspace_id,resource_type,original_filename,file_hash,idempotency_key,field_mapping,created_by)
  values(public.current_workspace_id(),upper(resource),left(filename,180),content_hash,request_key,mapping,auth.uid())
  on conflict(workspace_id,idempotency_key) do update set idempotency_key=excluded.idempotency_key returning * into batch;
  if batch.total_rows>0 then return batch; end if;
  for item in select * from jsonb_array_elements(rows) loop
    row_no:=row_no+1; errors:='[]'::jsonb; duplicate_id:=null; duplicate_score:=null; reasons:='[]'::jsonb;
    normalized:=jsonb_build_object(
      'nameZh',trim(coalesce(item->>'nameZh','')),'nameEn',trim(coalesce(item->>'nameEn','')),
      'email',lower(trim(coalesce(item->>'email',''))),'phone',trim(coalesce(item->>'phone','')),
      'city',trim(coalesce(item->>'city','')),'title',trim(coalesce(item->>'title',''))
    );
    if normalized->>'nameZh'='' then errors:=errors||'[{"code":"NAME_ZH_REQUIRED"}]'::jsonb; end if;
    if normalized->>'nameEn'='' then errors:=errors||'[{"code":"NAME_EN_REQUIRED"}]'::jsonb; end if;
    if upper(resource)='CONTACTS' and normalized->>'email'='' and normalized->>'phone'='' then
      errors:=errors||'[{"code":"CONTACT_METHOD_REQUIRED"}]'::jsonb;
    end if;
    if jsonb_array_length(errors)=0 then
      if upper(resource)='CONTACTS' then
        select c.id,
          case when c.email=nullif(normalized->>'email','')::citext then 100 when c.phone<>'' and c.phone=normalized->>'phone' then 95 else 75 end,
          jsonb_build_array(case when c.email=nullif(normalized->>'email','')::citext then 'EMAIL' when c.phone=normalized->>'phone' then 'PHONE' else 'BILINGUAL_NAME' end)
        into duplicate_id,duplicate_score,reasons
        from public.contacts c
        where c.workspace_id=batch.workspace_id and (
          (normalized->>'email'<>'' and c.email=normalized->>'email'::citext)
          or (normalized->>'phone'<>'' and c.phone=normalized->>'phone')
          or (lower(c.name_zh)=lower(normalized->>'nameZh') and lower(c.name_en)=lower(normalized->>'nameEn'))
        ) order by case when c.email=normalized->>'email'::citext then 1 else 2 end limit 1;
      else
        select o.id,90,'["BILINGUAL_NAME"]'::jsonb into duplicate_id,duplicate_score,reasons
        from public.organizations o where o.workspace_id=batch.workspace_id
          and (lower(o.name_zh)=lower(normalized->>'nameZh') or lower(o.name_en)=lower(normalized->>'nameEn')) limit 1;
      end if;
    end if;
    insert into public.import_rows(
      workspace_id,batch_id,row_number,raw_data,normalized_data,status,errors,
      duplicate_entity_id,duplicate_score,duplicate_reasons
    ) values(
      batch.workspace_id,batch.id,row_no,item,normalized,
      case when jsonb_array_length(errors)>0 then 'INVALID' when duplicate_id is not null then 'DUPLICATE' else 'VALID' end,
      errors,duplicate_id,duplicate_score,reasons
    );
  end loop;
  update public.import_batches b set
    total_rows=(select count(*) from public.import_rows where batch_id=b.id),
    valid_rows=(select count(*) from public.import_rows where batch_id=b.id and status='VALID'),
    invalid_rows=(select count(*) from public.import_rows where batch_id=b.id and status='INVALID'),
    duplicate_rows=(select count(*) from public.import_rows where batch_id=b.id and status='DUPLICATE'),
    status=case
      when exists(select 1 from public.import_rows where batch_id=b.id and status='DUPLICATE') then 'NEEDS_DECISION'
      when exists(select 1 from public.import_rows where batch_id=b.id and status='INVALID') then 'PARTIAL_FAILED'
      else 'READY'
    end,updated_at=now()
  where b.id=batch.id returning * into batch;
  return batch;
end;
$$;

-- Add an explicit artifact format without changing the audited v1.2 approval
-- function or any already-issued approval payload.
create or replace function public.create_crm_export_approval(
  resource_key text,search_query text,status_filter text,sort_key text,
  sort_direction text,business_reason text,export_format text
)
returns public.approval_requests
language plpgsql
security definer
set search_path=public
as $$
declare
  created public.approval_requests;
  next_number text;
  actor_role text:=public.current_crm_role();
  scope_value text;
  normalized_format text:=upper(trim(coalesce(export_format,'CSV')));
begin
  resource_key:=lower(trim(resource_key));
  if auth.uid() is null
    or resource_key not in ('schools','people','tasks','students','households','leads','sales','finance')
    or nullif(trim(business_reason),'') is null then
    raise exception 'approval_not_authorized';
  end if;
  if normalized_format not in ('CSV','XLSX','PDF') then
    raise exception 'export_format_invalid';
  end if;
  scope_value:=case when actor_role in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR') then 'WORKSPACE' else 'OWNER' end;
  next_number:='APR-'||to_char(clock_timestamp(),'YYMMDD')||'-'||lpad(nextval('public.approval_actions_id_seq')::text,6,'0');
  insert into public.approval_requests(
    workspace_id,request_number,request_type,business_object_type,business_object_id,
    requester_id,reason,expires_at,request_payload
  ) values(
    public.current_workspace_id(),next_number,'CRM_EXPORT','CRM_EXPORT',
    resource_key||':'||gen_random_uuid(),auth.uid(),trim(business_reason),now()+interval '7 days',
    jsonb_build_object(
      'resource',resource_key,'query',left(coalesce(search_query,''),100),
      'status',left(coalesce(status_filter,'all'),40),
      'sort',left(coalesce(sort_key,'primary'),40),
      'direction',case when sort_direction='desc' then 'desc' else 'asc' end,
      'scope',scope_value,'requesterId',auth.uid(),'format',normalized_format
    )
  ) returning * into created;
  insert into public.approval_actions(approval_request_id,actor_id,action,comment)
    values(created.id,auth.uid(),'SUBMITTED',trim(business_reason));
  return created;
exception when unique_violation then raise exception 'approval_already_pending';
end;
$$;

revoke all on function public.create_crm_export_approval(
  text,text,text,text,text,text,text
) from public,anon;
grant execute on function public.create_crm_export_approval(
  text,text,text,text,text,text,text
) to authenticated;

create or replace function public.repair_import_row(
  target_row uuid,replacement jsonb
) returns public.import_rows
language plpgsql security definer set search_path=public
as $$
declare
  row_record public.import_rows;
  batch_record public.import_batches;
  normalized jsonb;
  validation_errors jsonb:='[]'::jsonb;
  duplicate_id uuid;
  matched_score numeric;
  reasons jsonb:='[]'::jsonb;
begin
  select * into row_record from public.import_rows
    where id=target_row and workspace_id=public.current_workspace_id() for update;
  if not found or row_record.status not in ('INVALID','FAILED') then
    raise exception 'import_row_not_repairable';
  end if;
  select * into batch_record from public.import_batches
    where id=row_record.batch_id and workspace_id=row_record.workspace_id for update;
  if batch_record.created_by<>auth.uid()
    and public.current_crm_role() not in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER') then
    raise exception 'import_repair_forbidden';
  end if;
  if replacement is null or jsonb_typeof(replacement)<>'object'
    or exists(select 1 from jsonb_object_keys(replacement) key where key not in ('nameZh','nameEn','email','phone','city','title')) then
    raise exception 'import_repair_invalid';
  end if;
  normalized:=row_record.normalized_data||replacement;
  if nullif(trim(normalized->>'nameZh'),'') is null or nullif(trim(normalized->>'nameEn'),'') is null then
    validation_errors:=validation_errors||'[{"code":"NAME_REQUIRED"}]'::jsonb;
  end if;
  if batch_record.resource_type='CONTACTS'
    and nullif(trim(normalized->>'email'),'') is null
    and nullif(trim(normalized->>'phone'),'') is null then
    validation_errors:=validation_errors||'[{"code":"CONTACT_METHOD_REQUIRED"}]'::jsonb;
  end if;
  if jsonb_array_length(validation_errors)=0 then
    if batch_record.resource_type='CONTACTS' then
      select c.id,
        case when c.email=nullif(normalized->>'email','')::citext then 100 when c.phone<>'' and c.phone=normalized->>'phone' then 95 else 75 end,
        jsonb_build_array(case when c.email=nullif(normalized->>'email','')::citext then 'EMAIL' when c.phone=normalized->>'phone' then 'PHONE' else 'BILINGUAL_NAME' end)
      into duplicate_id,matched_score,reasons
      from public.contacts c
      where c.workspace_id=batch_record.workspace_id and (
        (normalized->>'email'<>'' and c.email=normalized->>'email'::citext)
        or (normalized->>'phone'<>'' and c.phone=normalized->>'phone')
        or (lower(c.name_zh)=lower(normalized->>'nameZh') and lower(c.name_en)=lower(normalized->>'nameEn'))
      ) order by case when c.email=normalized->>'email'::citext then 1 else 2 end limit 1;
    else
      select o.id,90,'["BILINGUAL_NAME"]'::jsonb into duplicate_id,matched_score,reasons
      from public.organizations o where o.workspace_id=batch_record.workspace_id
        and (lower(o.name_zh)=lower(normalized->>'nameZh') or lower(o.name_en)=lower(normalized->>'nameEn')) limit 1;
    end if;
  end if;
  update public.import_rows set
    normalized_data=normalized,
    status=case when jsonb_array_length(validation_errors)>0 then 'INVALID' when duplicate_id is not null then 'DUPLICATE' else 'VALID' end,
    errors=validation_errors,duplicate_entity_id=duplicate_id,duplicate_score=matched_score,
    duplicate_reasons=reasons,decision=null,last_error=null
  where id=row_record.id returning * into row_record;
  update public.import_batches b set
    valid_rows=(select count(*) from public.import_rows where batch_id=b.id and status='VALID'),
    invalid_rows=(select count(*) from public.import_rows where batch_id=b.id and status='INVALID'),
    duplicate_rows=(select count(*) from public.import_rows where batch_id=b.id and status='DUPLICATE'),
    failed_rows=(select count(*) from public.import_rows where batch_id=b.id and status='FAILED'),
    status=case
      when exists(select 1 from public.import_rows where batch_id=b.id and status='DUPLICATE') then 'NEEDS_DECISION'
      when exists(select 1 from public.import_rows where batch_id=b.id and status in ('INVALID','FAILED')) then 'PARTIAL_FAILED'
      else 'READY'
    end,updated_at=now()
  where b.id=batch_record.id;
  return row_record;
end;
$$;
revoke all on function public.repair_import_row(uuid,jsonb) from public,anon;
grant execute on function public.repair_import_row(uuid,jsonb) to authenticated;

-- Private export storage accepts every generated format; access remains signed
-- and the worker expires both objects and generated-job metadata.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values(
  'crm-exports','crm-exports',false,20971520,
  array[
    'text/csv',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/pdf'
  ]
)
on conflict(id) do update set
  public=false,
  file_size_limit=excluded.file_size_limit,
  allowed_mime_types=excluded.allowed_mime_types;
