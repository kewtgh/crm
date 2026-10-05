-- Read/query support only. No management facts, mutations, triggers or score tables.
set search_path=public,app_auth,extensions;

-- Shared Finance definition extracted verbatim from 094's contract-level formulas.
-- Both Enrollment Finance and Management now reuse one canonical contract projection.
create view public.contract_finance_snapshot with(security_invoker=true) as
select c.workspace_id,c.id contract_id,c.contract_number,c.status contract_status,
 c.organization_id,c.household_id,c.product_id,c.currency,c.contract_value::text contracted,
 coalesce(r.receivable,0)::text receivable,coalesce(p.collected,0)::text collected,
 coalesce(p.refunded,0)::text refunded,coalesce(r.outstanding,0)::text outstanding,
 coalesce(r.overdue,0)::text overdue,coalesce(r.schedule_count,0)>0 has_schedule,
 coalesce(p.gross_confirmed,0)::text gross_confirmed
from public.contracts c
left join lateral (
 select count(*) schedule_count,sum(amount) receivable,sum(amount-paid_amount) outstanding,
 sum(amount-paid_amount) filter(where due_date<public.current_business_date()::date) overdue
 from public.receivable_schedules where workspace_id=c.workspace_id and contract_id=c.id
) r on true
left join lateral (
 select sum(amount-refunded_amount) collected,sum(refunded_amount) refunded,sum(amount) gross_confirmed
 from public.payments where workspace_id=c.workspace_id and contract_id=c.id and status in ('CONFIRMED','REFUNDED')
) p on true;
grant select on public.contract_finance_snapshot to crm_app;

create or replace view public.enrollment_contract_finance with(security_invoker=true) as
select l.workspace_id,l.enrollment_id,c.contract_id,c.contract_number,c.contract_status,
 c.organization_id,c.household_id,c.product_id,c.currency,c.contracted,
 public.contract_active_enrollment_count(c.contract_id) active_enrollment_link_count,
 c.receivable,c.collected,c.refunded,c.outstanding,c.overdue,c.has_schedule
from public.contract_enrollment_links l join public.contract_finance_snapshot c
 on c.contract_id=l.contract_id and c.workspace_id=l.workspace_id where l.status='ACTIVE';

create function public.management_overview(p_filters jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable security invoker set search_path=public,app_auth as $$
declare ws uuid:=public.current_workspace_id();actor_role text:=public.current_crm_role();tz text;today date;
 date_from date;date_to date;lower_bound timestamptz;upper_bound timestamptz;finance_visible boolean;
 channel_report jsonb;success_report jsonb;result jsonb;
begin
 if app_auth.current_user_id() is null or not public.is_workspace_member(ws) or actor_role not in
 ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER','SALES_SPECIALIST','SALES_SUPPORT') then raise exception 'management_forbidden';end if;
 if jsonb_typeof(p_filters) is distinct from 'object' or exists(select 1 from jsonb_object_keys(p_filters) k where k not in ('from','to')) then raise exception 'management_input_invalid';end if;
 select business_timezone into tz from public.workspaces where id=ws;today:=(current_timestamp at time zone tz)::date;
 date_from:=coalesce((p_filters->>'from')::date,today-29);date_to:=coalesce((p_filters->>'to')::date,today);
 if not isfinite(date_from) or not isfinite(date_to) or date_from>date_to or date_to-date_from>3660 then raise exception 'management_input_invalid';end if;
 lower_bound:=date_from::timestamp at time zone tz;upper_bound:=(date_to+1)::timestamp at time zone tz;
 finance_visible:=actor_role in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR') or exists(select 1 from public.contracts where workspace_id=ws);
 channel_report:=public.channel_analytics(jsonb_build_object('from',date_from,'to',date_to));
 success_report:=public.student_success_analytics(jsonb_build_object('from',date_from,'to',date_to));
 with
 leads as materialized(select * from public.leads where workspace_id=ws),
 opp as materialized(select o.* from public.opportunities o where o.workspace_id=ws
  and ((o.organization_id is not null and public.customer_subject_access('ORGANIZATION',o.organization_id,false))
   or (o.household_id is not null and public.customer_subject_access('HOUSEHOLD',o.household_id,false)))
  and (o.primary_contact_id is null or public.customer_subject_access('CONTACT',o.primary_contact_id,false))),
 enrollment as materialized(select * from public.student_enrollments where workspace_id=ws),
 history as materialized(select h.* from public.student_enrollment_status_history h join enrollment e on e.id=h.enrollment_id and e.workspace_id=h.workspace_id),
 finance as materialized(select * from public.contract_finance_snapshot where workspace_id=ws and finance_visible),
 payment as materialized(select p.* from public.payments p join finance c on c.contract_id=p.contract_id and c.workspace_id=p.workspace_id where p.status in ('CONFIRMED','REFUNDED')),
 refund as materialized(select r.*,p.currency from public.refunds r join payment p on p.id=r.payment_id and p.workspace_id=r.workspace_id where r.status='PAID'),
 apps as materialized(select * from public.student_applications where workspace_id=ws),
 milestone as materialized(select * from public.admission_milestones where workspace_id=ws),
 workflow as materialized(select * from public.workflow_instances where workspace_id=ws),
 cases as materialized(select * from public.student_success_records where workspace_id=ws),
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
 select jsonb_build_object('asOf',current_timestamp,'period',jsonb_build_object('from',date_from,'to',date_to,'timezone',tz),
 'permissions',jsonb_build_object('commercial',true,'delivery',true,'finance',finance_visible,'channel',true,'commissionMoney',(channel_report->'permissions'->>'moneyVisible')::boolean,'admissions',true,'studentSuccess',true,'quality',actor_role in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER')),
 'commercial',jsonb_build_object('snapshot',jsonb_build_object('openLeads',(select count(*) from leads where status in ('NEW','QUALIFYING','QUALIFIED')),'qualifiedLeads',(select count(*) from leads where status='QUALIFIED'),'openOpportunities',(select count(*) from opp where stage not in ('WON','LOST'))),
 'period',jsonb_build_object('leadsCreated',(select count(*) from leads where created_at>=lower_bound and created_at<upper_bound),'leadsConverted',(select count(*) from leads where status='CONVERTED' and converted_at>=lower_bound and converted_at<upper_bound),'opportunitiesWon',(select count(*) from opp where stage='WON' and closed_at>=lower_bound and closed_at<upper_bound),'opportunitiesLost',(select count(*) from opp where stage='LOST' and closed_at>=lower_bound and closed_at<upper_bound)),
 'money',coalesce((select jsonb_agg(to_jsonb(p) order by currency) from pipeline_money p),'[]'::jsonb)),
 'delivery',jsonb_build_object('snapshot',jsonb_build_object('activeProducts',(select count(*) from public.products where workspace_id=ws and active),'recruitingCohorts',(select count(*) from public.product_cohorts where workspace_id=ws and status='RECRUITING'),'activeCohorts',(select count(*) from public.product_cohorts where workspace_id=ws and status='ACTIVE'),'completedCohorts',(select count(*) from public.product_cohorts where workspace_id=ws and status='COMPLETED'),
 'openEnrollments',(select count(*) from enrollment where status in ('LEAD','INTERESTED','REGISTERING','ACTIVE')),'activeEnrollments',(select count(*) from enrollment where status='ACTIVE')),
 'statuses',coalesce((select jsonb_object_agg(status,n) from (select status,count(*) n from enrollment group by status)x),'{}'::jsonb),
 'period',jsonb_build_object('enrollmentsCreated',(select count(*) from enrollment where created_at>=lower_bound and created_at<upper_bound),'enrollmentsActivated',(select count(distinct enrollment_id) from history where from_status is not null and to_status='ACTIVE' and changed_at>=lower_bound and changed_at<upper_bound),'enrollmentsCompleted',(select count(distinct enrollment_id) from history where from_status is not null and to_status='COMPLETED' and changed_at>=lower_bound and changed_at<upper_bound),'enrollmentsWithdrawn',(select count(distinct enrollment_id) from history where from_status is not null and to_status='WITHDRAWN' and changed_at>=lower_bound and changed_at<upper_bound),'enrollmentsCancelled',(select count(distinct enrollment_id) from history where from_status is not null and to_status='CANCELLED' and changed_at>=lower_bound and changed_at<upper_bound))),
 'finance',case when finance_visible then jsonb_build_object('money',coalesce((select jsonb_agg(to_jsonb(f) order by currency) from finance_money f),'[]'::jsonb)) else null end,
 'channel',channel_report,'studentSuccess',success_report,
 'admissions',jsonb_build_object('snapshot',jsonb_build_object('applicationsInProgress',(select count(*) from apps where status in ('SUBMITTED','UNDER_REVIEW')),'applicationsDueSoon',(select count(*) from apps where status in ('DRAFT','PREPARING') and deadline_on between today and today+7),'applicationsPastDeadline',(select count(*) from apps where status in ('DRAFT','PREPARING') and deadline_on<today),'openMilestones',(select count(*) from milestone where status not in ('COMPLETED','WAIVED','CANCELLED')),'overdueMilestones',(select count(*) from milestone where status not in ('COMPLETED','WAIVED','CANCELLED') and due_at<current_timestamp),'activeWorkflows',(select count(*) from workflow where status='ACTIVE'),'blockedWorkflows',(select count(*) from workflow where status='BLOCKED'),'completedWorkflows',(select count(*) from workflow where status='COMPLETED')),
 'statuses',coalesce((select jsonb_object_agg(status,n) from (select status,count(*) n from apps group by status)x),'{}'::jsonb),'decisions',coalesce((select jsonb_object_agg(decision,n) from (select decision,count(*) n from apps where decision is not null group by decision)x),'{}'::jsonb)),
 'quality',jsonb_build_object('count',(select count(*) from supported_quality),'distribution',coalesce((select jsonb_agg(to_jsonb(q) order by entity_type,severity) from quality_buckets q),'[]'::jsonb)),
 'attention',jsonb_build_object('total',(select count(*) from attention_unique),'limit',30,'items',coalesce((select jsonb_agg(to_jsonb(a)) from (select * from attention_unique order by case severity when 'CRITICAL' then 0 else 1 end,business_date,source_domain,source_type,source_id limit 30)a),'[]'::jsonb))) into result;
 return result;
end $$;
revoke all on function public.management_overview(jsonb) from public;
grant execute on function public.management_overview(jsonb) to crm_app;
