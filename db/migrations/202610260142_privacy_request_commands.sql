set search_path=public,app_auth,extensions;

create function public.privacy_review_token(r public.privacy_requests) returns text
language sql immutable set search_path=public,extensions as $$
 select encode(digest(((to_jsonb(r)-array['created_at','updated_at','due_at','fulfilled_at'])||jsonb_build_object(
 'created_at',extract(epoch from r.created_at),'updated_at',extract(epoch from r.updated_at),
 'due_at',extract(epoch from r.due_at),'fulfilled_at',extract(epoch from r.fulfilled_at)))::text,'sha256'),'hex');
$$;
create function public.privacy_request_projection(r public.privacy_requests) returns jsonb
language sql stable set search_path=public,app_auth,extensions as $$
 select jsonb_build_object('id',r.id,'contactId',r.requester_contact_id,'createdBy',r.created_by,'type',r.request_type,'status',r.status,
 'identityStatus',r.identity_status,'note',r.request_note,'decisionNote',coalesce(r.decision_note,''),'dueAt',r.due_at,'createdAt',r.created_at,
 'assignedTo',coalesce(r.assigned_to::text,''),'requestedChanges',coalesce((select jsonb_object_agg(e.key,e.value) from jsonb_each(case when jsonb_typeof(r.requested_changes)='object' then r.requested_changes else '{}'::jsonb end) e where e.key in ('nameZh','nameEn','email','phone','title') and jsonb_typeof(e.value)='string'),'{}'::jsonb),'reviewToken',public.privacy_review_token(r),
 'executionStatus',coalesce(e.status,''),'executionFailed',coalesce(e.status='FAILED',false),
 'artifactExpiresAt',e.artifact_expires_at,'receiptSha256',coalesce(e.receipt_sha256,''))
 from (select 1) singleton left join public.privacy_executions e on e.request_id=r.id;
$$;
create function public.list_privacy_requests(p_status text default 'all',p_type text default 'all',p_scope text default 'all',p_due text default 'all',p_page integer default 1,p_page_size integer default 20) returns jsonb
language plpgsql stable set search_path=public,app_auth,extensions as $$
begin
 if p_status is null or p_status not in ('all','RECEIVED','IDENTITY_REVIEW','IN_PROGRESS','WAITING_APPROVAL','EXECUTING','EXECUTION_FAILED','FULFILLED','REJECTED','CANCELLED')
 or p_type is null or p_type not in ('all','ACCESS','EXPORT','CORRECTION','RESTRICTION','DELETION') or p_scope is null or p_scope not in ('all','mine') or p_due is null or p_due not in ('all','overdue')
 or p_page is null or p_page not between 1 and 100000 or p_page_size is null or p_page_size not in (10,20,50) then raise exception 'privacy_view_invalid';end if;
 return (with matching as materialized(select r.* from public.privacy_requests r
  where (p_status='all' or r.status=p_status) and (p_type='all' or r.request_type=p_type)
  and (p_scope='all' or r.created_by=app_auth.current_user_id())
  and (p_due='all' or r.due_at<now() and r.status not in ('FULFILLED','REJECTED','CANCELLED'))),
 page_rows as(select * from matching order by created_at desc,id desc offset (p_page-1)*p_page_size limit p_page_size)
 select jsonb_build_object('items',coalesce((select jsonb_agg(public.privacy_request_projection(r::public.privacy_requests) order by r.created_at desc,r.id desc) from page_rows r),'[]'::jsonb),
 'total',(select count(*) from matching),'page',p_page,'pageSize',p_page_size));
end $$;

create function public.privacy_request_command(p_command jsonb,p_request_key text) returns jsonb
language plpgsql security definer set search_path=public,app_auth,extensions as $$
declare actor uuid:=app_auth.current_user_id();ws uuid:=public.current_workspace_id();op text:=p_command->>'operation';
 r public.privacy_requests;receipt public.mutation_receipts;fingerprint text;result jsonb;changes jsonb;contact_id uuid;
begin
 if actor is null or not public.is_workspace_member(ws) or public.current_crm_role() is null then raise exception 'privacy_access_denied';end if;
 if jsonb_typeof(p_command) is distinct from 'object' or op is null or op not in ('create','manage')
 or p_request_key is null or p_request_key!~'^[a-f0-9-]{36}$' then raise exception 'privacy_input_invalid';end if;
 if op='manage' then
  if public.current_crm_role() not in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR') then raise exception 'privacy_access_denied';end if;
  if coalesce(app_auth.current_claims()->>'aal','aal1')<>'aal2' then raise exception 'mfa_required';end if;
  if p_command-array['operation','id','reviewToken','status','identityStatus','decision']<>'{}'::jsonb or p_command->>'id' is null or p_command->>'reviewToken' is null
   or p_command->>'reviewToken'!~'^[a-f0-9]{64}$' or length(coalesce(trim(p_command->>'decision'),'')) not between 3 and 2000 then raise exception 'privacy_input_invalid';end if;
 else
  changes:=coalesce(p_command->'changes','{}'::jsonb);
  if p_command-array['operation','type','contactId','note','changes']<>'{}'::jsonb or p_command->>'contactId' is null
   or coalesce(p_command->>'type','') not in ('ACCESS','EXPORT','CORRECTION','RESTRICTION','DELETION')
   or length(coalesce(trim(p_command->>'note'),'')) not between 10 and 2000 or jsonb_typeof(changes) is distinct from 'object'
   or exists(select 1 from jsonb_each(changes) x where x.key not in ('nameZh','nameEn','email','phone','title') or jsonb_typeof(x.value)<>'string' or length(x.value#>>'{}')>320)
   or ((p_command->>'type'='CORRECTION') is distinct from (changes<>'{}'::jsonb)) then raise exception 'privacy_input_invalid';end if;
 end if;
 fingerprint:=encode(digest(p_command::text,'sha256'),'hex');
 perform pg_advisory_xact_lock(hashtextextended(ws::text||':privacy-command:'||p_request_key,0));
 if op='manage' then
  select * into r from public.privacy_requests where id=(p_command->>'id')::uuid and workspace_id=ws for update;
  if not found then raise exception 'privacy_access_denied';end if;
 end if;
 select * into receipt from public.mutation_receipts where workspace_id=ws and request_key=p_request_key;
 if found then
  if receipt.created_by is distinct from actor or receipt.operation<>'PRIVACY_COMMAND' or receipt.result->>'request_hash' is distinct from fingerprint then raise exception 'privacy_request_conflict';end if;
  if op='create' and not exists(select 1 from public.privacy_requests where id=(receipt.result->'item'->>'id')::uuid and workspace_id=ws and created_by=actor) then raise exception 'privacy_access_denied';end if;
  return receipt.result->'item';
 end if;
 if op='create' then
  contact_id:=(p_command->>'contactId')::uuid;
  if not public.customer_subject_access('CONTACT',contact_id,false) or not exists(select 1 from public.contacts where id=contact_id and workspace_id=ws and archived_at is null) then raise exception 'privacy_contact_unavailable';end if;
  insert into public.privacy_requests(workspace_id,requester_contact_id,request_type,request_note,requested_changes,created_by)
  values(ws,contact_id,p_command->>'type',trim(p_command->>'note'),changes,actor) returning * into r;
 else
  if public.privacy_review_token(r)<>p_command->>'reviewToken' then raise exception 'privacy_snapshot_conflict';end if;
  r:=public.manage_privacy_request(r.id,p_command->>'status',p_command->>'identityStatus',p_command->>'decision');
 end if;
 result:=jsonb_build_object('id',r.id,'status',r.status,'identityStatus',r.identity_status,'accepted',true);
 insert into public.audit_events(workspace_id,actor_id,entity_type,entity_id,action,after_data,request_id)
 values(ws,actor,'PRIVACY_REQUEST',r.id::text,'PRIVACY_COMMAND_CONFIRMED',result,p_request_key);
 insert into public.mutation_receipts(workspace_id,request_key,operation,result,created_by)
 values(ws,p_request_key,'PRIVACY_COMMAND',jsonb_build_object('request_hash',fingerprint,'item',result),actor);
 return result;
end $$;
revoke all on function public.privacy_review_token(public.privacy_requests),public.privacy_request_projection(public.privacy_requests),public.list_privacy_requests(text,text,text,text,integer,integer),public.privacy_request_command(jsonb,text) from public,crm_system,crm_worker;
grant execute on function public.privacy_review_token(public.privacy_requests),public.privacy_request_projection(public.privacy_requests),public.list_privacy_requests(text,text,text,text,integer,integer),public.privacy_request_command(jsonb,text) to crm_app;
