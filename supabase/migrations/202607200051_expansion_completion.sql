-- v2.2.0 completion pass: close the remaining preview/retry, portal consent,
-- communication idempotency, configurable quality and connector receipt gaps.

-- ---------------------------------------------------------------------------
-- Automation preview, version evidence and failed-run retry
-- ---------------------------------------------------------------------------
alter table public.automation_rules
  add column if not exists version integer not null default 1 check(version>0),
  add column if not exists updated_by uuid references auth.users(id);
alter table public.automation_runs
  add column if not exists attempt_count integer not null default 1 check(attempt_count>0),
  add column if not exists last_attempt_at timestamptz not null default now();

create or replace function public.bump_automation_rule_version()
returns trigger language plpgsql set search_path=public as $$
begin
  if row(new.name_zh,new.name_en,new.trigger_key,new.conditions,new.action_type,new.action_config,new.active)
    is distinct from row(old.name_zh,old.name_en,old.trigger_key,old.conditions,old.action_type,old.action_config,old.active) then
    new.version:=old.version+1;
  end if;
  new.updated_by:=auth.uid();
  new.updated_at:=now();
  return new;
end;
$$;
drop trigger if exists automation_rule_version on public.automation_rules;
create trigger automation_rule_version before update on public.automation_rules
for each row execute procedure public.bump_automation_rule_version();

create or replace function public.preview_automation_rule(target_rule uuid,target_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare rule_row public.automation_rules;payload jsonb:=coalesce(target_payload,'{}'::jsonb);matches boolean;
begin
  if public.current_crm_role() not in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER')
    or jsonb_typeof(payload)<>'object' then raise exception 'automation_forbidden'; end if;
  select * into rule_row from public.automation_rules
    where id=target_rule and workspace_id=public.current_workspace_id();
  if not found then raise exception 'automation_rule_not_found'; end if;
  matches:=rule_row.active and (rule_row.conditions='{}'::jsonb or payload @> rule_row.conditions);
  return jsonb_build_object(
    'ruleId',rule_row.id,'version',rule_row.version,'matches',matches,
    'trigger',rule_row.trigger_key,'conditions',rule_row.conditions,
    'actionType',rule_row.action_type,'actionConfig',rule_row.action_config,
    'sideEffects',false
  );
end;
$$;

create or replace function public.retry_automation_run(target_run uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare run_row public.automation_runs;rule_row public.automation_rules;event_row public.automation_events;
  actor uuid;task_id uuid;notification_id uuid;due_hours integer;
begin
  if public.current_crm_role() not in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER') then
    raise exception 'automation_forbidden';
  end if;
  select * into run_row from public.automation_runs
    where id=target_run and workspace_id=public.current_workspace_id() and status='FAILED' for update;
  if not found then raise exception 'automation_run_not_retryable'; end if;
  select * into rule_row from public.automation_rules where id=run_row.rule_id and active;
  select * into event_row from public.automation_events where id=run_row.event_id;
  actor:=coalesce(event_row.actor_id,auth.uid());
  if rule_row.id is null or event_row.id is null or actor is null then raise exception 'automation_run_not_retryable'; end if;
  begin
    if rule_row.action_type='TASK' then
      due_hours:=case when coalesce(rule_row.action_config->>'dueHours','')~'^\d{1,4}$'
        then greatest(1,least(2160,(rule_row.action_config->>'dueHours')::integer)) else 24 end;
      insert into public.crm_tasks(workspace_id,title_zh,title_en,related_type,related_id,related_label,status,priority,owner_id,due_at,created_by)
      values(run_row.workspace_id,
        coalesce(nullif(trim(rule_row.action_config->>'titleZh'),''),rule_row.name_zh),
        coalesce(nullif(trim(rule_row.action_config->>'titleEn'),''),rule_row.name_en),
        coalesce(nullif(trim(event_row.payload->>'relatedType'),''),'GENERAL'),
        case when coalesce(event_row.payload->>'relatedId','')~'^[0-9a-fA-F-]{36}$' then (event_row.payload->>'relatedId')::uuid else null end,
        left(coalesce(event_row.payload->>'relatedLabel',''),160),'TODO',
        case when upper(coalesce(rule_row.action_config->>'priority','NORMAL')) in ('LOW','NORMAL','HIGH','URGENT') then upper(rule_row.action_config->>'priority') else 'NORMAL' end,
        actor,now()+make_interval(hours=>due_hours),actor) returning id into task_id;
      update public.automation_runs set status='SUCCEEDED',result_type='TASK',result_id=task_id,
        error_code=null,attempt_count=attempt_count+1,last_attempt_at=now() where id=run_row.id;
    else
      insert into public.user_notifications(workspace_id,user_id,kind,title_key,body_key,values,source_type,source_id)
      values(run_row.workspace_id,actor,'AUTOMATION','automation.notification.title','automation.notification.body',
        jsonb_build_object('ruleZh',rule_row.name_zh,'ruleEn',rule_row.name_en,'event',event_row.trigger_key),
        'AUTOMATION_RULE',rule_row.id) returning id into notification_id;
      update public.automation_runs set status='SUCCEEDED',result_type='NOTIFICATION',result_id=notification_id,
        error_code=null,attempt_count=attempt_count+1,last_attempt_at=now() where id=run_row.id;
    end if;
  exception when others then
    update public.automation_runs set error_code=left(sqlstate||':'||sqlerrm,500),
      attempt_count=attempt_count+1,last_attempt_at=now() where id=run_row.id;
  end;
  return (select jsonb_build_object('id',id,'status',status,'attemptCount',attempt_count,'errorCode',error_code)
    from public.automation_runs where id=run_row.id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Guardian portal: verified recipient, explicit consent and applied decisions
-- ---------------------------------------------------------------------------
create table if not exists public.portal_access_consents(
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  invitation_id uuid not null unique references public.portal_invitations(id) on delete cascade,
  request_key text not null,
  terms_version text not null check(length(trim(terms_version)) between 1 and 40),
  privacy_version text not null check(length(trim(privacy_version)) between 1 and 40),
  accepted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique(invitation_id,request_key)
);
alter table public.portal_access_consents enable row level security;
create policy "portal staff read access consents" on public.portal_access_consents for select to authenticated
  using(public.is_workspace_member(workspace_id) and public.current_crm_role() in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER'));
grant select on public.portal_access_consents to authenticated;

alter table public.portal_update_requests
  add column if not exists applied_changes jsonb not null default '{}'::jsonb
    check(jsonb_typeof(applied_changes)='object');

create or replace function public.create_guardian_portal_invitation(
  target_household uuid,target_email text,target_digest text,target_expires_at timestamptz
) returns public.portal_invitations language plpgsql security definer set search_path=public as $$
declare result public.portal_invitations;guardian uuid;ws uuid:=public.current_workspace_id();normalized_email citext:=lower(trim(target_email))::citext;
begin
  if public.current_crm_role() not in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER')
    or target_digest!~'^[a-f0-9]{64}$' or target_expires_at<=now()+interval '5 minutes'
    or target_expires_at>now()+interval '30 days' then raise exception 'portal_invitation_invalid'; end if;
  select eligible.id into guardian from (
    select c.id from public.household_members hm join public.contacts c on c.id=hm.contact_id
      where hm.workspace_id=ws and hm.household_id=target_household and c.email=normalized_email
    union
    select c.id from public.students s join public.student_guardian_relationships relation on relation.student_id=s.id
      join public.contacts c on c.id=relation.guardian_contact_id
      where s.workspace_id=ws and s.household_id=target_household and c.email=normalized_email
  ) eligible limit 1;
  if guardian is null or exists(select 1 from public.privacy_restrictions r where r.workspace_id=ws and r.contact_id=guardian and r.active and (r.ends_at is null or r.ends_at>now())) then
    raise exception 'portal_guardian_not_verified';
  end if;
  update public.portal_invitations set status='REVOKED',updated_at=now()
    where workspace_id=ws and household_id=target_household and invited_email=normalized_email and status='ACTIVE';
  insert into public.portal_invitations(workspace_id,household_id,guardian_contact_id,invited_email,token_digest,expires_at,created_by)
  values(ws,target_household,guardian,normalized_email,target_digest,target_expires_at,auth.uid()) returning * into result;
  return result;
end;
$$;

create or replace function public.revoke_guardian_portal_invitation(target_invitation uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
  if public.current_crm_role() not in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER') then raise exception 'portal_forbidden'; end if;
  update public.portal_invitations set status='REVOKED',updated_at=now()
    where id=target_invitation and workspace_id=public.current_workspace_id() and status='ACTIVE';
  if not found then raise exception 'portal_invitation_not_active'; end if;
end;
$$;

create or replace function public.service_accept_portal_consent(
  target_digest text,target_request_key text,target_terms_version text,target_privacy_version text
) returns void language plpgsql security definer set search_path=public as $$
declare invitation public.portal_invitations;
begin
  if auth.role()<>'service_role' or target_digest!~'^[a-f0-9]{64}$'
    or nullif(trim(target_request_key),'') is null then raise exception 'portal_consent_invalid'; end if;
  select * into invitation from public.portal_invitations
    where token_digest=target_digest and status='ACTIVE' and expires_at>now() for update;
  if not found then raise exception 'portal_invitation_invalid'; end if;
  insert into public.portal_access_consents(workspace_id,invitation_id,request_key,terms_version,privacy_version)
  values(invitation.workspace_id,invitation.id,left(trim(target_request_key),120),left(trim(target_terms_version),40),left(trim(target_privacy_version),40))
  on conflict(invitation_id) do nothing;
end;
$$;

create or replace function public.service_portal_snapshot(target_digest text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare invitation public.portal_invitations;result jsonb;consented boolean;
begin
  if auth.role()<>'service_role' or target_digest!~'^[a-f0-9]{64}$' then raise exception 'portal_access_invalid'; end if;
  select * into invitation from public.portal_invitations where token_digest=target_digest for update;
  if not found or invitation.status<>'ACTIVE' or invitation.expires_at<=now() then
    if found and invitation.status='ACTIVE' then update public.portal_invitations set status='EXPIRED',updated_at=now() where id=invitation.id; end if;
    raise exception 'portal_invitation_invalid';
  end if;
  select exists(select 1 from public.portal_access_consents where invitation_id=invitation.id) into consented;
  update public.portal_invitations set last_accessed_at=now(),updated_at=now() where id=invitation.id;
  select jsonb_build_object(
    'invitationId',invitation.id,'expiresAt',invitation.expires_at,'consentRequired',not consented,
    'household',jsonb_build_object('id',h.id,'nameZh',h.name_zh,'nameEn',h.name_en,'address',case when consented then h.address else '' end),
    'students',case when consented then coalesce((select jsonb_agg(jsonb_build_object(
      'id',s.id,'nameZh',c.name_zh,'nameEn',c.name_en,'grade',s.current_grade,'academicYear',s.academic_year,'status',s.status
    ) order by c.name_en) from public.students s join public.contacts c on c.id=s.person_id where s.household_id=h.id and s.workspace_id=h.workspace_id),'[]'::jsonb) else '[]'::jsonb end,
    'pendingUpdates',case when consented then (select count(*) from public.portal_update_requests r where r.invitation_id=invitation.id and r.status='PENDING') else 0 end
  ) into result from public.households h where h.id=invitation.household_id;
  return result;
end;
$$;

create or replace function public.service_submit_portal_update(target_digest text,target_request_key text,target_changes jsonb)
returns uuid language plpgsql security definer set search_path=public as $$
declare invitation public.portal_invitations;created_id uuid;existing public.portal_update_requests;
begin
  if auth.role()<>'service_role' or target_digest!~'^[a-f0-9]{64}$' or nullif(trim(target_request_key),'') is null
    or jsonb_typeof(target_changes)<>'object' or target_changes='{}'::jsonb
    or exists(select 1 from jsonb_object_keys(target_changes) fields(key) where fields.key not in ('address','preferredContact','note')) then
    raise exception 'portal_update_invalid';
  end if;
  select * into invitation from public.portal_invitations
    where token_digest=target_digest and status='ACTIVE' and expires_at>now() for update;
  if not found or not exists(select 1 from public.portal_access_consents where invitation_id=invitation.id) then
    raise exception 'portal_consent_required';
  end if;
  select * into existing from public.portal_update_requests
    where invitation_id=invitation.id and request_key=left(trim(target_request_key),120);
  if found then
    if existing.requested_changes<>target_changes then raise exception 'portal_idempotency_conflict'; end if;
    return existing.id;
  end if;
  if (select count(*) from public.portal_update_requests where invitation_id=invitation.id and created_at>now()-interval '24 hours')>=10 then
    raise exception 'portal_update_rate_limited';
  end if;
  insert into public.portal_update_requests(workspace_id,invitation_id,request_key,requested_changes)
  values(invitation.workspace_id,invitation.id,left(trim(target_request_key),120),target_changes) returning id into created_id;
  return created_id;
end;
$$;

create or replace function public.decide_portal_update(target_update uuid,next_status text,decision text)
returns public.portal_update_requests language plpgsql security definer set search_path=public as $$
declare request_row public.portal_update_requests;invitation public.portal_invitations;applied jsonb:='{}'::jsonb;normalized text:=upper(next_status);
begin
  if public.current_crm_role() not in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER')
    or normalized not in ('APPROVED','REJECTED') or nullif(trim(decision),'') is null then raise exception 'portal_decision_invalid'; end if;
  select * into request_row from public.portal_update_requests
    where id=target_update and workspace_id=public.current_workspace_id() and status='PENDING' for update;
  if not found then raise exception 'portal_update_not_pending'; end if;
  select * into invitation from public.portal_invitations where id=request_row.invitation_id;
  if normalized='APPROVED' and request_row.requested_changes?'address' then
    update public.households set address=left(trim(request_row.requested_changes->>'address'),500),updated_at=now()
      where id=invitation.household_id and workspace_id=request_row.workspace_id;
    applied:=jsonb_build_object('address',request_row.requested_changes->>'address');
  end if;
  update public.portal_update_requests set status=normalized,decision_note=trim(decision),
    applied_changes=applied,decided_by=auth.uid(),decided_at=now(),updated_at=now()
    where id=request_row.id returning * into request_row;
  return request_row;
end;
$$;

revoke update on public.portal_invitations,public.portal_update_requests from authenticated;

-- ---------------------------------------------------------------------------
-- Communications: immutable idempotency, manual inbound and safe retry
-- ---------------------------------------------------------------------------
alter table public.communication_messages add column if not exists idempotency_key text;
update public.communication_messages set idempotency_key='legacy:'||id::text where idempotency_key is null;
alter table public.communication_messages alter column idempotency_key set not null;
create unique index if not exists communication_message_idempotency_uidx
  on public.communication_messages(workspace_id,idempotency_key);
alter table public.communication_messages
  add column if not exists attempt_count integer not null default 1 check(attempt_count>0),
  add column if not exists last_attempt_at timestamptz not null default now();

create or replace function public.queue_communication_message(target_thread uuid,target_body text,target_idempotency_key text)
returns public.communication_messages language plpgsql security definer set search_path=public as $$
declare thread public.communication_threads;result public.communication_messages;
begin
  select * into thread from public.communication_threads where id=target_thread and workspace_id=public.current_workspace_id() and status='OPEN' for update;
  if not found or nullif(trim(target_body),'') is null or nullif(trim(target_idempotency_key),'') is null then raise exception 'communication_message_invalid'; end if;
  if not public.contact_channel_allowed(thread.contact_id,thread.channel,thread.purpose) then raise exception 'communication_consent_required'; end if;
  insert into public.communication_messages(workspace_id,thread_id,direction,body,delivery_status,sent_by,idempotency_key)
  values(thread.workspace_id,thread.id,'OUTBOUND',left(trim(target_body),10000),'QUEUED',auth.uid(),left(trim(target_idempotency_key),160))
  on conflict(workspace_id,idempotency_key) do update set idempotency_key=excluded.idempotency_key
    where communication_messages.thread_id=excluded.thread_id and communication_messages.direction=excluded.direction
      and communication_messages.body=excluded.body returning * into result;
  if not found then raise exception 'communication_idempotency_conflict'; end if;
  update public.communication_threads set last_message_at=result.created_at,updated_at=now() where id=thread.id;
  return result;
end;
$$;

create or replace function public.record_inbound_communication(target_thread uuid,target_body text,target_idempotency_key text)
returns public.communication_messages language plpgsql security definer set search_path=public as $$
declare thread public.communication_threads;result public.communication_messages;
begin
  select * into thread from public.communication_threads where id=target_thread and workspace_id=public.current_workspace_id() and status='OPEN' for update;
  if not found or nullif(trim(target_body),'') is null or nullif(trim(target_idempotency_key),'') is null then raise exception 'communication_message_invalid'; end if;
  insert into public.communication_messages(workspace_id,thread_id,direction,body,delivery_status,sent_by,idempotency_key)
  values(thread.workspace_id,thread.id,'INBOUND',left(trim(target_body),10000),'RECEIVED',auth.uid(),left(trim(target_idempotency_key),160))
  on conflict(workspace_id,idempotency_key) do update set idempotency_key=excluded.idempotency_key
    where communication_messages.thread_id=excluded.thread_id and communication_messages.direction=excluded.direction
      and communication_messages.body=excluded.body returning * into result;
  if not found then raise exception 'communication_idempotency_conflict'; end if;
  update public.communication_threads set last_message_at=result.created_at,updated_at=now() where id=thread.id;
  return result;
end;
$$;

create or replace function public.retry_communication_message(target_message uuid)
returns public.communication_messages language plpgsql security definer set search_path=public as $$
declare result public.communication_messages;thread public.communication_threads;
begin
  select message.* into result from public.communication_messages message
    where message.id=target_message and message.workspace_id=public.current_workspace_id()
      and message.direction='OUTBOUND' and message.delivery_status='FAILED' for update;
  if not found then raise exception 'communication_message_not_retryable'; end if;
  select * into thread from public.communication_threads where id=result.thread_id and status='OPEN';
  if not found or not public.contact_channel_allowed(thread.contact_id,thread.channel,thread.purpose) then raise exception 'communication_consent_required'; end if;
  update public.communication_messages set delivery_status='QUEUED',last_error=null,
    attempt_count=attempt_count+1,last_attempt_at=now() where id=result.id returning * into result;
  return result;
end;
$$;

create or replace function public.communication_inbox_snapshot(search_term text default '',result_limit integer default 100)
returns jsonb language sql stable security definer set search_path=public as $$
  with matched as (
    select thread.*,contact.name_zh contact_zh,contact.name_en contact_en,contact.email::text contact_email
    from public.communication_threads thread join public.contacts contact on contact.id=thread.contact_id
    where thread.workspace_id=public.current_workspace_id() and auth.uid() is not null
      and (nullif(trim(search_term),'') is null
        or concat_ws(' ',thread.subject,contact.name_zh,contact.name_en,contact.email::text) ilike '%'||trim(search_term)||'%'
        or exists(select 1 from public.communication_messages message where message.thread_id=thread.id and message.body ilike '%'||trim(search_term)||'%'))
    order by thread.last_message_at desc nulls last,thread.created_at desc
    limit greatest(1,least(coalesce(result_limit,100),100))
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',matched.id,'contactId',matched.contact_id,'contactZh',matched.contact_zh,'contactEn',matched.contact_en,
    'email',coalesce(matched.contact_email,''),'subject',matched.subject,'channel',matched.channel,'purpose',matched.purpose,
    'status',matched.status,'lastMessageAt',matched.last_message_at,
    'messages',coalesce((select jsonb_agg(jsonb_build_object(
      'id',message.id,'direction',message.direction,'body',message.body,'deliveryStatus',message.delivery_status,
      'lastError',coalesce(message.last_error,''),'attemptCount',message.attempt_count,'createdAt',message.created_at
    ) order by message.created_at) from public.communication_messages message where message.thread_id=matched.id),'[]'::jsonb)
  ) order by matched.last_message_at desc nulls last,matched.created_at desc),'[]'::jsonb) from matched;
$$;

drop function if exists public.queue_communication_message(uuid,text);

-- ---------------------------------------------------------------------------
-- Configurable, owned and comprehensive data-quality rules
-- ---------------------------------------------------------------------------
create table if not exists public.data_quality_rule_configs(
  id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id) on delete cascade,
  rule_key text not null,enabled boolean not null default true,severity text not null check(severity in ('LOW','MEDIUM','HIGH')),
  updated_by uuid references auth.users(id),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
  unique(workspace_id,rule_key)
);
alter table public.data_quality_rule_configs enable row level security;
create policy "quality leaders read rule configs" on public.data_quality_rule_configs for select to authenticated
  using(public.is_workspace_member(workspace_id) and public.current_crm_role() in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER'));
grant select on public.data_quality_rule_configs to authenticated;

insert into public.data_quality_rule_configs(workspace_id,rule_key,severity)
select workspace.id,rules.rule_key,rules.severity from public.workspaces workspace cross join (values
  ('CONTACT_METHOD_MISSING','HIGH'),('OPPORTUNITY_NEXT_ACTION_MISSING','MEDIUM'),('ORGANIZATION_OWNER_MISSING','HIGH'),
  ('STUDENT_GUARDIAN_MISSING','HIGH'),('CONSENT_EXPIRED','MEDIUM'),('OPPORTUNITY_EXCHANGE_RATE_MISSING','HIGH'),
  ('LEAD_ATTRIBUTION_MISSING','MEDIUM'),('CONTACT_DUPLICATE','HIGH')
) rules(rule_key,severity) on conflict(workspace_id,rule_key) do nothing;

create or replace function public.seed_data_quality_rule_configs()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  insert into public.data_quality_rule_configs(workspace_id,rule_key,severity)
  select new.id,rules.rule_key,rules.severity from (values
    ('CONTACT_METHOD_MISSING','HIGH'),('OPPORTUNITY_NEXT_ACTION_MISSING','MEDIUM'),('ORGANIZATION_OWNER_MISSING','HIGH'),
    ('STUDENT_GUARDIAN_MISSING','HIGH'),('CONSENT_EXPIRED','MEDIUM'),('OPPORTUNITY_EXCHANGE_RATE_MISSING','HIGH'),
    ('LEAD_ATTRIBUTION_MISSING','MEDIUM'),('CONTACT_DUPLICATE','HIGH')
  ) rules(rule_key,severity) on conflict(workspace_id,rule_key) do nothing;
  return new;
end;
$$;
drop trigger if exists seed_quality_rules_for_workspace on public.workspaces;
create trigger seed_quality_rules_for_workspace after insert on public.workspaces
for each row execute procedure public.seed_data_quality_rule_configs();

create or replace function public.seed_workspace_connector_defaults()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  insert into public.integration_connections(workspace_id,provider)
  select new.id,provider.name from (values
    ('MICROSOFT_365'),('GOOGLE_CALENDAR'),('EMAIL'),('E_SIGNATURE'),('ACCOUNTING'),('PAYMENT')
  ) provider(name) on conflict(workspace_id,provider) do nothing;
  return new;
end;
$$;
drop trigger if exists seed_connectors_for_workspace on public.workspaces;
create trigger seed_connectors_for_workspace after insert on public.workspaces
for each row execute procedure public.seed_workspace_connector_defaults();

create or replace function public.configure_data_quality_rule(target_rule text,next_enabled boolean,next_severity text)
returns public.data_quality_rule_configs language plpgsql security definer set search_path=public as $$
declare result public.data_quality_rule_configs;normalized text:=upper(trim(target_rule));
begin
  if public.current_crm_role() not in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER')
    or upper(next_severity) not in ('LOW','MEDIUM','HIGH') then raise exception 'quality_not_authorized'; end if;
  update public.data_quality_rule_configs set enabled=next_enabled,severity=upper(next_severity),
    updated_by=auth.uid(),updated_at=now() where workspace_id=public.current_workspace_id() and rule_key=normalized returning * into result;
  if not found then raise exception 'quality_rule_not_found'; end if;
  return result;
end;
$$;

create or replace function public.assign_data_quality_issue(target_issue uuid,target_owner uuid)
returns public.data_quality_issues language plpgsql security definer set search_path=public as $$
declare result public.data_quality_issues;
begin
  if public.current_crm_role() not in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER')
    or not exists(select 1 from public.workspace_memberships where workspace_id=public.current_workspace_id() and user_id=target_owner and status='ACTIVE') then raise exception 'quality_not_authorized'; end if;
  update public.data_quality_issues set assigned_to=target_owner,status='ASSIGNED',last_seen_at=now()
    where id=target_issue and workspace_id=public.current_workspace_id() and status in ('OPEN','ASSIGNED') returning * into result;
  if not found then raise exception 'quality_issue_not_assignable'; end if;
  return result;
end;
$$;

create or replace function public.run_data_quality_rules()
returns integer language plpgsql security definer set search_path=public as $$
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

  update public.data_quality_issues issue set status='RESOLVED',resolution_note='AUTO_RESOLVED',resolved_at=now(),resolved_by=auth.uid()
  where issue.workspace_id=ws and issue.status in ('OPEN','ASSIGNED') and issue.last_seen_at<marker
    and issue.rule_key in (select rule_key from public.data_quality_rule_configs where workspace_id=ws);
  select count(*) into affected from public.data_quality_issues where workspace_id=ws and status in ('OPEN','ASSIGNED');
  return affected;
end;
$$;

-- ---------------------------------------------------------------------------
-- Readable, idempotent connector reconciliation receipts
-- ---------------------------------------------------------------------------
create table if not exists public.connector_reconciliation_receipts(
  id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id) on delete cascade,
  provider text not null check(provider in ('PAYMENT','ACCOUNTING','E_SIGNATURE')),
  external_event_id text not null,event_type text not null,status text not null check(status in ('MATCHED','UNMATCHED','FAILED')),
  payment_id uuid references public.payments(id) on delete set null,amount numeric(14,2),currency text check(currency is null or currency~'^[A-Z]{3}$'),
  payload_sha256 text not null check(payload_sha256~'^[a-f0-9]{64}$'),failure_reason text,
  reconciled_at timestamptz not null default now(),created_at timestamptz not null default now(),
  unique(workspace_id,provider,external_event_id)
);
alter table public.connector_reconciliation_receipts enable row level security;
create policy "operations leaders read connector receipts" on public.connector_reconciliation_receipts for select to authenticated
  using(public.is_workspace_member(workspace_id) and public.current_crm_role() in ('SUPER_ADMIN','ADMIN'));
grant select on public.connector_reconciliation_receipts to authenticated;

create or replace function public.service_record_connector_reconciliation(
  target_workspace uuid,target_provider text,target_event_id text,target_event_type text,next_status text,
  target_payment uuid,target_amount numeric,target_currency text,target_payload_sha256 text,failure text default null
) returns public.connector_reconciliation_receipts language plpgsql security definer set search_path=public as $$
declare result public.connector_reconciliation_receipts;
begin
  if auth.role()<>'service_role' or upper(target_provider) not in ('PAYMENT','ACCOUNTING','E_SIGNATURE')
    or upper(next_status) not in ('MATCHED','UNMATCHED','FAILED') or target_payload_sha256!~'^[a-f0-9]{64}$'
    or nullif(trim(target_event_id),'') is null or nullif(trim(target_event_type),'') is null
    or (target_payment is not null and not exists(select 1 from public.payments where id=target_payment and workspace_id=target_workspace))
    then raise exception 'connector_receipt_invalid'; end if;
  insert into public.connector_reconciliation_receipts(workspace_id,provider,external_event_id,event_type,status,payment_id,amount,currency,payload_sha256,failure_reason)
  values(target_workspace,upper(target_provider),left(trim(target_event_id),240),left(trim(target_event_type),160),upper(next_status),target_payment,target_amount,
    case when target_currency is null then null else upper(target_currency) end,target_payload_sha256,left(coalesce(failure,''),500))
  on conflict(workspace_id,provider,external_event_id) do update set external_event_id=excluded.external_event_id
    where connector_reconciliation_receipts.event_type=excluded.event_type
      and connector_reconciliation_receipts.status=excluded.status
      and connector_reconciliation_receipts.payment_id is not distinct from excluded.payment_id
      and connector_reconciliation_receipts.amount is not distinct from excluded.amount
      and connector_reconciliation_receipts.currency is not distinct from excluded.currency
      and connector_reconciliation_receipts.payload_sha256=excluded.payload_sha256
      and connector_reconciliation_receipts.failure_reason is not distinct from excluded.failure_reason
    returning * into result;
  if not found then raise exception 'connector_receipt_idempotency_conflict'; end if;
  return result;
end;
$$;

-- ---------------------------------------------------------------------------
-- Compact growth KPI projection for the growth page and Dashboard links
-- ---------------------------------------------------------------------------
create or replace function public.growth_performance_snapshot()
returns jsonb language sql stable security definer set search_path=public as $$
  select jsonb_build_object(
    'summary',jsonb_build_object(
      'activeCampaigns',(select count(*) from public.growth_campaigns where workspace_id=public.current_workspace_id() and status='ACTIVE'),
      'attributedLeads',(select count(distinct lead_id) from public.lead_attribution_touches where workspace_id=public.current_workspace_id()),
      'convertedLeads',(select count(distinct touch.lead_id) from public.lead_attribution_touches touch join public.leads lead on lead.id=touch.lead_id where touch.workspace_id=public.current_workspace_id() and lead.status='CONVERTED'),
      'pendingAdmissions',(select count(*) from public.admission_journeys where workspace_id=public.current_workspace_id() and stage not in ('ENROLLED','CLOSED'))
    ),
    'campaigns',coalesce((select jsonb_agg(jsonb_build_object(
      'id',campaign.id,
      'pipelineByCurrency',coalesce((select jsonb_object_agg(amounts.currency,amounts.total) from (
        select opportunity.currency,sum(opportunity.amount) total from (select distinct lead_id from public.lead_attribution_touches where campaign_id=campaign.id) touched
        join public.lead_conversions conversion on conversion.lead_id=touched.lead_id join public.opportunities opportunity on opportunity.id=conversion.opportunity_id group by opportunity.currency
      ) amounts),'{}'::jsonb),
      'wonByCurrency',coalesce((select jsonb_object_agg(amounts.currency,amounts.total) from (
        select opportunity.currency,sum(opportunity.amount) total from (select distinct lead_id from public.lead_attribution_touches where campaign_id=campaign.id) touched
        join public.lead_conversions conversion on conversion.lead_id=touched.lead_id join public.opportunities opportunity on opportunity.id=conversion.opportunity_id where opportunity.stage='WON' group by opportunity.currency
      ) amounts),'{}'::jsonb),
      'enrolled',(select count(*) from public.admission_journeys journey where journey.stage='ENROLLED' and journey.lead_id in (select lead_id from public.lead_attribution_touches where campaign_id=campaign.id))
    ) order by campaign.created_at desc) from public.growth_campaigns campaign where campaign.workspace_id=public.current_workspace_id()),'[]'::jsonb)
  );
$$;

revoke all on function public.preview_automation_rule(uuid,jsonb),public.retry_automation_run(uuid),
  public.create_guardian_portal_invitation(uuid,text,text,timestamptz),public.revoke_guardian_portal_invitation(uuid),
  public.decide_portal_update(uuid,text,text),public.queue_communication_message(uuid,text,text),
  public.record_inbound_communication(uuid,text,text),public.retry_communication_message(uuid),public.communication_inbox_snapshot(text,integer),
  public.configure_data_quality_rule(text,boolean,text),public.assign_data_quality_issue(uuid,uuid),
  public.growth_performance_snapshot() from public,anon;
grant execute on function public.preview_automation_rule(uuid,jsonb),public.retry_automation_run(uuid),
  public.create_guardian_portal_invitation(uuid,text,text,timestamptz),public.revoke_guardian_portal_invitation(uuid),
  public.decide_portal_update(uuid,text,text),public.queue_communication_message(uuid,text,text),
  public.record_inbound_communication(uuid,text,text),public.retry_communication_message(uuid),public.communication_inbox_snapshot(text,integer),
  public.configure_data_quality_rule(text,boolean,text),public.assign_data_quality_issue(uuid,uuid),
  public.growth_performance_snapshot() to authenticated;
revoke all on function public.service_accept_portal_consent(text,text,text,text),
  public.service_record_connector_reconciliation(uuid,text,text,text,text,uuid,numeric,text,text,text)
  from public,anon,authenticated;
grant execute on function public.service_accept_portal_consent(text,text,text,text),
  public.service_record_connector_reconciliation(uuid,text,text,text,text,uuid,numeric,text,text,text)
  to service_role;

do $$ declare table_name text;begin
  foreach table_name in array array['portal_access_consents','data_quality_rule_configs','connector_reconciliation_receipts'] loop
    execute format('drop trigger if exists audit_%I on public.%I',table_name,table_name);
    execute format('create trigger audit_%I after insert or update or delete on public.%I for each row execute procedure public.audit_row_change()',table_name,table_name);
  end loop;
end$$;

notify pgrst,'reload schema';
