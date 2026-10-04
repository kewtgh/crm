set search_path=public,extensions;

-- Forward additions only. Legacy Leads remain PRIVATE; no guessed stage backfill.
alter table public.leads alter column owner_id drop not null;
alter table public.leads add column pool_visibility text not null default 'PRIVATE' check(pool_visibility in ('PRIVATE','WORKSPACE_PUBLIC'));
alter table public.leads add column revision integer not null default 1 check(revision>0);
alter table public.leads add column next_action text not null default '' check(length(next_action)<=1000);
alter table public.leads add constraint leads_public_school check(pool_visibility='PRIVATE' or subject_type='SCHOOL');
create index leads_available_pool_idx on public.leads(workspace_id,created_at,id) where pool_visibility='WORKSPACE_PUBLIC' and owner_id is null and status in ('NEW','QUALIFYING','QUALIFIED');
create index leads_owner_open_idx on public.leads(workspace_id,owner_id,updated_at desc) where status in ('NEW','QUALIFYING','QUALIFIED');

create function public.lead_record_access(record jsonb,edit boolean default false) returns boolean
language sql stable security definer set search_path=public,app_auth as $$
 select coalesce(app_auth.current_user_id() is not null and record->>'workspace_id'=public.current_workspace_id()::text
 and public.is_workspace_member(public.current_workspace_id())
 and public.current_crm_role() in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER','SALES_SPECIALIST','SALES_SUPPORT')
 and (not edit or public.current_crm_role()<>'SALES_SUPPORT')
 and public.customer_subject_access(case when record->>'subject_type'='SCHOOL' then 'ORGANIZATION' else 'HOUSEHOLD' end,
 coalesce((record->>'organization_id')::uuid,(record->>'household_id')::uuid),false)
 and (not edit and record->>'pool_visibility'='WORKSPACE_PUBLIC'
 or public.current_crm_role() in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR')
 or (record->>'owner_id')::uuid=app_auth.current_user_id()
 or (public.current_crm_role()='SALES_MANAGER' and public.can_assign_crm_task((record->>'owner_id')::uuid))),false) $$;
revoke all on function public.lead_record_access(jsonb,boolean) from public;
grant execute on function public.lead_record_access(jsonb,boolean) to crm_app;
drop policy if exists "sales read leads" on public.leads;
drop policy if exists "sales manage leads" on public.leads;
create policy lead_scoped_read on public.leads for select to crm_app using(public.lead_record_access(to_jsonb(leads),false));
revoke insert,update,delete on public.leads from crm_app;

create table public.lead_assignment_history(
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id),lead_id uuid not null,
 event_type text not null check(event_type in ('CLAIMED','RELEASED','REASSIGNED')),
 from_owner_id uuid references app_auth.accounts(id),to_owner_id uuid references app_auth.accounts(id),
 reason text check(length(reason)<=1000),changed_by uuid references app_auth.accounts(id),changed_at timestamptz not null default clock_timestamp(),
 lead_revision integer not null check(lead_revision>0),foreign key(workspace_id,lead_id) references public.leads(workspace_id,id) on delete cascade,
 check((event_type='CLAIMED' and from_owner_id is null and to_owner_id is not null) or
 (event_type='RELEASED' and from_owner_id is not null and to_owner_id is null) or
 (event_type='REASSIGNED' and to_owner_id is not null and from_owner_id is distinct from to_owner_id))
);
create index lead_assignment_history_lead_idx on public.lead_assignment_history(workspace_id,lead_id,changed_at desc);
alter table public.lead_assignment_history enable row level security;
create policy lead_assignment_read on public.lead_assignment_history for select to crm_app using(exists(select 1 from public.leads l where l.workspace_id=lead_assignment_history.workspace_id and l.id=lead_assignment_history.lead_id));
grant select on public.lead_assignment_history to crm_app,crm_worker;
create policy lead_assignment_privacy_worker on public.lead_assignment_history for select to crm_worker using(true);

create function public.manage_lead_assignment(target_lead uuid,expected_revision integer,operation text,target_owner uuid,reason text,p_request_key text) returns public.leads
language plpgsql security definer set search_path=public,app_auth,extensions as $$
declare ws uuid:=public.current_workspace_id();actor uuid:=app_auth.current_user_id();l public.leads;result public.leads;r public.mutation_receipts;fingerprint text;new_owner uuid;manager boolean;
begin
 if actor is null or public.current_crm_role() not in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER','SALES_SPECIALIST') then raise exception 'lead_forbidden';end if;
 if operation is null or operation not in ('CLAIM','RELEASE','REASSIGN','VISIBILITY_PUBLIC','VISIBILITY_PRIVATE') or expected_revision is null or expected_revision<1
 or length(coalesce(p_request_key,'')) not between 8 and 120 then raise exception 'lead_input_invalid';end if;
 perform pg_advisory_xact_lock(hashtextextended('lead-request:'||ws::text||p_request_key,0));
 select * into l from public.leads where workspace_id=ws and id=target_lead for update;
 if not found or not public.lead_record_access(to_jsonb(l),false) then raise exception 'lead_forbidden';end if;
 manager:=public.current_crm_role() in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER')
 and (l.owner_id is null or public.can_assign_crm_task(l.owner_id));
 fingerprint:=encode(digest(jsonb_build_object('id',target_lead,'revision',expected_revision,'operation',operation,'owner',target_owner,'reason',reason)::text,'sha256'),'hex');
 select * into r from public.mutation_receipts where workspace_id=ws and request_key=p_request_key;
 if found then
 if r.operation<>'LEAD_ASSIGNMENT' or r.created_by is distinct from actor or r.result->>'request_hash' is distinct from fingerprint then raise exception 'lead_request_conflict';end if;
 return jsonb_populate_record(null::public.leads,r.result->'item');end if;
 if operation='CLAIM' then
 if l.pool_visibility<>'WORKSPACE_PUBLIC' or l.subject_type<>'SCHOOL' or l.status not in ('NEW','QUALIFYING','QUALIFIED') then raise exception 'lead_not_available';end if;
 if l.owner_id is not null then raise exception 'lead_already_claimed';end if;new_owner:=actor;
 elsif operation='RELEASE' then
 if l.pool_visibility<>'WORKSPACE_PUBLIC' or l.owner_id is null or l.status not in ('NEW','QUALIFYING','QUALIFIED') then raise exception 'lead_not_available';end if;
 if l.owner_id<>actor and not manager then raise exception 'lead_forbidden';end if;
 if length(trim(coalesce(reason,''))) not between 1 and 1000 then raise exception 'lead_reason_required';end if;new_owner:=null;
 elsif operation='REASSIGN' then
 if not manager or target_owner is null or not public.can_assign_crm_task(target_owner)
 or not exists(select 1 from public.workspace_memberships where workspace_id=ws and user_id=target_owner and status='ACTIVE' and upper(role) in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER','SALES_SPECIALIST')) then raise exception 'lead_owner_forbidden';end if;
 if target_owner is not distinct from l.owner_id then raise exception 'lead_already_assigned';end if;
 if length(trim(coalesce(reason,''))) not between 1 and 1000 then raise exception 'lead_reason_required';end if;
 -- Assignment reuses the existing team scope and does not grant account access.
 new_owner:=target_owner;
 else
 if not manager or l.subject_type<>'SCHOOL' then raise exception 'lead_forbidden';end if;new_owner:=l.owner_id;
 end if;
 if l.revision<>expected_revision then raise exception 'lead_version_conflict';end if;
 update public.leads set owner_id=new_owner,pool_visibility=case operation when 'VISIBILITY_PUBLIC' then 'WORKSPACE_PUBLIC' when 'VISIBILITY_PRIVATE' then 'PRIVATE' else pool_visibility end,
 revision=revision+1,updated_at=clock_timestamp() where id=l.id returning * into result;
 if operation in ('CLAIM','RELEASE','REASSIGN') then
 insert into public.lead_assignment_history(workspace_id,lead_id,event_type,from_owner_id,to_owner_id,reason,changed_by,lead_revision)
 values(ws,l.id,case operation when 'CLAIM' then 'CLAIMED' when 'RELEASE' then 'RELEASED' else 'REASSIGNED' end,l.owner_id,new_owner,reason,actor,result.revision);end if;
 insert into public.audit_events(workspace_id,actor_id,action,entity_type,entity_id,after_data) values(ws,actor,
 case operation when 'CLAIM' then 'LEAD_CLAIMED' when 'RELEASE' then 'LEAD_RELEASED' when 'REASSIGN' then 'LEAD_REASSIGNED' else 'LEAD_POOL_VISIBILITY_CHANGED' end,
 'LEAD',l.id,jsonb_build_object('fromOwnerId',l.owner_id,'toOwnerId',new_owner,'visibility',result.pool_visibility,'revision',result.revision));
 if operation in ('CLAIM','RELEASE') then perform public.dispatch_automation_event(ws,case operation when 'CLAIM' then 'LEAD_CLAIMED' else 'LEAD_RELEASED' end,
 'lead:'||l.id||':assignment:'||result.revision,jsonb_build_object('workspaceId',ws,'leadId',l.id,'organizationId',l.organization_id,'ownerId',new_owner,'relatedType','LEAD','relatedId',l.id),coalesce(new_owner,actor));end if;
 insert into public.mutation_receipts(workspace_id,request_key,operation,result,created_by) values(ws,p_request_key,'LEAD_ASSIGNMENT',jsonb_build_object('request_hash',fingerprint,'item',to_jsonb(result)),actor);
 return result;
end $$;
revoke all on function public.manage_lead_assignment(uuid,integer,text,uuid,text,text) from public,crm_system;
grant execute on function public.manage_lead_assignment(uuid,integer,text,uuid,text,text) to crm_app;

-- One ordinary save path, without owner PATCH. Legacy callers retain score-driven creation
-- when they omit status; new UI explicitly chooses NEW/qualification status.
create function public.save_lead(record_id uuid,expected_revision integer,data jsonb,p_request_key text) returns public.leads
language plpgsql security definer set search_path=public,app_auth,extensions as $$
declare ws uuid:=public.current_workspace_id();actor uuid:=app_auth.current_user_id();previous public.leads;result public.leads;r public.mutation_receipts;candidate public.leads;fingerprint text;
begin
 if actor is null or record_id is null or jsonb_typeof(data) is distinct from 'object' or length(coalesce(p_request_key,'')) not between 8 and 120
 or exists(select 1 from jsonb_object_keys(data) k where k not in ('subject_type','organization_id','household_id','name_zh','name_en','source','qualification_score','qualification_note','status','pool_visibility','next_action')) then raise exception 'lead_input_invalid';end if;
 perform pg_advisory_xact_lock(hashtextextended('lead-request:'||ws::text||p_request_key,0));
 select * into previous from public.leads where workspace_id=ws and id=record_id for update;
 candidate:=jsonb_populate_record(previous,data||jsonb_build_object('id',record_id,'workspace_id',ws));
 if previous.id is null then
 candidate.owner_id:=actor;candidate.pool_visibility:=coalesce(candidate.pool_visibility,'PRIVATE');
 candidate.status:=coalesce(candidate.status,case when candidate.qualification_score>=60 then 'QUALIFIED' else 'QUALIFYING' end);
 candidate.pipeline_key:=case candidate.subject_type when 'SCHOOL' then 'SCHOOL_DEFAULT' else 'HOUSEHOLD_DEFAULT' end;
 candidate.created_by:=actor;candidate.revision:=1;candidate.created_at:=clock_timestamp();candidate.updated_at:=clock_timestamp();candidate.source_detail:='';candidate.next_action:=coalesce(candidate.next_action,'');candidate.qualification_note:=coalesce(candidate.qualification_note,'');
 if candidate.pool_visibility='WORKSPACE_PUBLIC' then
 if public.current_crm_role() not in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER') then raise exception 'lead_visibility_forbidden';end if;candidate.owner_id:=null;end if;
 else
 if candidate.subject_type<>previous.subject_type or candidate.organization_id is distinct from previous.organization_id or candidate.household_id is distinct from previous.household_id then raise exception 'lead_subject_immutable';end if;
 if candidate.pool_visibility<>previous.pool_visibility then raise exception 'lead_assignment_required';end if;
 if candidate.status='CONVERTED' and previous.status<>'CONVERTED' then raise exception 'lead_conversion_required';end if;
 if previous.status='CONVERTED' and candidate.status<>previous.status then raise exception 'lead_conversion_immutable';end if;
 candidate.revision:=previous.revision+1;candidate.updated_at:=clock_timestamp();end if;
 if not public.lead_record_access(to_jsonb(candidate),true) then
 -- Manager creating an unassigned public lead still needs explicit subject access.
 if previous.id is not null or candidate.pool_visibility<>'WORKSPACE_PUBLIC' or public.current_crm_role() not in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER')
 or not public.customer_subject_access('ORGANIZATION',candidate.organization_id,false) then raise exception 'lead_forbidden';end if;end if;
 if length(candidate.name_zh)>160 or length(candidate.name_en)>160 or length(candidate.source)>80 or length(candidate.qualification_note)>1000 then raise exception 'lead_input_invalid';end if;
 fingerprint:=encode(digest(jsonb_build_object('id',record_id,'revision',expected_revision,'data',data)::text,'sha256'),'hex');
 select * into r from public.mutation_receipts where workspace_id=ws and request_key=p_request_key;
 if found then if r.operation<>'LEAD_SAVE' or r.created_by is distinct from actor or r.result->>'request_hash' is distinct from fingerprint then raise exception 'lead_request_conflict';end if;return jsonb_populate_record(null::public.leads,r.result->'item');end if;
 if previous.id is null then
 if expected_revision is not null then raise exception 'lead_not_found';end if;
 if candidate.status='CONVERTED' then raise exception 'lead_conversion_required';end if;
 insert into public.leads select (candidate).* returning * into result;
 else
 if expected_revision is null or previous.revision<>expected_revision then raise exception 'lead_version_conflict';end if;
 update public.leads set name_zh=candidate.name_zh,name_en=candidate.name_en,source=candidate.source,qualification_score=candidate.qualification_score,
 qualification_note=candidate.qualification_note,status=candidate.status,next_action=candidate.next_action,revision=candidate.revision,updated_at=candidate.updated_at where id=record_id returning * into result;end if;
 insert into public.audit_events(workspace_id,actor_id,action,entity_type,entity_id,after_data) values(ws,actor,case when previous.id is null then 'LEAD_CREATED' else 'LEAD_UPDATED' end,'LEAD',record_id,jsonb_build_object('revision',result.revision,'status',result.status,'visibility',result.pool_visibility));
 insert into public.mutation_receipts(workspace_id,request_key,operation,result,created_by) values(ws,p_request_key,'LEAD_SAVE',jsonb_build_object('request_hash',fingerprint,'item',to_jsonb(result)),actor);return result;
end $$;
revoke all on function public.save_lead(uuid,integer,jsonb,text) from public,crm_system;
grant execute on function public.save_lead(uuid,integer,jsonb,text) to crm_app;

alter table public.organization_business_profiles drop constraint organization_business_profiles_partnership_stage_check;
alter table public.organization_business_profiles add constraint organization_business_profiles_partnership_stage_check check(partnership_stage in ('PROSPECT','CONTACTING','ACTIVE','PAUSED','ENDED','KEY_PERSON_ENGAGED','NEEDS_QUALIFIED','SOLUTION_PROPOSED','PARTNERSHIP_AGREED','RECRUITMENT_ACTIVATED','ONGOING_ENABLEMENT'));
create table public.organization_channel_stage_history(
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id),organization_id uuid not null,
 from_stage text,to_stage text not null,changed_at timestamptz not null default clock_timestamp(),changed_by uuid references app_auth.accounts(id),reason text check(length(reason)<=1000),revision integer not null,
 foreign key(workspace_id,organization_id) references public.organizations(workspace_id,id) on delete cascade
);
create index organization_channel_stage_history_idx on public.organization_channel_stage_history(workspace_id,organization_id,changed_at desc);
alter table public.organization_channel_stage_history enable row level security;
create policy channel_stage_read on public.organization_channel_stage_history for select to crm_app using(workspace_id=public.current_workspace_id() and public.customer_subject_access('ORGANIZATION',organization_id,false));
grant select on public.organization_channel_stage_history to crm_app;
create function public.channel_stage_history_trigger() returns trigger language plpgsql security definer set search_path=public,app_auth as $$
begin
 if tg_op='INSERT' or new.partnership_stage is distinct from old.partnership_stage then
 insert into public.organization_channel_stage_history(workspace_id,organization_id,from_stage,to_stage,changed_by,reason,revision)
 values(new.workspace_id,new.id,case when tg_op='INSERT' then null else old.partnership_stage end,new.partnership_stage,app_auth.current_user_id(),nullif(current_setting('app.channel_stage_reason',true),''),new.revision);
 insert into public.audit_events(workspace_id,actor_id,action,entity_type,entity_id,after_data) values(new.workspace_id,app_auth.current_user_id(),'CHANNEL_STAGE_CHANGED','ORGANIZATION',new.id,jsonb_build_object('fromStage',case when tg_op='INSERT' then null else old.partnership_stage end,'toStage',new.partnership_stage,'revision',new.revision));
 perform public.dispatch_automation_event(new.workspace_id,'CHANNEL_STAGE_CHANGED','organization:'||new.id||':stage:'||new.revision,
 jsonb_build_object('workspaceId',new.workspace_id,'organizationId',new.id,'stage',new.partnership_stage,'relatedType','ORGANIZATION','relatedId',new.id),coalesce((select owner_id from public.organizations where id=new.id),app_auth.current_user_id()));
 end if;return new;
end $$;
revoke all on function public.channel_stage_history_trigger() from public;
create trigger channel_stage_history after insert or update on public.organization_business_profiles for each row execute function public.channel_stage_history_trigger();

create function public.update_channel_partnership_stage(target_organization uuid,expected_revision integer,next_stage text,reason text,p_request_key text) returns jsonb
language plpgsql security definer set search_path=public,app_auth,extensions as $$
declare p public.organization_business_profiles;r public.mutation_receipts;result jsonb;data jsonb;fingerprint text;ws uuid:=public.current_workspace_id();actor uuid:=app_auth.current_user_id();
begin
 if not public.customer_subject_access('ORGANIZATION',target_organization,true) or public.current_crm_role() not in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER','SALES_SPECIALIST','SALES_SUPPORT') then raise exception 'channel_forbidden';end if;
 if length(trim(coalesce(reason,''))) not between 1 and 1000 or length(coalesce(p_request_key,'')) not between 8 and 120 then raise exception 'channel_input_invalid';end if;
 perform pg_advisory_xact_lock(hashtextextended('channel-stage-request:'||ws||p_request_key,0));
 fingerprint:=encode(digest(jsonb_build_object('id',target_organization,'revision',expected_revision,'stage',next_stage,'reason',reason)::text,'sha256'),'hex');
 select * into r from public.mutation_receipts where workspace_id=ws and request_key=p_request_key;
 if found then if r.operation<>'CHANNEL_STAGE' or r.created_by is distinct from actor or r.result->>'request_hash' is distinct from fingerprint then raise exception 'channel_request_conflict';end if;return r.result->'item';end if;
 perform pg_advisory_xact_lock(hashtextextended('education-business:'||ws::text||'organizations'||target_organization::text,0));
 select * into p from public.organization_business_profiles where workspace_id=ws and id=target_organization for update;
 if not found then raise exception 'channel_profile_required';end if;
 if expected_revision is null or expected_revision<>p.revision then raise exception 'channel_version_conflict';end if;
 data:=to_jsonb(p)-array['workspace_id','revision','created_by','created_at','updated_at'];
 data:=data||jsonb_build_object('partnership_stage',next_stage);
 perform set_config('app.channel_stage_reason',reason,true);
 result:=public.save_education_business('organizations',target_organization,expected_revision,data);
 perform set_config('app.channel_stage_reason','',true);
 insert into public.mutation_receipts(workspace_id,request_key,operation,result,created_by) values(ws,p_request_key,'CHANNEL_STAGE',jsonb_build_object('request_hash',fingerprint,'item',result),actor);return result;
end $$;
revoke all on function public.update_channel_partnership_stage(uuid,integer,text,text,text) from public,crm_system;
grant execute on function public.update_channel_partnership_stage(uuid,integer,text,text,text) to crm_app;

-- Domain sources and their labels retain their own RLS. No hidden Contact data is joined.
create view public.lead_pool_records with(security_invoker=true) as
 select l.*,coalesce(o.name_zh,h.name_zh,l.name_zh) subject_name_zh,coalesce(o.name_en,h.name_en,l.name_en) subject_name_en,
 o.city,p.school_type,p.commercial_tier,p.partnership_potential_score,
 (select count(*) from public.organization_contact_intelligence_records c where c.organization_id=l.organization_id and c.key_contact_status='KEY') key_contact_count,
 (select max(a.occurred_at) from public.crm_activities a where a.organization_id=l.organization_id and (a.contact_id is null or public.customer_subject_access('CONTACT',a.contact_id,false))) latest_activity_at,
 public.lead_record_access(to_jsonb(l),true) can_edit,
 public.current_crm_role() in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER') and (l.owner_id is null or public.can_assign_crm_task(l.owner_id)) can_assign,
 l.owner_id=app_auth.current_user_id() is_mine
 from public.leads l left join public.organizations o on o.id=l.organization_id left join public.households h on h.id=l.household_id
 left join public.organization_business_profiles p on p.id=l.organization_id;
grant select on public.lead_pool_records to crm_app;

create function public.channel_activation_projection(target_organization uuid) returns jsonb
language plpgsql stable security invoker set search_path=public,app_auth as $$
declare result jsonb;
begin
 if not public.customer_subject_access('ORGANIZATION',target_organization,false) or public.current_crm_role() not in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER','SALES_SPECIALIST','SALES_SUPPORT') then raise exception 'channel_forbidden';end if;
 select jsonb_build_object('organizationId',o.id,'currentPartnershipStage',p.partnership_stage,'profileRevision',p.revision,'nextAction',p.next_action,
 'canManage',public.customer_subject_access('ORGANIZATION',o.id,true),'stageChangedAt',(select max(changed_at) from public.organization_channel_stage_history where organization_id=o.id),
 'openLeadCount',(select count(*) from public.leads where organization_id=o.id and status in ('NEW','QUALIFYING','QUALIFIED')),
 'claimedLeadCount',(select count(*) from public.leads where organization_id=o.id and status in ('NEW','QUALIFYING','QUALIFIED') and owner_id is not null),
 'keyContactCount',(select count(*) from public.organization_contact_intelligence_records where organization_id=o.id and key_contact_status='KEY'),
 'decisionMakerCount',(select count(*) from public.organization_commercial_contact_records where organization_id=o.id and decision_role='DECISION_MAKER'),
 'latestActivityAt',(select max(occurred_at) from public.crm_activities a where a.organization_id=o.id and (a.contact_id is null or public.customer_subject_access('CONTACT',a.contact_id,false))),
 'activeOpportunityCount',(select count(*) from public.opportunities where organization_id=o.id and stage not in ('WON','LOST')),
 'recentRecruitmentEventCount',(select count(*) from public.education_outreach_events where organization_id=o.id and starts_on>=public.education_business_today()-90 and status<>'CANCELLED'),
 'primaryEnrollmentCount',(select count(distinct enrollment_id) from public.enrollment_attributions where source_organization_id=o.id and attribution_type='PRIMARY'),
 'assistEnrollmentCount',(select count(distinct enrollment_id) from public.enrollment_attributions where source_organization_id=o.id and attribution_type='ASSIST'),
 'lastEnrollmentAt',(select max(e.created_at) from public.enrollment_attributions a join public.student_enrollments e on e.id=a.enrollment_id where a.source_organization_id=o.id),
 'leads',coalesce((select jsonb_agg(x) from (select id,status,owner_id from public.leads where organization_id=o.id order by updated_at desc,id limit 10)x),'[]'::jsonb),
 'events',coalesce((select jsonb_agg(x) from (select id,name,starts_on,product_id,cohort_id from public.education_outreach_events where organization_id=o.id order by starts_on desc,id limit 10)x),'[]'::jsonb)) into result
 from public.organizations o left join public.organization_business_profiles p on p.id=o.id where o.id=target_organization;
 return result;
end $$;
revoke all on function public.channel_activation_projection(uuid) from public;
grant execute on function public.channel_activation_projection(uuid) to crm_app;

-- Subject removal removes personal Lead receipts; staff assignment history is not
-- purged merely because a school Contact is removed. Household privacy stays canonical.
create function public.clean_lead_receipts() returns trigger language plpgsql security definer set search_path=public as $$
begin delete from public.mutation_receipts where workspace_id=old.workspace_id and operation in ('LEAD_SAVE','LEAD_ASSIGNMENT') and result->'item'->>'id'=old.id::text;return old;end $$;
revoke all on function public.clean_lead_receipts() from public;
create trigger clean_lead_receipts after delete on public.leads for each row execute function public.clean_lead_receipts();

-- The existing Lead automation uses each real revision transition, including
-- unassigned pool edits, without dispatching ordinary owner/next-action changes.
create or replace function public.lead_automation_trigger() returns trigger language plpgsql security definer set search_path=public,app_auth,extensions as $$
begin
 if tg_op='INSERT' then
 perform public.dispatch_automation_event(new.workspace_id,'LEAD_CREATED','lead:'||new.id||':created',jsonb_build_object('relatedType','LEAD','relatedId',new.id,'ownerId',new.owner_id,'status',new.status,'source',new.source),coalesce(new.owner_id,new.created_by));
 elsif new.status is distinct from old.status then
 perform public.dispatch_automation_event(new.workspace_id,'LEAD_STATUS_CHANGED','lead:'||new.id||':status-revision:'||new.revision,jsonb_build_object('relatedType','LEAD','relatedId',new.id,'ownerId',new.owner_id,'status',new.status,'source',new.source),coalesce(new.owner_id,app_auth.current_user_id()));
 end if;return new;
end $$;

alter table public.automation_rules drop constraint automation_rules_trigger_key_check;
alter table public.automation_rules add constraint automation_rules_trigger_key_check check(trigger_key in ('LEAD_CREATED','LEAD_STATUS_CHANGED','OPPORTUNITY_STAGE_CHANGED','CONTRACT_RENEWAL_DUE','MANUAL','ENROLLMENT_CREATED','ENROLLMENT_STATUS_CHANGED','COHORT_APPLICATION_DEADLINE_APPROACHING','APPLICATION_CREATED','APPLICATION_STATUS_CHANGED','MILESTONE_STATUS_CHANGED','MILESTONE_DUE_APPROACHING','WORKFLOW_STARTED','WORKFLOW_STEP_READY','WORKFLOW_COMPLETED','LEAD_CLAIMED','LEAD_RELEASED','CHANNEL_STAGE_CHANGED'));
create or replace function public.dispatch_automation_event(
  target_workspace uuid,target_trigger text,target_event_key text,target_payload jsonb,target_actor uuid
) returns jsonb
language plpgsql security definer set search_path=public,app_auth,extensions
as $$
declare event_row public.automation_events;rule_row public.automation_rules;task_id uuid;notification_id uuid;
  succeeded integer:=0;failed integer:=0;duplicate boolean:=false;due_hours integer;
begin
  if target_workspace is null or target_trigger not in ('LEAD_CREATED','LEAD_STATUS_CHANGED','OPPORTUNITY_STAGE_CHANGED','CONTRACT_RENEWAL_DUE','MANUAL','ENROLLMENT_CREATED','ENROLLMENT_STATUS_CHANGED','COHORT_APPLICATION_DEADLINE_APPROACHING','APPLICATION_CREATED','APPLICATION_STATUS_CHANGED','MILESTONE_STATUS_CHANGED','MILESTONE_DUE_APPROACHING','WORKFLOW_STARTED','WORKFLOW_STEP_READY','WORKFLOW_COMPLETED','LEAD_CLAIMED','LEAD_RELEASED','CHANNEL_STAGE_CHANGED')
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

alter table public.lead_conversions add column request_hash text;
drop function public.convert_lead_to_opportunity(uuid,text,text,numeric,text,text);
create function public.convert_lead_to_opportunity(
  target_lead uuid,title_zh text,title_en text,amount numeric,currency text,p_idempotency_key text, next_product uuid default null, next_cohort uuid default null, next_owner uuid default null
) returns public.opportunities
language plpgsql security definer set search_path=public,app_auth,extensions
as $$
declare lead public.leads; result public.opportunities; existing_id uuid; fingerprint text; conversion_record public.lead_conversions;
begin
  if public.current_crm_role() not in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER','SALES_SPECIALIST') then
    raise exception 'lead_forbidden';
  end if;
  if nullif(trim(p_idempotency_key),'') is null then raise exception 'lead_idempotency_required'; end if;
  perform pg_advisory_xact_lock(hashtextextended('lead-convert:'||public.current_workspace_id()||p_idempotency_key,0));
  select * into lead from public.leads where id=target_lead and workspace_id=public.current_workspace_id() for update;
  if not found or not public.lead_record_access(to_jsonb(lead),true) then raise exception 'lead_forbidden';end if;
  fingerprint:=encode(digest(jsonb_build_object('id',target_lead,'titleZh',title_zh,'titleEn',title_en,'amount',amount,'currency',currency,'product',next_product,'cohort',next_cohort,'owner',next_owner)::text,'sha256'),'hex');
  select * into conversion_record from public.lead_conversions where workspace_id=public.current_workspace_id() and idempotency_key=trim(p_idempotency_key);
  if found then
    if conversion_record.lead_id<>lead.id or conversion_record.converted_by<>app_auth.current_user_id() or (conversion_record.request_hash is not null and conversion_record.request_hash<>fingerprint) then raise exception 'lead_request_conflict';end if;
    select * into result from public.opportunities where id=conversion_record.opportunity_id;return result;
  end if;
  if coalesce(next_owner,lead.owner_id) is null or not public.can_assign_crm_task(coalesce(next_owner,lead.owner_id)) then raise exception 'lead_owner_forbidden';end if;
  if next_product is not null and not exists(select 1 from public.products where workspace_id=lead.workspace_id and id=next_product) then raise exception 'lead_product_invalid';end if;
  if next_cohort is not null and not exists(select 1 from public.product_cohorts where workspace_id=lead.workspace_id and id=next_cohort and product_id=next_product) then raise exception 'lead_product_invalid';end if;
  if lead.status<>'QUALIFIED' then raise exception 'lead_not_convertible'; end if;
  insert into public.opportunities(
    workspace_id,organization_id,household_id,subject_type,pipeline_key,
    title_zh,title_en,amount,currency,owner_id,created_by,product_id,cohort_id,
    expected_close_date,next_action_zh,next_action_en
  ) values(
    lead.workspace_id,lead.organization_id,lead.household_id,lead.subject_type,lead.pipeline_key,
    trim(title_zh),trim(title_en),amount,upper(currency),coalesce(next_owner,lead.owner_id),app_auth.current_user_id(),next_product,next_cohort,
    current_date+30,'联系线索主体确认需求与下一步','Contact the lead subject to confirm needs and next steps'
  ) returning * into result;
  insert into public.lead_conversions(
    workspace_id,lead_id,opportunity_id,evidence,idempotency_key,request_hash
  ) values(
    lead.workspace_id,lead.id,result.id,
    jsonb_build_object(
      'score',lead.qualification_score,'source',lead.source,
      'subjectType',lead.subject_type,'pipeline',lead.pipeline_key
    ),
    trim(p_idempotency_key),fingerprint
  );
  update public.leads set status='CONVERTED',converted_at=now(),updated_at=now(),revision=revision+1
  where id=lead.id;
  insert into public.audit_events(workspace_id,actor_id,action,entity_type,entity_id,after_data) values(lead.workspace_id,app_auth.current_user_id(),'LEAD_CONVERTED','LEAD',lead.id,jsonb_build_object('opportunityId',result.id,'productId',next_product,'cohortId',next_cohort));
  return result;
end;
$$;
revoke all on function public.convert_lead_to_opportunity(uuid,text,text,numeric,text,text,uuid,uuid,uuid) from public,crm_system;
grant execute on function public.convert_lead_to_opportunity(uuid,text,text,numeric,text,text,uuid,uuid,uuid) to crm_app;

insert into public.data_quality_rule_configs(workspace_id,rule_key,severity) select w.id,k,'MEDIUM' from public.workspaces w cross join unnest(array['CLAIMED_LEAD_WITHOUT_NEXT_ACTION','QUALIFYING_SCHOOL_LEAD_WITHOUT_KEY_CONTACT','QUALIFIED_SCHOOL_LEAD_WITHOUT_ORGANIZATION_OWNER','RECRUITMENT_ACTIVATED_WITHOUT_KEY_CONTACT','SOLUTION_PROPOSED_WITHOUT_OPPORTUNITY']) k on conflict do nothing;
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

update public.data_quality_issues issue set status='RESOLVED',resolution_note='AUTO_RESOLVED',resolved_at=now(),resolved_by=app_auth.current_user_id()
  where issue.workspace_id=ws and issue.status in ('OPEN','ASSIGNED') and issue.last_seen_at<marker
    and issue.rule_key in (select rule_key from public.data_quality_rule_configs where workspace_id=ws);
  select count(*) into affected from public.data_quality_issues where workspace_id=ws and status in ('OPEN','ASSIGNED');
  return affected;
end;
$$;

-- Future workspaces receive the same contextual rules as existing workspaces.
create function public.seed_channel_activation_quality_rules() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  insert into public.data_quality_rule_configs(workspace_id,rule_key,enabled,severity)
  select new.id,k,true,'MEDIUM' from unnest(array[
    'CLAIMED_LEAD_WITHOUT_NEXT_ACTION',
    'QUALIFYING_SCHOOL_LEAD_WITHOUT_KEY_CONTACT',
    'QUALIFIED_SCHOOL_LEAD_WITHOUT_ORGANIZATION_OWNER',
    'RECRUITMENT_ACTIVATED_WITHOUT_KEY_CONTACT',
    'SOLUTION_PROPOSED_WITHOUT_OPPORTUNITY'
  ]) k on conflict(workspace_id,rule_key) do nothing;
  return new;
end;
$$;
revoke all on function public.seed_channel_activation_quality_rules() from public,crm_app,crm_system;
create trigger seed_channel_activation_quality after insert on public.workspaces
  for each row execute function public.seed_channel_activation_quality_rules();
