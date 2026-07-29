alter table public.appointments
  add column if not exists creation_request_key text,
  add column if not exists creation_request_fingerprint text;

alter table public.appointments
  drop constraint if exists appointments_creation_request_key_check;
alter table public.appointments
  add constraint appointments_creation_request_key_check
  check (
    creation_request_key is null
    or (
      creation_request_key = trim(creation_request_key)
      and length(creation_request_key) between 8 and 160
    )
  );

alter table public.appointments
  drop constraint if exists appointments_creation_request_fingerprint_check;
alter table public.appointments
  add constraint appointments_creation_request_fingerprint_check
  check (
    (creation_request_key is null and creation_request_fingerprint is null)
    or (
      creation_request_key is not null
      and creation_request_fingerprint ~ '^[a-f0-9]{64}$'
    )
  );

create unique index if not exists appointments_creation_request_uidx
  on public.appointments(workspace_id,created_by,creation_request_key)
  where creation_request_key is not null;

drop function if exists public.create_appointment_with_delivery(
  text,text,text,text,uuid,text,timestamptz,timestamptz,text,integer[],jsonb
);

create or replace function public.create_appointment_with_delivery(
  title_zh text,
  title_en text,
  event_type text,
  relation_type text,
  relation_id uuid,
  relation_label text,
  starts timestamptz,
  ends timestamptz,
  event_channel text,
  reminders integer[],
  attendees jsonb,
  target_request_key text
)
returns public.appointments
language plpgsql
security definer
set search_path=public,app_auth,extensions
as $$
declare
  result public.appointments;
  attendee jsonb;
  attendee_row public.appointment_attendees;
  contact public.contacts;
  organization public.organizations;
  normalized_attendees jsonb:=coalesce(attendees,'[]'::jsonb);
  normalized_request_key text:=trim(coalesce(target_request_key,''));
  request_fingerprint text;
begin
  if ends<=starts
    or event_type not in ('MEETING','CONSULTATION','FOLLOW_UP','DEADLINE')
    or nullif(trim(title_zh),'') is null
    or nullif(trim(title_en),'') is null
    or length(trim(title_zh))>160
    or length(trim(title_en))>160
    or length(coalesce(event_channel,''))>80
    or length(normalized_request_key) not between 8 and 160
    or jsonb_typeof(normalized_attendees)<>'array'
    or jsonb_array_length(normalized_attendees)>50
    or coalesce(array_length(reminders,1),0)<1
    or exists(select 1 from unnest(reminders) value where value<0 or value>43200) then
    raise exception 'appointment_invalid';
  end if;

  request_fingerprint:=encode(extensions.digest(convert_to(jsonb_build_object(
    'titleZh',trim(title_zh),
    'titleEn',trim(title_en),
    'eventType',event_type,
    'relationType',relation_type,
    'relationId',relation_id,
    'relationLabel',coalesce(relation_label,''),
    'starts',starts,
    'ends',ends,
    'channel',coalesce(event_channel,''),
    'reminders',reminders,
    'attendees',normalized_attendees
  )::text,'UTF8'),'sha256'),'hex');

  select appointment.* into result
  from public.appointments appointment
  where appointment.workspace_id=public.current_workspace_id()
    and appointment.created_by=app_auth.current_user_id()
    and appointment.creation_request_key=normalized_request_key;
  if found then
    if result.creation_request_fingerprint is distinct from request_fingerprint then
      raise exception 'appointment_idempotency_conflict';
    end if;
    return result;
  end if;

  if (relation_type is null)<>(relation_id is null) then
    raise exception 'appointment_relation_invalid';
  end if;
  if relation_type='ORGANIZATION' then
    select * into organization from public.organizations
      where id=relation_id and workspace_id=public.current_workspace_id();
    if not found
      or not public.can_access_owned_record(
        organization.workspace_id,'ORGANIZATION',organization.id,organization.owner_id,true
      ) then
      raise exception 'appointment_relation_invalid';
    end if;
  elsif relation_type='CONTACT' then
    select * into contact from public.contacts
      where id=relation_id and workspace_id=public.current_workspace_id();
    if not found
      or not public.can_access_owned_record(
        contact.workspace_id,'CONTACT',contact.id,contact.owner_id,true
      ) then
      raise exception 'appointment_relation_invalid';
    end if;
  elsif relation_type is not null then
    raise exception 'appointment_relation_invalid';
  end if;

  insert into public.appointments(
    workspace_id,title_zh,title_en,appointment_type,related_type,related_id,related_label,
    starts_at,ends_at,channel,reminder_minutes,owner_id,created_by,event_version,
    creation_request_key,creation_request_fingerprint
  ) values(
    public.current_workspace_id(),trim(title_zh),trim(title_en),event_type,relation_type,relation_id,
    coalesce(relation_label,''),starts,ends,coalesce(event_channel,''),reminders,
    app_auth.current_user_id(),app_auth.current_user_id(),1,
    normalized_request_key,request_fingerprint
  )
  on conflict (workspace_id,created_by,creation_request_key)
    where creation_request_key is not null
  do nothing
  returning * into result;

  if not found then
    select appointment.* into result
    from public.appointments appointment
    where appointment.workspace_id=public.current_workspace_id()
      and appointment.created_by=app_auth.current_user_id()
      and appointment.creation_request_key=normalized_request_key;
    if not found then raise exception 'appointment_idempotency_conflict'; end if;
    if result.creation_request_fingerprint is distinct from request_fingerprint then
      raise exception 'appointment_idempotency_conflict';
    end if;
    return result;
  end if;

  for attendee in select * from jsonb_array_elements(normalized_attendees) loop
    if nullif(trim(attendee->>'email'),'') is null
      or coalesce((attendee->>'consentConfirmed')::boolean,false)=false then
      raise exception 'appointment_attendee_consent_required';
    end if;
    if nullif(attendee->>'contactId','') is not null then
      select * into contact from public.contacts
        where id=(attendee->>'contactId')::uuid and workspace_id=result.workspace_id;
      if not found
        or contact.email is null
        or lower(contact.email::text)<>lower(trim(attendee->>'email'))
        or not public.contact_channel_allowed(contact.id,'EMAIL','EVENT') then
        raise exception 'appointment_contact_event_consent_required';
      end if;
    end if;
    insert into public.appointment_attendees(
      workspace_id,appointment_id,contact_id,email,name,consent_confirmed,created_by
    ) values(
      result.workspace_id,result.id,nullif(attendee->>'contactId','')::uuid,
      lower(trim(attendee->>'email'))::citext,trim(coalesce(attendee->>'name','')),
      true,app_auth.current_user_id()
    ) returning * into attendee_row;
    insert into public.calendar_deliveries(
      workspace_id,appointment_id,attendee_id,event_version,delivery_type,idempotency_key
    ) values(
      result.workspace_id,result.id,attendee_row.id,1,'INVITE',
      result.id||':'||attendee_row.id||':1:INVITE'
    );
  end loop;
  return result;
end;
$$;

revoke all on function public.create_appointment_with_delivery(
  text,text,text,text,uuid,text,timestamptz,timestamptz,text,integer[],jsonb,text
) from public,crm_system;
grant execute on function public.create_appointment_with_delivery(
  text,text,text,text,uuid,text,timestamptz,timestamptz,text,integer[],jsonb,text
) to crm_app;

create or replace function public.communication_inbox_snapshot(
  search_term text default '',
  result_limit integer default 100
)
returns jsonb
language sql
stable
security definer
set search_path=public,app_auth,extensions
as $$
  with filtered as (
    select
      thread.*,
      contact.name_zh contact_zh,
      contact.name_en contact_en,
      contact.email::text contact_email
    from public.communication_threads thread
    join public.contacts contact on contact.id=thread.contact_id
    where thread.workspace_id=public.current_workspace_id()
      and app_auth.current_user_id() is not null
      and (
        nullif(trim(left(coalesce(search_term,''),160)),'') is null
        or concat_ws(
          ' ',thread.subject,contact.name_zh,contact.name_en,contact.email::text
        ) ilike '%'||trim(left(coalesce(search_term,''),160))||'%'
        or exists(
          select 1 from public.communication_messages message
          where message.thread_id=thread.id
            and message.body ilike '%'||trim(left(coalesce(search_term,''),160))||'%'
        )
      )
  ),
  selected as (
    select * from filtered
    order by last_message_at desc nulls last,created_at desc
    limit greatest(1,least(coalesce(result_limit,100),100))
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
      'lastMessageAt',selected.last_message_at,
      'messages',coalesce((
        select jsonb_agg(jsonb_build_object(
          'id',message.id,
          'direction',message.direction,
          'body',message.body,
          'deliveryStatus',message.delivery_status,
          'lastError',coalesce(message.last_error,''),
          'attemptCount',message.attempt_count,
          'createdAt',message.created_at
        ) order by message.created_at)
        from public.communication_messages message
        where message.thread_id=selected.id
      ),'[]'::jsonb)
    ) order by selected.last_message_at desc nulls last,selected.created_at desc),'[]'::jsonb) items
    from selected
  )
  select jsonb_build_object(
    'items',payload.items,
    'total',(select count(*) from filtered),
    'truncated',(select count(*) from filtered)>jsonb_array_length(payload.items)
  )
  from payload;
$$;

revoke all on function public.communication_inbox_snapshot(text,integer)
from public,crm_system;
grant execute on function public.communication_inbox_snapshot(text,integer)
to crm_app;
