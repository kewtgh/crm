-- Real sales pipeline, relationship milestones, contribution attribution and reporting.

create table if not exists public.opportunities (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default public.current_workspace_id() references public.workspaces(id),
  organization_id uuid not null references public.organizations(id),
  primary_contact_id uuid references public.contacts(id) on delete set null,
  product_id uuid references public.products(id) on delete set null,
  title_zh text not null,
  title_en text not null,
  stage text not null default 'DISCOVERY' check (stage in ('DISCOVERY','EVALUATION','HESITATION','PAYMENT','WON','LOST')),
  amount numeric(14,2) not null default 0 check (amount >= 0),
  currency text not null default 'CNY' check (currency ~ '^[A-Z]{3}$'),
  probability smallint not null default 20 check (probability between 0 and 100),
  expected_close_date date,
  next_action_zh text not null default '',
  next_action_en text not null default '',
  owner_id uuid not null default auth.uid() references auth.users(id),
  last_activity_at timestamptz,
  closed_at timestamptz,
  lost_reason text,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists opportunities_pipeline_idx on public.opportunities(workspace_id,stage,expected_close_date);
create index if not exists opportunities_owner_idx on public.opportunities(workspace_id,owner_id,updated_at desc);

create table if not exists public.crm_activities (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default public.current_workspace_id() references public.workspaces(id),
  organization_id uuid references public.organizations(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete set null,
  opportunity_id uuid references public.opportunities(id) on delete set null,
  activity_type text not null check (activity_type in ('CALL','EMAIL','MEETING','MEAL','NOTE','CAMPAIGN','PAYMENT_FOLLOW_UP')),
  occurred_at timestamptz not null default now(),
  summary_zh text not null,
  summary_en text not null,
  next_step_zh text not null default '',
  next_step_en text not null default '',
  owner_id uuid not null default auth.uid() references auth.users(id),
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now()
);
create index if not exists crm_activities_timeline_idx on public.crm_activities(workspace_id,organization_id,occurred_at desc);

create table if not exists public.relationship_milestones (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default public.current_workspace_id() references public.workspaces(id),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  milestone_type text not null check (milestone_type in ('CONTACT','MEAL','FAMILY_CHAT','ADVOCACY')),
  achieved_at timestamptz not null default now(),
  evidence_note text not null default '',
  evidence_status text not null default 'RECORDED' check (evidence_status in ('RECORDED','VERIFIED','REJECTED')),
  achieved_by uuid not null default auth.uid() references auth.users(id),
  verified_by uuid references auth.users(id),
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(workspace_id,organization_id,milestone_type)
);

create table if not exists public.relationship_target_settings (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default public.current_workspace_id() references public.workspaces(id),
  manager_id uuid references auth.users(id),
  period_start date not null,
  period_end date not null,
  contact_target smallint not null check (contact_target between 0 and 100),
  meal_target smallint not null check (meal_target between 0 and 100),
  family_chat_target smallint not null check (family_chat_target between 0 and 100),
  advocacy_target smallint not null check (advocacy_target between 0 and 100),
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (period_end >= period_start)
);
create unique index if not exists relationship_target_scope_uidx
  on public.relationship_target_settings(workspace_id,coalesce(manager_id,'00000000-0000-0000-0000-000000000000'::uuid),period_start,period_end);

create table if not exists public.account_plans (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default public.current_workspace_id() references public.workspaces(id),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  objective_zh text not null,
  objective_en text not null,
  risk_zh text not null default '',
  risk_en text not null default '',
  next_review_at date,
  owner_id uuid not null default auth.uid() references auth.users(id),
  status text not null default 'ACTIVE' check (status in ('DRAFT','ACTIVE','ARCHIVED')),
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.performance_contributions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default public.current_workspace_id() references public.workspaces(id),
  payment_id uuid not null references public.payments(id) on delete cascade,
  contributor_member_id uuid not null references public.sales_team_members(id),
  attribution_type text not null check (attribution_type in ('DIRECT','ASSISTED')),
  amount numeric(14,2) not null check (amount > 0),
  verified_by uuid references auth.users(id),
  verified_at timestamptz,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique(payment_id,contributor_member_id)
);
create index if not exists performance_contribution_period_idx on public.performance_contributions(workspace_id,contributor_member_id,created_at);

create table if not exists public.contract_versions (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.contracts(id) on delete cascade,
  version integer not null check (version > 0),
  snapshot jsonb not null,
  change_note text not null default '',
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  unique(contract_id,version)
);

create table if not exists public.contract_documents (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default public.current_workspace_id() references public.workspaces(id),
  contract_id uuid not null references public.contracts(id) on delete cascade,
  version integer not null check (version > 0),
  storage_path text not null,
  checksum text not null,
  status text not null default 'GENERATED' check (status in ('GENERATING','GENERATED','SIGNED','SUPERSEDED','FAILED')),
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  unique(contract_id,version)
);

alter table public.opportunities enable row level security;
alter table public.crm_activities enable row level security;
alter table public.relationship_milestones enable row level security;
alter table public.relationship_target_settings enable row level security;
alter table public.account_plans enable row level security;
alter table public.performance_contributions enable row level security;
alter table public.contract_versions enable row level security;
alter table public.contract_documents enable row level security;

create policy "scoped read opportunities" on public.opportunities for select to authenticated
  using (public.can_access_owned_record(workspace_id,'OPPORTUNITY',id,owner_id,false));
create policy "staff create opportunities" on public.opportunities for insert to authenticated
  with check (public.is_workspace_member(workspace_id) and owner_id=auth.uid() and created_by=auth.uid());
create policy "scoped update opportunities" on public.opportunities for update to authenticated
  using (public.can_access_owned_record(workspace_id,'OPPORTUNITY',id,owner_id,true))
  with check (public.can_access_owned_record(workspace_id,'OPPORTUNITY',id,owner_id,true));
create policy "admins delete opportunities" on public.opportunities for delete to authenticated
  using (public.is_workspace_member(workspace_id) and public.current_crm_role() in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR'));

create policy "scoped activities" on public.crm_activities for select to authenticated
  using (public.is_workspace_member(workspace_id) and (owner_id=auth.uid() or public.current_crm_role() in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR') or exists(
    select 1 from public.organizations o where o.id=organization_id and public.can_access_owned_record(o.workspace_id,'ORGANIZATION',o.id,o.owner_id,false)
  )));
create policy "staff add activities" on public.crm_activities for insert to authenticated
  with check (public.is_workspace_member(workspace_id) and owner_id=auth.uid() and created_by=auth.uid());

create policy "scoped relationship milestones" on public.relationship_milestones for select to authenticated
  using (exists(select 1 from public.organizations o where o.id=organization_id and public.can_access_owned_record(o.workspace_id,'ORGANIZATION',o.id,o.owner_id,false)));
create policy "staff record relationship milestones" on public.relationship_milestones for insert to authenticated
  with check (public.is_workspace_member(workspace_id) and achieved_by=auth.uid() and exists(select 1 from public.organizations o where o.id=organization_id and public.can_access_owned_record(o.workspace_id,'ORGANIZATION',o.id,o.owner_id,true)));
create policy "staff update relationship milestones" on public.relationship_milestones for update to authenticated
  using (exists(select 1 from public.organizations o where o.id=organization_id and public.can_access_owned_record(o.workspace_id,'ORGANIZATION',o.id,o.owner_id,true)))
  with check (public.is_workspace_member(workspace_id));

create policy "relationship target readers" on public.relationship_target_settings for select to authenticated
  using (public.is_workspace_member(workspace_id));
create policy "relationship target managers" on public.relationship_target_settings for all to authenticated
  using (public.is_workspace_member(workspace_id) and public.current_crm_role() in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER'))
  with check (public.is_workspace_member(workspace_id) and created_by=auth.uid() and public.current_crm_role() in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER'));

create policy "scoped account plans" on public.account_plans for select to authenticated
  using (exists(select 1 from public.organizations o where o.id=organization_id and public.can_access_owned_record(o.workspace_id,'ORGANIZATION',o.id,o.owner_id,false)));
create policy "staff manage account plans" on public.account_plans for all to authenticated
  using (public.can_access_owned_record(workspace_id,'ACCOUNT_PLAN',id,owner_id,true))
  with check (public.is_workspace_member(workspace_id) and owner_id=auth.uid());

create policy "contribution readers" on public.performance_contributions for select to authenticated
  using (public.is_workspace_member(workspace_id) and (public.current_crm_role() in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER') or exists(select 1 from public.sales_team_members m where m.id=contributor_member_id and m.auth_user_id=auth.uid())));
create policy "contract history readers" on public.contract_versions for select to authenticated
  using (exists(select 1 from public.contracts c where c.id=contract_id and public.can_access_owned_record(c.workspace_id,'CONTRACT',c.id,c.owner_id,false)));
create policy "contract document readers" on public.contract_documents for select to authenticated
  using (exists(select 1 from public.contracts c where c.id=contract_id and public.can_access_owned_record(c.workspace_id,'CONTRACT',c.id,c.owner_id,false)));

grant select,insert,update,delete on public.opportunities to authenticated;
grant select,insert on public.crm_activities to authenticated;
grant select,insert,update on public.relationship_milestones to authenticated;
grant select,insert,update,delete on public.relationship_target_settings to authenticated;
grant select,insert,update,delete on public.account_plans to authenticated;
grant select on public.performance_contributions,public.contract_versions,public.contract_documents to authenticated;

create or replace function public.upsert_relationship_milestone(target_organization uuid, milestone text, evidence text default '')
returns public.relationship_milestones language plpgsql security definer set search_path=public
as $$
declare result public.relationship_milestones; organization public.organizations;
begin
  if milestone not in ('CONTACT','MEAL','FAMILY_CHAT','ADVOCACY') then raise exception 'relationship_invalid_milestone'; end if;
  select * into organization from public.organizations where id=target_organization and workspace_id=public.current_workspace_id();
  if not found or not public.can_access_owned_record(organization.workspace_id,'ORGANIZATION',organization.id,organization.owner_id,true) then raise exception 'relationship_not_authorized'; end if;
  insert into public.relationship_milestones(workspace_id,organization_id,milestone_type,evidence_note,achieved_by)
  values(organization.workspace_id,organization.id,milestone,trim(coalesce(evidence,'')),auth.uid())
  on conflict(workspace_id,organization_id,milestone_type) do update set achieved_at=now(),evidence_note=excluded.evidence_note,evidence_status='RECORDED',achieved_by=auth.uid(),verified_by=null,verified_at=null,updated_at=now()
  returning * into result;
  insert into public.audit_events(workspace_id,actor_id,action,entity_type,entity_id,after_data) values(organization.workspace_id,auth.uid(),'RELATIONSHIP_MILESTONE_RECORDED','relationship_milestone',result.id,jsonb_build_object('milestoneType',milestone));
  return result;
end; $$;

create or replace function public.save_relationship_targets(period_from date, period_to date, target_manager uuid, contact_percent integer, meal_percent integer, family_percent integer, advocacy_percent integer)
returns public.relationship_target_settings language plpgsql security definer set search_path=public
as $$
declare result public.relationship_target_settings; actor_role text:=public.current_crm_role(); ws uuid:=public.current_workspace_id();
begin
  if actor_role not in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER') then raise exception 'relationship_target_not_authorized'; end if;
  if period_to<period_from then raise exception 'relationship_target_invalid_period'; end if;
  if least(contact_percent,meal_percent,family_percent,advocacy_percent)<0 or greatest(contact_percent,meal_percent,family_percent,advocacy_percent)>100 then raise exception 'relationship_target_invalid_percentage'; end if;
  if actor_role='SALES_MANAGER' and target_manager is distinct from auth.uid() then raise exception 'relationship_target_not_authorized'; end if;
  insert into public.relationship_target_settings(workspace_id,manager_id,period_start,period_end,contact_target,meal_target,family_chat_target,advocacy_target,created_by)
  values(ws,target_manager,period_from,period_to,contact_percent,meal_percent,family_percent,advocacy_percent,auth.uid())
  on conflict(workspace_id,(coalesce(manager_id,'00000000-0000-0000-0000-000000000000'::uuid)),period_start,period_end)
  do update set contact_target=excluded.contact_target,meal_target=excluded.meal_target,family_chat_target=excluded.family_chat_target,advocacy_target=excluded.advocacy_target,updated_at=now()
  returning * into result;
  return result;
end; $$;

create or replace function public.confirm_payment(target_payment uuid, payment_reference text, contribution_allocations jsonb default '[]'::jsonb)
returns public.payments language plpgsql security definer set search_path=public
as $$
declare result public.payments; contract public.contracts; item jsonb; member public.sales_team_members; total numeric:=0;
begin
  if public.current_crm_role() not in ('SUPER_ADMIN','ADMIN') then raise exception 'payment_not_authorized'; end if;
  select * into result from public.payments where id=target_payment and workspace_id=public.current_workspace_id() for update;
  if not found or result.status<>'PENDING' then raise exception 'payment_not_pending'; end if;
  if nullif(trim(payment_reference),'') is null then raise exception 'payment_reference_required'; end if;
  select * into contract from public.contracts where id=result.contract_id;
  if jsonb_array_length(contribution_allocations)=0 then
    select * into member from public.sales_team_members where workspace_id=result.workspace_id and auth_user_id=contract.owner_id and active limit 1;
    if found then contribution_allocations:=jsonb_build_array(jsonb_build_object('memberId',member.id,'type','DIRECT','amount',result.amount)); end if;
  end if;
  for item in select * from jsonb_array_elements(contribution_allocations) loop
    select * into member from public.sales_team_members where id=(item->>'memberId')::uuid and workspace_id=result.workspace_id and active;
    if not found then raise exception 'payment_invalid_contributor'; end if;
    if item->>'type' not in ('DIRECT','ASSISTED') or (item->>'amount')::numeric<=0 then raise exception 'payment_invalid_contribution'; end if;
    total:=total+(item->>'amount')::numeric;
  end loop;
  if total>result.amount then raise exception 'payment_contribution_exceeds_amount'; end if;
  update public.payments set status='CONFIRMED',paid_at=coalesce(paid_at,now()),reference=trim(payment_reference),verified_by=auth.uid() where id=result.id returning * into result;
  for item in select * from jsonb_array_elements(contribution_allocations) loop
    insert into public.performance_contributions(workspace_id,payment_id,contributor_member_id,attribution_type,amount,verified_by,verified_at,created_by)
    values(result.workspace_id,result.id,(item->>'memberId')::uuid,item->>'type',(item->>'amount')::numeric,auth.uid(),now(),auth.uid());
  end loop;
  return result;
end; $$;

create or replace function public.refund_payment(target_payment uuid, refund_reason text)
returns public.payments language plpgsql security definer set search_path=public
as $$
declare result public.payments;
begin
  if public.current_crm_role() not in ('SUPER_ADMIN','ADMIN') then raise exception 'payment_not_authorized'; end if;
  if nullif(trim(refund_reason),'') is null then raise exception 'payment_refund_reason_required'; end if;
  update public.payments set status='REFUNDED',verified_by=auth.uid() where id=target_payment and workspace_id=public.current_workspace_id() and status='CONFIRMED' returning * into result;
  if not found then raise exception 'payment_not_confirmed'; end if;
  insert into public.audit_events(workspace_id,actor_id,action,entity_type,entity_id,after_data) values(result.workspace_id,auth.uid(),'PAYMENT_REFUNDED','payments',result.id,jsonb_build_object('reason',trim(refund_reason)));
  return result;
end; $$;

create or replace function public.sales_performance_report(report_period text default 'quarter', team_filter text default null)
returns jsonb language plpgsql security definer set search_path=public
as $$
declare
  ws uuid:=public.current_workspace_id(); actor_role text:=public.current_crm_role();
  start_date date; end_date date; selected_currency text:='CNY';
  visible_user_ids uuid[]; visible_member_ids uuid[]; result jsonb; target_total numeric:=0;
begin
  if ws is null or actor_role='' then raise exception 'not_authenticated'; end if;
  if report_period='month' then start_date:=date_trunc('month',current_date)::date; end_date:=(start_date+interval '1 month')::date;
  elsif report_period='year' then start_date:=date_trunc('year',current_date)::date; end_date:=(start_date+interval '1 year')::date;
  else start_date:=date_trunc('quarter',current_date)::date; end_date:=(start_date+interval '3 months')::date; report_period:='quarter'; end if;

  select coalesce(array_agg(m.id),'{}'),coalesce(array_agg(m.auth_user_id) filter(where m.auth_user_id is not null),'{}')
  into visible_member_ids,visible_user_ids from public.sales_team_members m
  where m.workspace_id=ws and m.active and (team_filter is null or team_filter='' or team_filter='all' or m.team=team_filter)
    and (actor_role in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR') or m.auth_user_id=auth.uid() or (actor_role='SALES_MANAGER' and m.manager_member_id=(select own.id from public.sales_team_members own where own.workspace_id=ws and own.auth_user_id=auth.uid() limit 1)));

  select coalesce((select t.currency from public.performance_targets t where t.workspace_id=ws and t.status='ACTIVE' and t.period_start<end_date and t.period_end>=start_date order by t.updated_at desc limit 1),
    (select p.currency from public.payments p where p.workspace_id=ws and p.status='CONFIRMED' order by p.paid_at desc nulls last limit 1),'CNY') into selected_currency;

  select coalesce(sum(a.allocated_amount),0) into target_total from public.performance_allocations a join public.performance_targets t on t.id=a.target_id join public.sales_team_members m on m.id=a.contributor_member_id
  where t.workspace_id=ws and t.status='ACTIVE' and t.currency=selected_currency and t.period_start<end_date and t.period_end>=start_date and m.id=any(visible_member_ids);
  if target_total=0 then select coalesce(sum(t.target_amount),0) into target_total from public.performance_targets t where t.workspace_id=ws and t.status='ACTIVE' and t.currency=selected_currency and t.period_start<end_date and t.period_end>=start_date and t.manager_id=any(visible_user_ids); end if;

  result:=jsonb_build_object(
    'period',report_period,'periodStart',start_date,'periodEnd',end_date-1,'currency',selected_currency,'target',target_total,
    'actual',coalesce((select sum(p.amount) from public.payments p join public.performance_contributions pc on pc.payment_id=p.id where p.workspace_id=ws and p.status='CONFIRMED' and p.currency=selected_currency and p.paid_at>=start_date and p.paid_at<end_date and pc.contributor_member_id=any(visible_member_ids)),0),
    'forecast',coalesce((select sum(o.amount*o.probability/100.0) from public.opportunities o where o.workspace_id=ws and o.currency=selected_currency and o.owner_id=any(visible_user_ids) and o.stage not in ('WON','LOST') and o.expected_close_date>=start_date and o.expected_close_date<end_date),0),
    'teams',coalesce((select jsonb_agg(distinct m.team order by m.team) from public.sales_team_members m where m.id=any(visible_member_ids)),'[]'::jsonb),
    'members',coalesce((select jsonb_agg(jsonb_build_object(
      'id',m.id,'nameZh',m.name_zh,'nameEn',m.name_en,'team',m.team,'role',m.role,
      'target',coalesce((select sum(a.allocated_amount) from public.performance_allocations a join public.performance_targets t on t.id=a.target_id where a.contributor_member_id=m.id and t.status='ACTIVE' and t.currency=selected_currency and t.period_start<end_date and t.period_end>=start_date),0),
      'actual',coalesce((select sum(pc.amount) from public.performance_contributions pc join public.payments p on p.id=pc.payment_id where pc.contributor_member_id=m.id and p.status='CONFIRMED' and p.currency=selected_currency and p.paid_at>=start_date and p.paid_at<end_date),0),
      'forecast',coalesce((select sum(o.amount*o.probability/100.0) from public.opportunities o where o.owner_id=m.auth_user_id and o.currency=selected_currency and o.stage not in ('WON','LOST') and o.expected_close_date>=start_date and o.expected_close_date<end_date),0),
      'opportunities',(select count(*) from public.opportunities o where o.owner_id=m.auth_user_id and o.stage not in ('WON','LOST'))
    ) order by m.name_en) from public.sales_team_members m where m.id=any(visible_member_ids)),'[]'::jsonb),
    'trends',coalesce((select jsonb_agg(jsonb_build_object('date',series::date,'target',case when target_total=0 then 0 else target_total/greatest(1,(extract(year from age(end_date,start_date))*12+extract(month from age(end_date,start_date)))::integer) end,'actual',coalesce((select sum(pc.amount) from public.performance_contributions pc join public.payments p on p.id=pc.payment_id where pc.contributor_member_id=any(visible_member_ids) and p.status='CONFIRMED' and p.currency=selected_currency and p.paid_at>=series and p.paid_at<series+interval '1 month'),0)) order by series) from generate_series(start_date,end_date-interval '1 day',interval '1 month') series),'[]'::jsonb),
    'funnel',coalesce((select jsonb_agg(jsonb_build_object('stage',stage,'count',count,'amount',amount,'weighted',weighted) order by position(stage in 'DISCOVERY,EVALUATION,HESITATION,PAYMENT,WON,LOST')) from (select o.stage,count(*) count,sum(o.amount) amount,sum(o.amount*o.probability/100.0) weighted from public.opportunities o where o.workspace_id=ws and o.currency=selected_currency and o.owner_id=any(visible_user_ids) group by o.stage) f),'[]'::jsonb),
    'relationshipTargets',coalesce((select jsonb_build_object('contact',r.contact_target,'meal',r.meal_target,'family',r.family_chat_target,'advocacy',r.advocacy_target) from public.relationship_target_settings r where r.workspace_id=ws and r.period_start<=start_date and r.period_end>=end_date-1 and (r.manager_id is null or r.manager_id=auth.uid()) order by (r.manager_id is not null) desc,r.updated_at desc limit 1),jsonb_build_object('contact',90,'meal',65,'family',45,'advocacy',20)),
    'relationshipActual',jsonb_build_object(
      'contact',coalesce((select round(100.0*count(distinct rm.organization_id)/nullif(count(distinct o.id),0)) from public.organizations o left join public.relationship_milestones rm on rm.organization_id=o.id and rm.milestone_type='CONTACT' and rm.evidence_status<>'REJECTED' where o.workspace_id=ws and (actor_role in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR') or o.owner_id=any(visible_user_ids))),0),
      'meal',coalesce((select round(100.0*count(distinct rm.organization_id)/nullif(count(distinct o.id),0)) from public.organizations o left join public.relationship_milestones rm on rm.organization_id=o.id and rm.milestone_type='MEAL' and rm.evidence_status<>'REJECTED' where o.workspace_id=ws and (actor_role in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR') or o.owner_id=any(visible_user_ids))),0),
      'family',coalesce((select round(100.0*count(distinct rm.organization_id)/nullif(count(distinct o.id),0)) from public.organizations o left join public.relationship_milestones rm on rm.organization_id=o.id and rm.milestone_type='FAMILY_CHAT' and rm.evidence_status<>'REJECTED' where o.workspace_id=ws and (actor_role in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR') or o.owner_id=any(visible_user_ids))),0),
      'advocacy',coalesce((select round(100.0*count(distinct rm.organization_id)/nullif(count(distinct o.id),0)) from public.organizations o left join public.relationship_milestones rm on rm.organization_id=o.id and rm.milestone_type='ADVOCACY' and rm.evidence_status<>'REJECTED' where o.workspace_id=ws and (actor_role in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR') or o.owner_id=any(visible_user_ids))),0)
    ),
    'relationshipAccounts',coalesce((select jsonb_agg(row_data order by contract_value desc,name_en) from (select o.id,o.name_zh,o.name_en,coalesce(p.display_name_zh,'') owner_zh,coalesce(p.display_name_en,'') owner_en,coalesce(sum(c.contract_value),0) contract_value,
      exists(select 1 from public.relationship_milestones rm where rm.organization_id=o.id and rm.milestone_type='CONTACT' and rm.evidence_status<>'REJECTED') contact,
      exists(select 1 from public.relationship_milestones rm where rm.organization_id=o.id and rm.milestone_type='MEAL' and rm.evidence_status<>'REJECTED') meal,
      exists(select 1 from public.relationship_milestones rm where rm.organization_id=o.id and rm.milestone_type='FAMILY_CHAT' and rm.evidence_status<>'REJECTED') family,
      exists(select 1 from public.relationship_milestones rm where rm.organization_id=o.id and rm.milestone_type='ADVOCACY' and rm.evidence_status<>'REJECTED') advocacy
      from public.organizations o left join public.user_profiles p on p.user_id=o.owner_id left join public.contracts c on c.organization_id=o.id where o.workspace_id=ws and (actor_role in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR') or o.owner_id=any(visible_user_ids)) group by o.id,o.name_zh,o.name_en,p.display_name_zh,p.display_name_en order by contract_value desc limit 20) row_data),'[]'::jsonb)
  );
  return result;
end; $$;

revoke all on function public.upsert_relationship_milestone(uuid,text,text),public.save_relationship_targets(date,date,uuid,integer,integer,integer,integer),public.confirm_payment(uuid,text,jsonb),public.refund_payment(uuid,text),public.sales_performance_report(text,text) from public;
grant execute on function public.upsert_relationship_milestone(uuid,text,text),public.save_relationship_targets(date,date,uuid,integer,integer,integer,integer),public.confirm_payment(uuid,text,jsonb),public.refund_payment(uuid,text),public.sales_performance_report(text,text) to authenticated;

do $$
declare table_name text;
begin
  foreach table_name in array array['opportunities','crm_activities','relationship_milestones','relationship_target_settings','account_plans','performance_contributions','contract_versions','contract_documents'] loop
    execute format('drop trigger if exists audit_%I on public.%I',table_name,table_name);
    execute format('create trigger audit_%I after insert or update or delete on public.%I for each row execute procedure public.audit_row_change()',table_name,table_name);
  end loop;
end $$;
