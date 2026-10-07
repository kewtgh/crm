set search_path=public,extensions;

-- Recoverable deletion retains canonical lead identity and related Opportunity facts.
alter table public.leads add column archived_at timestamptz;
create index leads_archive_idx on public.leads(workspace_id,archived_at) where archived_at is not null;
alter function public.lead_record_access(jsonb,boolean) rename to lead_record_access_before114;
revoke all on function public.lead_record_access_before114(jsonb,boolean) from public,crm_app;
create function public.lead_record_access(record jsonb,edit boolean default false) returns boolean
language sql stable security definer set search_path=public,app_auth as $$
 select record->>'archived_at' is null and public.lead_record_access_before114(record,edit) $$;
revoke all on function public.lead_record_access(jsonb,boolean) from public;
grant execute on function public.lead_record_access(jsonb,boolean) to crm_app;
-- Replace policy to bind to the current guard (renamed functions retain old OIDs).
drop policy lead_scoped_read on public.leads;
create policy lead_scoped_read on public.leads for select to crm_app using(
 public.lead_record_access(to_jsonb(leads),false) or
 (workspace_id=public.current_workspace_id() and archived_at is not null
 and public.is_workspace_member(workspace_id) and public.current_crm_role()='SUPER_ADMIN'
 and coalesce(app_auth.current_claims()->>'aal','aal1')='aal2'));

-- Rebind the view to the current guard and exclude archived records even for recycle viewers.
do $rebind$ declare definition text; begin
 select pg_get_viewdef('public.lead_pool_records'::regclass,true) into definition;
 definition:=replace(definition,'lead_record_access_before114','lead_record_access');
 definition:=regexp_replace(definition,';\s*$','');
 execute 'create or replace view public.lead_pool_records with(security_invoker=true) as '||definition||' WHERE l.archived_at IS NULL';
end $rebind$;

create function public.archive_lead(target_lead uuid,expected_revision integer,p_request_key text) returns public.leads
language plpgsql security definer set search_path=public,app_auth,extensions as $$
declare ws uuid:=public.current_workspace_id();actor uuid:=app_auth.current_user_id();l public.leads;r public.mutation_receipts;fingerprint text;
begin
 if actor is null or not public.is_workspace_member(ws) or public.current_crm_role() not in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER','SALES_SPECIALIST') then raise exception 'lead_forbidden';end if;
 if coalesce(app_auth.current_claims()->>'aal','aal1')<>'aal2' then raise exception 'mfa_required';end if;
 if expected_revision is null or expected_revision<1 or length(coalesce(p_request_key,'')) not between 8 and 120 then raise exception 'lead_input_invalid';end if;
 perform pg_advisory_xact_lock(hashtextextended('lead-request:'||ws::text||p_request_key,0));
 fingerprint:=encode(digest(jsonb_build_object('id',target_lead,'revision',expected_revision)::text,'sha256'),'hex');
 select * into r from public.mutation_receipts where workspace_id=ws and request_key=p_request_key;
 if found then
 if r.operation<>'LEAD_ARCHIVE' or r.created_by is distinct from actor or r.result->>'request_hash' is distinct from fingerprint then raise exception 'lead_request_conflict';end if;
 return jsonb_populate_record(null::public.leads,r.result->'item');end if;
 select * into l from public.leads where id=target_lead and workspace_id=ws for update;
 if not found or not public.lead_record_access(to_jsonb(l),true) then raise exception 'lead_forbidden';end if;
 if l.revision<>expected_revision then raise exception 'lead_version_conflict';end if;
 update public.leads set archived_at=clock_timestamp(),updated_at=clock_timestamp(),revision=revision+1 where id=target_lead returning * into l;
 insert into public.audit_events(workspace_id,actor_id,action,entity_type,entity_id,after_data) values(ws,actor,'LEAD_ARCHIVED','LEAD',target_lead,jsonb_build_object('revision',l.revision));
 insert into public.mutation_receipts(workspace_id,request_key,operation,result,created_by) values(ws,p_request_key,'LEAD_ARCHIVE',jsonb_build_object('request_hash',fingerprint,'item',to_jsonb(l)),actor);
 return l;
end $$;
revoke all on function public.archive_lead(uuid,integer,text) from public,crm_system;
grant execute on function public.archive_lead(uuid,integer,text) to crm_app;

alter function public.restore_crm_recycle_bin(text,uuid) rename to restore_crm_recycle_bin_before114;
revoke all on function public.restore_crm_recycle_bin_before114(text,uuid) from public,crm_app,crm_system;
create function public.restore_crm_recycle_bin(entity_kind text,entity_id uuid) returns boolean
language plpgsql security definer set search_path=public,app_auth as $$
begin
 if upper(trim(entity_kind))<>'LEAD' then return public.restore_crm_recycle_bin_before114(entity_kind,entity_id);end if;
 if app_auth.current_user_id() is null or public.current_crm_role()<>'SUPER_ADMIN' then raise exception 'super_admin_required';end if;
 if coalesce(app_auth.current_claims()->>'aal','aal1')<>'aal2' then raise exception 'mfa_required';end if;
 update public.leads set archived_at=null,updated_at=clock_timestamp(),revision=revision+1 where id=entity_id and workspace_id=public.current_workspace_id() and archived_at is not null;
 if not found then raise exception 'recycle_entity_not_found';end if;
 insert into public.audit_events(workspace_id,actor_id,action,entity_type,entity_id) values(public.current_workspace_id(),app_auth.current_user_id(),'LEAD_RESTORED','LEAD',entity_id);
 return true;
end $$;
revoke all on function public.restore_crm_recycle_bin(text,uuid) from public,crm_system;
grant execute on function public.restore_crm_recycle_bin(text,uuid) to crm_app;

alter function public.purge_expired_crm_recycle_bin() rename to purge_expired_crm_recycle_bin_before114;
revoke all on function public.purge_expired_crm_recycle_bin_before114() from public,crm_app,crm_system,crm_worker;
create function public.purge_expired_crm_recycle_bin() returns integer
language plpgsql security definer set search_path=public,app_auth as $$
declare removed integer:=0;affected integer;candidate uuid;
begin
 if app_auth.current_db_role()<>'service_role' then raise exception 'service_role_required';end if;
 for candidate in select id from public.leads where archived_at<now()-interval '30 days' for update skip locked loop
 begin
 delete from public.leads l where id=candidate and not exists(select 1 from public.lead_conversions c where c.lead_id=l.id);
 get diagnostics affected=row_count;removed:=removed+affected;
 exception when foreign_key_violation then null;end;
 end loop;
 return removed+public.purge_expired_crm_recycle_bin_before114();
end $$;
revoke all on function public.purge_expired_crm_recycle_bin() from public,crm_app;
grant execute on function public.purge_expired_crm_recycle_bin() to crm_system,crm_worker;

-- Filter before paging/counting; keep the original four-argument deep-link contract.
create function public.list_student_family_page(search_query text,page_number integer,page_size integer,status_filter text,grade_filter text,year_filter text)
returns table(id uuid,person_id uuid,student_number text,current_grade text,academic_year text,status text,updated_at timestamptz,name_zh text,name_en text,household_name_zh text,household_name_en text,total_count bigint,family_members jsonb)
language sql stable security invoker set search_path=public,app_auth,extensions as $$
 with visible as (
 select s.*,c.name_zh,c.name_en,h.name_zh household_name_zh,h.name_en household_name_en,
 coalesce((select jsonb_agg(jsonb_build_object('contactId',f.contact_id,'relationship',f.relationship,'nameZh',p.name_zh,'nameEn',p.name_en) order by f.contact_id)
 from (
 select g.guardian_contact_id contact_id,g.relationship_type relationship from public.student_guardian_relationships g where g.student_id=s.id and g.workspace_id=s.workspace_id
 union all
 select m.contact_id,m.member_role from public.household_members m where m.household_id=s.household_id and m.workspace_id=s.workspace_id and m.contact_id<>s.person_id
 and not exists(select 1 from public.student_guardian_relationships g where g.student_id=s.id and g.workspace_id=s.workspace_id and g.guardian_contact_id=m.contact_id)
 ) f join public.contacts p on p.id=f.contact_id and p.workspace_id=s.workspace_id),'[]'::jsonb) family_members
 from public.students s join public.contacts c on c.id=s.person_id and c.workspace_id=s.workspace_id
 left join public.households h on h.id=s.household_id and h.workspace_id=s.workspace_id
 where s.archived_at is null and s.workspace_id=public.current_workspace_id() and (nullif(grade_filter,'') is null or s.current_grade=grade_filter) and (nullif(year_filter,'') is null or s.academic_year=year_filter) and (coalesce(status_filter,'all')='all' or s.status=status_filter)
 ),matched as (select * from visible v where nullif(trim(search_query),'') is null
 or strpos(lower(v.name_zh),lower(trim(search_query)))>0 or strpos(lower(v.name_en),lower(trim(search_query)))>0
 or strpos(lower(coalesce(v.student_number,'')),lower(trim(search_query)))>0
 or exists(select 1 from jsonb_array_elements(v.family_members) f where strpos(lower(f->>'nameZh'),lower(trim(search_query)))>0 or strpos(lower(f->>'nameEn'),lower(trim(search_query)))>0))
 select m.id,m.person_id,m.student_number,m.current_grade,m.academic_year,m.status,m.updated_at,m.name_zh,m.name_en,m.household_name_zh,m.household_name_en,count(*) over(),m.family_members
 from matched m order by m.updated_at desc,m.id limit least(greatest(page_size,1),50) offset (greatest(page_number,1)-1)*least(greatest(page_size,1),50);
$$;
revoke all on function public.list_student_family_page(text,integer,integer,text,text,text) from public,crm_worker;
grant execute on function public.list_student_family_page(text,integer,integer,text,text,text) to crm_app;


create or replace function public.list_student_family_page(search_query text,page_number integer,page_size integer,status_filter text)
returns table(id uuid,person_id uuid,student_number text,current_grade text,academic_year text,status text,updated_at timestamptz,name_zh text,name_en text,household_name_zh text,household_name_en text,total_count bigint,family_members jsonb)
language sql stable security invoker set search_path=public,app_auth,extensions as $$
 select * from public.list_student_family_page(search_query,page_number,page_size,status_filter,null,null);
$$;

-- Shared deletion infrastructure; each resource retains its canonical edit authority.
create function public.deletion_resource_table(kind text) returns text language sql immutable as $$select case kind
 when 'ORGANIZATION' then 'organizations'
 when 'CONTACT' then 'contacts'
 when 'STUDENT' then 'students'
 when 'HOUSEHOLD' then 'households'
 when 'TASK' then 'crm_tasks'
 when 'PRODUCT' then 'products'
 when 'LEAD' then 'leads'
 when 'OPPORTUNITY' then 'opportunities'
 when 'CONTRACT' then 'contracts'
 when 'ENROLLMENT' then 'student_enrollments'
 when 'APPLICATION' then 'student_applications'
 when 'SUPPORT_CASE' then 'student_success_cases'
 when 'SUPPORT_GOAL' then 'student_success_goals'
 when 'SUPPORT_CHECKIN' then 'student_success_checkins'
 when 'SUPPORT_RISK' then 'student_success_risk_signals'
 when 'SUPPORT_INTERVENTION' then 'student_success_interventions'
 when 'ORGANIZATION_PROFILE' then 'organization_business_profiles'
 when 'FAMILY_NEED' then 'family_education_needs'
 when 'PATHWAY' then 'student_pathways'
 when 'OUTREACH_EVENT' then 'education_outreach_events'
 when 'REFERRAL' then 'education_family_referrals'
 when 'EVENT_PARTICIPATION' then 'education_event_participations'
 when 'ACADEMIC_RECORD' then 'student_academic_records'
 when 'COHORT' then 'product_cohorts'
 when 'BUNDLE' then 'product_bundles'
 when 'QUOTE' then 'quotes'
 when 'CAMPAIGN' then 'growth_campaigns'
 when 'ADMISSION_JOURNEY' then 'admission_journeys'
 when 'MILESTONE' then 'admission_milestones'
 when 'WORKFLOW_TEMPLATE' then 'workflow_templates'
 when 'APPOINTMENT' then 'appointments'
 when 'EXCHANGE_RATE' then 'exchange_rate_snapshots'
 when 'ADMISSION_OUTCOME' then 'organization_admission_outcomes'
 when 'CONTACT_INTELLIGENCE' then 'organization_contact_intelligence'
 when 'CONTACT_RELATIONSHIP' then 'organization_contact_relationships'
 when 'FOLLOWUP_PLAN' then 'customer_follow_up_plans'
 when 'FOLLOWUP_ENTRY' then 'customer_follow_up_entries'
 when 'ACTIVITY' then 'crm_activities'
 when 'IMPORT_BATCH' then 'import_batches'
 when 'IMPORT_MAPPING' then 'import_mapping_profiles'
 when 'IMPORT_SET' then 'import_sets'
 when 'PRODUCT_PRICE' then 'product_prices'
 when 'CHANNEL_AGREEMENT' then 'channel_agreements'
 when 'CHANNEL_AGREEMENT_VERSION' then 'channel_agreement_versions' else null end$$;
revoke all on function public.deletion_resource_table(text) from public;grant execute on function public.deletion_resource_table(text) to crm_app;
create function public.business_record_delete_access(kind text,r jsonb) returns boolean
language sql stable security definer set search_path=public,app_auth as $$select coalesce(app_auth.current_user_id() is not null and r->>'workspace_id'=public.current_workspace_id()::text and public.is_workspace_member(public.current_workspace_id()) and case kind
 when 'ORGANIZATION' then (public.customer_subject_access('ORGANIZATION',(r->>'id')::uuid,true))
 when 'CONTACT' then (public.customer_subject_access('CONTACT',(r->>'id')::uuid,true))
 when 'STUDENT' then (public.education_business_student_access((r->>'id')::uuid,true))
 when 'HOUSEHOLD' then (public.customer_subject_access('HOUSEHOLD',(r->>'id')::uuid,true))
 when 'TASK' then (public.can_access_owned_record(public.current_workspace_id(),'TASK',(r->>'id')::uuid,(r->>'owner_id')::uuid,true))
 when 'PRODUCT' then (public.current_crm_role() in ('SUPER_ADMIN','ADMIN'))
 when 'LEAD' then (public.lead_record_access(r,true))
 when 'OPPORTUNITY' then (public.current_crm_role() in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER','SALES_SPECIALIST') and public.can_access_owned_record(public.current_workspace_id(),'OPPORTUNITY',(r->>'id')::uuid,(r->>'owner_id')::uuid,true))
 when 'CONTRACT' then (public.current_crm_role() in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER','SALES_SPECIALIST') and public.can_access_owned_record(public.current_workspace_id(),'CONTRACT',(r->>'id')::uuid,(r->>'owner_id')::uuid,true))
 when 'ENROLLMENT' then (public.student_enrollment_access(r,true))
 when 'APPLICATION' then (public.student_application_access(r,true))
 when 'SUPPORT_CASE' then (public.student_success_case_access(r,true))
 when 'SUPPORT_GOAL' then (public.student_success_parent_access((r->>'case_id')::uuid,true))
 when 'SUPPORT_CHECKIN' then (public.student_success_parent_access((r->>'case_id')::uuid,true))
 when 'SUPPORT_RISK' then (public.student_success_parent_access((r->>'case_id')::uuid,true))
 when 'SUPPORT_INTERVENTION' then (public.student_success_parent_access((r->>'case_id')::uuid,true))
 when 'ORGANIZATION_PROFILE' then (public.education_business_access('organizations',r,true))
 when 'FAMILY_NEED' then (public.education_business_access('needs',r,true))
 when 'PATHWAY' then (public.education_business_access('pathways',r,true))
 when 'OUTREACH_EVENT' then (public.education_business_access('events',r,true))
 when 'REFERRAL' then (public.education_business_access('referrals',r,true))
 when 'EVENT_PARTICIPATION' then (public.education_business_access('participations',r,true))
 when 'ACADEMIC_RECORD' then (public.education_business_student_access((r->>'student_id')::uuid,true))
 when 'COHORT' then (public.current_crm_role() in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR'))
 when 'BUNDLE' then (public.current_crm_role() in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR'))
 when 'QUOTE' then (public.current_crm_role() in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER','SALES_SPECIALIST') and public.can_access_owned_record(public.current_workspace_id(),'QUOTE',(r->>'id')::uuid,(r->>'owner_id')::uuid,true))
 when 'CAMPAIGN' then (public.current_crm_role() in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER'))
 when 'ADMISSION_JOURNEY' then (public.current_crm_role() in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER') or (public.current_crm_role()='SALES_SPECIALIST' and r->>'owner_id'=app_auth.current_user_id()::text))
 when 'MILESTONE' then (public.admission_milestone_access(r,true))
 when 'WORKFLOW_TEMPLATE' then (public.workflow_template_access(r,true))
 when 'APPOINTMENT' then (public.can_access_owned_record(public.current_workspace_id(),'APPOINTMENT',(r->>'id')::uuid,(r->>'owner_id')::uuid,true))
 when 'EXCHANGE_RATE' then (public.current_crm_role() in ('SUPER_ADMIN','ADMIN'))
 when 'ADMISSION_OUTCOME' then (public.customer_subject_access('ORGANIZATION',(r->>'organization_id')::uuid,true))
 when 'CONTACT_INTELLIGENCE' then (public.customer_subject_access('ORGANIZATION',(r->>'organization_id')::uuid,true) and public.customer_subject_access('CONTACT',(r->>'contact_id')::uuid,true))
 when 'CONTACT_RELATIONSHIP' then (public.customer_subject_access('ORGANIZATION',(r->>'organization_id')::uuid,true) and public.customer_subject_access('CONTACT',(r->>'source_contact_id')::uuid,true) and public.customer_subject_access('CONTACT',(r->>'target_contact_id')::uuid,false))
 when 'FOLLOWUP_PLAN' then (public.customer_subject_access(r->>'subject_kind',(r->>'subject_id')::uuid,true))
 when 'FOLLOWUP_ENTRY' then (public.customer_subject_access(r->>'subject_kind',(r->>'subject_id')::uuid,true))
 when 'ACTIVITY' then (public.current_crm_role() in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER') or (r->>'owner_id'=app_auth.current_user_id()::text and public.current_crm_role() in ('SALES_SPECIALIST','SALES_SUPPORT')))
 when 'IMPORT_BATCH' then (public.current_crm_role() in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER'))
 when 'IMPORT_MAPPING' then (public.current_crm_role() in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER'))
 when 'IMPORT_SET' then (public.current_crm_role() in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER') and r->>'created_by'=app_auth.current_user_id()::text)
 when 'PRODUCT_PRICE' then (public.current_crm_role() in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR'))
 when 'CHANNEL_AGREEMENT' then public.channel_commercial_access((r->>'organization_id')::uuid,true)
 when 'CHANNEL_AGREEMENT_VERSION' then exists(select 1 from public.channel_agreements a where a.id=(r->>'agreement_id')::uuid and to_jsonb(a)->>'archived_at' is null and public.channel_commercial_access(a.organization_id,true)) else false end,false)$$;
revoke all on function public.business_record_delete_access(text,jsonb) from public;grant execute on function public.business_record_delete_access(text,jsonb) to crm_app;
create function public.business_record_delete_block(kind text,r jsonb) returns text
language plpgsql stable security invoker set search_path=public,app_auth as $$begin
 if kind in ('IMPORT_BATCH','IMPORT_SET') and r->>'status' in ('COMPLETED','EXECUTING','APPLYING','RUNNING','PROCESSING','ROLLING_BACK') then return 'PROTECTED_STATE';end if;
 if kind='CHANNEL_AGREEMENT_VERSION' and (r->>'status'<>'DRAFT' or exists(select 1 from public.commission_accruals where agreement_version_id=(r->>'id')::uuid)) then return 'PROTECTED_STATE';end if;
 if kind='CHANNEL_AGREEMENT' and exists(select 1 from public.channel_agreement_versions where agreement_id=(r->>'id')::uuid and archived_at is null) then return 'REFERENCED';end if;
 if kind='ENROLLMENT' and exists(select 1 from public.commission_accruals where enrollment_id=(r->>'id')::uuid) then return 'REFERENCED';end if;
 if kind='QUOTE' and r->>'status' not in ('DRAFT','REJECTED','EXPIRED') then return 'PROTECTED_STATE';end if;
 if kind='APPOINTMENT' and r->>'status'<>'CANCELLED' then return 'PROTECTED_STATE';end if;
 if kind='WORKFLOW_TEMPLATE' and (r->>'status'='ACTIVE' or exists(select 1 from public.workflow_instances where template_id=(r->>'id')::uuid)) then return 'REFERENCED';end if;
 if kind='CONTRACT' and (r->>'status'<>'DRAFT' or r->>'signed_at' is not null) then return 'PROTECTED_STATE';end if;
 if kind='CONTRACT' and (exists(select 1 from public.contract_enrollment_links where contract_id=(r->>'id')::uuid and status='ACTIVE') or exists(select 1 from public.payments where contract_id=(r->>'id')::uuid)) then return 'REFERENCED';end if;
 if kind='ENROLLMENT' and (exists(select 1 from public.contract_enrollment_links where enrollment_id=(r->>'id')::uuid and status='ACTIVE') or exists(select 1 from public.student_applications where enrollment_id=(r->>'id')::uuid and archived_at is null) or exists(select 1 from public.student_success_cases where enrollment_id=(r->>'id')::uuid and archived_at is null)) then return 'REFERENCED';end if;
 if kind='COHORT' and exists(select 1 from public.student_enrollments where cohort_id=(r->>'id')::uuid and archived_at is null) then return 'REFERENCED';end if;
 return null;
end $$;
revoke all on function public.business_record_delete_block(text,jsonb) from public;grant execute on function public.business_record_delete_block(text,jsonb) to crm_app;
create function public.guard_archived_business_record() returns trigger language plpgsql as $$begin
 if old.archived_at is not null and new.archived_at is not null then raise exception 'business_record_deleted';end if;
 if to_jsonb(new) ? 'updated_at' and not (to_jsonb(new) ? 'revision') then
 new:=jsonb_populate_record(new,jsonb_build_object('updated_at',clock_timestamp()));end if;
 return new;end$$;
revoke all on function public.guard_archived_business_record() from public;
alter table public.opportunities add column archived_at timestamptz;
create policy undeleted_business_record on public.opportunities as restrictive for all to crm_app using(archived_at is null) with check(archived_at is null);
create trigger guard_archived_business_record before update on public.opportunities for each row execute function public.guard_archived_business_record();
alter table public.contracts add column archived_at timestamptz;
create policy undeleted_business_record on public.contracts as restrictive for all to crm_app using(archived_at is null) with check(archived_at is null);
create trigger guard_archived_business_record before update on public.contracts for each row execute function public.guard_archived_business_record();
alter table public.student_enrollments add column archived_at timestamptz;
create policy undeleted_business_record on public.student_enrollments as restrictive for all to crm_app using(archived_at is null) with check(archived_at is null);
create trigger guard_archived_business_record before update on public.student_enrollments for each row execute function public.guard_archived_business_record();
alter table public.student_applications add column archived_at timestamptz;
create policy undeleted_business_record on public.student_applications as restrictive for all to crm_app using(archived_at is null) with check(archived_at is null);
create trigger guard_archived_business_record before update on public.student_applications for each row execute function public.guard_archived_business_record();
alter table public.student_success_cases add column archived_at timestamptz;
create policy undeleted_business_record on public.student_success_cases as restrictive for all to crm_app using(archived_at is null) with check(archived_at is null);
create trigger guard_archived_business_record before update on public.student_success_cases for each row execute function public.guard_archived_business_record();
alter table public.student_success_goals add column archived_at timestamptz;
create policy undeleted_business_record on public.student_success_goals as restrictive for all to crm_app using(archived_at is null) with check(archived_at is null);
create trigger guard_archived_business_record before update on public.student_success_goals for each row execute function public.guard_archived_business_record();
alter table public.student_success_checkins add column archived_at timestamptz;
create policy undeleted_business_record on public.student_success_checkins as restrictive for all to crm_app using(archived_at is null) with check(archived_at is null);
create trigger guard_archived_business_record before update on public.student_success_checkins for each row execute function public.guard_archived_business_record();
alter table public.student_success_risk_signals add column archived_at timestamptz;
create policy undeleted_business_record on public.student_success_risk_signals as restrictive for all to crm_app using(archived_at is null) with check(archived_at is null);
create trigger guard_archived_business_record before update on public.student_success_risk_signals for each row execute function public.guard_archived_business_record();
alter table public.student_success_interventions add column archived_at timestamptz;
create policy undeleted_business_record on public.student_success_interventions as restrictive for all to crm_app using(archived_at is null) with check(archived_at is null);
create trigger guard_archived_business_record before update on public.student_success_interventions for each row execute function public.guard_archived_business_record();
alter table public.organization_business_profiles add column archived_at timestamptz;
create policy undeleted_business_record on public.organization_business_profiles as restrictive for all to crm_app using(archived_at is null) with check(archived_at is null);
create trigger guard_archived_business_record before update on public.organization_business_profiles for each row execute function public.guard_archived_business_record();
alter table public.family_education_needs add column archived_at timestamptz;
create policy undeleted_business_record on public.family_education_needs as restrictive for all to crm_app using(archived_at is null) with check(archived_at is null);
create trigger guard_archived_business_record before update on public.family_education_needs for each row execute function public.guard_archived_business_record();
alter table public.student_pathways add column archived_at timestamptz;
create policy undeleted_business_record on public.student_pathways as restrictive for all to crm_app using(archived_at is null) with check(archived_at is null);
create trigger guard_archived_business_record before update on public.student_pathways for each row execute function public.guard_archived_business_record();
alter table public.education_outreach_events add column archived_at timestamptz;
create policy undeleted_business_record on public.education_outreach_events as restrictive for all to crm_app using(archived_at is null) with check(archived_at is null);
create trigger guard_archived_business_record before update on public.education_outreach_events for each row execute function public.guard_archived_business_record();
alter table public.education_family_referrals add column archived_at timestamptz;
create policy undeleted_business_record on public.education_family_referrals as restrictive for all to crm_app using(archived_at is null) with check(archived_at is null);
create trigger guard_archived_business_record before update on public.education_family_referrals for each row execute function public.guard_archived_business_record();
alter table public.education_event_participations add column archived_at timestamptz;
create policy undeleted_business_record on public.education_event_participations as restrictive for all to crm_app using(archived_at is null) with check(archived_at is null);
create trigger guard_archived_business_record before update on public.education_event_participations for each row execute function public.guard_archived_business_record();
alter table public.student_academic_records add column archived_at timestamptz;
create policy undeleted_business_record on public.student_academic_records as restrictive for all to crm_app using(archived_at is null) with check(archived_at is null);
create trigger guard_archived_business_record before update on public.student_academic_records for each row execute function public.guard_archived_business_record();
alter table public.product_cohorts add column archived_at timestamptz;
create policy undeleted_business_record on public.product_cohorts as restrictive for all to crm_app using(archived_at is null) with check(archived_at is null);
create trigger guard_archived_business_record before update on public.product_cohorts for each row execute function public.guard_archived_business_record();
alter table public.product_bundles add column archived_at timestamptz;
create policy undeleted_business_record on public.product_bundles as restrictive for all to crm_app using(archived_at is null) with check(archived_at is null);
create trigger guard_archived_business_record before update on public.product_bundles for each row execute function public.guard_archived_business_record();

alter table public.quotes add column archived_at timestamptz;
create policy undeleted_business_record on public.quotes as restrictive for all to crm_app using(archived_at is null) with check(archived_at is null);
create trigger guard_archived_business_record before update on public.quotes for each row execute function public.guard_archived_business_record();
alter table public.growth_campaigns add column archived_at timestamptz;
create policy undeleted_business_record on public.growth_campaigns as restrictive for all to crm_app using(archived_at is null) with check(archived_at is null);
create trigger guard_archived_business_record before update on public.growth_campaigns for each row execute function public.guard_archived_business_record();
alter table public.admission_journeys add column archived_at timestamptz;
create policy undeleted_business_record on public.admission_journeys as restrictive for all to crm_app using(archived_at is null) with check(archived_at is null);
create trigger guard_archived_business_record before update on public.admission_journeys for each row execute function public.guard_archived_business_record();
alter table public.admission_milestones add column archived_at timestamptz;
create policy undeleted_business_record on public.admission_milestones as restrictive for all to crm_app using(archived_at is null) with check(archived_at is null);
create trigger guard_archived_business_record before update on public.admission_milestones for each row execute function public.guard_archived_business_record();
alter table public.workflow_templates add column archived_at timestamptz;
create policy undeleted_business_record on public.workflow_templates as restrictive for all to crm_app using(archived_at is null) with check(archived_at is null);
create trigger guard_archived_business_record before update on public.workflow_templates for each row execute function public.guard_archived_business_record();
alter table public.appointments add column archived_at timestamptz;
create policy undeleted_business_record on public.appointments as restrictive for all to crm_app using(archived_at is null) with check(archived_at is null);
create trigger guard_archived_business_record before update on public.appointments for each row execute function public.guard_archived_business_record();
alter table public.exchange_rate_snapshots add column archived_at timestamptz;
create policy undeleted_business_record on public.exchange_rate_snapshots as restrictive for all to crm_app using(archived_at is null) with check(archived_at is null);
create trigger guard_archived_business_record before update on public.exchange_rate_snapshots for each row execute function public.guard_archived_business_record();

alter table public.organization_admission_outcomes add column archived_at timestamptz;
create policy undeleted_business_record on public.organization_admission_outcomes as restrictive for all to crm_app using(archived_at is null) with check(archived_at is null);
create trigger guard_archived_business_record before update on public.organization_admission_outcomes for each row execute function public.guard_archived_business_record();
alter table public.organization_contact_intelligence add column archived_at timestamptz;
create policy undeleted_business_record on public.organization_contact_intelligence as restrictive for all to crm_app using(archived_at is null) with check(archived_at is null);
create trigger guard_archived_business_record before update on public.organization_contact_intelligence for each row execute function public.guard_archived_business_record();
alter table public.organization_contact_relationships add column archived_at timestamptz;
create policy undeleted_business_record on public.organization_contact_relationships as restrictive for all to crm_app using(archived_at is null) with check(archived_at is null);
create trigger guard_archived_business_record before update on public.organization_contact_relationships for each row execute function public.guard_archived_business_record();
alter table public.customer_follow_up_plans add column archived_at timestamptz;
create policy undeleted_business_record on public.customer_follow_up_plans as restrictive for all to crm_app using(archived_at is null) with check(archived_at is null);
create trigger guard_archived_business_record before update on public.customer_follow_up_plans for each row execute function public.guard_archived_business_record();
alter table public.customer_follow_up_entries add column archived_at timestamptz;
create policy undeleted_business_record on public.customer_follow_up_entries as restrictive for all to crm_app using(archived_at is null) with check(archived_at is null);
create trigger guard_archived_business_record before update on public.customer_follow_up_entries for each row execute function public.guard_archived_business_record();
alter table public.crm_activities add column archived_at timestamptz;
create policy undeleted_business_record on public.crm_activities as restrictive for all to crm_app using(archived_at is null) with check(archived_at is null);
create trigger guard_archived_business_record before update on public.crm_activities for each row execute function public.guard_archived_business_record();
alter table public.import_batches add column archived_at timestamptz;
create policy undeleted_business_record on public.import_batches as restrictive for all to crm_app using(archived_at is null) with check(archived_at is null);
create trigger guard_archived_business_record before update on public.import_batches for each row execute function public.guard_archived_business_record();
alter table public.import_mapping_profiles add column archived_at timestamptz;
create policy undeleted_business_record on public.import_mapping_profiles as restrictive for all to crm_app using(archived_at is null) with check(archived_at is null);
create trigger guard_archived_business_record before update on public.import_mapping_profiles for each row execute function public.guard_archived_business_record();
alter table public.import_sets add column archived_at timestamptz;
create policy undeleted_business_record on public.import_sets as restrictive for all to crm_app using(archived_at is null) with check(archived_at is null);
create trigger guard_archived_business_record before update on public.import_sets for each row execute function public.guard_archived_business_record();

-- Price rows derive their tenant from the canonical Product, not a client-supplied tenant.
alter table public.product_prices add column workspace_id uuid;
update public.product_prices x set workspace_id=p.workspace_id from public.products p where p.id=x.product_id;
alter table public.product_prices alter column workspace_id set not null;
alter table public.product_prices alter column workspace_id set default public.current_workspace_id();
alter table public.product_prices add constraint product_price_workspace foreign key(workspace_id,product_id) references public.products(workspace_id,id);
alter table public.product_prices add column archived_at timestamptz;
create policy undeleted_business_record on public.product_prices as restrictive for all to crm_app using(archived_at is null) with check(archived_at is null);
create trigger guard_archived_business_record before update on public.product_prices for each row execute function public.guard_archived_business_record();
drop index public.product_prices_current_uidx;
create unique index product_prices_current_uidx on public.product_prices(product_id,currency) where effective_to is null and archived_at is null;

-- Resolve business labels through caller RLS, never an unrestricted identity lookup.
create function public.business_record_cleanup_label(kind text,r jsonb) returns text
language plpgsql stable security invoker set search_path=public,app_auth as $$
declare label text;subject uuid;begin
 label:=coalesce(nullif(r->>'name_zh',''),nullif(r->>'name_en',''),nullif(r->>'title',''),nullif(r->>'title_zh',''),nullif(r->>'name',''),nullif(r->>'contract_number',''),nullif(r->>'summary',''),nullif(r->>'label',''),nullif(r->>'code',''));
 if label is not null then return label;end if;
 if kind='STUDENT' then select coalesce(nullif(c.name_zh,''),c.name_en) into label from public.contacts c where c.id=(r->>'person_id')::uuid;
 elsif r->>'student_id' is not null then select coalesce(nullif(c.name_zh,''),c.name_en) into label from public.students s join public.contacts c on c.id=s.person_id where s.id=(r->>'student_id')::uuid;
 elsif r->>'case_id' is not null then select coalesce(nullif(c.name_zh,''),c.name_en) into label from public.student_success_cases sc join public.students s on s.id=sc.student_id join public.contacts c on c.id=s.person_id where sc.id=(r->>'case_id')::uuid;
 elsif r->>'product_id' is not null then select coalesce(nullif(p.name_zh,''),p.name_en) into label from public.products p where p.id=(r->>'product_id')::uuid;
 elsif r->>'organization_id' is not null or kind='ORGANIZATION_PROFILE' then subject:=coalesce((r->>'organization_id')::uuid,(r->>'id')::uuid); select coalesce(nullif(o.name_zh,''),o.name_en) into label from public.organizations o where o.id=subject;
 elsif r->>'household_id' is not null then select coalesce(nullif(h.name_zh,''),h.name_en) into label from public.households h where h.id=(r->>'household_id')::uuid;
 elsif kind='CHANNEL_AGREEMENT_VERSION' then select coalesce(nullif(a.name_zh,''),a.name_en)||' · '||coalesce(r->>'version','') into label from public.channel_agreements a where a.id=(r->>'agreement_id')::uuid;
 end if;
 if kind='PRODUCT_PRICE' and label is not null then label:=label||' · '||coalesce(r->>'currency','')||' '||coalesce(r->>'amount','');end if;
 return coalesce(nullif(label,''),nullif(r->>'student_number',''),nullif(r->>'filename',''),left(r->>'id',8));
end $$;
revoke all on function public.business_record_cleanup_label(text,jsonb) from public;grant execute on function public.business_record_cleanup_label(text,jsonb) to crm_app;

create function public.list_deletable_business_records(kind text,search_query text,page_number integer,page_size integer) returns jsonb
language plpgsql stable security invoker set search_path=public,app_auth as $$
declare table_name text:=public.deletion_resource_table(kind);result jsonb;begin
 if table_name is null then raise exception 'deletion_resource_invalid';end if;
 execute format($q$with visible as (select to_jsonb(x) r from public.%I x where workspace_id=public.current_workspace_id() and archived_at is null),matched as
 (select r,public.business_record_cleanup_label($4,r) label from visible),filtered as
 (select * from matched where coalesce($1,'')='' or strpos(lower(label),lower($1))>0 or strpos(r->>'id',$1)>0),paged as
 (select * from filtered order by r->>'updated_at' desc nulls last,r->>'id' limit $2 offset $3)
 select jsonb_build_object('total',(select count(*) from filtered),'items',coalesce(jsonb_agg(jsonb_build_object('id',r->>'id','label',label,'status',r->>'status','revision',(r->>'revision')::integer,'updatedAt',r->>'updated_at','canDelete',public.business_record_delete_access($4,r),'blockedReason',public.business_record_delete_block($4,r))),'[]'::jsonb)) from paged$q$,table_name)
 into result using left(search_query,100),least(greatest(page_size,1),50),(greatest(page_number,1)-1)*least(greatest(page_size,1),50),kind;
 return result;
end $$;
revoke all on function public.list_deletable_business_records(text,text,integer,integer) from public;grant execute on function public.list_deletable_business_records(text,text,integer,integer) to crm_app;

create function public.archive_business_record(kind text,record_id uuid,expected_revision integer,expected_updated_at timestamptz,p_request_key text) returns boolean
language plpgsql security definer set search_path=public,app_auth,extensions as $$
declare table_name text:=public.deletion_resource_table(kind);r jsonb;receipt public.mutation_receipts;ws uuid:=public.current_workspace_id();actor uuid:=app_auth.current_user_id();fingerprint text;extra text:='';begin
 if actor is null or not public.is_workspace_member(ws) then raise exception 'business_delete_forbidden';end if;
 if coalesce(app_auth.current_claims()->>'aal','aal1')<>'aal2' then raise exception 'mfa_required';end if;
 if table_name is null or length(coalesce(p_request_key,'')) not between 8 and 120 then raise exception 'deletion_input_invalid';end if;
 perform pg_advisory_xact_lock(hashtextextended('business-delete:'||ws||p_request_key,0));
 fingerprint:=encode(digest(jsonb_build_object('kind',kind,'id',record_id,'revision',expected_revision,'updatedAt',expected_updated_at)::text,'sha256'),'hex');
 select * into receipt from public.mutation_receipts where workspace_id=ws and request_key=p_request_key;
 if found then if receipt.operation<>'BUSINESS_ARCHIVE' or receipt.created_by is distinct from actor or receipt.result->>'request_hash' is distinct from fingerprint then raise exception 'deletion_request_conflict';end if;return true;end if;
 execute format('select to_jsonb(x) from public.%I x where id=$1 and workspace_id=$2 for update',table_name) into r using record_id,ws;
 if r is null or r->>'archived_at' is not null or not public.business_record_delete_access(kind,r) then raise exception 'business_delete_forbidden';end if;
 if public.business_record_delete_block(kind,r) is not null then raise exception 'business_delete_referenced';end if;
 if r ? 'revision' then if expected_revision is null or (r->>'revision')::integer<>expected_revision then raise exception 'business_delete_version_conflict';end if;extra:=',revision=revision+1';
 elsif r ? 'updated_at' then if expected_updated_at is null or (r->>'updated_at')::timestamptz<>expected_updated_at then raise exception 'business_delete_version_conflict';end if;
 else raise exception 'business_delete_token_required';end if;
 if r ? 'updated_at' then extra:=extra||',updated_at=clock_timestamp()';end if;
 if kind in ('STUDENT','HOUSEHOLD') then extra:=extra||',status=''ARCHIVED''';end if;
 if kind='PRODUCT' then extra:=extra||',active=false,is_default=false';end if;
 execute format('update public.%I set archived_at=clock_timestamp()%s where id=$1 and workspace_id=$2',table_name,extra) using record_id,ws;
 insert into public.audit_events(workspace_id,actor_id,action,entity_type,entity_id) values(ws,actor,'RECORD_ARCHIVED',kind,record_id);
 insert into public.mutation_receipts(workspace_id,request_key,operation,result,created_by) values(ws,p_request_key,'BUSINESS_ARCHIVE',jsonb_build_object('request_hash',fingerprint,'kind',kind,'id',record_id),actor);
 return true;
end $$;
revoke all on function public.archive_business_record(text,uuid,integer,timestamptz,text) from public,crm_system;grant execute on function public.archive_business_record(text,uuid,integer,timestamptz,text) to crm_app;

alter function public.restore_crm_recycle_bin(text,uuid) rename to restore_crm_recycle_bin_leads114;
revoke all on function public.restore_crm_recycle_bin_leads114(text,uuid) from public,crm_app;
create function public.restore_crm_recycle_bin(entity_kind text,entity_id uuid) returns boolean language plpgsql security definer set search_path=public,app_auth as $$
declare table_name text:=public.deletion_resource_table(entity_kind);r jsonb;extra text:='';begin
 if table_name is null or entity_kind in ('ORGANIZATION','CONTACT','STUDENT','HOUSEHOLD','TASK','PRODUCT','LEAD') then return public.restore_crm_recycle_bin_leads114(entity_kind,entity_id);end if;
 if app_auth.current_user_id() is null or public.current_crm_role()<>'SUPER_ADMIN' then raise exception 'super_admin_required';end if;
 if coalesce(app_auth.current_claims()->>'aal','aal1')<>'aal2' then raise exception 'mfa_required';end if;
 execute format('select to_jsonb(x) from public.%I x where id=$1 and workspace_id=$2 and archived_at is not null for update',table_name) into r using entity_id,public.current_workspace_id();
 if r is null then raise exception 'recycle_entity_not_found';end if;
 if r ? 'revision' then extra:=',revision=revision+1';end if;if r ? 'updated_at' then extra:=extra||',updated_at=clock_timestamp()';end if;
 execute format('update public.%I set archived_at=null%s where id=$1 and workspace_id=$2',table_name,extra) using entity_id,public.current_workspace_id();
 insert into public.audit_events(workspace_id,actor_id,action,entity_type,entity_id) values(public.current_workspace_id(),app_auth.current_user_id(),'RECORD_RESTORED',entity_kind,entity_id);return true;
end $$;
revoke all on function public.restore_crm_recycle_bin(text,uuid) from public,crm_system;grant execute on function public.restore_crm_recycle_bin(text,uuid) to crm_app;
create function public.list_deleted_business_records() returns jsonb language plpgsql stable security definer set search_path=public,app_auth as $$
declare pair text[];result jsonb:='[]';items jsonb;begin
 if public.current_crm_role()<>'SUPER_ADMIN' or app_auth.current_user_id() is null then raise exception 'super_admin_required';end if;
 if coalesce(app_auth.current_claims()->>'aal','aal1')<>'aal2' then raise exception 'mfa_required';end if;
 foreach pair slice 1 in array array[['OPPORTUNITY','opportunities'],['CONTRACT','contracts'],['ENROLLMENT','student_enrollments'],['APPLICATION','student_applications'],['SUPPORT_CASE','student_success_cases'],['SUPPORT_GOAL','student_success_goals'],['SUPPORT_CHECKIN','student_success_checkins'],['SUPPORT_RISK','student_success_risk_signals'],['SUPPORT_INTERVENTION','student_success_interventions'],['ORGANIZATION_PROFILE','organization_business_profiles'],['FAMILY_NEED','family_education_needs'],['PATHWAY','student_pathways'],['OUTREACH_EVENT','education_outreach_events'],['REFERRAL','education_family_referrals'],['EVENT_PARTICIPATION','education_event_participations'],['ACADEMIC_RECORD','student_academic_records'],['COHORT','product_cohorts'],['BUNDLE','product_bundles'],['QUOTE','quotes'],['CAMPAIGN','growth_campaigns'],['ADMISSION_JOURNEY','admission_journeys'],['MILESTONE','admission_milestones'],['WORKFLOW_TEMPLATE','workflow_templates'],['APPOINTMENT','appointments'],['EXCHANGE_RATE','exchange_rate_snapshots'],['ADMISSION_OUTCOME','organization_admission_outcomes'],['CONTACT_INTELLIGENCE','organization_contact_intelligence'],['CONTACT_RELATIONSHIP','organization_contact_relationships'],['FOLLOWUP_PLAN','customer_follow_up_plans'],['FOLLOWUP_ENTRY','customer_follow_up_entries'],['ACTIVITY','crm_activities'],['IMPORT_BATCH','import_batches'],['IMPORT_MAPPING','import_mapping_profiles'],['IMPORT_SET','import_sets'],['PRODUCT_PRICE','product_prices'],['CHANNEL_AGREEMENT','channel_agreements'],['CHANNEL_AGREEMENT_VERSION','channel_agreement_versions']] loop
 execute format($q$select coalesce(jsonb_agg(jsonb_build_object('id',r->>'id','kind',$1,'labelZh',coalesce(r->>'name_zh',r->>'name',r->>'title',r->>'contract_number',r->>'id'),'labelEn',coalesce(r->>'name_en',r->>'name',r->>'title',r->>'contract_number',r->>'id'),'deletedAt',r->>'archived_at','expiresAt',null)),'[]') from (select to_jsonb(x) r from public.%I x where workspace_id=$2 and archived_at is not null order by archived_at desc limit 100) s$q$,pair[2]) into items using pair[1],public.current_workspace_id();result:=result||items;
 end loop;return result;
end $$;
revoke all on function public.list_deleted_business_records() from public,crm_system;grant execute on function public.list_deleted_business_records() to crm_app;

-- Exclude system lifecycle fields from the existing strict profile payload.
create or replace function public.update_channel_partnership_stage(target_organization uuid,expected_revision integer,next_stage text,reason text,p_request_key text) returns jsonb
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
 data:=to_jsonb(p)-array['workspace_id','revision','created_by','created_at','updated_at','archived_at'];
 data:=data||jsonb_build_object('partnership_stage',next_stage);
 perform set_config('app.channel_stage_reason',reason,true);
 result:=public.save_education_business('organizations',target_organization,expected_revision,data);
 perform set_config('app.channel_stage_reason','',true);
 insert into public.mutation_receipts(workspace_id,request_key,operation,result,created_by) values(ws,p_request_key,'CHANNEL_STAGE',jsonb_build_object('request_hash',fingerprint,'item',result),actor);return result;
end $$;
revoke all on function public.update_channel_partnership_stage(uuid,integer,text,text,text) from public,crm_system;
grant execute on function public.update_channel_partnership_stage(uuid,integer,text,text,text) to crm_app;


do $tokens$ declare tab text;begin
 foreach tab in array array['student_academic_records','student_success_checkins','product_bundles','exchange_rate_snapshots','admission_journeys','customer_follow_up_entries','crm_activities','import_sets','product_prices'] loop
 if not exists(select 1 from information_schema.columns where table_schema='public' and table_name=tab and column_name in ('revision','updated_at')) then
 execute format('alter table public.%I add column updated_at timestamptz not null default clock_timestamp()',tab);end if;end loop;
end $tokens$;

-- Deleted parents cannot authorize downstream mutations.
create or replace function public.student_enrollment_access(record jsonb,edit boolean default false) returns boolean
language plpgsql stable security definer set search_path=public,app_auth,extensions as $$
begin
 if record->>'archived_at' is not null then return false;end if;
  if app_auth.current_user_id() is null or record->>'workspace_id' is distinct from public.current_workspace_id()::text
    or not public.is_workspace_member(public.current_workspace_id()) then return false; end if;
  if edit and public.current_crm_role() not in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER','SALES_SPECIALIST','SALES_SUPPORT') then return false; end if;
  return public.education_business_student_access((record->>'student_id')::uuid,edit)
    and exists(select 1 from public.product_cohorts c where c.id=(record->>'cohort_id')::uuid and c.workspace_id=public.current_workspace_id())
    and (record->>'household_id' is null or public.customer_subject_access('HOUSEHOLD',(record->>'household_id')::uuid,false))
    and (record->>'opportunity_id' is null or exists(select 1 from public.opportunities o where o.id=(record->>'opportunity_id')::uuid
      and o.workspace_id=public.current_workspace_id() and public.can_access_owned_record(o.workspace_id,'OPPORTUNITY',o.id,o.owner_id,false)))
    and (public.can_access_owned_record(public.current_workspace_id(),'ENROLLMENT',(record->>'id')::uuid,(record->>'owner_id')::uuid,edit)
      or (record->>'sales_owner_id' is not null and public.can_access_owned_record(public.current_workspace_id(),'ENROLLMENT',(record->>'id')::uuid,(record->>'sales_owner_id')::uuid,edit)));
end $$;

-- Deleted parents cannot authorize downstream mutations.
create or replace function public.student_application_access(record jsonb,edit boolean default false) returns boolean
language plpgsql stable security definer set search_path=public,app_auth,extensions as $$
begin
 if record->>'archived_at' is not null then return false;end if;
 if app_auth.current_user_id() is null or record->>'workspace_id' is distinct from public.current_workspace_id()::text
  or not public.is_workspace_member(public.current_workspace_id()) then return false; end if;
 if edit and public.current_crm_role() not in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER','SALES_SPECIALIST','SALES_SUPPORT') then return false; end if;
 return exists(select 1 from public.student_enrollments e where e.id=(record->>'enrollment_id')::uuid and e.workspace_id=public.current_workspace_id()
  and public.student_enrollment_access(to_jsonb(e),edit))
  and (record->>'target_organization_id' is null or public.customer_subject_access('ORGANIZATION',(record->>'target_organization_id')::uuid,false))
  and (record->>'owner_id' is null or public.can_access_owned_record(public.current_workspace_id(),'APPLICATION',(record->>'id')::uuid,(record->>'owner_id')::uuid,edit));
end $$;

-- Deleted parents cannot authorize downstream mutations.
create or replace function public.student_success_case_access(record jsonb,edit boolean default false) returns boolean
language plpgsql stable security definer set search_path=public,app_auth,extensions as $$
begin
 if record->>'archived_at' is not null then return false;end if;
 if app_auth.current_user_id() is null or record->>'workspace_id' is distinct from public.current_workspace_id()::text
  or not public.is_workspace_member(public.current_workspace_id()) then return false;end if;
 if edit and public.current_crm_role() not in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER','SALES_SPECIALIST','SALES_SUPPORT') then return false;end if;
 return exists(select 1 from public.student_enrollments e where e.workspace_id=public.current_workspace_id() and e.id=(record->>'enrollment_id')::uuid and public.student_enrollment_access(to_jsonb(e),edit))
  and (record->>'owner_id' is null or public.can_access_owned_record(public.current_workspace_id(),'STUDENT_SUCCESS_CASE',(record->>'id')::uuid,(record->>'owner_id')::uuid,edit));
end $$;

-- Deleted parents cannot authorize downstream mutations.
create or replace function public.education_business_access(resource text,record jsonb,edit boolean default false) returns boolean
language plpgsql stable security definer set search_path=public,app_auth,extensions as $$
begin
 if record->>'archived_at' is not null then return false;end if;
  if app_auth.current_user_id() is null or record->>'workspace_id' is distinct from public.current_workspace_id()::text
    or not public.is_workspace_member(public.current_workspace_id()) then return false; end if;
  if edit and public.current_crm_role() not in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER','SALES_SPECIALIST','SALES_SUPPORT') then return false; end if;
  case resource

 when 'participations' then return public.customer_subject_access('HOUSEHOLD',(record->>'household_id')::uuid,edit)
      and exists(select 1 from public.education_outreach_events e where e.id=(record->>'event_id')::uuid and e.workspace_id=public.current_workspace_id()
        and public.education_business_access('events',to_jsonb(e),false));

 when 'applications' then return public.education_business_student_access((record->>'student_id')::uuid,edit)
      and (record->>'application_id' is null or exists(select 1 from public.student_applications a where a.id=(record->>'application_id')::uuid
        and a.workspace_id=public.current_workspace_id() and public.student_application_access(to_jsonb(a),edit)));

 when 'organizations' then return public.customer_subject_access('ORGANIZATION',(record->>'id')::uuid,edit);

 when 'needs' then return public.customer_subject_access('HOUSEHOLD',(record->>'id')::uuid,edit);

 when 'pathways' then return public.education_business_student_access((record->>'student_id')::uuid,edit)
      and (record->>'target_organization_id' is null or public.customer_subject_access('ORGANIZATION',(record->>'target_organization_id')::uuid,false));

 when 'events' then return
      (record->>'campaign_id' is null or exists(select 1 from public.growth_campaigns g where g.id=(record->>'campaign_id')::uuid and g.workspace_id=public.current_workspace_id()))
      and (record->>'product_id' is null or exists(select 1 from public.products p where p.id=(record->>'product_id')::uuid and p.workspace_id=public.current_workspace_id()))
      and (record->>'cohort_id' is null or exists(select 1 from public.product_cohorts c where c.id=(record->>'cohort_id')::uuid and c.workspace_id=public.current_workspace_id() and c.product_id=(record->>'product_id')::uuid))
      and public.customer_subject_access('ORGANIZATION',(record->>'organization_id')::uuid,edit)
      and (record->>'partner_organization_id' is null or public.customer_subject_access('ORGANIZATION',(record->>'partner_organization_id')::uuid,false));

 when 'referrals' then return public.customer_subject_access('HOUSEHOLD',(record->>'household_id')::uuid,edit)
      and public.customer_subject_access('ORGANIZATION',(record->>'source_organization_id')::uuid,false)
      and (record->>'event_id' is null or exists(select 1 from public.education_outreach_events e where e.id=(record->>'event_id')::uuid
        and e.workspace_id=public.current_workspace_id() and public.education_business_access('events',to_jsonb(e),false)));
    else return false;
  end case;
end $$;

-- Filtered directory counts share the same criteria as server paging.
create function public.organization_commercial_metrics(search_query text default '',status_filter text default 'all',tier_filter text default null,key_filter boolean default null,owner_filter uuid default null,potential_min integer default null,city_filter text default null,curriculum_filter text default null,type_filter text default null)
returns jsonb language sql stable security invoker set search_path=public as $$
 select jsonb_build_object('total',count(*),'needsAttention',count(*) filter(where status in ('ATTENTION','RISK')),'averageCompleteness',coalesce(round(avg(completeness)),0))
 from public.organization_commercial_records where workspace_id=public.current_workspace_id() and archived_at is null
 and (city_filter is null or strpos(lower(city),lower(city_filter))>0)
 and (curriculum_filter is null or strpos(lower(curriculum),lower(curriculum_filter))>0)
 and (type_filter is null or organization_type=type_filter)
 and (status_filter='all' or status=status_filter)
 and (name_zh ilike '%'||search_query||'%' or name_en ilike '%'||search_query||'%' or short_name ilike '%'||search_query||'%' or city ilike '%'||search_query||'%' or curriculum ilike '%'||search_query||'%')
 and (tier_filter is null or tier_filter='UNKNOWN' and commercial_tier is null or commercial_tier=tier_filter)
 and (key_filter is null or has_key_contact=key_filter) and (owner_filter is null or owner_id=owner_filter)
 and (potential_min is null or partnership_potential_score>=potential_min)
$$;
revoke all on function public.organization_commercial_metrics(text,text,text,boolean,uuid,integer,text,text,text) from public;
grant execute on function public.organization_commercial_metrics(text,text,text,boolean,uuid,integer,text,text,text) to crm_app;

-- Preserve canonical pricing calculations and exclude only removed price rows.
do $prices$ declare item record;definition text;begin
 for item in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind='f' and p.prosrc ilike '%from public.product_prices%' loop
 definition:=pg_get_functiondef(item.oid);
 definition:=regexp_replace(definition,'from public\.product_prices[[:space:]]+([a-z_]+)[[:space:]]+where','from public.product_prices \1 where \1.archived_at is null and','gi');
 definition:=regexp_replace(definition,'from public\.product_prices[[:space:]]+where','from public.product_prices where archived_at is null and','gi');
 execute definition;
 end loop;
end $prices$;

-- Existing Import Set authority is owner-scoped; enable the same bound for cleanup reads.
alter table public.import_sets enable row level security;
create policy import_set_owner_cleanup_read on public.import_sets for select to crm_app using(workspace_id=public.current_workspace_id() and created_by=app_auth.current_user_id() and public.is_workspace_member(workspace_id) and public.current_crm_role() in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER'));
grant select on public.import_sets to crm_app;

create or replace function public.import_set_access(set_id uuid) returns boolean language plpgsql stable security definer set search_path=public,app_auth as $$
declare s public.import_sets;ref record;begin
 select * into s from public.import_sets where id=set_id;
 if s.id is null or s.workspace_id<>public.current_workspace_id() or s.created_by<>app_auth.current_user_id() or s.expires_at<=now() or s.status='ERASED' or s.archived_at is not null or not public.is_workspace_member(s.workspace_id) or public.current_crm_role() not in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER') then return false;end if;
 for ref in select distinct x.kind,x.subject_id from public.import_row_subjects x join public.import_rows r on r.id=x.row_id join public.import_batches b on b.id=r.batch_id where b.import_set_id=s.id loop
  if not public.import_reference_access(ref.kind,ref.subject_id,false) then return false;end if;
 end loop;return true;
end$$;

-- Unused channel drafts are recoverable; active/earned terms remain immutable.
alter table public.channel_agreements add column archived_at timestamptz;
alter table public.channel_agreements add column updated_at timestamptz not null default clock_timestamp();
alter table public.channel_agreement_versions add column archived_at timestamptz;
create policy undeleted_business_record on public.channel_agreements as restrictive for all to crm_app using(archived_at is null) with check(archived_at is null);
create policy undeleted_business_record on public.channel_agreement_versions as restrictive for all to crm_app using(archived_at is null) with check(archived_at is null);
create trigger guard_archived_business_record before update on public.channel_agreements for each row execute function public.guard_archived_business_record();
create trigger guard_archived_business_record before update on public.channel_agreement_versions for each row execute function public.guard_archived_business_record();
-- Keep established read/mutation contracts, adding only deleted-record guards.
do $channel_drafts$ declare definition text;begin
 definition:=pg_get_functiondef('public.get_channel_agreements(uuid)'::regprocedure);
 definition:=replace(definition,'v.agreement_id=a.id','v.agreement_id=a.id and v.archived_at is null');
 definition:=replace(definition,'a.workspace_id=ws and a.organization_id=target_organization','a.workspace_id=ws and a.organization_id=target_organization and a.archived_at is null');
 execute definition;
 definition:=pg_get_functiondef('public.save_channel_agreement(uuid,uuid,integer,jsonb,text)'::regprocedure);
 definition:=replace(definition,'select * into a from public.channel_agreements where workspace_id=ws and id=target_agreement;','select * into a from public.channel_agreements where workspace_id=ws and id=target_agreement; if a.archived_at is not null then raise exception ''commission_not_found'';end if;');
 definition:=replace(definition,'if v.status<>''DRAFT'' then','if v.archived_at is not null then raise exception ''commission_not_found'';end if; if v.status<>''DRAFT'' then');
 execute definition;
 definition:=pg_get_functiondef('public.change_channel_agreement_status(uuid,integer,text,text,text)'::regprocedure);
 definition:=replace(definition,'select * into a from public.channel_agreements','if v.archived_at is not null then raise exception ''commission_not_found'';end if; select * into a from public.channel_agreements');
 execute definition;
end $channel_drafts$;
-- Growth presentation must obey canonical row visibility, including archived rows.
alter function public.growth_snapshot() security invoker;

-- Personal snapshots exclude removed operational rows; historical payments stay intact.
do $dashboard_archives$ declare definition text;table_name text;begin
 definition:=pg_get_functiondef('public.dashboard_snapshot(text)'::regprocedure);
 foreach table_name in array array['crm_tasks','contracts','products','leads','students'] loop
 definition:=replace(definition,'from public.'||table_name||' where workspace_id=ws','from public.'||table_name||' where workspace_id=ws and archived_at is null');
 end loop;execute definition;
end $dashboard_archives$;

-- New associations cannot revive archived subjects through a stale editor or direct RPC.
-- Unchanged historical associations are retained; removal itself never cascades domains.
create function public.guard_deleted_business_reference() returns trigger language plpgsql
set search_path=public,app_auth as $$
declare next_record jsonb:=to_jsonb(new);previous_record jsonb;pair text[];deleted boolean;begin
 if tg_op='UPDATE' then previous_record:=to_jsonb(old);end if;
 if next_record->>'archived_at' is not null then return new;end if;
 foreach pair slice 1 in array array[['organization_id','organizations'],['person_id','contacts'],['student_id','students'],['household_id','households'],['product_id','products'],['cohort_id','product_cohorts'],['enrollment_id','student_enrollments'],['application_id','student_applications'],['case_id','student_success_cases'],['goal_id','student_success_goals'],['risk_id','student_success_risk_signals'],['agreement_id','channel_agreements'],['contract_id','contracts'],['event_id','education_outreach_events'],['pathway_id','student_pathways']] loop
 if next_record->>pair[1] is not null and (tg_op='INSERT' or next_record->>pair[1] is distinct from previous_record->>pair[1]) then
 execute format('select exists(select 1 from public.%I where id=$1 and workspace_id=$2 and archived_at is not null)',pair[2]) into deleted using (next_record->>pair[1])::uuid,(next_record->>'workspace_id')::uuid;
 if deleted then raise exception 'linked_record_deleted';end if;
 end if;end loop;return new;
end $$;
revoke all on function public.guard_deleted_business_reference() from public;
do $reference_guards$ declare kind text;table_name text;begin
 foreach kind in array array['OPPORTUNITY','CONTRACT','ENROLLMENT','APPLICATION','SUPPORT_CASE','SUPPORT_GOAL','SUPPORT_CHECKIN','SUPPORT_RISK','SUPPORT_INTERVENTION','ORGANIZATION_PROFILE','FAMILY_NEED','PATHWAY','OUTREACH_EVENT','REFERRAL','EVENT_PARTICIPATION','ACADEMIC_RECORD','COHORT','QUOTE','ADMISSION_JOURNEY','MILESTONE','ADMISSION_OUTCOME','CONTACT_INTELLIGENCE','CONTACT_RELATIONSHIP','FOLLOWUP_PLAN','FOLLOWUP_ENTRY','ACTIVITY','PRODUCT_PRICE','CHANNEL_AGREEMENT','CHANNEL_AGREEMENT_VERSION'] loop
 table_name:=public.deletion_resource_table(kind);
 execute format('create trigger guard_deleted_business_reference before insert or update on public.%I for each row execute function public.guard_deleted_business_reference()',table_name);
 end loop;end $reference_guards$;
