-- v2.2 business expansion: deterministic automation, growth attribution,
-- guardian self-service, governed communications, quality trends and payments.

-- ---------------------------------------------------------------------------
-- Deterministic automation
-- ---------------------------------------------------------------------------
create table public.automation_rules (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default public.current_workspace_id() references public.workspaces(id) on delete cascade,
  name_zh text not null check(length(trim(name_zh)) between 2 and 160),
  name_en text not null check(length(trim(name_en)) between 2 and 160),
  trigger_key text not null check(trigger_key in ('LEAD_CREATED','LEAD_STATUS_CHANGED','OPPORTUNITY_STAGE_CHANGED','CONTRACT_RENEWAL_DUE','MANUAL')),
  conditions jsonb not null default '{}'::jsonb check(jsonb_typeof(conditions)='object'),
  action_type text not null check(action_type in ('TASK','NOTIFICATION')),
  action_config jsonb not null default '{}'::jsonb check(jsonb_typeof(action_config)='object'),
  active boolean not null default true,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index automation_rules_trigger_idx on public.automation_rules(workspace_id,trigger_key,active);

create table public.automation_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  trigger_key text not null,
  event_key text not null,
  payload jsonb not null default '{}'::jsonb,
  actor_id uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique(workspace_id,event_key)
);

create table public.automation_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  rule_id uuid not null references public.automation_rules(id) on delete cascade,
  event_id uuid not null references public.automation_events(id) on delete cascade,
  status text not null check(status in ('SUCCEEDED','FAILED','SKIPPED')),
  result_type text,
  result_id uuid,
  error_code text,
  created_at timestamptz not null default now(),
  unique(rule_id,event_id)
);
create index automation_runs_recent_idx on public.automation_runs(workspace_id,created_at desc);

alter table public.automation_rules enable row level security;
alter table public.automation_events enable row level security;
alter table public.automation_runs enable row level security;
create policy "automation leaders read rules" on public.automation_rules for select to authenticated
  using(public.is_workspace_member(workspace_id) and public.current_crm_role() in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER'));
create policy "automation leaders create rules" on public.automation_rules for insert to authenticated
  with check(public.is_workspace_member(workspace_id) and created_by=auth.uid() and public.current_crm_role() in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER'));
create policy "automation leaders update rules" on public.automation_rules for update to authenticated
  using(public.is_workspace_member(workspace_id) and public.current_crm_role() in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER'))
  with check(public.is_workspace_member(workspace_id) and public.current_crm_role() in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER'));
create policy "automation leaders read events" on public.automation_events for select to authenticated
  using(public.is_workspace_member(workspace_id) and public.current_crm_role() in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER'));
create policy "automation leaders read runs" on public.automation_runs for select to authenticated
  using(public.is_workspace_member(workspace_id) and public.current_crm_role() in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER'));

create or replace function public.dispatch_automation_event(
  target_workspace uuid,target_trigger text,target_event_key text,target_payload jsonb,target_actor uuid
) returns jsonb
language plpgsql security definer set search_path=public
as $$
declare event_row public.automation_events;rule_row public.automation_rules;task_id uuid;notification_id uuid;
  succeeded integer:=0;failed integer:=0;duplicate boolean:=false;due_hours integer;
begin
  if target_workspace is null or target_trigger not in ('LEAD_CREATED','LEAD_STATUS_CHANGED','OPPORTUNITY_STAGE_CHANGED','CONTRACT_RENEWAL_DUE','MANUAL')
    or nullif(trim(target_event_key),'') is null or jsonb_typeof(coalesce(target_payload,'{}'::jsonb))<>'object' then
    raise exception 'automation_event_invalid';
  end if;
  insert into public.automation_events(workspace_id,trigger_key,event_key,payload,actor_id)
  values(target_workspace,target_trigger,left(target_event_key,240),coalesce(target_payload,'{}'::jsonb),target_actor)
  on conflict(workspace_id,event_key) do nothing returning * into event_row;
  if event_row.id is null then
    duplicate:=true;
    select * into event_row from public.automation_events where workspace_id=target_workspace and event_key=left(target_event_key,240);
    return jsonb_build_object('eventId',event_row.id,'duplicate',true,'succeeded',0,'failed',0);
  end if;
  for rule_row in select * from public.automation_rules
    where workspace_id=target_workspace and active and trigger_key=target_trigger
      and (conditions='{}'::jsonb or coalesce(target_payload,'{}'::jsonb) @> conditions)
    order by created_at,id
  loop
    begin
      if rule_row.action_type='TASK' then
        due_hours:=case when coalesce(rule_row.action_config->>'dueHours','')~'^\d{1,4}$'
          then greatest(1,least(2160,(rule_row.action_config->>'dueHours')::integer)) else 24 end;
        insert into public.crm_tasks(workspace_id,title_zh,title_en,related_type,related_id,related_label,status,priority,owner_id,due_at,created_by)
        values(target_workspace,
          coalesce(nullif(trim(rule_row.action_config->>'titleZh'),''),rule_row.name_zh),
          coalesce(nullif(trim(rule_row.action_config->>'titleEn'),''),rule_row.name_en),
          coalesce(nullif(trim(target_payload->>'relatedType'),''),'GENERAL'),
          case when coalesce(target_payload->>'relatedId','')~'^[0-9a-fA-F-]{36}$' then (target_payload->>'relatedId')::uuid else null end,
          left(coalesce(target_payload->>'relatedLabel',''),160),'TODO',
          case when upper(coalesce(rule_row.action_config->>'priority','NORMAL')) in ('LOW','NORMAL','HIGH','URGENT') then upper(rule_row.action_config->>'priority') else 'NORMAL' end,
          target_actor,now()+make_interval(hours=>due_hours),target_actor)
        returning id into task_id;
        insert into public.automation_runs(workspace_id,rule_id,event_id,status,result_type,result_id)
        values(target_workspace,rule_row.id,event_row.id,'SUCCEEDED','TASK',task_id);
      else
        insert into public.user_notifications(workspace_id,user_id,kind,title_key,body_key,values,source_type,source_id)
        values(target_workspace,target_actor,'AUTOMATION','automation.notification.title','automation.notification.body',
          jsonb_build_object('ruleZh',rule_row.name_zh,'ruleEn',rule_row.name_en,'event',target_trigger),
          'AUTOMATION_RULE',rule_row.id) returning id into notification_id;
        insert into public.automation_runs(workspace_id,rule_id,event_id,status,result_type,result_id)
        values(target_workspace,rule_row.id,event_row.id,'SUCCEEDED','NOTIFICATION',notification_id);
      end if;
      succeeded:=succeeded+1;
    exception when others then
      failed:=failed+1;
      insert into public.automation_runs(workspace_id,rule_id,event_id,status,error_code)
      values(target_workspace,rule_row.id,event_row.id,'FAILED',left(sqlstate||':'||sqlerrm,500))
      on conflict(rule_id,event_id) do nothing;
    end;
  end loop;
  return jsonb_build_object('eventId',event_row.id,'duplicate',duplicate,'succeeded',succeeded,'failed',failed);
end;
$$;

create or replace function public.run_automation_event(target_trigger text,target_event_key text,target_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
begin
  if public.current_crm_role() not in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER') then raise exception 'automation_forbidden'; end if;
  return public.dispatch_automation_event(public.current_workspace_id(),upper(target_trigger),target_event_key,target_payload,auth.uid());
end;$$;

create or replace function public.lead_automation_trigger() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if tg_op='INSERT' then
    perform public.dispatch_automation_event(new.workspace_id,'LEAD_CREATED','lead:'||new.id||':created',jsonb_build_object('relatedType','LEAD','relatedId',new.id,'relatedLabel',new.name_en,'ownerId',new.owner_id,'status',new.status,'source',new.source),new.created_by);
  elsif new.status is distinct from old.status then
    perform public.dispatch_automation_event(new.workspace_id,'LEAD_STATUS_CHANGED','lead:'||new.id||':status:'||new.status,jsonb_build_object('relatedType','LEAD','relatedId',new.id,'relatedLabel',new.name_en,'ownerId',new.owner_id,'status',new.status,'source',new.source),new.owner_id);
  end if;
  return new;
end;$$;
drop trigger if exists lead_automation on public.leads;
create trigger lead_automation after insert or update of status on public.leads for each row execute procedure public.lead_automation_trigger();

create or replace function public.opportunity_automation_trigger() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.stage is distinct from old.stage then
    perform public.dispatch_automation_event(new.workspace_id,'OPPORTUNITY_STAGE_CHANGED','opportunity:'||new.id||':stage:'||new.stage,jsonb_build_object('relatedType','OPPORTUNITY','relatedId',new.id,'relatedLabel',new.title_en,'ownerId',new.owner_id,'stage',new.stage,'currency',new.currency),new.owner_id);
  end if;
  return new;
end;$$;
drop trigger if exists opportunity_automation on public.opportunities;
create trigger opportunity_automation after update of stage on public.opportunities for each row execute procedure public.opportunity_automation_trigger();

-- ---------------------------------------------------------------------------
-- Growth attribution and admissions journeys
-- ---------------------------------------------------------------------------
create table public.growth_campaigns (
  id uuid primary key default gen_random_uuid(),workspace_id uuid not null default public.current_workspace_id() references public.workspaces(id) on delete cascade,
  code text not null,name_zh text not null,name_en text not null,channel text not null,
  status text not null default 'PLANNED' check(status in ('PLANNED','ACTIVE','PAUSED','COMPLETED')),
  budget numeric(14,2) not null default 0 check(budget>=0),currency text not null default 'CNY' check(currency~'^[A-Z]{3}$'),
  starts_on date,ends_on date,created_by uuid not null default auth.uid() references auth.users(id),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
  unique(workspace_id,code),check(ends_on is null or starts_on is null or ends_on>=starts_on)
);
create table public.lead_attribution_touches (
  id uuid primary key default gen_random_uuid(),workspace_id uuid not null default public.current_workspace_id() references public.workspaces(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,campaign_id uuid references public.growth_campaigns(id) on delete set null,
  touch_type text not null check(touch_type in ('FIRST','ASSIST','LAST')),channel text not null,source text not null,medium text not null default '',content text not null default '',
  occurred_at timestamptz not null default now(),created_by uuid not null default auth.uid() references auth.users(id),created_at timestamptz not null default now()
);
create index lead_attribution_lead_idx on public.lead_attribution_touches(workspace_id,lead_id,occurred_at);
create table public.admission_journeys (
  id uuid primary key default gen_random_uuid(),workspace_id uuid not null default public.current_workspace_id() references public.workspaces(id) on delete cascade,
  lead_id uuid references public.leads(id) on delete cascade,student_id uuid references public.students(id) on delete cascade,
  stage text not null check(stage in ('INQUIRY','ASSESSMENT','PLANNING','APPLICATION','OFFER','ENROLLED','CLOSED')),
  probability smallint not null default 10 check(probability between 0 and 100),next_action text not null default '',next_action_at timestamptz,
  owner_id uuid not null default auth.uid() references auth.users(id),created_by uuid not null default auth.uid() references auth.users(id),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
  check((lead_id is not null)::integer+(student_id is not null)::integer=1),unique(workspace_id,lead_id),unique(workspace_id,student_id)
);
alter table public.growth_campaigns enable row level security;
alter table public.lead_attribution_touches enable row level security;
alter table public.admission_journeys enable row level security;
create policy "sales read campaigns" on public.growth_campaigns for select to authenticated using(public.is_workspace_member(workspace_id));
create policy "growth leaders manage campaigns" on public.growth_campaigns for all to authenticated
  using(public.is_workspace_member(workspace_id) and public.current_crm_role() in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER'))
  with check(public.is_workspace_member(workspace_id) and created_by=auth.uid() and public.current_crm_role() in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER'));
create policy "sales read attribution" on public.lead_attribution_touches for select to authenticated using(public.is_workspace_member(workspace_id));
create policy "sales record attribution" on public.lead_attribution_touches for insert to authenticated
  with check(public.is_workspace_member(workspace_id) and created_by=auth.uid() and public.current_crm_role() in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER','SALES_SPECIALIST'));
create policy "sales read journeys" on public.admission_journeys for select to authenticated using(public.is_workspace_member(workspace_id));
create policy "sales create journeys" on public.admission_journeys for insert to authenticated
  with check(public.is_workspace_member(workspace_id) and created_by=auth.uid() and owner_id=auth.uid() and public.current_crm_role() in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER','SALES_SPECIALIST'));
create policy "owners update journeys" on public.admission_journeys for update to authenticated
  using(public.is_workspace_member(workspace_id) and (owner_id=auth.uid() or public.current_crm_role() in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER')))
  with check(public.is_workspace_member(workspace_id) and (owner_id=auth.uid() or public.current_crm_role() in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER')));

create or replace function public.growth_snapshot()
returns jsonb language sql stable security definer set search_path=public as $$
  select jsonb_build_object(
    'campaigns',coalesce((select jsonb_agg(jsonb_build_object(
      'id',c.id,'code',c.code,'nameZh',c.name_zh,'nameEn',c.name_en,'channel',c.channel,'status',c.status,
      'budget',c.budget,'currency',c.currency,'startsOn',c.starts_on,'endsOn',c.ends_on,
      'touches',(select count(*) from public.lead_attribution_touches t where t.campaign_id=c.id),
      'leads',(select count(distinct t.lead_id) from public.lead_attribution_touches t where t.campaign_id=c.id),
      'converted',(select count(distinct t.lead_id) from public.lead_attribution_touches t join public.leads l on l.id=t.lead_id where t.campaign_id=c.id and l.status='CONVERTED')
    ) order by c.created_at desc) from public.growth_campaigns c where c.workspace_id=public.current_workspace_id()),'[]'::jsonb),
    'journeys',coalesce((select jsonb_agg(jsonb_build_object(
      'id',j.id,'leadId',j.lead_id,'studentId',j.student_id,'stage',j.stage,'probability',j.probability,
      'nextAction',j.next_action,'nextActionAt',j.next_action_at,
      'nameZh',coalesce(l.name_zh,student_contact.name_zh),'nameEn',coalesce(l.name_en,student_contact.name_en)
    ) order by j.updated_at desc) from public.admission_journeys j
      left join public.leads l on l.id=j.lead_id left join public.students s on s.id=j.student_id left join public.contacts student_contact on student_contact.id=s.person_id
      where j.workspace_id=public.current_workspace_id()),'[]'::jsonb),
    'channels',coalesce((select jsonb_agg(jsonb_build_object('channel',x.channel,'touches',x.touches,'leads',x.leads) order by x.touches desc)
      from (select channel,count(*) touches,count(distinct lead_id) leads from public.lead_attribution_touches where workspace_id=public.current_workspace_id() group by channel) x),'[]'::jsonb)
  );
$$;

-- ---------------------------------------------------------------------------
-- Guardian portal bearer invitations. Only digests are persisted.
-- ---------------------------------------------------------------------------
create table public.portal_invitations (
  id uuid primary key default gen_random_uuid(),workspace_id uuid not null default public.current_workspace_id() references public.workspaces(id) on delete cascade,
  household_id uuid not null references public.households(id) on delete cascade,guardian_contact_id uuid references public.contacts(id) on delete set null,
  invited_email citext not null,token_digest text not null unique check(token_digest~'^[a-f0-9]{64}$'),
  status text not null default 'ACTIVE' check(status in ('ACTIVE','REVOKED','EXPIRED')),
  expires_at timestamptz not null,last_accessed_at timestamptz,created_by uuid not null default auth.uid() references auth.users(id),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
  check(expires_at>created_at)
);
create index portal_invitation_household_idx on public.portal_invitations(workspace_id,household_id,status);
create table public.portal_update_requests (
  id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id) on delete cascade,
  invitation_id uuid not null references public.portal_invitations(id) on delete cascade,request_key text not null,
  requested_changes jsonb not null check(jsonb_typeof(requested_changes)='object' and requested_changes<>'{}'::jsonb),
  status text not null default 'PENDING' check(status in ('PENDING','APPROVED','REJECTED')),
  decision_note text not null default '',decided_by uuid references auth.users(id),decided_at timestamptz,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
  unique(invitation_id,request_key)
);
alter table public.portal_invitations enable row level security;
alter table public.portal_update_requests enable row level security;
create policy "portal staff read invitations" on public.portal_invitations for select to authenticated
  using(public.is_workspace_member(workspace_id) and public.current_crm_role() in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER','SALES_SPECIALIST','SALES_SUPPORT'));
create policy "portal staff create invitations" on public.portal_invitations for insert to authenticated
  with check(public.is_workspace_member(workspace_id) and created_by=auth.uid() and public.current_crm_role() in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER','SALES_SPECIALIST','SALES_SUPPORT'));
create policy "portal staff update invitations" on public.portal_invitations for update to authenticated
  using(public.is_workspace_member(workspace_id) and public.current_crm_role() in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER','SALES_SPECIALIST','SALES_SUPPORT'))
  with check(public.is_workspace_member(workspace_id) and public.current_crm_role() in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER','SALES_SPECIALIST','SALES_SUPPORT'));
create policy "portal staff read updates" on public.portal_update_requests for select to authenticated
  using(public.is_workspace_member(workspace_id) and public.current_crm_role() in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER','SALES_SPECIALIST','SALES_SUPPORT'));
create policy "portal leaders decide updates" on public.portal_update_requests for update to authenticated
  using(public.is_workspace_member(workspace_id) and public.current_crm_role() in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER'))
  with check(public.is_workspace_member(workspace_id) and public.current_crm_role() in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER'));

create or replace function public.service_portal_snapshot(target_digest text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare invitation public.portal_invitations;result jsonb;
begin
  if auth.role()<>'service_role' or target_digest!~'^[a-f0-9]{64}$' then raise exception 'portal_access_invalid'; end if;
  select * into invitation from public.portal_invitations where token_digest=target_digest for update;
  if not found or invitation.status<>'ACTIVE' or invitation.expires_at<=now() then
    if found and invitation.status='ACTIVE' then update public.portal_invitations set status='EXPIRED',updated_at=now() where id=invitation.id; end if;
    raise exception 'portal_invitation_invalid';
  end if;
  update public.portal_invitations set last_accessed_at=now(),updated_at=now() where id=invitation.id;
  select jsonb_build_object(
    'invitationId',invitation.id,'expiresAt',invitation.expires_at,
    'household',jsonb_build_object('id',h.id,'nameZh',h.name_zh,'nameEn',h.name_en,'address',h.address),
    'students',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'nameZh',c.name_zh,'nameEn',c.name_en,'grade',s.current_grade,'academicYear',s.academic_year,'status',s.status) order by c.name_en)
      from public.students s join public.contacts c on c.id=s.person_id where s.household_id=h.id),'[]'::jsonb),
    'pendingUpdates',(select count(*) from public.portal_update_requests r where r.invitation_id=invitation.id and r.status='PENDING')
  ) into result from public.households h where h.id=invitation.household_id;
  return result;
end;$$;

create or replace function public.service_submit_portal_update(target_digest text,target_request_key text,target_changes jsonb)
returns uuid language plpgsql security definer set search_path=public as $$
declare invitation public.portal_invitations;created_id uuid;
begin
  if auth.role()<>'service_role' or target_digest!~'^[a-f0-9]{64}$' or nullif(trim(target_request_key),'') is null
    or jsonb_typeof(target_changes)<>'object' or target_changes='{}'::jsonb
    or exists(select 1 from jsonb_object_keys(target_changes) fields(key) where fields.key not in ('address','preferredContact','note')) then
    raise exception 'portal_update_invalid';
  end if;
  select * into invitation from public.portal_invitations where token_digest=target_digest and status='ACTIVE' and expires_at>now() for update;
  if not found then raise exception 'portal_invitation_invalid'; end if;
  if (select count(*) from public.portal_update_requests where invitation_id=invitation.id and created_at>now()-interval '24 hours')>=10 then raise exception 'portal_update_rate_limited'; end if;
  insert into public.portal_update_requests(workspace_id,invitation_id,request_key,requested_changes)
  values(invitation.workspace_id,invitation.id,left(target_request_key,120),target_changes)
  on conflict(invitation_id,request_key) do update set request_key=excluded.request_key
  returning id into created_id;
  return created_id;
end;$$;

-- ---------------------------------------------------------------------------
-- Governed communications inbox
-- ---------------------------------------------------------------------------
create table public.communication_threads (
  id uuid primary key default gen_random_uuid(),workspace_id uuid not null default public.current_workspace_id() references public.workspaces(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete restrict,subject text not null check(length(trim(subject)) between 2 and 200),
  channel text not null check(channel in ('EMAIL')),purpose text not null default 'SERVICE' check(purpose in ('SERVICE','TRANSACTIONAL','EVENT','MARKETING')),
  status text not null default 'OPEN' check(status in ('OPEN','CLOSED')),assigned_to uuid not null default auth.uid() references auth.users(id),
  created_by uuid not null default auth.uid() references auth.users(id),last_message_at timestamptz,created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create index communication_threads_queue_idx on public.communication_threads(workspace_id,status,last_message_at desc nulls last);
create table public.communication_messages (
  id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id) on delete cascade,
  thread_id uuid not null references public.communication_threads(id) on delete cascade,direction text not null check(direction in ('INBOUND','OUTBOUND')),
  body text not null check(length(trim(body)) between 1 and 10000),delivery_status text not null default 'QUEUED' check(delivery_status in ('QUEUED','SENT','DELIVERED','FAILED','RECEIVED')),
  provider_message_id text,last_error text,sent_by uuid references auth.users(id),created_at timestamptz not null default now(),delivered_at timestamptz
);
create index communication_messages_thread_idx on public.communication_messages(thread_id,created_at);
alter table public.communication_threads enable row level security;
alter table public.communication_messages enable row level security;
create policy "members read communication threads" on public.communication_threads for select to authenticated using(public.is_workspace_member(workspace_id));
create policy "members read communication messages" on public.communication_messages for select to authenticated using(public.is_workspace_member(workspace_id));

create or replace function public.create_communication_thread(target_contact uuid,target_subject text,target_channel text default 'EMAIL',target_purpose text default 'SERVICE')
returns public.communication_threads language plpgsql security definer set search_path=public as $$
declare result public.communication_threads;ws uuid:=public.current_workspace_id();
begin
  if auth.uid() is null or nullif(trim(target_subject),'') is null or upper(target_channel)<>'EMAIL'
    or upper(target_purpose) not in ('SERVICE','TRANSACTIONAL','EVENT','MARKETING')
    or not exists(select 1 from public.contacts where id=target_contact and workspace_id=ws) then raise exception 'communication_thread_invalid'; end if;
  insert into public.communication_threads(workspace_id,contact_id,subject,channel,purpose,assigned_to,created_by)
  values(ws,target_contact,left(trim(target_subject),200),upper(target_channel),upper(target_purpose),auth.uid(),auth.uid()) returning * into result;
  return result;
end;$$;

create or replace function public.queue_communication_message(target_thread uuid,target_body text)
returns public.communication_messages language plpgsql security definer set search_path=public as $$
declare thread public.communication_threads;result public.communication_messages;
begin
  select * into thread from public.communication_threads where id=target_thread and workspace_id=public.current_workspace_id() and status='OPEN' for update;
  if not found or nullif(trim(target_body),'') is null then raise exception 'communication_message_invalid'; end if;
  if not public.contact_channel_allowed(thread.contact_id,thread.channel,thread.purpose) then raise exception 'communication_consent_required'; end if;
  insert into public.communication_messages(workspace_id,thread_id,direction,body,delivery_status,sent_by)
  values(thread.workspace_id,thread.id,'OUTBOUND',left(trim(target_body),10000),'QUEUED',auth.uid()) returning * into result;
  update public.communication_threads set last_message_at=result.created_at,updated_at=now() where id=thread.id;
  return result;
end;$$;

create or replace function public.service_complete_communication(target_message uuid,target_provider_id text)
returns void language plpgsql security definer set search_path=public as $$
begin
  if auth.role()<>'service_role' then raise exception 'communication_service_forbidden'; end if;
  update public.communication_messages set delivery_status='SENT',provider_message_id=left(coalesce(target_provider_id,''),240),last_error=null,delivered_at=now()
    where id=target_message and delivery_status='QUEUED';
end;$$;
create or replace function public.service_fail_communication(target_message uuid,failure text)
returns void language plpgsql security definer set search_path=public as $$
begin
  if auth.role()<>'service_role' then raise exception 'communication_service_forbidden'; end if;
  update public.communication_messages set delivery_status='FAILED',last_error=left(coalesce(failure,'UNKNOWN'),500) where id=target_message and delivery_status='QUEUED';
end;$$;

-- ---------------------------------------------------------------------------
-- Data-quality trend snapshots
-- ---------------------------------------------------------------------------
create table public.data_quality_daily_snapshots (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,snapshot_date date not null default current_date,
  open_low integer not null default 0,open_medium integer not null default 0,open_high integer not null default 0,
  resolved integer not null default 0,dismissed integer not null default 0,captured_at timestamptz not null default now(),
  primary key(workspace_id,snapshot_date)
);
alter table public.data_quality_daily_snapshots enable row level security;
create policy "quality leaders read trends" on public.data_quality_daily_snapshots for select to authenticated
  using(public.is_workspace_member(workspace_id) and public.current_crm_role() in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER'));
create or replace function public.refresh_data_quality_daily_snapshot(target_workspace uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
  insert into public.data_quality_daily_snapshots(workspace_id,snapshot_date,open_low,open_medium,open_high,resolved,dismissed,captured_at)
  select target_workspace,current_date,
    count(*) filter(where status in ('OPEN','ASSIGNED') and severity='LOW'),
    count(*) filter(where status in ('OPEN','ASSIGNED') and severity='MEDIUM'),
    count(*) filter(where status in ('OPEN','ASSIGNED') and severity='HIGH'),
    count(*) filter(where status='RESOLVED'),count(*) filter(where status='DISMISSED'),now()
  from public.data_quality_issues where workspace_id=target_workspace
  on conflict(workspace_id,snapshot_date) do update set open_low=excluded.open_low,open_medium=excluded.open_medium,
    open_high=excluded.open_high,resolved=excluded.resolved,dismissed=excluded.dismissed,captured_at=excluded.captured_at;
end;$$;
create or replace function public.data_quality_snapshot_trigger() returns trigger language plpgsql security definer set search_path=public as $$
begin perform public.refresh_data_quality_daily_snapshot(coalesce(new.workspace_id,old.workspace_id));return coalesce(new,old);end;$$;
drop trigger if exists data_quality_snapshot on public.data_quality_issues;
create trigger data_quality_snapshot after insert or update or delete on public.data_quality_issues for each row execute procedure public.data_quality_snapshot_trigger();

-- ---------------------------------------------------------------------------
-- Payment connector
-- ---------------------------------------------------------------------------
alter table public.integration_connections drop constraint if exists integration_connections_provider_check;
alter table public.integration_connections add constraint integration_connections_provider_check check(provider in (
  'MICROSOFT_365','GOOGLE_CALENDAR','EMAIL','E_SIGNATURE','ACCOUNTING','PAYMENT'
));
insert into public.integration_connections(workspace_id,provider)
select id,'PAYMENT' from public.workspaces on conflict(workspace_id,provider) do nothing;

create or replace function public.configure_integration(target_provider text,next_status text,next_direction text,account_label text)
returns public.integration_connections language plpgsql security definer set search_path=public as $$
declare result public.integration_connections;current_connection public.integration_connections;ws uuid:=public.current_workspace_id();normalized_status text:=upper(next_status);
begin
  if public.current_crm_role() not in ('SUPER_ADMIN','ADMIN')
    or upper(target_provider) not in ('MICROSOFT_365','GOOGLE_CALENDAR','EMAIL','E_SIGNATURE','ACCOUNTING','PAYMENT')
    or normalized_status not in ('DISCONNECTED','CONNECTING','CONNECTED','DEGRADED','ACTION_REQUIRED')
    or upper(next_direction) not in ('NONE','IMPORT_ONLY','EXPORT_ONLY','BIDIRECTIONAL') then raise exception 'integration_configuration_invalid'; end if;
  select * into current_connection from public.integration_connections where workspace_id=ws and provider=upper(target_provider) for update;
  if not found then raise exception 'integration_not_found'; end if;
  if normalized_status in ('CONNECTED','DEGRADED') and current_connection.status not in ('CONNECTED','DEGRADED') then raise exception 'integration_connection_confirmation_required'; end if;
  update public.integration_connections set status=normalized_status,sync_direction=upper(next_direction),external_account_label=trim(coalesce(account_label,'')),configured_by=auth.uid(),last_error=null,updated_at=now()
    where id=current_connection.id returning * into result;
  return result;
end;$$;

create or replace function public.confirm_integration_connection(target_workspace uuid,target_provider text,account_label text,next_direction text)
returns public.integration_connections language plpgsql security definer set search_path=public as $$
declare result public.integration_connections;
begin
  if upper(target_provider) not in ('MICROSOFT_365','GOOGLE_CALENDAR','EMAIL','E_SIGNATURE','ACCOUNTING','PAYMENT')
    or upper(next_direction) not in ('IMPORT_ONLY','EXPORT_ONLY','BIDIRECTIONAL') or nullif(trim(account_label),'') is null then raise exception 'integration_confirmation_invalid'; end if;
  update public.integration_connections set status='CONNECTED',sync_direction=upper(next_direction),external_account_label=trim(account_label),last_error=null,updated_at=now()
    where workspace_id=target_workspace and provider=upper(target_provider) returning * into result;
  if not found then raise exception 'integration_not_found'; end if;
  return result;
end;$$;

-- Grants and audit coverage.
grant select,insert,update on public.automation_rules to authenticated;
grant select on public.automation_events,public.automation_runs to authenticated;
grant select,insert,update on public.growth_campaigns,public.lead_attribution_touches,public.admission_journeys to authenticated;
grant select,insert,update on public.portal_invitations,public.portal_update_requests to authenticated;
grant select on public.communication_threads,public.communication_messages,public.data_quality_daily_snapshots to authenticated;
revoke all on function public.dispatch_automation_event(uuid,text,text,jsonb,uuid) from public,anon,authenticated;
revoke all on function public.run_automation_event(text,text,jsonb),public.growth_snapshot(),public.create_communication_thread(uuid,text,text,text),public.queue_communication_message(uuid,text) from public,anon;
grant execute on function public.run_automation_event(text,text,jsonb),public.growth_snapshot(),public.create_communication_thread(uuid,text,text,text),public.queue_communication_message(uuid,text) to authenticated;
revoke all on function public.service_portal_snapshot(text),public.service_submit_portal_update(text,text,jsonb),public.service_complete_communication(uuid,text),public.service_fail_communication(uuid,text) from public,anon,authenticated;
grant execute on function public.service_portal_snapshot(text),public.service_submit_portal_update(text,text,jsonb),public.service_complete_communication(uuid,text),public.service_fail_communication(uuid,text),public.confirm_integration_connection(uuid,text,text,text) to service_role;
revoke all on function public.refresh_data_quality_daily_snapshot(uuid) from public,anon,authenticated;

do $$ declare table_name text;begin
  foreach table_name in array array['automation_rules','growth_campaigns','lead_attribution_touches','admission_journeys','portal_invitations','portal_update_requests','communication_threads','communication_messages'] loop
    execute format('drop trigger if exists audit_%I on public.%I',table_name,table_name);
    execute format('create trigger audit_%I after insert or update or delete on public.%I for each row execute procedure public.audit_row_change()',table_name,table_name);
  end loop;
end$$;

notify pgrst,'reload schema';
