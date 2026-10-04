-- Independent operations facts; never duplicate Application or Finance state.
set search_path=public,app_auth,extensions;
alter table public.student_applications add constraint application_enrollment_identity unique(workspace_id,enrollment_id,id);
create function public.admission_milestone_metadata_valid(kind text,data jsonb) returns boolean
language plpgsql immutable set search_path=public as $$
declare allowed text[];k text;
begin
 if jsonb_typeof(data) is distinct from 'object' then return false;end if;
 allowed:=case kind when 'INTERVIEW' then array['summary','result','interviewer'] when 'PLACEMENT_TEST' then array['score','scale','result']
  when 'VISA_RESULT' then array['result','reason'] when 'OTHER' then array['label'] else array[]::text[] end;
 for k in select jsonb_object_keys(data) loop
  if not k=any(allowed) then return false;end if;
  if k='score' then
   if jsonb_typeof(data->k)<>'number' or abs((data->>k)::numeric)>1000000000 then return false;end if;
  elsif jsonb_typeof(data->k)<>'string' or length(trim(data->>k))=0 or length(data->>k)>(case k when 'summary' then 2000 when 'reason' then 1000 when 'scale' then 80 else 160 end) then return false;
  end if;
 end loop;
 if kind='INTERVIEW' and data ? 'result' and data->>'result' not in ('PASS','FAIL','RESCHEDULE','NO_SHOW','UNKNOWN') then return false;end if;
 if kind='VISA_RESULT' and data ? 'result' and data->>'result' not in ('APPROVED','REFUSED','ADMINISTRATIVE_PROCESSING','OTHER') then return false;end if;
 return true;
exception when others then return false;
end $$;
revoke all on function public.admission_milestone_metadata_valid(text,jsonb) from public;
grant execute on function public.admission_milestone_metadata_valid(text,jsonb) to crm_app;
create table public.admission_milestones(
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null default public.current_workspace_id() references public.workspaces(id),
 enrollment_id uuid not null,application_id uuid,
 milestone_type text not null check(milestone_type in ('INTERVIEW','SUPPLEMENTARY_MATERIALS','PLACEMENT_TEST','I20_REQUESTED','I20_ISSUED','SEVIS_REQUIRED','SEVIS_COMPLETED','VISA_APPLICATION','VISA_APPOINTMENT','VISA_TRAINING','VISA_RESULT','FLIGHT_CONFIRMED','ORIENTATION','ARRIVAL','OTHER')),
 status text not null default 'PENDING' check(status in ('PENDING','SCHEDULED','IN_PROGRESS','COMPLETED','WAIVED','BLOCKED','CANCELLED')),
 due_at timestamptz,scheduled_at timestamptz,completed_at timestamptz,outcome text check(outcome is null or length(trim(outcome)) between 1 and 160),
 owner_id uuid,external_reference text check(external_reference is null or length(trim(external_reference)) between 1 and 160),
 note text check(note is null or length(note)<=2000),metadata jsonb not null default '{}',sequence integer not null default 1 check(sequence between 1 and 1000000),
 revision integer not null default 1 check(revision>0),created_by uuid references app_auth.accounts(id),
 created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),unique(workspace_id,id),
 foreign key(workspace_id,enrollment_id) references public.student_enrollments(workspace_id,id) on delete cascade,
 foreign key(workspace_id,enrollment_id,application_id) references public.student_applications(workspace_id,enrollment_id,id) on delete cascade,
 foreign key(workspace_id,owner_id) references public.workspace_memberships(workspace_id,user_id),
 constraint admission_milestone_dates_check check((status<>'SCHEDULED' or scheduled_at is not null) and (status<>'COMPLETED' or completed_at is not null)),
 constraint admission_milestone_metadata_check check(public.admission_milestone_metadata_valid(milestone_type,metadata))
);
create index admission_milestones_enrollment_idx on public.admission_milestones(workspace_id,enrollment_id,sequence,id);
create index admission_milestones_application_idx on public.admission_milestones(workspace_id,application_id,sequence,id) where application_id is not null;
create index admission_milestones_due_idx on public.admission_milestones(workspace_id,due_at,id) where status not in ('COMPLETED','WAIVED','CANCELLED');
create index admission_milestones_owner_idx on public.admission_milestones(workspace_id,owner_id,status);
create table public.admission_milestone_status_history(
 id bigint generated always as identity primary key,workspace_id uuid not null references public.workspaces(id),milestone_id uuid not null,
 milestone_revision integer not null check(milestone_revision>0),
 from_status text check(from_status in ('PENDING','SCHEDULED','IN_PROGRESS','COMPLETED','WAIVED','BLOCKED','CANCELLED')),
 to_status text not null check(to_status in ('PENDING','SCHEDULED','IN_PROGRESS','COMPLETED','WAIVED','BLOCKED','CANCELLED')),
 changed_at timestamptz not null default clock_timestamp(),changed_by uuid references app_auth.accounts(id),reason text not null default '' check(length(reason)<=1000),
 check(from_status is null or from_status<>to_status),unique(workspace_id,milestone_id,milestone_revision),
 foreign key(workspace_id,milestone_id) references public.admission_milestones(workspace_id,id) on delete cascade
);
create index admission_milestone_history_idx on public.admission_milestone_status_history(workspace_id,milestone_id,changed_at,id);
create function public.admission_milestone_access(record jsonb,edit boolean default false) returns boolean
language plpgsql stable security definer set search_path=public,app_auth,extensions as $$
begin
 if app_auth.current_user_id() is null or record->>'workspace_id' is distinct from public.current_workspace_id()::text or not public.is_workspace_member(public.current_workspace_id()) then return false;end if;
 if edit and public.current_crm_role() not in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER','SALES_SPECIALIST','SALES_SUPPORT') then return false;end if;
 return exists(select 1 from public.student_enrollments e where e.workspace_id=public.current_workspace_id() and e.id=(record->>'enrollment_id')::uuid and public.student_enrollment_access(to_jsonb(e),edit))
  and (record->>'application_id' is null or exists(select 1 from public.student_applications a where a.id=(record->>'application_id')::uuid and a.workspace_id=public.current_workspace_id()
   and a.enrollment_id=(record->>'enrollment_id')::uuid and public.student_application_access(to_jsonb(a),false)))
  and (record->>'owner_id' is null or public.can_access_owned_record(public.current_workspace_id(),'ADMISSION_MILESTONE',(record->>'id')::uuid,(record->>'owner_id')::uuid,edit));
end $$;
revoke all on function public.admission_milestone_access(jsonb,boolean) from public;
grant execute on function public.admission_milestone_access(jsonb,boolean) to crm_app;
alter table public.admission_milestones enable row level security;
alter table public.admission_milestone_status_history enable row level security;
revoke all on public.admission_milestones,public.admission_milestone_status_history from public,crm_app;
grant select on public.admission_milestones,public.admission_milestone_status_history to crm_app,crm_worker;
create policy milestone_read on public.admission_milestones for select to crm_app using(public.admission_milestone_access(to_jsonb(admission_milestones),false));
create policy milestone_history_read on public.admission_milestone_status_history for select to crm_app using(exists(select 1 from public.admission_milestones m where m.id=milestone_id and m.workspace_id=admission_milestone_status_history.workspace_id));
create policy milestone_privacy_read on public.admission_milestones for select to crm_worker using(true);
create policy milestone_history_privacy_read on public.admission_milestone_status_history for select to crm_worker using(true);
create function public.guard_milestone_identity() returns trigger language plpgsql as $$ begin
 if new.id is distinct from old.id or new.workspace_id is distinct from old.workspace_id or new.enrollment_id is distinct from old.enrollment_id then raise exception 'milestone_parent_immutable';end if;return new;end $$;
create trigger milestone_identity_immutable before update on public.admission_milestones for each row execute function public.guard_milestone_identity();
create function public.guard_milestone_history() returns trigger language plpgsql as $$ begin raise exception 'milestone_history_immutable';end $$;
create trigger milestone_history_immutable before update on public.admission_milestone_status_history for each row execute function public.guard_milestone_history();
create function public.record_milestone_status() returns trigger language plpgsql security definer set search_path=public,app_auth,extensions as $$ begin
 if tg_op='INSERT' or new.status is distinct from old.status then
  insert into public.admission_milestone_status_history(workspace_id,milestone_id,milestone_revision,from_status,to_status,changed_at,changed_by,reason)
   values(new.workspace_id,new.id,new.revision,case when tg_op='INSERT' then null else old.status end,new.status,new.updated_at,app_auth.current_user_id(),coalesce(current_setting('app.milestone_status_reason',true),''));
 end if;return new;end $$;
revoke all on function public.guard_milestone_identity(),public.guard_milestone_history(),public.record_milestone_status() from public;
create trigger milestone_status_record after insert or update of status on public.admission_milestones for each row execute function public.record_milestone_status();

create function public.save_admission_milestone(record_id uuid,expected_revision integer,data jsonb,p_request_key text,status_reason text default '')
returns public.admission_milestones language plpgsql security definer set search_path=public,app_auth,extensions as $$
declare ws uuid:=public.current_workspace_id();actor uuid:=app_auth.current_user_id();previous public.admission_milestones;candidate public.admission_milestones;result public.admission_milestones;receipt public.mutation_receipts;request_hash text;
 fields text[]:=array['enrollment_id','application_id','milestone_type','status','due_at','scheduled_at','completed_at','outcome','owner_id','external_reference','note','metadata','sequence'];
begin
 if actor is null or ws is null or not public.is_workspace_member(ws) or public.current_crm_role() not in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER','SALES_SPECIALIST','SALES_SUPPORT') then raise exception 'milestone_update_forbidden';end if;
 if record_id is null or expected_revision<=0 or p_request_key is null or length(p_request_key) not between 8 and 160 or status_reason is null or length(status_reason)>1000
  or jsonb_typeof(data) is distinct from 'object' or not data ?& fields or exists(select 1 from jsonb_object_keys(data) k where not k=any(fields)) then raise exception 'milestone_input_invalid';end if;
 request_hash:=encode(extensions.digest(jsonb_build_object('actor',actor,'id',record_id,'revision',expected_revision,'data',data,'reason',status_reason)::text,'sha256'),'hex');
 perform pg_advisory_xact_lock(hashtextextended(ws::text||':'||p_request_key,0));
 candidate:=jsonb_populate_record(null::public.admission_milestones,data);candidate.id:=record_id;candidate.workspace_id:=ws;
 perform 1 from public.student_enrollments e join public.students s on s.id=e.student_id and s.workspace_id=e.workspace_id join public.contacts c on c.id=s.person_id and c.workspace_id=s.workspace_id
  where e.id=candidate.enrollment_id and e.workspace_id=ws and public.student_enrollment_access(to_jsonb(e),true) for share of e,s,c;
 if not found then raise exception 'milestone_enrollment_not_found';end if;
 if candidate.application_id is not null then
  perform 1 from public.student_applications a where a.id=candidate.application_id and a.workspace_id=ws and a.enrollment_id=candidate.enrollment_id and public.student_application_access(to_jsonb(a),false) for share;
  if not found then raise exception 'milestone_application_forbidden';end if;
 end if;
 select * into receipt from public.mutation_receipts where workspace_id=ws and request_key=p_request_key;
 if found then
  if receipt.operation<>'ADMISSION_MILESTONE_SAVE' or receipt.created_by<>actor or receipt.result->>'request_hash' is distinct from request_hash then raise exception 'milestone_request_conflict';end if;
  if not exists(select 1 from public.admission_milestones m where m.id=record_id and m.workspace_id=ws and public.admission_milestone_access(to_jsonb(m),true)) then raise exception 'milestone_update_forbidden';end if;
  return jsonb_populate_record(null::public.admission_milestones,receipt.result->'item');
 end if;
 perform pg_advisory_xact_lock(hashtextextended('admission-milestone:'||record_id::text,0));
 select * into previous from public.admission_milestones where id=record_id and workspace_id=ws for update;
 if found then
  if not public.admission_milestone_access(to_jsonb(previous),true) then raise exception 'milestone_update_forbidden';end if;
  if previous.enrollment_id is distinct from candidate.enrollment_id then raise exception 'milestone_parent_immutable';end if;
  if expected_revision is null or previous.revision<>expected_revision then raise exception 'milestone_version_conflict';end if;
 elsif expected_revision is not null then raise exception 'milestone_not_found';end if;
 if candidate.owner_id is not null and (not exists(select 1 from public.workspace_memberships m where m.workspace_id=ws and m.user_id=candidate.owner_id and m.status='ACTIVE')
  or ((previous.id is null or previous.owner_id is distinct from candidate.owner_id) and not public.can_assign_crm_task(candidate.owner_id))) then raise exception 'milestone_owner_invalid';end if;
 if not public.admission_milestone_access(to_jsonb(candidate),true) then raise exception 'milestone_update_forbidden';end if;
 if not public.admission_milestone_metadata_valid(candidate.milestone_type,candidate.metadata) then raise exception 'milestone_metadata_invalid';end if;
 perform set_config('app.milestone_status_reason',status_reason,true);
 if previous.id is null then
  insert into public.admission_milestones(id,workspace_id,enrollment_id,application_id,milestone_type,status,due_at,scheduled_at,completed_at,outcome,owner_id,external_reference,note,metadata,sequence,created_by)
   values(record_id,ws,candidate.enrollment_id,candidate.application_id,candidate.milestone_type,candidate.status,candidate.due_at,candidate.scheduled_at,candidate.completed_at,candidate.outcome,candidate.owner_id,candidate.external_reference,candidate.note,candidate.metadata,candidate.sequence,actor) returning * into result;
 else
  update public.admission_milestones set application_id=candidate.application_id,milestone_type=candidate.milestone_type,status=candidate.status,due_at=candidate.due_at,scheduled_at=candidate.scheduled_at,completed_at=candidate.completed_at,
   outcome=candidate.outcome,owner_id=candidate.owner_id,external_reference=candidate.external_reference,note=candidate.note,metadata=candidate.metadata,sequence=candidate.sequence,revision=revision+1,updated_at=clock_timestamp()
   where id=record_id and workspace_id=ws returning * into result;
 end if;
 insert into public.audit_events(workspace_id,actor_id,action,entity_type,entity_id,after_data) values(ws,actor,case when previous.id is null then 'ADMISSION_MILESTONE_CREATED' else 'ADMISSION_MILESTONE_UPDATED' end,'ADMISSION_MILESTONE',record_id,
  jsonb_build_object('revision',result.revision,'enrollmentId',result.enrollment_id,'applicationId',result.application_id,'fromType',previous.milestone_type,'type',result.milestone_type,'fromStatus',previous.status,'status',result.status));
 insert into public.mutation_receipts(workspace_id,request_key,operation,result,created_by) values(ws,p_request_key,'ADMISSION_MILESTONE_SAVE',jsonb_build_object('request_hash',request_hash,'item',to_jsonb(result)),actor);
 return result;
end $$;
revoke all on function public.save_admission_milestone(uuid,integer,jsonb,text,text) from public;
grant execute on function public.save_admission_milestone(uuid,integer,jsonb,text,text) to crm_app;
create view public.admission_milestone_records with(security_invoker=true) as
 select m.*,u.display_name_zh owner_name_zh,u.display_name_en owner_name_en,public.admission_milestone_access(to_jsonb(m),true) can_edit,
  (m.due_at<now() and m.status not in ('COMPLETED','WAIVED','CANCELLED')) overdue
 from public.admission_milestones m left join public.user_profiles u on u.user_id=m.owner_id;
grant select on public.admission_milestone_records to crm_app;
-- A stable business event projection, not the status-history stream. Timestamptz
-- comparisons use the same absolute business instant for every workspace timezone.
create view public.admissions_timeline with(security_invoker=true) as
 select a.workspace_id,a.enrollment_id,a.id application_id,'APPLICATION'::text source_type,a.id source_id,'SUBMITTED'::text event_type,null::text milestone_type,a.status,
  a.submitted_at event_at,0 sequence,null::text outcome from public.student_applications a where a.submitted_at is not null
 union all select a.workspace_id,a.enrollment_id,a.id,'APPLICATION',a.id,'DECISION',null,a.status,a.decision_at,0,a.decision from public.student_applications a where a.decision is not null and a.decision_at is not null
 union all select a.workspace_id,a.enrollment_id,a.id,'APPLICATION',a.id,'WITHDRAWN',null,a.status,a.withdrawn_at,0,null from public.student_applications a where a.withdrawn_at is not null
 union all select m.workspace_id,m.enrollment_id,m.application_id,'MILESTONE',m.id,'MILESTONE',m.milestone_type,m.status,coalesce(m.completed_at,m.scheduled_at,m.due_at,m.created_at),m.sequence,coalesce(m.outcome,m.metadata->>'result') from public.admission_milestones m;
grant select on public.admissions_timeline to crm_app;
create function public.cleanup_milestone_receipts() returns trigger language plpgsql security definer set search_path=public as $$ begin
 delete from public.mutation_receipts where workspace_id=old.workspace_id and operation='ADMISSION_MILESTONE_SAVE' and result->'item'->>'id'=old.id::text;return old;end $$;
revoke all on function public.cleanup_milestone_receipts() from public;
create trigger milestone_receipt_cleanup before delete on public.admission_milestones for each row execute function public.cleanup_milestone_receipts();

-- Extend existing quality processing; do not repeat constraint-invalid facts.
create or replace function public.run_data_quality_rules()
returns integer language plpgsql security definer set search_path=public,app_auth,extensions as $$
declare marker timestamptz:=clock_timestamp();affected integer;ws uuid:=public.current_workspace_id();
begin
  if public.current_crm_role() not in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER') then raise exception 'quality_not_authorized'; end if;

  insert into public.data_quality_issues(workspace_id,rule_key,entity_type,entity_id,severity,title_key,details,last_seen_at)
  select c.workspace_id,config.rule_key,'CONTACT',c.id,config.severity,'quality.rule.contactMethod',jsonb_build_object('nameZh',c.name_zh,'nameEn',c.name_en),marker
  from public.contacts c join public.data_quality_rule_configs config on config.workspace_id=c.workspace_id and config.rule_key='CONTACT_METHOD_MISSING' and config.enabled
  where c.workspace_id=ws and c.email is null and coalesce(c.phone,'')=''
  on conflict(workspace_id,rule_key,entity_type,entity_id) do update set severity=excluded.severity,status=case when data_quality_issues.status='RESOLVED' then 'OPEN' else data_quality_issues.status end,details=excluded.details,last_seen_at=marker;

  insert into public.data_quality_issues(workspace_id,rule_key,entity_type,entity_id,severity,title_key,details,last_seen_at)
  select o.workspace_id,config.rule_key,'OPPORTUNITY',o.id,config.severity,'quality.rule.nextAction',jsonb_build_object('titleZh',o.title_zh,'titleEn',o.title_en),marker
  from public.opportunities o join public.data_quality_rule_configs config on config.workspace_id=o.workspace_id and config.rule_key='OPPORTUNITY_NEXT_ACTION_MISSING' and config.enabled
  where o.workspace_id=ws and o.stage not in ('WON','LOST') and o.next_action_zh='' and o.next_action_en=''
  on conflict(workspace_id,rule_key,entity_type,entity_id) do update set severity=excluded.severity,status=case when data_quality_issues.status='RESOLVED' then 'OPEN' else data_quality_issues.status end,details=excluded.details,last_seen_at=marker;

  insert into public.data_quality_issues(workspace_id,rule_key,entity_type,entity_id,severity,title_key,details,last_seen_at)
  select organization.workspace_id,config.rule_key,'ORGANIZATION',organization.id,config.severity,'quality.rule.owner',jsonb_build_object('nameZh',organization.name_zh,'nameEn',organization.name_en),marker
  from public.organizations organization join public.data_quality_rule_configs config on config.workspace_id=organization.workspace_id and config.rule_key='ORGANIZATION_OWNER_MISSING' and config.enabled
  where organization.workspace_id=ws and organization.owner_id is null
  on conflict(workspace_id,rule_key,entity_type,entity_id) do update set severity=excluded.severity,status=case when data_quality_issues.status='RESOLVED' then 'OPEN' else data_quality_issues.status end,details=excluded.details,last_seen_at=marker;

  insert into public.data_quality_issues(workspace_id,rule_key,entity_type,entity_id,severity,title_key,details,last_seen_at)
  select student.workspace_id,config.rule_key,'STUDENT',student.id,config.severity,'quality.rule.guardianMissing',jsonb_build_object('studentId',student.student_number),marker
  from public.students student join public.data_quality_rule_configs config on config.workspace_id=student.workspace_id and config.rule_key='STUDENT_GUARDIAN_MISSING' and config.enabled
  where student.workspace_id=ws and student.status='ACTIVE' and not exists(select 1 from public.student_guardian_relationships relation where relation.student_id=student.id)
  on conflict(workspace_id,rule_key,entity_type,entity_id) do update set severity=excluded.severity,status=case when data_quality_issues.status='RESOLVED' then 'OPEN' else data_quality_issues.status end,details=excluded.details,last_seen_at=marker;

  insert into public.data_quality_issues(workspace_id,rule_key,entity_type,entity_id,severity,title_key,details,last_seen_at)
  select distinct on(consent.contact_id) consent.workspace_id,config.rule_key,'CONTACT',consent.contact_id,config.severity,'quality.rule.consentExpired',jsonb_build_object('channel',consent.channel,'purpose',consent.purpose,'retentionUntil',consent.retention_until),marker
  from public.contact_consents consent join public.data_quality_rule_configs config on config.workspace_id=consent.workspace_id and config.rule_key='CONSENT_EXPIRED' and config.enabled
  where consent.workspace_id=ws and consent.status='GRANTED' and consent.retention_until<current_date order by consent.contact_id,consent.retention_until
  on conflict(workspace_id,rule_key,entity_type,entity_id) do update set severity=excluded.severity,status=case when data_quality_issues.status='RESOLVED' then 'OPEN' else data_quality_issues.status end,details=excluded.details,last_seen_at=marker;

  insert into public.data_quality_issues(workspace_id,rule_key,entity_type,entity_id,severity,title_key,details,last_seen_at)
  select opportunity.workspace_id,config.rule_key,'OPPORTUNITY',opportunity.id,config.severity,'quality.rule.exchangeRateMissing',jsonb_build_object('currency',opportunity.currency,'amount',opportunity.amount),marker
  from public.opportunities opportunity join public.workspaces workspace on workspace.id=opportunity.workspace_id
  join public.data_quality_rule_configs config on config.workspace_id=opportunity.workspace_id and config.rule_key='OPPORTUNITY_EXCHANGE_RATE_MISSING' and config.enabled
  where opportunity.workspace_id=ws and opportunity.stage not in ('WON','LOST') and opportunity.currency<>workspace.default_currency
    and not exists(select 1 from public.exchange_rate_snapshots rate where rate.workspace_id=opportunity.workspace_id and rate.base_currency=workspace.default_currency and rate.quote_currency=opportunity.currency and rate.effective_at<=now())
  on conflict(workspace_id,rule_key,entity_type,entity_id) do update set severity=excluded.severity,status=case when data_quality_issues.status='RESOLVED' then 'OPEN' else data_quality_issues.status end,details=excluded.details,last_seen_at=marker;

  insert into public.data_quality_issues(workspace_id,rule_key,entity_type,entity_id,severity,title_key,details,last_seen_at)
  select lead.workspace_id,config.rule_key,'LEAD',lead.id,config.severity,'quality.rule.attributionMissing',jsonb_build_object('nameZh',lead.name_zh,'nameEn',lead.name_en,'source',lead.source),marker
  from public.leads lead join public.data_quality_rule_configs config on config.workspace_id=lead.workspace_id and config.rule_key='LEAD_ATTRIBUTION_MISSING' and config.enabled
  where lead.workspace_id=ws and lead.status not in ('CONVERTED','LOST') and not exists(select 1 from public.lead_attribution_touches touch where touch.lead_id=lead.id)
  on conflict(workspace_id,rule_key,entity_type,entity_id) do update set severity=excluded.severity,status=case when data_quality_issues.status='RESOLVED' then 'OPEN' else data_quality_issues.status end,details=excluded.details,last_seen_at=marker;

  insert into public.data_quality_issues(workspace_id,rule_key,entity_type,entity_id,severity,title_key,details,last_seen_at)
  select duplicate.workspace_id,config.rule_key,'CONTACT',duplicate.id,config.severity,'quality.rule.duplicateContact',jsonb_build_object('duplicateKey',duplicate.duplicate_key,'canonicalId',duplicate.canonical_id),marker
  from (
    select ranked.*,first_value(ranked.id) over(partition by ranked.workspace_id,ranked.duplicate_key order by ranked.created_at,ranked.id) canonical_id
    from (
      select c.*,coalesce(nullif(lower(c.email::text),''),nullif(regexp_replace(c.phone,'\D','','g'),'')) duplicate_key,
        count(*) over(partition by c.workspace_id,coalesce(nullif(lower(c.email::text),''),nullif(regexp_replace(c.phone,'\D','','g'),''))) duplicate_count
      from public.contacts c where c.workspace_id=ws
    ) ranked where ranked.duplicate_key is not null and ranked.duplicate_count>1
  ) duplicate join public.data_quality_rule_configs config on config.workspace_id=duplicate.workspace_id and config.rule_key='CONTACT_DUPLICATE' and config.enabled
  where duplicate.id<>duplicate.canonical_id
  on conflict(workspace_id,rule_key,entity_type,entity_id) do update set severity=excluded.severity,status=case when data_quality_issues.status='RESOLVED' then 'OPEN' else data_quality_issues.status end,details=excluded.details,last_seen_at=marker;

  insert into public.data_quality_issues(workspace_id,rule_key,entity_type,entity_id,severity,title_key,details,last_seen_at)
 select c.workspace_id,config.rule_key,'COHORT',c.id,config.severity,'quality.rule.COHORT_MISSING_APPLICATION_DEADLINE',jsonb_build_object('reference',c.id),marker
 from public.product_cohorts c join public.data_quality_rule_configs config on config.workspace_id=c.workspace_id and config.rule_key='COHORT_MISSING_APPLICATION_DEADLINE' and config.enabled
 where c.workspace_id=ws and (c.status in ('DRAFT','RECRUITING') and c.application_deadline is null)
 on conflict(workspace_id,rule_key,entity_type,entity_id) do update set severity=excluded.severity,status=case when data_quality_issues.status='RESOLVED' then 'OPEN' else data_quality_issues.status end,details=excluded.details,last_seen_at=marker;
  insert into public.data_quality_issues(workspace_id,rule_key,entity_type,entity_id,severity,title_key,details,last_seen_at)
 select c.workspace_id,config.rule_key,'COHORT',c.id,config.severity,'quality.rule.COHORT_MISSING_OWNER',jsonb_build_object('reference',c.id),marker
 from public.product_cohorts c join public.data_quality_rule_configs config on config.workspace_id=c.workspace_id and config.rule_key='COHORT_MISSING_OWNER' and config.enabled
 where c.workspace_id=ws and (c.status in ('DRAFT','RECRUITING','ACTIVE') and c.owner_id is null)
 on conflict(workspace_id,rule_key,entity_type,entity_id) do update set severity=excluded.severity,status=case when data_quality_issues.status='RESOLVED' then 'OPEN' else data_quality_issues.status end,details=excluded.details,last_seen_at=marker;
  insert into public.data_quality_issues(workspace_id,rule_key,entity_type,entity_id,severity,title_key,details,last_seen_at)
 select c.workspace_id,config.rule_key,'COHORT',c.id,config.severity,'quality.rule.COHORT_RECRUITING_AFTER_DEADLINE',jsonb_build_object('reference',c.id),marker
 from public.product_cohorts c join public.data_quality_rule_configs config on config.workspace_id=c.workspace_id and config.rule_key='COHORT_RECRUITING_AFTER_DEADLINE' and config.enabled
 where c.workspace_id=ws and (c.status='RECRUITING' and c.application_deadline<public.current_business_date()::date)
 on conflict(workspace_id,rule_key,entity_type,entity_id) do update set severity=excluded.severity,status=case when data_quality_issues.status='RESOLVED' then 'OPEN' else data_quality_issues.status end,details=excluded.details,last_seen_at=marker;
  insert into public.data_quality_issues(workspace_id,rule_key,entity_type,entity_id,severity,title_key,details,last_seen_at)
 select c.workspace_id,config.rule_key,'COHORT',c.id,config.severity,'quality.rule.COHORT_ACTIVE_WITHOUT_START_DATE',jsonb_build_object('reference',c.id),marker
 from public.product_cohorts c join public.data_quality_rule_configs config on config.workspace_id=c.workspace_id and config.rule_key='COHORT_ACTIVE_WITHOUT_START_DATE' and config.enabled
 where c.workspace_id=ws and (c.status='ACTIVE' and c.start_on is null)
 on conflict(workspace_id,rule_key,entity_type,entity_id) do update set severity=excluded.severity,status=case when data_quality_issues.status='RESOLVED' then 'OPEN' else data_quality_issues.status end,details=excluded.details,last_seen_at=marker;
  insert into public.data_quality_issues(workspace_id,rule_key,entity_type,entity_id,severity,title_key,details,last_seen_at)
 select c.workspace_id,config.rule_key,'COHORT',c.id,config.severity,'quality.rule.COHORT_COMPLETED_WITHOUT_END_DATE',jsonb_build_object('reference',c.id),marker
 from public.product_cohorts c join public.data_quality_rule_configs config on config.workspace_id=c.workspace_id and config.rule_key='COHORT_COMPLETED_WITHOUT_END_DATE' and config.enabled
 where c.workspace_id=ws and (c.status='COMPLETED' and c.end_on is null)
 on conflict(workspace_id,rule_key,entity_type,entity_id) do update set severity=excluded.severity,status=case when data_quality_issues.status='RESOLVED' then 'OPEN' else data_quality_issues.status end,details=excluded.details,last_seen_at=marker;
  insert into public.data_quality_issues(workspace_id,rule_key,entity_type,entity_id,severity,title_key,details,last_seen_at)
 select c.workspace_id,config.rule_key,'ENROLLMENT',c.id,config.severity,'quality.rule.ENROLLMENT_MISSING_HOUSEHOLD',jsonb_build_object('reference',c.id),marker
 from public.student_enrollments c join public.data_quality_rule_configs config on config.workspace_id=c.workspace_id and config.rule_key='ENROLLMENT_MISSING_HOUSEHOLD' and config.enabled
 where c.workspace_id=ws and (c.status in ('REGISTERING','ACTIVE') and c.household_id is null) and public.student_enrollment_access(to_jsonb(c),false)
 on conflict(workspace_id,rule_key,entity_type,entity_id) do update set severity=excluded.severity,status=case when data_quality_issues.status='RESOLVED' then 'OPEN' else data_quality_issues.status end,details=excluded.details,last_seen_at=marker;
  insert into public.data_quality_issues(workspace_id,rule_key,entity_type,entity_id,severity,title_key,details,last_seen_at)
 select c.workspace_id,config.rule_key,'ENROLLMENT',c.id,config.severity,'quality.rule.ENROLLMENT_WITHOUT_PRIMARY_ATTRIBUTION',jsonb_build_object('reference',c.id),marker
 from public.student_enrollments c join public.data_quality_rule_configs config on config.workspace_id=c.workspace_id and config.rule_key='ENROLLMENT_WITHOUT_PRIMARY_ATTRIBUTION' and config.enabled
 where c.workspace_id=ws and (c.status in ('INTERESTED','REGISTERING','ACTIVE') and not exists(select 1 from public.enrollment_attributions a where a.enrollment_id=c.id and a.workspace_id=c.workspace_id and a.attribution_type='PRIMARY')) and public.student_enrollment_access(to_jsonb(c),false)
 on conflict(workspace_id,rule_key,entity_type,entity_id) do update set severity=excluded.severity,status=case when data_quality_issues.status='RESOLVED' then 'OPEN' else data_quality_issues.status end,details=excluded.details,last_seen_at=marker;
  insert into public.data_quality_issues(workspace_id,rule_key,entity_type,entity_id,severity,title_key,details,last_seen_at)
 select c.workspace_id,config.rule_key,'ENROLLMENT',c.id,config.severity,'quality.rule.ENROLLMENT_ACTIVE_WITHOUT_CONTRACT',jsonb_build_object('reference',c.id),marker
 from public.student_enrollments c join public.data_quality_rule_configs config on config.workspace_id=c.workspace_id and config.rule_key='ENROLLMENT_ACTIVE_WITHOUT_CONTRACT' and config.enabled
 where c.workspace_id=ws and (c.status='ACTIVE' and not exists(select 1 from public.contract_enrollment_links l where l.enrollment_id=c.id and l.workspace_id=c.workspace_id and l.status='ACTIVE')) and public.student_enrollment_access(to_jsonb(c),false)
 on conflict(workspace_id,rule_key,entity_type,entity_id) do update set severity=excluded.severity,status=case when data_quality_issues.status='RESOLVED' then 'OPEN' else data_quality_issues.status end,details=excluded.details,last_seen_at=marker;
  insert into public.data_quality_issues(workspace_id,rule_key,entity_type,entity_id,severity,title_key,details,last_seen_at)
  select a.workspace_id,config.rule_key,'APPLICATION',a.id,config.severity,'quality.rule.APPLICATION_PAST_DEADLINE_NOT_SUBMITTED',jsonb_build_object('reference',a.id),marker
  from public.student_applications a join public.data_quality_rule_configs config on config.workspace_id=a.workspace_id and config.rule_key='APPLICATION_PAST_DEADLINE_NOT_SUBMITTED' and config.enabled
  where a.workspace_id=ws and a.status in ('DRAFT','PREPARING') and a.deadline_on<public.current_business_date()::date and public.student_application_access(to_jsonb(a),false)
  on conflict(workspace_id,rule_key,entity_type,entity_id) do update set severity=excluded.severity,status=case when data_quality_issues.status='RESOLVED' then 'OPEN' else data_quality_issues.status end,details=excluded.details,last_seen_at=marker;
  insert into public.data_quality_issues(workspace_id,rule_key,entity_type,entity_id,severity,title_key,details,last_seen_at)
  select m.workspace_id,config.rule_key,'ADMISSION_MILESTONE',m.id,config.severity,'quality.rule.MILESTONE_OVERDUE',jsonb_build_object('reference',m.id,'enrollmentId',m.enrollment_id),marker
  from public.admission_milestones m join public.data_quality_rule_configs config on config.workspace_id=m.workspace_id and config.rule_key='MILESTONE_OVERDUE' and config.enabled
  where m.workspace_id=ws and (m.due_at<now() and m.status not in ('COMPLETED','WAIVED','CANCELLED')) and public.admission_milestone_access(to_jsonb(m),false)
  on conflict(workspace_id,rule_key,entity_type,entity_id) do update set severity=excluded.severity,status=case when data_quality_issues.status='RESOLVED' then 'OPEN' else data_quality_issues.status end,details=excluded.details,last_seen_at=marker;
  insert into public.data_quality_issues(workspace_id,rule_key,entity_type,entity_id,severity,title_key,details,last_seen_at)
  select m.workspace_id,config.rule_key,'ADMISSION_MILESTONE',m.id,config.severity,'quality.rule.MILESTONE_BLOCKED',jsonb_build_object('reference',m.id,'enrollmentId',m.enrollment_id),marker
  from public.admission_milestones m join public.data_quality_rule_configs config on config.workspace_id=m.workspace_id and config.rule_key='MILESTONE_BLOCKED' and config.enabled
  where m.workspace_id=ws and (m.status='BLOCKED') and public.admission_milestone_access(to_jsonb(m),false)
  on conflict(workspace_id,rule_key,entity_type,entity_id) do update set severity=excluded.severity,status=case when data_quality_issues.status='RESOLVED' then 'OPEN' else data_quality_issues.status end,details=excluded.details,last_seen_at=marker;
  insert into public.data_quality_issues(workspace_id,rule_key,entity_type,entity_id,severity,title_key,details,last_seen_at)
  select m.workspace_id,config.rule_key,'ADMISSION_MILESTONE',m.id,config.severity,'quality.rule.VISA_RESULT_MISSING_OUTCOME',jsonb_build_object('reference',m.id,'enrollmentId',m.enrollment_id),marker
  from public.admission_milestones m join public.data_quality_rule_configs config on config.workspace_id=m.workspace_id and config.rule_key='VISA_RESULT_MISSING_OUTCOME' and config.enabled
  where m.workspace_id=ws and (m.milestone_type='VISA_RESULT' and m.status='COMPLETED' and m.outcome is null and not m.metadata ? 'result') and public.admission_milestone_access(to_jsonb(m),false)
  on conflict(workspace_id,rule_key,entity_type,entity_id) do update set severity=excluded.severity,status=case when data_quality_issues.status='RESOLVED' then 'OPEN' else data_quality_issues.status end,details=excluded.details,last_seen_at=marker;
  update public.data_quality_issues issue set status='RESOLVED',resolution_note='AUTO_RESOLVED',resolved_at=now(),resolved_by=app_auth.current_user_id()
  where issue.workspace_id=ws and issue.status in ('OPEN','ASSIGNED') and issue.last_seen_at<marker
    and issue.rule_key in (select rule_key from public.data_quality_rule_configs where workspace_id=ws);
  select count(*) into affected from public.data_quality_issues where workspace_id=ws and status in ('OPEN','ASSIGNED');
  return affected;
end;
$$;
insert into public.data_quality_rule_configs(workspace_id,rule_key,enabled,severity)
select w.id,r.rule_key,true,'MEDIUM' from public.workspaces w cross join(values ('MILESTONE_OVERDUE'),('MILESTONE_BLOCKED'),('VISA_RESULT_MISSING_OUTCOME')) r(rule_key) on conflict do nothing;
create function public.seed_milestone_quality() returns trigger language plpgsql security definer set search_path=public as $$ begin
 insert into public.data_quality_rule_configs(workspace_id,rule_key,enabled,severity) select new.id,r.rule_key,true,'MEDIUM' from(values ('MILESTONE_OVERDUE'),('MILESTONE_BLOCKED'),('VISA_RESULT_MISSING_OUTCOME')) r(rule_key) on conflict do nothing;return new;end $$;
revoke all on function public.seed_milestone_quality() from public;
create trigger seed_milestone_quality after insert on public.workspaces for each row execute function public.seed_milestone_quality();
