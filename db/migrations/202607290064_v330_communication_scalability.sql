alter table public.communication_threads
  add column if not exists creation_request_key text,
  add column if not exists creation_request_fingerprint text;

alter table public.communication_threads
  drop constraint if exists communication_threads_creation_request_key_check;
alter table public.communication_threads
  add constraint communication_threads_creation_request_key_check
  check (
    creation_request_key is null
    or (
      creation_request_key=trim(creation_request_key)
      and length(creation_request_key) between 8 and 160
    )
  );

alter table public.communication_threads
  drop constraint if exists communication_threads_creation_request_fingerprint_check;
alter table public.communication_threads
  add constraint communication_threads_creation_request_fingerprint_check
  check (
    (creation_request_key is null and creation_request_fingerprint is null)
    or (
      creation_request_key is not null
      and creation_request_fingerprint ~ '^[a-f0-9]{64}$'
    )
  );

create unique index if not exists communication_threads_creation_request_uidx
  on public.communication_threads(workspace_id,created_by,creation_request_key)
  where creation_request_key is not null;

drop function if exists public.create_communication_thread(uuid,text,text,text);

create or replace function public.create_communication_thread(
  target_contact uuid,
  target_subject text,
  target_channel text,
  target_purpose text,
  target_request_key text
)
returns public.communication_threads
language plpgsql
security definer
set search_path=public,app_auth,extensions
as $$
declare
  result public.communication_threads;
  ws uuid:=public.current_workspace_id();
  actor uuid:=app_auth.current_user_id();
  normalized_subject text:=trim(coalesce(target_subject,''));
  normalized_channel text:=upper(trim(coalesce(target_channel,'')));
  normalized_purpose text:=upper(trim(coalesce(target_purpose,'')));
  normalized_request_key text:=trim(coalesce(target_request_key,''));
  request_fingerprint text;
begin
  if actor is null
    or length(normalized_subject) not between 2 and 200
    or normalized_channel<>'EMAIL'
    or normalized_purpose not in ('SERVICE','TRANSACTIONAL','EVENT','MARKETING')
    or length(normalized_request_key) not between 8 and 160
    or not exists(
      select 1 from public.contacts
      where id=target_contact and workspace_id=ws
    )
  then
    raise exception 'communication_thread_invalid';
  end if;

  request_fingerprint:=encode(extensions.digest(convert_to(jsonb_build_object(
    'contactId',target_contact,
    'subject',normalized_subject,
    'channel',normalized_channel,
    'purpose',normalized_purpose
  )::text,'UTF8'),'sha256'),'hex');

  select thread.* into result
  from public.communication_threads thread
  where thread.workspace_id=ws
    and thread.created_by=actor
    and thread.creation_request_key=normalized_request_key
  for update;
  if found then
    if result.creation_request_fingerprint is distinct from request_fingerprint then
      raise exception 'communication_thread_idempotency_conflict';
    end if;
    return result;
  end if;

  insert into public.communication_threads(
    workspace_id,contact_id,subject,channel,purpose,assigned_to,created_by,
    creation_request_key,creation_request_fingerprint
  )
  values(
    ws,target_contact,normalized_subject,normalized_channel,normalized_purpose,actor,actor,
    normalized_request_key,request_fingerprint
  )
  on conflict (workspace_id,created_by,creation_request_key)
    where creation_request_key is not null
  do nothing
  returning * into result;

  if not found then
    select thread.* into result
    from public.communication_threads thread
    where thread.workspace_id=ws
      and thread.created_by=actor
      and thread.creation_request_key=normalized_request_key
    for update;
    if not found
      or result.creation_request_fingerprint is distinct from request_fingerprint
    then
      raise exception 'communication_thread_idempotency_conflict';
    end if;
  end if;
  return result;
end;
$$;

revoke all on function public.create_communication_thread(uuid,text,text,text,text)
from public,crm_system;
grant execute on function public.create_communication_thread(uuid,text,text,text,text)
to crm_app;

drop function if exists public.queue_communication_message(uuid,text,text);

create or replace function public.queue_communication_message(
  target_thread uuid,
  target_body text,
  target_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path=public,app_auth,extensions
as $$
declare
  thread public.communication_threads;
  result public.communication_messages;
  normalized_body text:=trim(coalesce(target_body,''));
  normalized_key text:=trim(coalesce(target_idempotency_key,''));
  should_deliver boolean:=false;
begin
  select candidate.* into thread
  from public.communication_threads candidate
  where candidate.id=target_thread
    and candidate.workspace_id=public.current_workspace_id()
    and candidate.status='OPEN'
  for update;
  if not found
    or length(normalized_body) not between 1 and 10000
    or length(normalized_key) not between 8 and 160
  then
    raise exception 'communication_message_invalid';
  end if;
  if not public.contact_channel_allowed(thread.contact_id,thread.channel,thread.purpose) then
    raise exception 'communication_consent_required';
  end if;

  select message.* into result
  from public.communication_messages message
  where message.workspace_id=thread.workspace_id
    and message.idempotency_key=normalized_key
  for update;
  if found then
    if result.thread_id<>thread.id
      or result.direction<>'OUTBOUND'
      or result.body<>normalized_body
    then
      raise exception 'communication_idempotency_conflict';
    end if;
    if result.delivery_status='QUEUED'
      and result.last_attempt_at<=now()-interval '20 seconds'
    then
      update public.communication_messages
      set attempt_count=attempt_count+1,last_attempt_at=now()
      where id=result.id
      returning * into result;
      should_deliver:=true;
    end if;
    return jsonb_build_object('message',to_jsonb(result),'shouldDeliver',should_deliver);
  end if;

  insert into public.communication_messages(
    workspace_id,thread_id,direction,body,delivery_status,sent_by,idempotency_key,
    attempt_count,last_attempt_at
  )
  values(
    thread.workspace_id,thread.id,'OUTBOUND',normalized_body,'QUEUED',
    app_auth.current_user_id(),normalized_key,1,now()
  )
  on conflict(workspace_id,idempotency_key) do nothing
  returning * into result;

  if not found then
    select message.* into result
    from public.communication_messages message
    where message.workspace_id=thread.workspace_id
      and message.idempotency_key=normalized_key
    for update;
    if not found
      or result.thread_id<>thread.id
      or result.direction<>'OUTBOUND'
      or result.body<>normalized_body
    then
      raise exception 'communication_idempotency_conflict';
    end if;
    return jsonb_build_object('message',to_jsonb(result),'shouldDeliver',false);
  end if;

  update public.communication_threads
  set last_message_at=result.created_at,updated_at=now()
  where id=thread.id;
  return jsonb_build_object('message',to_jsonb(result),'shouldDeliver',true);
end;
$$;

revoke all on function public.queue_communication_message(uuid,text,text)
from public,crm_system;
grant execute on function public.queue_communication_message(uuid,text,text)
to crm_app;

drop function if exists public.communication_inbox_snapshot(text,integer);

create or replace function public.communication_inbox_page(
  search_term text default '',
  page_number integer default 1,
  requested_page_size integer default 20
)
returns jsonb
language sql
stable
security definer
set search_path=public,app_auth,extensions
as $$
  with parameters as (
    select
      trim(left(coalesce(search_term,''),160)) query,
      greatest(1,least(coalesce(page_number,1),100000)) page,
      greatest(1,least(coalesce(requested_page_size,20),50)) page_size
  ),
  filtered as (
    select
      thread.id,
      thread.contact_id,
      contact.name_zh contact_zh,
      contact.name_en contact_en,
      contact.email::text contact_email,
      thread.subject,
      thread.channel,
      thread.purpose,
      thread.status,
      thread.last_message_at,
      thread.created_at
    from public.communication_threads thread
    join public.contacts contact on contact.id=thread.contact_id
    cross join parameters
    where thread.workspace_id=public.current_workspace_id()
      and app_auth.current_user_id() is not null
      and (
        nullif(parameters.query,'') is null
        or concat_ws(
          ' ',thread.subject,contact.name_zh,contact.name_en,contact.email::text
        ) ilike '%'||parameters.query||'%'
        or exists(
          select 1
          from public.communication_messages message
          where message.thread_id=thread.id
            and message.body ilike '%'||parameters.query||'%'
        )
      )
  ),
  selected as (
    select filtered.*
    from filtered
    cross join parameters
    order by coalesce(last_message_at,created_at) desc,created_at desc,id desc
    limit (select page_size from parameters)
    offset (select (page-1)*page_size from parameters)
  ),
  payload as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id',selected.id,
      'contactId',selected.contact_id,
      'contactZh',selected.contact_zh,
      'contactEn',selected.contact_en,
      'email',coalesce(selected.contact_email,''),
      'subject',selected.subject,
      'channel',selected.channel,
      'purpose',selected.purpose,
      'status',selected.status,
      'lastMessageAt',selected.last_message_at
    ) order by coalesce(selected.last_message_at,selected.created_at) desc,selected.created_at desc,selected.id desc),'[]'::jsonb) items
    from selected
  )
  select jsonb_build_object(
    'items',payload.items,
    'total',(select count(*) from filtered),
    'page',parameters.page,
    'pageSize',parameters.page_size
  )
  from payload
  cross join parameters;
$$;

revoke all on function public.communication_inbox_page(text,integer,integer)
from public,crm_system;
grant execute on function public.communication_inbox_page(text,integer,integer)
to crm_app;

create or replace function public.communication_thread_snapshot(
  target_thread uuid,
  requested_message_page integer default null,
  requested_message_page_size integer default 20
)
returns jsonb
language plpgsql
stable
security definer
set search_path=public,app_auth,extensions
as $$
declare
  thread record;
  message_items jsonb;
  message_total integer;
  message_page_size integer:=greatest(1,least(coalesce(requested_message_page_size,20),50));
  message_total_pages integer;
  message_page integer;
begin
  select
    candidate.id,
    candidate.contact_id,
    contact.name_zh contact_zh,
    contact.name_en contact_en,
    contact.email::text contact_email,
    candidate.subject,
    candidate.channel,
    candidate.purpose,
    candidate.status,
    candidate.last_message_at
  into thread
  from public.communication_threads candidate
  join public.contacts contact on contact.id=candidate.contact_id
  where candidate.id=target_thread
    and candidate.workspace_id=public.current_workspace_id()
    and app_auth.current_user_id() is not null;
  if not found then
    raise exception 'communication_thread_not_found';
  end if;

  select count(*)::integer into message_total
  from public.communication_messages message
  where message.thread_id=thread.id;
  message_total_pages:=greatest(1,ceil(message_total::numeric/message_page_size)::integer);
  message_page:=case
    when requested_message_page is null then message_total_pages
    else greatest(1,least(requested_message_page,message_total_pages))
  end;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',message.id,
    'direction',message.direction,
    'body',message.body,
    'deliveryStatus',message.delivery_status,
    'lastError',coalesce(message.last_error,''),
    'attemptCount',message.attempt_count,
    'createdAt',message.created_at
  ) order by message.created_at,message.id),'[]'::jsonb)
  into message_items
  from (
    select candidate.*
    from public.communication_messages candidate
    where candidate.thread_id=thread.id
    order by candidate.created_at,candidate.id
    limit message_page_size
    offset (message_page-1)*message_page_size
  ) message;

  return jsonb_build_object(
    'id',thread.id,
    'contactId',thread.contact_id,
    'contactZh',thread.contact_zh,
    'contactEn',thread.contact_en,
    'email',coalesce(thread.contact_email,''),
    'subject',thread.subject,
    'channel',thread.channel,
    'purpose',thread.purpose,
    'status',thread.status,
    'lastMessageAt',thread.last_message_at,
    'messages',message_items,
    'messageTotal',message_total,
    'messagePage',message_page,
    'messagePageSize',message_page_size
  );
end;
$$;

revoke all on function public.communication_thread_snapshot(uuid,integer,integer)
from public,crm_system;
grant execute on function public.communication_thread_snapshot(uuid,integer,integer)
to crm_app;

create index if not exists communication_messages_thread_page_idx
  on public.communication_messages(thread_id,created_at,id);
