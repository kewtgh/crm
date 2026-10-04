-- Explicit versioned definitions; operational state derives from canonical domains.
set search_path=public,app_auth,extensions;
alter table public.crm_tasks add constraint workflow_task_identity unique(workspace_id,id);
create table public.workflow_templates(
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null default public.current_workspace_id() references public.workspaces(id),
 logical_id uuid not null,version integer not null default 1 check(version>0),revision integer not null default 1 check(revision>0),
 name_zh text not null default '' check(length(name_zh)<=160),name_en text not null default '' check(length(name_en)<=160),check(length(trim(name_zh))+length(trim(name_en))>0),
 workflow_type text not null default 'ADMISSIONS' check(workflow_type='ADMISSIONS'),product_id uuid,
 status text not null default 'DRAFT' check(status in ('DRAFT','ACTIVE','RETIRED')),description text not null default '' check(length(description)<=2000),
 created_by uuid references app_auth.accounts(id),updated_by uuid references app_auth.accounts(id),created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),
 unique(workspace_id,id),unique(workspace_id,id,version),unique(workspace_id,logical_id,version),foreign key(workspace_id,product_id) references public.products(workspace_id,id)
);
create index workflow_templates_list_idx on public.workflow_templates(workspace_id,status,product_id,updated_at desc);
create function public.workflow_step_config_valid(kind text,task jsonb,milestone jsonb,checkpoint jsonb) returns boolean
language plpgsql immutable set search_path=public as $$
declare k text;allowed text[];cfg jsonb;
begin
 if kind='TASK' then
  if milestone is not null or checkpoint is not null then return false;end if;cfg:=task;allowed:=array['title_zh','title_en','description','priority'];
 elsif kind='MILESTONE' then
  if task is not null or checkpoint is not null then return false;end if;cfg:=milestone;allowed:=array['milestone_type','default_status','application_scope'];
 elsif kind='CHECKPOINT' then
  if task is not null or milestone is not null then return false;end if;cfg:=checkpoint;allowed:=array['checkpoint_type','milestone_type','application_scope'];
 else return false;end if;
 if jsonb_typeof(cfg) is distinct from 'object' then return false;end if;
 for k in select jsonb_object_keys(cfg) loop
  if not k=any(allowed) or jsonb_typeof(cfg->k)<>'string' or length(cfg->>k)>(case when k='description' then 1000 else 160 end) then return false;end if;
 end loop;
 if kind='TASK' then return coalesce(length(trim(coalesce(cfg->>'title_zh','')))+length(trim(coalesce(cfg->>'title_en','')))>0 and cfg->>'priority' in ('LOW','NORMAL','HIGH','URGENT'),false);end if;
 if kind='MILESTONE' then return coalesce(cfg->>'default_status'='PENDING' and cfg->>'application_scope' in ('ENROLLMENT','APPLICATION') and public.admission_milestone_metadata_valid(cfg->>'milestone_type','{}')
  and cfg->>'milestone_type' in ('INTERVIEW','SUPPLEMENTARY_MATERIALS','PLACEMENT_TEST','I20_REQUESTED','I20_ISSUED','SEVIS_REQUIRED','SEVIS_COMPLETED','VISA_APPLICATION','VISA_APPOINTMENT','VISA_TRAINING','VISA_RESULT','FLIGHT_CONFIRMED','ORIENTATION','ARRIVAL','OTHER'),false);end if;
 return coalesce((cfg->>'checkpoint_type' in ('APPLICATION_SUBMITTED','APPLICATION_DECIDED') and cfg->>'application_scope'='APPLICATION' and not cfg ? 'milestone_type')
  or (cfg->>'checkpoint_type'='MILESTONE_COMPLETED' and cfg->>'application_scope' in ('ENROLLMENT','APPLICATION') and cfg->>'milestone_type' in ('INTERVIEW','SUPPLEMENTARY_MATERIALS','PLACEMENT_TEST','I20_REQUESTED','I20_ISSUED','SEVIS_REQUIRED','SEVIS_COMPLETED','VISA_APPLICATION','VISA_APPOINTMENT','VISA_TRAINING','VISA_RESULT','FLIGHT_CONFIRMED','ORIENTATION','ARRIVAL','OTHER')),false);
exception when others then return false;end $$;
revoke all on function public.workflow_step_config_valid(text,jsonb,jsonb,jsonb) from public;
grant execute on function public.workflow_step_config_valid(text,jsonb,jsonb,jsonb) to crm_app;
create table public.workflow_template_steps(
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id),template_id uuid not null,
 sequence integer not null check(sequence between 1 and 1000000),name_zh text not null default '' check(length(name_zh)<=160),name_en text not null default '' check(length(name_en)<=160),check(length(trim(name_zh))+length(trim(name_en))>0),
 step_kind text not null check(step_kind in ('TASK','MILESTONE','CHECKPOINT')),required boolean not null default true,
 default_owner_role text check(default_owner_role in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER','SALES_SPECIALIST','SALES_SUPPORT')),
 offset_basis text check(offset_basis in ('WORKFLOW_START','COHORT_APPLICATION_DEADLINE','COHORT_START','APPLICATION_DEADLINE')),offset_days integer check(offset_days between -3650 and 3650),check((offset_basis is null)=(offset_days is null)),
 task_config jsonb,milestone_config jsonb,checkpoint_config jsonb,check(public.workflow_step_config_valid(step_kind,task_config,milestone_config,checkpoint_config)),
 created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),
 unique(workspace_id,id),unique(workspace_id,template_id,id),unique(workspace_id,template_id,sequence),foreign key(workspace_id,template_id) references public.workflow_templates(workspace_id,id) on delete cascade
);
create table public.workflow_instances(
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id),template_id uuid not null,template_version integer not null,
 enrollment_id uuid not null,application_id uuid,owner_id uuid not null,
 status text not null default 'ACTIVE' check(status in ('NOT_STARTED','ACTIVE','BLOCKED','COMPLETED','CANCELLED')),
 started_at timestamptz not null default clock_timestamp(),completed_at timestamptz,cancelled_at timestamptz,cancel_reason text,revision integer not null default 1 check(revision>0),
 created_by uuid references app_auth.accounts(id),created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),
 unique(workspace_id,id),unique(workspace_id,id,template_id),foreign key(workspace_id,template_id,template_version) references public.workflow_templates(workspace_id,id,version),
 foreign key(workspace_id,enrollment_id) references public.student_enrollments(workspace_id,id) on delete cascade,
 foreign key(workspace_id,enrollment_id,application_id) references public.student_applications(workspace_id,enrollment_id,id) on delete cascade,
 foreign key(workspace_id,owner_id) references public.workspace_memberships(workspace_id,user_id),check((status='CANCELLED')=(cancelled_at is not null)),check(status<>'COMPLETED' or completed_at is not null)
);
create index workflow_instances_context_idx on public.workflow_instances(workspace_id,enrollment_id,application_id,created_at desc);
create table public.workflow_step_instances(
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id),workflow_instance_id uuid not null,template_id uuid not null,template_step_id uuid not null,
 task_id uuid,milestone_id uuid,override_status text check(override_status in ('WAIVED','CANCELLED')),override_reason text check(override_reason is null or length(trim(override_reason)) between 3 and 500),
 -- Dispatch cursor only: current status/due/owner are projected from domain facts.
 last_projected_status text not null default 'PENDING',revision integer not null default 1,initial_due_at timestamptz,context_warning text,
 started_at timestamptz,completed_at timestamptz,created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),
 unique(workspace_id,id),unique(workspace_id,workflow_instance_id,template_step_id),
 foreign key(workspace_id,workflow_instance_id,template_id) references public.workflow_instances(workspace_id,id,template_id) on delete cascade,
 foreign key(workspace_id,template_id,template_step_id) references public.workflow_template_steps(workspace_id,template_id,id),
 foreign key(workspace_id,task_id) references public.crm_tasks(workspace_id,id) on delete set null(task_id),
 foreign key(workspace_id,milestone_id) references public.admission_milestones(workspace_id,id) on delete set null(milestone_id),
 check(task_id is null or milestone_id is null),check(override_status is null or override_reason is not null)
);
create index workflow_steps_task_idx on public.workflow_step_instances(task_id) where task_id is not null;
create index workflow_steps_milestone_idx on public.workflow_step_instances(milestone_id) where milestone_id is not null;
create function public.workflow_template_access(record jsonb,edit boolean default false) returns boolean language sql stable security definer set search_path=public,app_auth as $$
 select app_auth.current_user_id() is not null and record->>'workspace_id'=public.current_workspace_id()::text and public.is_workspace_member(public.current_workspace_id())
 and public.current_crm_role() in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER','SALES_SPECIALIST','SALES_SUPPORT')
 and (not edit or public.current_crm_role() in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR')) $$;
create function public.workflow_instance_access(record jsonb,edit boolean default false) returns boolean language sql stable security definer set search_path=public,app_auth as $$
 select app_auth.current_user_id() is not null and record->>'workspace_id'=public.current_workspace_id()::text and public.is_workspace_member(public.current_workspace_id())
 and public.current_crm_role() in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER','SALES_SPECIALIST','SALES_SUPPORT')
 and public.can_access_owned_record(public.current_workspace_id(),'WORKFLOW',(record->>'id')::uuid,(record->>'owner_id')::uuid,edit)
 and exists(select 1 from public.student_enrollments e where e.workspace_id=public.current_workspace_id() and e.id=(record->>'enrollment_id')::uuid and public.student_enrollment_access(to_jsonb(e),edit))
 and (record->>'application_id' is null or exists(select 1 from public.student_applications a where a.workspace_id=public.current_workspace_id() and a.id=(record->>'application_id')::uuid and a.enrollment_id=(record->>'enrollment_id')::uuid and public.student_application_access(to_jsonb(a),false)))
 and not exists(select 1 from public.workflow_step_instances s join public.crm_tasks t on t.id=s.task_id and t.workspace_id=s.workspace_id where s.workflow_instance_id=(record->>'id')::uuid and not public.can_access_owned_record(t.workspace_id,'TASK',t.id,t.owner_id,false))
 and not exists(select 1 from public.workflow_step_instances s join public.admission_milestones m on m.id=s.milestone_id and m.workspace_id=s.workspace_id where s.workflow_instance_id=(record->>'id')::uuid and not public.admission_milestone_access(to_jsonb(m),false)) and not exists(select 1 from public.workflow_template_steps d join public.admission_milestones m on m.workspace_id=d.workspace_id
  where d.template_id=(record->>'template_id')::uuid and d.step_kind='CHECKPOINT' and d.checkpoint_config->>'checkpoint_type'='MILESTONE_COMPLETED'
   and m.enrollment_id=(record->>'enrollment_id')::uuid and m.milestone_type=d.checkpoint_config->>'milestone_type'
   and (d.checkpoint_config->>'application_scope'='ENROLLMENT' or m.application_id=(record->>'application_id')::uuid)
   and not public.admission_milestone_access(to_jsonb(m),false)) $$;
revoke all on function public.workflow_template_access(jsonb,boolean),public.workflow_instance_access(jsonb,boolean) from public;
grant execute on function public.workflow_template_access(jsonb,boolean),public.workflow_instance_access(jsonb,boolean) to crm_app;
alter table public.workflow_templates enable row level security;alter table public.workflow_template_steps enable row level security;alter table public.workflow_instances enable row level security;alter table public.workflow_step_instances enable row level security;
grant select on public.workflow_templates,public.workflow_template_steps,public.workflow_instances,public.workflow_step_instances to crm_app,crm_worker;
create policy workflow_template_read on public.workflow_templates for select to crm_app using(public.workflow_template_access(to_jsonb(workflow_templates),false));
create policy workflow_template_step_read on public.workflow_template_steps for select to crm_app using(exists(select 1 from public.workflow_templates t where t.workspace_id=workflow_template_steps.workspace_id and t.id=template_id));
create policy workflow_instance_read on public.workflow_instances for select to crm_app using(public.workflow_instance_access(to_jsonb(workflow_instances),false));
create policy workflow_step_read on public.workflow_step_instances for select to crm_app using(exists(select 1 from public.workflow_instances i where i.workspace_id=workflow_step_instances.workspace_id and i.id=workflow_instance_id));
create policy workflow_privacy_templates on public.workflow_templates for select to crm_worker using(true);
create policy workflow_privacy_template_steps on public.workflow_template_steps for select to crm_worker using(true);
create policy workflow_privacy_instances on public.workflow_instances for select to crm_worker using(true);
create policy workflow_privacy_steps on public.workflow_step_instances for select to crm_worker using(true);
create function public.guard_workflow_template() returns trigger language plpgsql security definer set search_path=public as $$
declare template uuid;begin
 template:=case when tg_table_name='workflow_templates' then (to_jsonb(old)->>'id')::uuid else coalesce(to_jsonb(new)->>'template_id',to_jsonb(old)->>'template_id')::uuid end;
 if tg_table_name='workflow_templates' and tg_op='UPDATE' then
  if new.id<>old.id or new.workspace_id<>old.workspace_id or new.logical_id<>old.logical_id or new.version<>old.version then raise exception 'workflow_template_immutable';end if;
  if exists(select 1 from public.workflow_instances where template_id=template) and (new.name_zh,new.name_en,new.description,new.product_id,new.workflow_type) is distinct from (old.name_zh,old.name_en,old.description,old.product_id,old.workflow_type) then raise exception 'workflow_template_used';end if;
 else
  if exists(select 1 from public.workflow_instances where template_id=template) then raise exception 'workflow_template_used';end if;
  if exists(select 1 from public.workflow_templates where id=template and status<>'DRAFT') then raise exception 'workflow_template_immutable';end if;
 end if;return coalesce(new,old);end $$;
create trigger workflow_template_identity before update or delete on public.workflow_templates for each row execute function public.guard_workflow_template();
create trigger workflow_template_steps_frozen before insert or update or delete on public.workflow_template_steps for each row execute function public.guard_workflow_template();
create function public.guard_workflow_instance() returns trigger language plpgsql as $$ begin
 if (new.id,new.workspace_id,new.enrollment_id,new.application_id,new.template_id,new.template_version) is distinct from (old.id,old.workspace_id,old.enrollment_id,old.application_id,old.template_id,old.template_version) then raise exception 'workflow_parent_immutable';end if;return new;end $$;
create trigger workflow_instance_identity before update on public.workflow_instances for each row execute function public.guard_workflow_instance();
revoke all on function public.guard_workflow_template(),public.guard_workflow_instance() from public;

create function public.workflow_receipt(ws uuid,actor uuid,key text,op text,payload jsonb) returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare r public.mutation_receipts;fingerprint text;begin
 if key is null or length(key) not between 8 and 160 then raise exception 'workflow_input_invalid';end if;
 perform pg_advisory_xact_lock(hashtextextended(ws::text||':'||key,0));
 fingerprint:=encode(extensions.digest(jsonb_build_object('actor',actor,'operation',op,'payload',payload)::text,'sha256'),'hex');
 select * into r from public.mutation_receipts where workspace_id=ws and request_key=key;
 if found then if r.operation<>op or r.created_by is distinct from actor or r.result->>'fingerprint' is distinct from fingerprint then raise exception 'workflow_request_conflict';end if;return r.result;end if;
 return jsonb_build_object('fingerprint',fingerprint);
end $$;
revoke all on function public.workflow_receipt(uuid,uuid,text,text,jsonb) from public;
create function public.save_workflow_template(record_id uuid,expected_revision integer,data jsonb,p_request_key text) returns public.workflow_templates
language plpgsql security definer set search_path=public,app_auth,extensions as $$
declare ws uuid:=public.current_workspace_id();actor uuid:=app_auth.current_user_id();old public.workflow_templates;result public.workflow_templates;s public.workflow_template_steps;item jsonb;receipt jsonb;
begin
 if not public.workflow_template_access(jsonb_build_object('workspace_id',ws),true) then raise exception 'workflow_template_forbidden';end if;
 if record_id is null or expected_revision<=0 or jsonb_typeof(data) is distinct from 'object' or not data ?& array['name_zh','name_en','product_id','workflow_type','description','steps']
  or exists(select 1 from jsonb_object_keys(data) k where k not in ('name_zh','name_en','product_id','workflow_type','description','steps'))
  or jsonb_typeof(data->'steps') is distinct from 'array' or jsonb_array_length(data->'steps') not between 1 and 40 then raise exception 'workflow_input_invalid';end if;
 receipt:=public.workflow_receipt(ws,actor,p_request_key,'WORKFLOW_TEMPLATE_SAVE',jsonb_build_object('id',record_id,'revision',expected_revision,'data',data));
 if receipt ? 'item' then return jsonb_populate_record(null::public.workflow_templates,receipt->'item');end if;
 perform pg_advisory_xact_lock(hashtextextended('workflow-template:'||record_id::text,0));
 select * into old from public.workflow_templates where id=record_id and workspace_id=ws for update;
 if found then
  if expected_revision is null or old.revision<>expected_revision then raise exception 'workflow_version_conflict';end if;
  if old.status<>'DRAFT' or exists(select 1 from public.workflow_instances where template_id=record_id) then raise exception 'workflow_template_used';end if;
 elsif expected_revision is not null then raise exception 'workflow_not_found';end if;
 if data->>'product_id' is not null and not exists(select 1 from public.products where workspace_id=ws and id=(data->>'product_id')::uuid) then raise exception 'workflow_product_mismatch';end if;
 if old.id is null then
  insert into public.workflow_templates(id,workspace_id,logical_id,name_zh,name_en,workflow_type,product_id,description,created_by,updated_by)
   values(record_id,ws,record_id,data->>'name_zh',data->>'name_en',data->>'workflow_type',(data->>'product_id')::uuid,data->>'description',actor,actor) returning * into result;
 else
  update public.workflow_templates set name_zh=data->>'name_zh',name_en=data->>'name_en',description=data->>'description',product_id=(data->>'product_id')::uuid,workflow_type=data->>'workflow_type',revision=revision+1,updated_by=actor,updated_at=clock_timestamp() where id=record_id returning * into result;
  delete from public.workflow_template_steps where template_id=record_id and workspace_id=ws;
 end if;
 for item in select value from jsonb_array_elements(data->'steps') loop
  if jsonb_typeof(item) is distinct from 'object' or not item ?& array['id','sequence','name_zh','name_en','step_kind','required','default_owner_role','offset_basis','offset_days','task_config','milestone_config','checkpoint_config']
   or exists(select 1 from jsonb_object_keys(item) k where k not in ('id','sequence','name_zh','name_en','step_kind','required','default_owner_role','offset_basis','offset_days','task_config','milestone_config','checkpoint_config')) then raise exception 'workflow_input_invalid';end if;
  s:=jsonb_populate_record(null::public.workflow_template_steps,item);
  insert into public.workflow_template_steps(id,workspace_id,template_id,sequence,name_zh,name_en,step_kind,required,default_owner_role,offset_basis,offset_days,task_config,milestone_config,checkpoint_config)
   values(s.id,ws,record_id,s.sequence,s.name_zh,s.name_en,s.step_kind,s.required,s.default_owner_role,s.offset_basis,s.offset_days,s.task_config,s.milestone_config,s.checkpoint_config);
 end loop;
 insert into public.audit_events(workspace_id,actor_id,action,entity_type,entity_id,after_data) values(ws,actor,case when old.id is null then 'WORKFLOW_TEMPLATE_CREATED' else 'WORKFLOW_TEMPLATE_UPDATED' end,'WORKFLOW_TEMPLATE',record_id,jsonb_build_object('version',result.version,'revision',result.revision,'stepCount',jsonb_array_length(data->'steps')));
 insert into public.mutation_receipts(workspace_id,request_key,operation,result,created_by) values(ws,p_request_key,'WORKFLOW_TEMPLATE_SAVE',receipt||jsonb_build_object('item',to_jsonb(result)),actor);return result;
end $$;
create function public.change_workflow_template(record_id uuid,expected_revision integer,operation text,new_id uuid,p_request_key text) returns public.workflow_templates
language plpgsql security definer set search_path=public,app_auth,extensions as $$
declare ws uuid:=public.current_workspace_id();actor uuid:=app_auth.current_user_id();old public.workflow_templates;result public.workflow_templates;receipt jsonb;next_version integer;
begin
 if not public.workflow_template_access(jsonb_build_object('workspace_id',ws),true) then raise exception 'workflow_template_forbidden';end if;
 if expected_revision is null or expected_revision<1 or operation is null or operation not in ('ACTIVATE','RETIRE','NEW_VERSION') or operation='NEW_VERSION' and new_id is null then raise exception 'workflow_input_invalid';end if;
 receipt:=public.workflow_receipt(ws,actor,p_request_key,'WORKFLOW_TEMPLATE_CHANGE',jsonb_build_object('id',record_id,'revision',expected_revision,'operation',operation,'newId',new_id));
 if receipt ? 'item' then return jsonb_populate_record(null::public.workflow_templates,receipt->'item');end if;
 select * into old from public.workflow_templates where workspace_id=ws and id=record_id for update;if not found then raise exception 'workflow_not_found';end if;
 if old.revision<>expected_revision then raise exception 'workflow_version_conflict';end if;
 if operation='NEW_VERSION' then
  perform pg_advisory_xact_lock(hashtextextended('workflow-logical:'||old.logical_id::text,0));select coalesce(max(version),0)+1 into next_version from public.workflow_templates where workspace_id=ws and logical_id=old.logical_id;
  insert into public.workflow_templates(id,workspace_id,logical_id,version,name_zh,name_en,product_id,description,created_by,updated_by)
   values(new_id,ws,old.logical_id,next_version,old.name_zh,old.name_en,old.product_id,old.description,actor,actor) returning * into result;
  insert into public.workflow_template_steps(workspace_id,template_id,sequence,name_zh,name_en,step_kind,required,default_owner_role,offset_basis,offset_days,task_config,milestone_config,checkpoint_config)
   select workspace_id,new_id,sequence,name_zh,name_en,step_kind,required,default_owner_role,offset_basis,offset_days,task_config,milestone_config,checkpoint_config from public.workflow_template_steps where template_id=old.id and workspace_id=ws;
 else
  if operation='ACTIVATE' and old.status<>'DRAFT' or operation='RETIRE' and old.status<>'ACTIVE' then raise exception 'workflow_template_state_invalid';end if;
  if not exists(select 1 from public.workflow_template_steps where workspace_id=ws and template_id=record_id) then raise exception 'workflow_input_invalid';end if;
  update public.workflow_templates set status=case operation when 'ACTIVATE' then 'ACTIVE' else 'RETIRED' end,revision=revision+1,updated_by=actor,updated_at=clock_timestamp() where id=record_id returning * into result;
 end if;
 insert into public.audit_events(workspace_id,actor_id,action,entity_type,entity_id,after_data) values(ws,actor,case operation when 'NEW_VERSION' then 'WORKFLOW_TEMPLATE_VERSION_CREATED' when 'ACTIVATE' then 'WORKFLOW_TEMPLATE_ACTIVATED' else 'WORKFLOW_TEMPLATE_RETIRED' end,'WORKFLOW_TEMPLATE',result.id,jsonb_build_object('logicalId',result.logical_id,'version',result.version,'revision',result.revision));
 insert into public.mutation_receipts(workspace_id,request_key,operation,result,created_by) values(ws,p_request_key,'WORKFLOW_TEMPLATE_CHANGE',receipt||jsonb_build_object('item',to_jsonb(result)),actor);return result;
end $$;
revoke all on function public.save_workflow_template(uuid,integer,jsonb,text),public.change_workflow_template(uuid,integer,text,uuid,text) from public;
grant execute on function public.save_workflow_template(uuid,integer,jsonb,text),public.change_workflow_template(uuid,integer,text,uuid,text) to crm_app;

-- Private canonical evaluation. Public views/RPCs check all parent/source access.
create function public.workflow_states(instance_id uuid) returns table(step_id uuid,sequence integer,step_kind text,status text,due_at timestamptz,owner_id uuid,context_warning text)
language plpgsql stable security definer set search_path=public,app_auth as $$
declare i public.workflow_instances;r record;task public.crm_tasks;m public.admission_milestones;a public.student_applications;ready boolean:=true;satisfied boolean;raw text;
begin
 select * into i from public.workflow_instances where id=instance_id;
 for r in select s.*,d.sequence,d.step_kind,d.required,d.checkpoint_config from public.workflow_step_instances s join public.workflow_template_steps d on d.id=s.template_step_id and d.workspace_id=s.workspace_id where s.workflow_instance_id=instance_id order by d.sequence,d.id loop
  step_id:=r.id;sequence:=r.sequence;step_kind:=r.step_kind;owner_id:=i.owner_id;due_at:=r.initial_due_at;context_warning:=r.context_warning;raw:='READY';
  if r.task_id is not null then select * into task from public.crm_tasks where id=r.task_id and workspace_id=i.workspace_id;
   due_at:=task.due_at;owner_id:=task.owner_id;raw:=case when task.archived_at is not null then 'BLOCKED' when task.status='DONE' then 'COMPLETED' when task.status='IN_PROGRESS' then 'IN_PROGRESS' when task.status='WAITING_APPROVAL' then 'BLOCKED' else 'READY' end;
  elsif r.milestone_id is not null then select * into m from public.admission_milestones where id=r.milestone_id and workspace_id=i.workspace_id;
   due_at:=m.due_at;owner_id:=m.owner_id;raw:=case m.status when 'COMPLETED' then 'COMPLETED' when 'WAIVED' then 'WAIVED' when 'CANCELLED' then 'CANCELLED' when 'BLOCKED' then 'BLOCKED' when 'IN_PROGRESS' then 'IN_PROGRESS' else 'READY' end;
  elsif r.step_kind='CHECKPOINT' then
   if r.checkpoint_config->>'checkpoint_type'='MILESTONE_COMPLETED' then
    satisfied:=exists(select 1 from public.admission_milestones x where x.workspace_id=i.workspace_id and x.enrollment_id=i.enrollment_id and (r.checkpoint_config->>'application_scope'='ENROLLMENT' or x.application_id=i.application_id) and x.milestone_type=r.checkpoint_config->>'milestone_type' and x.status='COMPLETED');
   else select * into a from public.student_applications where id=i.application_id and workspace_id=i.workspace_id;
    satisfied:=case r.checkpoint_config->>'checkpoint_type' when 'APPLICATION_SUBMITTED' then a.status in ('SUBMITTED','UNDER_REVIEW','DECIDED','CLOSED') and a.submitted_at is not null when 'APPLICATION_DECIDED' then a.status='DECIDED' and a.decision is not null and a.decision_at is not null else false end;
   end if;raw:=case when satisfied then 'COMPLETED' else 'READY' end;
  else raw:='BLOCKED';context_warning:='MISSING_LINK';end if;
  if context_warning='MISSING_DATE_BASIS' and due_at is not null then context_warning:=null;end if;
  if r.override_status is not null then raw:=r.override_status;end if;
  if raw='CANCELLED' and r.required and i.cancelled_at is null then raw:='BLOCKED';context_warning:='REQUIRED_STEP_CANCELLED';end if;
  status:=case when i.cancelled_at is not null then 'CANCELLED' when raw in ('COMPLETED','WAIVED','CANCELLED') then raw when ready then raw else 'PENDING' end;
  if status not in ('COMPLETED','WAIVED') then ready:=false;end if;
  return next;
 end loop;
end $$;
revoke all on function public.workflow_states(uuid) from public;
create function public.workflow_projection(instance_id uuid) returns jsonb language plpgsql stable security definer set search_path=public,app_auth as $$
declare i public.workflow_instances;steps jsonb;done integer;total integer;state text;
begin
 select * into i from public.workflow_instances where id=instance_id and workspace_id=public.current_workspace_id();
 if not found or not public.workflow_instance_access(to_jsonb(i),false) then raise exception 'workflow_forbidden';end if;
 select coalesce(jsonb_agg(to_jsonb(s) order by s.sequence,s.step_id),'[]'),count(*) filter(where status in ('COMPLETED','WAIVED')),count(*) into steps,done,total from public.workflow_states(instance_id) s;
 state:=case when i.cancelled_at is not null then 'CANCELLED' when done=total then 'COMPLETED' when exists(select 1 from public.workflow_states(instance_id) where status in ('BLOCKED','CANCELLED')) then 'BLOCKED' else 'ACTIVE' end;
 return jsonb_build_object('status',state,'completedOrWaivedSteps',done,'totalSteps',total,'steps',steps);
end $$;
revoke all on function public.workflow_projection(uuid) from public;grant execute on function public.workflow_projection(uuid) to crm_app;
create function public.refresh_workflow(instance_id uuid) returns void language plpgsql security definer set search_path=public,app_auth as $$
declare i public.workflow_instances;s record;previous text;next_state text;cursor integer;payload jsonb;
begin
 select * into i from public.workflow_instances where id=instance_id for update;if not found then return;end if;
 for s in select * from public.workflow_states(instance_id) order by sequence,step_id loop
  select last_projected_status into previous from public.workflow_step_instances where id=s.step_id;
  if previous is distinct from s.status then
   update public.workflow_step_instances set last_projected_status=s.status,revision=revision+1,started_at=case when s.status in ('READY','IN_PROGRESS') then coalesce(started_at,clock_timestamp()) else started_at end,
    completed_at=case when s.status in ('COMPLETED','WAIVED') then coalesce(completed_at,clock_timestamp()) else null end,updated_at=clock_timestamp() where id=s.step_id returning revision into cursor;
   if s.status='READY' and i.cancelled_at is null then
    perform public.dispatch_automation_event(i.workspace_id,'WORKFLOW_STEP_READY','workflow-step:'||s.step_id||':ready:'||cursor,
     jsonb_build_object('workflowId',i.id,'enrollmentId',i.enrollment_id,'applicationId',i.application_id,'stepId',s.step_id,'status','READY','relatedType','STUDENT','relatedId',(select student_id from public.student_enrollments where id=i.enrollment_id)),i.owner_id);
   end if;
  end if;
 end loop;
 next_state:=case when i.cancelled_at is not null then 'CANCELLED' when not exists(select 1 from public.workflow_states(instance_id) where status not in ('COMPLETED','WAIVED')) then 'COMPLETED' when exists(select 1 from public.workflow_states(instance_id) where status in ('BLOCKED','CANCELLED')) then 'BLOCKED' else 'ACTIVE' end;
 if next_state is distinct from i.status then
  update public.workflow_instances set status=next_state,completed_at=case when next_state='COMPLETED' then clock_timestamp() else null end,revision=revision+1,updated_at=clock_timestamp() where id=instance_id returning revision into cursor;
  if next_state='COMPLETED' then perform public.dispatch_automation_event(i.workspace_id,'WORKFLOW_COMPLETED','workflow:'||i.id||':completed:'||cursor,jsonb_build_object('workflowId',i.id,'enrollmentId',i.enrollment_id,'applicationId',i.application_id,'status','COMPLETED','relatedType','STUDENT','relatedId',(select student_id from public.student_enrollments where id=i.enrollment_id)),i.owner_id);end if;
 end if;
end $$;
revoke all on function public.refresh_workflow(uuid) from public;

create function public.instantiate_workflow(record_id uuid,template_id uuid,template_version integer,enrollment_id uuid,application_id uuid,owner_id uuid,p_request_key text) returns public.workflow_instances
language plpgsql security definer set search_path=public,app_auth,extensions as $$
declare ws uuid:=public.current_workspace_id();actor uuid:=app_auth.current_user_id();e public.student_enrollments;co public.product_cohorts;a public.student_applications;t public.workflow_templates;d public.workflow_template_steps;i public.workflow_instances;receipt jsonb;due timestamptz;basis timestamptz;generated_task uuid;generated_milestone uuid;step_owner uuid;member_count integer;tz text;
begin
 i.id:=record_id;i.workspace_id:=ws;i.enrollment_id:=enrollment_id;i.application_id:=application_id;i.owner_id:=owner_id;
 if record_id is null or owner_id is null or not public.workflow_instance_access(to_jsonb(i),true) then raise exception 'workflow_forbidden';end if;
 perform 1 from public.student_enrollments x join public.students s on s.id=x.student_id and s.workspace_id=x.workspace_id join public.contacts c on c.id=s.person_id and c.workspace_id=s.workspace_id
  where x.id=enrollment_id and x.workspace_id=ws and public.student_enrollment_access(to_jsonb(x),true) for share of x,s,c;
 if not found then raise exception 'workflow_forbidden';end if;
 select * into e from public.student_enrollments where id=enrollment_id and workspace_id=ws;
 if application_id is not null then select * into a from public.student_applications x where x.id=application_id and x.workspace_id=ws and x.enrollment_id=e.id and public.student_application_access(to_jsonb(x),false) for share;
  if not found then raise exception 'workflow_application_mismatch';end if;end if;
 receipt:=public.workflow_receipt(ws,actor,p_request_key,'WORKFLOW_START',jsonb_build_object('id',record_id,'templateId',template_id,'version',template_version,'enrollmentId',enrollment_id,'applicationId',application_id,'ownerId',owner_id));
 if receipt ? 'item' then
  if not exists(select 1 from public.workflow_instances x where x.id=record_id and x.workspace_id=ws and public.workflow_instance_access(to_jsonb(x),true)) then raise exception 'workflow_forbidden';end if;
  return jsonb_populate_record(null::public.workflow_instances,receipt->'item');end if;
 perform pg_advisory_xact_lock(hashtextextended('workflow-instance:'||record_id::text,0));
 if exists(select 1 from public.workflow_instances x where x.id=record_id) then raise exception 'workflow_request_conflict';end if;
 select * into t from public.workflow_templates x where x.id=template_id and x.workspace_id=ws and public.workflow_template_access(to_jsonb(x),false) for share;
 if not found or t.status<>'ACTIVE' or t.version<>template_version then raise exception 'workflow_template_state_invalid';end if;
 select * into co from public.product_cohorts where id=e.cohort_id and workspace_id=ws;
 if t.product_id is not null and t.product_id<>co.product_id then raise exception 'workflow_product_mismatch';end if;
 if not public.can_assign_crm_task(owner_id) or not exists(select 1 from public.workspace_memberships x where x.workspace_id=ws and x.user_id=owner_id and x.status='ACTIVE') then raise exception 'workflow_owner_invalid';end if;
 if application_id is null and exists(select 1 from public.workflow_template_steps x where x.template_id=t.id and x.workspace_id=ws and (x.milestone_config->>'application_scope'='APPLICATION' or x.checkpoint_config->>'application_scope'='APPLICATION')) then raise exception 'workflow_context_required';end if;
 select business_timezone into tz from public.workspaces where id=ws;
 insert into public.workflow_instances(id,workspace_id,template_id,template_version,enrollment_id,application_id,owner_id,created_by) values(record_id,ws,t.id,t.version,e.id,a.id,owner_id,actor) returning * into i;
 perform set_config('app.workflow_instantiating',i.id::text,true);
 for d in select * from public.workflow_template_steps x where x.workspace_id=ws and x.template_id=t.id order by x.sequence,x.id loop
  step_owner:=owner_id;
  if d.default_owner_role is not null and not exists(select 1 from public.workspace_memberships x where x.workspace_id=ws and x.user_id=step_owner and x.role=d.default_owner_role and x.status='ACTIVE') then
   select count(*),(array_agg(x.user_id))[1] into member_count,step_owner from public.workspace_memberships x where x.workspace_id=ws and x.role=d.default_owner_role and x.status='ACTIVE';
   if member_count<>1 then raise exception 'workflow_owner_context_required';end if;
  end if;
  if not public.can_assign_crm_task(step_owner) then raise exception 'workflow_owner_invalid';end if;
  basis:=case d.offset_basis when 'WORKFLOW_START' then i.started_at when 'COHORT_APPLICATION_DEADLINE' then co.application_deadline::timestamp at time zone tz when 'COHORT_START' then co.start_on::timestamp at time zone tz when 'APPLICATION_DEADLINE' then a.deadline_on::timestamp at time zone tz else null end;
  due:=((basis at time zone tz)+make_interval(days=>d.offset_days)) at time zone tz;generated_task:=null;generated_milestone:=null;
  if d.step_kind='TASK' then
   insert into public.crm_tasks(workspace_id,title_zh,title_en,related_type,related_id,status,priority,owner_id,due_at,created_by)
    values(ws,coalesce(nullif(d.task_config->>'title_zh',''),d.task_config->>'title_en'),coalesce(nullif(d.task_config->>'title_en',''),d.task_config->>'title_zh'),'STUDENT',e.student_id,'TODO',d.task_config->>'priority',step_owner,due,actor) returning id into generated_task;
  elsif d.step_kind='MILESTONE' then
   generated_milestone:=gen_random_uuid();perform public.save_admission_milestone(generated_milestone,null,
    jsonb_build_object('enrollment_id',e.id,'application_id',case when d.milestone_config->>'application_scope'='APPLICATION' then a.id else null end,'milestone_type',d.milestone_config->>'milestone_type','status','PENDING','due_at',due,'scheduled_at',null,'completed_at',null,'outcome',null,'owner_id',step_owner,'external_reference',null,'note',null,'metadata','{}'::jsonb,'sequence',d.sequence),'workflow-milestone:'||i.id||':'||d.id,'');
  end if;
  insert into public.workflow_step_instances(workspace_id,workflow_instance_id,template_id,template_step_id,task_id,milestone_id,initial_due_at,context_warning)
   values(ws,i.id,t.id,d.id,generated_task,generated_milestone,due,case when d.offset_basis is not null and basis is null then 'MISSING_DATE_BASIS' else null end);
 end loop;
 if not public.workflow_instance_access(to_jsonb(i),true) then raise exception 'workflow_forbidden';end if;
 insert into public.audit_events(workspace_id,actor_id,action,entity_type,entity_id,after_data) values(ws,actor,'WORKFLOW_INSTANCE_STARTED','WORKFLOW',i.id,jsonb_build_object('templateId',t.id,'version',t.version,'enrollmentId',e.id,'applicationId',a.id));
 perform public.dispatch_automation_event(ws,'WORKFLOW_STARTED','workflow:'||i.id||':started',jsonb_build_object('workflowId',i.id,'enrollmentId',e.id,'applicationId',a.id,'templateId',t.id,'templateVersion',t.version,'status','ACTIVE','relatedType','STUDENT','relatedId',e.student_id),owner_id);
 perform set_config('app.workflow_instantiating','',true);perform public.refresh_workflow(i.id);select * into i from public.workflow_instances x where x.id=record_id;
 insert into public.mutation_receipts(workspace_id,request_key,operation,result,created_by) values(ws,p_request_key,'WORKFLOW_START',receipt||jsonb_build_object('item',to_jsonb(i)),actor);return i;
end $$;
create function public.operate_workflow(record_id uuid,expected_revision integer,operation text,step_id uuid,reason text,p_request_key text) returns public.workflow_instances
language plpgsql security definer set search_path=public,app_auth,extensions as $$
declare ws uuid:=public.current_workspace_id();actor uuid:=app_auth.current_user_id();i public.workflow_instances;s public.workflow_step_instances;d public.workflow_template_steps;receipt jsonb;
begin
 select * into i from public.workflow_instances where id=record_id and workspace_id=ws for update;
 if not found or not public.workflow_instance_access(to_jsonb(i),true) then raise exception 'workflow_forbidden';end if;
 if expected_revision is null or expected_revision<1 or operation is null or operation not in ('CANCEL','WAIVE','CANCEL_STEP') or length(trim(coalesce(reason,''))) not between 3 and 500 then raise exception 'workflow_input_invalid';end if;
 receipt:=public.workflow_receipt(ws,actor,p_request_key,'WORKFLOW_OPERATE',jsonb_build_object('id',record_id,'revision',expected_revision,'operation',operation,'stepId',step_id,'reason',reason));
 if receipt ? 'item' then return jsonb_populate_record(null::public.workflow_instances,receipt->'item');end if;
 if i.revision<>expected_revision then raise exception 'workflow_version_conflict';end if;
 if i.cancelled_at is not null then raise exception 'workflow_state_invalid';end if;
 if operation='CANCEL' then update public.workflow_instances set status='CANCELLED',cancelled_at=clock_timestamp(),completed_at=null,cancel_reason=reason,revision=revision+1,updated_at=clock_timestamp() where id=record_id;
 else
  select * into s from public.workflow_step_instances x where x.id=step_id and x.workflow_instance_id=record_id and x.workspace_id=ws;
  if not found then raise exception 'workflow_not_found';end if;select * into d from public.workflow_template_steps where id=s.template_step_id;
  if operation='WAIVE' and d.required and public.current_crm_role() not in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR') then raise exception 'workflow_required_waive_forbidden';end if;
  update public.workflow_step_instances set override_status=case operation when 'WAIVE' then 'WAIVED' else 'CANCELLED' end,override_reason=reason,revision=revision+1,updated_at=clock_timestamp() where id=step_id;
  update public.workflow_instances set revision=revision+1,updated_at=clock_timestamp() where id=record_id;
 end if;
 perform public.refresh_workflow(record_id);select * into i from public.workflow_instances where id=record_id;
 insert into public.audit_events(workspace_id,actor_id,action,entity_type,entity_id,after_data) values(ws,actor,case operation when 'CANCEL' then 'WORKFLOW_INSTANCE_CANCELLED' when 'WAIVE' then 'WORKFLOW_STEP_WAIVED' else 'WORKFLOW_STEP_CANCELLED' end,'WORKFLOW',i.id,jsonb_build_object('stepId',step_id,'revision',i.revision));
 insert into public.mutation_receipts(workspace_id,request_key,operation,result,created_by) values(ws,p_request_key,'WORKFLOW_OPERATE',receipt||jsonb_build_object('item',to_jsonb(i)),actor);return i;
end $$;
revoke all on function public.instantiate_workflow(uuid,uuid,integer,uuid,uuid,uuid,text),public.operate_workflow(uuid,integer,text,uuid,text,text) from public;
grant execute on function public.instantiate_workflow(uuid,uuid,integer,uuid,uuid,uuid,text),public.operate_workflow(uuid,integer,text,uuid,text,text) to crm_app;
create function public.guard_workflow_relations() returns trigger language plpgsql security definer set search_path=public as $$
declare i public.workflow_instances;d public.workflow_template_steps;e public.student_enrollments;m public.admission_milestones;t public.crm_tasks;
begin
 if tg_table_name='workflow_instances' then
  if exists(select 1 from public.workflow_templates x join public.product_cohorts c on c.product_id is distinct from x.product_id join public.student_enrollments y on y.cohort_id=c.id and y.workspace_id=c.workspace_id where x.id=new.template_id and x.workspace_id=new.workspace_id and x.product_id is not null and y.id=new.enrollment_id) then raise exception 'workflow_product_mismatch';end if;
 else
  select * into i from public.workflow_instances where id=new.workflow_instance_id and workspace_id=new.workspace_id;select * into d from public.workflow_template_steps where id=new.template_step_id and workspace_id=new.workspace_id;
  select * into e from public.student_enrollments where id=i.enrollment_id;
  if d.step_kind='CHECKPOINT' and (new.task_id is not null or new.milestone_id is not null) or d.step_kind='TASK' and new.milestone_id is not null or d.step_kind='MILESTONE' and new.task_id is not null then raise exception 'workflow_link_mismatch';end if;
  if new.task_id is not null then select * into t from public.crm_tasks where id=new.task_id and workspace_id=new.workspace_id;
   if t.related_type<>'STUDENT' or t.related_id is distinct from e.student_id then raise exception 'workflow_link_mismatch';end if;end if;
  if new.milestone_id is not null then select * into m from public.admission_milestones where id=new.milestone_id and workspace_id=new.workspace_id;
   if m.enrollment_id is distinct from i.enrollment_id or m.application_id is distinct from (case when d.milestone_config->>'application_scope'='APPLICATION' then i.application_id else null end) then raise exception 'workflow_link_mismatch';end if;end if;
 end if;return new;
end $$;
create trigger workflow_product_guard before insert on public.workflow_instances for each row execute function public.guard_workflow_relations();
create trigger workflow_relation_guard before insert or update of task_id,milestone_id,workflow_instance_id,template_step_id,template_id on public.workflow_step_instances for each row execute function public.guard_workflow_relations();
revoke all on function public.guard_workflow_relations() from public;
create function public.workflow_domain_changed() returns trigger language plpgsql security definer set search_path=public,app_auth as $$
declare instance uuid;begin
 if tg_table_name='student_applications' then
  for instance in select id from public.workflow_instances where enrollment_id=new.enrollment_id and workspace_id=new.workspace_id and cancelled_at is null order by id loop if instance::text is distinct from current_setting('app.workflow_instantiating',true) then perform public.refresh_workflow(instance);end if;end loop;
 elsif tg_table_name='admission_milestones' then
  for instance in select id from public.workflow_instances where enrollment_id=new.enrollment_id and workspace_id=new.workspace_id and cancelled_at is null order by id loop if instance::text is distinct from current_setting('app.workflow_instantiating',true) then perform public.refresh_workflow(instance);end if;end loop;
 else
  for instance in select workflow_instance_id from public.workflow_step_instances where task_id=new.id and workspace_id=new.workspace_id order by workflow_instance_id loop if instance::text is distinct from current_setting('app.workflow_instantiating',true) then perform public.refresh_workflow(instance);end if;end loop;
 end if;return new;end $$;
create trigger workflow_application_changed after insert or update of status,submitted_at,decision,decision_at on public.student_applications for each row execute function public.workflow_domain_changed();
create trigger workflow_milestone_changed after insert or update of status,due_at on public.admission_milestones for each row execute function public.workflow_domain_changed();
create trigger workflow_task_changed after update of status,due_at,archived_at on public.crm_tasks for each row execute function public.workflow_domain_changed();
revoke all on function public.workflow_domain_changed() from public;
create function public.guard_workflow_domain_context() returns trigger language plpgsql security definer set search_path=public,app_auth as $$
begin
 if tg_table_name='crm_tasks' then
  if exists(select 1 from public.workflow_step_instances s join public.workflow_instances i on i.id=s.workflow_instance_id join public.student_enrollments e on e.id=i.enrollment_id where s.task_id=new.id and (new.related_type<>'STUDENT' or new.related_id is distinct from e.student_id)) then raise exception 'workflow_link_mismatch';end if;
 else
  if exists(select 1 from public.workflow_step_instances s join public.workflow_instances i on i.id=s.workflow_instance_id join public.workflow_template_steps d on d.id=s.template_step_id where s.milestone_id=new.id and new.application_id is distinct from (case when d.milestone_config->>'application_scope'='APPLICATION' then i.application_id else null end)) then raise exception 'workflow_link_mismatch';end if;
  if new.status='WAIVED' and old.status<>'WAIVED' and exists(select 1 from public.workflow_step_instances s join public.workflow_template_steps d on d.id=s.template_step_id where s.milestone_id=new.id and d.required)
   and (public.current_crm_role() not in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR') or length(trim(coalesce(current_setting('app.milestone_status_reason',true),'')))<3) then raise exception 'workflow_required_waive_forbidden';end if;
 end if;return new;
end $$;
create trigger workflow_task_context_guard before update of related_type,related_id on public.crm_tasks for each row execute function public.guard_workflow_domain_context();
create trigger workflow_milestone_context_guard before update of application_id,status on public.admission_milestones for each row execute function public.guard_workflow_domain_context();
revoke all on function public.guard_workflow_domain_context() from public;
create view public.workflow_template_records with(security_invoker=true) as select t.*,p.name_zh product_name_zh,p.name_en product_name_en,
 (select count(*)::integer from public.workflow_template_steps s where s.template_id=t.id and s.workspace_id=t.workspace_id) step_count,
 exists(select 1 from public.workflow_instances i where i.template_id=t.id and i.workspace_id=t.workspace_id) used,
 public.workflow_template_access(to_jsonb(t),true) can_edit from public.workflow_templates t left join public.products p on p.id=t.product_id and p.workspace_id=t.workspace_id;
create view public.workflow_instance_records with(security_invoker=true) as select i.*,t.name_zh template_name_zh,t.name_en template_name_en,u.display_name_zh owner_name_zh,u.display_name_en owner_name_en,
 public.workflow_projection(i.id) projection,public.workflow_instance_access(to_jsonb(i),true) can_edit from public.workflow_instances i join public.workflow_templates t on t.id=i.template_id and t.workspace_id=i.workspace_id left join public.user_profiles u on u.user_id=i.owner_id;
grant select on public.workflow_template_records,public.workflow_instance_records to crm_app;
create view public.workflow_step_records with(security_invoker=true) as
 select s.*,d.sequence,d.name_zh,d.name_en,d.step_kind,d.required,d.checkpoint_config,
  p.status current_status,p.due_at current_due_at,p.owner_id current_owner_id,p.context_warning current_context_warning,
  u.display_name_zh owner_name_zh,u.display_name_en owner_name_en
 from public.workflow_step_instances s join public.workflow_template_steps d on d.id=s.template_step_id and d.workspace_id=s.workspace_id
 cross join lateral jsonb_to_recordset(public.workflow_projection(s.workflow_instance_id)->'steps') as p(step_id uuid,status text,due_at timestamptz,owner_id uuid,context_warning text)
 left join public.user_profiles u on u.user_id=p.owner_id where p.step_id=s.id;
grant select on public.workflow_step_records to crm_app;
-- Privacy cleans only generated personal records, never shared template definitions or Finance.
create function public.cleanup_workflow_privacy() returns trigger language plpgsql security definer set search_path=public as $$
begin
 delete from public.mutation_receipts where workspace_id=old.workspace_id and operation in ('WORKFLOW_START','WORKFLOW_OPERATE') and result->'item'->>'id'=old.id::text;
 delete from public.crm_tasks where workspace_id=old.workspace_id and id in(select task_id from public.workflow_step_instances where workflow_instance_id=old.id and workspace_id=old.workspace_id);
 return old;
end $$;
create trigger workflow_privacy_cleanup before delete on public.workflow_instances for each row execute function public.cleanup_workflow_privacy();
revoke all on function public.cleanup_workflow_privacy() from public;
create function public.admissions_history_automation() returns trigger language plpgsql security definer set search_path=public,app_auth as $$
declare e public.student_enrollments;a public.student_applications;m public.admission_milestones;kind text;payload jsonb;recipient uuid;
begin
 if tg_table_name='student_application_status_history' then
  select * into a from public.student_applications where id=new.application_id and workspace_id=new.workspace_id;
  select * into e from public.student_enrollments where id=a.enrollment_id and workspace_id=a.workspace_id;
  kind:=case when new.from_status is null then 'APPLICATION_CREATED' else 'APPLICATION_STATUS_CHANGED' end;
  payload:=jsonb_build_object('applicationId',a.id,'enrollmentId',e.id,'studentId',e.student_id,'cohortId',e.cohort_id,'ownerId',a.owner_id,'status',new.to_status,'fromStatus',new.from_status,'relatedType','STUDENT','relatedId',e.student_id);recipient:=coalesce(a.owner_id,e.owner_id);
 else
  if new.from_status is null then return new;end if;
  select * into m from public.admission_milestones where id=new.milestone_id and workspace_id=new.workspace_id;
  select * into e from public.student_enrollments where id=m.enrollment_id and workspace_id=m.workspace_id;
  kind:='MILESTONE_STATUS_CHANGED';payload:=jsonb_build_object('milestoneId',m.id,'enrollmentId',e.id,'applicationId',m.application_id,'milestoneType',m.milestone_type,'ownerId',m.owner_id,'status',new.to_status,'fromStatus',new.from_status,'relatedType','STUDENT','relatedId',e.student_id);recipient:=coalesce(m.owner_id,e.owner_id);
 end if;
 perform public.dispatch_automation_event(new.workspace_id,kind,kind||':history:'||new.id,payload,recipient);return new;
end $$;
create trigger application_history_automation after insert on public.student_application_status_history for each row execute function public.admissions_history_automation();
create trigger milestone_history_automation after insert on public.admission_milestone_status_history for each row execute function public.admissions_history_automation();
revoke all on function public.admissions_history_automation() from public;
create function public.process_milestone_due_events(batch_size integer default 100) returns integer language plpgsql security definer set search_path=public,app_auth as $$
declare item record;payload jsonb;processed integer:=0;
begin
 if batch_size is null or batch_size not between 1 and 200 then raise exception 'automation_batch_invalid';end if;
 for item in select m.*,e.student_id,e.owner_id enrollment_owner,(m.due_at at time zone w.business_timezone)::date-(now() at time zone w.business_timezone)::date days_left
  from public.admission_milestones m join public.student_enrollments e on e.id=m.enrollment_id and e.workspace_id=m.workspace_id join public.workspaces w on w.id=m.workspace_id
  where m.status not in ('COMPLETED','WAIVED','CANCELLED') and m.due_at>=now()
   and exists(select 1 from public.workspace_memberships x where x.workspace_id=m.workspace_id and x.user_id=coalesce(m.owner_id,e.owner_id) and x.status='ACTIVE')
   and exists(select 1 from public.automation_rules r where r.workspace_id=m.workspace_id and r.active and r.trigger_key='MILESTONE_DUE_APPROACHING'
    and jsonb_build_object('milestoneId',m.id,'enrollmentId',m.enrollment_id,'milestoneType',m.milestone_type,'status',m.status,'daysUntilDeadline',(m.due_at at time zone w.business_timezone)::date-(now() at time zone w.business_timezone)::date) @> r.conditions)
   and not exists(select 1 from public.automation_events x where x.workspace_id=m.workspace_id and x.event_key='milestone:'||m.id||':due:'||extract(epoch from m.due_at)||':days:'||((m.due_at at time zone w.business_timezone)::date-(now() at time zone w.business_timezone)::date))
  order by m.due_at,m.id limit batch_size for update of m skip locked
 loop
  payload:=jsonb_build_object('milestoneId',item.id,'enrollmentId',item.enrollment_id,'applicationId',item.application_id,'milestoneType',item.milestone_type,'status',item.status,'daysUntilDeadline',item.days_left,'relatedType','STUDENT','relatedId',item.student_id);
  perform public.dispatch_automation_event(item.workspace_id,'MILESTONE_DUE_APPROACHING','milestone:'||item.id||':due:'||extract(epoch from item.due_at)||':days:'||item.days_left,payload,coalesce(item.owner_id,item.enrollment_owner));processed:=processed+1;
 end loop;return processed;
end $$;
revoke all on function public.process_milestone_due_events(integer) from public,crm_app,crm_system;grant execute on function public.process_milestone_due_events(integer) to crm_worker;
-- Only start/complete summaries enter the student business timeline.
create or replace view public.admissions_timeline with(security_invoker=true) as
 select a.workspace_id,a.enrollment_id,a.id application_id,'APPLICATION'::text source_type,a.id source_id,'SUBMITTED'::text event_type,null::text milestone_type,a.status,a.submitted_at event_at,0 sequence,null::text outcome from public.student_applications a where a.submitted_at is not null
 union all select a.workspace_id,a.enrollment_id,a.id,'APPLICATION',a.id,'DECISION',null,a.status,a.decision_at,0,a.decision from public.student_applications a where a.decision is not null and a.decision_at is not null
 union all select a.workspace_id,a.enrollment_id,a.id,'APPLICATION',a.id,'WITHDRAWN',null,a.status,a.withdrawn_at,0,null from public.student_applications a where a.withdrawn_at is not null
 union all select m.workspace_id,m.enrollment_id,m.application_id,'MILESTONE',m.id,'MILESTONE',m.milestone_type,m.status,coalesce(m.completed_at,m.scheduled_at,m.due_at,m.created_at),m.sequence,coalesce(m.outcome,m.metadata->>'result') from public.admission_milestones m
 union all select w.workspace_id,w.enrollment_id,w.application_id,'WORKFLOW',w.id,'STARTED',null,w.status,w.started_at,0,null from public.workflow_instances w
 union all select w.workspace_id,w.enrollment_id,w.application_id,'WORKFLOW',w.id,'COMPLETED',null,w.status,w.completed_at,0,null from public.workflow_instances w where w.completed_at is not null;

-- Extend the existing action dispatcher without adding an automation framework.
alter table public.automation_rules drop constraint automation_rules_trigger_key_check;
alter table public.automation_rules add constraint automation_rules_trigger_key_check check(trigger_key in ('LEAD_CREATED','LEAD_STATUS_CHANGED','OPPORTUNITY_STAGE_CHANGED','CONTRACT_RENEWAL_DUE','MANUAL','ENROLLMENT_CREATED','ENROLLMENT_STATUS_CHANGED','COHORT_APPLICATION_DEADLINE_APPROACHING','APPLICATION_CREATED','APPLICATION_STATUS_CHANGED','MILESTONE_STATUS_CHANGED','MILESTONE_DUE_APPROACHING','WORKFLOW_STARTED','WORKFLOW_STEP_READY','WORKFLOW_COMPLETED'));
create or replace function public.dispatch_automation_event(
  target_workspace uuid,target_trigger text,target_event_key text,target_payload jsonb,target_actor uuid
) returns jsonb
language plpgsql security definer set search_path=public,app_auth,extensions
as $$
declare event_row public.automation_events;rule_row public.automation_rules;task_id uuid;notification_id uuid;
  succeeded integer:=0;failed integer:=0;duplicate boolean:=false;due_hours integer;
begin
  if target_workspace is null or target_trigger not in ('LEAD_CREATED','LEAD_STATUS_CHANGED','OPPORTUNITY_STAGE_CHANGED','CONTRACT_RENEWAL_DUE','MANUAL','ENROLLMENT_CREATED','ENROLLMENT_STATUS_CHANGED','COHORT_APPLICATION_DEADLINE_APPROACHING','APPLICATION_CREATED','APPLICATION_STATUS_CHANGED','MILESTONE_STATUS_CHANGED','MILESTONE_DUE_APPROACHING','WORKFLOW_STARTED','WORKFLOW_STEP_READY','WORKFLOW_COMPLETED')
    or nullif(trim(target_event_key),'') is null or jsonb_typeof(coalesce(target_payload,'{}'::jsonb))<>'object' then
    raise exception 'automation_event_invalid';
  end if;
  insert into public.automation_events(workspace_id,trigger_key,event_key,payload,actor_id)
  values(target_workspace,target_trigger,left(target_event_key,240),coalesce(target_payload,'{}'::jsonb),target_actor)
  on conflict(workspace_id,event_key) do nothing returning * into event_row;
  if event_row.id is null then
    duplicate:=true;
    select * into event_row from public.automation_events where workspace_id=target_workspace and event_key=left(target_event_key,240);
    return jsonb_build_object('eventId',event_row.id,'duplicate',true,'succeeded',0,'failed',0);
  end if;
  for rule_row in select * from public.automation_rules
    where workspace_id=target_workspace and active and trigger_key=target_trigger
      and (conditions='{}'::jsonb or coalesce(target_payload,'{}'::jsonb) @> conditions)
    order by created_at,id
  loop
    begin
      if rule_row.action_type='TASK' then
        due_hours:=case when coalesce(rule_row.action_config->>'dueHours','')~'^\d{1,4}$'
          then greatest(1,least(2160,(rule_row.action_config->>'dueHours')::integer)) else 24 end;
        insert into public.crm_tasks(workspace_id,title_zh,title_en,related_type,related_id,related_label,status,priority,owner_id,due_at,created_by)
        values(target_workspace,
          coalesce(nullif(trim(rule_row.action_config->>'titleZh'),''),rule_row.name_zh),
          coalesce(nullif(trim(rule_row.action_config->>'titleEn'),''),rule_row.name_en),
          coalesce(nullif(trim(target_payload->>'relatedType'),''),'GENERAL'),
          case when coalesce(target_payload->>'relatedId','')~'^[0-9a-fA-F-]{36}$' then (target_payload->>'relatedId')::uuid else null end,
          left(coalesce(target_payload->>'relatedLabel',''),160),'TODO',
          case when upper(coalesce(rule_row.action_config->>'priority','NORMAL')) in ('LOW','NORMAL','HIGH','URGENT') then upper(rule_row.action_config->>'priority') else 'NORMAL' end,
          target_actor,now()+make_interval(hours=>due_hours),target_actor)
        returning id into task_id;
        insert into public.automation_runs(workspace_id,rule_id,event_id,status,result_type,result_id)
        values(target_workspace,rule_row.id,event_row.id,'SUCCEEDED','TASK',task_id);
      else
        insert into public.user_notifications(workspace_id,user_id,kind,title_key,body_key,values,source_type,source_id)
        values(target_workspace,target_actor,'AUTOMATION','automation.notification.title','automation.notification.body',
          jsonb_build_object('ruleZh',rule_row.name_zh,'ruleEn',rule_row.name_en,'event',target_trigger),
          'AUTOMATION_RULE',rule_row.id) returning id into notification_id;
        insert into public.automation_runs(workspace_id,rule_id,event_id,status,result_type,result_id)
        values(target_workspace,rule_row.id,event_row.id,'SUCCEEDED','NOTIFICATION',notification_id);
      end if;
      succeeded:=succeeded+1;
    exception when others then
      failed:=failed+1;
      insert into public.automation_runs(workspace_id,rule_id,event_id,status,error_code)
      values(target_workspace,rule_row.id,event_row.id,'FAILED',left(sqlstate||':'||sqlerrm,500))
      on conflict(rule_id,event_id) do nothing;
    end;
  end loop;
  return jsonb_build_object('eventId',event_row.id,'duplicate',duplicate,'succeeded',succeeded,'failed',failed);
end;
$$;

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
update public.data_quality_issues issue set status='RESOLVED',resolution_note='AUTO_RESOLVED',resolved_at=now(),resolved_by=app_auth.current_user_id()
  where issue.workspace_id=ws and issue.status in ('OPEN','ASSIGNED') and issue.last_seen_at<marker
    and issue.rule_key in (select rule_key from public.data_quality_rule_configs where workspace_id=ws);
  select count(*) into affected from public.data_quality_issues where workspace_id=ws and status in ('OPEN','ASSIGNED');
  return affected;
end;
$$;
insert into public.data_quality_rule_configs(workspace_id,rule_key,enabled,severity) select w.id,k.rule,true,'MEDIUM' from public.workspaces w cross join(values ('WORKFLOW_INSTANCE_BLOCKED'),('WORKFLOW_STEP_OVERDUE'),('WORKFLOW_MISSING_CONTEXT')) k(rule) on conflict do nothing;
create function public.seed_workflow_quality() returns trigger language plpgsql security definer set search_path=public as $$ begin
 insert into public.data_quality_rule_configs(workspace_id,rule_key,enabled,severity) select new.id,k.rule,true,'MEDIUM' from(values ('WORKFLOW_INSTANCE_BLOCKED'),('WORKFLOW_STEP_OVERDUE'),('WORKFLOW_MISSING_CONTEXT')) k(rule) on conflict do nothing;return new;end $$;
create trigger workspace_workflow_quality after insert on public.workspaces for each row execute function public.seed_workflow_quality();
revoke all on function public.seed_workflow_quality() from public;
