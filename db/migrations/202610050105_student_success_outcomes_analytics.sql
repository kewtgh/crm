set search_path=public,app_auth,extensions;
-- Explicit retrospective results, never inferred from lifecycle, grades or Health.
create table public.student_success_outcomes(
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id),case_id uuid not null,goal_id uuid,
 outcome_type text not null check(outcome_type in ('ACADEMIC','LANGUAGE','ENGAGEMENT','ATTENDANCE','PROJECT','TRANSITION','CAREER','PERSONAL_DEVELOPMENT','OTHER')),
 result text not null check(result in ('ACHIEVED','PARTIALLY_ACHIEVED','NOT_ACHIEVED','OBSERVED')),
 occurred_on date not null check(isfinite(occurred_on)),title text not null check(length(trim(title)) between 1 and 200),summary text check(length(summary)<=2000),owner_id uuid,
 record_status text not null default 'RECORDED' check(record_status in ('RECORDED','VOIDED')),
 void_reason text check(length(trim(void_reason)) between 1 and 1000),voided_at timestamptz,voided_by uuid references app_auth.accounts(id),
 revision integer not null default 1 check(revision>0),created_by uuid references app_auth.accounts(id),created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),
 check((record_status='RECORDED' and void_reason is null and voided_at is null and voided_by is null) or (record_status='VOIDED' and void_reason is not null and voided_at is not null and voided_by is not null)),
 unique(workspace_id,id),foreign key(workspace_id,case_id) references public.student_success_cases(workspace_id,id) on delete cascade,
 foreign key(workspace_id,case_id,goal_id) references public.student_success_goals(workspace_id,case_id,id),
 foreign key(workspace_id,owner_id) references public.workspace_memberships(workspace_id,user_id)
);
create index success_outcomes_case_date_idx on public.student_success_outcomes(workspace_id,case_id,occurred_on desc,id);
alter table public.student_success_outcomes enable row level security;
revoke all on public.student_success_outcomes from public,crm_app,crm_worker;
grant select on public.student_success_outcomes to crm_app,crm_worker;
create policy success_outcomes_read on public.student_success_outcomes for select to crm_app using(public.student_success_parent_access(case_id,false));
create policy success_outcomes_privacy on public.student_success_outcomes for select to crm_worker using(true);
create trigger success_outcomes_identity before update on public.student_success_outcomes for each row execute function public.guard_student_success_identity();
create trigger success_outcomes_case_immutable before update on public.student_success_outcomes for each row execute function public.guard_success_operations_case();
create function public.guard_success_voided_outcome() returns trigger language plpgsql as $$begin
 if old.record_status='VOIDED' then raise exception 'success_outcome_voided';end if;return new;end $$;
create trigger success_outcomes_voided before update on public.student_success_outcomes for each row execute function public.guard_success_voided_outcome();
revoke all on function public.guard_success_voided_outcome() from public;

create function public.mutate_student_success_outcome(record_id uuid,expected_revision integer,data jsonb,p_request_key text,p_void boolean default false,p_reason text default '') returns jsonb
language plpgsql security definer set search_path=public,app_auth,extensions as $$
declare ws uuid:=public.current_workspace_id();actor uuid:=app_auth.current_user_id();parent public.student_success_cases;old_row public.student_success_outcomes;item public.student_success_outcomes;
 receipt public.mutation_receipts;fingerprint text;fields text[]:=array['case_id','goal_id','outcome_type','result','occurred_on','title','summary','owner_id'];staff uuid;changed jsonb;
begin
 if actor is null or ws is null or not public.is_workspace_member(ws) or record_id is null or expected_revision<=0 or p_void is null or p_request_key is null or length(p_request_key) not between 8 and 160 then raise exception 'success_input_invalid';end if;
 if jsonb_typeof(data) is distinct from 'object' or p_reason is null or length(p_reason)>1000 then raise exception 'success_input_invalid';end if;
 if p_void then
  if data<>'{}'::jsonb or expected_revision is null or length(trim(p_reason))=0 then raise exception 'success_void_reason_required';end if;
 else
  if not data ?& fields or exists(select 1 from jsonb_object_keys(data) k where not k=any(fields)) or p_reason<>'' then raise exception 'success_input_invalid';end if;
 end if;
 fingerprint:=encode(extensions.digest(jsonb_build_object('actor',actor,'id',record_id,'revision',expected_revision,'data',data,'void',p_void,'reason',p_reason)::text,'sha256'),'hex');
 perform pg_advisory_xact_lock(hashtextextended(ws::text||':'||p_request_key,0));
 if p_void then select * into old_row from public.student_success_outcomes where id=record_id and workspace_id=ws;end if;
 select * into parent from public.student_success_cases c where c.id=case when p_void then old_row.case_id else (data->>'case_id')::uuid end and c.workspace_id=ws and public.student_success_case_access(to_jsonb(c),true);
 if not found then raise exception 'success_case_not_found';end if;
 select * into receipt from public.mutation_receipts where workspace_id=ws and request_key=p_request_key;
 if found then if receipt.operation<>'SUCCESS_OUTCOME_SAVE' or receipt.created_by<>actor or receipt.result->>'request_hash' is distinct from fingerprint then raise exception 'success_request_conflict';end if;return receipt.result->'item';end if;
 perform pg_advisory_xact_lock(hashtextextended('success-enrollment:'||ws::text||':'||parent.enrollment_id::text,0));
 perform 1 from public.student_enrollments e join public.students s on s.id=e.student_id and s.workspace_id=e.workspace_id join public.contacts c on c.id=s.person_id and c.workspace_id=s.workspace_id where e.id=parent.enrollment_id and e.workspace_id=ws for share of e,s,c;
 select * into parent from public.student_success_cases c where c.id=parent.id and c.workspace_id=ws and public.student_success_case_access(to_jsonb(c),true) for update;
 if not found then raise exception 'success_update_forbidden';end if;
 select * into old_row from public.student_success_outcomes where id=record_id and workspace_id=ws for update;
 if found then
  if old_row.case_id<>parent.id then raise exception 'success_parent_immutable';end if;
  if expected_revision is distinct from old_row.revision then raise exception 'success_version_conflict';end if;
  if old_row.record_status='VOIDED' then raise exception 'success_outcome_voided';end if;
 elsif expected_revision is not null or p_void then raise exception 'success_not_found';end if;
 if p_void then
  update public.student_success_outcomes set record_status='VOIDED',void_reason=trim(p_reason),voided_at=clock_timestamp(),voided_by=actor,revision=revision+1,updated_at=clock_timestamp() where id=record_id returning * into item;
  changed:='["record_status","void_reason","voided_at","voided_by"]';
 else
  staff:=(data->>'owner_id')::uuid;
  if staff is not null and (not exists(select 1 from public.workspace_memberships where workspace_id=ws and user_id=staff and status='ACTIVE') or ((old_row.id is null or old_row.owner_id is distinct from staff) and not public.can_assign_crm_task(staff))) then raise exception 'success_owner_invalid';end if;
  if data->>'goal_id' is not null and not exists(select 1 from public.student_success_goals where id=(data->>'goal_id')::uuid and case_id=parent.id and workspace_id=ws) then raise exception 'success_goal_context_mismatch';end if;
  if old_row.id is null then
   insert into public.student_success_outcomes(id,workspace_id,case_id,goal_id,outcome_type,result,occurred_on,title,summary,owner_id,created_by)
   values(record_id,ws,parent.id,(data->>'goal_id')::uuid,data->>'outcome_type',data->>'result',(data->>'occurred_on')::date,data->>'title',data->>'summary',staff,actor) returning * into item;
  else
   update public.student_success_outcomes set goal_id=(data->>'goal_id')::uuid,outcome_type=data->>'outcome_type',result=data->>'result',occurred_on=(data->>'occurred_on')::date,title=data->>'title',summary=data->>'summary',owner_id=staff,revision=revision+1,updated_at=clock_timestamp() where id=record_id returning * into item;
  end if;
  select coalesce(jsonb_agg(k),'[]') into changed from unnest(fields) k where old_row.id is null or to_jsonb(old_row)->k is distinct from to_jsonb(item)->k;
 end if;
 insert into public.audit_events(workspace_id,actor_id,action,entity_type,entity_id,after_data) values(ws,actor,case when p_void then 'STUDENT_SUCCESS_OUTCOME_VOIDED' when old_row.id is null then 'STUDENT_SUCCESS_OUTCOME_CREATED' else 'STUDENT_SUCCESS_OUTCOME_UPDATED' end,'STUDENT_SUCCESS_OUTCOME',record_id,jsonb_build_object('caseId',parent.id,'revision',item.revision,'changedFields',changed));
 insert into public.mutation_receipts(workspace_id,request_key,operation,result,created_by) values(ws,p_request_key,'SUCCESS_OUTCOME_SAVE',jsonb_build_object('request_hash',fingerprint,'item',to_jsonb(item)),actor);return to_jsonb(item);
end $$;
revoke all on function public.mutate_student_success_outcome(uuid,integer,jsonb,text,boolean,text) from public,crm_app,crm_worker;
create function public.save_student_success_outcome(record_id uuid,expected_revision integer,data jsonb,p_request_key text) returns jsonb language sql security definer set search_path=public,app_auth,extensions as $$select public.mutate_student_success_outcome(record_id,expected_revision,data,p_request_key,false,'')$$;
create function public.void_student_success_outcome(record_id uuid,expected_revision integer,p_request_key text,reason text) returns jsonb language sql security definer set search_path=public,app_auth,extensions as $$select public.mutate_student_success_outcome(record_id,expected_revision,'{}',p_request_key,true,reason)$$;
revoke all on function public.save_student_success_outcome(uuid,integer,jsonb,text),public.void_student_success_outcome(uuid,integer,text,text) from public;
grant execute on function public.save_student_success_outcome(uuid,integer,jsonb,text),public.void_student_success_outcome(uuid,integer,text,text) to crm_app;
create function public.cleanup_success_outcome() returns trigger language plpgsql security definer set search_path=public as $$begin
 delete from public.mutation_receipts where workspace_id=old.workspace_id and operation='SUCCESS_OUTCOME_SAVE' and result->'item'->>'id'=old.id::text;return old;end $$;
create trigger success_outcome_privacy_cleanup before delete on public.student_success_outcomes for each row execute function public.cleanup_success_outcome();
revoke all on function public.cleanup_success_outcome() from public;
create view public.student_success_outcome_records with(security_invoker=true) as
 select o.*,g.title goal_title,u.display_name_zh owner_name_zh,u.display_name_en owner_name_en from public.student_success_outcomes o
 left join public.student_success_goals g on g.id=o.goal_id and g.workspace_id=o.workspace_id left join public.user_profiles u on u.user_id=o.owner_id;
grant select on public.student_success_outcome_records to crm_app;

-- Analytics reads each authorized Case once; child aggregates cannot multiply parent counts.
create function public.student_success_analytics(p_filters jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable security invoker set search_path=public,app_auth as $$
declare ws uuid:=public.current_workspace_id();tz text;today date;date_from date;date_to date;lower_bound timestamptz;upper_bound timestamptz;prod uuid;cohort uuid;owner uuid;health text;report_json jsonb;
begin
 if app_auth.current_user_id() is null or not public.is_workspace_member(ws) or public.current_crm_role() not in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER','SALES_SPECIALIST','SALES_SUPPORT') then raise exception 'success_update_forbidden';end if;
 if jsonb_typeof(p_filters) is distinct from 'object' or exists(select 1 from jsonb_object_keys(p_filters) k where k not in ('from','to','productId','cohortId','ownerId','health')) then raise exception 'success_input_invalid';end if;
 select business_timezone into tz from public.workspaces where id=ws;today:=(current_timestamp at time zone tz)::date;
 date_from:=coalesce((p_filters->>'from')::date,today-89);date_to:=coalesce((p_filters->>'to')::date,today);
 if not isfinite(date_from) or not isfinite(date_to) or date_from>date_to or date_to-date_from>3660 then raise exception 'success_input_invalid';end if;
 lower_bound:=date_from::timestamp at time zone tz;upper_bound:=(date_to+1)::timestamp at time zone tz;
 prod:=(p_filters->>'productId')::uuid;cohort:=(p_filters->>'cohortId')::uuid;owner:=(p_filters->>'ownerId')::uuid;health:=p_filters->>'health';
 if health is not null and health not in ('UNKNOWN','ON_TRACK','ATTENTION','AT_RISK') then raise exception 'success_input_invalid';end if;
 if prod is not null and not exists(select 1 from public.products where id=prod and workspace_id=ws) then raise exception 'success_input_invalid';end if;
 if cohort is not null and not exists(select 1 from public.product_cohorts where id=cohort and workspace_id=ws and (prod is null or product_id=prod)) then raise exception 'success_input_invalid';end if;
 with cases as materialized(
 select c.id,c.workspace_id,c.status,c.health_status,c.next_review_on,c.created_at,c.last_checkin_at,c.product_id,c.cohort_id,c.product_name_zh,c.product_name_en,c.cohort_name_zh,c.cohort_name_en
 from public.student_success_records c where c.workspace_id=ws and (prod is null or c.product_id=prod) and (cohort is null or c.cohort_id=cohort) and (owner is null or c.owner_id=owner) and (health is null or c.health_status=health)),
 goals as materialized(select g.* from public.student_success_goals g join cases c on c.id=g.case_id and c.workspace_id=g.workspace_id),
 risks as materialized(select r.* from public.student_success_risk_signals r join cases c on c.id=r.case_id and c.workspace_id=r.workspace_id),
 supports as materialized(select i.* from public.student_success_interventions i join cases c on c.id=i.case_id and c.workspace_id=i.workspace_id),
 checkins as materialized(select k.* from public.student_success_checkins k join cases c on c.id=k.case_id and c.workspace_id=k.workspace_id),
 assessments as materialized(select a.* from public.student_success_health_assessments a join cases c on c.id=a.case_id and c.workspace_id=a.workspace_id),
 outcomes as materialized(select o.* from public.student_success_outcomes o join cases c on c.id=o.case_id and c.workspace_id=o.workspace_id where o.record_status='RECORDED'),
 bucket_counts as (
 select 'caseStatus' kind,status value,count(*) n from cases group by status union all select 'health',health_status,count(*) from cases group by health_status
 union all select 'goalStatus',status,count(*) from goals group by status union all select 'riskStatus',status,count(*) from risks group by status
 union all select 'riskType',risk_type,count(*) from risks group by risk_type union all select 'riskSeverity',severity,count(*) from risks group by severity
 union all select 'interventionStatus',status,count(*) from supports group by status union all select 'interventionType',intervention_type,count(*) from supports group by intervention_type
 union all select 'outcomeType',outcome_type,count(*) from outcomes group by outcome_type union all select 'outcomeResult',result,count(*) from outcomes group by result),
 buckets as(select kind,jsonb_object_agg(value,n) item from bucket_counts group by kind),
 comparison as(select c.product_id,c.cohort_id,min(c.product_name_zh) product_name_zh,min(c.product_name_en) product_name_en,min(c.cohort_name_zh) cohort_name_zh,min(c.cohort_name_en) cohort_name_en,
 count(*) cases,count(*) filter(where status='ACTIVE') active_cases,count(*) filter(where health_status='UNKNOWN') unknown,count(*) filter(where health_status='ON_TRACK') on_track,count(*) filter(where health_status='ATTENTION') attention,count(*) filter(where health_status='AT_RISK') at_risk,
 sum((select count(*) from checkins k where k.case_id=c.id and k.occurred_at>=lower_bound and k.occurred_at<upper_bound)) checkins,
 sum((select count(*) from goals g where g.case_id=c.id and g.status='ACHIEVED')) goals_achieved,
 sum((select count(*) from goals g where g.case_id=c.id and g.status='NOT_ACHIEVED')) goals_not_achieved,
 sum((select count(*) from risks r where r.case_id=c.id and r.status in ('OPEN','MONITORING'))) open_risks,
 sum((select count(*) from risks r where r.case_id=c.id and r.status='RESOLVED')) resolved_risks,
 sum((select count(*) from supports i where i.case_id=c.id and i.status='ACTIVE')) active_interventions,
 sum((select count(*) from supports i where i.case_id=c.id and i.status='COMPLETED')) completed_interventions,
 sum((select count(*) from outcomes o where o.case_id=c.id and o.occurred_on between date_from and date_to)) outcomes
 from cases c group by c.product_id,c.cohort_id),
 month_events as(
 select to_char(k.occurred_at at time zone tz,'YYYY-MM') as month,'checkins' kind,count(*) n from checkins k where k.occurred_at>=lower_bound and k.occurred_at<upper_bound group by 1
 union all select to_char(r.observed_at at time zone tz,'YYYY-MM'),'risksObserved',count(*) from risks r where r.observed_at>=lower_bound and r.observed_at<upper_bound group by 1
 union all select to_char(o.occurred_on,'YYYY-MM'),'outcomes',count(*) from outcomes o where o.occurred_on between date_from and date_to group by 1),
 months as(select month,jsonb_object_agg(kind,n) counts from month_events group by month)
 select jsonb_build_object('filters',p_filters,'permissions',jsonb_build_object('canRead',true),'snapshot',jsonb_build_object('asOf',current_timestamp,'visibleCases',(select count(*) from cases),
 'activeCases',(select count(*) from cases where status='ACTIVE'),'attentionCases',(select count(*) from cases where health_status in ('ATTENTION','AT_RISK')),'atRiskCases',(select count(*) from cases where health_status='AT_RISK'),
 'openRisks',(select count(*) from risks where status in ('OPEN','MONITORING')),'highOpenRisks',(select count(*) from risks where severity='HIGH' and status in ('OPEN','MONITORING')),
 'activeInterventions',(select count(*) from supports where status='ACTIVE'),'activeGoals',(select count(*) from goals where status='ACTIVE'),
 'withoutRecentCheckin',(select count(*) from cases where status='ACTIVE' and coalesce(last_checkin_at,created_at)::timestamptz at time zone tz < (today-30)::timestamp),
 'upcomingReview',(select count(*) from cases where status in ('PLANNING','ACTIVE','PAUSED') and next_review_on between today and today+7),
 'recordedOutcomes',(select count(*) from outcomes),'distributions',coalesce((select jsonb_object_agg(kind,item) from buckets),'{}'::jsonb),
 'goalAttainment',jsonb_build_object('achieved',(select count(*) from goals where status='ACHIEVED'),'evaluated',(select count(*) from goals where status in ('ACHIEVED','NOT_ACHIEVED')),'rate',
 (select count(*) filter(where status='ACHIEVED')::numeric/nullif(count(*) filter(where status in ('ACHIEVED','NOT_ACHIEVED')),0) from goals))),
 'period',jsonb_build_object('from',date_from,'to',date_to,'timezone',tz,'checkins',(select count(*) from checkins where occurred_at>=lower_bound and occurred_at<upper_bound),
 'casesCheckedIn',(select count(distinct case_id) from checkins where occurred_at>=lower_bound and occurred_at<upper_bound),
 'healthAssessments',(select count(*) from assessments where assessed_at>=lower_bound and assessed_at<upper_bound),
 'risksObserved',(select count(*) from risks where observed_at>=lower_bound and observed_at<upper_bound),
 'risksResolved',(select count(*) from risks where status='RESOLVED' and resolved_at>=lower_bound and resolved_at<upper_bound),
 'interventionsStarted',(select count(*) from supports where started_on between date_from and date_to),
 'interventionsCompleted',(select count(*) from supports where status='COMPLETED' and completed_at>=lower_bound and completed_at<upper_bound),
 'goalsAchieved',(select count(*) from goals where status='ACHIEVED' and achieved_at>=lower_bound and achieved_at<upper_bound),
 'outcomesRecorded',(select count(*) from outcomes where occurred_on between date_from and date_to)),
 'comparison',coalesce((select jsonb_agg(to_jsonb(x) order by product_name_en,cohort_name_en,cohort_id) from comparison x),'[]'::jsonb),
 'trends',coalesce((select jsonb_agg(to_jsonb(x) order by month) from months x),'[]'::jsonb)) into report_json;
 return report_json;
end $$;
revoke all on function public.student_success_analytics(jsonb) from public;
grant execute on function public.student_success_analytics(jsonb) to crm_app;

create or replace view public.student_success_records with(security_invoker=true) as
 select c.*,e.student_id,e.cohort_id,co.product_id,e.status enrollment_status,e.owner_id enrollment_owner_id,
 p.name_zh student_name_zh,p.name_en student_name_en,s.student_number,co.name_zh cohort_name_zh,co.name_en cohort_name_en,pr.name_zh product_name_zh,pr.name_en product_name_en,
 u.display_name_zh owner_name_zh,u.display_name_en owner_name_en,eu.display_name_zh enrollment_owner_name_zh,eu.display_name_en enrollment_owner_name_en,public.student_success_case_access(to_jsonb(c),true) can_edit,
 (select count(*) from public.student_success_goals g where g.case_id=c.id and g.workspace_id=c.workspace_id and g.status='ACTIVE') active_goal_count,
 (select count(*) from public.student_success_task_records t where t.case_id=c.id and t.workspace_id=c.workspace_id and t.status<>'DONE') open_task_count,
 (select max(k.occurred_at) from public.student_success_checkins k where k.case_id=c.id and k.workspace_id=c.workspace_id) last_checkin_at,
 (select count(*) from public.student_success_risk_signals r where r.case_id=c.id and r.workspace_id=c.workspace_id and r.status in ('OPEN','MONITORING')) open_risk_count,
 (select count(*) from public.student_success_risk_signals r where r.case_id=c.id and r.workspace_id=c.workspace_id and r.status in ('OPEN','MONITORING') and r.severity='HIGH') high_risk_count,
 (select count(*) from public.student_success_interventions i where i.case_id=c.id and i.workspace_id=c.workspace_id and i.status='ACTIVE') active_intervention_count,
 (select count(*) from public.student_success_outcomes o where o.case_id=c.id and o.workspace_id=c.workspace_id and o.record_status='RECORDED') recorded_outcome_count,
 (select count(*) from public.student_success_outcomes o where o.case_id=c.id and o.workspace_id=c.workspace_id and o.record_status='RECORDED' and o.result='ACHIEVED') achieved_outcome_count,
 (select count(*) from public.student_success_outcomes o where o.case_id=c.id and o.workspace_id=c.workspace_id and o.record_status='RECORDED' and o.result='PARTIALLY_ACHIEVED') partial_outcome_count,
 (select count(*) from public.student_success_outcomes o where o.case_id=c.id and o.workspace_id=c.workspace_id and o.record_status='RECORDED' and o.result='NOT_ACHIEVED') not_achieved_outcome_count,
 (select count(*) from public.student_success_outcomes o where o.case_id=c.id and o.workspace_id=c.workspace_id and o.record_status='RECORDED' and o.result='OBSERVED') observed_outcome_count
 from public.student_success_cases c join public.student_enrollments e on e.id=c.enrollment_id and e.workspace_id=c.workspace_id
 join public.students s on s.id=e.student_id and s.workspace_id=e.workspace_id join public.contacts p on p.id=s.person_id and p.workspace_id=s.workspace_id
 join public.product_cohorts co on co.id=e.cohort_id and co.workspace_id=e.workspace_id join public.products pr on pr.id=co.product_id and pr.workspace_id=co.workspace_id
 left join public.user_profiles u on u.user_id=c.owner_id left join public.user_profiles eu on eu.user_id=e.owner_id;
