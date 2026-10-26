set search_path=public,app_auth,extensions;
-- Calendar collaboration is distinct from authority to assign a coworker's tasks.
create function public.calendar_member_active(ws uuid,member uuid) returns boolean
language sql stable security definer set search_path=public,app_auth as $$
 select exists(select 1 from public.workspace_memberships m join app_auth.accounts a on a.id=m.user_id
 where m.workspace_id=ws and m.user_id=member and m.status='ACTIVE' and a.status='ACTIVE' and a.purged_at is null
 and a.last_sign_in_at is not null and not m.must_change_password and not a.must_change_password);
$$;
revoke all on function public.calendar_member_active(uuid,uuid) from public,crm_app,crm_system,crm_worker;
create function public.list_calendar_members(p_query text default '') returns table(user_id uuid,display_name_zh text,display_name_en text)
language sql stable security definer set search_path=public,app_auth as $$
 select m.user_id,p.display_name_zh,p.display_name_en from public.workspace_memberships m join public.user_profiles p on p.user_id=m.user_id
 where public.is_workspace_member(public.current_workspace_id()) and m.workspace_id=public.current_workspace_id() and public.calendar_member_active(m.workspace_id,m.user_id)
 and concat_ws(' ',p.display_name_zh,p.display_name_en) ilike '%'||replace(replace(left(coalesce(p_query,''),80),'%',''),'_','')||'%'
 order by p.display_name_en,m.user_id limit 30;
$$;
revoke all on function public.list_calendar_members(text) from public,crm_system,crm_worker;
grant execute on function public.list_calendar_members(text) to crm_app;
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
  if app_auth.current_user_id() is null or not public.is_workspace_member(public.current_workspace_id()) then raise exception 'appointment_forbidden';end if;
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
  elsif relation_type='USER' then
    if not public.calendar_member_active(public.current_workspace_id(),relation_id) then raise exception 'appointment_member_unavailable';end if;
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

create policy calendar_invited_member_read on public.appointments for select to crm_app
 using(public.is_workspace_member(workspace_id) and related_type='USER' and related_id=app_auth.current_user_id());

create or replace function public.generate_appointment_reminders(target_appointment uuid) returns void
language plpgsql security definer set search_path=public,app_auth,extensions as $$
declare a public.appointments;minutes_before integer;recipient uuid;
begin
 select * into a from public.appointments where id=target_appointment;if not found then return;end if;
 update public.reminders set status='CANCELLED' where source_type='APPOINTMENT' and source_id=a.id and status in ('PENDING','FAILED');
 if a.status<>'SCHEDULED' then return;end if;
 for recipient in select a.owner_id union select a.related_id where a.related_type='USER' and public.calendar_member_active(a.workspace_id,a.related_id) loop
  foreach minutes_before in array a.reminder_minutes loop
   if a.starts_at-make_interval(mins=>minutes_before)>now() then
    insert into public.reminders(workspace_id,recipient_id,source_type,source_id,reminder_type,scheduled_at)
    values(a.workspace_id,recipient,'APPOINTMENT',a.id,'BEFORE_'||minutes_before,a.starts_at-make_interval(mins=>minutes_before))
    on conflict(recipient_id,source_type,source_id,reminder_type,scheduled_at) do update set status='PENDING',attempts=0,last_error=null
    where reminders.status in ('CANCELLED','FAILED');
   end if;
  end loop;
 end loop;
end $$;
create function public.calendar_member_notice() returns trigger
language plpgsql security definer set search_path=public,app_auth,extensions as $$
declare notice text;target_locale text;target_timezone text;
begin
 if new.related_type<>'USER' or new.related_id is null or new.related_id=new.created_by then return new;end if;
 if not public.calendar_member_active(new.workspace_id,new.related_id) then
  if tg_op='INSERT' then raise exception 'appointment_member_unavailable';end if;return new;
 end if;
 if tg_op='UPDATE' and new.starts_at is not distinct from old.starts_at and new.ends_at is not distinct from old.ends_at and new.status is not distinct from old.status and new.related_id is not distinct from old.related_id then return new;end if;
 notice:=case when new.status='CANCELLED' then 'cancelled' when new.status='COMPLETED' then 'completed' when tg_op='INSERT' then 'invited' else 'updated' end;
 select locale,timezone into target_locale,target_timezone from public.user_preferences where user_id=new.related_id;
 target_timezone:=case when target_timezone in ('Asia/Taipei','Asia/Shanghai','Asia/Singapore','Europe/London','America/New_York') then target_timezone else 'UTC' end;
 insert into public.user_notifications(workspace_id,user_id,kind,title_key,body_key,values,source_type,source_id)
 values(new.workspace_id,new.related_id,'CALENDAR_INVITE','calendarInvite.'||notice,'calendarInvite.body',jsonb_build_object('title',case when target_locale='en' then new.title_en else new.title_zh end,'time',to_char(new.starts_at at time zone target_timezone,'YYYY-MM-DD HH24:MI')||' '||target_timezone),'APPOINTMENT',new.id);
 return new;
end $$;
create trigger calendar_member_notice after insert or update on public.appointments for each row execute function public.calendar_member_notice();
revoke all on function public.calendar_member_notice() from public,crm_app,crm_system,crm_worker;
