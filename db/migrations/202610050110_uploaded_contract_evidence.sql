-- External evidence is not generated lineage, a signature, or a canonical mutation.
set search_path=public,app_auth,extensions;
create table public.uploaded_contract_documents(
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id),
 source_kind text not null check(source_kind in ('CUSTOMER_CONTRACT','CHANNEL_AGREEMENT_VERSION')),source_id uuid not null,
 source_revision integer not null check(source_revision>0),context jsonb not null,privacy_contacts jsonb not null,
 filename text not null,format text not null check(format in ('DOCX','PDF')),mime_type text not null,bytes bigint not null check(bytes between 1 and 8000000),
 sha256 text not null check(sha256~'^[a-f0-9]{64}$'),storage_key text not null,
 status text not null default 'STORING' check(status in ('STORING','UPLOADED','EXTRACTING','EXTRACTED','EXTRACTION_FAILED','REVIEWED','ERASURE_PENDING','ERASED')),
 revision integer not null default 1,uploaded_by uuid not null references app_auth.accounts(id),uploaded_at timestamptz not null default clock_timestamp(),
 unique(workspace_id,id),unique(workspace_id,source_kind,source_id,sha256)
);
create table public.uploaded_contract_receipts(
 workspace_id uuid not null,actor_id uuid not null,request_key text not null check(length(request_key) between 8 and 160),
 fingerprint text not null,document_id uuid not null,primary key(workspace_id,actor_id,request_key),
 foreign key(workspace_id,document_id) references public.uploaded_contract_documents(workspace_id,id)
);
create table public.contract_extraction_runs(
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null,document_id uuid not null,
 extractor_version text not null check(extractor_version='LABELS_V1'),run_number integer not null,
 status text not null default 'QUEUED' check(status in ('QUEUED','EXTRACTING','EXTRACTED','FAILED','ERASED')),
 chunks jsonb,candidates jsonb,error_code text,created_at timestamptz not null default clock_timestamp(),completed_at timestamptz,
 job_id uuid unique references public.generated_jobs(id),
 unique(workspace_id,id),unique(workspace_id,document_id,id),unique(workspace_id,document_id,run_number),
 foreign key(workspace_id,document_id) references public.uploaded_contract_documents(workspace_id,id)
);
create table public.contract_extraction_reviews(
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null,document_id uuid not null,run_id uuid not null,
 candidate_key text not null,decision text not null check(decision in ('CONFIRMED','REJECTED','EDITED','DEFERRED')),
 confirmed_value jsonb,reason text not null default '' check(length(reason)<=500),source_revision integer not null,
 actor_id uuid not null references app_auth.accounts(id),reviewed_at timestamptz not null default clock_timestamp(),document_revision integer not null,
 request_key text not null check(length(request_key) between 8 and 160),fingerprint text not null,
 unique(workspace_id,actor_id,request_key),foreign key(workspace_id,document_id) references public.uploaded_contract_documents(workspace_id,id),
 foreign key(workspace_id,document_id,run_id) references public.contract_extraction_runs(workspace_id,document_id,id)
);
alter table public.generated_jobs add column uploaded_document_id uuid;
alter table public.generated_jobs add constraint uploaded_job_workspace foreign key(workspace_id,uploaded_document_id) references public.uploaded_contract_documents(workspace_id,id);
alter table public.generated_jobs drop constraint generated_jobs_origin_check;
alter table public.generated_jobs add constraint generated_jobs_origin_check check(
 (case when approval_request_id is null then 0 else 1 end)+(case when privacy_request_id is null then 0 else 1 end)
 +(case when document_generation_id is null then 0 else 1 end)+(case when uploaded_document_id is null then 0 else 1 end)=1);
alter table public.generated_jobs drop constraint generated_jobs_job_type_check;
alter table public.generated_jobs add constraint generated_jobs_job_type_check check(job_type in
 ('CONTRACT_EXPORT','PERFORMANCE_SUMMARY','MARKETING_CONTACT_EXPORT','CRM_EXPORT','PRIVACY_EXPORT','CONTRACT_DOCUMENT_GENERATION','CONTRACT_DOCUMENT_EXTRACTION'));
create trigger uploaded_parent_integrity before insert on public.uploaded_contract_documents for each row execute function public.document_source_integrity();

create function public.upload_manage() returns boolean language sql stable security definer set search_path=public,app_auth as $$
 select public.is_workspace_member(public.current_workspace_id()) and public.current_crm_role() in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER','SALES_SPECIALIST')
$$;
create function public.upload_context(kind text,source uuid,selected_context jsonb) returns jsonb language plpgsql stable security definer set search_path=public,app_auth as $$
declare c public.contracts;v public.channel_agreement_versions;a public.channel_agreements;begin
 if not public.document_source_access(kind,source,false) then raise exception 'upload_source_not_found';end if;
 if exists(select 1 from jsonb_object_keys(selected_context) k where k not in ('enrollmentId','productId','cohortId','commissionRuleId')) then raise exception 'upload_context_invalid';end if;
 if (kind='CUSTOMER_CONTRACT' and selected_context ? 'enrollmentId') or (kind='CHANNEL_AGREEMENT_VERSION' and selected_context ? 'commissionRuleId') then
  return public.document_generation_context(kind,source,selected_context);
 end if;
 if selected_context<>'{}'::jsonb then raise exception 'upload_context_invalid';end if;
 if kind='CUSTOMER_CONTRACT' then
  select * into c from public.contracts where id=source and workspace_id=public.current_workspace_id();
  return jsonb_build_object('sourceRevision',coalesce((select max(version) from public.contract_versions where contract_id=c.id),1),'canonical',jsonb_build_object('contract.reference',c.contract_number,'contract.amount',c.contract_value::text,'contract.currency',c.currency),'references',jsonb_build_object('householdId',c.household_id));
 else
  select * into v from public.channel_agreement_versions where id=source and workspace_id=public.current_workspace_id();select * into a from public.channel_agreements where id=v.agreement_id;
  return jsonb_build_object('sourceRevision',v.revision,'canonical',jsonb_build_object('agreement.reference',a.agreement_code,'agreement.signing_date',v.signed_on,'agreement.effective_from',v.effective_from,'agreement.effective_to',v.effective_to),'references',jsonb_build_object('organizationId',a.organization_id));
 end if;
end $$;
create function public.upload_access(record_id uuid,edit boolean default false) returns boolean language plpgsql stable security definer set search_path=public,app_auth as $$
declare d public.uploaded_contract_documents;begin
 select * into d from public.uploaded_contract_documents where id=record_id and workspace_id=public.current_workspace_id();
 if d.id is null or d.status in ('ERASURE_PENDING','ERASED') or not public.document_source_access(d.source_kind,d.source_id,edit) or (edit and not public.upload_manage()) then return false;end if;
 perform public.upload_context(d.source_kind,d.source_id,d.context);return true;
exception when others then return false;end $$;
create function public.reserve_contract_upload(kind text,source uuid,expected_revision integer,selected_context jsonb,original_filename text,file_format text,file_mime text,file_bytes bigint,file_sha text,p_request_key text) returns jsonb language plpgsql security definer set search_path=public,app_auth,extensions as $$
declare ws uuid:=public.current_workspace_id();actor uuid:=app_auth.current_user_id();ctx jsonb;fp text;old public.uploaded_contract_receipts;d public.uploaded_contract_documents;contacts jsonb;begin
 if not public.upload_manage() or not public.document_source_access(kind,source,true) then raise exception 'upload_source_not_found';end if;
 if kind='CUSTOMER_CONTRACT' then perform 1 from public.contracts where id=source for update;else perform 1 from public.channel_agreement_versions where id=source for update;end if;
 ctx:=public.upload_context(kind,source,selected_context);
 if file_sha !~ '^[a-f0-9]{64}$' or file_bytes not between 1 and 8000000 or file_format not in ('DOCX','PDF') or
  file_mime<>(case file_format when 'PDF' then 'application/pdf' else 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' end) or length(original_filename) not between 1 and 160 or original_filename~'[[:cntrl:]\\/]' then raise exception 'upload_file_invalid';end if;
 fp:=encode(extensions.digest(jsonb_build_object('kind',kind,'source',source,'revision',expected_revision,'context',selected_context,'sha',file_sha,'bytes',file_bytes,'format',file_format,'filename',original_filename)::text,'sha256'),'hex');
 perform pg_advisory_xact_lock(hashtextextended(ws::text||actor::text||p_request_key,0));
 select * into old from public.uploaded_contract_receipts where workspace_id=ws and actor_id=actor and request_key=p_request_key;
 if old.document_id is not null then
  if old.fingerprint<>fp then raise exception 'upload_request_conflict';end if;
  if not public.upload_access(old.document_id,true) then raise exception 'upload_source_not_found';end if;
  select * into d from public.uploaded_contract_documents where id=old.document_id;return jsonb_build_object('id',d.id,'key',d.storage_key,'status',d.status);
 end if;
 if (ctx->>'sourceRevision')::integer<>expected_revision then raise exception 'upload_source_conflict';end if;
 perform pg_advisory_xact_lock(hashtextextended(ws::text||kind||source::text||file_sha,0));
 select * into d from public.uploaded_contract_documents where workspace_id=ws and source_kind=kind and source_id=source and sha256=file_sha;
 if d.id is not null and not public.upload_access(d.id,true) then raise exception 'upload_source_not_found';end if;
 if d.id is null then
  if kind='CUSTOMER_CONTRACT' then
   select coalesce(jsonb_agg(distinct contact_id),'[]') into contacts from (
    select contact_id from public.household_members where workspace_id=ws and household_id=(ctx->'references'->>'householdId')::uuid
    union select guardian_contact_id from public.student_guardian_relationships where workspace_id=ws and student_id=(ctx->'references'->>'studentId')::uuid
    union select (ctx->'references'->>'contactId')::uuid
    union select st.person_id from public.contract_enrollment_links l join public.student_enrollments en on en.id=l.enrollment_id join public.students st on st.id=en.student_id where l.workspace_id=ws and l.contract_id=source) s where contact_id is not null;
  else select coalesce(jsonb_agg(distinct contact_id),'[]') into contacts from (select id contact_id from public.contacts where workspace_id=ws and organization_id=(ctx->'references'->>'organizationId')::uuid union select contact_id from public.organization_contact_intelligence where workspace_id=ws and organization_id=(ctx->'references'->>'organizationId')::uuid union select primary_contact_id from public.organization_business_profiles where workspace_id=ws and id=(ctx->'references'->>'organizationId')::uuid and primary_contact_id is not null) subjects;end if;
  d.id:=gen_random_uuid();
  insert into public.uploaded_contract_documents(id,workspace_id,source_kind,source_id,source_revision,context,privacy_contacts,filename,format,mime_type,bytes,sha256,storage_key,uploaded_by)
  values(d.id,ws,kind,source,expected_revision,selected_context,contacts,original_filename,file_format,file_mime,file_bytes,file_sha,'contract-documents/uploaded/'||ws::text||'/'||d.id::text||'/original.'||lower(file_format),actor);
  select * into d from public.uploaded_contract_documents where id=d.id;
  insert into public.audit_events(workspace_id,actor_id,action,entity_type,entity_id,after_data) values(ws,actor,'CONTRACT_UPLOAD_RESERVED','UPLOADED_CONTRACT_DOCUMENT',d.id,jsonb_build_object('sha256',file_sha,'status','STORING'));
 end if;
 insert into public.uploaded_contract_receipts values(ws,actor,p_request_key,fp,d.id);
 return jsonb_build_object('id',d.id,'key',d.storage_key,'status',d.status);
end $$;
create function public.queue_contract_extraction(record_id uuid,force_new boolean default false) returns uuid language plpgsql security definer set search_path=public,app_auth as $$
declare d public.uploaded_contract_documents;r public.contract_extraction_runs;job uuid;begin
 if not public.upload_access(record_id,true) then raise exception 'upload_source_not_found';end if;
 select * into d from public.uploaded_contract_documents where id=record_id for update;
 if d.status='STORING' then raise exception 'upload_not_ready';end if;
 select * into r from public.contract_extraction_runs where document_id=d.id order by run_number desc limit 1;
 if r.id is not null and not force_new then
  if r.status='FAILED' then update public.generated_jobs set status='QUEUED',attempts=0,available_at=clock_timestamp(),lease_token=null,lease_expires_at=null where id=r.job_id and status in ('FAILED','DEAD');end if;
  return r.id;
 end if;
 if r.status in ('QUEUED','EXTRACTING') then raise exception 'upload_extraction_busy';end if;
 insert into public.contract_extraction_runs(workspace_id,document_id,extractor_version,run_number) values(d.workspace_id,d.id,'LABELS_V1',coalesce(r.run_number,0)+1) returning * into r;
 insert into public.generated_jobs(workspace_id,job_type,uploaded_document_id,parameters,created_by) values(d.workspace_id,'CONTRACT_DOCUMENT_EXTRACTION',d.id,jsonb_build_object('runId',r.id),app_auth.current_user_id()) returning id into job;
 update public.contract_extraction_runs set job_id=job where id=r.id;
 update public.uploaded_contract_documents set status='UPLOADED',revision=revision+1 where id=d.id;
 return r.id;
end $$;
create function public.complete_contract_upload(record_id uuid) returns uuid language plpgsql security definer set search_path=public,app_auth as $$begin
 if not public.upload_access(record_id,true) then raise exception 'upload_source_not_found';end if;
 perform 1 from public.uploaded_contract_documents where id=record_id for update;
 update public.uploaded_contract_documents set status='UPLOADED' where id=record_id and status='STORING';
 return public.queue_contract_extraction(record_id,false);
end $$;
create function public.uploaded_documents_list(kind text,source uuid) returns jsonb language plpgsql stable security definer set search_path=public,app_auth as $$begin
 if not public.document_source_access(kind,source,false) then raise exception 'upload_source_not_found';end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',d.id,'filename',d.filename,'format',d.format,'status',d.status,'sha256',d.sha256,'sourceRevision',d.source_revision,'revision',d.revision,'uploadedAt',d.uploaded_at) order by d.uploaded_at desc,d.id) from public.uploaded_contract_documents d
 where d.workspace_id=public.current_workspace_id() and d.source_kind=kind and d.source_id=source and d.status<>'STORING' and public.upload_access(d.id,false)),'[]');end $$;
create function public.upload_candidate_state(candidate jsonb,current_value jsonb) returns text language plpgsql immutable as $$begin
 if candidate->>'confirmationTarget'='UNSUPPORTED' then return 'UNSUPPORTED';end if;
 if candidate->>'validationState'='MISSING_IN_DOCUMENT' then return 'MISSING_IN_DOCUMENT';end if;
 if candidate->>'confidenceState'='AMBIGUOUS' or candidate->>'validationState'<>'VALID' then return 'AMBIGUOUS';end if;
 if candidate->>'confirmationTarget'='DOCUMENT_ONLY' then return 'DOCUMENT_ONLY';end if;
 if current_value is null or current_value='null' then return 'MISSING_IN_CRM';end if;
 if candidate->>'type'='money' then if (current_value#>>'{}')::numeric=(candidate->>'normalizedValue')::numeric then return 'MATCH';end if;
 elsif trim(current_value#>>'{}')=trim(candidate->>'normalizedValue') then return 'MATCH';end if;
 return 'CONFLICT';exception when others then return 'CONFLICT';end $$;
create function public.uploaded_document_detail(record_id uuid,reveal boolean default false) returns jsonb language plpgsql stable security definer set search_path=public,app_auth as $$
declare d public.uploaded_contract_documents;r public.contract_extraction_runs;ctx jsonb;candidates jsonb;canonical jsonb;begin
 reveal:=coalesce(reveal,false);
 if not public.upload_access(record_id,false) then raise exception 'upload_source_not_found';end if;
 if reveal and (not public.upload_manage() or app_auth.current_claims()->>'aal' is distinct from 'aal2') then raise exception 'upload_sensitive_forbidden';end if;
 select * into d from public.uploaded_contract_documents where id=record_id;select * into r from public.contract_extraction_runs where document_id=d.id order by run_number desc limit 1;
 ctx:=public.upload_context(d.source_kind,d.source_id,d.context);
 canonical:=ctx->'canonical';
 select coalesce(jsonb_agg(case when not reveal and (f->>'sensitive'='true' or f->>'validationState'<>'VALID' or f->>'confidenceState'='AMBIGUOUS') then f||jsonb_build_object('comparisonState',public.upload_candidate_state(f,canonical->(f->>'fieldKey')),'rawValue',null,'normalizedValue',null,'sourceExcerpt',null,'masked',true) else f||jsonb_build_object('comparisonState',public.upload_candidate_state(f,canonical->(f->>'fieldKey')))||case when not reveal then jsonb_build_object('sourceExcerpt',null) else '{}'::jsonb end end),'[]') into candidates from jsonb_array_elements(coalesce(r.candidates,'[]')) f;
 if not reveal then select coalesce(jsonb_object_agg(key,value),'{}') into canonical from jsonb_each(canonical) where key not in(select f->>'key' from jsonb_array_elements(public.upload_field_contract(d.source_kind)) f where f->>'sensitive'='true' or f->>'key'~'^(participant|buyer|guardian|bank)\.');end if;
 return jsonb_build_object('id',d.id,'sourceKind',d.source_kind,'sourceId',d.source_id,'context',d.context,'status',d.status,'revision',d.revision,'filename',d.filename,'format',d.format,'sha256',d.sha256,'sourceRevision',d.source_revision,'currentSourceRevision',(ctx->>'sourceRevision')::integer,
 'sourceChanged',d.source_revision<>(ctx->>'sourceRevision')::integer,'canonical',canonical,'runId',r.id,'extractorVersion',r.extractor_version,'runNumber',r.run_number,'errorCode',r.error_code,'candidates',candidates,
 'chunks',case when reveal then coalesce(r.chunks,'[]') else '[]'::jsonb end,
 'reviews',coalesce((select jsonb_agg(to_jsonb(x)-array['fingerprint','request_key','workspace_id','confirmed_value','reason']||case when reveal then jsonb_build_object('confirmed_value',x.confirmed_value,'reason',x.reason) else '{}'::jsonb end) from public.contract_extraction_reviews x where x.run_id=r.id),'[]'));
end $$;
create function public.uploaded_original_download(record_id uuid) returns jsonb language plpgsql stable security definer set search_path=public,app_auth as $$begin
 if not public.upload_access(record_id,false) then raise exception 'upload_source_not_found';end if;
 return (select jsonb_build_object('id',id,'key',storage_key,'sha256',sha256,'bytes',bytes,'mime',mime_type,'filename',filename) from public.uploaded_contract_documents where id=record_id and status<>'STORING');end $$;
create function public.review_uploaded_candidate(record_id uuid,run_id uuid,candidate_key text,decision text,confirmed_value jsonb,expected_revision integer,expected_source_revision integer,p_request_key text,reason text default '') returns uuid language plpgsql security definer set search_path=public,app_auth,extensions as $$
declare d public.uploaded_contract_documents;f jsonb;definition jsonb;fp text;old public.contract_extraction_reviews;result uuid;ctx jsonb;begin
 if not public.upload_access(record_id,true) then raise exception 'upload_source_not_found';end if;
 if app_auth.current_claims()->>'aal' is distinct from 'aal2' then raise exception 'upload_sensitive_forbidden';end if;
 fp:=encode(extensions.digest(jsonb_build_object('document',record_id,'run',run_id,'key',candidate_key,'decision',decision,'value',confirmed_value,'revision',expected_revision,'source',expected_source_revision,'reason',reason)::text,'sha256'),'hex');
 perform pg_advisory_xact_lock(hashtextextended(public.current_workspace_id()::text||app_auth.current_user_id()::text||p_request_key,0));
 select * into old from public.contract_extraction_reviews where workspace_id=public.current_workspace_id() and actor_id=app_auth.current_user_id() and request_key=p_request_key;
 if old.id is not null then if old.fingerprint<>fp then raise exception 'upload_request_conflict';end if;return old.id;end if;
 select * into d from public.uploaded_contract_documents where id=record_id for update;
 if d.source_kind='CUSTOMER_CONTRACT' then perform 1 from public.contracts where id=d.source_id for update;else perform 1 from public.channel_agreement_versions where id=d.source_id for update;end if;
 ctx:=public.upload_context(d.source_kind,d.source_id,d.context);
 if d.revision<>expected_revision then raise exception 'upload_review_conflict';end if;
 if (ctx->>'sourceRevision')::integer<>expected_source_revision then raise exception 'upload_source_conflict';end if;
 select c into f from public.contract_extraction_runs r,jsonb_array_elements(r.candidates) c where r.id=run_id and r.document_id=d.id and r.status='EXTRACTED' and c->>'candidateKey'=candidate_key;
 if f is null or run_id<>(select id from public.contract_extraction_runs where document_id=d.id order by run_number desc limit 1) or decision not in ('CONFIRMED','REJECTED','EDITED','DEFERRED') then raise exception 'upload_review_invalid';end if;
 if decision in ('CONFIRMED','EDITED') and (not exists(select 1 from jsonb_array_elements(public.upload_field_contract(d.source_kind)) field where field->>'key'=f->>'fieldKey' and field->>'confirmation_target'='DOCUMENT_ONLY') or (decision='CONFIRMED' and (f->>'validationState'<>'VALID' or f->>'confidenceState'='AMBIGUOUS'))) then raise exception 'upload_canonical_read_only';end if;
 if decision in ('CONFIRMED','EDITED') and (confirmed_value is null or confirmed_value='null'::jsonb or length(confirmed_value::text)>5000 or confirmed_value::text~'\{\{|\}\}') then raise exception 'upload_review_invalid';end if;
 select field into definition from jsonb_array_elements(public.upload_field_contract(d.source_kind)) field where field->>'key'=f->>'fieldKey';
 if decision in ('CONFIRMED','EDITED') then
  if definition->>'type'='boolean' then if jsonb_typeof(confirmed_value)<>'boolean' then raise exception 'upload_review_invalid';end if;
  else if jsonb_typeof(confirmed_value)<>'string' or length(trim(confirmed_value#>>'{}'))=0 or (confirmed_value#>>'{}')~'[[:cntrl:]]' and (confirmed_value#>>'{}')~E'[\x01-\x08\x0b\x0c\x0e-\x1f]' then raise exception 'upload_review_invalid';end if;
   if definition->>'type'='money' and (confirmed_value#>>'{}')!~'^[0-9]+\.[0-9]{2}$' then raise exception 'upload_review_invalid';end if;
   if definition->>'type'='date' then if (confirmed_value#>>'{}')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or ((confirmed_value#>>'{}')::date)::text<>(confirmed_value#>>'{}') then raise exception 'upload_review_invalid';end if;end if;
  end if;
 end if;
 if decision='CONFIRMED' and confirmed_value<>f->'normalizedValue' then raise exception 'upload_review_invalid';end if;
 insert into public.contract_extraction_reviews(workspace_id,document_id,run_id,candidate_key,decision,confirmed_value,reason,source_revision,actor_id,document_revision,request_key,fingerprint)
 values(d.workspace_id,d.id,run_id,candidate_key,decision,case when decision in ('CONFIRMED','EDITED') then confirmed_value else null end,reason,expected_source_revision,app_auth.current_user_id(),d.revision+1,p_request_key,fp) returning id into result;
 update public.uploaded_contract_documents set revision=revision+1,status=case when not exists(select 1 from public.contract_extraction_runs r,jsonb_array_elements(r.candidates) c where r.id=run_id and not exists(select 1 from public.contract_extraction_reviews x where x.run_id=r.id and x.candidate_key=c->>'candidateKey')) then 'REVIEWED' else status end where id=d.id;
 insert into public.audit_events(workspace_id,actor_id,action,entity_type,entity_id,after_data) values(d.workspace_id,app_auth.current_user_id(),'CONTRACT_CANDIDATE_REVIEWED','UPLOADED_CONTRACT_DOCUMENT',d.id,jsonb_build_object('runId',run_id,'candidateKey',candidate_key,'decision',decision));return result;
end $$;


-- Frozen typed field contract derived from Phase 1 keys; no arbitrary target definition.
create function public.upload_field_contract(kind text) returns jsonb language sql immutable set search_path=public as $$
 select case kind
 when 'CHANNEL_AGREEMENT_VERSION' then $fields$[{"key":"template.review_notice","label_zh":"模板审阅提示","label_en":"template / review notice","type":"text","category":"TEMPLATE_CONSTANT","sensitive":false,"required":true,"confirmation_target":"CANONICAL_READ_ONLY"},{"key":"company.legal_name","label_zh":"经确认的公司法律名称","label_en":"company / legal name","type":"text","category":"USER_CONFIRMED","sensitive":false,"required":true,"confirmation_target":"CANONICAL_READ_ONLY"},{"key":"company.address","label_zh":"公司注册地址","label_en":"company / address","type":"text","category":"USER_CONFIRMED","sensitive":true,"required":true,"confirmation_target":"CANONICAL_READ_ONLY"},{"key":"company.signatory","label_zh":"经确认的公司签约代表","label_en":"company / signatory","type":"text","category":"USER_CONFIRMED","sensitive":true,"required":true,"confirmation_target":"CANONICAL_READ_ONLY"},{"key":"company.phone","label_zh":"公司联系号码","label_en":"company / phone","type":"text","category":"USER_CONFIRMED","sensitive":true,"required":true,"confirmation_target":"CANONICAL_READ_ONLY"},{"key":"company.email","label_zh":"公司联系邮箱","label_en":"company / email","type":"text","category":"USER_CONFIRMED","sensitive":true,"required":true,"confirmation_target":"CANONICAL_READ_ONLY"},{"key":"program.name","label_zh":"正式项目名称","label_en":"program / name","type":"text","category":"CANONICAL","sensitive":false,"required":true,"confirmation_target":"CANONICAL_READ_ONLY"},{"key":"program.institution_name","label_zh":"经确认的项目举办/证书单位","label_en":"program / institution name","type":"text","category":"USER_CONFIRMED","sensitive":false,"required":true,"confirmation_target":"DOCUMENT_ONLY"},{"key":"cohort.name","label_zh":"正式批次名称","label_en":"cohort / name","type":"text","category":"CANONICAL","sensitive":false,"required":true,"confirmation_target":"CANONICAL_READ_ONLY"},{"key":"bank.beneficiary","label_zh":"经确认的收/付款账户户名","label_en":"bank / beneficiary","type":"text","category":"USER_CONFIRMED","sensitive":true,"required":true,"confirmation_target":"DOCUMENT_ONLY"},{"key":"bank.institution","label_zh":"经确认的开户银行","label_en":"bank / institution","type":"text","category":"USER_CONFIRMED","sensitive":true,"required":true,"confirmation_target":"DOCUMENT_ONLY"},{"key":"bank.account","label_zh":"经确认的银行账号","label_en":"bank / account","type":"text","category":"USER_CONFIRMED","sensitive":true,"required":true,"confirmation_target":"DOCUMENT_ONLY"},{"key":"company.registration_identifier","label_zh":"经确认的公司注册标识","label_en":"company / registration identifier","type":"text","category":"USER_CONFIRMED","sensitive":false,"required":true,"confirmation_target":"CANONICAL_READ_ONLY"},{"key":"agreement.reference","label_zh":"代理协议编号","label_en":"agreement / reference","type":"text","category":"CANONICAL","sensitive":false,"required":true,"confirmation_target":"CANONICAL_READ_ONLY"},{"key":"channel.organization_name","label_zh":"关联机构档案名称","label_en":"channel / organization name","type":"text","category":"CANONICAL","sensitive":false,"required":true,"confirmation_target":"CANONICAL_READ_ONLY"},{"key":"channel.legal_name","label_zh":"确认的渠道签约法律名称","label_en":"channel / legal name","type":"text","category":"USER_CONFIRMED","sensitive":false,"required":true,"confirmation_target":"DOCUMENT_ONLY"},{"key":"channel.address","label_zh":"渠道机构确认地址","label_en":"channel / address","type":"text","category":"USER_CONFIRMED","sensitive":true,"required":true,"confirmation_target":"DOCUMENT_ONLY"},{"key":"channel.representative","label_zh":"授权对接代表（非自动签约代表）","label_en":"channel / representative","type":"text","category":"USER_CONFIRMED","sensitive":true,"required":true,"confirmation_target":"DOCUMENT_ONLY"},{"key":"channel.signatory","label_zh":"确认的渠道签约代表","label_en":"channel / signatory","type":"text","category":"USER_CONFIRMED","sensitive":true,"required":true,"confirmation_target":"DOCUMENT_ONLY"},{"key":"channel.phone","label_zh":"渠道联系号码","label_en":"channel / phone","type":"text","category":"USER_CONFIRMED","sensitive":true,"required":true,"confirmation_target":"DOCUMENT_ONLY"},{"key":"channel.email","label_zh":"渠道联系邮箱","label_en":"channel / email","type":"text","category":"USER_CONFIRMED","sensitive":true,"required":true,"confirmation_target":"DOCUMENT_ONLY"},{"key":"agreement.signing_date","label_zh":"协议版本记录的签署日期","label_en":"agreement / signing date","type":"date","category":"CANONICAL","sensitive":false,"required":true,"confirmation_target":"CANONICAL_READ_ONLY"},{"key":"agreement.signing_place","label_zh":"确认的签署地点","label_en":"agreement / signing place","type":"text","category":"USER_CONFIRMED","sensitive":false,"required":true,"confirmation_target":"DOCUMENT_ONLY"},{"key":"agreement.effective_from","label_zh":"协议生效日","label_en":"agreement / effective from","type":"date","category":"CANONICAL","sensitive":false,"required":true,"confirmation_target":"CANONICAL_READ_ONLY"},{"key":"agreement.effective_to","label_zh":"协议终止日","label_en":"agreement / effective to","type":"date","category":"CANONICAL","sensitive":false,"required":true,"confirmation_target":"CANONICAL_READ_ONLY"},{"key":"company.background_clause","label_zh":"经确认的公司背景条款","label_en":"company / background clause","type":"text","category":"USER_CONFIRMED","sensitive":false,"required":true,"confirmation_target":"CANONICAL_READ_ONLY"},{"key":"program.description","label_zh":"经确认的项目描述","label_en":"program / description","type":"text","category":"USER_CONFIRMED","sensitive":false,"required":true,"confirmation_target":"DOCUMENT_ONLY"},{"key":"agreement.review_clause","label_zh":"经确认的年度评估和续约安排","label_en":"agreement / review clause","type":"text","category":"USER_CONFIRMED","sensitive":false,"required":true,"confirmation_target":"DOCUMENT_ONLY"},{"key":"commission.amount","label_zh":"固定每 Enrollment 佣金","label_en":"commission / amount","type":"money","category":"CANONICAL","sensitive":false,"required":true,"confirmation_target":"CANONICAL_READ_ONLY"},{"key":"commission.currency","label_zh":"固定佣金币种","label_en":"commission / currency","type":"currency","category":"CANONICAL","sensitive":false,"required":true,"confirmation_target":"CANONICAL_READ_ONLY"},{"key":"commission.eligibility_clause","label_zh":"登记/Offer/满一个月未退出条款","label_en":"commission / eligibility clause","type":"text","category":"UNSUPPORTED","sensitive":false,"required":true,"confirmation_target":"UNSUPPORTED"},{"key":"commission.settlement_condition","label_zh":"经确认的正常入读结算条件","label_en":"commission / settlement condition","type":"text","category":"UNSUPPORTED","sensitive":false,"required":true,"confirmation_target":"UNSUPPORTED"},{"key":"commission.payment_terms","label_zh":"经确认的支付期限","label_en":"commission / payment terms","type":"text","category":"USER_CONFIRMED","sensitive":false,"required":true,"confirmation_target":"DOCUMENT_ONLY"},{"key":"channel.coordinator","label_zh":"确认的项目对接人/职位","label_en":"channel / coordinator","type":"text","category":"USER_CONFIRMED","sensitive":true,"required":true,"confirmation_target":"DOCUMENT_ONLY"},{"key":"company.invoice_details","label_zh":"经确认的开票信息","label_en":"company / invoice details","type":"text","category":"USER_CONFIRMED","sensitive":true,"required":true,"confirmation_target":"CANONICAL_READ_ONLY"}]$fields$::jsonb
 when 'CUSTOMER_CONTRACT' then $fields$[{"key":"template.review_notice","label_zh":"模板审阅提示","label_en":"template / review notice","type":"text","category":"TEMPLATE_CONSTANT","sensitive":false,"required":true,"confirmation_target":"CANONICAL_READ_ONLY"},{"key":"company.legal_name","label_zh":"经确认的公司法律名称","label_en":"company / legal name","type":"text","category":"USER_CONFIRMED","sensitive":false,"required":true,"confirmation_target":"CANONICAL_READ_ONLY"},{"key":"company.address","label_zh":"公司注册地址","label_en":"company / address","type":"text","category":"USER_CONFIRMED","sensitive":true,"required":true,"confirmation_target":"CANONICAL_READ_ONLY"},{"key":"company.signatory","label_zh":"经确认的公司签约代表","label_en":"company / signatory","type":"text","category":"USER_CONFIRMED","sensitive":true,"required":true,"confirmation_target":"CANONICAL_READ_ONLY"},{"key":"company.phone","label_zh":"公司联系号码","label_en":"company / phone","type":"text","category":"USER_CONFIRMED","sensitive":true,"required":true,"confirmation_target":"CANONICAL_READ_ONLY"},{"key":"company.email","label_zh":"公司联系邮箱","label_en":"company / email","type":"text","category":"USER_CONFIRMED","sensitive":true,"required":true,"confirmation_target":"CANONICAL_READ_ONLY"},{"key":"program.name","label_zh":"正式项目名称","label_en":"program / name","type":"text","category":"CANONICAL","sensitive":false,"required":true,"confirmation_target":"CANONICAL_READ_ONLY"},{"key":"program.institution_name","label_zh":"经确认的项目举办/证书单位","label_en":"program / institution name","type":"text","category":"USER_CONFIRMED","sensitive":false,"required":true,"confirmation_target":"DOCUMENT_ONLY"},{"key":"cohort.name","label_zh":"正式批次名称","label_en":"cohort / name","type":"text","category":"CANONICAL","sensitive":false,"required":true,"confirmation_target":"CANONICAL_READ_ONLY"},{"key":"bank.beneficiary","label_zh":"经确认的收/付款账户户名","label_en":"bank / beneficiary","type":"text","category":"USER_CONFIRMED","sensitive":true,"required":true,"confirmation_target":"CANONICAL_READ_ONLY"},{"key":"bank.institution","label_zh":"经确认的开户银行","label_en":"bank / institution","type":"text","category":"USER_CONFIRMED","sensitive":true,"required":true,"confirmation_target":"CANONICAL_READ_ONLY"},{"key":"bank.account","label_zh":"经确认的银行账号","label_en":"bank / account","type":"text","category":"USER_CONFIRMED","sensitive":true,"required":true,"confirmation_target":"CANONICAL_READ_ONLY"},{"key":"company.registration_identifier","label_zh":"经确认的公司注册标识","label_en":"company / registration identifier","type":"text","category":"USER_CONFIRMED","sensitive":false,"required":true,"confirmation_target":"CANONICAL_READ_ONLY"},{"key":"contract.reference","label_zh":"客户合同编号","label_en":"contract / reference","type":"text","category":"CANONICAL","sensitive":false,"required":true,"confirmation_target":"CANONICAL_READ_ONLY"},{"key":"buyer.household_name","label_zh":"关联家庭档案名称","label_en":"buyer / household name","type":"text","category":"CANONICAL","sensitive":true,"required":true,"confirmation_target":"CANONICAL_READ_ONLY"},{"key":"buyer.signing_name","label_zh":"确认的购买/签署主体名称","label_en":"buyer / signing name","type":"text","category":"USER_CONFIRMED","sensitive":true,"required":true,"confirmation_target":"DOCUMENT_ONLY"},{"key":"participant.name","label_zh":"参与学生名称（来自关联联系人）","label_en":"participant / name","type":"text","category":"CANONICAL","sensitive":true,"required":true,"confirmation_target":"CANONICAL_READ_ONLY"},{"key":"guardian.required","label_zh":"本次是否需要监护签署","label_en":"guardian / required","type":"boolean","category":"USER_CONFIRMED","sensitive":true,"required":true,"confirmation_target":"DOCUMENT_ONLY"},{"key":"guardian.name","label_zh":"确认的监护人姓名","label_en":"guardian / name","type":"text","category":"USER_CONFIRMED","sensitive":true,"required":false,"confirmation_target":"DOCUMENT_ONLY"},{"key":"guardian.capacity","label_zh":"确认的监护签署身份","label_en":"guardian / capacity","type":"text","category":"USER_CONFIRMED","sensitive":true,"required":false,"confirmation_target":"DOCUMENT_ONLY"},{"key":"program.start_on","label_zh":"批次项目开始日","label_en":"program / start on","type":"date","category":"CANONICAL","sensitive":false,"required":true,"confirmation_target":"CANONICAL_READ_ONLY"},{"key":"program.end_on","label_zh":"批次项目结束日","label_en":"program / end on","type":"date","category":"CANONICAL","sensitive":false,"required":true,"confirmation_target":"CANONICAL_READ_ONLY"},{"key":"contract.amount","label_zh":"正式合同金额","label_en":"contract / amount","type":"money","category":"CANONICAL","sensitive":false,"required":true,"confirmation_target":"CANONICAL_READ_ONLY"},{"key":"contract.currency","label_zh":"正式合同币种","label_en":"contract / currency","type":"currency","category":"CANONICAL","sensitive":false,"required":true,"confirmation_target":"CANONICAL_READ_ONLY"},{"key":"contract.amount_words","label_zh":"金额的确定性币种格式","label_en":"contract / amount words","type":"text","category":"DERIVED","sensitive":false,"required":true,"confirmation_target":"CANONICAL_READ_ONLY"},{"key":"contract.signing_date","label_zh":"确认的合同签署日期","label_en":"contract / signing date","type":"date","category":"USER_CONFIRMED","sensitive":false,"required":true,"confirmation_target":"DOCUMENT_ONLY"},{"key":"service.accommodation","label_zh":"经确认的住宿标准","label_en":"service / accommodation","type":"text","category":"USER_CONFIRMED","sensitive":false,"required":true,"confirmation_target":"DOCUMENT_ONLY"},{"key":"service.program_component","label_zh":"经确认的项目服务金额分项","label_en":"service / program component","type":"money","category":"USER_CONFIRMED","sensitive":false,"required":true,"confirmation_target":"DOCUMENT_ONLY"},{"key":"service.logistics_component","label_zh":"经确认的住宿/交通等金额分项","label_en":"service / logistics component","type":"money","category":"USER_CONFIRMED","sensitive":false,"required":true,"confirmation_target":"DOCUMENT_ONLY"},{"key":"payment.terms","label_zh":"经确认的付款方式/期限条款","label_en":"payment / terms","type":"text","category":"USER_CONFIRMED","sensitive":false,"required":true,"confirmation_target":"DOCUMENT_ONLY"},{"key":"payment.method","label_zh":"经确认的付款操作说明","label_en":"payment / method","type":"text","category":"USER_CONFIRMED","sensitive":false,"required":true,"confirmation_target":"DOCUMENT_ONLY"},{"key":"buyer.notice_contact","label_zh":"经确认的甲方通知方式","label_en":"buyer / notice contact","type":"text","category":"USER_CONFIRMED","sensitive":true,"required":true,"confirmation_target":"DOCUMENT_ONLY"},{"key":"program.itinerary","label_zh":"经确认的本批次行程（文档内容）","label_en":"program / itinerary","type":"text","category":"USER_CONFIRMED","sensitive":false,"required":true,"confirmation_target":"DOCUMENT_ONLY"},{"key":"review.party_capacity","label_zh":"甲方/参与者条款语义审阅","label_en":"review / party capacity","type":"text","category":"UNSUPPORTED","sensitive":false,"required":true,"confirmation_target":"UNSUPPORTED"}]$fields$::jsonb
 else '[]'::jsonb end
$$;
create function public.upload_extraction_input(job_id uuid,token uuid) returns jsonb language plpgsql security definer set search_path=public,app_auth as $$
declare j public.generated_jobs;d public.uploaded_contract_documents;r public.contract_extraction_runs;begin
 select * into j from public.generated_jobs where id=job_id and job_type='CONTRACT_DOCUMENT_EXTRACTION' and status='PROCESSING' and lease_token=token and lease_expires_at>=now();
 if j.id is null then raise exception 'worker_lease_lost';end if;
 select * into d from public.uploaded_contract_documents where id=j.uploaded_document_id and workspace_id=j.workspace_id for update;
 if d.status in ('ERASURE_PENDING','ERASED') and j.parameters->>'erase'='true' then return jsonb_build_object('erase',true,'key',d.storage_key);end if;
 perform set_config('app.user_id',j.created_by::text,true);perform set_config('app.workspace_id',j.workspace_id::text,true);perform set_config('app.aal','aal2',true);
 if not public.upload_access(d.id,false) then raise exception 'upload_source_not_found';end if;
 select * into r from public.contract_extraction_runs where contract_extraction_runs.job_id=j.id and document_id=d.id;
 if r.id is null or r.status not in ('QUEUED','FAILED','EXTRACTING') then raise exception 'upload_run_invalid';end if;
 update public.contract_extraction_runs set status='EXTRACTING' where id=r.id;
 update public.uploaded_contract_documents set status='EXTRACTING' where id=d.id;
 return jsonb_build_object('id',d.id,'kind',d.source_kind,'runId',r.id,'format',d.format,'key',d.storage_key,'sha256',d.sha256,'bytes',d.bytes,'fields',public.upload_field_contract(d.source_kind));
end $$;
create function public.complete_upload_extraction(job_id uuid,token uuid,result jsonb) returns void language plpgsql security definer set search_path=public,app_auth as $$
declare input jsonb;j public.generated_jobs;d public.uploaded_contract_documents;begin
 perform 1 from public.generated_jobs where id=job_id for update;input:=public.upload_extraction_input(job_id,token);
 select * into j from public.generated_jobs where id=job_id;select * into d from public.uploaded_contract_documents where id=j.uploaded_document_id;
 if input->>'erase'='true' then
  update public.uploaded_contract_documents set status='ERASED' where id=d.id;
  perform public.complete_generated_job_leased(job_id,token,null,null);
  if not (j.parameters ? 'finalSweep') then insert into public.generated_jobs(workspace_id,job_type,uploaded_document_id,parameters,created_by,available_at) values(d.workspace_id,'CONTRACT_DOCUMENT_EXTRACTION',d.id,'{"erase":true,"finalSweep":true}',d.uploaded_by,clock_timestamp()+interval '60 seconds');end if;return;
 end if;
 if result is null or jsonb_typeof(result) is distinct from 'object' or result->>'extractorVersion' is distinct from 'LABELS_V1' or jsonb_typeof(result->'chunks') is distinct from 'array' or jsonb_typeof(result->'candidates') is distinct from 'array' or length(result::text)>3000000 or jsonb_array_length(result->'chunks') not between 1 and 5000 or jsonb_array_length(result->'candidates')>10000 then raise exception 'upload_extraction_invalid';end if;
 if exists(select 1 from jsonb_array_elements(result->'candidates') c where not exists(select 1 from jsonb_array_elements(public.upload_field_contract(d.source_kind)) f where f->>'key'=c->>'fieldKey' and f->>'confirmation_target'=c->>'confirmationTarget' and f->>'type'=c->>'type' and (c->>'sensitive')::boolean=((f->>'sensitive')::boolean or f->>'key'~'^(participant|buyer|guardian|bank)\.'))) then raise exception 'upload_extraction_invalid';end if;
 if (select count(distinct c->>'candidateKey') from jsonb_array_elements(result->'candidates') c)<>jsonb_array_length(result->'candidates') or exists(select 1 from jsonb_array_elements(public.upload_field_contract(d.source_kind)) f where not exists(select 1 from jsonb_array_elements(result->'candidates') c where c->>'fieldKey'=f->>'key')) then raise exception 'upload_extraction_invalid';end if;
 update public.contract_extraction_runs set status='EXTRACTED',chunks=result->'chunks',candidates=result->'candidates',completed_at=clock_timestamp(),error_code=null where contract_extraction_runs.job_id=complete_upload_extraction.job_id and id=(input->>'runId')::uuid;
 update public.uploaded_contract_documents set status='EXTRACTED',revision=revision+1 where id=d.id;
 perform public.complete_generated_job_leased(job_id,token,null,null);
 insert into public.audit_events(workspace_id,actor_id,action,entity_type,entity_id,after_data) values(d.workspace_id,j.created_by,'CONTRACT_DOCUMENT_EXTRACTED','UPLOADED_CONTRACT_DOCUMENT',d.id,jsonb_build_object('runId',input->'runId','candidateCount',jsonb_array_length(result->'candidates')));
end $$;
create function public.fail_upload_extraction(job_id uuid,token uuid,error_code text) returns void language plpgsql security definer set search_path=public,app_auth as $$
declare j public.generated_jobs;begin
 select * into j from public.generated_jobs where id=job_id and job_type='CONTRACT_DOCUMENT_EXTRACTION' and status='PROCESSING' and lease_token=token and lease_expires_at>=now();if j.id is null then raise exception 'worker_lease_lost';end if;
 if error_code !~ '^[A-Z_]{3,80}$' then error_code:='EXTRACTION_FAILED';end if;
 update public.contract_extraction_runs set status='FAILED',error_code=fail_upload_extraction.error_code where contract_extraction_runs.job_id=j.id and status='EXTRACTING';
 update public.uploaded_contract_documents set status='EXTRACTION_FAILED' where id=j.uploaded_document_id and status='EXTRACTING';
 perform public.fail_generated_job_leased(job_id,token,error_code);
end $$;
create function public.upload_immutable() returns trigger language plpgsql as $$begin
 if tg_table_name='uploaded_contract_documents' then
  if (to_jsonb(new)-array['status','revision','privacy_contacts','filename'])<>(to_jsonb(old)-array['status','revision','privacy_contacts','filename']) or ((new.privacy_contacts is distinct from old.privacy_contacts or new.filename is distinct from old.filename) and new.status not in ('ERASURE_PENDING','ERASED')) then raise exception 'upload_immutable';end if;
 elsif tg_table_name='contract_extraction_runs' then
  if (to_jsonb(new)-array['status','chunks','candidates','error_code','completed_at','job_id'])<>(to_jsonb(old)-array['status','chunks','candidates','error_code','completed_at','job_id']) or (old.status='EXTRACTED' and new.status<>'ERASED' and (new.chunks is distinct from old.chunks or new.candidates is distinct from old.candidates)) then raise exception 'upload_immutable';end if;
 else raise exception 'upload_review_immutable';end if;return new;end $$;
create trigger uploaded_immutable before update on public.uploaded_contract_documents for each row execute function public.upload_immutable();
create trigger extracted_immutable before update on public.contract_extraction_runs for each row execute function public.upload_immutable();
create trigger review_immutable before update on public.contract_extraction_reviews for each row execute function public.upload_immutable();

create function public.erase_uploaded_subject() returns trigger language plpgsql security definer set search_path=public,app_auth as $$
declare subject uuid;d public.uploaded_contract_documents;j uuid;begin
 subject:=coalesce((to_jsonb(old)->>'person_id')::uuid,old.id);
 for d in select * from public.uploaded_contract_documents where workspace_id=old.workspace_id and privacy_contacts ? subject::text and status not in ('ERASED','ERASURE_PENDING') for update loop
  update public.uploaded_contract_documents set status='ERASURE_PENDING',privacy_contacts='[]',filename='Erased' where id=d.id;
  update public.contract_extraction_runs set status='ERASED',chunks=null,candidates=null where document_id=d.id;
  delete from public.contract_extraction_reviews where document_id=d.id;delete from public.uploaded_contract_receipts where document_id=d.id;
  update public.generated_jobs set status='DEAD',lease_token=null,lease_expires_at=null where uploaded_document_id=d.id;
  insert into public.generated_jobs(workspace_id,job_type,uploaded_document_id,parameters,created_by) values(d.workspace_id,'CONTRACT_DOCUMENT_EXTRACTION',d.id,'{"erase":true}',d.uploaded_by) returning id into j;
 end loop;return old;end $$;
create trigger upload_student_erasure before delete on public.students for each row execute function public.erase_uploaded_subject();
create trigger upload_contact_erasure before delete on public.contacts for each row execute function public.erase_uploaded_subject();
create function public.upload_privacy_records(job_id uuid,token uuid) returns jsonb language plpgsql stable security definer set search_path=public,app_auth as $$
declare j public.generated_jobs;subject uuid;begin
 select * into j from public.generated_jobs where id=job_id and job_type='PRIVACY_EXPORT' and status='PROCESSING' and lease_token=token and lease_expires_at>=now();if j.id is null then raise exception 'worker_lease_lost';end if;
 select requester_contact_id into subject from public.privacy_requests where id=j.privacy_request_id and workspace_id=j.workspace_id and identity_status='VERIFIED';if subject is null or subject::text<>j.parameters->>'contactId' then raise exception 'privacy_scope_invalid';end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',d.id,'sha256',d.sha256,'source_kind',d.source_kind,'source_id',d.source_id,'status',d.status,'source_revision',d.source_revision)) from public.uploaded_contract_documents d where d.workspace_id=j.workspace_id and d.privacy_contacts ? subject::text),'[]');end $$;
create function public.upload_job_visible(record_id uuid) returns boolean language sql stable security definer set search_path=public as $$select public.upload_access(record_id,false)$$;
create policy uploaded_job_scope on public.generated_jobs as restrictive for select to crm_app using(uploaded_document_id is null or public.upload_job_visible(uploaded_document_id));
alter table public.uploaded_contract_documents enable row level security;
alter table public.uploaded_contract_receipts enable row level security;
alter table public.contract_extraction_runs enable row level security;
alter table public.contract_extraction_reviews enable row level security;
-- Evidence is available only through source-authorized, masked RPCs; no direct app/worker table grants.

DO $permissions$ declare f record;begin
 for f in select oid::regprocedure signature from pg_proc where pronamespace='public'::regnamespace and proname in ('upload_candidate_state','upload_manage','upload_context','upload_access','reserve_contract_upload','queue_contract_extraction','complete_contract_upload','uploaded_documents_list','uploaded_document_detail','uploaded_original_download','review_uploaded_candidate','upload_field_contract','upload_extraction_input','complete_upload_extraction','fail_upload_extraction','upload_immutable','erase_uploaded_subject','upload_privacy_records','upload_job_visible') loop
  execute format('revoke all on function %s from public',f.signature);
 end loop;
 for f in select oid::regprocedure signature from pg_proc where pronamespace='public'::regnamespace and proname in ('upload_context','reserve_contract_upload','queue_contract_extraction','complete_contract_upload','uploaded_documents_list','uploaded_document_detail','uploaded_original_download','review_uploaded_candidate','upload_job_visible') loop
  execute format('grant execute on function %s to crm_app',f.signature);
 end loop;
 for f in select oid::regprocedure signature from pg_proc where pronamespace='public'::regnamespace and proname in ('upload_extraction_input','complete_upload_extraction','fail_upload_extraction','upload_privacy_records') loop
  execute format('grant execute on function %s to crm_worker,crm_system',f.signature);
 end loop;
end $permissions$;
