-- Confirmed operational support facts, independent of Health and existing domain facts.
set search_path=public,app_auth,extensions;
create table public.student_success_checkins(
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id),case_id uuid not null,
 checkin_type text not null check(checkin_type in ('ROUTINE','ACADEMIC','ENGAGEMENT','TRANSITION','FAMILY_COORDINATION','OTHER')),
 occurred_at timestamptz not null check(isfinite(occurred_at)),conducted_by uuid not null,
 summary text check(length(summary)<=2000),next_steps text check(length(next_steps)<=4000),revision integer not null default 1 check(revision>0),
 created_by uuid references app_auth.accounts(id),created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),
 unique(workspace_id,id),unique(workspace_id,case_id,id),foreign key(workspace_id,case_id) references public.student_success_cases(workspace_id,id) on delete cascade,
 foreign key(workspace_id,conducted_by) references public.workspace_memberships(workspace_id,user_id)
);
create index success_checkins_case_time_idx on public.student_success_checkins(workspace_id,case_id,occurred_at desc,id);
create table public.student_success_health_assessments(
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id),case_id uuid not null,checkin_id uuid,
 health_status text not null check(health_status in ('UNKNOWN','ON_TRACK','ATTENTION','AT_RISK')),assessed_at timestamptz not null check(isfinite(assessed_at)),assessed_by uuid not null references app_auth.accounts(id),
 rationale text check(length(rationale)<=1000),case_revision integer not null check(case_revision>0),created_at timestamptz not null default clock_timestamp(),
 foreign key(workspace_id,case_id) references public.student_success_cases(workspace_id,id) on delete cascade,
 foreign key(workspace_id,case_id,checkin_id) references public.student_success_checkins(workspace_id,case_id,id) on delete cascade
);
create index success_assessments_case_time_idx on public.student_success_health_assessments(workspace_id,case_id,assessed_at desc,id);
create table public.student_success_risk_signals(
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id),case_id uuid not null,source_checkin_id uuid,
 risk_type text not null check(risk_type in ('ACADEMIC','ATTENDANCE','ENGAGEMENT','LANGUAGE','TRANSITION','SUPPORT_NEED','LOGISTICS','OTHER')),
 severity text not null check(severity in ('LOW','MEDIUM','HIGH')),status text not null default 'OPEN' check(status in ('OPEN','MONITORING','RESOLVED','DISMISSED')),
 observed_at timestamptz not null check(isfinite(observed_at)),owner_id uuid,summary text not null check(length(trim(summary)) between 1 and 2000),
 resolution_note text check(length(resolution_note)<=2000),resolved_at timestamptz check(isfinite(resolved_at)),revision integer not null default 1 check(revision>0),
 created_by uuid references app_auth.accounts(id),created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),
 check(status<>'RESOLVED' or resolved_at is not null),unique(workspace_id,id),unique(workspace_id,case_id,id),
 foreign key(workspace_id,case_id) references public.student_success_cases(workspace_id,id) on delete cascade,
 foreign key(workspace_id,case_id,source_checkin_id) references public.student_success_checkins(workspace_id,case_id,id),
 foreign key(workspace_id,owner_id) references public.workspace_memberships(workspace_id,user_id)
);
create index success_risks_case_idx on public.student_success_risk_signals(workspace_id,case_id,status,id);
create table public.student_success_interventions(
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id),case_id uuid not null,risk_signal_id uuid,
 intervention_type text not null check(intervention_type in ('ACADEMIC_SUPPORT','LANGUAGE_SUPPORT','ENGAGEMENT_SUPPORT','ATTENDANCE_SUPPORT','MENTORING','TRANSITION_SUPPORT','FAMILY_COORDINATION','OTHER')),
 status text not null default 'PLANNED' check(status in ('PLANNED','ACTIVE','COMPLETED','CANCELLED')),owner_id uuid,
 started_on date,target_end_on date,completed_at timestamptz check(isfinite(completed_at)),summary text not null check(length(trim(summary)) between 1 and 2000),outcome_note text check(length(outcome_note)<=2000),
 revision integer not null default 1 check(revision>0),created_by uuid references app_auth.accounts(id),created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),
 check(status<>'COMPLETED' or completed_at is not null),check(started_on is null or target_end_on is null or started_on<=target_end_on),
 unique(workspace_id,id),unique(workspace_id,case_id,id),foreign key(workspace_id,case_id) references public.student_success_cases(workspace_id,id) on delete cascade,
 foreign key(workspace_id,case_id,risk_signal_id) references public.student_success_risk_signals(workspace_id,case_id,id),
 foreign key(workspace_id,owner_id) references public.workspace_memberships(workspace_id,user_id)
);
create index success_interventions_case_idx on public.student_success_interventions(workspace_id,case_id,status,id);
create table public.student_success_risk_status_history(
 id bigint generated always as identity primary key,workspace_id uuid not null references public.workspaces(id),case_id uuid not null,risk_signal_id uuid not null,
 from_status text check(from_status in ('OPEN','MONITORING','RESOLVED','DISMISSED')),to_status text not null check(to_status in ('OPEN','MONITORING','RESOLVED','DISMISSED')),
 changed_at timestamptz not null default clock_timestamp(),changed_by uuid references app_auth.accounts(id),reason text check(length(reason)<=1000),risk_revision integer not null,
 check(from_status is null or from_status<>to_status),unique(workspace_id,risk_signal_id,risk_revision),
 foreign key(workspace_id,case_id,risk_signal_id) references public.student_success_risk_signals(workspace_id,case_id,id) on delete cascade
);
create table public.student_success_intervention_status_history(
 id bigint generated always as identity primary key,workspace_id uuid not null references public.workspaces(id),case_id uuid not null,intervention_id uuid not null,
 from_status text check(from_status in ('PLANNED','ACTIVE','COMPLETED','CANCELLED')),to_status text not null check(to_status in ('PLANNED','ACTIVE','COMPLETED','CANCELLED')),
 changed_at timestamptz not null default clock_timestamp(),changed_by uuid references app_auth.accounts(id),reason text check(length(reason)<=1000),intervention_revision integer not null,
 check(from_status is null or from_status<>to_status),unique(workspace_id,intervention_id,intervention_revision),
 foreign key(workspace_id,case_id,intervention_id) references public.student_success_interventions(workspace_id,case_id,id) on delete cascade
);
create index success_risk_history_case_idx on public.student_success_risk_status_history(workspace_id,case_id,changed_at,id);
create index success_intervention_history_case_idx on public.student_success_intervention_status_history(workspace_id,case_id,changed_at,id);
alter table public.student_success_task_links add column intervention_id uuid;
alter table public.student_success_task_links add foreign key(workspace_id,case_id,intervention_id) references public.student_success_interventions(workspace_id,case_id,id);

do $$declare t text;begin
 foreach t in array array['student_success_checkins','student_success_health_assessments','student_success_risk_signals','student_success_risk_status_history','student_success_interventions','student_success_intervention_status_history'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,crm_app,crm_worker',t);
  execute format('grant select on public.%I to crm_app,crm_worker',t);
  execute format('create policy success_operations_read on public.%I for select to crm_app using(public.student_success_parent_access(case_id,false))',t);
  execute format('create policy success_operations_privacy on public.%I for select to crm_worker using(true)',t);
 end loop;
 foreach t in array array['student_success_checkins','student_success_risk_signals','student_success_interventions'] loop
  execute format('create trigger success_operations_identity before update on public.%I for each row execute function public.guard_student_success_identity()',t);
 end loop;
 foreach t in array array['student_success_health_assessments','student_success_risk_status_history','student_success_intervention_status_history'] loop
  execute format('create trigger success_operations_append_only before update on public.%I for each row execute function public.guard_success_history()',t);
 end loop;
end $$;
-- The Phase 1 identity trigger also protects Case ownership of new operational records.
create function public.guard_success_operations_case() returns trigger language plpgsql as $$begin
 if new.case_id is distinct from old.case_id then raise exception 'success_parent_immutable';end if;return new;end $$;
do $$declare t text;begin foreach t in array array['student_success_checkins','student_success_risk_signals','student_success_interventions'] loop
 execute format('create trigger success_operations_case_immutable before update on public.%I for each row execute function public.guard_success_operations_case()',t);end loop;end $$;
revoke all on function public.guard_success_operations_case() from public;

create function public.record_success_health_assessment() returns trigger language plpgsql security definer set search_path=public,app_auth,extensions as $$begin
 if (tg_op='INSERT' and new.health_status<>'UNKNOWN') or (tg_op='UPDATE' and new.health_status is distinct from old.health_status) then
  insert into public.student_success_health_assessments(workspace_id,case_id,checkin_id,health_status,assessed_at,assessed_by,rationale,case_revision)
  values(new.workspace_id,new.id,nullif(current_setting('app.success_assessment_checkin',true),'')::uuid,new.health_status,
   coalesce(nullif(current_setting('app.success_assessed_at',true),'')::timestamptz,clock_timestamp()),app_auth.current_user_id(),nullif(current_setting('app.success_health_rationale',true),''),new.revision);
 end if;return new;end $$;
create trigger success_health_assessment after insert or update of health_status on public.student_success_cases for each row execute function public.record_success_health_assessment();
revoke all on function public.record_success_health_assessment() from public;
create function public.record_success_operations_status() returns trigger language plpgsql security definer set search_path=public,app_auth,extensions as $$begin
 if tg_op='INSERT' or new.status is distinct from old.status then
  if tg_table_name='student_success_risk_signals' then
   insert into public.student_success_risk_status_history(workspace_id,case_id,risk_signal_id,from_status,to_status,changed_at,changed_by,reason,risk_revision)
    values(new.workspace_id,new.case_id,new.id,case when tg_op='INSERT' then null else old.status end,new.status,new.updated_at,app_auth.current_user_id(),nullif(current_setting('app.success_operation_reason',true),''),new.revision);
  else
   insert into public.student_success_intervention_status_history(workspace_id,case_id,intervention_id,from_status,to_status,changed_at,changed_by,reason,intervention_revision)
    values(new.workspace_id,new.case_id,new.id,case when tg_op='INSERT' then null else old.status end,new.status,new.updated_at,app_auth.current_user_id(),nullif(current_setting('app.success_operation_reason',true),''),new.revision);
  end if;
 end if;return new;end $$;
create trigger success_risk_status_record after insert or update of status on public.student_success_risk_signals for each row execute function public.record_success_operations_status();
create trigger success_intervention_status_record after insert or update of status on public.student_success_interventions for each row execute function public.record_success_operations_status();
revoke all on function public.record_success_operations_status() from public;

create function public.save_student_success_operation(resource text,record_id uuid,expected_revision integer,data jsonb,p_request_key text,status_reason text default '',options jsonb default '{}') returns jsonb
language plpgsql security definer set search_path=public,app_auth,extensions as $$
declare ws uuid:=public.current_workspace_id();actor uuid:=app_auth.current_user_id();fields text[];table_name text;case_row public.student_success_cases;
 old_row jsonb;candidate jsonb;result jsonb;receipt public.mutation_receipts;fingerprint text;update_list text;changed_fields jsonb;staff uuid;
 assess boolean:=false;review boolean:=false;old_health text;
begin
 if actor is null or ws is null or not public.is_workspace_member(ws) then raise exception 'success_update_forbidden';end if;
 if resource='CHECKIN' then table_name:='student_success_checkins';fields:=array['case_id','checkin_type','occurred_at','conducted_by','summary','next_steps'];
 elsif resource='RISK' then table_name:='student_success_risk_signals';fields:=array['case_id','source_checkin_id','risk_type','severity','status','observed_at','owner_id','summary','resolution_note','resolved_at'];
 elsif resource='INTERVENTION' then table_name:='student_success_interventions';fields:=array['case_id','risk_signal_id','intervention_type','status','owner_id','started_on','target_end_on','completed_at','summary','outcome_note'];
 else raise exception 'success_input_invalid';end if;
 if record_id is null or expected_revision<=0 or p_request_key is null or length(p_request_key) not between 8 and 160 or status_reason is null or length(status_reason)>1000
  or jsonb_typeof(data) is distinct from 'object' or not data ?& fields or exists(select 1 from jsonb_object_keys(data) k where not k=any(fields))
  or jsonb_typeof(options) is distinct from 'object' or exists(select 1 from jsonb_object_keys(options) k where k not in ('assess_health','health_status','rationale','update_next_review','next_review_on','expected_case_revision')) then raise exception 'success_input_invalid';end if;
 assess:=coalesce((options->>'assess_health')::boolean,false);review:=coalesce((options->>'update_next_review')::boolean,false);
 if resource<>'CHECKIN' and options<>'{}'::jsonb then raise exception 'success_input_invalid';end if;
 if assess and (options->>'health_status' is null or options->>'health_status' not in ('UNKNOWN','ON_TRACK','ATTENTION','AT_RISK') or length(options->>'rationale')>1000) then raise exception 'success_input_invalid';end if;
 if not assess and (options->>'health_status' is not null or options->>'rationale' is not null) then raise exception 'success_input_invalid';end if;
 if not review and options->>'next_review_on' is not null then raise exception 'success_input_invalid';end if;
 fingerprint:=encode(extensions.digest(jsonb_build_object('actor',actor,'resource',resource,'id',record_id,'revision',expected_revision,'data',data,'options',options,'reason',status_reason)::text,'sha256'),'hex');
 perform pg_advisory_xact_lock(hashtextextended(ws::text||':'||p_request_key,0));
 select * into case_row from public.student_success_cases c where c.id=(data->>'case_id')::uuid and c.workspace_id=ws and public.student_success_case_access(to_jsonb(c),true);
 if not found then raise exception 'success_case_not_found';end if;
 select * into receipt from public.mutation_receipts where workspace_id=ws and request_key=p_request_key;
 if found then
  if receipt.operation<>'SUCCESS_'||resource||'_SAVE' or receipt.created_by<>actor or receipt.result->>'request_hash' is distinct from fingerprint then raise exception 'success_request_conflict';end if;return receipt.result->'item';
 end if;
 perform pg_advisory_xact_lock(hashtextextended('success-enrollment:'||ws::text||':'||case_row.enrollment_id::text,0));
 perform 1 from public.student_enrollments e join public.students s on s.id=e.student_id and s.workspace_id=e.workspace_id join public.contacts c on c.id=s.person_id and c.workspace_id=s.workspace_id where e.id=case_row.enrollment_id and e.workspace_id=ws for share of e,s,c;
 select * into case_row from public.student_success_cases c where c.id=case_row.id and c.workspace_id=ws and public.student_success_case_access(to_jsonb(c),true) for update;
 if not found then raise exception 'success_update_forbidden';end if;
 if (assess or review) and (options->>'expected_case_revision' is null or (options->>'expected_case_revision')::integer<>case_row.revision) then raise exception 'success_version_conflict';end if;
 execute format('select to_jsonb(r) from public.%I r where id=$1 and workspace_id=$2 for update',table_name) into old_row using record_id,ws;
 if old_row is not null then
  if old_row->>'case_id' is distinct from data->>'case_id' then raise exception 'success_parent_immutable';end if;
  if expected_revision is null or expected_revision<>(old_row->>'revision')::integer then raise exception 'success_version_conflict';end if;
 elsif expected_revision is not null then raise exception 'success_not_found';end if;
 staff:=case when resource='CHECKIN' then (data->>'conducted_by')::uuid else (data->>'owner_id')::uuid end;
 if staff is not null and (not exists(select 1 from public.workspace_memberships m where m.workspace_id=ws and m.user_id=staff and m.status='ACTIVE')
  or ((old_row is null or old_row->>case when resource='CHECKIN' then 'conducted_by' else 'owner_id' end is distinct from staff::text) and not public.can_assign_crm_task(staff))) then raise exception 'success_owner_invalid';end if;
 if resource='RISK' and data->>'source_checkin_id' is not null and not exists(select 1 from public.student_success_checkins where id=(data->>'source_checkin_id')::uuid and case_id=case_row.id and workspace_id=ws) then raise exception 'success_checkin_context_mismatch';end if;
 if resource='INTERVENTION' and data->>'risk_signal_id' is not null and not exists(select 1 from public.student_success_risk_signals where id=(data->>'risk_signal_id')::uuid and case_id=case_row.id and workspace_id=ws) then raise exception 'success_risk_context_mismatch';end if;
 candidate:=data||jsonb_build_object('id',record_id,'workspace_id',ws,'revision',coalesce((old_row->>'revision')::integer,0)+1,'created_by',coalesce(old_row->>'created_by',actor::text),'created_at',coalesce(old_row->>'created_at',clock_timestamp()::text),'updated_at',clock_timestamp());
 perform set_config('app.success_operation_reason',status_reason,true);
 if old_row is null then execute format('insert into public.%I select (jsonb_populate_record(null::public.%I,$1)).* returning to_jsonb(%I.*)',table_name,table_name,table_name) into result using candidate;
 else
  select string_agg(format('%I=r.%I',f,f),',') into update_list from unnest(fields||array['revision','updated_at']) f;
  execute format('update public.%I t set %s from jsonb_populate_record(null::public.%I,$1) r where t.id=$2 and t.workspace_id=$3 returning to_jsonb(t.*)',table_name,update_list,table_name) into result using candidate,record_id,ws;
 end if;
 if assess or review then
  old_health:=case_row.health_status;
  perform set_config('app.success_assessment_checkin',record_id::text,true);perform set_config('app.success_assessed_at',data->>'occurred_at',true);perform set_config('app.success_health_rationale',coalesce(options->>'rationale',''),true);
  update public.student_success_cases set health_status=case when assess then options->>'health_status' else health_status end,next_review_on=case when review then (options->>'next_review_on')::date else next_review_on end,revision=revision+1,updated_at=clock_timestamp() where id=case_row.id and workspace_id=ws returning * into case_row;
  if assess and old_health=case_row.health_status then
   insert into public.student_success_health_assessments(workspace_id,case_id,checkin_id,health_status,assessed_at,assessed_by,rationale,case_revision) values(ws,case_row.id,record_id,case_row.health_status,(data->>'occurred_at')::timestamptz,actor,options->>'rationale',case_row.revision);
  end if;
  perform set_config('app.success_assessment_checkin','',true);perform set_config('app.success_assessed_at','',true);perform set_config('app.success_health_rationale','',true);
  insert into public.audit_events(workspace_id,actor_id,action,entity_type,entity_id,after_data) values(ws,actor,'STUDENT_SUCCESS_CASE_UPDATED','STUDENT_SUCCESS_CASE',case_row.id,jsonb_build_object('revision',case_row.revision,'checkinId',record_id,'healthAssessed',assess,'reviewUpdated',review));
 end if;
 select coalesce(jsonb_agg(k),'[]') into changed_fields from unnest(fields) k where old_row is null or old_row->k is distinct from result->k;
 insert into public.audit_events(workspace_id,actor_id,action,entity_type,entity_id,after_data) values(ws,actor,'STUDENT_SUCCESS_'||resource||case when old_row is null then '_CREATED' else '_UPDATED' end,'STUDENT_SUCCESS_'||resource,record_id,jsonb_build_object('caseId',case_row.id,'revision',result->'revision','changedFields',changed_fields));
 insert into public.mutation_receipts(workspace_id,request_key,operation,result,created_by) values(ws,p_request_key,'SUCCESS_'||resource||'_SAVE',jsonb_build_object('request_hash',fingerprint,'item',result),actor);
 return result;
end $$;
revoke all on function public.save_student_success_operation(text,uuid,integer,jsonb,text,text,jsonb) from public,crm_app,crm_worker;
create function public.save_student_success_checkin(record_id uuid,expected_revision integer,data jsonb,p_request_key text,options jsonb default '{}') returns jsonb language sql security definer set search_path=public,app_auth,extensions as $$select public.save_student_success_operation('CHECKIN',record_id,expected_revision,data,p_request_key,'',options)$$;
create function public.save_student_success_risk(record_id uuid,expected_revision integer,data jsonb,p_request_key text,status_reason text default '') returns jsonb language sql security definer set search_path=public,app_auth,extensions as $$select public.save_student_success_operation('RISK',record_id,expected_revision,data,p_request_key,status_reason,'{}')$$;
create function public.save_student_success_intervention(record_id uuid,expected_revision integer,data jsonb,p_request_key text,status_reason text default '') returns jsonb language sql security definer set search_path=public,app_auth,extensions as $$select public.save_student_success_operation('INTERVENTION',record_id,expected_revision,data,p_request_key,status_reason,'{}')$$;
revoke all on function public.save_student_success_checkin(uuid,integer,jsonb,text,jsonb),public.save_student_success_risk(uuid,integer,jsonb,text,text),public.save_student_success_intervention(uuid,integer,jsonb,text,text) from public;
grant execute on function public.save_student_success_checkin(uuid,integer,jsonb,text,jsonb),public.save_student_success_risk(uuid,integer,jsonb,text,text),public.save_student_success_intervention(uuid,integer,jsonb,text,text) to crm_app;

create function public.save_student_success_intervention_task_link(record_id uuid,target_case uuid,target_task uuid,target_goal uuid,target_intervention uuid,expected_revision integer,unlink boolean,p_request_key text) returns jsonb
language plpgsql security definer set search_path=public,app_auth,extensions as $$
declare ws uuid:=public.current_workspace_id();actor uuid:=app_auth.current_user_id();fingerprint text;receipt public.mutation_receipts;item jsonb;
begin
 if not public.student_success_parent_access(target_case,true) then raise exception 'success_update_forbidden';end if;
 if p_request_key is null or length(p_request_key) not between 8 and 160 then raise exception 'success_input_invalid';end if;
 fingerprint:=encode(extensions.digest(jsonb_build_object('actor',actor,'id',record_id,'case',target_case,'task',target_task,'goal',target_goal,'intervention',target_intervention,'revision',expected_revision,'unlink',unlink)::text,'sha256'),'hex');
 perform pg_advisory_xact_lock(hashtextextended(ws::text||':'||p_request_key,0));
 if not exists(select 1 from public.crm_tasks t where t.id=target_task and t.workspace_id=ws and t.archived_at is null and public.can_access_owned_record(ws,'TASK',t.id,t.owner_id,true)) then raise exception 'success_task_forbidden';end if;
 if target_intervention is null or not exists(select 1 from public.student_success_interventions where workspace_id=ws and id=target_intervention and case_id=target_case) then raise exception 'success_intervention_context_mismatch';end if;
 select * into receipt from public.mutation_receipts where workspace_id=ws and request_key=p_request_key;
 if found then if receipt.operation<>'SUCCESS_INTERVENTION_TASK_LINK' or receipt.created_by<>actor or receipt.result->>'request_hash' is distinct from fingerprint then raise exception 'success_request_conflict';end if;return receipt.result->'item';end if;
 if unlink and not exists(select 1 from public.student_success_task_links where workspace_id=ws and id=record_id and intervention_id=target_intervention) then raise exception 'success_intervention_context_mismatch';end if;
 item:=public.save_student_success_task_link(record_id,target_case,target_task,target_goal,expected_revision,unlink,'success-intervention:'||encode(extensions.digest(p_request_key,'sha256'),'hex'));
 if not unlink then update public.student_success_task_links set intervention_id=target_intervention where id=record_id and workspace_id=ws returning to_jsonb(student_success_task_links.*) into item;end if;
 insert into public.audit_events(workspace_id,actor_id,action,entity_type,entity_id,after_data) values(ws,actor,case when unlink then 'STUDENT_SUCCESS_INTERVENTION_TASK_UNLINKED' else 'STUDENT_SUCCESS_INTERVENTION_TASK_LINKED' end,'STUDENT_SUCCESS_CASE',target_case,jsonb_build_object('taskId',target_task,'interventionId',target_intervention,'linkId',record_id,'revision',item->'revision'));
 insert into public.mutation_receipts(workspace_id,request_key,operation,result,created_by) values(ws,p_request_key,'SUCCESS_INTERVENTION_TASK_LINK',jsonb_build_object('request_hash',fingerprint,'item',item),actor);return item;
end $$;
revoke all on function public.save_student_success_intervention_task_link(uuid,uuid,uuid,uuid,uuid,integer,boolean,text) from public;
grant execute on function public.save_student_success_intervention_task_link(uuid,uuid,uuid,uuid,uuid,integer,boolean,text) to crm_app;

create function public.cleanup_success_operations() returns trigger language plpgsql security definer set search_path=public as $$begin
 delete from public.mutation_receipts where workspace_id=old.workspace_id and operation in ('SUCCESS_CHECKIN_SAVE','SUCCESS_RISK_SAVE','SUCCESS_INTERVENTION_SAVE') and result->'item'->>'id'=old.id::text;
 if tg_table_name='student_success_interventions' then delete from public.mutation_receipts where workspace_id=old.workspace_id and operation='SUCCESS_INTERVENTION_TASK_LINK' and result->'item'->>'intervention_id'=old.id::text;end if;
 delete from public.data_quality_issues where workspace_id=old.workspace_id and entity_id=old.id and entity_type in ('STUDENT_SUCCESS_RISK','STUDENT_SUCCESS_INTERVENTION');return old;end $$;
do $$declare t text;begin foreach t in array array['student_success_checkins','student_success_risk_signals','student_success_interventions'] loop
 execute format('create trigger success_operations_privacy_cleanup before delete on public.%I for each row execute function public.cleanup_success_operations()',t);end loop;end $$;
revoke all on function public.cleanup_success_operations() from public;

-- Existing Task view keeps its original column ordering for callers; new context is appended.
create or replace view public.student_success_task_records with(security_invoker=true) as
 select l.id,l.workspace_id,l.case_id,l.goal_id,l.task_id,l.revision,l.created_by,l.created_at,t.title_zh,t.title_en,t.status,t.priority,t.due_at,t.owner_id,public.can_access_owned_record(t.workspace_id,'TASK',t.id,t.owner_id,true) can_edit,l.intervention_id
 from public.student_success_task_links l join public.crm_tasks t on t.id=l.task_id and t.workspace_id=l.workspace_id where t.archived_at is null;
create view public.student_success_checkin_records with(security_invoker=true) as
 select c.*,u.display_name_zh conducted_name_zh,u.display_name_en conducted_name_en,
 (select jsonb_agg(jsonb_build_object('id',a.id,'health_status',a.health_status,'assessed_at',a.assessed_at) order by a.created_at,a.id) from public.student_success_health_assessments a where a.checkin_id=c.id and a.workspace_id=c.workspace_id) assessments
 from public.student_success_checkins c left join public.user_profiles u on u.user_id=c.conducted_by;
create view public.student_success_risk_records with(security_invoker=true) as
 select r.*,(select k.occurred_at from public.student_success_checkins k where k.id=r.source_checkin_id and k.workspace_id=r.workspace_id) source_checkin_at,u.display_name_zh owner_name_zh,u.display_name_en owner_name_en,
 (select count(*) from public.student_success_interventions i where i.risk_signal_id=r.id and i.workspace_id=r.workspace_id and i.status='ACTIVE') active_intervention_count
 from public.student_success_risk_signals r left join public.user_profiles u on u.user_id=r.owner_id;
create view public.student_success_intervention_records with(security_invoker=true) as
 select i.*,u.display_name_zh owner_name_zh,u.display_name_en owner_name_en,r.summary risk_summary,
 (select count(*) from public.student_success_task_records t where t.intervention_id=i.id and t.workspace_id=i.workspace_id) visible_task_count
 from public.student_success_interventions i left join public.user_profiles u on u.user_id=i.owner_id left join public.student_success_risk_signals r on r.id=i.risk_signal_id and r.workspace_id=i.workspace_id;
create view public.student_success_operational_history with(security_invoker=true) as
 select 'CASE:'||id::text id,workspace_id,case_id,'CASE'::text source_type,case_id reference_id,from_status,to_status,changed_at,changed_by,reason,case_revision revision from public.student_success_case_status_history
 union all select 'HEALTH:'||id::text,workspace_id,case_id,'HEALTH',id,null,health_status,assessed_at,assessed_by,rationale,case_revision from public.student_success_health_assessments
 union all select 'RISK:'||id::text,workspace_id,case_id,'RISK',risk_signal_id,from_status,to_status,changed_at,changed_by,reason,risk_revision from public.student_success_risk_status_history
 union all select 'INTERVENTION:'||id::text,workspace_id,case_id,'INTERVENTION',intervention_id,from_status,to_status,changed_at,changed_by,reason,intervention_revision from public.student_success_intervention_status_history;
grant select on public.student_success_checkin_records,public.student_success_risk_records,public.student_success_intervention_records,public.student_success_operational_history to crm_app;

create or replace view public.student_success_records with(security_invoker=true) as
 select c.*,e.student_id,e.cohort_id,co.product_id,e.status enrollment_status,e.owner_id enrollment_owner_id,
 p.name_zh student_name_zh,p.name_en student_name_en,s.student_number,co.name_zh cohort_name_zh,co.name_en cohort_name_en,pr.name_zh product_name_zh,pr.name_en product_name_en,
 u.display_name_zh owner_name_zh,u.display_name_en owner_name_en,eu.display_name_zh enrollment_owner_name_zh,eu.display_name_en enrollment_owner_name_en,public.student_success_case_access(to_jsonb(c),true) can_edit,
 (select count(*) from public.student_success_goals g where g.case_id=c.id and g.workspace_id=c.workspace_id and g.status='ACTIVE') active_goal_count,
 (select count(*) from public.student_success_task_records t where t.case_id=c.id and t.workspace_id=c.workspace_id and t.status<>'DONE') open_task_count,
 (select max(k.occurred_at) from public.student_success_checkins k where k.case_id=c.id and k.workspace_id=c.workspace_id) last_checkin_at,
 (select count(*) from public.student_success_risk_signals r where r.case_id=c.id and r.workspace_id=c.workspace_id and r.status in ('OPEN','MONITORING')) open_risk_count,
 (select count(*) from public.student_success_risk_signals r where r.case_id=c.id and r.workspace_id=c.workspace_id and r.status in ('OPEN','MONITORING') and r.severity='HIGH') high_risk_count,
 (select count(*) from public.student_success_interventions i where i.case_id=c.id and i.workspace_id=c.workspace_id and i.status='ACTIVE') active_intervention_count
 from public.student_success_cases c join public.student_enrollments e on e.id=c.enrollment_id and e.workspace_id=c.workspace_id
 join public.students s on s.id=e.student_id and s.workspace_id=e.workspace_id join public.contacts p on p.id=s.person_id and p.workspace_id=s.workspace_id
 join public.product_cohorts co on co.id=e.cohort_id and co.workspace_id=e.workspace_id join public.products pr on pr.id=co.product_id and pr.workspace_id=co.workspace_id
 left join public.user_profiles u on u.user_id=c.owner_id left join public.user_profiles eu on eu.user_id=e.owner_id;

insert into public.data_quality_rule_configs(workspace_id,rule_key,severity,enabled) select w.id,k,'MEDIUM',true from public.workspaces w cross join unnest(array['ACTIVE_CASE_WITHOUT_RECENT_CHECKIN','AT_RISK_CASE_WITHOUT_OPEN_RISK','HIGH_RISK_WITHOUT_ACTIVE_INTERVENTION','ACTIVE_INTERVENTION_PAST_TARGET_DATE','OPEN_RISK_WITHOUT_OWNER']) k on conflict do nothing;
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

 insert into public.data_quality_issues(workspace_id,rule_key,entity_type,entity_id,severity,title_key,details,last_seen_at)
 select w.workspace_id,c.rule_key,'WORKFLOW',w.id,c.severity,'quality.rule.'||c.rule_key,jsonb_build_object('enrollmentId',w.enrollment_id),marker
 from public.workflow_instances w join public.data_quality_rule_configs c on c.workspace_id=w.workspace_id and c.enabled
 where w.workspace_id=ws and public.workflow_instance_access(to_jsonb(w),false) and w.cancelled_at is null and
 ((c.rule_key='WORKFLOW_INSTANCE_BLOCKED' and public.workflow_projection(w.id)->>'status'='BLOCKED')
 or (c.rule_key='WORKFLOW_STEP_OVERDUE' and exists(select 1 from public.workflow_states(w.id) x where x.due_at<now() and x.status not in ('COMPLETED','WAIVED','CANCELLED')))
 or (c.rule_key='WORKFLOW_MISSING_CONTEXT' and exists(select 1 from public.workflow_states(w.id) x where x.context_warning is not null)))
 on conflict(workspace_id,rule_key,entity_type,entity_id) do update set last_seen_at=excluded.last_seen_at,status=case when data_quality_issues.status='DISMISSED' then 'DISMISSED' else 'OPEN' end;

 insert into public.data_quality_issues(workspace_id,rule_key,entity_type,entity_id,severity,title_key,details,last_seen_at)
 select ws,config.rule_key,'ORGANIZATION',o.id,config.severity,'quality.rule.STRATEGIC_ACCOUNT_WITHOUT_KEY_CONTACT',jsonb_build_object('reference',o.id),marker
 from public.organizations o join public.organization_business_profiles b on b.workspace_id=o.workspace_id and b.id=o.id
 join public.data_quality_rule_configs config on config.workspace_id=ws and config.rule_key='STRATEGIC_ACCOUNT_WITHOUT_KEY_CONTACT' and config.enabled
 where o.workspace_id=ws and public.customer_subject_access('ORGANIZATION',o.id,false) and (b.commercial_tier='S' and not exists(select 1 from public.organization_contact_intelligence i where i.organization_id=o.id and i.workspace_id=ws and i.key_contact_status='KEY'))
 on conflict(workspace_id,rule_key,entity_type,entity_id) do update set severity=excluded.severity,status=case when data_quality_issues.status='RESOLVED' then 'OPEN' else data_quality_issues.status end,details=excluded.details,last_seen_at=marker;

 insert into public.data_quality_issues(workspace_id,rule_key,entity_type,entity_id,severity,title_key,details,last_seen_at)
 select ws,config.rule_key,'ORGANIZATION',o.id,config.severity,'quality.rule.HIGH_TIER_ACCOUNT_WITHOUT_NEXT_ACTION',jsonb_build_object('reference',o.id),marker
 from public.organizations o join public.organization_business_profiles b on b.workspace_id=o.workspace_id and b.id=o.id
 join public.data_quality_rule_configs config on config.workspace_id=ws and config.rule_key='HIGH_TIER_ACCOUNT_WITHOUT_NEXT_ACTION' and config.enabled
 where o.workspace_id=ws and public.customer_subject_access('ORGANIZATION',o.id,false) and (b.commercial_tier in ('S','A') and trim(coalesce(b.next_action,''))='')
 on conflict(workspace_id,rule_key,entity_type,entity_id) do update set severity=excluded.severity,status=case when data_quality_issues.status='RESOLVED' then 'OPEN' else data_quality_issues.status end,details=excluded.details,last_seen_at=marker;

 insert into public.data_quality_issues(workspace_id,rule_key,entity_type,entity_id,severity,title_key,details,last_seen_at)
 select ws,config.rule_key,'ORGANIZATION',o.id,config.severity,'quality.rule.CHANNEL_ACCOUNT_WITHOUT_OWNER',jsonb_build_object('reference',o.id),marker
 from public.organizations o join public.organization_business_profiles b on b.workspace_id=o.workspace_id and b.id=o.id
 join public.data_quality_rule_configs config on config.workspace_id=ws and config.rule_key='CHANNEL_ACCOUNT_WITHOUT_OWNER' and config.enabled
 where o.workspace_id=ws and public.customer_subject_access('ORGANIZATION',o.id,false) and (o.owner_id is null and b.organization_type in ('SCHOOL','PARTNER'))
 on conflict(workspace_id,rule_key,entity_type,entity_id) do update set severity=excluded.severity,status=case when data_quality_issues.status='RESOLVED' then 'OPEN' else data_quality_issues.status end,details=excluded.details,last_seen_at=marker;

 insert into public.data_quality_issues(workspace_id,rule_key,entity_type,entity_id,severity,title_key,details,last_seen_at)
 select ws,config.rule_key,'CONTACT',c.id,config.severity,'quality.rule.KEY_CONTACT_WITHOUT_DECISION_ROLE',jsonb_build_object('reference',c.id),marker
 from public.organization_contact_intelligence i join public.contacts c on c.workspace_id=i.workspace_id and c.id=i.contact_id
 join public.data_quality_rule_configs config on config.workspace_id=ws and config.rule_key='KEY_CONTACT_WITHOUT_DECISION_ROLE' and config.enabled
 where i.workspace_id=ws and i.key_contact_status='KEY' and public.channel_intelligence_access('intelligence',to_jsonb(i),false) and (c.decision_role='UNKNOWN')
 on conflict(workspace_id,rule_key,entity_type,entity_id) do update set severity=excluded.severity,status=case when data_quality_issues.status='RESOLVED' then 'OPEN' else data_quality_issues.status end,details=excluded.details,last_seen_at=marker;

 insert into public.data_quality_issues(workspace_id,rule_key,entity_type,entity_id,severity,title_key,details,last_seen_at)
 select ws,config.rule_key,'CONTACT',c.id,config.severity,'quality.rule.KEY_CONTACT_WITHOUT_DECISION_POWER',jsonb_build_object('reference',c.id),marker
 from public.organization_contact_intelligence i join public.contacts c on c.workspace_id=i.workspace_id and c.id=i.contact_id
 join public.data_quality_rule_configs config on config.workspace_id=ws and config.rule_key='KEY_CONTACT_WITHOUT_DECISION_POWER' and config.enabled
 where i.workspace_id=ws and i.key_contact_status='KEY' and public.channel_intelligence_access('intelligence',to_jsonb(i),false) and (i.decision_power_score is null)
 on conflict(workspace_id,rule_key,entity_type,entity_id) do update set severity=excluded.severity,status=case when data_quality_issues.status='RESOLVED' then 'OPEN' else data_quality_issues.status end,details=excluded.details,last_seen_at=marker;
insert into public.data_quality_issues(workspace_id,rule_key,entity_type,entity_id,severity,title_key,details,last_seen_at)
 select ws,c.rule_key,'LEAD',l.id,c.severity,'quality.rule.'||c.rule_key,jsonb_build_object('reference',l.id),marker
 from public.leads l join public.organizations o on o.id=l.organization_id
 join public.data_quality_rule_configs c on c.workspace_id=ws and c.rule_key='CLAIMED_LEAD_WITHOUT_NEXT_ACTION' and c.enabled
 where o.workspace_id=ws and public.customer_subject_access('ORGANIZATION',o.id,false) and l.subject_type='SCHOOL' and public.lead_record_access(to_jsonb(l),false) and (l.owner_id is not null and l.status in ('NEW','QUALIFYING','QUALIFIED') and trim(l.next_action)='')
 on conflict(workspace_id,rule_key,entity_type,entity_id) do update set severity=excluded.severity,status=case when data_quality_issues.status='RESOLVED' then 'OPEN' else data_quality_issues.status end,details=excluded.details,last_seen_at=marker;

insert into public.data_quality_issues(workspace_id,rule_key,entity_type,entity_id,severity,title_key,details,last_seen_at)
 select ws,c.rule_key,'LEAD',l.id,c.severity,'quality.rule.'||c.rule_key,jsonb_build_object('reference',l.id),marker
 from public.leads l join public.organizations o on o.id=l.organization_id
 join public.data_quality_rule_configs c on c.workspace_id=ws and c.rule_key='QUALIFYING_SCHOOL_LEAD_WITHOUT_KEY_CONTACT' and c.enabled
 where o.workspace_id=ws and public.customer_subject_access('ORGANIZATION',o.id,false) and l.subject_type='SCHOOL' and public.lead_record_access(to_jsonb(l),false) and (l.status='QUALIFYING' and not exists(select 1 from public.organization_contact_intelligence i where i.organization_id=l.organization_id and i.key_contact_status='KEY'))
 on conflict(workspace_id,rule_key,entity_type,entity_id) do update set severity=excluded.severity,status=case when data_quality_issues.status='RESOLVED' then 'OPEN' else data_quality_issues.status end,details=excluded.details,last_seen_at=marker;

insert into public.data_quality_issues(workspace_id,rule_key,entity_type,entity_id,severity,title_key,details,last_seen_at)
 select ws,c.rule_key,'LEAD',l.id,c.severity,'quality.rule.'||c.rule_key,jsonb_build_object('reference',l.id),marker
 from public.leads l join public.organizations o on o.id=l.organization_id
 join public.data_quality_rule_configs c on c.workspace_id=ws and c.rule_key='QUALIFIED_SCHOOL_LEAD_WITHOUT_ORGANIZATION_OWNER' and c.enabled
 where o.workspace_id=ws and public.customer_subject_access('ORGANIZATION',o.id,false) and l.subject_type='SCHOOL' and public.lead_record_access(to_jsonb(l),false) and (l.status='QUALIFIED' and o.owner_id is null)
 on conflict(workspace_id,rule_key,entity_type,entity_id) do update set severity=excluded.severity,status=case when data_quality_issues.status='RESOLVED' then 'OPEN' else data_quality_issues.status end,details=excluded.details,last_seen_at=marker;

insert into public.data_quality_issues(workspace_id,rule_key,entity_type,entity_id,severity,title_key,details,last_seen_at)
 select ws,c.rule_key,'ORGANIZATION',o.id,c.severity,'quality.rule.'||c.rule_key,jsonb_build_object('reference',o.id),marker
 from public.organizations o join public.organization_business_profiles b on b.id=o.id
 join public.data_quality_rule_configs c on c.workspace_id=ws and c.rule_key='RECRUITMENT_ACTIVATED_WITHOUT_KEY_CONTACT' and c.enabled
 where o.workspace_id=ws and public.customer_subject_access('ORGANIZATION',o.id,false)  and (b.partnership_stage='RECRUITMENT_ACTIVATED' and not exists(select 1 from public.organization_contact_intelligence i where i.organization_id=o.id and i.key_contact_status='KEY'))
 on conflict(workspace_id,rule_key,entity_type,entity_id) do update set severity=excluded.severity,status=case when data_quality_issues.status='RESOLVED' then 'OPEN' else data_quality_issues.status end,details=excluded.details,last_seen_at=marker;

insert into public.data_quality_issues(workspace_id,rule_key,entity_type,entity_id,severity,title_key,details,last_seen_at)
 select ws,c.rule_key,'ORGANIZATION',o.id,c.severity,'quality.rule.'||c.rule_key,jsonb_build_object('reference',o.id),marker
 from public.organizations o join public.organization_business_profiles b on b.id=o.id
 join public.data_quality_rule_configs c on c.workspace_id=ws and c.rule_key='SOLUTION_PROPOSED_WITHOUT_OPPORTUNITY' and c.enabled
 where o.workspace_id=ws and public.customer_subject_access('ORGANIZATION',o.id,false)  and (b.partnership_stage='SOLUTION_PROPOSED' and not exists(select 1 from public.opportunities p where p.organization_id=o.id and p.stage not in ('WON','LOST')))
 on conflict(workspace_id,rule_key,entity_type,entity_id) do update set severity=excluded.severity,status=case when data_quality_issues.status='RESOLVED' then 'OPEN' else data_quality_issues.status end,details=excluded.details,last_seen_at=marker;

insert into public.data_quality_issues(workspace_id,rule_key,entity_type,entity_id,severity,title_key,details,last_seen_at)
 select ws,c.rule_key,'ORGANIZATION',o.id,c.severity,'quality.rule.'||c.rule_key,jsonb_build_object('reference',o.id),marker
 from public.organizations o join public.data_quality_rule_configs c on c.workspace_id=ws and c.rule_key='ACTIVE_CHANNEL_WITHOUT_AGREEMENT' and c.enabled
 where o.workspace_id=ws and public.channel_commercial_access(o.id,false) and (exists(select 1 from public.organization_business_profiles b where b.id=o.id and b.partnership_stage in ('ACTIVE','RECRUITMENT_ACTIVATED','ONGOING_ENABLEMENT')) and not exists(select 1 from public.channel_agreements a join public.channel_agreement_versions v on v.agreement_id=a.id where a.organization_id=o.id and v.status='ACTIVE' and v.effective_from<=public.current_business_date()::date and (v.effective_to is null or v.effective_to>=public.current_business_date()::date)))
 on conflict(workspace_id,rule_key,entity_type,entity_id) do update set severity=excluded.severity,status=case when data_quality_issues.status='RESOLVED' then 'OPEN' else data_quality_issues.status end,details=excluded.details,last_seen_at=marker;

insert into public.data_quality_issues(workspace_id,rule_key,entity_type,entity_id,severity,title_key,details,last_seen_at)
 select ws,c.rule_key,'ORGANIZATION',o.id,c.severity,'quality.rule.'||c.rule_key,jsonb_build_object('reference',o.id),marker
 from public.organizations o join public.data_quality_rule_configs c on c.workspace_id=ws and c.rule_key='ACTIVE_AGREEMENT_WITHOUT_RULE' and c.enabled
 where o.workspace_id=ws and public.channel_commercial_access(o.id,false) and (exists(select 1 from public.channel_agreements a join public.channel_agreement_versions v on v.agreement_id=a.id where a.organization_id=o.id and v.status='ACTIVE' and not exists(select 1 from public.channel_commission_rules r where r.agreement_version_id=v.id)))
 on conflict(workspace_id,rule_key,entity_type,entity_id) do update set severity=excluded.severity,status=case when data_quality_issues.status='RESOLVED' then 'OPEN' else data_quality_issues.status end,details=excluded.details,last_seen_at=marker;

insert into public.data_quality_issues(workspace_id,rule_key,entity_type,entity_id,severity,title_key,details,last_seen_at)
 select ws,c.rule_key,'ORGANIZATION',o.id,c.severity,'quality.rule.'||c.rule_key,jsonb_build_object('reference',o.id),marker
 from public.organizations o join public.data_quality_rule_configs c on c.workspace_id=ws and c.rule_key='COMMISSION_SHARED_CONTRACT_UNALLOCATED' and c.enabled
 where o.workspace_id=ws and public.channel_commercial_access(o.id,false) and (exists(select 1 from jsonb_array_elements(public.commission_eligibility(o.id)->'items') item join public.channel_agreement_versions v on v.id=(item->>'agreementVersionId')::uuid where v.status in ('ACTIVE','SUPERSEDED') and item->>'eligibilityStatus'='SHARED_CONTRACT_UNALLOCATED'))
 on conflict(workspace_id,rule_key,entity_type,entity_id) do update set severity=excluded.severity,status=case when data_quality_issues.status='RESOLVED' then 'OPEN' else data_quality_issues.status end,details=excluded.details,last_seen_at=marker;

insert into public.data_quality_issues(workspace_id,rule_key,entity_type,entity_id,severity,title_key,details,last_seen_at)
 select ws,c.rule_key,'ORGANIZATION',o.id,c.severity,'quality.rule.'||c.rule_key,jsonb_build_object('reference',o.id),marker
 from public.organizations o join public.data_quality_rule_configs c on c.workspace_id=ws and c.rule_key='COMMISSION_MULTIPLE_ELIGIBLE_CHANNELS' and c.enabled
 where o.workspace_id=ws and public.channel_commercial_access(o.id,false) and (exists(select 1 from jsonb_array_elements(public.commission_eligibility(o.id)->'items') mine where mine->>'eligibilityStatus'='ELIGIBLE' and exists(select 1 from public.channel_agreements other join public.organizations channel on channel.id=other.organization_id and public.channel_commercial_access(channel.id,false) cross join lateral jsonb_array_elements(public.commission_eligibility(channel.id,(mine->>'enrollmentId')::uuid)->'items') eligible where other.workspace_id=ws and other.organization_id<>o.id and eligible->>'eligibilityStatus'='ELIGIBLE')))
 on conflict(workspace_id,rule_key,entity_type,entity_id) do update set severity=excluded.severity,status=case when data_quality_issues.status='RESOLVED' then 'OPEN' else data_quality_issues.status end,details=excluded.details,last_seen_at=marker;

insert into public.data_quality_issues(workspace_id,rule_key,entity_type,entity_id,severity,title_key,details,last_seen_at)
 select ws,c.rule_key,'ORGANIZATION',o.id,c.severity,'quality.rule.'||c.rule_key,jsonb_build_object('reference',o.id),marker
 from public.organizations o join public.data_quality_rule_configs c on c.workspace_id=ws and c.rule_key='APPROVED_SETTLEMENT_NOT_PAID' and c.enabled
 where o.workspace_id=ws and public.channel_commercial_access(o.id,false) and (exists(select 1 from public.commission_settlements s where s.organization_id=o.id and s.workspace_id=ws and s.status='APPROVED'))
 on conflict(workspace_id,rule_key,entity_type,entity_id) do update set severity=excluded.severity,status=case when data_quality_issues.status='RESOLVED' then 'OPEN' else data_quality_issues.status end,details=excluded.details,last_seen_at=marker;


 insert into public.data_quality_issues(workspace_id,rule_key,entity_type,entity_id,severity,title_key,details,last_seen_at)
 select ws,config.rule_key,'STUDENT_SUCCESS_CASE',c.id,config.severity,'quality.rule.ACTIVE_SUCCESS_CASE_WITHOUT_OWNER',jsonb_build_object('reference',c.id),marker
 from public.student_success_cases c join public.data_quality_rule_configs config on config.workspace_id=ws and config.rule_key='ACTIVE_SUCCESS_CASE_WITHOUT_OWNER' and config.enabled
 where c.workspace_id=ws and public.student_success_case_access(to_jsonb(c),false) and c.status='ACTIVE' and c.owner_id is null
 on conflict(workspace_id,rule_key,entity_type,entity_id) do update set severity=excluded.severity,status=case when data_quality_issues.status='RESOLVED' then 'OPEN' else data_quality_issues.status end,details=excluded.details,last_seen_at=marker;

 insert into public.data_quality_issues(workspace_id,rule_key,entity_type,entity_id,severity,title_key,details,last_seen_at)
 select ws,config.rule_key,'STUDENT_SUCCESS_CASE',c.id,config.severity,'quality.rule.ACTIVE_SUCCESS_CASE_WITHOUT_NEXT_REVIEW',jsonb_build_object('reference',c.id),marker
 from public.student_success_cases c join public.data_quality_rule_configs config on config.workspace_id=ws and config.rule_key='ACTIVE_SUCCESS_CASE_WITHOUT_NEXT_REVIEW' and config.enabled
 where c.workspace_id=ws and public.student_success_case_access(to_jsonb(c),false) and c.status='ACTIVE' and c.next_review_on is null
 on conflict(workspace_id,rule_key,entity_type,entity_id) do update set severity=excluded.severity,status=case when data_quality_issues.status='RESOLVED' then 'OPEN' else data_quality_issues.status end,details=excluded.details,last_seen_at=marker;

 insert into public.data_quality_issues(workspace_id,rule_key,entity_type,entity_id,severity,title_key,details,last_seen_at)
 select ws,config.rule_key,'STUDENT_SUCCESS_CASE',c.id,config.severity,'quality.rule.SUCCESS_CASE_HEALTH_NOT_ASSESSED',jsonb_build_object('reference',c.id),marker
 from public.student_success_cases c join public.data_quality_rule_configs config on config.workspace_id=ws and config.rule_key='SUCCESS_CASE_HEALTH_NOT_ASSESSED' and config.enabled
 where c.workspace_id=ws and public.student_success_case_access(to_jsonb(c),false) and c.status='ACTIVE' and c.health_status='UNKNOWN' and c.created_at < (public.current_business_date()::date-30)::timestamptz
 on conflict(workspace_id,rule_key,entity_type,entity_id) do update set severity=excluded.severity,status=case when data_quality_issues.status='RESOLVED' then 'OPEN' else data_quality_issues.status end,details=excluded.details,last_seen_at=marker;

 insert into public.data_quality_issues(workspace_id,rule_key,entity_type,entity_id,severity,title_key,details,last_seen_at)
 select ws,config.rule_key,'STUDENT_SUCCESS_GOAL',g.id,config.severity,'quality.rule.ACTIVE_GOAL_PAST_TARGET_DATE',jsonb_build_object('reference',g.id),marker
 from public.student_success_goals g join public.data_quality_rule_configs config on config.workspace_id=ws and config.rule_key='ACTIVE_GOAL_PAST_TARGET_DATE' and config.enabled
 where g.workspace_id=ws and public.student_success_parent_access(g.case_id,false) and g.status='ACTIVE' and g.target_on<public.current_business_date()::date
 on conflict(workspace_id,rule_key,entity_type,entity_id) do update set severity=excluded.severity,status=case when data_quality_issues.status='RESOLVED' then 'OPEN' else data_quality_issues.status end,details=excluded.details,last_seen_at=marker;

insert into public.data_quality_issues(workspace_id,rule_key,entity_type,entity_id,severity,title_key,details,last_seen_at)
 select ws,config.rule_key,'STUDENT_SUCCESS_CASE',c.id,config.severity,'quality.rule.ACTIVE_CASE_WITHOUT_RECENT_CHECKIN',jsonb_build_object('reference',c.id),marker
 from public.student_success_cases c join public.data_quality_rule_configs config on config.workspace_id=ws and config.rule_key='ACTIVE_CASE_WITHOUT_RECENT_CHECKIN' and config.enabled
 where c.workspace_id=ws and public.student_success_case_access(to_jsonb(c),false) and c.status='ACTIVE' and coalesce((select max(k.occurred_at) from public.student_success_checkins k where k.case_id=c.id and k.workspace_id=c.workspace_id),c.created_at)::date < public.current_business_date()::date-30
 on conflict(workspace_id,rule_key,entity_type,entity_id) do update set severity=excluded.severity,status=case when data_quality_issues.status='RESOLVED' then 'OPEN' else data_quality_issues.status end,details=excluded.details,last_seen_at=marker;

insert into public.data_quality_issues(workspace_id,rule_key,entity_type,entity_id,severity,title_key,details,last_seen_at)
 select ws,config.rule_key,'STUDENT_SUCCESS_CASE',c.id,config.severity,'quality.rule.AT_RISK_CASE_WITHOUT_OPEN_RISK',jsonb_build_object('reference',c.id),marker
 from public.student_success_cases c join public.data_quality_rule_configs config on config.workspace_id=ws and config.rule_key='AT_RISK_CASE_WITHOUT_OPEN_RISK' and config.enabled
 where c.workspace_id=ws and public.student_success_case_access(to_jsonb(c),false) and c.status in ('PLANNING','ACTIVE','PAUSED') and c.health_status='AT_RISK' and not exists(select 1 from public.student_success_risk_signals r where r.case_id=c.id and r.workspace_id=c.workspace_id and r.status in ('OPEN','MONITORING'))
 on conflict(workspace_id,rule_key,entity_type,entity_id) do update set severity=excluded.severity,status=case when data_quality_issues.status='RESOLVED' then 'OPEN' else data_quality_issues.status end,details=excluded.details,last_seen_at=marker;

insert into public.data_quality_issues(workspace_id,rule_key,entity_type,entity_id,severity,title_key,details,last_seen_at)
 select ws,config.rule_key,'STUDENT_SUCCESS_RISK',r.id,config.severity,'quality.rule.HIGH_RISK_WITHOUT_ACTIVE_INTERVENTION',jsonb_build_object('reference',r.id,'caseId',r.case_id),marker
 from public.student_success_risk_signals r join public.data_quality_rule_configs config on config.workspace_id=ws and config.rule_key='HIGH_RISK_WITHOUT_ACTIVE_INTERVENTION' and config.enabled
 where r.workspace_id=ws and public.student_success_parent_access(r.case_id,false) and r.severity='HIGH' and r.status in ('OPEN','MONITORING') and not exists(select 1 from public.student_success_interventions i where i.risk_signal_id=r.id and i.workspace_id=r.workspace_id and i.status='ACTIVE')
 on conflict(workspace_id,rule_key,entity_type,entity_id) do update set severity=excluded.severity,status=case when data_quality_issues.status='RESOLVED' then 'OPEN' else data_quality_issues.status end,details=excluded.details,last_seen_at=marker;

insert into public.data_quality_issues(workspace_id,rule_key,entity_type,entity_id,severity,title_key,details,last_seen_at)
 select ws,config.rule_key,'STUDENT_SUCCESS_INTERVENTION',i.id,config.severity,'quality.rule.ACTIVE_INTERVENTION_PAST_TARGET_DATE',jsonb_build_object('reference',i.id,'caseId',i.case_id),marker
 from public.student_success_interventions i join public.data_quality_rule_configs config on config.workspace_id=ws and config.rule_key='ACTIVE_INTERVENTION_PAST_TARGET_DATE' and config.enabled
 where i.workspace_id=ws and public.student_success_parent_access(i.case_id,false) and i.status='ACTIVE' and i.target_end_on<public.current_business_date()::date
 on conflict(workspace_id,rule_key,entity_type,entity_id) do update set severity=excluded.severity,status=case when data_quality_issues.status='RESOLVED' then 'OPEN' else data_quality_issues.status end,details=excluded.details,last_seen_at=marker;

insert into public.data_quality_issues(workspace_id,rule_key,entity_type,entity_id,severity,title_key,details,last_seen_at)
 select ws,config.rule_key,'STUDENT_SUCCESS_RISK',r.id,config.severity,'quality.rule.OPEN_RISK_WITHOUT_OWNER',jsonb_build_object('reference',r.id,'caseId',r.case_id),marker
 from public.student_success_risk_signals r join public.data_quality_rule_configs config on config.workspace_id=ws and config.rule_key='OPEN_RISK_WITHOUT_OWNER' and config.enabled
 where r.workspace_id=ws and public.student_success_parent_access(r.case_id,false) and r.status in ('OPEN','MONITORING') and r.owner_id is null
 on conflict(workspace_id,rule_key,entity_type,entity_id) do update set severity=excluded.severity,status=case when data_quality_issues.status='RESOLVED' then 'OPEN' else data_quality_issues.status end,details=excluded.details,last_seen_at=marker;

update public.data_quality_issues issue set status='RESOLVED',resolution_note='AUTO_RESOLVED',resolved_at=now(),resolved_by=app_auth.current_user_id()
  where issue.workspace_id=ws and issue.status in ('OPEN','ASSIGNED') and issue.last_seen_at<marker
    and issue.rule_key in (select rule_key from public.data_quality_rule_configs where workspace_id=ws);
  select count(*) into affected from public.data_quality_issues where workspace_id=ws and status in ('OPEN','ASSIGNED');
  return affected;
end;
$$;

create function public.seed_success_operations_quality() returns trigger language plpgsql security definer set search_path=public as $$begin
 insert into public.data_quality_rule_configs(workspace_id,rule_key,severity,enabled) select new.id,k,'MEDIUM',true from unnest(array['ACTIVE_CASE_WITHOUT_RECENT_CHECKIN','AT_RISK_CASE_WITHOUT_OPEN_RISK','HIGH_RISK_WITHOUT_ACTIVE_INTERVENTION','ACTIVE_INTERVENTION_PAST_TARGET_DATE','OPEN_RISK_WITHOUT_OWNER']) k on conflict do nothing;return new;end $$;
revoke all on function public.seed_success_operations_quality() from public;
create trigger seed_success_operations_quality after insert on public.workspaces for each row execute function public.seed_success_operations_quality();
create policy success_operations_quality_scope on public.data_quality_issues as restrictive for select to crm_app using(
 (entity_type<>'STUDENT_SUCCESS_RISK' or exists(select 1 from public.student_success_risk_signals r where r.id=entity_id and r.workspace_id=data_quality_issues.workspace_id))
 and (entity_type<>'STUDENT_SUCCESS_INTERVENTION' or exists(select 1 from public.student_success_interventions i where i.id=entity_id and i.workspace_id=data_quality_issues.workspace_id))
);
