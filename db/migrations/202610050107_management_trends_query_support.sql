-- Read-only forward query support. Frozen 103–106 remain unchanged.
set search_path=public,app_auth,extensions;

create function public.management_overview_filtered(p_filters jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable security invoker set search_path=public,app_auth as $$
declare ws uuid:=public.current_workspace_id();actor_role text:=public.current_crm_role();tz text;today date;
 date_from date;date_to date;lower_bound timestamptz;upper_bound timestamptz;finance_visible boolean;
 channel_report jsonb;success_report jsonb;result jsonb;
begin
 if app_auth.current_user_id() is null or not public.is_workspace_member(ws) or actor_role not in
 ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER','SALES_SPECIALIST','SALES_SUPPORT') then raise exception 'management_forbidden';end if;
 if jsonb_typeof(p_filters) is distinct from 'object' or exists(select 1 from jsonb_object_keys(p_filters) k where k not in ('from','to','productId','cohortId')) then raise exception 'management_input_invalid';end if;
 select business_timezone into tz from public.workspaces where id=ws;today:=(current_timestamp at time zone tz)::date;
 date_from:=coalesce((p_filters->>'from')::date,today-29);date_to:=coalesce((p_filters->>'to')::date,today);
 if not isfinite(date_from) or not isfinite(date_to) or date_from>date_to or date_to-date_from>=730 then raise exception 'management_input_invalid';end if;
 lower_bound:=date_from::timestamp at time zone tz;upper_bound:=(date_to+1)::timestamp at time zone tz;
 finance_visible:=actor_role in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR') or exists(select 1 from public.contracts where workspace_id=ws);
 channel_report:=public.channel_analytics(jsonb_strip_nulls(jsonb_build_object('from',date_from,'to',date_to,'product',p_filters->>'productId','cohort',p_filters->>'cohortId')));
 success_report:=public.student_success_analytics(jsonb_strip_nulls(jsonb_build_object('from',date_from,'to',date_to,'productId',p_filters->>'productId','cohortId',p_filters->>'cohortId')));
 with
 leads as materialized(select * from public.leads where workspace_id=ws),
 opp as materialized(select o.* from public.opportunities o where o.workspace_id=ws
  and ((o.organization_id is not null and public.customer_subject_access('ORGANIZATION',o.organization_id,false))
   or (o.household_id is not null and public.customer_subject_access('HOUSEHOLD',o.household_id,false)))
  and (o.primary_contact_id is null or public.customer_subject_access('CONTACT',o.primary_contact_id,false)) and (nullif(p_filters->>'productId','') is null or o.product_id=(p_filters->>'productId')::uuid) and (nullif(p_filters->>'cohortId','') is null or o.cohort_id=(p_filters->>'cohortId')::uuid)),
 enrollment as materialized(select e.* from public.student_enrollments e join public.product_cohorts co on co.id=e.cohort_id and co.workspace_id=e.workspace_id where e.workspace_id=ws and (nullif(p_filters->>'productId','') is null or co.product_id=(p_filters->>'productId')::uuid) and (nullif(p_filters->>'cohortId','') is null or e.cohort_id=(p_filters->>'cohortId')::uuid)),
 history as materialized(select h.* from public.student_enrollment_status_history h join enrollment e on e.id=h.enrollment_id and e.workspace_id=h.workspace_id),
 finance as materialized(select f.* from public.contract_finance_snapshot f where f.workspace_id=ws and finance_visible and (nullif(p_filters->>'productId','') is null or f.product_id=(p_filters->>'productId')::uuid) and (nullif(p_filters->>'cohortId','') is null or (select co.id from public.contract_enrollment_links l join public.student_enrollments e on e.id=l.enrollment_id and e.workspace_id=l.workspace_id join public.product_cohorts co on co.id=e.cohort_id and co.workspace_id=e.workspace_id where l.contract_id=f.contract_id and l.workspace_id=f.workspace_id and l.status='ACTIVE' and co.id=(p_filters->>'cohortId')::uuid limit 1)=(p_filters->>'cohortId')::uuid)),
 payment as materialized(select p.* from public.payments p join finance c on c.contract_id=p.contract_id and c.workspace_id=p.workspace_id where p.status in ('CONFIRMED','REFUNDED')),
 refund as materialized(select r.*,p.currency from public.refunds r join payment p on p.id=r.payment_id and p.workspace_id=r.workspace_id where r.status='PAID'),
 apps as materialized(select a.* from public.student_applications a join enrollment e on e.id=a.enrollment_id and e.workspace_id=a.workspace_id where a.workspace_id=ws),
 milestone as materialized(select m.* from public.admission_milestones m join enrollment e on e.id=m.enrollment_id and e.workspace_id=m.workspace_id where m.workspace_id=ws),
 workflow as materialized(select w.* from public.workflow_instances w join enrollment e on e.id=w.enrollment_id and e.workspace_id=w.workspace_id where w.workspace_id=ws),
 cases as materialized(select * from public.student_success_records where workspace_id=ws and (nullif(p_filters->>'productId','') is null or product_id=(p_filters->>'productId')::uuid) and (nullif(p_filters->>'cohortId','') is null or cohort_id=(p_filters->>'cohortId')::uuid)),
 risks as materialized(select r.* from public.student_success_risk_signals r join cases c on c.id=r.case_id and c.workspace_id=r.workspace_id),
 supported_quality as materialized(select q.* from public.data_quality_issues q where q.workspace_id=ws and q.status in ('OPEN','ASSIGNED') and (
  (q.entity_type='ORGANIZATION' and exists(select 1 from public.organizations o where o.id=q.entity_id and o.workspace_id=ws))
  or (q.entity_type='CONTACT' and exists(select 1 from public.contacts p where p.id=q.entity_id and p.workspace_id=ws))
  or (q.entity_type='OPPORTUNITY' and exists(select 1 from opp o where o.id=q.entity_id))
  or (q.entity_type='CONTRACT' and exists(select 1 from finance c where c.contract_id=q.entity_id))
  or (q.entity_type='ENROLLMENT' and exists(select 1 from enrollment e where e.id=q.entity_id))
  or (q.entity_type='APPLICATION' and exists(select 1 from apps a where a.id=q.entity_id))
  or (q.entity_type='ADMISSION_MILESTONE' and exists(select 1 from milestone m where m.id=q.entity_id))
  or (q.entity_type='WORKFLOW' and exists(select 1 from workflow w where w.id=q.entity_id))
  or (q.entity_type='STUDENT_SUCCESS_CASE' and exists(select 1 from cases c where c.id=q.entity_id))
  or (q.entity_type='STUDENT_SUCCESS_GOAL' and exists(select 1 from public.student_success_goals g join cases c on c.id=g.case_id and c.workspace_id=g.workspace_id where g.id=q.entity_id))
  or (q.entity_type='STUDENT_SUCCESS_RISK' and exists(select 1 from risks r where r.id=q.entity_id))
  or (q.entity_type='STUDENT_SUCCESS_INTERVENTION' and exists(select 1 from public.student_success_interventions i join cases c on c.id=i.case_id and c.workspace_id=i.workspace_id where i.id=q.entity_id))
 )),
 attention as (
  select 'FINANCE'::text source_domain,'RECEIVABLE'::text source_type,r.id source_id,r.contract_id context_id,'OVERDUE_RECEIVABLE'::text reason_code,'ATTENTION'::text severity,r.due_date::text business_date,f.contract_number::text source_reference
  from public.receivable_schedules r join finance f on f.contract_id=r.contract_id and f.workspace_id=r.workspace_id where r.amount>r.paid_amount and r.due_date<today
  union all select 'ADMISSIONS','MILESTONE',m.id,m.enrollment_id,'OVERDUE_MILESTONE','ATTENTION',m.due_at::text,null from milestone m where m.status not in ('COMPLETED','WAIVED','CANCELLED') and m.due_at<current_timestamp
  union all select 'ADMISSIONS','WORKFLOW',w.id,w.enrollment_id,'BLOCKED_WORKFLOW','ATTENTION',w.started_at::text,null from workflow w where w.status='BLOCKED'
  union all select 'STUDENT_SUCCESS','RISK',r.id,r.case_id,'HIGH_OPEN_RISK','CRITICAL',r.observed_at::text,null from risks r where r.severity='HIGH' and r.status in ('OPEN','MONITORING')
  union all select 'STUDENT_SUCCESS','CASE',c.id,c.id,'STALE_CHECKIN','ATTENTION',coalesce(c.last_checkin_at,c.created_at)::text,null from cases c where c.status='ACTIVE' and coalesce(c.last_checkin_at,c.created_at) at time zone tz < (today-30)::timestamp
  union all select 'DATA_QUALITY',q.entity_type,q.entity_id,coalesce(
   (select case_id from public.student_success_goals where id=q.entity_id),
   (select case_id from risks where id=q.entity_id),
   (select case_id from public.student_success_interventions where id=q.entity_id),
   (select enrollment_id from milestone where id=q.entity_id),
   (select enrollment_id from workflow where id=q.entity_id),q.entity_id),
   'HIGH_QUALITY_FINDING','ATTENTION',q.last_seen_at::text,(select contract_number from finance where contract_id=q.entity_id)
   from supported_quality q where q.severity='HIGH'
 ),attention_unique as(select distinct on (source_domain,source_type,source_id,reason_code) * from attention order by source_domain,source_type,source_id,reason_code,business_date),
 currencies as(select currency from finance union select currency from payment union select currency from refund),
 finance_money as(select currency,
  coalesce((select sum(contracted::numeric) from finance where currency=x.currency),0)::text contracted,
  coalesce((select sum(receivable::numeric) from finance where currency=x.currency),0)::text receivable,
  coalesce((select sum(collected::numeric) from finance where currency=x.currency),0)::text collected,
  coalesce((select sum(refunded::numeric) from finance where currency=x.currency),0)::text refunded,
  coalesce((select sum(gross_confirmed::numeric) from finance where currency=x.currency),0)::text gross_confirmed,
  coalesce((select sum(outstanding::numeric) from finance where currency=x.currency),0)::text outstanding,
  coalesce((select sum(overdue::numeric) from finance where currency=x.currency),0)::text overdue,
  coalesce((select sum(amount) from payment where currency=x.currency and paid_at>=lower_bound and paid_at<upper_bound),0)::text payments_in_period,
  coalesce((select sum(amount) from refund where currency=x.currency and refunded_at>=lower_bound and refunded_at<upper_bound),0)::text refunds_in_period from currencies x),
 pipeline_money as(select currency,coalesce(sum(amount) filter(where stage not in ('WON','LOST')),0)::text open_value,
 coalesce(sum(amount) filter(where stage='WON' and closed_at>=lower_bound and closed_at<upper_bound),0)::text won_value from opp group by currency),
 quality_buckets as(select entity_type,severity,count(*) count from supported_quality group by entity_type,severity)
 select jsonb_build_object('filters',jsonb_build_object('productId',p_filters->>'productId','cohortId',p_filters->>'cohortId'),'filterApplied',jsonb_build_object('commercial','OPPORTUNITIES_ONLY','delivery','PRODUCT_COHORT','finance','CONTRACT_CONTEXT_NO_ALLOCATION','channel','CANONICAL_CHANNEL_CONTEXT','admissions','ENROLLMENT_CONTEXT','studentSuccess','CASE_ENROLLMENT_CONTEXT'),'asOf',current_timestamp,'period',jsonb_build_object('from',date_from,'to',date_to,'timezone',tz),
 'permissions',jsonb_build_object('commercial',true,'delivery',true,'finance',finance_visible,'channel',true,'commissionMoney',(channel_report->'permissions'->>'moneyVisible')::boolean,'admissions',true,'studentSuccess',true,'quality',actor_role in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER')),
 'commercial',jsonb_build_object('snapshot',jsonb_build_object('openLeads',(select count(*) from leads where status in ('NEW','QUALIFYING','QUALIFIED')),'qualifiedLeads',(select count(*) from leads where status='QUALIFIED'),'openOpportunities',(select count(*) from opp where stage not in ('WON','LOST'))),
 'period',jsonb_build_object('leadsCreated',(select count(*) from leads where created_at>=lower_bound and created_at<upper_bound),'leadsConverted',(select count(*) from leads where status='CONVERTED' and converted_at>=lower_bound and converted_at<upper_bound),'opportunitiesWon',(select count(*) from opp where stage='WON' and closed_at>=lower_bound and closed_at<upper_bound),'opportunitiesLost',(select count(*) from opp where stage='LOST' and closed_at>=lower_bound and closed_at<upper_bound)),
 'money',coalesce((select jsonb_agg(to_jsonb(p) order by currency) from pipeline_money p),'[]'::jsonb)),
 'delivery',jsonb_build_object('snapshot',jsonb_build_object('activeProducts',(select count(*) from public.products where workspace_id=ws and active and (nullif(p_filters->>'productId','') is null or id=(p_filters->>'productId')::uuid) and (nullif(p_filters->>'cohortId','') is null or (select id from public.product_cohorts where product_id=public.products.id and id=(p_filters->>'cohortId')::uuid limit 1)=(p_filters->>'cohortId')::uuid)),'recruitingCohorts',(select count(*) from public.product_cohorts where workspace_id=ws and status='RECRUITING' and (nullif(p_filters->>'productId','') is null or product_id=(p_filters->>'productId')::uuid) and (nullif(p_filters->>'cohortId','') is null or id=(p_filters->>'cohortId')::uuid)),'activeCohorts',(select count(*) from public.product_cohorts where workspace_id=ws and status='ACTIVE' and (nullif(p_filters->>'productId','') is null or product_id=(p_filters->>'productId')::uuid) and (nullif(p_filters->>'cohortId','') is null or id=(p_filters->>'cohortId')::uuid)),'completedCohorts',(select count(*) from public.product_cohorts where workspace_id=ws and status='COMPLETED' and (nullif(p_filters->>'productId','') is null or product_id=(p_filters->>'productId')::uuid) and (nullif(p_filters->>'cohortId','') is null or id=(p_filters->>'cohortId')::uuid)),
 'openEnrollments',(select count(*) from enrollment where status in ('LEAD','INTERESTED','REGISTERING','ACTIVE')),'activeEnrollments',(select count(*) from enrollment where status='ACTIVE')),
 'statuses',coalesce((select jsonb_object_agg(status,n) from (select status,count(*) n from enrollment group by status)x),'{}'::jsonb),
 'period',jsonb_build_object('enrollmentsCreated',(select count(*) from enrollment where created_at>=lower_bound and created_at<upper_bound),'enrollmentsActivated',(select count(distinct enrollment_id) from history where from_status is not null and to_status='ACTIVE' and changed_at>=lower_bound and changed_at<upper_bound),'enrollmentsCompleted',(select count(distinct enrollment_id) from history where from_status is not null and to_status='COMPLETED' and changed_at>=lower_bound and changed_at<upper_bound),'enrollmentsWithdrawn',(select count(distinct enrollment_id) from history where from_status is not null and to_status='WITHDRAWN' and changed_at>=lower_bound and changed_at<upper_bound),'enrollmentsCancelled',(select count(distinct enrollment_id) from history where from_status is not null and to_status='CANCELLED' and changed_at>=lower_bound and changed_at<upper_bound))),
 'finance',case when finance_visible then jsonb_build_object('money',coalesce((select jsonb_agg(to_jsonb(f) order by currency) from finance_money f),'[]'::jsonb)) else null end,
 'channel',channel_report,'studentSuccess',success_report,
 'admissions',jsonb_build_object('snapshot',jsonb_build_object('applicationsInProgress',(select count(*) from apps where status in ('SUBMITTED','UNDER_REVIEW')),'applicationsDueSoon',(select count(*) from apps where status in ('DRAFT','PREPARING') and deadline_on between today and today+7),'applicationsPastDeadline',(select count(*) from apps where status in ('DRAFT','PREPARING') and deadline_on<today),'openMilestones',(select count(*) from milestone where status not in ('COMPLETED','WAIVED','CANCELLED')),'overdueMilestones',(select count(*) from milestone where status not in ('COMPLETED','WAIVED','CANCELLED') and due_at<current_timestamp),'activeWorkflows',(select count(*) from workflow where status='ACTIVE'),'blockedWorkflows',(select count(*) from workflow where status='BLOCKED'),'completedWorkflows',(select count(*) from workflow where status='COMPLETED')),
 'period',jsonb_build_object('applicationsSubmitted',(select count(*) from apps where submitted_at>=lower_bound and submitted_at<upper_bound),'applicationsDecided',(select count(*) from apps where decision_at>=lower_bound and decision_at<upper_bound),'milestonesCompleted',(select count(*) from milestone where status='COMPLETED' and completed_at>=lower_bound and completed_at<upper_bound),'workflowsStarted',(select count(*) from workflow where started_at>=lower_bound and started_at<upper_bound),'workflowsCompleted',(select count(*) from workflow where status='COMPLETED' and completed_at>=lower_bound and completed_at<upper_bound)),
 'statuses',coalesce((select jsonb_object_agg(status,n) from (select status,count(*) n from apps group by status)x),'{}'::jsonb),'decisions',coalesce((select jsonb_object_agg(decision,n) from (select decision,count(*) n from apps where decision is not null group by decision)x),'{}'::jsonb)),
 'quality',jsonb_build_object('count',(select count(*) from supported_quality),'distribution',coalesce((select jsonb_agg(to_jsonb(q) order by entity_type,severity) from quality_buckets q),'[]'::jsonb)),
 'attention',jsonb_build_object('total',(select count(*) from attention_unique),'limit',30,'items',coalesce((select jsonb_agg(to_jsonb(a)) from (select * from attention_unique order by case severity when 'CRITICAL' then 0 else 1 end,business_date,source_domain,source_type,source_id limit 30)a),'[]'::jsonb))) into result;
 return result;
end $$;
revoke all on function public.management_overview_filtered(jsonb) from public;
grant execute on function public.management_overview_filtered(jsonb) to crm_app;

-- Extract period values from canonical reports. Monetary values remain numeric
-- until JSON serialization; no browser or JavaScript monetary arithmetic.
create function public.management_period_values(r jsonb)
returns table(key text,module text,unit text,currency text,value numeric)
language sql immutable security invoker set search_path=public as $$
 select k.key,d.module,'COUNT',null,k.value::numeric
 from (values ('commercial',r->'commercial'->'period'),('delivery',r->'delivery'->'period'),
 ('admissions',r->'admissions'->'period'),('studentSuccess',r->'studentSuccess'->'period')) d(module,counts)
 cross join lateral jsonb_each_text(coalesce(d.counts,'{}')) k
 where k.key not in ('from','to','timezone')
 union all select 'eventsHeld','channel','COUNT',null,(r->'channel'->'totals'->>'eventsHeld')::numeric
 union all select 'won_value','commercial','MONEY',m->>'currency',(m->>'won_value')::numeric
 from jsonb_array_elements(r->'commercial'->'money') m
 union all select v.key,'finance','MONEY',m->>'currency',v.value::numeric
 from jsonb_array_elements(r->'finance'->'money') m cross join lateral
 (values ('payments_in_period',m->>'payments_in_period'),('refunds_in_period',m->>'refunds_in_period')) v(key,value)
 union all select 'commissionPeriod','channel','MONEY',m->>'currency',(m->>'period_net')::numeric
 from jsonb_array_elements(r->'channel'->'commissionByCurrency') m
 where (r->'permissions'->>'commissionMoney')::boolean
 union all select 'commissionPaid','channel','MONEY',m->>'currency',(m->>'paid_in_period')::numeric
 from jsonb_array_elements(r->'channel'->'settlementByCurrency') m where m->>'status'='PAID'
 and (r->'permissions'->>'commissionMoney')::boolean;
$$;
revoke all on function public.management_period_values(jsonb) from public;
grant execute on function public.management_period_values(jsonb) to crm_app;

create function public.management_trends(p_filters jsonb default '{}') returns jsonb
language plpgsql stable security invoker set search_path=public,app_auth as $$
declare current_report jsonb;previous_report jsonb;filters jsonb;date_from date;date_to date;
 previous_from date;previous_to date;days int;gran text;tz text;step interval;result jsonb;
begin
 if jsonb_typeof(p_filters) is distinct from 'object' or exists(select 1 from jsonb_object_keys(p_filters) k where k not in ('from','to','productId','cohortId','granularity')) then raise exception 'management_input_invalid';end if;
 filters:=p_filters-'granularity';current_report:=public.management_overview_filtered(filters);
 date_from:=(current_report->'period'->>'from')::date;date_to:=(current_report->'period'->>'to')::date;
 tz:=current_report->'period'->>'timezone';days:=date_to-date_from+1;
 previous_from:=date_from-days;previous_to:=date_from-1;
 previous_report:=public.management_overview_filtered(filters||jsonb_build_object('from',previous_from,'to',previous_to));
 gran:=coalesce(p_filters->>'granularity',case when days<=45 then 'DAY' when days<=180 then 'WEEK' else 'MONTH' end);
 if gran not in ('DAY','WEEK','MONTH') then raise exception 'management_input_invalid';end if;
 if days>180 then gran:='MONTH';elsif days>45 and gran='DAY' then gran:='WEEK';end if;
 step:=case gran when 'DAY' then interval '1 day' when 'WEEK' then interval '1 week' else interval '1 month' end;
 with buckets as materialized(
  select greatest(g::date,date_from) start_on,least((g+step)::date-1,date_to) end_on
  from generate_series(date_trunc(lower(gran),date_from::timestamp),date_to::timestamp,step) g
 ), bucket_values as materialized(
  select b.start_on,b.end_on,v.* from buckets b cross join lateral public.management_period_values(
   public.management_overview_filtered(filters||jsonb_build_object('from',b.start_on,'to',b.end_on))) v
 ), transitions as materialized(
  select h.enrollment_id,h.to_status,min(h.changed_at) first_at
  from public.student_enrollment_status_history h join public.student_enrollments e on e.id=h.enrollment_id and e.workspace_id=h.workspace_id
  join public.product_cohorts co on co.id=e.cohort_id and co.workspace_id=e.workspace_id
  where h.workspace_id=public.current_workspace_id() and h.from_status is not null
  and h.to_status in ('ACTIVE','COMPLETED','WITHDRAWN','CANCELLED')
  and h.changed_at>=date_from::timestamp at time zone tz and h.changed_at<(date_to+1)::timestamp at time zone tz
  and (p_filters->>'productId' is null or co.product_id=(p_filters->>'productId')::uuid)
  and (p_filters->>'cohortId' is null or co.id=(p_filters->>'cohortId')::uuid)
  group by h.enrollment_id,h.to_status
 ), current_values as materialized(select * from public.management_period_values(current_report)),
 previous_values as materialized(select * from public.management_period_values(previous_report)),
 identities as(select key,module,unit,currency from current_values union select key,module,unit,currency from previous_values),
 combined as(
  select i.*,coalesce(c.value,0) current_value,coalesce(p.value,0) previous_value
  from identities i left join current_values c on c.key=i.key and c.currency is not distinct from i.currency
  left join previous_values p on p.key=i.key and p.currency is not distinct from i.currency
 ), series as(
  select i.key,i.module,i.unit,i.currency,jsonb_build_object(
   'current',case when i.unit='MONEY' then to_jsonb(i.current_value::text) else to_jsonb(i.current_value) end,
   'previous',case when i.unit='MONEY' then to_jsonb(i.previous_value::text) else to_jsonb(i.previous_value) end,
   'absoluteChange',case when i.unit='MONEY' then to_jsonb((i.current_value-i.previous_value)::text) else to_jsonb(i.current_value-i.previous_value) end,
   'percentChange',case when i.previous_value=0 then null else round((i.current_value-i.previous_value)*100/i.previous_value,4) end) comparison,
   (select jsonb_agg(jsonb_build_object('bucketStart',b.start_on,'bucketEnd',b.end_on,'value',
    case when i.unit='MONEY' then to_jsonb(coalesce(v.value,0)::text) else to_jsonb(
      case when i.key in ('enrollmentsActivated','enrollmentsCompleted','enrollmentsWithdrawn','enrollmentsCancelled') then
       (select count(*) from transitions t where t.to_status=case i.key when 'enrollmentsActivated' then 'ACTIVE' when 'enrollmentsCompleted' then 'COMPLETED' when 'enrollmentsWithdrawn' then 'WITHDRAWN' else 'CANCELLED' end
       and (t.first_at at time zone tz)::date between b.start_on and b.end_on)
      else coalesce(v.value,0) end) end) order by b.start_on)
    from buckets b left join bucket_values v on v.start_on=b.start_on and v.key=i.key and v.currency is not distinct from i.currency) points
  from combined i where i.key not in ('casesCheckedIn')
 ) select jsonb_build_object('asOf',current_report->'asOf','period',current_report->'period',
  'previousPeriod',jsonb_build_object('from',previous_from,'to',previous_to),'granularity',gran,
  'filters',current_report->'filters','filterApplied',current_report->'filterApplied','permissions',current_report->'permissions',
  'series',coalesce((select jsonb_agg(to_jsonb(s) order by module,key,currency) from series s),'[]'::jsonb)) into result;
 return result;
end $$;
revoke all on function public.management_trends(jsonb) from public;
grant execute on function public.management_trends(jsonb) to crm_app;

-- One predicate for existing domain list row/count queries. It never replaces
-- domain RLS, and is unavailable to mutation queries in the gateway.
create function public.domain_report_record_matches(target_table text,target_id uuid,p_filters jsonb) returns boolean
language plpgsql stable security invoker set search_path=public,app_auth as $$
declare metric text:=p_filters->>'reportMetric';tz text;today date;lower_bound timestamptz;upper_bound timestamptz;f date;t date;
begin
 select business_timezone into tz from public.workspaces where id=public.current_workspace_id();today:=(current_timestamp at time zone tz)::date;
 f:=coalesce((p_filters->>'from')::date,today-29);t:=coalesce((p_filters->>'to')::date,today);
 if not isfinite(f) or not isfinite(t) or f>t or t-f>=730 then raise exception 'management_input_invalid';end if;
 lower_bound:=f::timestamp at time zone tz;upper_bound:=(t+1)::timestamp at time zone tz;
 if target_table='lead_pool_records' and metric in ('openLeads','qualifiedLeads','leadsCreated','leadsConverted') then
  return exists(select 1 from public.leads l where l.id=target_id and l.workspace_id=public.current_workspace_id() and
   case metric when 'openLeads' then l.status in ('NEW','QUALIFYING','QUALIFIED') when 'qualifiedLeads' then l.status='QUALIFIED'
   when 'leadsCreated' then l.created_at>=lower_bound and l.created_at<upper_bound
   else l.status='CONVERTED' and l.converted_at>=lower_bound and l.converted_at<upper_bound end);
 elsif target_table='opportunities' and metric in ('openOpportunities','opportunitiesWon','opportunitiesLost') then
  return exists(select 1 from public.opportunities o where o.id=target_id and o.workspace_id=public.current_workspace_id()
   and ((o.organization_id is not null and public.customer_subject_access('ORGANIZATION',o.organization_id,false)) or (o.household_id is not null and public.customer_subject_access('HOUSEHOLD',o.household_id,false)))
   and (o.primary_contact_id is null or public.customer_subject_access('CONTACT',o.primary_contact_id,false))
   and (p_filters->>'productId' is null or o.product_id=(p_filters->>'productId')::uuid)
   and (p_filters->>'cohortId' is null or o.cohort_id=(p_filters->>'cohortId')::uuid)
   and case metric when 'openOpportunities' then o.stage not in ('WON','LOST') else o.stage=case metric when 'opportunitiesWon' then 'WON' else 'LOST' end and o.closed_at>=lower_bound and o.closed_at<upper_bound end);
 elsif target_table='student_enrollment_records' and metric in ('activeEnrollments','openEnrollments','enrollmentsCreated','enrollmentsActivated','enrollmentsCompleted','enrollmentsWithdrawn','enrollmentsCancelled') then
  return exists(select 1 from public.student_enrollments e join public.product_cohorts co on co.id=e.cohort_id and co.workspace_id=e.workspace_id
   where e.id=target_id and e.workspace_id=public.current_workspace_id()
   and (p_filters->>'productId' is null or co.product_id=(p_filters->>'productId')::uuid)
   and (p_filters->>'cohortId' is null or co.id=(p_filters->>'cohortId')::uuid)
   and case metric when 'activeEnrollments' then e.status='ACTIVE' when 'openEnrollments' then e.status in ('LEAD','INTERESTED','REGISTERING','ACTIVE')
   when 'enrollmentsCreated' then e.created_at>=lower_bound and e.created_at<upper_bound
   else exists(select 1 from public.student_enrollment_status_history h where h.enrollment_id=e.id and h.workspace_id=e.workspace_id and h.from_status is not null
    and h.to_status=case metric when 'enrollmentsActivated' then 'ACTIVE' when 'enrollmentsCompleted' then 'COMPLETED' when 'enrollmentsWithdrawn' then 'WITHDRAWN' else 'CANCELLED' end and h.changed_at>=lower_bound and h.changed_at<upper_bound) end);
 elsif target_table='student_success_records' and metric in ('atRiskCases','activeCases','visibleCases','attentionCases') then
  return exists(select 1 from public.student_success_records c where c.id=target_id and c.workspace_id=public.current_workspace_id()
   and (p_filters->>'productId' is null or c.product_id=(p_filters->>'productId')::uuid)
   and (p_filters->>'cohortId' is null or c.cohort_id=(p_filters->>'cohortId')::uuid)
   and case metric when 'atRiskCases' then c.health_status='AT_RISK' when 'attentionCases' then c.health_status in ('ATTENTION','AT_RISK') when 'activeCases' then c.status='ACTIVE' else true end);
 elsif target_table='student_success_outcome_records' and metric in ('outcomesRecorded','recordedOutcomes') then
  return exists(select 1 from public.student_success_outcomes o join public.student_success_records c on c.id=o.case_id and c.workspace_id=o.workspace_id
   where o.id=target_id and o.workspace_id=public.current_workspace_id() and o.record_status='RECORDED' and (metric='recordedOutcomes' or o.occurred_on between f and t)
   and (p_filters->>'productId' is null or c.product_id=(p_filters->>'productId')::uuid)
   and (p_filters->>'cohortId' is null or c.cohort_id=(p_filters->>'cohortId')::uuid));
 elsif target_table in ('payments','finance_filtered_payments') and metric='payments_in_period' then
  return exists(select 1 from public.payments p join public.contract_finance_snapshot c on c.contract_id=p.contract_id and c.workspace_id=p.workspace_id
   where p.id=target_id and p.workspace_id=public.current_workspace_id() and p.status in ('CONFIRMED','REFUNDED')
   and p.paid_at>=lower_bound and p.paid_at<upper_bound and (p_filters->>'currency' is null or p.currency=p_filters->>'currency')
   and (p_filters->>'productId' is null or c.product_id=(p_filters->>'productId')::uuid)
   and (p_filters->>'cohortId' is null or exists(select 1 from public.contract_enrollment_links l join public.student_enrollments e on e.id=l.enrollment_id and e.workspace_id=l.workspace_id where l.contract_id=c.contract_id and l.workspace_id=c.workspace_id and l.status='ACTIVE' and e.cohort_id=(p_filters->>'cohortId')::uuid)));
 else raise exception 'management_drill_invalid';end if;
end $$;
revoke all on function public.domain_report_record_matches(text,uuid,jsonb) from public;
grant execute on function public.domain_report_record_matches(text,uuid,jsonb) to crm_app;
