set search_path=public,extensions;

alter table public.organization_business_profiles
 add column commercial_tier text check(commercial_tier in ('S','A','B','C','D')),
 add column partnership_potential_score integer check(partnership_potential_score between 10 and 100),
 add column competitor_analysis_markdown text not null default '' check(length(competitor_analysis_markdown)<=20000),
 add column bd_plan_markdown text not null default '' check(length(bd_plan_markdown)<=20000),
 add column school_type text check(school_type in ('PUBLIC','PRIVATE','INTERNATIONAL','OTHER')),
 add column grade_min integer check(grade_min between 0 and 12),
 add column grade_max integer check(grade_max between 0 and 12),
 add column tuition_min numeric(14,2) check(tuition_min between 0 and 1000000000),
 add column tuition_max numeric(14,2) check(tuition_max between 0 and 1000000000),
 add column tuition_currency text check(tuition_currency ~ '^[A-Z]{3}$'),
 add constraint organization_grade_span check(grade_min is null or grade_max is null or grade_min<=grade_max),
 add constraint organization_tuition_span check(tuition_min is null or tuition_max is null or tuition_min<=tuition_max),
 add constraint organization_tuition_currency check((tuition_min is null and tuition_max is null) or tuition_currency is not null);
alter table public.organizations add column address text not null default '' check(length(address)<=1000);
alter table public.contacts add column wechat_id text check(wechat_id is null or length(trim(wechat_id)) between 1 and 100);
alter table public.contacts add constraint contacts_organization_identity unique(workspace_id,organization_id,id);

create table public.organization_admission_outcomes(
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id),organization_id uuid not null,
 academic_year text not null check(length(trim(academic_year)) between 4 and 20),
 destination_region text not null check(destination_region in ('UNITED_STATES','UNITED_KINGDOM','CANADA','AUSTRALIA','HONG_KONG','SINGAPORE','EUROPE_OTHER','ASIA_OTHER','OTHER')),
 offer_count integer check(offer_count between 0 and 1000000),matriculation_count integer check(matriculation_count between 0 and 1000000),
 notable_destinations text[] not null default '{}',source_note text not null default '' check(length(source_note)<=2000),as_of_date date,
 revision integer not null default 1 check(revision>0),created_by uuid references app_auth.accounts(id),created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),
 unique(workspace_id,id),unique(workspace_id,organization_id,academic_year,destination_region),
 foreign key(workspace_id,organization_id) references public.organizations(workspace_id,id) on delete cascade
);
create table public.organization_contact_intelligence(
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id),organization_id uuid not null,contact_id uuid not null,
 key_contact_status text not null default 'UNKNOWN' check(key_contact_status in ('UNKNOWN','KEY','NON_KEY')),
 decision_power_score integer check(decision_power_score between 10 and 100),contribution_score integer check(contribution_score between 10 and 100),
 working_style_markdown text not null default '' check(length(working_style_markdown)<=10000),
 cooperation_notes text not null default '' check(length(cooperation_notes)<=10000),potential_notes text not null default '' check(length(potential_notes)<=10000),
 reviewed_at timestamptz not null default clock_timestamp(),reviewed_by uuid references app_auth.accounts(id),
 revision integer not null default 1 check(revision>0),created_by uuid references app_auth.accounts(id),created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),
 unique(workspace_id,id),unique(workspace_id,contact_id),
 foreign key(workspace_id,organization_id,contact_id) references public.contacts(workspace_id,organization_id,id) on delete cascade,
 foreign key(workspace_id,organization_id) references public.organizations(workspace_id,id) on delete cascade
);
create table public.organization_contact_relationships(
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id),organization_id uuid not null,
 source_contact_id uuid not null,target_contact_id uuid not null,check(source_contact_id<>target_contact_id),
 relationship_type text not null check(relationship_type in ('REPORTS_TO','INFLUENCES','ASSISTANT_TO','PEER','WORKS_WITH','OTHER')),
 note text not null default '' check(length(note)<=2000),status text not null default 'ACTIVE' check(status in ('ACTIVE','INACTIVE')),
 revision integer not null default 1 check(revision>0),created_by uuid references app_auth.accounts(id),created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),
 unique(workspace_id,id),foreign key(workspace_id,organization_id) references public.organizations(workspace_id,id) on delete cascade,
 foreign key(workspace_id,organization_id,source_contact_id) references public.contacts(workspace_id,organization_id,id) on delete cascade,
 foreign key(workspace_id,organization_id,target_contact_id) references public.contacts(workspace_id,organization_id,id) on delete cascade
);
create unique index contact_relationship_active_identity on public.organization_contact_relationships(workspace_id,organization_id,
 (case when relationship_type in ('PEER','WORKS_WITH') then least(source_contact_id,target_contact_id) else source_contact_id end),
 (case when relationship_type in ('PEER','WORKS_WITH') then greatest(source_contact_id,target_contact_id) else target_contact_id end),relationship_type) where status='ACTIVE';
create index contact_intelligence_account_idx on public.organization_contact_intelligence(workspace_id,organization_id,key_contact_status);
create index contact_relationship_target_idx on public.organization_contact_relationships(workspace_id,target_contact_id);
create index organization_commercial_tier_idx on public.organization_business_profiles(workspace_id,commercial_tier) where commercial_tier is not null;

create function public.channel_intelligence_access(resource text,record jsonb,edit boolean default false) returns boolean
language sql stable security definer set search_path=public,app_auth as $$
 select app_auth.current_user_id() is not null and record->>'workspace_id'=public.current_workspace_id()::text
 and public.is_workspace_member(public.current_workspace_id())
 and public.current_crm_role() in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER','SALES_SPECIALIST','SALES_SUPPORT')
 and public.customer_subject_access('ORGANIZATION',(record->>'organization_id')::uuid,edit)
 and not exists(select 1 from public.contacts c where c.workspace_id=public.current_workspace_id() and c.id in ((record->>'contact_id')::uuid,(record->>'source_contact_id')::uuid,(record->>'target_contact_id')::uuid) and coalesce(c.do_not_contact_reason,'') like 'PRIVACY_DELETION:%')
 and case resource when 'outcomes' then true
 when 'intelligence' then public.customer_subject_access('CONTACT',(record->>'contact_id')::uuid,edit)
 when 'relationships' then public.customer_subject_access('CONTACT',(record->>'source_contact_id')::uuid,false)
 and public.customer_subject_access('CONTACT',(record->>'target_contact_id')::uuid,false) else false end $$;
revoke all on function public.channel_intelligence_access(text,jsonb,boolean) from public;
grant execute on function public.channel_intelligence_access(text,jsonb,boolean) to crm_app;
do $$ declare pair text[];begin
 foreach pair slice 1 in array array[['organization_admission_outcomes','outcomes'],['organization_contact_intelligence','intelligence'],['organization_contact_relationships','relationships']] loop
 execute format('alter table public.%I enable row level security',pair[1]);
 execute format('create policy channel_read on public.%I for select to crm_app using(public.channel_intelligence_access(%L,to_jsonb(%I),false))',pair[1],pair[2],pair[1]);
 execute format('grant select on public.%I to crm_app,crm_worker',pair[1]);
 execute format('create policy channel_privacy_worker on public.%I for select to crm_worker using(true)',pair[1]);
 end loop;
end $$;
create function public.guard_contact_relationship() returns trigger language plpgsql security definer set search_path=public as $$
begin
 perform pg_advisory_xact_lock(hashtextextended('channel:'||new.workspace_id::text||new.organization_id::text,0));
 if new.status='ACTIVE' and new.relationship_type='REPORTS_TO' and exists(select 1 from public.organization_contact_relationships r
 where r.workspace_id=new.workspace_id and r.organization_id=new.organization_id and r.id<>new.id and r.status='ACTIVE' and r.relationship_type='REPORTS_TO'
 and r.source_contact_id=new.target_contact_id and r.target_contact_id=new.source_contact_id) then raise exception 'channel_reporting_cycle';end if;
 return new;
end $$;
revoke all on function public.guard_contact_relationship() from public;
create trigger guard_contact_relationship before insert or update on public.organization_contact_relationships for each row execute function public.guard_contact_relationship();

-- Private persistence for the three small domain mutations. No business code can call it directly.
create function public.channel_intelligence_save_internal(resource text,record_id uuid,expected_revision integer,data jsonb,p_request_key text) returns jsonb
language plpgsql security definer set search_path=public,app_auth,extensions as $$
declare ws uuid:=public.current_workspace_id();actor uuid:=app_auth.current_user_id();table_name text;fields text[];identity_fields text[];
 previous jsonb;candidate jsonb;result jsonb;receipt jsonb;saved_receipt public.mutation_receipts;fingerprint text;mutation_operation text:='CHANNEL_'||upper(resource)||'_SAVE';columns_sql text;updates_sql text;f text;
begin
 case resource
 when 'outcomes' then table_name:='organization_admission_outcomes';fields:=array['organization_id','academic_year','destination_region','offer_count','matriculation_count','notable_destinations','source_note','as_of_date'];identity_fields:=array['organization_id'];
 when 'intelligence' then table_name:='organization_contact_intelligence';fields:=array['organization_id','contact_id','key_contact_status','decision_power_score','contribution_score','working_style_markdown','cooperation_notes','potential_notes'];identity_fields:=array['organization_id','contact_id'];
 when 'relationships' then table_name:='organization_contact_relationships';fields:=array['organization_id','source_contact_id','target_contact_id','relationship_type','note','status'];identity_fields:=array['organization_id','source_contact_id','target_contact_id','relationship_type'];
 else raise exception 'channel_input_invalid';end case;
 if record_id is null or jsonb_typeof(data) is distinct from 'object' or not data ?& fields or expected_revision<=0
 or exists(select 1 from jsonb_object_keys(data) k where not k=any(fields)) or length(coalesce(p_request_key,'')) not between 8 and 120 then raise exception 'channel_input_invalid';end if;
 candidate:=data||jsonb_build_object('id',record_id,'workspace_id',ws,'revision',1,'created_by',actor,'updated_at',clock_timestamp(),'created_at',clock_timestamp());
 if not public.channel_intelligence_access(resource,candidate,true) then raise exception 'channel_forbidden';end if;
 perform pg_advisory_xact_lock(hashtextextended('channel:'||ws::text||(data->>'organization_id'),0));
 perform pg_advisory_xact_lock(hashtextextended('channel-request:'||ws::text||p_request_key,0));
 fingerprint:=encode(digest(jsonb_build_object('resource',resource,'id',record_id,'revision',expected_revision,'data',data)::text,'sha256'),'hex');
 select * into saved_receipt from public.mutation_receipts r where r.workspace_id=ws and r.request_key=p_request_key;
 if found then
 if saved_receipt.operation<>mutation_operation or saved_receipt.created_by is distinct from actor then raise exception 'channel_request_conflict';end if;
 receipt:=saved_receipt.result;
 if receipt->>'request_hash' is distinct from fingerprint then raise exception 'channel_request_conflict';end if;
 if not public.channel_intelligence_access(resource,receipt->'item',true) then raise exception 'channel_forbidden';end if;return receipt->'item';end if;
 execute format('select to_jsonb(r) from public.%I r where id=$1 and workspace_id=$2 for update',table_name) into previous using record_id,ws;
 if previous is not null then
 if not public.channel_intelligence_access(resource,previous,true) then raise exception 'channel_forbidden';end if;
 foreach f in array identity_fields loop if previous->f is distinct from data->f then raise exception 'channel_parent_immutable';end if;end loop;
 if expected_revision is null or (previous->>'revision')::integer<>expected_revision then raise exception 'channel_version_conflict';end if;
 candidate:=candidate||jsonb_build_object('revision',expected_revision+1);
 else if expected_revision is not null then raise exception 'channel_not_found';end if;end if;
 if resource='outcomes' and (jsonb_typeof(data->'notable_destinations') is distinct from 'array' or jsonb_array_length(data->'notable_destinations')>30
 or exists(select 1 from jsonb_array_elements(data->'notable_destinations') v where jsonb_typeof(v)<>'string' or length(trim(v#>>'{}')) not between 1 and 160)) then raise exception 'channel_input_invalid';end if;
 if resource='intelligence' then candidate:=candidate||jsonb_build_object('reviewed_at',clock_timestamp(),'reviewed_by',actor);fields:=fields||array['reviewed_at','reviewed_by'];end if;
 if previous is null then
 select string_agg(format('%I',k),',') into columns_sql from unnest(fields||array['id','workspace_id','revision','created_by','created_at','updated_at']) k;
 execute format('insert into public.%I(%s) select %s from jsonb_populate_record(null::public.%I,$1) returning to_jsonb(%I)',table_name,columns_sql,columns_sql,table_name,table_name) into result using candidate;
 else
 select string_agg(format('%I=v.%I',k,k),',') into updates_sql from unnest(fields||array['revision','updated_at']) k;
 execute format('update public.%I t set %s from jsonb_populate_record(null::public.%I,$1) v where t.id=$2 and t.workspace_id=$3 returning to_jsonb(t)',table_name,updates_sql,table_name) into result using candidate,record_id,ws;
 end if;
 insert into public.audit_events(workspace_id,actor_id,action,entity_type,entity_id,after_data) values(ws,actor,
 case resource when 'outcomes' then 'ORGANIZATION_ADMISSION_OUTCOME_' when 'intelligence' then 'CONTACT_INTELLIGENCE_' else 'CONTACT_RELATIONSHIP_' end||case when previous is null then 'CREATED' when resource='relationships' and data->>'status'='INACTIVE' then 'DEACTIVATED' else 'UPDATED' end,
 'CHANNEL_INTELLIGENCE',record_id,jsonb_build_object('resource',resource,'organizationId',data->'organization_id','revision',result->'revision','changedFields',(select jsonb_agg(k) from unnest(fields) k where previous->k is distinct from result->k)));
 insert into public.mutation_receipts(workspace_id,request_key,operation,result,created_by) values(ws,p_request_key,mutation_operation,jsonb_build_object('request_hash',fingerprint,'item',result),actor);
 return result;
end $$;
revoke all on function public.channel_intelligence_save_internal(text,uuid,integer,jsonb,text) from public,crm_app,crm_system;
create function public.save_organization_admission_outcome(record_id uuid,expected_revision integer,data jsonb,p_request_key text) returns jsonb language sql security definer set search_path=public as $$ select public.channel_intelligence_save_internal('outcomes',record_id,expected_revision,data,p_request_key) $$;
create function public.save_organization_contact_intelligence(record_id uuid,expected_revision integer,data jsonb,p_request_key text) returns jsonb language sql security definer set search_path=public as $$ select public.channel_intelligence_save_internal('intelligence',record_id,expected_revision,data,p_request_key) $$;
create function public.save_organization_contact_relationship(record_id uuid,expected_revision integer,data jsonb,p_request_key text) returns jsonb language sql security definer set search_path=public as $$ select public.channel_intelligence_save_internal('relationships',record_id,expected_revision,data,p_request_key) $$;
revoke all on function public.save_organization_admission_outcome(uuid,integer,jsonb,text),public.save_organization_contact_intelligence(uuid,integer,jsonb,text),public.save_organization_contact_relationship(uuid,integer,jsonb,text) from public;
grant execute on function public.save_organization_admission_outcome(uuid,integer,jsonb,text),public.save_organization_contact_intelligence(uuid,integer,jsonb,text),public.save_organization_contact_relationship(uuid,integer,jsonb,text) to crm_app;

create function public.cleanup_channel_receipts() returns trigger language plpgsql security definer set search_path=public as $$
begin delete from public.mutation_receipts where workspace_id=old.workspace_id and operation=case tg_table_name when 'organization_contact_intelligence' then 'CHANNEL_INTELLIGENCE_SAVE' else 'CHANNEL_RELATIONSHIPS_SAVE' end and result->'item'->>'id'=old.id::text;return old;end $$;
revoke all on function public.cleanup_channel_receipts() from public;
create trigger intelligence_receipt_cleanup before delete on public.organization_contact_intelligence for each row execute function public.cleanup_channel_receipts();
create trigger relationship_receipt_cleanup before delete on public.organization_contact_relationships for each row execute function public.cleanup_channel_receipts();
create function public.cleanup_channel_contact() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if coalesce(new.do_not_contact_reason,'') like 'PRIVACY_DELETION:%' then
 delete from public.organization_contact_intelligence where workspace_id=new.workspace_id and contact_id=new.id;
 delete from public.organization_contact_relationships where workspace_id=new.workspace_id and (source_contact_id=new.id or target_contact_id=new.id);
 new.wechat_id:=null;
 end if;return new;
end $$;
revoke all on function public.cleanup_channel_contact() from public;
create trigger channel_contact_privacy before update of do_not_contact_reason on public.contacts for each row execute function public.cleanup_channel_contact();

create view public.organization_contact_intelligence_records with(security_invoker=true) as
 select i.*,c.name_zh,c.name_en,c.title,c.decision_role,c.next_follow_up_at,c.wechat_id,public.channel_intelligence_access('intelligence',to_jsonb(i),true) can_edit
 from public.organization_contact_intelligence i join public.contacts c on c.id=i.contact_id and c.workspace_id=i.workspace_id;
create view public.organization_contact_relationship_records with(security_invoker=true) as
 select r.*,s.name_zh source_name_zh,s.name_en source_name_en,t.name_zh target_name_zh,t.name_en target_name_en,
 public.channel_intelligence_access('relationships',to_jsonb(r),true) can_edit
 from public.organization_contact_relationships r join public.contacts s on s.id=r.source_contact_id and s.workspace_id=r.workspace_id join public.contacts t on t.id=r.target_contact_id and t.workspace_id=r.workspace_id;
create view public.organization_admission_outcome_records with(security_invoker=true) as
 select r.*,public.channel_intelligence_access('outcomes',to_jsonb(r),true) can_edit from public.organization_admission_outcomes r;
create view public.organization_commercial_records with(security_invoker=true) as
 select o.*,b.commercial_tier,b.partnership_potential_score,
 exists(select 1 from public.organization_contact_intelligence i where i.organization_id=o.id and i.workspace_id=o.workspace_id and i.key_contact_status='KEY') has_key_contact
 from public.organizations o left join public.organization_business_profiles b on b.id=o.id and b.workspace_id=o.workspace_id;
grant select on public.organization_contact_intelligence_records,public.organization_contact_relationship_records,public.organization_admission_outcome_records,public.organization_commercial_records to crm_app;

create function public.save_contact_communication(target_contact uuid,expected_updated_at timestamptz,next_wechat_id text) returns public.contacts
language plpgsql security definer set search_path=public,app_auth as $$
declare c public.contacts;begin
 if not public.customer_subject_access('CONTACT',target_contact,true) or public.current_crm_role() not in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER','SALES_SPECIALIST') then raise exception 'channel_forbidden';end if;
 select * into c from public.contacts where id=target_contact and workspace_id=public.current_workspace_id() for update;
 if coalesce(c.do_not_contact_reason,'') like 'PRIVACY_DELETION:%' then raise exception 'channel_forbidden';end if;
 if expected_updated_at is null or c.updated_at<>expected_updated_at then raise exception 'channel_version_conflict';end if;
 if length(trim(coalesce(next_wechat_id,'')))>100 then raise exception 'channel_input_invalid';end if;
 update public.contacts set wechat_id=nullif(trim(next_wechat_id),''),updated_at=clock_timestamp() where id=c.id returning * into c;
 insert into public.audit_events(workspace_id,actor_id,action,entity_type,entity_id,after_data) values(c.workspace_id,app_auth.current_user_id(),'CONTACT_COMMUNICATION_UPDATED','CONTACT',c.id,jsonb_build_object('changedFields',jsonb_build_array('wechat_id')));
 return c;
end $$;
revoke all on function public.save_contact_communication(uuid,timestamptz,text) from public;
grant execute on function public.save_contact_communication(uuid,timestamptz,text) to crm_app;

create function public.organization_commercial_metrics(search_query text default '',status_filter text default 'all',tier_filter text default null,key_filter boolean default null,owner_filter uuid default null,potential_min integer default null)
returns jsonb language sql stable security invoker set search_path=public as $$
 select jsonb_build_object('total',count(*),'needsAttention',count(*) filter(where status in ('ATTENTION','RISK')),'averageCompleteness',coalesce(round(avg(completeness)),0))
 from public.organization_commercial_records where workspace_id=public.current_workspace_id() and archived_at is null
 and (status_filter='all' or status=status_filter)
 and (name_zh ilike '%'||search_query||'%' or name_en ilike '%'||search_query||'%' or short_name ilike '%'||search_query||'%' or city ilike '%'||search_query||'%' or curriculum ilike '%'||search_query||'%')
 and (tier_filter is null or tier_filter='UNKNOWN' and commercial_tier is null or commercial_tier=tier_filter)
 and (key_filter is null or has_key_contact=key_filter) and (owner_filter is null or owner_id=owner_filter)
 and (potential_min is null or partnership_potential_score>=potential_min)
$$;
revoke all on function public.organization_commercial_metrics(text,text,text,boolean,uuid,integer) from public;
grant execute on function public.organization_commercial_metrics(text,text,text,boolean,uuid,integer) to crm_app;

create view public.organization_commercial_contact_records with(security_invoker=true) as
 select c.id,c.workspace_id,c.organization_id,c.name_zh,c.name_en,c.title,c.decision_role,c.next_follow_up_at,c.wechat_id,c.updated_at,
 public.customer_subject_access('CONTACT',c.id,true) can_edit
 from public.contacts c where c.organization_id is not null and c.archived_at is null and coalesce(c.do_not_contact_reason,'') not like 'PRIVACY_DELETION:%'
 and public.channel_intelligence_access('intelligence',jsonb_build_object('workspace_id',c.workspace_id,'organization_id',c.organization_id,'contact_id',c.id),false);
create view public.opportunity_commercial_records with(security_invoker=true) as
 select o.*,p.name_zh product_name_zh,p.name_en product_name_en,c.name_zh cohort_name_zh,c.name_en cohort_name_en
 from public.opportunities o left join public.products p on p.workspace_id=o.workspace_id and p.id=o.product_id
 left join public.product_cohorts c on c.workspace_id=o.workspace_id and c.id=o.cohort_id;
grant select on public.organization_commercial_contact_records,public.opportunity_commercial_records to crm_app;

create or replace function public.update_school_customer_profile(target_school uuid,expected_updated_at timestamptz,profile jsonb)
returns public.organizations language plpgsql security definer set search_path=public,app_auth,extensions as $$
declare result public.organizations;
begin
 result:=public.update_school_profile(target_school,expected_updated_at,profile->>'nameZh',profile->>'nameEn',profile->>'city',profile->>'curriculum',profile->>'status',array(select jsonb_array_elements_text(coalesce(profile->'courseCategories','[]'::jsonb))),coalesce(profile->>'affiliationType','INDEPENDENT'),nullif(profile->>'parentOrganizationId','')::uuid,profile->>'organizationOverviewMarkdown',profile->>'structureOverviewMarkdown',profile->>'website',(profile->>'foundedYear')::integer,(profile->>'studentCount')::integer,(profile->>'facultyCount')::integer,(profile->>'campusCount')::integer);
 update public.organizations set short_name=coalesce(trim(profile->>'shortName'),short_name),address=case when profile ? 'address' then coalesce(profile->>'address','') else address end where id=target_school returning * into result;
 return result;
end $$;

-- Forward extension preserves omitted commercial fields for legacy callers.
create or replace function public.save_education_business(resource text,record_id uuid,expected_revision integer,data jsonb) returns jsonb
language plpgsql security definer set search_path=public,app_auth,extensions as $$
declare table_name text; fields text[]; old_row jsonb; candidate jsonb; result jsonb; column_list text; update_list text; related uuid; extra text;
begin
  if resource='organizations' and jsonb_typeof(data)='object' then
    perform pg_advisory_xact_lock(hashtextextended('education-business:'||public.current_workspace_id()::text||resource||record_id::text,0));
    select to_jsonb(p) into old_row from public.organization_business_profiles p where id=record_id and workspace_id=public.current_workspace_id() for update;
    foreach extra in array array['commercial_tier','partnership_potential_score','competitor_analysis_markdown','bd_plan_markdown','school_type','grade_min','grade_max','tuition_min','tuition_max','tuition_currency'] loop
      if not data ? extra then data:=data||jsonb_build_object(extra,coalesce(old_row->extra,case when extra in ('competitor_analysis_markdown','bd_plan_markdown') then '""'::jsonb else 'null'::jsonb end));end if;
    end loop;
  end if;
  if resource='applications' and jsonb_typeof(data)='object' and not data ? 'application_id' then
    select jsonb_build_object('application_id',application_id) into old_row from public.student_application_tasks where id=record_id and workspace_id=public.current_workspace_id();
    data:=data||coalesce(old_row,jsonb_build_object('application_id',null));
  end if;
  if resource='events' then perform public.lock_commercial_relations(public.current_workspace_id()); end if;
  if resource='events' and jsonb_typeof(data)='object' and not data ?| array['campaign_id','product_id','cohort_id'] then
    select jsonb_build_object('campaign_id',campaign_id,'product_id',product_id,'cohort_id',cohort_id)
      into old_row from public.education_outreach_events where id=record_id and workspace_id=public.current_workspace_id();
    data:=data||coalesce(old_row,jsonb_build_object('campaign_id',null,'product_id',null,'cohort_id',null));
  end if;
  case resource
    when 'participations' then table_name:='education_event_participations';fields:=array['event_id','household_id','party_size','status','next_action'];
    when 'applications' then table_name:='student_application_tasks';fields:=array['student_id','application_id','title','due_on','status','next_action'];
    when 'organizations' then table_name:='organization_business_profiles';fields:=array['organization_type','roles','partnership_stage','primary_contact_id','focus_regions','agreement_expires_on','next_action','commercial_tier','partnership_potential_score','competitor_analysis_markdown','bd_plan_markdown','school_type','grade_min','grade_max','tuition_min','tuition_max','tuition_currency'];
    when 'needs' then table_name:='family_education_needs';fields:=array['services','target_regions','budget_min','budget_max','budget_currency','target_intake','decision_stage','next_action'];
    when 'pathways' then table_name:='student_pathways';fields:=array['student_id','program_type','target_organization_id','target_region','target_major','intake_date','application_deadline','language_test','language_score','stage','next_action'];
    when 'events' then table_name:='education_outreach_events';fields:=array['campaign_id','product_id','cohort_id','name','organization_id','partner_organization_id','kind','starts_on','ends_on','location','capacity','attendee_count','status','next_action'];
    when 'referrals' then table_name:='education_family_referrals';fields:=array['source_organization_id','household_id','event_id','introduced_by_contact_id','referred_on','status','next_action'];
    else raise exception 'business_input_invalid';
  end case;
  if record_id is null or jsonb_typeof(data) is distinct from 'object' or expected_revision<=0
    or not data ?& fields or exists(select 1 from jsonb_object_keys(data) k where not k=any(fields||case when resource in ('organizations','needs') then array['id'] else array[]::text[] end))
    or (resource in ('organizations','needs') and (data->>'id') is distinct from record_id::text)
    then raise exception 'business_input_invalid'; end if;
  candidate:=data||jsonb_build_object('id',record_id,'workspace_id',public.current_workspace_id(),'revision',1,'updated_at',clock_timestamp());
  if resource='needs' and ((data->>'budget_min')::numeric<>round((data->>'budget_min')::numeric,2)
    or (data->>'budget_max')::numeric<>round((data->>'budget_max')::numeric,2)) then raise exception 'business_input_invalid'; end if;
  if not public.education_business_access(resource,candidate,true) then raise exception 'business_update_forbidden'; end if;
  -- Optional people are checked separately; referential integrity alone is not authorization.
  related:=coalesce((data->>'primary_contact_id')::uuid,(data->>'introduced_by_contact_id')::uuid);
  if related is not null and (not public.customer_subject_access('CONTACT',related,false) or not exists(select 1 from public.contacts c
    where c.id=related and c.workspace_id=public.current_workspace_id() and coalesce(c.do_not_contact_reason,'') not like 'PRIVACY_DELETION:%'))
    then raise exception 'business_related_not_found'; end if;
  if resource='referrals' and data->>'event_id' is not null then
    perform 1 from public.education_outreach_events e where e.id=(data->>'event_id')::uuid and e.workspace_id=public.current_workspace_id() for share;
  end if;
  if resource='referrals' and data->>'event_id' is not null and not exists(select 1 from public.education_outreach_events e
    where e.id=(data->>'event_id')::uuid and e.workspace_id=public.current_workspace_id()
      and (e.organization_id=(data->>'source_organization_id')::uuid or e.partner_organization_id=(data->>'source_organization_id')::uuid))
    then raise exception 'business_event_source_mismatch'; end if;
  -- One workspace/id lock serializes create and edit, including uncertain retries.
  perform pg_advisory_xact_lock(hashtextextended('education-business:'||public.current_workspace_id()::text||resource||record_id::text,0));
  execute format('select to_jsonb(r) from public.%I r where id=$1 and workspace_id=$2 for update',table_name)
    into old_row using record_id,public.current_workspace_id();
  if old_row is not null then
    if not public.education_business_access(resource,old_row,true) then raise exception 'business_update_forbidden'; end if;
    -- Parents of persisted records are immutable; move identity via the existing customer workflows.
    if resource in ('pathways','applications') and old_row->'student_id' is distinct from data->'student_id'
      or resource='participations' and (old_row->'event_id' is distinct from data->'event_id' or old_row->'household_id' is distinct from data->'household_id')
      or resource='events' and old_row->'organization_id' is distinct from data->'organization_id'
      or resource='referrals' and (old_row->'source_organization_id' is distinct from data->'source_organization_id' or old_row->'household_id' is distinct from data->'household_id')
      then raise exception 'business_parent_immutable'; end if;
    if expected_revision is null or (old_row->>'revision')::integer<>expected_revision then
      if (expected_revision is null and (old_row->>'revision')::integer=1 or (old_row->>'revision')::integer=expected_revision+1)
        and not exists(select 1 from unnest(fields) f where old_row->f is distinct from data->f) then return old_row; end if;
      raise exception 'business_version_conflict';
    end if;
    candidate:=candidate||jsonb_build_object('revision',expected_revision+1);
    select string_agg(format('%I=v.%I',f,f),',') into update_list from unnest(fields||array['revision','updated_at']) f;
    execute format('update public.%I t set %s from jsonb_populate_record(null::public.%I,$1) v where t.id=$2 and t.workspace_id=$3 returning to_jsonb(t)',table_name,update_list,table_name)
      into result using candidate,record_id,public.current_workspace_id();
  else
    if expected_revision is not null then raise exception 'business_record_not_found'; end if;
    fields:=fields||array['id','workspace_id','revision','updated_at'];
    select string_agg(format('%I',f),',') into column_list from unnest(fields) f;
    execute format('insert into public.%I(%s) select %s from jsonb_populate_record(null::public.%I,$1) returning to_jsonb(%I)',table_name,column_list,column_list,table_name,table_name)
      into result using candidate;
  end if;
  if resource='organizations' then
    update public.organizations set organization_type=data->>'organization_type',updated_at=clock_timestamp() where id=record_id and workspace_id=public.current_workspace_id();
  end if;
  -- Do not allow an activity edit to invalidate already-recorded attribution.
  if resource='events' and exists(select 1 from public.education_family_referrals r where r.event_id=record_id
    and r.workspace_id=public.current_workspace_id() and r.source_organization_id<>(result->>'organization_id')::uuid
    and r.source_organization_id is distinct from (result->>'partner_organization_id')::uuid)
    then raise exception 'business_event_source_mismatch'; end if;
  insert into public.audit_events(workspace_id,actor_id,action,entity_type,entity_id,after_data)
    values(public.current_workspace_id(),app_auth.current_user_id(),'EDUCATION_BUSINESS_SAVED','EDUCATION_BUSINESS',record_id,
      jsonb_build_object('resource',resource,'revision',result->'revision'));
  if resource='organizations' and exists(select 1 from unnest(array['commercial_tier','partnership_potential_score','competitor_analysis_markdown','bd_plan_markdown','school_type','grade_min','grade_max','tuition_min','tuition_max','tuition_currency']) f where old_row->f is distinct from result->f) then
    insert into public.audit_events(workspace_id,actor_id,action,entity_type,entity_id,after_data)
    values(public.current_workspace_id(),app_auth.current_user_id(),'ORGANIZATION_COMMERCIAL_PROFILE_UPDATED','ORGANIZATION',record_id,
      jsonb_build_object('revision',result->'revision','changedFields',(select jsonb_agg(f) from unnest(array['commercial_tier','partnership_potential_score','competitor_analysis_markdown','bd_plan_markdown','school_type','grade_min','grade_max','tuition_min','tuition_max','tuition_currency']) f where old_row->f is distinct from result->f)));
  end if;
  return result;
end $$;

create function public.seed_channel_quality_rules() returns trigger language plpgsql security definer set search_path=public as $$
begin insert into public.data_quality_rule_configs(workspace_id,rule_key,severity,enabled) select new.id,k,'MEDIUM',true from unnest(array['STRATEGIC_ACCOUNT_WITHOUT_KEY_CONTACT','HIGH_TIER_ACCOUNT_WITHOUT_NEXT_ACTION','CHANNEL_ACCOUNT_WITHOUT_OWNER','KEY_CONTACT_WITHOUT_DECISION_ROLE','KEY_CONTACT_WITHOUT_DECISION_POWER']) k on conflict do nothing;return new;end $$;
revoke all on function public.seed_channel_quality_rules() from public;
create trigger seed_channel_quality_rules after insert on public.workspaces for each row execute function public.seed_channel_quality_rules();
insert into public.data_quality_rule_configs(workspace_id,rule_key,severity,enabled) select w.id,k,'MEDIUM',true from public.workspaces w cross join unnest(array['STRATEGIC_ACCOUNT_WITHOUT_KEY_CONTACT','HIGH_TIER_ACCOUNT_WITHOUT_NEXT_ACTION','CHANNEL_ACCOUNT_WITHOUT_OWNER','KEY_CONTACT_WITHOUT_DECISION_ROLE','KEY_CONTACT_WITHOUT_DECISION_POWER']) k on conflict do nothing;
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
update public.data_quality_issues issue set status='RESOLVED',resolution_note='AUTO_RESOLVED',resolved_at=now(),resolved_by=app_auth.current_user_id()
  where issue.workspace_id=ws and issue.status in ('OPEN','ASSIGNED') and issue.last_seen_at<marker
    and issue.rule_key in (select rule_key from public.data_quality_rule_configs where workspace_id=ws);
  select count(*) into affected from public.data_quality_issues where workspace_id=ws and status in ('OPEN','ASSIGNED');
  return affected;
end;
$$;
