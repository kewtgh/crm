set search_path=public,app_auth,extensions;

-- All staff lifecycle writes now enter one guarded command. Creation retains its own fingerprint.
create function public.mutate_calendar_appointment(
 target_appointment uuid, action text, expected_event_version integer, p_request_key text,
 starts timestamptz default null, ends timestamptz default null
) returns jsonb language plpgsql security definer set search_path=public,app_auth,extensions as $$
declare
 actor uuid:=app_auth.current_user_id(); ws uuid:=public.current_workspace_id();
 item public.appointments; prior public.appointments; receipt public.mutation_receipts;
 fingerprint text; result jsonb;
begin
 if actor is null or not public.is_workspace_member(ws) then raise exception 'appointment_forbidden';end if;
 if action is null or action not in ('COMPLETE','UPDATE','CANCEL')
  or expected_event_version is null or expected_event_version<1
  or p_request_key is null or p_request_key<>trim(p_request_key) or length(p_request_key) not between 8 and 160
  or (action='UPDATE' and (starts is null or ends is null or ends<=starts))
  or (action<>'UPDATE' and (starts is not null or ends is not null)) then
  raise exception 'appointment_action_invalid';
 end if;
 perform pg_advisory_xact_lock(hashtextextended(ws::text||':calendar-action:'||p_request_key,0));
 -- Recheck current edit access before replaying even an already accepted result.
 select * into item from public.appointments a where a.id=target_appointment and a.workspace_id=ws
  and a.archived_at is null and public.can_access_owned_record(a.workspace_id,'APPOINTMENT',a.id,a.owner_id,true)
  for update;
 if not found then raise exception 'appointment_forbidden';end if;
 fingerprint:=encode(digest(jsonb_build_array(target_appointment,action,expected_event_version,starts,ends)::text,'sha256'),'hex');
 select * into receipt from public.mutation_receipts r where r.workspace_id=ws and r.request_key=p_request_key;
 if found then
  if receipt.created_by is distinct from actor or receipt.operation<>'CALENDAR_ACTION'
   or receipt.result->>'request_hash' is distinct from fingerprint then raise exception 'appointment_request_conflict';end if;
  return receipt.result->'item';
 end if;
 if item.status<>'SCHEDULED' or item.event_version<>expected_event_version then raise exception 'appointment_state_changed';end if;
 prior:=item;
 update public.appointments a set
  starts_at=case when action='UPDATE' then starts else a.starts_at end,
  ends_at=case when action='UPDATE' then ends else a.ends_at end,
  status=case action when 'COMPLETE' then 'COMPLETED' when 'CANCEL' then 'CANCELLED' else 'SCHEDULED' end,
  completed_at=case when action='COMPLETE' then now() else a.completed_at end,
  event_version=a.event_version+1,updated_at=now()
 where a.id=item.id returning a.* into item;
 if action in ('UPDATE','CANCEL') then
  insert into public.calendar_deliveries(workspace_id,appointment_id,attendee_id,event_version,delivery_type,idempotency_key)
   select ws,item.id,a.id,item.event_version,action,item.id||':'||a.id||':'||item.event_version||':'||action
   from public.appointment_attendees a where a.appointment_id=item.id on conflict do nothing;
 end if;
 result:=to_jsonb(item);
 insert into public.audit_events(workspace_id,actor_id,entity_type,entity_id,action,before_data,after_data)
  values(ws,actor,'APPOINTMENT',item.id,'APPOINTMENT_'||action,to_jsonb(prior),result);
 insert into public.mutation_receipts(workspace_id,request_key,operation,result,created_by)
  values(ws,p_request_key,'CALENDAR_ACTION',jsonb_build_object('request_hash',fingerprint,'item',result),actor);
 return result;
end $$;
revoke all on function public.mutate_calendar_appointment(uuid,text,integer,text,timestamptz,timestamptz) from public,crm_system,crm_worker;
grant execute on function public.mutate_calendar_appointment(uuid,text,integer,text,timestamptz,timestamptz) to crm_app;
revoke execute on function public.complete_appointment(uuid),public.update_appointment_delivery(uuid,text,timestamptz,timestamptz) from crm_app;
revoke update on public.appointments from crm_app;
