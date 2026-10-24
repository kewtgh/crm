set search_path=public,app_auth,extensions;

create function public.recycle_resource_kinds() returns text[] language sql immutable as $$
 select array['ORGANIZATION','CONTACT','STUDENT','HOUSEHOLD','TASK','PRODUCT','LEAD','OPPORTUNITY','CONTRACT','ENROLLMENT','APPLICATION','SUPPORT_CASE','SUPPORT_GOAL','SUPPORT_CHECKIN','SUPPORT_RISK','SUPPORT_INTERVENTION','ORGANIZATION_PROFILE','FAMILY_NEED','PATHWAY','OUTREACH_EVENT','REFERRAL','EVENT_PARTICIPATION','ACADEMIC_RECORD','COHORT','BUNDLE','QUOTE','CAMPAIGN','ADMISSION_JOURNEY','MILESTONE','WORKFLOW_TEMPLATE','APPOINTMENT','EXCHANGE_RATE','ADMISSION_OUTCOME','CONTACT_INTELLIGENCE','CONTACT_RELATIONSHIP','FOLLOWUP_PLAN','FOLLOWUP_ENTRY','ACTIVITY','IMPORT_BATCH','IMPORT_MAPPING','IMPORT_SET','PRODUCT_PRICE','CHANNEL_AGREEMENT','CHANNEL_AGREEMENT_VERSION']::text[];
$$;
revoke all on function public.recycle_resource_kinds() from public,crm_system,crm_worker;
grant execute on function public.recycle_resource_kinds() to crm_app;

create function public.query_recycle_records(p_scope text,p_query text,p_kind text,p_retention text,p_page integer,p_page_size integer)
returns jsonb language plpgsql stable security definer set search_path=public,app_auth,extensions as $$
declare
 ws uuid:=public.current_workspace_id();actor uuid:=app_auth.current_user_id();
 resource text;table_name text;fragments text[]:='{}';source_sql text;result jsonb;
begin
 if actor is null or not public.is_workspace_member(ws) or p_scope is null or p_scope not in ('personal','workspace') then raise exception 'recycle_access_denied';end if;
 if p_scope='workspace' then
  if public.current_crm_role()<>'SUPER_ADMIN' then raise exception 'recycle_access_denied';end if;
  if coalesce(app_auth.current_claims()->>'aal','aal1')<>'aal2' then raise exception 'mfa_required';end if;
 end if;
 if p_query is null or length(p_query)>100 or p_kind is null or (p_kind<>'all' and not p_kind=any(public.recycle_resource_kinds()))
  or p_retention is null or p_retention not in ('all','eligible','retained')
  or p_page is null or p_page not between 1 and 1000000 or p_page_size is null or p_page_size not between 1 and 50 then raise exception 'recycle_input_invalid';end if;
 foreach resource in array public.recycle_resource_kinds() loop
  if p_kind<>'all' and resource<>p_kind then continue;end if;
  table_name:=public.deletion_resource_table(resource);
  if table_name is null then raise exception 'recycle_catalog_invalid';end if;
  fragments:=array_append(fragments,format($q$
   select %L::text kind,to_jsonb(x) r from public.%I x
   where workspace_id=$1 and archived_at is not null
   and ($2='workspace' or public.personal_recycle_access(%L,to_jsonb(x)))$q$,resource,table_name,resource));
 end loop;
 source_sql:=array_to_string(fragments,' union all ');
 execute 'with visible as ('||source_sql||$q$), labeled as (
  select kind,r,
   coalesce(r->>'name_zh',r->>'title_zh',r->>'name',r->>'title',r->>'contract_number',r->>'student_number',r->>'id') label_zh,
   coalesce(r->>'name_en',r->>'title_en',r->>'name',r->>'title',r->>'contract_number',r->>'student_number',r->>'id') label_en,
   (r->>'archived_at')::timestamptz deleted_at,
   case when kind in ('ORGANIZATION','CONTACT','TASK','STUDENT','HOUSEHOLD','PRODUCT','LEAD')
    then (r->>'archived_at')::timestamptz+interval '30 days' else null end purge_eligible_at
  from visible), filtered as (
  select * from labeled where
   ($3='' or strpos(lower(label_zh||' '||label_en||' '||(r->>'id')),lower($3))>0)
   and ($4='all' or ($4='eligible' and purge_eligible_at<=now())
    or ($4='retained' and (purge_eligible_at is null or purge_eligible_at>now())))
 ), paged as (select * from filtered order by deleted_at desc,kind,r->>'id' limit $5 offset $6)
 select jsonb_build_object('scope',$2,'page',$7,'pageSize',$5,'total',(select count(*) from filtered),
  'items',coalesce(jsonb_agg(jsonb_build_object('id',r->>'id','kind',kind,'labelZh',label_zh,'labelEn',label_en,
    'deletedAt',r->>'archived_at','purgeEligibleAt',purge_eligible_at) order by deleted_at desc,kind,r->>'id'),'[]'::jsonb)) from paged$q$
 into result using ws,p_scope,trim(p_query),p_retention,p_page_size,(p_page::bigint-1)*p_page_size,p_page;
 return result;
end $$;
revoke all on function public.query_recycle_records(text,text,text,text,integer,integer) from public,crm_system,crm_worker;
grant execute on function public.query_recycle_records(text,text,text,text,integer,integer) to crm_app;

create function public.restore_recycle_record_command(p_scope text,p_kind text,p_id uuid,p_deleted_at timestamptz,p_request_key text)
returns jsonb language plpgsql security definer set search_path=public,app_auth,extensions as $$
declare
 ws uuid:=public.current_workspace_id();actor uuid:=app_auth.current_user_id();
 table_name text:=public.deletion_resource_table(p_kind);r jsonb;receipt public.mutation_receipts;
 fingerprint text;result jsonb;restored boolean;
begin
 if actor is null or not public.is_workspace_member(ws) or p_scope is null or p_scope not in ('personal','workspace') then raise exception 'recycle_access_denied';end if;
 if p_scope='workspace' and public.current_crm_role()<>'SUPER_ADMIN' then raise exception 'recycle_access_denied';end if;
 if (p_scope='workspace' or public.current_crm_role() in ('ADMIN','SUPER_ADMIN')) and coalesce(app_auth.current_claims()->>'aal','aal1')<>'aal2' then raise exception 'mfa_required';end if;
 if table_name is null or p_kind is null or not p_kind=any(public.recycle_resource_kinds()) or p_id is null or p_deleted_at is null
  or not isfinite(p_deleted_at) or p_request_key is null or length(p_request_key) not between 8 and 120 or p_request_key<>trim(p_request_key) then raise exception 'recycle_input_invalid';end if;
 perform pg_advisory_xact_lock(hashtextextended(ws::text||':recycle-restore:'||p_request_key,0));
 execute format('select to_jsonb(x) from public.%I x where id=$1 and workspace_id=$2 for update',table_name) into r using p_id,ws;
 if r is null or (p_scope='personal' and not public.personal_recycle_access(p_kind,r)) then raise exception 'recycle_access_denied';end if;
 -- Epoch is independent of session/workspace timezone and preserves microseconds.
 fingerprint:=encode(digest(jsonb_build_array(p_scope,p_kind,p_id,extract(epoch from p_deleted_at))::text,'sha256'),'hex');
 select * into receipt from public.mutation_receipts where workspace_id=ws and request_key=p_request_key;
 if found then
  if receipt.created_by is distinct from actor or receipt.operation<>'RECYCLE_RESTORE' or receipt.result->>'request_hash' is distinct from fingerprint then raise exception 'recycle_request_conflict';end if;
  return receipt.result->'item';
 end if;
 if r->>'archived_at' is null or (r->>'archived_at')::timestamptz<>p_deleted_at then raise exception 'recycle_version_conflict';end if;
 if p_scope='workspace' then restored:=public.restore_crm_recycle_bin(p_kind,p_id);
 else restored:=public.restore_personal_recycle_record(p_kind,p_id);end if;
 if restored is distinct from true then raise exception 'recycle_restore_failed';end if;
 result:=jsonb_build_object('id',p_id,'kind',p_kind,'restored',true);
 insert into public.audit_events(workspace_id,actor_id,entity_type,entity_id,action,after_data,request_id)
  values(ws,actor,p_kind,p_id,'RECYCLE_RESTORE_CONFIRMED',jsonb_build_object('scope',p_scope,'deletedAt',p_deleted_at),p_request_key);
 insert into public.mutation_receipts(workspace_id,request_key,operation,result,created_by)
  values(ws,p_request_key,'RECYCLE_RESTORE',jsonb_build_object('request_hash',fingerprint,'item',result),actor);
 return result;
end $$;
revoke all on function public.restore_recycle_record_command(text,text,uuid,timestamptz,text) from public,crm_system,crm_worker;
grant execute on function public.restore_recycle_record_command(text,text,uuid,timestamptz,text) to crm_app;
revoke execute on function public.restore_crm_recycle_bin(text,uuid),public.restore_personal_recycle_record(text,uuid) from public,crm_app,crm_system,crm_worker;
