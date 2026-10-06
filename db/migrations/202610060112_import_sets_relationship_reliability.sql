-- v3.25 Phase 3: bounded orchestration over the existing batch engine; canonical relation safeguards.
set search_path=public,app_auth,extensions;
alter table public.household_members add column revision integer not null default 1 check(revision>0);
alter table public.student_guardian_relationships add column revision integer not null default 1 check(revision>0);
create function public.relation_revision_increment() returns trigger language plpgsql as $$begin new.revision:=old.revision+1;return new;end$$;
create trigger member_revision before update on public.household_members for each row execute function public.relation_revision_increment();
create trigger guardian_revision before update on public.student_guardian_relationships for each row execute function public.relation_revision_increment();
revoke all on function public.relation_revision_increment() from public;

create table public.import_sets(
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id),
 created_by uuid not null references app_auth.accounts(id),name text not null check(length(name) between 1 and 80),
 request_key text not null,payload_sha256 text not null,revision integer not null default 1,
 status text not null default 'DRAFT' check(status in ('DRAFT','READY','PROCESSING','NEEDS_REVIEW','PARTIAL_FAILED','COMPLETED','ROLLED_BACK','PARTIAL_ROLLBACK','ERASED')),
 expires_at timestamptz not null default clock_timestamp()+interval '30 days',created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),
 unique(workspace_id,request_key)
);
alter table public.import_batches add column import_set_id uuid references public.import_sets(id);
alter table public.import_rows add column set_sequence integer;
alter table public.import_rows add column privacy_erased boolean not null default false;
do $$declare c record;begin
 for c in select conname from pg_constraint where conrelid='public.import_batches'::regclass and contype='c' and pg_get_constraintdef(oid) like '%resource_type%' loop execute format('alter table public.import_batches drop constraint %I',c.conname);end loop;
end$$;
alter table public.import_batches add constraint import_resources check(resource_type in ('ORGANIZATIONS','HOUSEHOLDS','CONTACTS','STUDENTS','COHORTS','ENROLLMENTS','ORGANIZATION_CONTACT_ASSOCIATIONS','HOUSEHOLD_MEMBERS','STUDENT_GUARDIANS','ORGANIZATION_CONTACT_INTELLIGENCE','ORGANIZATION_CONTACT_RELATIONSHIPS'));
create table public.import_set_aliases(
 set_id uuid not null references public.import_sets(id),alias text not null check(alias~'^@(organization|household|contact|student):[a-z0-9][a-z0-9_-]{0,59}$'),
 resource text not null check(resource in ('ORGANIZATION','HOUSEHOLD','CONTACT','STUDENT')),row_id uuid not null references public.import_rows(id),
 record_id uuid,status text not null default 'PENDING' check(status in ('PENDING','RESOLVED','FAILED','ERASED')),
 primary key(set_id,alias),unique(row_id)
);
create table public.import_set_dependencies(set_id uuid not null references public.import_sets(id),row_id uuid not null references public.import_rows(id),parent_row_id uuid not null references public.import_rows(id),primary key(row_id,parent_row_id));
create table public.import_row_subjects(row_id uuid not null references public.import_rows(id) on delete cascade,workspace_id uuid not null,kind text not null,subject_id uuid not null,primary key(row_id,kind,subject_id));
create index import_subject_lookup on public.import_row_subjects(workspace_id,kind,subject_id);
create table public.relation_receipt_subjects(workspace_id uuid not null,request_key text not null,kind text not null,subject_id uuid not null,primary key(workspace_id,request_key,kind,subject_id));
create index relation_receipt_subject_lookup on public.relation_receipt_subjects(workspace_id,kind,subject_id);
create function public.import_set_alias_immutable() returns trigger language plpgsql as $$begin
 if old.status='RESOLVED' and (new.record_id is distinct from old.record_id or new.alias<>old.alias or new.resource<>old.resource or new.row_id<>old.row_id) and new.status<>'ERASED' then raise exception 'ALIAS_CONFLICT';end if;return new;
end$$;
create trigger import_alias_immutable before update on public.import_set_aliases for each row execute function public.import_set_alias_immutable();
revoke all on function public.import_set_alias_immutable() from public;

-- Safe optional association: legal reassignment remains unavailable.
create function public.assign_contact_organization(contact_id uuid,organization_id uuid,expected_updated_at timestamptz,p_request_key text) returns jsonb
language plpgsql security definer set search_path=public,app_auth,extensions as $$
declare c public.contacts;r public.mutation_receipts;fingerprint text;result jsonb;
begin
 if not public.import_reference_access('CONTACT',contact_id,true) or not public.import_reference_access('ORGANIZATION',organization_id,true) then raise exception 'INVALID_REFERENCE';end if;
 if length(coalesce(p_request_key,'')) not between 8 and 120 then raise exception 'INVALID_REQUEST_KEY';end if;
 fingerprint:=encode(digest(jsonb_build_object('contact',contact_id,'organization',organization_id,'revision',expected_updated_at)::text,'sha256'),'hex');
 perform pg_advisory_xact_lock(hashtextextended('association:'||contact_id::text,0));
 select * into r from public.mutation_receipts where workspace_id=public.current_workspace_id() and request_key=p_request_key;
 if found then if r.operation<>'CONTACT_ORGANIZATION_ASSIGN' or r.created_by<>app_auth.current_user_id() or r.result->>'hash'<>fingerprint then raise exception 'PAYLOAD_REUSE';end if;return r.result->'item';end if;
 select * into c from public.contacts where id=contact_id and workspace_id=public.current_workspace_id() for update;
 if c.updated_at is distinct from expected_updated_at then raise exception 'STALE_TARGET';end if;
 if c.organization_id is not null then raise exception 'UNSUPPORTED_REASSIGNMENT';end if;
 update public.contacts set organization_id=assign_contact_organization.organization_id,updated_at=clock_timestamp() where id=contact_id returning to_jsonb(contacts) into result;
 result:=jsonb_build_object('id',result->'id','updated_at',result->'updated_at','organization_id',organization_id);
 insert into public.mutation_receipts(workspace_id,request_key,operation,result,created_by) values(public.current_workspace_id(),p_request_key,'CONTACT_ORGANIZATION_ASSIGN',jsonb_build_object('hash',fingerprint,'item',result),app_auth.current_user_id());
 insert into public.audit_events(workspace_id,actor_id,entity_type,entity_id,action,after_data) values(public.current_workspace_id(),app_auth.current_user_id(),'CONTACT',contact_id,'CONTACT_ORGANIZATION_ASSIGNED',jsonb_build_object('organizationId',organization_id));
 return result;
end$$;
revoke all on function public.assign_contact_organization(uuid,uuid,timestamptz,text) from public,crm_system;
grant execute on function public.assign_contact_organization(uuid,uuid,timestamptz,text) to crm_app;

-- These owning wrappers retain the existing primary-member/guardian semantics and add revision,
-- current parent access, payload-bound receipts, and parent-scoped serialization.
alter function public.save_household_member(uuid,uuid,text,boolean) rename to save_household_member_before112;
alter function public.save_student_guardian(uuid,uuid,text,boolean,boolean,boolean) rename to save_student_guardian_before112;
revoke all on function public.save_household_member_before112(uuid,uuid,text,boolean),public.save_student_guardian_before112(uuid,uuid,text,boolean,boolean,boolean) from public,crm_app,crm_system;

create function public.customer_relation_context(resource text,patch jsonb,operation text,expected jsonb default null) returns jsonb
language plpgsql security definer set search_path=public,app_auth,extensions as $$
declare previous jsonb;data jsonb;identity uuid;parent uuid;contact uuid;table_name text;column_name text;fields text[];siblings jsonb:='[]';
begin
 if not public.is_workspace_member(public.current_workspace_id()) or public.current_crm_role() not in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER','SALES_SPECIALIST','SALES_SUPPORT') then raise exception 'PERMISSION_DENIED';end if;
 if operation not in ('CREATE','UPDATE') then raise exception 'UNSUPPORTED_OPERATION';end if;
 if resource='HOUSEHOLD_MEMBERS' then
  parent:=(patch->>'household_id')::uuid;contact:=(patch->>'contact_id')::uuid;
  if not public.import_reference_access('HOUSEHOLD',parent,true) or not public.import_reference_access('CONTACT',contact,false) then raise exception 'INVALID_REFERENCE';end if;
  table_name:='household_members';column_name:='household_id';fields:=array['household_id','contact_id','member_role','primary_contact'];
  perform pg_advisory_xact_lock(hashtextextended('membership:'||parent::text,0));
  select to_jsonb(m) into previous from public.household_members m where household_id=parent and contact_id=contact and workspace_id=public.current_workspace_id() for update;
  data:='{"primary_contact":false}'::jsonb;
 elsif resource='STUDENT_GUARDIANS' then
  parent:=(patch->>'student_id')::uuid;contact:=(patch->>'guardian_contact_id')::uuid;
  if not public.import_reference_access('STUDENT',parent,true) or not public.import_reference_access('CONTACT',contact,false) then raise exception 'INVALID_REFERENCE';end if;
  table_name:='student_guardian_relationships';column_name:='student_id';fields:=array['student_id','guardian_contact_id','relationship_type','primary_guardian','emergency_contact','legal_authority'];
  perform pg_advisory_xact_lock(hashtextextended('guardian:'||parent::text,0));
  select to_jsonb(g) into previous from public.student_guardian_relationships g where student_id=parent and guardian_contact_id=contact and workspace_id=public.current_workspace_id() for update;
  data:='{"primary_guardian":false,"emergency_contact":false}'::jsonb;
  if operation='CREATE' and not patch ? 'legal_authority' then raise exception 'REQUIRED';end if;
 elsif resource in ('ORGANIZATION_CONTACT_INTELLIGENCE','ORGANIZATION_CONTACT_RELATIONSHIPS','ORGANIZATION_CONTACT_ASSOCIATIONS') then
  parent:=(patch->>'organization_id')::uuid;contact:=coalesce((patch->>'contact_id')::uuid,(patch->>'source_contact_id')::uuid);
  if not public.import_reference_access('ORGANIZATION',parent,true) or not public.import_reference_access('CONTACT',contact,true) then raise exception 'INVALID_REFERENCE';end if;
  perform pg_advisory_xact_lock(hashtextextended('channel:'||public.current_workspace_id()::text||parent::text,0));
  if resource='ORGANIZATION_CONTACT_ASSOCIATIONS' then
   select to_jsonb(c) into previous from public.contacts c where id=contact for update;
   if previous->>'organization_id' is not null then raise exception 'UNSUPPORTED_REASSIGNMENT';end if;
   if operation='UPDATE' then raise exception 'UNSUPPORTED_OPERATION';end if;
   if expected is not null and previous->>'updated_at' is distinct from expected->>'updated_at' then raise exception 'STALE_TARGET';end if;
   return jsonb_build_object('id',contact,'data',patch,'previous',null,'updated_at',previous->'updated_at','siblings','[]'::jsonb);
  end if;
  if not exists(select 1 from public.contacts where id=contact and organization_id=parent) then raise exception 'INVALID_REFERENCE';end if;
  if resource='ORGANIZATION_CONTACT_INTELLIGENCE' then
   fields:=array['organization_id','contact_id','key_contact_status','decision_power_score','contribution_score','working_style_markdown','cooperation_notes','potential_notes'];
   select to_jsonb(i) into previous from public.organization_contact_intelligence i where contact_id=contact and workspace_id=public.current_workspace_id() for update;
   data:='{"key_contact_status":"UNKNOWN","decision_power_score":null,"contribution_score":null,"working_style_markdown":"","cooperation_notes":"","potential_notes":""}'::jsonb;
  else
   if not public.import_reference_access('CONTACT',(patch->>'target_contact_id')::uuid,false) or not exists(select 1 from public.contacts where id=(patch->>'target_contact_id')::uuid and organization_id=parent) or patch->>'target_contact_id'=patch->>'source_contact_id' then raise exception 'INVALID_REFERENCE';end if;
   if patch->>'relationship_type' in ('PEER','WORKS_WITH') then patch:=patch||jsonb_build_object('source_contact_id',least((patch->>'source_contact_id')::uuid,(patch->>'target_contact_id')::uuid),'target_contact_id',greatest((patch->>'source_contact_id')::uuid,(patch->>'target_contact_id')::uuid));end if;
   fields:=array['organization_id','source_contact_id','target_contact_id','relationship_type','status','note'];
   select to_jsonb(r) into previous from public.organization_contact_relationships r where organization_id=parent and relationship_type=patch->>'relationship_type' and status='ACTIVE' and
    (case when relationship_type in ('PEER','WORKS_WITH') then least(source_contact_id,target_contact_id) else source_contact_id end)=(patch->>'source_contact_id')::uuid and
    (case when relationship_type in ('PEER','WORKS_WITH') then greatest(source_contact_id,target_contact_id) else target_contact_id end)=(patch->>'target_contact_id')::uuid for update;
   data:='{"status":"ACTIVE","note":""}'::jsonb;
  end if;
 else raise exception 'UNSUPPORTED_OPERATION';end if;
 if exists(select 1 from jsonb_object_keys(patch) k where not k=any(fields)) then raise exception 'UNKNOWN_COLUMN';end if;
 if previous is not null and operation='CREATE' then raise exception 'DUPLICATE_REVIEW';end if;
 if previous is null and operation='UPDATE' then raise exception 'INVALID_REFERENCE';end if;
 if operation='UPDATE' and expected is not null and (previous->>'revision' is distinct from expected->>'revision' or previous->>'id' is distinct from expected->>'id') then raise exception 'STALE_TARGET';end if;
 if previous is not null then data:=data||(select jsonb_object_agg(k,previous->k) from unnest(fields) k);end if;
 data:=data||patch;identity:=coalesce((previous->>'id')::uuid,gen_random_uuid());
 if table_name is not null then execute format('select coalesce(jsonb_agg(to_jsonb(r) order by id),''[]'') from public.%I r where %I=$1 and workspace_id=$2',table_name,column_name) into siblings using parent,public.current_workspace_id();end if;
 if expected is not null and expected ? 'siblings' and (select coalesce(jsonb_agg(jsonb_build_object('id',v->'id','revision',v->'revision') order by v->>'id'),'[]') from jsonb_array_elements(siblings) v) is distinct from expected->'siblings' then raise exception 'STALE_TARGET';end if;
 return jsonb_build_object('id',identity,'revision',previous->'revision','data',data,'previous',case when previous is null then null else (select jsonb_object_agg(k,previous->k) from unnest(fields) k) end,'siblings',siblings);
end$$;
revoke all on function public.customer_relation_context(text,jsonb,text,jsonb) from public,crm_app,crm_system;

create function public.save_customer_relation(resource text,operation text,data jsonb,expected jsonb,p_request_key text) returns jsonb
language plpgsql security definer set search_path=public,app_auth,extensions as $$
declare context jsonb;result jsonb;receipt public.mutation_receipts;fingerprint text;siblings jsonb;parent uuid;entry record;
begin
 if not public.is_workspace_member(public.current_workspace_id()) or public.current_crm_role() not in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER','SALES_SPECIALIST','SALES_SUPPORT') then raise exception 'PERMISSION_DENIED';end if;
 if length(coalesce(p_request_key,'')) not between 8 and 120 then raise exception 'INVALID_REQUEST_KEY';end if;
 perform pg_advisory_xact_lock(hashtextextended('relation-receipt:'||public.current_workspace_id()::text||p_request_key,0));
 if operation='UPDATE' and (expected is null or not expected ? 'id' or not expected ? 'revision') then raise exception 'STALE_TARGET';end if;
 fingerprint:=encode(digest(jsonb_build_object('resource',resource,'operation',operation,'data',data,'expected',expected)::text,'sha256'),'hex');
 select * into receipt from public.mutation_receipts where workspace_id=public.current_workspace_id() and request_key=p_request_key;
 if found then
  if receipt.operation<>'RELATION_'||resource||'_'||operation or receipt.created_by<>app_auth.current_user_id() or receipt.result->>'hash'<>fingerprint then raise exception 'PAYLOAD_REUSE';end if;
  for entry in select * from public.relation_receipt_subjects where workspace_id=public.current_workspace_id() and request_key=p_request_key loop if not public.import_reference_access(entry.kind,entry.subject_id,false) then raise exception 'INVALID_REFERENCE';end if;end loop;
  return receipt.result->'item';
 end if;
 perform set_config('app.import_v2','1',true);
 context:=public.customer_relation_context(resource,data,operation,expected);data:=context->'data';
 if resource='HOUSEHOLD_MEMBERS' then result:=to_jsonb(public.save_household_member_before112((data->>'household_id')::uuid,(data->>'contact_id')::uuid,data->>'member_role',(data->>'primary_contact')::boolean));
 elsif resource='STUDENT_GUARDIANS' then result:=to_jsonb(public.save_student_guardian_before112((data->>'student_id')::uuid,(data->>'guardian_contact_id')::uuid,data->>'relationship_type',(data->>'primary_guardian')::boolean,(data->>'emergency_contact')::boolean,(data->>'legal_authority')::boolean));
 elsif resource='ORGANIZATION_CONTACT_INTELLIGENCE' then result:=public.save_organization_contact_intelligence((context->>'id')::uuid,(context->>'revision')::integer,data,left(p_request_key,100)||':domain');
 elsif resource='ORGANIZATION_CONTACT_RELATIONSHIPS' then result:=public.save_organization_contact_relationship((context->>'id')::uuid,(context->>'revision')::integer,data,left(p_request_key,100)||':domain');
 else result:=public.assign_contact_organization((data->>'contact_id')::uuid,(data->>'organization_id')::uuid,(context->>'updated_at')::timestamptz,left(p_request_key,100)||':domain');end if;
 if resource='HOUSEHOLD_MEMBERS' then select coalesce(jsonb_agg(jsonb_build_object('id',id,'revision',revision) order by id),'[]') into siblings from public.household_members where household_id=(data->>'household_id')::uuid;
 elsif resource='STUDENT_GUARDIANS' then select coalesce(jsonb_agg(jsonb_build_object('id',id,'revision',revision) order by id),'[]') into siblings from public.student_guardian_relationships where student_id=(data->>'student_id')::uuid;else siblings:='[]';end if;
 result:=jsonb_build_object('id',result->'id','revision',result->'revision','updated_at',result->'updated_at','data',data,'before',context->'previous','siblings_before',context->'siblings','siblings',siblings,'request_key',p_request_key);
 for entry in select key,value from jsonb_each_text(data) where key in ('household_id','contact_id','student_id','guardian_contact_id','organization_id','source_contact_id','target_contact_id') loop
  insert into public.relation_receipt_subjects values(public.current_workspace_id(),p_request_key,case entry.key when 'household_id' then 'HOUSEHOLD' when 'student_id' then 'STUDENT' when 'organization_id' then 'ORGANIZATION' else 'CONTACT' end,entry.value::uuid) on conflict do nothing;
 end loop;
 insert into public.mutation_receipts(workspace_id,request_key,operation,result,created_by) values(public.current_workspace_id(),p_request_key,'RELATION_'||resource||'_'||operation,jsonb_build_object('hash',fingerprint,'item',result-'data'-'before'-'siblings_before'),app_auth.current_user_id());
 -- The wrapper's minimal payload-bound receipt owns retry. Nested channel receipts otherwise
 -- retain the full narrative beyond the bounded import evidence lifetime.
 delete from public.mutation_receipts where workspace_id=public.current_workspace_id() and created_by=app_auth.current_user_id() and request_key=left(p_request_key,100)||':domain';
 insert into public.audit_events(workspace_id,actor_id,entity_type,entity_id,action,after_data) values(public.current_workspace_id(),app_auth.current_user_id(),'CUSTOMER_RELATION',(result->>'id')::uuid,'RELATION_'||operation,jsonb_build_object('resource',resource,'revision',result->'revision'));
 return result;
end$$;
revoke all on function public.save_customer_relation(text,text,jsonb,jsonb,text) from public,crm_system;
grant execute on function public.save_customer_relation(text,text,jsonb,jsonb,text) to crm_app;

-- Legacy forms retain their original upsert interface, but now advance the same revisions and
-- authorize both parents. Versioned batch callers always supply their observed expected state.
create function public.save_household_member(target_household uuid,target_contact uuid,member_role_value text,is_primary boolean) returns public.household_members
language plpgsql security definer set search_path=public,app_auth as $$declare previous jsonb;result jsonb;begin
 select jsonb_build_object('id',id,'revision',revision) into previous from public.household_members where household_id=target_household and contact_id=target_contact;
 result:=public.save_customer_relation('HOUSEHOLD_MEMBERS',case when previous is null then 'CREATE' else 'UPDATE' end,jsonb_build_object('household_id',target_household,'contact_id',target_contact,'member_role',upper(trim(member_role_value)),'primary_contact',is_primary),previous,gen_random_uuid()::text);
 return (select r from public.household_members r where id=(result->>'id')::uuid);end$$;
create function public.save_student_guardian(target_student uuid,target_contact uuid,relationship_value text,is_primary boolean,is_emergency boolean,has_legal_authority boolean) returns public.student_guardian_relationships
language plpgsql security definer set search_path=public,app_auth as $$declare previous jsonb;result jsonb;begin
 select jsonb_build_object('id',id,'revision',revision) into previous from public.student_guardian_relationships where student_id=target_student and guardian_contact_id=target_contact;
 result:=public.save_customer_relation('STUDENT_GUARDIANS',case when previous is null then 'CREATE' else 'UPDATE' end,jsonb_build_object('student_id',target_student,'guardian_contact_id',target_contact,'relationship_type',upper(trim(relationship_value)),'primary_guardian',is_primary,'emergency_contact',is_emergency,'legal_authority',has_legal_authority),previous,gen_random_uuid()::text);
 return (select r from public.student_guardian_relationships r where id=(result->>'id')::uuid);end$$;
revoke all on function public.save_household_member(uuid,uuid,text,boolean),public.save_student_guardian(uuid,uuid,text,boolean,boolean,boolean) from public,crm_system;
grant execute on function public.save_household_member(uuid,uuid,text,boolean),public.save_student_guardian(uuid,uuid,text,boolean,boolean,boolean) to crm_app;

create function public.import_set_access(set_id uuid) returns boolean language plpgsql stable security definer set search_path=public,app_auth as $$
declare s public.import_sets;ref record;begin
 select * into s from public.import_sets where id=set_id;
 if s.id is null or s.workspace_id<>public.current_workspace_id() or s.created_by<>app_auth.current_user_id() or s.expires_at<=now() or s.status='ERASED' or not public.is_workspace_member(s.workspace_id) or public.current_crm_role() not in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER') then return false;end if;
 for ref in select distinct x.kind,x.subject_id from public.import_row_subjects x join public.import_rows r on r.id=x.row_id join public.import_batches b on b.id=r.batch_id where b.import_set_id=s.id loop
  if not public.import_reference_access(ref.kind,ref.subject_id,false) then return false;end if;
 end loop;return true;
end$$;
revoke all on function public.import_set_access(uuid) from public,crm_system;
grant execute on function public.import_set_access(uuid) to crm_app;
do $$declare t text;begin foreach t in array array['import_sets','import_set_aliases','import_set_dependencies','import_row_subjects','relation_receipt_subjects'] loop execute format('alter table public.%I enable row level security',t);execute format('revoke all on public.%I from public,crm_app,crm_system,crm_worker',t);end loop;end$$;
create policy set_batch_read on public.import_batches as restrictive for select to crm_app using(import_set_id is null or public.import_set_access(import_set_id));
create policy set_row_read on public.import_rows as restrictive for select to crm_app using(not privacy_erased and not exists(select 1 from public.import_batches b where b.id=batch_id and b.import_set_id is not null and not public.import_set_access(b.import_set_id)));

create function public.create_import_set(set_name text,p_request_key text) returns jsonb language plpgsql security definer set search_path=public,app_auth,extensions as $$
declare s public.import_sets;fingerprint text;begin
 if not public.is_workspace_member(public.current_workspace_id()) or public.current_crm_role() not in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER') then raise exception 'PERMISSION_DENIED';end if;
 if length(trim(set_name)) not between 1 and 80 or length(p_request_key) not between 8 and 120 then raise exception 'INVALID_INPUT';end if;
 fingerprint:=encode(digest(jsonb_build_object('actor',app_auth.current_user_id(),'name',set_name)::text,'sha256'),'hex');
 insert into public.import_sets(workspace_id,created_by,name,request_key,payload_sha256) values(public.current_workspace_id(),app_auth.current_user_id(),set_name,p_request_key,fingerprint) on conflict(workspace_id,request_key) do nothing returning * into s;
 if s.id is null then select * into s from public.import_sets where workspace_id=public.current_workspace_id() and request_key=p_request_key;if s.created_by<>app_auth.current_user_id() or s.payload_sha256<>fingerprint then raise exception 'PAYLOAD_REUSE';end if;if not public.import_set_access(s.id) then raise exception 'INVALID_REFERENCE';end if;end if;
 return to_jsonb(s)-'payload_sha256'-'request_key';end$$;
revoke all on function public.create_import_set(text,text) from public,crm_system;
grant execute on function public.create_import_set(text,text) to crm_app;

-- Placeholder replaced by the typed relation registry before this migration is frozen.
create function public.import_relation_catalog() returns jsonb language sql immutable as $$select '{"ORGANIZATION_CONTACT_ASSOCIATIONS":[{"key":"organizationReference","column":"organization_id","type":"reference","kind":"ORGANIZATION","required":true},{"key":"contactReference","column":"contact_id","type":"reference","kind":"CONTACT","required":true}],"HOUSEHOLD_MEMBERS":[{"key":"householdReference","column":"household_id","type":"reference","kind":"HOUSEHOLD","required":true},{"key":"contactReference","column":"contact_id","type":"reference","kind":"CONTACT","required":true},{"key":"memberRole","column":"member_role","type":"enum","values":["PARENT","GUARDIAN","STUDENT","PAYER","OTHER"],"required":true},{"key":"primaryContact","column":"primary_contact","type":"boolean","default":false}],"STUDENT_GUARDIANS":[{"key":"studentReference","column":"student_id","type":"reference","kind":"STUDENT","required":true},{"key":"guardianContactReference","column":"guardian_contact_id","type":"reference","kind":"CONTACT","required":true},{"key":"relationship","column":"relationship_type","type":"enum","values":["MOTHER","FATHER","GUARDIAN","RELATIVE","OTHER"],"required":true},{"key":"primaryGuardian","column":"primary_guardian","type":"boolean","default":false},{"key":"emergencyContact","column":"emergency_contact","type":"boolean","default":false},{"key":"legalAuthority","column":"legal_authority","type":"boolean","required":true,"sensitive":true}],"ORGANIZATION_CONTACT_INTELLIGENCE":[{"key":"organizationReference","column":"organization_id","type":"reference","kind":"ORGANIZATION","required":true},{"key":"contactReference","column":"contact_id","type":"reference","kind":"CONTACT","required":true},{"key":"keyContactStatus","column":"key_contact_status","type":"enum","values":["UNKNOWN","KEY","NON_KEY"],"default":"UNKNOWN"},{"key":"decisionPowerScore","column":"decision_power_score","type":"integer","max":100},{"key":"contributionScore","column":"contribution_score","type":"integer","max":100},{"key":"workingStyleMarkdown","column":"working_style_markdown","type":"text","max":10000,"sensitive":true},{"key":"cooperationNotes","column":"cooperation_notes","type":"text","max":10000,"sensitive":true},{"key":"potentialNotes","column":"potential_notes","type":"text","max":10000,"sensitive":true}],"ORGANIZATION_CONTACT_RELATIONSHIPS":[{"key":"organizationReference","column":"organization_id","type":"reference","kind":"ORGANIZATION","required":true},{"key":"sourceContactReference","column":"source_contact_id","type":"reference","kind":"CONTACT","required":true},{"key":"targetContactReference","column":"target_contact_id","type":"reference","kind":"CONTACT","required":true},{"key":"relationshipType","column":"relationship_type","type":"enum","values":["REPORTS_TO","INFLUENCES","ASSISTANT_TO","PEER","WORKS_WITH","OTHER"],"required":true},{"key":"note","column":"note","type":"text","max":2000,"sensitive":true},{"key":"status","column":"status","type":"enum","values":["ACTIVE","INACTIVE"],"default":"ACTIVE"}]}'::jsonb$$;
revoke all on function public.import_relation_catalog() from public,crm_app,crm_system;

create function public.add_import_set_batch(set_id uuid,expected_revision integer,p_request_key text,resource text,filename text,content_hash text,headers jsonb,rows jsonb) returns jsonb
language plpgsql security definer set search_path=public,app_auth,extensions as $$
declare s public.import_sets;b public.import_batches;item jsonb;ordinal integer:=0;fingerprint text;kind text;expected_headers jsonb;ref jsonb;field jsonb;new_row_id uuid;
begin
 if not public.import_set_access(set_id) then raise exception 'INVALID_REFERENCE';end if;
 select * into s from public.import_sets where id=set_id for update;
 fingerprint:=encode(digest(jsonb_build_object('set',set_id,'actor',app_auth.current_user_id(),'resource',resource,'filename',filename,'hash',content_hash,'headers',headers,'rows',rows)::text,'sha256'),'hex');
 select * into b from public.import_batches where workspace_id=s.workspace_id and idempotency_key=p_request_key;
 if found then if b.import_set_id<>s.id or b.created_by<>s.created_by or b.payload_sha256<>fingerprint then raise exception 'PAYLOAD_REUSE';end if;return jsonb_build_object('id',b.id,'setId',s.id,'revision',s.revision);end if;
 if s.revision<>expected_revision then raise exception 'STALE_TARGET';end if;
 if s.status in ('ROLLED_BACK','PARTIAL_ROLLBACK') or jsonb_array_length(rows) not between 1 and 1000 or length(filename) not between 1 and 180 or content_hash!~'^[a-f0-9]{64}$' or length(p_request_key) not between 8 and 120 then raise exception 'INVALID_INPUT';end if;
 if (select count(*) from public.import_batches where import_set_id=s.id)>=20 or (select count(*) from public.import_rows r join public.import_batches t on t.id=r.batch_id where t.import_set_id=s.id)+jsonb_array_length(rows)>2000 then raise exception 'IMPORT_SET_LIMIT';end if;
 if public.import_v2_catalog() ? resource then
  kind:=case resource when 'ORGANIZATIONS' then 'ORGANIZATION' when 'HOUSEHOLDS' then 'HOUSEHOLD' when 'CONTACTS' then 'CONTACT' else 'STUDENT' end;
  expected_headers:='["operation","targetReference","alias"]'::jsonb||(select jsonb_agg(f->'key') from jsonb_array_elements(public.import_v2_catalog()->resource) f);
 elsif public.import_relation_catalog() ? resource then expected_headers:='["operation"]'::jsonb||(select jsonb_agg(f->'key') from jsonb_array_elements(public.import_relation_catalog()->resource) f);
 else raise exception 'UNSUPPORTED_OPERATION';end if;
 if headers<>expected_headers then raise exception 'TEMPLATE_SCHEMA_INVALID';end if;
 perform set_config('app.import_v2','1',true);
 insert into public.import_batches(workspace_id,resource_type,original_filename,file_hash,idempotency_key,field_mapping,created_by,template_version,execution_contract,payload_sha256,evidence_expires_at,import_set_id)
 values(s.workspace_id,resource,filename,content_hash,p_request_key,jsonb_build_object('headers',headers),s.created_by,'SET_V1','IMPORT_SET_V1',fingerprint,s.expires_at,s.id) returning * into b;
 for item in select value from jsonb_array_elements(rows) loop
  ordinal:=ordinal+1;
  if item->>'operation' not in ('CREATE','UPDATE','SKIP') or jsonb_typeof(item->'patch')<>'object' or jsonb_typeof(item->'profile')<>'object' or jsonb_typeof(item->'errors')<>'array' then raise exception 'TEMPLATE_SCHEMA_INVALID';end if;
  insert into public.import_rows(workspace_id,batch_id,row_number,raw_data,normalized_data,source_location,status,decision,set_sequence,errors)
  values(s.workspace_id,b.id,ordinal,item,item,item->'location',case when item->'errors'='[]' then 'PENDING' else 'INVALID' end,item->>'operation',ordinal,item->'errors') returning id into new_row_id;
  if nullif(item->>'alias','') is not null then
   if kind is null or item->>'alias'!~('^@'||lower(kind)||':[a-z0-9][a-z0-9_-]{0,59}$') then raise exception 'INVALID_ALIAS';end if;
   if exists(select 1 from public.import_set_aliases where import_set_aliases.set_id=s.id and alias=item->>'alias') then raise exception 'ALIAS_CONFLICT';end if;
   insert into public.import_set_aliases(set_id,alias,resource,row_id) values(s.id,item->>'alias',kind,new_row_id);
  end if;
 end loop;
 update public.import_sets set revision=revision+1,status='DRAFT',updated_at=clock_timestamp() where id=s.id returning * into s;
 return jsonb_build_object('setId',s.id,'revision',s.revision);
end$$;
revoke all on function public.add_import_set_batch(uuid,integer,text,text,text,text,jsonb,jsonb) from public,crm_system;
grant execute on function public.add_import_set_batch(uuid,integer,text,text,text,text,jsonb,jsonb) to crm_app;

create function public.import_set_reference(set_id uuid,value text,kind text,edit boolean default false) returns uuid
language plpgsql security definer set search_path=public,app_auth as $$declare identity uuid;a public.import_set_aliases;begin
 if value like '@%' then
  if value!~('^@'||lower(kind)||':[a-z0-9][a-z0-9_-]{0,59}$') then raise exception 'INVALID_REFERENCE';end if;
  select * into a from public.import_set_aliases where import_set_aliases.set_id=import_set_reference.set_id and alias=value and resource=kind;
  if a.row_id is null then raise exception 'INVALID_REFERENCE';end if;
  if a.status<>'RESOLVED' then raise exception 'BLOCKED_DEPENDENCY';end if;identity:=a.record_id;
 else identity:=public.resolve_import_reference(value,kind,edit);end if;
 if not public.import_reference_access(kind,identity,edit) then raise exception 'INVALID_REFERENCE';end if;return identity;
end$$;
revoke all on function public.import_set_reference(uuid,text,text,boolean) from public,crm_app,crm_system;

create function public.import_set_resolve_row(set_id uuid,resource text,item jsonb) returns jsonb
language plpgsql security definer set search_path=public,app_auth,extensions as $$
declare output jsonb:=item;field jsonb;fields jsonb;key text;path text[];value text;kind text;identity uuid;entity boolean:=public.import_v2_catalog() ? resource;
begin
 fields:=case when entity then public.import_v2_catalog()->resource else public.import_relation_catalog()->resource end;
 if fields is null then raise exception 'UNSUPPORTED_OPERATION';end if;
 for field in select v from jsonb_array_elements(fields) v where v->>'type'='reference' loop
  key:=field->>'key';
  path:=case when not entity then array['patch',field->>'column'] when key like 'profile.%' then array['profile',substr(key,9)] else array['patch',key] end;
  value:=output#>>path;if value is null then continue;end if;
  kind:=case when not entity then field->>'kind' when key='householdId' then 'HOUSEHOLD' when key in ('personId','profile.primary_contact_id') then 'CONTACT' when key='ownerId' then 'STAFF' else 'ORGANIZATION' end;
  identity:=public.import_set_reference(set_id,value,kind,kind='STAFF');
  output:=jsonb_set(output,path,to_jsonb(case when entity then public.issue_import_reference(kind,identity) else identity::text end));
 end loop;
 if entity and nullif(item->>'targetReference','') is not null then
  kind:=case resource when 'ORGANIZATIONS' then 'ORGANIZATION' when 'HOUSEHOLDS' then 'HOUSEHOLD' when 'CONTACTS' then 'CONTACT' else 'STUDENT' end;
  identity:=public.import_set_reference(set_id,item->>'targetReference',kind,true);output:=output||jsonb_build_object('targetReference',public.issue_import_reference(kind,identity));
 end if;
 return output;
end$$;
revoke all on function public.import_set_resolve_row(uuid,text,jsonb) from public,crm_app,crm_system;

create function public.import_set_probe(set_id uuid,resource text,item jsonb) returns jsonb
language plpgsql security definer set search_path=public,app_auth,extensions as $$declare context jsonb;resolved jsonb;result jsonb;begin
 begin
  resolved:=public.import_set_resolve_row(set_id,resource,item);
  if item->>'operation'='SKIP' then result:=jsonb_build_object('operation','SKIP');
  elsif public.import_v2_catalog() ? resource then result:=public.import_v2_preflight(resource,resolved);
  else
   context:=public.customer_relation_context(resource,resolved->'patch',item->>'operation');
   context:=context||jsonb_build_object('siblings',(select coalesce(jsonb_agg(jsonb_build_object('id',v->'id','revision',v->'revision') order by v->>'id'),'[]') from jsonb_array_elements(context->'siblings') v));
   perform public.save_customer_relation(resource,item->>'operation',resolved->'patch',context,'probe:'||gen_random_uuid()::text);
   result:=context-'data'-'previous';
  end if;
  -- Roll back protocol tokens as well as canonical/audit/receipt effects.
  raise exception using errcode='PZ003';
 exception when sqlstate 'PZ003' then null;end;return result;
end$$;
revoke all on function public.import_set_probe(uuid,text,jsonb) from public,crm_app,crm_system;

create function public.import_set_build_graph(set_id uuid) returns void language plpgsql security definer set search_path=public as $$
declare row public.import_rows;ref jsonb;provider uuid;level integer:=0;changed integer;begin
 delete from public.import_set_dependencies where import_set_dependencies.set_id=import_set_build_graph.set_id;
 for row in select r.* from public.import_rows r join public.import_batches b on b.id=r.batch_id where b.import_set_id=set_id loop
  for ref in select value from jsonb_array_elements(coalesce(row.normalized_data->'references','[]')) loop
   if ref->>'value' like '@%' then
    select row_id into provider from public.import_set_aliases a where a.set_id=import_set_build_graph.set_id and a.alias=ref->>'value' and a.resource=ref->>'kind';
    if provider is null then raise exception 'INVALID_REFERENCE';end if;
    insert into public.import_set_dependencies values(set_id,row.id,provider) on conflict do nothing;
   end if;
  end loop;
 end loop;
 -- Existing standalone Contacts may be assigned within this Set before their intelligence/relations.
 insert into public.import_set_dependencies
 select set_id,child.id,parent.id from public.import_rows child join public.import_batches cb on cb.id=child.batch_id
 join public.import_batches pb on pb.import_set_id=cb.import_set_id and pb.resource_type='ORGANIZATION_CONTACT_ASSOCIATIONS'
 join public.import_rows parent on parent.batch_id=pb.id
 where cb.import_set_id=set_id and cb.resource_type in ('ORGANIZATION_CONTACT_INTELLIGENCE','ORGANIZATION_CONTACT_RELATIONSHIPS')
 and child.normalized_data->'patch'->>'organization_id'=parent.normalized_data->'patch'->>'organization_id'
 and parent.normalized_data->'patch'->>'contact_id' in (child.normalized_data->'patch'->>'contact_id',child.normalized_data->'patch'->>'source_contact_id',child.normalized_data->'patch'->>'target_contact_id') on conflict do nothing;
 update public.import_rows r set set_sequence=0 from public.import_batches b where b.id=r.batch_id and b.import_set_id=set_id;
 loop
  level:=level+1;
  update public.import_rows r set set_sequence=level from public.import_batches b where b.id=r.batch_id and b.import_set_id=set_id and r.set_sequence=0
   and not exists(select 1 from public.import_set_dependencies d join public.import_rows p on p.id=d.parent_row_id where d.row_id=r.id and p.set_sequence=0);
  get diagnostics changed=row_count;
  exit when not exists(select 1 from public.import_rows r join public.import_batches b on b.id=r.batch_id where b.import_set_id=set_id and r.set_sequence=0);
  if changed=0 or level>=2000 then raise exception 'DEPENDENCY_CYCLE';end if;
 end loop;
end$$;
revoke all on function public.import_set_build_graph(uuid) from public,crm_app,crm_system;

create function public.import_set_refresh(set_id uuid) returns void language plpgsql security definer set search_path=public as $$begin
 update public.import_batches b set total_rows=(select count(*) from public.import_rows where batch_id=b.id),valid_rows=(select count(*) from public.import_rows where batch_id=b.id and status='VALID'),
 invalid_rows=(select count(*) from public.import_rows where batch_id=b.id and status='INVALID'),duplicate_rows=(select count(*) from public.import_rows where batch_id=b.id and status='DUPLICATE'),
 applied_rows=(select count(*) from public.import_rows where batch_id=b.id and status='APPLIED'),failed_rows=(select count(*) from public.import_rows where batch_id=b.id and status='FAILED'),
 status=case when exists(select 1 from public.import_rows where batch_id=b.id and status in ('INVALID','FAILED')) then 'PARTIAL_FAILED' when exists(select 1 from public.import_rows where batch_id=b.id and status='DUPLICATE') then 'NEEDS_DECISION'
 when exists(select 1 from public.import_rows where batch_id=b.id and status in ('PENDING','VALID','DECIDED')) then 'READY' when not exists(select 1 from public.import_rows where batch_id=b.id and status<>'ROLLED_BACK') then 'ROLLED_BACK' else 'COMPLETED' end
 where b.import_set_id=set_id;
 update public.import_sets s set status=case
 when exists(select 1 from public.import_rows r join public.import_batches b on b.id=r.batch_id where b.import_set_id=s.id and r.status in ('INVALID','FAILED')) then 'PARTIAL_FAILED'
 when exists(select 1 from public.import_rows r join public.import_batches b on b.id=r.batch_id where b.import_set_id=s.id and r.status='DUPLICATE') then 'NEEDS_REVIEW'
 when exists(select 1 from public.import_rows r join public.import_batches b on b.id=r.batch_id where b.import_set_id=s.id and r.status in ('PENDING','VALID','DECIDED')) then 'READY'
 when exists(select 1 from public.import_rows r join public.import_batches b on b.id=r.batch_id where b.import_set_id=s.id and r.status='ROLLED_BACK') and not exists(select 1 from public.import_rows r join public.import_batches b on b.id=r.batch_id where b.import_set_id=s.id and r.status not in ('ROLLED_BACK','SKIPPED')) then 'ROLLED_BACK'
 else 'COMPLETED' end where s.id=set_id and s.status<>'ERASED';
end$$;
revoke all on function public.import_set_refresh(uuid) from public,crm_app,crm_system;

create function public.import_set_summary(set_id uuid) returns jsonb language plpgsql stable security definer set search_path=public,app_auth as $$
declare result jsonb;begin
 if not public.import_set_access(set_id) then raise exception 'INVALID_REFERENCE';end if;
 select to_jsonb(s)-'payload_sha256'-'request_key' into result from public.import_sets s where id=set_id;
 return result||jsonb_build_object('batches',(select coalesce(jsonb_agg(jsonb_build_object('id',b.id,'resource',b.resource_type,'filename',b.original_filename,'status',b.status,'total',b.total_rows,'applied',b.applied_rows) order by b.created_at,b.id),'[]') from public.import_batches b where b.import_set_id=set_id),
 'rows',(select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'batchId',b.id,'resource',b.resource_type,'row',r.source_location->'row','sheet',r.source_location->'sheet','status',r.status,'revision',r.review_revision,'operation',r.decision,'alias',r.normalized_data->'alias','normalized',r.normalized_data,'errors',r.errors,'error',r.last_error,'level',r.set_sequence) order by r.set_sequence,b.created_at,r.row_number),'[]') from public.import_rows r join public.import_batches b on b.id=r.batch_id where b.import_set_id=set_id),
 'aliases',(select coalesce(jsonb_agg(jsonb_build_object('alias',a.alias,'resource',a.resource,'status',a.status,'rowId',a.row_id) order by a.alias),'[]') from public.import_set_aliases a where a.set_id=import_set_summary.set_id),
 'dependencies',(select coalesce(jsonb_agg(jsonb_build_object('row',d.row_id,'parent',d.parent_row_id)),'[]') from public.import_set_dependencies d where d.set_id=import_set_summary.set_id));
end$$;
revoke all on function public.import_set_summary(uuid) from public,crm_system;
grant execute on function public.import_set_summary(uuid) to crm_app;
create function public.list_import_sets() returns jsonb language sql stable security definer set search_path=public as $$select coalesce(jsonb_agg(x),'[]') from(select id,name,status,revision,created_at from public.import_sets where public.import_set_access(id) order by created_at desc,id limit 20)x$$;
revoke all on function public.list_import_sets() from public,crm_system;grant execute on function public.list_import_sets() to crm_app;

create function public.preflight_import_set(set_id uuid,expected_revision integer) returns jsonb language plpgsql security definer set search_path=public,app_auth,extensions as $$
declare s public.import_sets;r record;probe jsonb;code text;begin
 if not public.import_set_access(set_id) then raise exception 'INVALID_REFERENCE';end if;
 select * into s from public.import_sets where id=set_id for update;if s.revision<>expected_revision then raise exception 'STALE_TARGET';end if;
 if s.status in ('ROLLED_BACK','PARTIAL_ROLLBACK') then raise exception 'IMPORT_NOT_READY';end if;
 perform set_config('app.import_v2','1',true);perform public.import_set_build_graph(set_id);
 for r in select t.*,b.resource_type from public.import_rows t join public.import_batches b on b.id=t.batch_id where b.import_set_id=set_id and t.status not in ('APPLIED','ROLLED_BACK','SKIPPED') order by t.set_sequence,b.created_at,t.row_number loop
  if r.normalized_data->'errors'<>'[]' then update public.import_rows set status='INVALID',errors=r.normalized_data->'errors' where id=r.id;continue;end if;
  begin
   if exists(select 1 from public.import_set_dependencies d join public.import_rows p on p.id=d.parent_row_id where d.row_id=r.id and p.status not in ('APPLIED','SKIPPED')) then raise exception 'BLOCKED_DEPENDENCY';end if;
   probe:=public.import_set_probe(set_id,r.resource_type,r.normalized_data);
   if probe->>'operation'='DUPLICATE_REVIEW' then raise exception 'DUPLICATE_REVIEW';end if;
   update public.import_rows set status='VALID',normalized_data=normalized_data||jsonb_build_object('expected',probe),errors='[]',last_error=null,target_revision=coalesce(probe->>'revision',probe->>'updated_at') where id=r.id;
  exception when others then
   code:=case when sqlerrm in ('BLOCKED_DEPENDENCY','DUPLICATE_REVIEW','UNSUPPORTED_REASSIGNMENT','INVALID_REFERENCE','STALE_TARGET','REQUIRED') then sqlerrm else public.import_v2_error(sqlerrm) end;
   update public.import_rows set status=case code when 'BLOCKED_DEPENDENCY' then 'PENDING' when 'DUPLICATE_REVIEW' then 'DUPLICATE' else 'INVALID' end,last_error=code,errors=jsonb_build_array(jsonb_build_object('code',code,'field','row')||r.source_location) where id=r.id;
  end;
 end loop;
 update public.import_sets set revision=revision+1,updated_at=clock_timestamp() where id=set_id;perform public.import_set_refresh(set_id);return public.import_set_summary(set_id);
end$$;
revoke all on function public.preflight_import_set(uuid,integer) from public,crm_system;grant execute on function public.preflight_import_set(uuid,integer) to crm_app;

create function public.execute_import_set(set_id uuid,expected_revision integer,max_rows integer default 50) returns jsonb language plpgsql security definer set search_path=public,app_auth,extensions as $$
declare s public.import_sets;r record;resolved jsonb;probe jsonb;result jsonb;identity uuid;code text;attempted integer:=0;begin
 if not public.import_set_access(set_id) then raise exception 'INVALID_REFERENCE';end if;
 select * into s from public.import_sets where id=set_id for update;if s.revision<>expected_revision then raise exception 'STALE_TARGET';end if;
 if s.status in ('DRAFT','ROLLED_BACK','PARTIAL_ROLLBACK') then raise exception 'IMPORT_NOT_READY';end if;
 perform set_config('app.import_v2','1',true);
 for r in select t.*,b.resource_type from public.import_rows t join public.import_batches b on b.id=t.batch_id where b.import_set_id=set_id and t.status in ('VALID','PENDING') and t.normalized_data->'errors'='[]'
 order by t.set_sequence,b.created_at,t.row_number for update of t loop
  exit when attempted>=greatest(1,least(max_rows,100));
  if exists(select 1 from public.import_set_dependencies d join public.import_rows p on p.id=d.parent_row_id where d.row_id=r.id and p.status not in ('APPLIED','SKIPPED')) then continue;end if;
  attempted:=attempted+1;
  begin
   resolved:=public.import_set_resolve_row(set_id,r.resource_type,r.normalized_data);
   probe:=r.normalized_data->'expected';
   if probe is null then probe:=public.import_set_probe(set_id,r.resource_type,r.normalized_data);end if;
   identity:=null;
   if r.decision='SKIP' then
    if nullif(r.normalized_data->>'alias','') is not null then identity:=public.import_set_reference(set_id,r.normalized_data->>'targetReference',case r.resource_type when 'ORGANIZATIONS' then 'ORGANIZATION' when 'HOUSEHOLDS' then 'HOUSEHOLD' when 'CONTACTS' then 'CONTACT' else 'STUDENT' end,false);
     update public.import_set_aliases set record_id=identity,status='RESOLVED' where row_id=r.id;end if;
    update public.import_rows set status='SKIPPED',applied_entity_id=identity where id=r.id;continue;
   end if;
   if public.import_v2_catalog() ? r.resource_type then result:=public.import_v2_apply(r.resource_type,resolved,probe);
   else result:=public.save_customer_relation(r.resource_type,r.decision,resolved->'patch',probe,'set-row:'||r.id::text||':'||r.review_revision);end if;
   update public.import_rows set status='APPLIED',normalized_data=normalized_data||jsonb_build_object('expected',probe),applied_entity_id=(result->>'id')::uuid,before_snapshot=case when r.decision='UPDATE' then result->'before' else null end,after_snapshot=result-'before',applied_at=clock_timestamp(),errors='[]',last_error=null where id=r.id;
   if nullif(r.normalized_data->>'alias','') is not null then update public.import_set_aliases set record_id=(result->>'id')::uuid,status='RESOLVED' where row_id=r.id;end if;
  exception when others then
   code:=case when sqlerrm in ('BLOCKED_DEPENDENCY','DUPLICATE_REVIEW','UNSUPPORTED_REASSIGNMENT','INVALID_REFERENCE','STALE_TARGET','REQUIRED') then sqlerrm else public.import_v2_error(sqlerrm) end;
   update public.import_rows set status=case code when 'BLOCKED_DEPENDENCY' then 'PENDING' when 'DUPLICATE_REVIEW' then 'DUPLICATE' else 'FAILED' end,last_error=code where id=r.id;
   update public.import_set_aliases set status='FAILED' where row_id=r.id and status<>'RESOLVED';
  end;
 end loop;
 update public.import_sets set revision=revision+1,updated_at=clock_timestamp() where id=set_id;perform public.import_set_refresh(set_id);return public.import_set_summary(set_id);
end$$;
revoke all on function public.execute_import_set(uuid,integer,integer) from public,crm_system;grant execute on function public.execute_import_set(uuid,integer,integer) to crm_app;

create function public.repair_import_set_row(set_id uuid,row_id uuid,expected_revision integer,row_revision integer,replacement jsonb) returns jsonb language plpgsql security definer set search_path=public,app_auth as $$
declare s public.import_sets;r public.import_rows;b public.import_batches;a public.import_set_aliases;begin
 if not public.import_set_access(set_id) then raise exception 'INVALID_REFERENCE';end if;
 select * into s from public.import_sets where id=set_id for update;if s.revision<>expected_revision then raise exception 'STALE_TARGET';end if;
 select t.* into r from public.import_rows t join public.import_batches x on x.id=t.batch_id where t.id=row_id and x.import_set_id=set_id for update of t;
 if r.id is null or r.review_revision<>row_revision then raise exception 'STALE_TARGET';end if;
 if r.status in ('APPLIED','ROLLED_BACK','SKIPPED') or s.status in ('ROLLED_BACK','PARTIAL_ROLLBACK') then raise exception 'IMPORT_NOT_READY';end if;
 if replacement->>'alias' is distinct from r.normalized_data->>'alias' then raise exception 'ALIAS_CONFLICT';end if;
 perform set_config('app.import_v2','1',true);
 update public.import_rows set raw_data=replacement,normalized_data=replacement,review_revision=review_revision+1,status='PENDING',errors=replacement->'errors',last_error=null where id=row_id;
 update public.import_set_aliases set status='PENDING' where import_set_aliases.row_id=repair_import_set_row.row_id and status='FAILED';
 return public.preflight_import_set(set_id,expected_revision);
end$$;
revoke all on function public.repair_import_set_row(uuid,uuid,integer,integer,jsonb) from public,crm_system;grant execute on function public.repair_import_set_row(uuid,uuid,integer,integer,jsonb) to crm_app;

-- Reuse the v2 guarded rollback algorithm one row at a time, not a cross-file ACID undo.
create function public.rollback_customer_import_row(resource text,item public.import_rows) returns void language plpgsql security definer set search_path=public,app_auth as $$
declare table_name text;current_row jsonb;dependency record;has_dependency boolean;profile_revision jsonb;begin
 if item.before_snapshot is not null then perform public.import_v2_apply(resource,jsonb_build_object('operation','UPDATE','targetReference',item.applied_entity_id,'patch',item.before_snapshot->'patch','profile',item.before_snapshot->'profile'),item.after_snapshot,true);return;end if;
 table_name:=case resource when 'ORGANIZATIONS' then 'organizations' when 'HOUSEHOLDS' then 'households' when 'CONTACTS' then 'contacts' when 'STUDENTS' then 'students' end;
 if table_name is null or not public.import_reference_access(case resource when 'ORGANIZATIONS' then 'ORGANIZATION' when 'HOUSEHOLDS' then 'HOUSEHOLD' when 'CONTACTS' then 'CONTACT' else 'STUDENT' end,item.applied_entity_id,true) then raise exception 'INVALID_REFERENCE';end if;
 execute format('select to_jsonb(r) from public.%I r where id=$1 for update',table_name) into current_row using item.applied_entity_id;
 if current_row->>'updated_at' is distinct from item.after_snapshot->>'updated_at' then raise exception 'STALE_TARGET';end if;
 for dependency in select c.conrelid::regclass as relation,a.attname as column_name from pg_constraint c join pg_attribute a on a.attrelid=c.conrelid and a.attnum=c.conkey[1] where c.contype='f' and c.confrelid=format('public.%I',table_name)::regclass and array_length(c.conkey,1)=1 and c.conrelid not in ('public.organization_business_profiles'::regclass,'public.family_education_needs'::regclass) loop
  execute format('select exists(select 1 from %s where %I=$1)',dependency.relation,dependency.column_name) into has_dependency using item.applied_entity_id;if has_dependency then raise exception 'IMPORT_ROLLBACK_HAS_DEPENDENCIES';end if;
 end loop;
 if resource in ('ORGANIZATIONS','HOUSEHOLDS') then
  execute format('select revision from public.%I where id=$1',case resource when 'ORGANIZATIONS' then 'organization_business_profiles' else 'family_education_needs' end) into profile_revision using item.applied_entity_id;
  if profile_revision is not null and profile_revision is distinct from item.after_snapshot->'profile_revision' then raise exception 'STALE_TARGET';end if;
 end if;
 execute format('delete from public.%I where id=$1',table_name) using item.applied_entity_id;
end$$;
revoke all on function public.rollback_customer_import_row(text,public.import_rows) from public,crm_app,crm_system;

create function public.rollback_customer_relation(resource text,after_state jsonb,before_state jsonb) returns void language plpgsql security definer set search_path=public,app_auth,extensions as $$
declare context jsonb;data jsonb:=after_state->'data';result jsonb;sibling jsonb;current_sibling jsonb;table_name text;parent_column text;parent uuid;receipt public.mutation_receipts;
begin
 select * into receipt from public.mutation_receipts where workspace_id=public.current_workspace_id() and request_key=after_state->>'request_key' and created_by=app_auth.current_user_id();
 if receipt.request_key is null or receipt.result->'item'->>'id' is distinct from after_state->>'id' then raise exception 'ROLLBACK_BLOCKED';end if;
 if resource='ORGANIZATION_CONTACT_ASSOCIATIONS' then
  if not public.import_reference_access('CONTACT',(after_state->>'id')::uuid,true) or not public.import_reference_access('ORGANIZATION',(data->>'organization_id')::uuid,true) then raise exception 'INVALID_REFERENCE';end if;
  select to_jsonb(c) into result from public.contacts c where id=(after_state->>'id')::uuid for update;
  if result->>'updated_at' is distinct from after_state->>'updated_at' or result->>'organization_id' is distinct from data->>'organization_id' then raise exception 'STALE_TARGET';end if;
  if exists(select 1 from public.organization_contact_intelligence where contact_id=(after_state->>'id')::uuid) or exists(select 1 from public.organization_contact_relationships where source_contact_id=(after_state->>'id')::uuid or target_contact_id=(after_state->>'id')::uuid) then raise exception 'ROLLBACK_BLOCKED';end if;
  update public.contacts set organization_id=null,updated_at=clock_timestamp() where id=(after_state->>'id')::uuid;
 else
  context:=public.customer_relation_context(resource,data,'UPDATE',after_state);
  if before_state is not null and before_state<>'null'::jsonb then
   perform public.save_customer_relation(resource,'UPDATE',before_state,after_state,'rollback:'||gen_random_uuid()::text);
  elsif resource='HOUSEHOLD_MEMBERS' then
   result:=public.save_customer_relation(resource,'UPDATE',data||'{"primary_contact":false}',after_state,'rollback:'||gen_random_uuid()::text);perform public.remove_household_member((result->>'id')::uuid);
  elsif resource='STUDENT_GUARDIANS' then
   result:=public.save_customer_relation(resource,'UPDATE',data||'{"primary_guardian":false}',after_state,'rollback:'||gen_random_uuid()::text);perform public.remove_student_guardian((result->>'id')::uuid);
  else
   -- Only reversing the exact receipt-proven CREATE; no import relation-removal operation is exposed.
   if receipt.operation<>'RELATION_'||resource||'_CREATE' then raise exception 'ROLLBACK_BLOCKED';end if;
   table_name:=case resource when 'ORGANIZATION_CONTACT_INTELLIGENCE' then 'organization_contact_intelligence' else 'organization_contact_relationships' end;
   execute format('delete from public.%I where id=$1',table_name) using (after_state->>'id')::uuid;
  end if;
  if resource in ('HOUSEHOLD_MEMBERS','STUDENT_GUARDIANS') then
   table_name:=case resource when 'HOUSEHOLD_MEMBERS' then 'household_members' else 'student_guardian_relationships' end;
   parent_column:=case resource when 'HOUSEHOLD_MEMBERS' then 'household_id' else 'student_id' end;parent:=(data->>parent_column)::uuid;
   for sibling in select v from jsonb_array_elements(after_state->'siblings_before') v where v->>'id'<>after_state->>'id' loop
    execute format('select to_jsonb(r) from public.%I r where id=$1',table_name) into current_sibling using (sibling->>'id')::uuid;
    if (resource='HOUSEHOLD_MEMBERS' and sibling->'primary_contact' is distinct from current_sibling->'primary_contact') or (resource='STUDENT_GUARDIANS' and sibling->'primary_guardian' is distinct from current_sibling->'primary_guardian') then
     perform public.save_customer_relation(resource,'UPDATE',case resource when 'HOUSEHOLD_MEMBERS' then jsonb_build_object('household_id',parent,'contact_id',sibling->'contact_id','primary_contact',sibling->'primary_contact') else jsonb_build_object('student_id',parent,'guardian_contact_id',sibling->'guardian_contact_id','primary_guardian',sibling->'primary_guardian') end,jsonb_build_object('id',current_sibling->'id','revision',current_sibling->'revision'),'rollback:'||gen_random_uuid()::text);
    end if;
   end loop;
  end if;
 end if;
 insert into public.audit_events(workspace_id,actor_id,entity_type,entity_id,action,after_data) values(public.current_workspace_id(),app_auth.current_user_id(),'CUSTOMER_RELATION',(after_state->>'id')::uuid,'RELATION_ROLLED_BACK',jsonb_build_object('resource',resource));
end$$;
revoke all on function public.rollback_customer_relation(text,jsonb,jsonb) from public,crm_app,crm_system;

create function public.rollback_import_set(set_id uuid,expected_revision integer,max_rows integer default 50) returns jsonb language plpgsql security definer set search_path=public,app_auth as $$
declare s public.import_sets;r record;item public.import_rows;attempted integer:=0;begin
 if not public.import_set_access(set_id) then raise exception 'INVALID_REFERENCE';end if;
 select * into s from public.import_sets where id=set_id for update;if s.revision<>expected_revision then raise exception 'STALE_TARGET';end if;
 perform set_config('app.import_v2','1',true);perform set_config('app.import_rollback_set',set_id::text,true);
 for r in select t.*,b.resource_type from public.import_rows t join public.import_batches b on b.id=t.batch_id where b.import_set_id=set_id and t.status='APPLIED' order by t.set_sequence desc,b.created_at desc,t.row_number desc for update of t loop
  exit when attempted>=greatest(1,least(max_rows,100));
  if exists(select 1 from public.import_set_dependencies d join public.import_rows c on c.id=d.row_id where d.parent_row_id=r.id and c.status='APPLIED') then update public.import_rows set last_error='ROLLBACK_BLOCKED' where id=r.id;continue;end if;
  attempted:=attempted+1;
  begin
   if public.import_v2_catalog() ? r.resource_type then select * into item from public.import_rows where id=r.id;perform public.rollback_customer_import_row(r.resource_type,item);
   else perform public.rollback_customer_relation(r.resource_type,r.after_snapshot,r.before_snapshot);end if;
   delete from public.relation_receipt_subjects where workspace_id=s.workspace_id and request_key=r.after_snapshot->>'request_key';
   delete from public.mutation_receipts where workspace_id=s.workspace_id and created_by=s.created_by and request_key=r.after_snapshot->>'request_key';
   update public.import_rows set status='ROLLED_BACK',last_error=null where id=r.id;
   delete from public.import_row_subjects where row_id=r.id;
   update public.import_set_aliases set status='ERASED',record_id=null where row_id=r.id;
  exception when others then update public.import_rows set last_error='ROLLBACK_BLOCKED' where id=r.id;end;
 end loop;
 update public.import_rows cleared set raw_data='{}',normalized_data='{}',before_snapshot=null,after_snapshot=null,errors='[]',target_revision=null from public.import_batches b where cleared.batch_id=b.id and b.import_set_id=set_id and cleared.status='ROLLED_BACK';
 update public.import_set_aliases set alias='@'||lower(resource)||':erased-'||row_id::text where import_set_aliases.set_id=rollback_import_set.set_id and status='ERASED';
 perform set_config('app.import_rollback_set','',true);perform public.import_set_refresh(set_id);
 update public.import_sets set revision=revision+1,status=case when exists(select 1 from public.import_rows pending join public.import_batches b on b.id=pending.batch_id where b.import_set_id=set_id and pending.status='APPLIED') then 'PARTIAL_ROLLBACK' else 'ROLLED_BACK' end,updated_at=clock_timestamp() where id=set_id;
 return public.import_set_summary(set_id);
end$$;
revoke all on function public.rollback_import_set(uuid,integer,integer) from public,crm_system;grant execute on function public.rollback_import_set(uuid,integer,integer) to crm_app;

create function public.track_import_subject(row_id uuid,ws uuid,kind text,subject uuid) returns void language plpgsql security definer set search_path=public as $$declare student public.students;begin
 if subject is null then return;end if;
 insert into public.import_row_subjects values(row_id,ws,kind,subject) on conflict do nothing;
 if kind='STUDENT' then
  select * into student from public.students where id=subject and workspace_id=ws;
  if student.id is not null then insert into public.import_row_subjects values(row_id,ws,'CONTACT',student.person_id) on conflict do nothing;
   if student.household_id is not null then insert into public.import_row_subjects values(row_id,ws,'HOUSEHOLD',student.household_id) on conflict do nothing;end if;
  end if;
 end if;
end$$;
revoke all on function public.track_import_subject(uuid,uuid,text,uuid) from public,crm_app,crm_system;
create function public.index_import_subjects() returns trigger language plpgsql security definer set search_path=public,app_auth,extensions as $$
declare b public.import_batches;kind text;identity uuid;item record;value text;refkind text;begin
 select * into b from public.import_batches where id=new.batch_id;
 if b.execution_contract not in ('CANONICAL_V2','IMPORT_SET_V1') or new.privacy_erased or new.status='ROLLED_BACK' then return new;end if;
 kind:=case b.resource_type when 'ORGANIZATIONS' then 'ORGANIZATION' when 'HOUSEHOLDS' then 'HOUSEHOLD' when 'CONTACTS' then 'CONTACT' when 'STUDENTS' then 'STUDENT' end;
 if kind is not null then perform public.track_import_subject(new.id,new.workspace_id,kind,coalesce(new.applied_entity_id,(new.normalized_data->'expected'->>'id')::uuid));end if;
 for item in select key,v from jsonb_each(coalesce(new.normalized_data->'patch','{}')) as e(key,v) union all select key,v from jsonb_each(coalesce(new.normalized_data->'profile','{}')) as e(key,v) loop
  value:=item.v#>>'{}';refkind:=case item.key when 'organizationId' then 'ORGANIZATION' when 'parentOrganizationId' then 'ORGANIZATION' when 'organization_id' then 'ORGANIZATION' when 'householdId' then 'HOUSEHOLD' when 'household_id' then 'HOUSEHOLD' when 'student_id' then 'STUDENT' when 'personId' then 'CONTACT' when 'contact_id' then 'CONTACT' when 'guardian_contact_id' then 'CONTACT' when 'source_contact_id' then 'CONTACT' when 'target_contact_id' then 'CONTACT' when 'primary_contact_id' then 'CONTACT' end;
  if refkind is null or value is null then continue;end if;identity:=null;
  if value~'^ir_[a-f0-9]{64}$' then select record_id into identity from public.import_reference_tokens t where t.token_hash=encode(digest(value,'sha256'),'hex') and t.workspace_id=new.workspace_id and t.actor_id=b.created_by and t.resource=refkind;
  elsif value like '@%' and b.import_set_id is not null then select record_id into identity from public.import_set_aliases a where a.set_id=b.import_set_id and alias=value and resource=refkind and status='RESOLVED';
  elsif value~'^[a-f0-9-]{36}$' then identity:=value::uuid;end if;
  perform public.track_import_subject(new.id,new.workspace_id,refkind,identity);
 end loop;
 return new;
end$$;
create trigger import_subject_index after insert or update of normalized_data,applied_entity_id on public.import_rows for each row execute function public.index_import_subjects();
revoke all on function public.index_import_subjects() from public;
-- Index new v2 evidence already accepted before this forward migration; no destructive legacy purge.
update public.import_rows r set normalized_data=r.normalized_data from public.import_batches b where b.id=r.batch_id and b.execution_contract='CANONICAL_V2';

create function public.erase_import_set_evidence(set_id uuid) returns void language plpgsql security definer set search_path=public as $$begin
 perform set_config('app.import_v2','1',true);
 delete from public.relation_receipt_subjects x using public.import_rows r,public.import_batches b where r.batch_id=b.id and b.import_set_id=set_id and x.request_key=r.after_snapshot->>'request_key';
 delete from public.mutation_receipts x using public.import_rows r,public.import_batches b where r.batch_id=b.id and b.import_set_id=set_id and x.workspace_id=b.workspace_id and (x.request_key=r.after_snapshot->>'request_key' or x.request_key=left(r.after_snapshot->>'request_key',100)||':domain');
 update public.import_rows r set privacy_erased=true,raw_data='{}',normalized_data='{}',errors='[]',before_snapshot=null,after_snapshot=null,duplicate_entity_id=null,duplicate_reasons='[]',last_error=null,target_revision=null from public.import_batches b where b.id=r.batch_id and b.import_set_id=set_id;
 update public.import_set_aliases set status='ERASED',record_id=null,alias='@'||lower(resource)||':erased-'||row_id::text where import_set_aliases.set_id=erase_import_set_evidence.set_id;
 delete from public.import_set_dependencies where import_set_dependencies.set_id=erase_import_set_evidence.set_id;
 update public.import_batches set original_filename='Erased',field_mapping='{}',evidence_expires_at=clock_timestamp() where import_set_id=set_id;
 update public.import_sets set name='Erased',status='ERASED',expires_at=clock_timestamp(),revision=revision+1 where id=set_id;
end$$;
revoke all on function public.erase_import_set_evidence(uuid) from public,crm_app,crm_system;
create function public.erase_import_subject_evidence() returns trigger language plpgsql security definer set search_path=public,app_auth,extensions as $$
declare subject_kind text:=case tg_table_name when 'contacts' then 'CONTACT' when 'households' then 'HOUSEHOLD' else 'STUDENT' end;sid uuid:=old.id;setid uuid;requests text[];begin
 perform set_config('app.import_v2','1',true);
 for setid in select distinct b.import_set_id from public.import_row_subjects x join public.import_rows r on r.id=x.row_id join public.import_batches b on b.id=r.batch_id where x.workspace_id=old.workspace_id and x.kind=subject_kind and x.subject_id=sid and b.import_set_id is not null and b.import_set_id::text<>coalesce(current_setting('app.import_rollback_set',true),'') loop perform public.erase_import_set_evidence(setid);end loop;
 update public.import_rows r set privacy_erased=true,raw_data='{}',normalized_data='{}',errors='[]',before_snapshot=null,after_snapshot=null,duplicate_entity_id=null,duplicate_reasons='[]',last_error=null,target_revision=null from public.import_row_subjects x,public.import_batches b where x.row_id=r.id and b.id=r.batch_id and x.workspace_id=old.workspace_id and x.kind=subject_kind and x.subject_id=sid and b.import_set_id is null;
 update public.import_batches b set original_filename='Erased',field_mapping='{}' where exists(select 1 from public.import_rows r where r.batch_id=b.id and r.privacy_erased);
 select array_agg(request_key) into requests from public.relation_receipt_subjects where workspace_id=old.workspace_id and relation_receipt_subjects.kind=subject_kind and subject_id=sid;
 delete from public.mutation_receipts where workspace_id=old.workspace_id and (request_key=any(requests) or request_key=any(array(select left(k,100)||':domain' from unnest(requests) k)));
 delete from public.relation_receipt_subjects where workspace_id=old.workspace_id and request_key=any(requests);
 delete from public.import_reference_tokens where workspace_id=old.workspace_id and resource=subject_kind and record_id=sid;
 return old;
end$$;
create trigger contact_import_erasure before delete on public.contacts for each row execute function public.erase_import_subject_evidence();
create trigger household_import_erasure before delete on public.households for each row execute function public.erase_import_subject_evidence();
create trigger student_import_erasure before delete on public.students for each row execute function public.erase_import_subject_evidence();
revoke all on function public.erase_import_subject_evidence() from public;

alter function public.purge_expired_import_v2_evidence() rename to purge_expired_import_v2_evidence_before112;
revoke all on function public.purge_expired_import_v2_evidence_before112() from public,crm_app,crm_system,crm_worker;
create function public.purge_expired_import_v2_evidence() returns void language plpgsql security definer set search_path=public,app_auth as $$declare setid uuid;begin
 if session_user<>'crm_worker' and current_setting('role',true)<>'crm_worker' then raise exception 'WORKER_REQUIRED';end if;
 perform public.purge_expired_import_v2_evidence_before112();
 for setid in select id from public.import_sets where expires_at<=now() and status<>'ERASED' order by expires_at limit 100 for update skip locked loop perform public.erase_import_set_evidence(setid);end loop;
 delete from public.import_row_subjects x using public.import_rows r,public.import_batches b where r.id=x.row_id and b.id=r.batch_id and b.evidence_expires_at<=now() and r.raw_data='{}';
end$$;
revoke all on function public.purge_expired_import_v2_evidence() from public,crm_app,crm_system;grant execute on function public.purge_expired_import_v2_evidence() to crm_worker;

create function public.import_privacy_records(job_id uuid,token uuid) returns jsonb language plpgsql stable security definer set search_path=public,app_auth as $$
declare j public.generated_jobs;subject uuid;begin
 select * into j from public.generated_jobs where id=job_id and job_type='PRIVACY_EXPORT' and status='PROCESSING' and lease_token=token and lease_expires_at>=now();if j.id is null then raise exception 'worker_lease_lost';end if;
 select requester_contact_id into subject from public.privacy_requests where id=j.privacy_request_id and workspace_id=j.workspace_id and identity_status='VERIFIED';if subject is null or subject::text<>j.parameters->>'contactId' then raise exception 'privacy_scope_invalid';end if;
 return coalesce((select jsonb_agg(jsonb_build_object('row_id',r.id,'batch_id',r.batch_id,'resource',b.resource_type,'operation',r.decision,'status',r.status)) from public.import_rows r join public.import_batches b on b.id=r.batch_id where b.workspace_id=j.workspace_id and not r.privacy_erased and exists(select 1 from public.import_row_subjects x where x.row_id=r.id and x.workspace_id=j.workspace_id and x.kind='CONTACT' and x.subject_id=subject)),'[]');
end$$;
revoke all on function public.import_privacy_records(uuid,uuid) from public,crm_app,crm_system;grant execute on function public.import_privacy_records(uuid,uuid) to crm_worker;

-- No table-gateway mutation can bypass Set revision/receipts.
create policy set_batch_insert on public.import_batches as restrictive for insert to crm_app with check(import_set_id is null);
create policy set_batch_update on public.import_batches as restrictive for update to crm_app using(import_set_id is null) with check(import_set_id is null);
create policy set_batch_delete on public.import_batches as restrictive for delete to crm_app using(import_set_id is null);
create policy set_row_insert on public.import_rows as restrictive for insert to crm_app with check(not exists(select 1 from public.import_batches b where b.id=batch_id and b.import_set_id is not null));
create policy set_row_update on public.import_rows as restrictive for update to crm_app using(not exists(select 1 from public.import_batches b where b.id=batch_id and b.import_set_id is not null)) with check(not exists(select 1 from public.import_batches b where b.id=batch_id and b.import_set_id is not null));
create policy set_row_delete on public.import_rows as restrictive for delete to crm_app using(not exists(select 1 from public.import_batches b where b.id=batch_id and b.import_set_id is not null));

-- Existing standalone RPCs must never process or repair Set-owned rows outside orchestration.
do $$declare fn regprocedure;definition text;begin
 for fn in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('process_import_batch','repair_import_row','decide_import_row','rollback_import_batch') loop
  definition:=pg_get_functiondef(fn);
  if definition like '%execution_contract=''CANONICAL_V2''%' then
   definition:=replace(definition,'execution_contract=''CANONICAL_V2''','execution_contract in (''CANONICAL_V2'',''IMPORT_SET_V1'')');execute definition;
  elsif definition like '%execution_contract<>''CANONICAL_V2''%' then
   -- v2 RPCs already fail closed on every contract except CANONICAL_V2.
   null;
  else raise exception 'IMPORT_RPC_GUARD_MISSING: %',fn;end if;
 end loop;
end$$;
