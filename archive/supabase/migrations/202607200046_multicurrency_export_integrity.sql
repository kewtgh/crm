-- v2.2.0: explicit currency scope and verifiable export integrity.

alter table public.generated_jobs
  add column if not exists expected_row_count integer,
  add column if not exists exported_row_count integer,
  add column if not exists artifact_sha256 text,
  add column if not exists query_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists currency_scope text[] not null default '{}'::text[];
alter table public.generated_jobs drop constraint if exists generated_jobs_row_counts_check;
alter table public.generated_jobs add constraint generated_jobs_row_counts_check check(
  (expected_row_count is null or expected_row_count>=0)
  and (exported_row_count is null or exported_row_count>=0)
  and (status<>'READY' or expected_row_count=exported_row_count)
);
alter table public.generated_jobs drop constraint if exists generated_jobs_artifact_sha256_check;
alter table public.generated_jobs add constraint generated_jobs_artifact_sha256_check
  check(artifact_sha256 is null or artifact_sha256~'^[a-f0-9]{64}$');

create or replace function public.performance_export_rows_v220(
  target_workspace uuid,period_from date,period_to date
)
returns table(
  staff_id uuid,name_zh text,name_en text,staff_role text,team text,
  period_start date,period_end date,currency text,allocated_target numeric,
  confirmed_performance numeric,base_currency text,exchange_rate numeric,
  rate_source text,rate_effective_at timestamptz,base_target numeric,base_actual numeric
)
language sql stable security definer set search_path=public
as $$
  with workspace as (
    select id,default_currency from public.workspaces where id=target_workspace
  ), target_totals as (
    select a.contributor_member_id member_id,t.currency,sum(a.allocated_amount) amount
    from public.performance_allocations a
    join public.performance_targets t on t.id=a.target_id
    where t.workspace_id=target_workspace and t.status='ACTIVE'
      and t.period_start<period_to and t.period_end>=period_from
      and a.contributor_member_id is not null
    group by a.contributor_member_id,t.currency
  ), actual_totals as (
    select pc.contributor_member_id member_id,p.currency,sum(pc.amount) amount
    from public.performance_contributions pc join public.payments p on p.id=pc.payment_id
    where p.workspace_id=target_workspace and p.status='CONFIRMED'
      and p.paid_at>=period_from and p.paid_at<period_to
    group by pc.contributor_member_id,p.currency
  ), currencies as (
    select member_id,currency from target_totals union select member_id,currency from actual_totals
  ), member_currency as (
    select m.id member_id,coalesce(c.currency,w.default_currency) currency
    from public.sales_team_members m cross join workspace w
    left join currencies c on c.member_id=m.id
    where m.workspace_id=target_workspace and m.active
  )
  select m.id,m.name_zh,m.name_en,m.role,m.team,period_from,period_to-1,mc.currency,
    coalesce(target.amount,0),coalesce(actual.amount,0),w.default_currency,
    case when mc.currency=w.default_currency then 1 else rate.rate end,
    case when mc.currency=w.default_currency then 'BASE' else rate.source end,
    case when mc.currency=w.default_currency then period_from::timestamptz else rate.effective_at end,
    case when mc.currency=w.default_currency then coalesce(target.amount,0)
      when rate.rate is null then null else round(coalesce(target.amount,0)/rate.rate,2) end,
    case when mc.currency=w.default_currency then coalesce(actual.amount,0)
      when rate.rate is null then null else round(coalesce(actual.amount,0)/rate.rate,2) end
  from member_currency mc
  join public.sales_team_members m on m.id=mc.member_id
  cross join workspace w
  left join target_totals target on target.member_id=mc.member_id and target.currency=mc.currency
  left join actual_totals actual on actual.member_id=mc.member_id and actual.currency=mc.currency
  left join lateral(
    select snapshot.rate,snapshot.source,snapshot.effective_at
    from public.exchange_rate_snapshots snapshot
    where snapshot.workspace_id=target_workspace
      and snapshot.base_currency=w.default_currency and snapshot.quote_currency=mc.currency
      and snapshot.effective_at<period_to::timestamptz
    order by snapshot.effective_at desc limit 1
  ) rate on mc.currency<>w.default_currency
  order by m.name_en,mc.currency;
$$;

create or replace function public.sales_performance_report_v220(
  report_period text default 'quarter',team_filter text default null,currency_filter text default null
)
returns jsonb language plpgsql security definer set search_path=public
as $$
declare
  ws uuid:=public.current_workspace_id();actor_role text:=public.current_crm_role();
  start_date date;end_date date;selected_currency text:='CNY';
  visible_user_ids uuid[];visible_member_ids uuid[];result jsonb;target_total numeric:=0;
begin
  if ws is null or actor_role='' then raise exception 'not_authenticated'; end if;
  if report_period='month' then start_date:=date_trunc('month',current_date)::date;end_date:=(start_date+interval '1 month')::date;
  elsif report_period='year' then start_date:=date_trunc('year',current_date)::date;end_date:=(start_date+interval '1 year')::date;
  else start_date:=date_trunc('quarter',current_date)::date;end_date:=(start_date+interval '3 months')::date;report_period:='quarter';end if;
  select coalesce(array_agg(m.id),'{}'),coalesce(array_agg(m.auth_user_id) filter(where m.auth_user_id is not null),'{}')
  into visible_member_ids,visible_user_ids from public.sales_team_members m
  where m.workspace_id=ws and m.active and (team_filter is null or team_filter='' or team_filter='all' or m.team=team_filter)
    and (actor_role in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR') or m.auth_user_id=auth.uid() or (actor_role='SALES_MANAGER' and m.manager_member_id=(select own.id from public.sales_team_members own where own.workspace_id=ws and own.auth_user_id=auth.uid() limit 1)));
  if nullif(trim(currency_filter),'') is not null and upper(trim(currency_filter))~'^[A-Z]{3}$' then
    selected_currency:=upper(trim(currency_filter));
  else
    select coalesce((select t.currency from public.performance_targets t where t.workspace_id=ws and t.status='ACTIVE' and t.period_start<end_date and t.period_end>=start_date order by t.updated_at desc limit 1),(select p.currency from public.payments p where p.workspace_id=ws and p.status='CONFIRMED' order by p.paid_at desc nulls last limit 1),(select default_currency from public.workspaces where id=ws),'CNY') into selected_currency;
  end if;
  select coalesce(sum(a.allocated_amount),0) into target_total from public.performance_allocations a join public.performance_targets t on t.id=a.target_id join public.sales_team_members m on m.id=a.contributor_member_id
  where t.workspace_id=ws and t.status='ACTIVE' and t.currency=selected_currency and t.period_start<end_date and t.period_end>=start_date and m.id=any(visible_member_ids);
  if target_total=0 then select coalesce(sum(t.target_amount),0) into target_total from public.performance_targets t where t.workspace_id=ws and t.status='ACTIVE' and t.currency=selected_currency and t.period_start<end_date and t.period_end>=start_date and t.manager_id=any(visible_user_ids);end if;
  result:=jsonb_build_object(
    'period',report_period,'periodStart',start_date,'periodEnd',end_date-1,'currency',selected_currency,
    'currencies',coalesce((select jsonb_agg(currency order by currency) from (select distinct currency from public.opportunities where workspace_id=ws and owner_id=any(visible_user_ids) union select distinct currency from public.performance_targets where workspace_id=ws union select distinct currency from public.payments where workspace_id=ws) values_by_currency),'[]'::jsonb),
    'target',target_total,
    'actual',coalesce((select sum(pc.amount) from public.payments p join public.performance_contributions pc on pc.payment_id=p.id where p.workspace_id=ws and p.status='CONFIRMED' and p.currency=selected_currency and p.paid_at>=start_date and p.paid_at<end_date and pc.contributor_member_id=any(visible_member_ids)),0),
    'forecast',coalesce((select sum(o.amount*o.probability/100.0) from public.opportunities o where o.workspace_id=ws and o.currency=selected_currency and o.owner_id=any(visible_user_ids) and o.stage not in ('WON','LOST') and o.expected_close_date>=start_date and o.expected_close_date<end_date),0),
    'teams',coalesce((select jsonb_agg(distinct m.team order by m.team) from public.sales_team_members m where m.id=any(visible_member_ids)),'[]'::jsonb),
    'members',coalesce((select jsonb_agg(jsonb_build_object(
      'id',m.id,'nameZh',m.name_zh,'nameEn',m.name_en,'team',m.team,'role',m.role,
      'target',coalesce((select sum(a.allocated_amount) from public.performance_allocations a join public.performance_targets t on t.id=a.target_id where a.contributor_member_id=m.id and t.status='ACTIVE' and t.currency=selected_currency and t.period_start<end_date and t.period_end>=start_date),0),
      'actual',coalesce((select sum(pc.amount) from public.performance_contributions pc join public.payments p on p.id=pc.payment_id where pc.contributor_member_id=m.id and p.status='CONFIRMED' and p.currency=selected_currency and p.paid_at>=start_date and p.paid_at<end_date),0),
      'forecast',coalesce((select sum(o.amount*o.probability/100.0) from public.opportunities o where o.owner_id=m.auth_user_id and o.currency=selected_currency and o.stage not in ('WON','LOST') and o.expected_close_date>=start_date and o.expected_close_date<end_date),0),
      'opportunities',(select count(*) from public.opportunities o where o.owner_id=m.auth_user_id and o.currency=selected_currency and o.stage not in ('WON','LOST'))
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
      from public.organizations o left join public.user_profiles p on p.user_id=o.owner_id left join public.contracts c on c.organization_id=o.id and c.currency=selected_currency where o.workspace_id=ws and (actor_role in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR') or o.owner_id=any(visible_user_ids)) group by o.id,o.name_zh,o.name_en,p.display_name_zh,p.display_name_en order by contract_value desc limit 20) row_data),'[]'::jsonb)
  );
  return result;
end;
$$;

revoke all on function public.performance_export_rows_v220(uuid,date,date) from public,anon,authenticated;
grant execute on function public.performance_export_rows_v220(uuid,date,date) to service_role;
revoke all on function public.sales_performance_report_v220(text,text,text) from public,anon;
grant execute on function public.sales_performance_report_v220(text,text,text) to authenticated;

notify pgrst,'reload schema';

