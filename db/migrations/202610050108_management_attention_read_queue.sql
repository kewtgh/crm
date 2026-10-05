-- Current derived Attention, no persisted management facts. Frozen 106/107 unchanged.
set search_path=public,app_auth,extensions;
create function public.management_attention_sources(p_filters jsonb default '{}'::jsonb)
returns table(source_domain text,source_type text,source_id uuid,context_id uuid,reason_code text,severity text,business_date timestamptz,source_reference text,product_id uuid,cohort_id uuid,due_at timestamptz,context jsonb)
language plpgsql stable security invoker set search_path=public,app_auth as $$
#variable_conflict use_column
declare ws uuid:=public.current_workspace_id();actor_role text:=public.current_crm_role();tz text;today date;finance_visible boolean;
begin
 if app_auth.current_user_id() is null or not public.is_workspace_member(ws) or actor_role not in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER','SALES_SPECIALIST','SALES_SUPPORT') then raise exception 'management_forbidden';end if;
 if jsonb_typeof(p_filters) is distinct from 'object' or exists(select 1 from jsonb_object_keys(p_filters) k where k not in ('productId','cohortId')) then raise exception 'management_input_invalid';end if;
 select business_timezone into tz from public.workspaces where id=ws;today:=(current_timestamp at time zone tz)::date;
 finance_visible:=actor_role in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR') or exists(select 1 from public.contracts where workspace_id=ws);
 if p_filters->>'productId' is not null and not exists(select 1 from public.products where id=(p_filters->>'productId')::uuid and workspace_id=ws) then raise exception 'management_input_invalid';end if;
 if p_filters->>'cohortId' is not null and not exists(select 1 from public.product_cohorts where id=(p_filters->>'cohortId')::uuid and workspace_id=ws and (p_filters->>'productId' is null or product_id=(p_filters->>'productId')::uuid)) then raise exception 'management_input_invalid';end if;
 return query with
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
 ))
 select 'FINANCE'::text,'RECEIVABLE'::text,r.id,r.contract_id,'OVERDUE_RECEIVABLE'::text,'ATTENTION'::text,r.due_date::timestamp at time zone tz,f.contract_number::text,f.product_id,null::uuid,r.due_date::timestamp at time zone tz,
 jsonb_build_object('kind','FINANCE','dueDate',r.due_date,'daysOverdue',today-r.due_date,'currency',case when finance_visible then f.currency end,'outstandingAmount',case when finance_visible then (r.amount-r.paid_amount)::text end,'moneyVisible',finance_visible)
 from public.receivable_schedules r join finance f on f.contract_id=r.contract_id and f.workspace_id=r.workspace_id where r.amount>r.paid_amount and r.due_date<today
 union all select 'ADMISSIONS','MILESTONE',m.id,m.enrollment_id,'OVERDUE_MILESTONE','ATTENTION',m.due_at,null,co.product_id,e.cohort_id,m.due_at,
 jsonb_build_object('kind','MILESTONE','milestoneType',m.milestone_type,'status',m.status,'daysOverdue',today-(m.due_at at time zone tz)::date)
 from milestone m join enrollment e on e.id=m.enrollment_id join public.product_cohorts co on co.id=e.cohort_id and co.workspace_id=ws where m.status not in ('COMPLETED','WAIVED','CANCELLED') and m.due_at<current_timestamp
 union all select 'ADMISSIONS','WORKFLOW',w.id,w.enrollment_id,'BLOCKED_WORKFLOW','ATTENTION',w.started_at,null,co.product_id,e.cohort_id,null,
 jsonb_build_object('kind','WORKFLOW','status',w.status,'templateId',w.template_id,'templateVersion',w.template_version,'startedAt',w.started_at)
 from workflow w join enrollment e on e.id=w.enrollment_id join public.product_cohorts co on co.id=e.cohort_id and co.workspace_id=ws where w.status='BLOCKED'
 union all select 'STUDENT_SUCCESS','RISK',r.id,r.case_id,'HIGH_OPEN_RISK','CRITICAL',r.observed_at,null,c.product_id,c.cohort_id,null,
 jsonb_build_object('kind','RISK','riskType',r.risk_type,'sourceSeverity',r.severity,'status',r.status,'observedAt',r.observed_at,'health',c.health_status,'lastCheckinAt',c.last_checkin_at,'activeInterventionCount',(select count(*) from public.student_success_interventions i where i.workspace_id=ws and i.case_id=c.id and i.risk_signal_id=r.id and i.status='ACTIVE'))
 from risks r join cases c on c.id=r.case_id where r.severity='HIGH' and r.status in ('OPEN','MONITORING')
 union all select 'STUDENT_SUCCESS','CASE',c.id,c.id,'STALE_CHECKIN','ATTENTION',coalesce(c.last_checkin_at,c.created_at),null,c.product_id,c.cohort_id,null,
 jsonb_build_object('kind','CASE','status',c.status,'health',c.health_status,'lastCheckinAt',c.last_checkin_at,'nextReviewOn',c.next_review_on,'openRiskCount',c.open_risk_count,'activeInterventionCount',c.active_intervention_count)
 from cases c where c.status='ACTIVE' and coalesce(c.last_checkin_at,c.created_at) at time zone tz < (today-30)::timestamp
 union all select 'DATA_QUALITY','QUALITY_FINDING',q.id,coalesce(
 (select g.case_id from public.student_success_goals g where g.id=q.entity_id),(select r.case_id from risks r where r.id=q.entity_id),(select i.case_id from public.student_success_interventions i where i.id=q.entity_id),(select m.enrollment_id from milestone m where m.id=q.entity_id),(select w.enrollment_id from workflow w where w.id=q.entity_id),q.entity_id),
 'HIGH_QUALITY_FINDING','ATTENTION',q.last_seen_at,(select f.contract_number::text from finance f where f.contract_id=q.entity_id),null,null,null,
 jsonb_build_object('kind','QUALITY','ruleKey',q.rule_key,'sourceSeverity',q.severity,'status',q.status,'entityType',q.entity_type,'entityId',q.entity_id)
 from supported_quality q where q.severity='HIGH';
end $$;

create function public.management_attention(p_filters jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable security invoker set search_path=public,app_auth as $$
declare ws uuid:=public.current_workspace_id();tz text;page_number integer;page_size integer;sort_order text;result jsonb;scope jsonb;
begin
 if jsonb_typeof(p_filters) is distinct from 'object' or exists(select 1 from jsonb_object_keys(p_filters) k where k not in ('page','pageSize','domain','reason','presentationSeverity','sort','productId','cohortId')) then raise exception 'management_input_invalid';end if;
 page_number:=coalesce((p_filters->>'page')::integer,1);page_size:=coalesce((p_filters->>'pageSize')::integer,20);sort_order:=coalesce(p_filters->>'sort','PRIORITY');
 if page_number<1 or page_number>100000 or page_size not in (10,20,30,50,100) or sort_order not in ('PRIORITY','OLDEST','NEWEST')
 or (p_filters->>'domain' is not null and p_filters->>'domain' not in ('FINANCE','ADMISSIONS','STUDENT_SUCCESS','DATA_QUALITY'))
 or (p_filters->>'reason' is not null and p_filters->>'reason' not in ('OVERDUE_RECEIVABLE','OVERDUE_MILESTONE','BLOCKED_WORKFLOW','HIGH_OPEN_RISK','STALE_CHECKIN','HIGH_QUALITY_FINDING'))
 or (p_filters->>'presentationSeverity' is not null and p_filters->>'presentationSeverity' not in ('ATTENTION','CRITICAL')) then raise exception 'management_input_invalid';end if;
 scope:=jsonb_strip_nulls(jsonb_build_object('productId',p_filters->>'productId','cohortId',p_filters->>'cohortId'));
 select business_timezone into tz from public.workspaces where id=ws;
 with sources as materialized(select * from public.management_attention_sources(scope)),
 matched as materialized(select * from sources s where (p_filters->>'domain' is null or s.source_domain=p_filters->>'domain') and (p_filters->>'reason' is null or s.reason_code=p_filters->>'reason') and (p_filters->>'presentationSeverity' is null or s.severity=p_filters->>'presentationSeverity')),
 selected as(select s.* from matched s order by case when sort_order='PRIORITY' then case s.severity when 'CRITICAL' then 0 else 1 end end,
 case when sort_order in ('PRIORITY','OLDEST') then s.business_date end asc nulls last,case when sort_order='NEWEST' then s.business_date end desc nulls last,s.reason_code,s.source_type,s.source_id limit page_size offset (page_number-1)*page_size),
 domains as(select s.source_domain key,count(*) value from matched s group by s.source_domain),reasons as(select s.reason_code key,count(*) value from matched s group by s.reason_code),severities as(select s.severity key,count(*) value from matched s group by s.severity)
 select jsonb_build_object('asOf',current_timestamp,'timezone',tz,'mode','SNAPSHOT','page',page_number,'pageSize',page_size,'total',(select count(*) from matched),
 'summary',jsonb_build_object('byDomain',coalesce((select jsonb_object_agg(key,value) from domains),'{}'::jsonb),'byReason',coalesce((select jsonb_object_agg(key,value) from reasons),'{}'::jsonb),'bySeverity',coalesce((select jsonb_object_agg(key,value) from severities),'{}'::jsonb)),
 'filters',p_filters,'filterApplied',jsonb_build_object('OVERDUE_RECEIVABLE','CONTRACT_PRODUCT_AND_ACTIVE_LINK_COHORT_NO_ALLOCATION','OVERDUE_MILESTONE','ENROLLMENT_CONTEXT','BLOCKED_WORKFLOW','ENROLLMENT_CONTEXT','HIGH_OPEN_RISK','CASE_ENROLLMENT_CONTEXT','STALE_CHECKIN','CASE_ENROLLMENT_CONTEXT','HIGH_QUALITY_FINDING','VISIBLE_SOURCE_CONTEXT; ORGANIZATION_CONTACT_UNFILTERED'),
 'items',coalesce((select jsonb_agg(to_jsonb(s)||jsonb_build_object('attention_key',s.reason_code||':'||s.source_type||':'||s.source_id)) from selected s),'[]'::jsonb)) into result;
 return result;
end $$;
revoke all on function public.management_attention_sources(jsonb),public.management_attention(jsonb) from public;
grant execute on function public.management_attention_sources(jsonb),public.management_attention(jsonb) to crm_app;
create or replace function public.management_overview_filtered(p_filters jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable security invoker set search_path=public,app_auth as $$
declare ws uuid:=public.current_workspace_id();actor_role text:=public.current_crm_role();tz text;today date;
 date_from date;date_to date;lower_bound timestamptz;upper_bound timestamptz;finance_visible boolean;
 channel_report jsonb;success_report jsonb;attention_report jsonb;result jsonb;
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
 attention_report:=public.management_attention(jsonb_strip_nulls(jsonb_build_object('pageSize',30,'productId',p_filters->>'productId','cohortId',p_filters->>'cohortId')));
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
 'attention',jsonb_build_object('total',attention_report->'total','limit',30,'items',attention_report->'items')) into result;
 return result;
end $$;
revoke all on function public.management_overview_filtered(jsonb) from public;
grant execute on function public.management_overview_filtered(jsonb) to crm_app;

-- Extract period values from canonical reports. Monetary values remain numeric
-- until JSON serialization; no browser or JavaScript monetary arithmetic.

create or replace function public.management_overview(p_filters jsonb default '{}'::jsonb) returns jsonb
language sql stable security invoker set search_path=public,app_auth as $$select public.management_overview_filtered(p_filters)$$;
