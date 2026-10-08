-- Workforce configuration, not financial ownership. Approved period scopes
-- preserve history; eligibility events govern current/unapproved reporting.
set search_path=public,app_auth,extensions;
create table public.staff_business_profiles(
 workspace_id uuid not null references public.workspaces(id),
 member_id uuid primary key references public.sales_team_members(id),
 primary_function text not null check(primary_function in('SALES','FINANCE','OPERATIONS','ACADEMIC','CUSTOMER_SUCCESS','MANAGEMENT','ADMINISTRATION','OTHER')),
 additional_functions text[] not null default '{}' check(additional_functions <@ array['SALES','FINANCE','OPERATIONS','ACADEMIC','CUSTOMER_SUCCESS','MANAGEMENT','ADMINISTRATION','OTHER']::text[]),
 revision integer not null default 1,
 updated_by uuid references app_auth.accounts(id),updated_at timestamptz not null default now()
);
create table public.staff_sales_eligibility_events(
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id),
 member_id uuid not null references public.sales_team_members(id),eligible boolean not null,
 effective_from date not null,reason text not null check(length(trim(reason)) between 3 and 500),
 approved_by uuid not null references app_auth.accounts(id),created_at timestamptz not null default clock_timestamp()
);
create index staff_eligibility_asof on public.staff_sales_eligibility_events(member_id,effective_from desc,created_at desc,id desc);
create table public.staff_sales_period_scopes(
 workspace_id uuid not null references public.workspaces(id),member_id uuid not null references public.sales_team_members(id),
 target_id uuid not null references public.performance_targets(id),period_start date not null,period_end date not null,
 basis text not null check(basis in('APPROVED_LEGACY_ALLOCATION','APPROVED_ALLOCATION')),
 captured_at timestamptz not null default now(),primary key(target_id,member_id)
);
insert into public.staff_business_profiles(workspace_id,member_id,primary_function)
 select workspace_id,id,case when role like 'SALES\_%' escape '\' then 'SALES' when role in('ADMIN','SUPER_ADMIN') then 'ADMINISTRATION' when role like 'FINANCE_%' then 'FINANCE' when role like 'OPERATIONS_%' then 'OPERATIONS' when role='ACADEMIC_SPECIALIST' then 'ACADEMIC' when role='CUSTOMER_SUCCESS_SPECIALIST' then 'CUSTOMER_SUCCESS' else 'OTHER' end from public.sales_team_members;
-- An approved allocation is explicit historical authorization, unlike active=true.
insert into public.staff_sales_period_scopes(workspace_id,member_id,target_id,period_start,period_end,basis)
 select distinct t.workspace_id,a.contributor_member_id,t.id,t.period_start,t.period_end,'APPROVED_LEGACY_ALLOCATION' from public.performance_targets t join public.performance_allocations a on a.target_id=t.id where t.status in('ACTIVE','CLOSED') and a.contributor_member_id is not null;
create function public.staff_profile_on_create() returns trigger language plpgsql security definer set search_path=public as $$begin
 insert into public.staff_business_profiles(workspace_id,member_id,primary_function) values(new.workspace_id,new.id,case when new.role like 'SALES\_%' escape '\' then 'SALES' when new.role in('ADMIN','SUPER_ADMIN') then 'ADMINISTRATION' when new.role like 'FINANCE_%' then 'FINANCE' when new.role like 'OPERATIONS_%' then 'OPERATIONS' when new.role='ACADEMIC_SPECIALIST' then 'ACADEMIC' when new.role='CUSTOMER_SUCCESS_SPECIALIST' then 'CUSTOMER_SUCCESS' else 'OTHER' end);return new;
end $$;
create trigger staff_profile_create after insert on public.sales_team_members for each row execute function public.staff_profile_on_create();
create function public.staff_reporting_current(member uuid,as_of date default current_date) returns boolean
language sql stable security definer set search_path=public,app_auth as $$
 select coalesce((select e.eligible from public.staff_sales_eligibility_events e where e.member_id=member and e.effective_from<=as_of order by e.effective_from desc,e.created_at desc,e.id desc limit 1),false)
 and exists(select 1 from public.sales_team_members m join public.workspace_memberships w on w.workspace_id=m.workspace_id and w.user_id=m.auth_user_id and w.status='ACTIVE' join app_auth.accounts a on a.id=m.auth_user_id and a.status='ACTIVE' join public.sales_team_memberships tm on tm.member_id=m.id and tm.workspace_id=m.workspace_id and tm.status='ACTIVE' join public.sales_teams t on t.id=tm.team_id and t.workspace_id=m.workspace_id and t.active where m.id=member and m.active);
$$;
create function public.staff_reporting_at(member uuid,business_date date) returns boolean
language sql stable security definer set search_path=public as $$
 select exists(select 1 from public.staff_sales_period_scopes s where s.member_id=member and business_date between s.period_start and s.period_end)
 or coalesce((select e.eligible from public.staff_sales_eligibility_events e where e.member_id=member and e.effective_from<=business_date order by e.effective_from desc,e.created_at desc,e.id desc limit 1),false);
$$;
create function public.staff_reporting_in_period(member uuid,period_from date,period_to date) returns boolean
language sql stable security definer set search_path=public as $$
 select public.staff_reporting_current(member) or exists(select 1 from public.staff_sales_period_scopes s where s.member_id=member and s.period_start<period_to and s.period_end>=period_from)
 or exists(select 1 from (select e.*,lead(e.effective_from,1,date '9999-12-31') over(order by e.effective_from) until_date from (select distinct on(effective_from) * from public.staff_sales_eligibility_events where member_id=member order by effective_from,created_at desc,id desc) e) scope where scope.eligible and scope.effective_from<period_to and scope.until_date>period_from);
$$;
create function public.staff_profile_command(target_user uuid,expected_revision integer,primary_function text,additional_functions text[],sales_eligible boolean,effective_from date,reason text,p_request_key text) returns jsonb
language plpgsql security definer set search_path=public,app_auth,extensions as $$
declare ws uuid:=public.current_workspace_id();actor uuid:=app_auth.current_user_id();actor_role text;target_role text;member uuid;profile public.staff_business_profiles;
 receipt public.mutation_receipts;fingerprint text;result jsonb;
begin
 if current_setting('app.aal',true) is distinct from 'aal2' then raise exception 'MFA_REQUIRED';end if;
 if actor is null or not public.is_workspace_member(ws) then raise exception 'ROLE_ASSIGNMENT_FORBIDDEN';end if;
 if length(coalesce(p_request_key,'')) not between 8 and 160 or length(trim(coalesce(reason,''))) not between 3 and 500 or effective_from is null or effective_from<current_date or effective_from>current_date+366 or sales_eligible is null or additional_functions is null then raise exception 'INVALID_INPUT';end if;
 perform pg_advisory_xact_lock(hashtextextended(ws::text||':staff-identity',0));
 perform 1 from public.workspace_memberships where workspace_id=ws and user_id in(actor,target_user) order by user_id for update;
 select role into actor_role from public.workspace_memberships where workspace_id=ws and user_id=actor and status='ACTIVE';
 select role into target_role from public.workspace_memberships where workspace_id=ws and user_id=target_user;
 if actor_role is null or actor_role not in('SUPER_ADMIN','ADMIN') or (actor_role='ADMIN' and target_user<>actor and target_role in('ADMIN','SUPER_ADMIN')) then raise exception 'ROLE_ASSIGNMENT_FORBIDDEN';end if;
 fingerprint:=encode(digest(jsonb_build_array(target_user,expected_revision,primary_function,additional_functions,sales_eligible,effective_from,reason)::text,'sha256'),'hex');
 select * into receipt from public.mutation_receipts where workspace_id=ws and request_key=p_request_key;
 if found then if receipt.created_by<>actor or receipt.operation<>'STAFF_PROFILE_CHANGE' or receipt.result->>'request_hash'<>fingerprint then raise exception 'PAYLOAD_REUSE';end if;return receipt.result->'item';end if;
 select id into member from public.sales_team_members where workspace_id=ws and auth_user_id=target_user;
 select * into profile from public.staff_business_profiles where member_id=member for update;
 if not found then raise exception 'STAFF_USER_NOT_FOUND';end if;
 if profile.revision<>expected_revision then raise exception 'STALE_TARGET';end if;
 if sales_eligible and (not ('SALES'=primary_function or 'SALES'=any(additional_functions)) or not exists(select 1 from public.sales_team_memberships tm join public.sales_teams t on t.id=tm.team_id and t.workspace_id=ws and t.active where tm.member_id=member and tm.workspace_id=ws and tm.status='ACTIVE')) then raise exception 'SALES_ELIGIBILITY_REQUIRES_TEAM';end if;
 update public.staff_business_profiles p set primary_function=staff_profile_command.primary_function,additional_functions=staff_profile_command.additional_functions,revision=revision+1,updated_by=actor,updated_at=now() where member_id=member returning * into profile;
 insert into public.staff_sales_eligibility_events(workspace_id,member_id,eligible,effective_from,reason,approved_by) values(ws,member,sales_eligible,effective_from,trim(reason),actor);
 result:=jsonb_build_object('id',target_user,'revision',profile.revision,'primaryFunction',profile.primary_function,'additionalFunctions',profile.additional_functions,'salesEligible',public.staff_reporting_current(member),'effectiveFrom',effective_from,'updatedBy',actor,'updatedAt',profile.updated_at);
 insert into public.audit_events(workspace_id,actor_id,entity_type,entity_id,action,after_data) values(ws,actor,'staff_user',target_user::text,'STAFF_PROFILE_CHANGE',result);
 insert into public.mutation_receipts(workspace_id,request_key,operation,result,created_by) values(ws,p_request_key,'STAFF_PROFILE_CHANGE',jsonb_build_object('request_hash',fingerprint,'item',result),actor);return result;
end $$;
create function public.guard_staff_reporting_history() returns trigger language plpgsql as $$begin raise exception 'STAFF_REPORTING_HISTORY_IMMUTABLE';end $$;
create trigger staff_eligibility_immutable before update or delete on public.staff_sales_eligibility_events for each row execute function public.guard_staff_reporting_history();
create trigger staff_scope_immutable before update or delete on public.staff_sales_period_scopes for each row execute function public.guard_staff_reporting_history();
create function public.capture_staff_reporting_scope() returns trigger language plpgsql security definer set search_path=public as $$begin
 if new.status='ACTIVE' and old.status is distinct from 'ACTIVE' then
  if exists(select 1 from public.performance_allocations a where a.target_id=new.id and a.contributor_member_id is not null and not public.staff_reporting_current(a.contributor_member_id)) then raise exception 'SALES_CONTRIBUTOR_NOT_ELIGIBLE';end if;
  insert into public.staff_sales_period_scopes(workspace_id,member_id,target_id,period_start,period_end,basis) select new.workspace_id,a.contributor_member_id,new.id,new.period_start,new.period_end,'APPROVED_ALLOCATION' from public.performance_allocations a where a.target_id=new.id and a.contributor_member_id is not null on conflict do nothing;
 end if;return new;
end $$;
create trigger capture_staff_reporting_scope after update of status on public.performance_targets for each row execute function public.capture_staff_reporting_scope();
alter table public.staff_business_profiles enable row level security;
alter table public.staff_sales_eligibility_events enable row level security;
alter table public.staff_sales_period_scopes enable row level security;
create policy staff_profiles_read on public.staff_business_profiles for select to crm_app using(public.is_workspace_member(workspace_id) and public.crm_role() in('SUPER_ADMIN','ADMIN'));
create policy staff_eligibility_read on public.staff_sales_eligibility_events for select to crm_app using(public.is_workspace_member(workspace_id) and public.crm_role() in('SUPER_ADMIN','ADMIN'));
create policy staff_scopes_read on public.staff_sales_period_scopes for select to crm_app using(public.is_workspace_member(workspace_id) and public.crm_role() in('SUPER_ADMIN','ADMIN'));
revoke all on public.staff_business_profiles,public.staff_sales_eligibility_events,public.staff_sales_period_scopes from public,crm_app,crm_worker,crm_system;
grant select on public.staff_business_profiles,public.staff_sales_eligibility_events,public.staff_sales_period_scopes to crm_app,crm_system;
create policy system_staff_profiles_read on public.staff_business_profiles for select to crm_system using(true);
create policy system_staff_eligibility_read on public.staff_sales_eligibility_events for select to crm_system using(true);
create policy system_staff_scopes_read on public.staff_sales_period_scopes for select to crm_system using(true);
revoke all on function public.staff_profile_command(uuid,integer,text,text[],boolean,date,text,text) from public,crm_system,crm_worker;
grant execute on function public.staff_profile_command(uuid,integer,text,text[],boolean,date,text,text) to crm_app;
revoke all on function public.staff_reporting_current(uuid,date),public.staff_reporting_at(uuid,date),public.staff_reporting_in_period(uuid,date,date) from public;
grant execute on function public.staff_reporting_current(uuid,date),public.staff_reporting_at(uuid,date),public.staff_reporting_in_period(uuid,date,date) to crm_app,crm_system,crm_worker;

create or replace function public.performance_export_rows_v220(
  target_workspace uuid,period_from date,period_to date
)
returns table(
  staff_id uuid,name_zh text,name_en text,staff_role text,team text,
  period_start date,period_end date,currency text,allocated_target numeric,
  confirmed_performance numeric,base_currency text,exchange_rate numeric,
  rate_source text,rate_effective_at timestamptz,base_target numeric,base_actual numeric
)
language sql stable security definer set search_path=public,app_auth,extensions
as $$
  with workspace as (
    select id,default_currency from public.workspaces where id=target_workspace
  ), target_totals as (
    select a.contributor_member_id member_id,t.currency,sum(a.allocated_amount) amount
    from public.performance_allocations a
    join public.performance_targets t on t.id=a.target_id
    where t.workspace_id=target_workspace and t.status in('ACTIVE','CLOSED')
      and t.period_start<period_to and t.period_end>=period_from
      and a.contributor_member_id is not null
    group by a.contributor_member_id,t.currency
  ), actual_totals as (
    select pc.contributor_member_id member_id,p.currency,sum(pc.amount) amount
    from public.performance_contributions pc join public.payments p on p.id=pc.payment_id
    where p.workspace_id=target_workspace and p.status='CONFIRMED'
      and p.paid_at>=period_from and p.paid_at<period_to and public.staff_reporting_at(pc.contributor_member_id,p.paid_at::date)
    group by pc.contributor_member_id,p.currency
  ), currencies as (
    select member_id,currency from target_totals union select member_id,currency from actual_totals
  ), member_currency as (
    select m.id member_id,coalesce(c.currency,w.default_currency) currency
    from public.sales_team_members m cross join workspace w
    left join currencies c on c.member_id=m.id
    where m.workspace_id=target_workspace and public.staff_reporting_in_period(m.id,period_from,period_to)
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
returns jsonb language plpgsql security definer set search_path=public,app_auth,extensions
as $$
declare
  ws uuid:=public.current_workspace_id();actor_role text:=public.current_crm_role();
  start_date date;end_date date;selected_currency text:='CNY';
  visible_user_ids uuid[];visible_member_ids uuid[];result jsonb;target_total numeric:=0;
begin
  if ws is null or actor_role not in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER','SALES_SPECIALIST','SALES_SUPPORT') then raise exception 'not_authenticated'; end if;
  if report_period='month' then start_date:=date_trunc('month',current_date)::date;end_date:=(start_date+interval '1 month')::date;
  elsif report_period='year' then start_date:=date_trunc('year',current_date)::date;end_date:=(start_date+interval '1 year')::date;
  else start_date:=date_trunc('quarter',current_date)::date;end_date:=(start_date+interval '3 months')::date;report_period:='quarter';end if;
  select coalesce(array_agg(m.id),'{}'),coalesce(array_agg(m.auth_user_id) filter(where m.auth_user_id is not null),'{}')
  into visible_member_ids,visible_user_ids from public.sales_team_members m
  where m.workspace_id=ws and public.staff_reporting_in_period(m.id,start_date,end_date) and (team_filter is null or team_filter='' or team_filter='all' or m.team=team_filter)
    and (actor_role in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR') or m.auth_user_id=app_auth.current_user_id() or (actor_role='SALES_MANAGER' and m.manager_member_id=(select own.id from public.sales_team_members own where own.workspace_id=ws and own.auth_user_id=app_auth.current_user_id() limit 1)));
  if nullif(trim(currency_filter),'') is not null and upper(trim(currency_filter))~'^[A-Z]{3}$' then
    selected_currency:=upper(trim(currency_filter));
  else
    select coalesce((select t.currency from public.performance_targets t where t.workspace_id=ws and t.status in('ACTIVE','CLOSED') and t.period_start<end_date and t.period_end>=start_date order by t.updated_at desc limit 1),(select p.currency from public.payments p where p.workspace_id=ws and p.status='CONFIRMED' order by p.paid_at desc nulls last limit 1),(select default_currency from public.workspaces where id=ws),'CNY') into selected_currency;
  end if;
  select coalesce(sum(a.allocated_amount),0) into target_total from public.performance_allocations a join public.performance_targets t on t.id=a.target_id join public.sales_team_members m on m.id=a.contributor_member_id
  where t.workspace_id=ws and t.status in('ACTIVE','CLOSED') and t.currency=selected_currency and t.period_start<end_date and t.period_end>=start_date and m.id=any(visible_member_ids);

  result:=jsonb_build_object(
    'period',report_period,'periodStart',start_date,'periodEnd',end_date-1,'currency',selected_currency,
    'currencies',coalesce((select jsonb_agg(currency order by currency) from (select distinct currency from public.opportunities where workspace_id=ws and owner_id=any(visible_user_ids) union select distinct currency from public.performance_targets where workspace_id=ws union select distinct currency from public.payments where workspace_id=ws) values_by_currency),'[]'::jsonb),
    'reportingPolicy','APPROVED_PERIOD_SCOPE_OR_EFFECTIVE_QUALIFICATION','target',target_total,
    'unscopedActual',case when actor_role in ('ADMIN','SUPER_ADMIN','SALES_DIRECTOR') then coalesce((select sum(pc.amount) from public.performance_contributions pc join public.payments p on p.id=pc.payment_id where p.workspace_id=ws and p.currency=selected_currency and p.status='CONFIRMED' and p.paid_at>=start_date and p.paid_at<end_date and not public.staff_reporting_at(pc.contributor_member_id,p.paid_at::date)),0) else null end,
    'actual',coalesce((select sum(pc.amount) from public.payments p join public.performance_contributions pc on pc.payment_id=p.id where p.workspace_id=ws and p.status='CONFIRMED' and p.currency=selected_currency and p.paid_at>=start_date and p.paid_at<end_date and public.staff_reporting_at(pc.contributor_member_id,p.paid_at::date) and pc.contributor_member_id=any(visible_member_ids)),0),
    'forecast',coalesce((select sum(o.amount*o.probability/100.0) from public.opportunities o where o.workspace_id=ws and o.currency=selected_currency and o.owner_id=any(visible_user_ids) and exists(select 1 from public.sales_team_members current_member where current_member.auth_user_id=o.owner_id and current_member.workspace_id=ws and public.staff_reporting_current(current_member.id)) and o.stage not in ('WON','LOST') and o.expected_close_date>=start_date and o.expected_close_date<end_date),0),
    'teams',coalesce((select jsonb_agg(distinct m.team order by m.team) from public.sales_team_members m where m.id=any(visible_member_ids)),'[]'::jsonb),
    'members',coalesce((select jsonb_agg(jsonb_build_object(
      'id',m.id,'nameZh',m.name_zh,'nameEn',m.name_en,'team',m.team,'role',m.role,
      'target',coalesce((select sum(a.allocated_amount) from public.performance_allocations a join public.performance_targets t on t.id=a.target_id where a.contributor_member_id=m.id and t.status in('ACTIVE','CLOSED') and t.currency=selected_currency and t.period_start<end_date and t.period_end>=start_date),0),
      'actual',coalesce((select sum(pc.amount) from public.performance_contributions pc join public.payments p on p.id=pc.payment_id where pc.contributor_member_id=m.id and p.status='CONFIRMED' and p.currency=selected_currency and p.paid_at>=start_date and p.paid_at<end_date and public.staff_reporting_at(pc.contributor_member_id,p.paid_at::date)),0),
      'forecast',coalesce((select sum(o.amount*o.probability/100.0) from public.opportunities o where o.owner_id=m.auth_user_id and public.staff_reporting_current(m.id) and o.currency=selected_currency and o.stage not in ('WON','LOST') and o.expected_close_date>=start_date and o.expected_close_date<end_date),0),
      'opportunities',(select count(*) from public.opportunities o where o.owner_id=m.auth_user_id and public.staff_reporting_current(m.id) and o.currency=selected_currency and o.stage not in ('WON','LOST'))
    ) order by m.name_en) from public.sales_team_members m where m.id=any(visible_member_ids)),'[]'::jsonb),
    'trends',coalesce((select jsonb_agg(jsonb_build_object('date',series::date,'target',case when target_total=0 then 0 else target_total/greatest(1,(extract(year from age(end_date,start_date))*12+extract(month from age(end_date,start_date)))::integer) end,'actual',coalesce((select sum(pc.amount) from public.performance_contributions pc join public.payments p on p.id=pc.payment_id where pc.contributor_member_id=any(visible_member_ids) and p.status='CONFIRMED' and p.currency=selected_currency and p.paid_at>=series and p.paid_at<series+interval '1 month' and public.staff_reporting_at(pc.contributor_member_id,p.paid_at::date)),0)) order by series) from generate_series(start_date,end_date-interval '1 day',interval '1 month') series),'[]'::jsonb),
    'funnel',coalesce((select jsonb_agg(jsonb_build_object('stage',stage,'count',count,'amount',amount,'weighted',weighted) order by position(stage in 'DISCOVERY,EVALUATION,HESITATION,PAYMENT,WON,LOST')) from (select o.stage,count(*) count,sum(o.amount) amount,sum(o.amount*o.probability/100.0) weighted from public.opportunities o where o.workspace_id=ws and o.currency=selected_currency and o.owner_id=any(visible_user_ids) and exists(select 1 from public.sales_team_members current_member where current_member.auth_user_id=o.owner_id and current_member.workspace_id=ws and public.staff_reporting_current(current_member.id)) group by o.stage) f),'[]'::jsonb),
    'relationshipTargets',coalesce((select jsonb_build_object('contact',r.contact_target,'meal',r.meal_target,'family',r.family_chat_target,'advocacy',r.advocacy_target) from public.relationship_target_settings r where r.workspace_id=ws and r.period_start<=start_date and r.period_end>=end_date-1 and (r.manager_id is null or r.manager_id=app_auth.current_user_id()) order by (r.manager_id is not null) desc,r.updated_at desc limit 1),jsonb_build_object('contact',90,'meal',65,'family',45,'advocacy',20)),
    'relationshipActual',jsonb_build_object(
      'contact',coalesce((select round(100.0*count(distinct rm.organization_id)/nullif(count(distinct o.id),0)) from public.organizations o left join public.relationship_milestones rm on rm.organization_id=o.id and rm.milestone_type='CONTACT' and rm.evidence_status<>'REJECTED' where o.workspace_id=ws and (actor_role in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR') or o.owner_id=any(visible_user_ids) and exists(select 1 from public.sales_team_members current_member where current_member.auth_user_id=o.owner_id and current_member.workspace_id=ws and public.staff_reporting_current(current_member.id)))),0),
      'meal',coalesce((select round(100.0*count(distinct rm.organization_id)/nullif(count(distinct o.id),0)) from public.organizations o left join public.relationship_milestones rm on rm.organization_id=o.id and rm.milestone_type='MEAL' and rm.evidence_status<>'REJECTED' where o.workspace_id=ws and (actor_role in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR') or o.owner_id=any(visible_user_ids) and exists(select 1 from public.sales_team_members current_member where current_member.auth_user_id=o.owner_id and current_member.workspace_id=ws and public.staff_reporting_current(current_member.id)))),0),
      'family',coalesce((select round(100.0*count(distinct rm.organization_id)/nullif(count(distinct o.id),0)) from public.organizations o left join public.relationship_milestones rm on rm.organization_id=o.id and rm.milestone_type='FAMILY_CHAT' and rm.evidence_status<>'REJECTED' where o.workspace_id=ws and (actor_role in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR') or o.owner_id=any(visible_user_ids) and exists(select 1 from public.sales_team_members current_member where current_member.auth_user_id=o.owner_id and current_member.workspace_id=ws and public.staff_reporting_current(current_member.id)))),0),
      'advocacy',coalesce((select round(100.0*count(distinct rm.organization_id)/nullif(count(distinct o.id),0)) from public.organizations o left join public.relationship_milestones rm on rm.organization_id=o.id and rm.milestone_type='ADVOCACY' and rm.evidence_status<>'REJECTED' where o.workspace_id=ws and (actor_role in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR') or o.owner_id=any(visible_user_ids) and exists(select 1 from public.sales_team_members current_member where current_member.auth_user_id=o.owner_id and current_member.workspace_id=ws and public.staff_reporting_current(current_member.id)))),0)
    ),
    'relationshipAccounts',coalesce((select jsonb_agg(row_data order by contract_value desc,name_en) from (select o.id,o.name_zh,o.name_en,coalesce(p.display_name_zh,'') owner_zh,coalesce(p.display_name_en,'') owner_en,coalesce(sum(c.contract_value),0) contract_value,
      exists(select 1 from public.relationship_milestones rm where rm.organization_id=o.id and rm.milestone_type='CONTACT' and rm.evidence_status<>'REJECTED') contact,
      exists(select 1 from public.relationship_milestones rm where rm.organization_id=o.id and rm.milestone_type='MEAL' and rm.evidence_status<>'REJECTED') meal,
      exists(select 1 from public.relationship_milestones rm where rm.organization_id=o.id and rm.milestone_type='FAMILY_CHAT' and rm.evidence_status<>'REJECTED') family,
      exists(select 1 from public.relationship_milestones rm where rm.organization_id=o.id and rm.milestone_type='ADVOCACY' and rm.evidence_status<>'REJECTED') advocacy
      from public.organizations o left join public.user_profiles p on p.user_id=o.owner_id left join public.contracts c on c.organization_id=o.id and c.currency=selected_currency where o.workspace_id=ws and (actor_role in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR') or o.owner_id=any(visible_user_ids) and exists(select 1 from public.sales_team_members current_member where current_member.auth_user_id=o.owner_id and current_member.workspace_id=ws and public.staff_reporting_current(current_member.id))) group by o.id,o.name_zh,o.name_en,p.display_name_zh,p.display_name_en order by contract_value desc limit 20) row_data),'[]'::jsonb)
  );
  return result;
end;
$$;

create function public.staff_sales_roster() returns table(id uuid,name_zh text,name_en text,role text,team text)
language sql stable security definer set search_path=public,app_auth as $$
 select m.id,m.name_zh,m.name_en,m.role,m.team from public.sales_team_members m
 where m.workspace_id=public.current_workspace_id() and public.is_workspace_member(m.workspace_id)
 and public.current_crm_role() in('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER')
 and public.staff_reporting_current(m.id)
 and (public.current_crm_role() in('SUPER_ADMIN','ADMIN','SALES_DIRECTOR') or m.manager_member_id=(select own.id from public.sales_team_members own where own.workspace_id=m.workspace_id and own.auth_user_id=app_auth.current_user_id() limit 1)) order by m.name_en;
$$;
revoke all on function public.staff_sales_roster() from public,crm_system,crm_worker;
grant execute on function public.staff_sales_roster() to crm_app;
-- Reject non-qualified contributors before a new draft plan can be submitted.
create function public.check_staff_allocation_eligibility() returns trigger language plpgsql security definer set search_path=public as $$begin
 if new.contributor_member_id is not null and not public.staff_reporting_current(new.contributor_member_id) then raise exception 'SALES_CONTRIBUTOR_NOT_ELIGIBLE';end if;return new;
end $$;
create trigger staff_allocation_eligibility before insert or update of contributor_member_id on public.performance_allocations for each row execute function public.check_staff_allocation_eligibility();

-- contributor_role is the legacy allocation responsibility, not the account access role.
create or replace function public.save_performance_plan(plan_id uuid, manager uuid, period_from date, period_to date, plan_currency text, plan_amount numeric, plan_allocations jsonb)
returns public.performance_targets language plpgsql security definer set search_path=public,app_auth,extensions
as $$
declare target public.performance_targets; item jsonb; member public.sales_team_members; actor_role text:=public.current_crm_role(); actor_member uuid;
begin
  if app_auth.current_user_id() is null or actor_role not in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER') then raise exception 'performance_not_authorized'; end if;
  select id into actor_member from public.sales_team_members where workspace_id=public.current_workspace_id() and auth_user_id=app_auth.current_user_id() and active;
  if manager<>app_auth.current_user_id() and actor_role not in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR') and not exists(
    select 1 from public.sales_team_members report where report.workspace_id=public.current_workspace_id() and report.auth_user_id=manager and report.manager_member_id=actor_member and report.active
  ) then raise exception 'performance_manager_scope'; end if;
  if period_to<period_from or plan_amount<=0 or plan_currency !~ '^[A-Z]{3}$' then raise exception 'performance_invalid_target'; end if;
  if plan_id is null then
    insert into public.performance_targets(workspace_id,manager_id,period_start,period_end,currency,target_amount,status,created_by)
    values(public.current_workspace_id(),manager,period_from,period_to,plan_currency,plan_amount,'DRAFT',app_auth.current_user_id()) returning * into target;
  else
    select * into target from public.performance_targets where id=plan_id and workspace_id=public.current_workspace_id() for update;
    if not found or target.status<>'DRAFT' then raise exception 'performance_plan_locked'; end if;
    update public.performance_targets set manager_id=manager,period_start=period_from,period_end=period_to,currency=plan_currency,target_amount=plan_amount,version=version+1,updated_at=now() where id=plan_id returning * into target;
    delete from public.performance_allocations where target_id=target.id;
  end if;
  for item in select * from jsonb_array_elements(coalesce(plan_allocations,'[]'::jsonb)) loop
    select * into member from public.sales_team_members where id=(item->>'contributorMemberId')::uuid and workspace_id=target.workspace_id and active;
    if not found or not public.staff_reporting_current(member.id) then raise exception 'performance_invalid_contributor'; end if;
    if actor_role='SALES_MANAGER' and member.manager_member_id<>actor_member then raise exception 'performance_contributor_scope'; end if;
    insert into public.performance_allocations(target_id,contributor_member_id,contributor_role,attribution_type,allocated_amount,created_by)
    values(target.id,member.id,case when member.role='SALES_SUPPORT' then 'SALES_SUPPORT' else 'SALES_SPECIALIST' end,upper(item->>'attributionType'),(item->>'amount')::numeric,app_auth.current_user_id());
  end loop;
  return target;
end; $$;
