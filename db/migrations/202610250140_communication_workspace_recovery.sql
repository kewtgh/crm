set search_path=public,app_auth,extensions;

create function public.query_communication_inbox(p_query text,p_status text,p_purpose text,p_delivery text,p_page integer,p_page_size integer)
returns jsonb language plpgsql stable security definer set search_path=public,app_auth,extensions as $$
declare result jsonb;
begin
 if app_auth.current_user_id() is null or not public.is_workspace_member(public.current_workspace_id())
  or coalesce(public.current_crm_role(),'') not in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER','SALES_SPECIALIST','SALES_SUPPORT','OPERATIONS_MANAGER','CUSTOMER_SUCCESS_SPECIALIST') then raise exception 'communication_access_denied';end if;
 if p_query is null or length(p_query)>160 or p_status is null or p_status not in ('all','OPEN','CLOSED')
  or p_purpose is null or p_purpose not in ('all','SERVICE','TRANSACTIONAL','EVENT','MARKETING')
  or p_delivery is null or p_delivery not in ('all','pending','failed','uncertain')
  or p_page is null or p_page not between 1 and 100000 or p_page_size is null or p_page_size not in (10,20,50) then raise exception 'communication_input_invalid';end if;
 with filtered as (
  select thread.*,contact.name_zh contact_zh,contact.name_en contact_en,contact.email::text contact_email
  from public.communication_threads thread join public.contact_visible_records contact on contact.id=thread.contact_id
  where thread.workspace_id=public.current_workspace_id() and contact.archived_at is null
   and (p_status='all' or thread.status=p_status) and (p_purpose='all' or thread.purpose=p_purpose)
   and (trim(p_query)='' or strpos(lower(concat_ws(' ',thread.subject,contact.name_zh,contact.name_en,contact.email::text)),lower(trim(p_query)))>0
    or exists(select 1 from public.communication_messages message where message.thread_id=thread.id and strpos(lower(message.body),lower(trim(p_query)))>0))
   and (p_delivery='all' or exists(select 1 from public.communication_messages message where message.thread_id=thread.id and message.direction='OUTBOUND'
    and (p_delivery='pending' and message.delivery_status in ('QUEUED','PROCESSING')
     or p_delivery='failed' and message.delivery_status='FAILED' and not message.outcome_may_have_been_accepted
     or p_delivery='uncertain' and (message.delivery_status='UNCERTAIN' or message.outcome_may_have_been_accepted))))
 ), paged as (
  select * from filtered order by coalesce(last_message_at,created_at) desc,created_at desc,id desc
  limit p_page_size offset (p_page::bigint-1)*p_page_size
 )
 select jsonb_build_object('items',coalesce(jsonb_agg(jsonb_build_object(
  'id',id,'contactId',contact_id,'contactZh',contact_zh,'contactEn',contact_en,'email',coalesce(contact_email,''),
  'subject',subject,'channel',channel,'purpose',purpose,'status',status,'lastMessageAt',last_message_at
 ) order by coalesce(last_message_at,created_at) desc,created_at desc,id desc),'[]'::jsonb),
 'total',(select count(*) from filtered),'page',p_page,'pageSize',p_page_size) into result from paged;
 return result;
end $$;
revoke all on function public.query_communication_inbox(text,text,text,text,integer,integer) from public,crm_system,crm_worker;
grant execute on function public.query_communication_inbox(text,text,text,text,integer,integer) to crm_app;

-- Keep the existing independently paginated detail, adding the exact failure identity.
alter function public.communication_thread_snapshot(uuid,integer,integer) rename to communication_thread_snapshot_before_v343;
revoke all on function public.communication_thread_snapshot_before_v343(uuid,integer,integer) from public,crm_app,crm_system,crm_worker;
create function public.communication_thread_snapshot(target_thread uuid,requested_message_page integer default null,requested_message_page_size integer default 20)
returns jsonb language plpgsql stable security definer set search_path=public,app_auth,extensions as $$
declare result jsonb;messages jsonb;
begin
 if not public.is_workspace_member(public.current_workspace_id()) or not exists(
  select 1 from public.communication_threads thread join public.contact_visible_records contact on contact.id=thread.contact_id
  where thread.id=target_thread and thread.workspace_id=public.current_workspace_id() and contact.archived_at is null
 ) then raise exception 'communication_thread_not_found';end if;
 result:=public.communication_thread_snapshot_before_v343(target_thread,requested_message_page,requested_message_page_size);
 select coalesce(jsonb_agg(entry.value||jsonb_build_object('retryToken',message.updated_at) order by entry.ordinality),'[]'::jsonb)
 into messages from jsonb_array_elements(result->'messages') with ordinality entry(value,ordinality)
 join public.communication_messages message on message.id=(entry.value->>'id')::uuid;
 return jsonb_set(result,'{messages}',messages);
end $$;
revoke all on function public.communication_thread_snapshot(uuid,integer,integer) from public,crm_system,crm_worker;
grant execute on function public.communication_thread_snapshot(uuid,integer,integer) to crm_app;

create function public.communication_workspace_command(p_command jsonb,p_request_key text)
returns jsonb language plpgsql security definer set search_path=public,app_auth,extensions as $$
declare
 ws uuid:=public.current_workspace_id();actor uuid:=app_auth.current_user_id();op text:=p_command->>'operation';
 thread public.communication_threads;message public.communication_messages;contact_id uuid;target_thread uuid;
 receipt public.mutation_receipts;fingerprint text;legacy_key text;result jsonb;queued jsonb;observed timestamptz;
begin
 if actor is null or not public.is_workspace_member(ws) or coalesce(public.current_crm_role(),'') not in
  ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER','SALES_SPECIALIST','SALES_SUPPORT') then raise exception 'communication_access_denied';end if;
 if jsonb_typeof(p_command) is distinct from 'object' or op is null or op not in ('thread','send','inbound','retry')
  or p_request_key is null or length(p_request_key) not between 8 and 160 or p_request_key<>trim(p_request_key) then raise exception 'communication_input_invalid';end if;
 if op='thread' then
  if p_command-array['operation','contactId','subject','channel','purpose']<>'{}'::jsonb
   or coalesce(length(trim(p_command->>'subject')),0) not between 2 and 200
   or coalesce(p_command->>'channel','')<>'EMAIL' or coalesce(p_command->>'purpose','') not in ('SERVICE','TRANSACTIONAL','EVENT','MARKETING') then raise exception 'communication_input_invalid';end if;
  contact_id:=(p_command->>'contactId')::uuid;
 elsif op in ('send','inbound') then
  if p_command-array['operation','threadId','body']<>'{}'::jsonb or coalesce(length(trim(p_command->>'body')),0) not between 1 and 10000 then raise exception 'communication_input_invalid';end if;
  target_thread:=(p_command->>'threadId')::uuid;
 else
  if p_command-array['operation','messageId','expectedUpdatedAt']<>'{}'::jsonb or p_command->>'expectedUpdatedAt' is null then raise exception 'communication_input_invalid';end if;
  observed:=(p_command->>'expectedUpdatedAt')::timestamptz;
  if not isfinite(observed) then raise exception 'communication_input_invalid';end if;
  select candidate.thread_id into target_thread from public.communication_messages candidate
   where candidate.id=(p_command->>'messageId')::uuid and candidate.workspace_id=ws;
 end if;
 perform pg_advisory_xact_lock(hashtextextended(ws::text||':communication-command:'||p_request_key,0));
 if op<>'thread' then
  select candidate.* into thread from public.communication_threads candidate where candidate.id=target_thread and candidate.workspace_id=ws for update;
  if not found then raise exception 'communication_access_denied';end if;
  contact_id:=thread.contact_id;
 end if;
 -- Current access is mandatory even when the command was accepted earlier.
 if not exists(select 1 from public.contact_visible_records contact where contact.id=contact_id and contact.workspace_id=ws and contact.archived_at is null)
  then raise exception 'communication_access_denied';end if;
 fingerprint:=encode(digest(p_command::text,'sha256'),'hex');
 select * into receipt from public.mutation_receipts where workspace_id=ws and request_key=p_request_key;
 if found then
  if receipt.created_by is distinct from actor or receipt.operation<>'COMMUNICATION_WORKSPACE' or receipt.result->>'request_hash' is distinct from fingerprint then raise exception 'communication_request_conflict';end if;
  return receipt.result->'item';
 end if;
 legacy_key:=encode(digest(ws::text||':'||actor::text||':'||p_request_key,'sha256'),'hex');
 if op='thread' then
  thread:=public.create_communication_thread(contact_id,p_command->>'subject','EMAIL',p_command->>'purpose',legacy_key);
  result:=jsonb_build_object('operation',op,'threadId',thread.id);
 else
  if thread.status<>'OPEN' then raise exception 'communication_thread_not_open';end if;
  if op='send' then
   queued:=public.queue_communication_message(thread.id,p_command->>'body',legacy_key);
   result:=jsonb_build_object('operation',op,'threadId',thread.id,'messageId',queued->'message'->>'id','deliveryStatus',queued->'message'->>'delivery_status','accepted',true);
  elsif op='inbound' then
   message:=public.record_inbound_communication(thread.id,p_command->>'body',legacy_key);
   result:=jsonb_build_object('operation',op,'threadId',thread.id,'messageId',message.id,'deliveryStatus',message.delivery_status,'accepted',true);
  else
   select candidate.* into message from public.communication_messages candidate where candidate.id=(p_command->>'messageId')::uuid and candidate.thread_id=thread.id and candidate.workspace_id=ws for update;
   if not found or message.updated_at<>observed then raise exception 'communication_version_conflict';end if;
   if message.direction<>'OUTBOUND' or message.delivery_status<>'FAILED' or message.outcome_may_have_been_accepted then raise exception 'communication_delivery_not_retryable';end if;
   message:=public.requeue_failed_communication_delivery(message.id);
   result:=jsonb_build_object('operation',op,'threadId',thread.id,'messageId',message.id,'deliveryStatus','QUEUED','accepted',true);
  end if;
 end if;
 insert into public.audit_events(workspace_id,actor_id,entity_type,entity_id,action,after_data,request_id)
  values(ws,actor,'communication_thread',thread.id::text,'COMMUNICATION_COMMAND_CONFIRMED',
   jsonb_build_object('operation',op,'messageId',result->>'messageId','deliveryStatus',result->>'deliveryStatus'),p_request_key);
 insert into public.mutation_receipts(workspace_id,request_key,operation,result,created_by)
  values(ws,p_request_key,'COMMUNICATION_WORKSPACE',jsonb_build_object('request_hash',fingerprint,'item',result),actor);
 return result;
end $$;
revoke all on function public.communication_workspace_command(jsonb,text) from public,crm_system,crm_worker;
grant execute on function public.communication_workspace_command(jsonb,text) to crm_app;
-- No unversioned staff redelivery bypass. Batch creation/queue producers keep their interfaces.
revoke execute on function public.requeue_failed_communication_delivery(uuid) from public,crm_app,crm_system,crm_worker;
