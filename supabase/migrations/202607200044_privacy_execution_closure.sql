-- v2.2.0: execute data-subject requests instead of treating a status update as
-- fulfillment. Export artifacts remain private and are completed by the
-- generated-jobs worker with an integrity receipt.

alter table public.privacy_requests drop constraint if exists privacy_requests_status_check;
alter table public.privacy_requests add constraint privacy_requests_status_check
  check(status in (
    'RECEIVED','IDENTITY_REVIEW','IN_PROGRESS','WAITING_APPROVAL',
    'EXECUTING','EXECUTION_FAILED','FULFILLED','REJECTED','CANCELLED'
  ));
alter table public.privacy_requests
  add column if not exists requested_changes jsonb not null default '{}'::jsonb;

create table if not exists public.privacy_executions(
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  request_id uuid not null unique references public.privacy_requests(id) on delete restrict,
  request_type text not null check(request_type in ('ACCESS','EXPORT','CORRECTION','RESTRICTION','DELETION')),
  status text not null default 'QUEUED' check(status in ('QUEUED','PROCESSING','COMPLETED','FAILED')),
  scope_snapshot jsonb not null default '{}'::jsonb,
  result_summary jsonb not null default '{}'::jsonb,
  legal_hold jsonb not null default '{}'::jsonb,
  generated_job_id uuid unique,
  artifact_path text,
  artifact_expires_at timestamptz,
  exported_row_count integer check(exported_row_count is null or exported_row_count>=0),
  receipt_sha256 text check(receipt_sha256 is null or receipt_sha256~'^[a-f0-9]{64}$'),
  failure_code text,
  failure_detail text,
  requested_by uuid not null references auth.users(id),
  executed_by uuid references auth.users(id),
  reviewed_by uuid references auth.users(id),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.privacy_restrictions(
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  request_id uuid not null references public.privacy_requests(id) on delete restrict,
  scopes text[] not null default array['MARKETING','EXPORT','COMMUNICATION']::text[],
  reason text not null,
  active boolean not null default true,
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(workspace_id,contact_id)
);
create index if not exists privacy_restrictions_active_idx
  on public.privacy_restrictions(workspace_id,contact_id) where active;

alter table public.generated_jobs alter column approval_request_id drop not null;
alter table public.generated_jobs
  add column if not exists privacy_request_id uuid unique
    references public.privacy_requests(id) on delete restrict;
alter table public.generated_jobs drop constraint if exists generated_jobs_origin_check;
alter table public.generated_jobs add constraint generated_jobs_origin_check check(
  (case when approval_request_id is null then 0 else 1 end)
  +(case when privacy_request_id is null then 0 else 1 end)=1
);
alter table public.generated_jobs drop constraint if exists generated_jobs_job_type_check;
alter table public.generated_jobs add constraint generated_jobs_job_type_check
  check(job_type in ('CONTRACT_EXPORT','PERFORMANCE_SUMMARY','MARKETING_CONTACT_EXPORT','CRM_EXPORT','PRIVACY_EXPORT'));
alter table public.privacy_executions drop constraint if exists privacy_executions_generated_job_id_fkey;
alter table public.privacy_executions add constraint privacy_executions_generated_job_id_fkey
  foreign key(generated_job_id) references public.generated_jobs(id) on delete restrict;

alter table public.privacy_executions enable row level security;
alter table public.privacy_restrictions enable row level security;
create policy "privacy participants read executions" on public.privacy_executions
  for select to authenticated using(
    public.is_workspace_member(workspace_id) and exists(
      select 1 from public.privacy_requests request
      where request.id=request_id and (
        request.created_by=auth.uid()
        or public.current_crm_role() in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR')
      )
    )
  );
create policy "privacy leaders read restrictions" on public.privacy_restrictions
  for select to authenticated using(
    public.is_workspace_member(workspace_id)
    and public.current_crm_role() in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR')
  );
grant select on public.privacy_executions,public.privacy_restrictions to authenticated;
revoke insert,update,delete on public.privacy_executions,public.privacy_restrictions from authenticated;
drop policy if exists "privacy leaders manage requests" on public.privacy_requests;
revoke update,delete on public.privacy_requests from authenticated;
grant select,insert on public.privacy_requests to authenticated;

create or replace function public.privacy_scope_snapshot(target_contact uuid,target_workspace uuid)
returns jsonb
language sql stable security definer set search_path=public
as $$
  select jsonb_build_object(
    'contactId',c.id,
    'contact',1,
    'consents',(select count(*) from public.contact_consents x where x.workspace_id=target_workspace and x.contact_id=c.id),
    'activities',(select count(*) from public.crm_activities x where x.workspace_id=target_workspace and x.contact_id=c.id),
    'opportunities',(select count(*) from public.opportunities x where x.workspace_id=target_workspace and x.primary_contact_id=c.id),
    'appointments',(select count(*) from public.appointment_attendees x where x.workspace_id=target_workspace and x.contact_id=c.id),
    'householdMemberships',(select count(*) from public.household_members x where x.workspace_id=target_workspace and x.contact_id=c.id),
    'guardianRelationships',(select count(*) from public.student_guardian_relationships x where x.workspace_id=target_workspace and x.guardian_contact_id=c.id),
    'studentRecords',(select count(*) from public.students x where x.workspace_id=target_workspace and x.person_id=c.id),
    'capturedAt',now()
  ) from public.contacts c where c.id=target_contact and c.workspace_id=target_workspace;
$$;

create or replace function public.start_privacy_execution(target_request uuid,reviewer uuid)
returns public.privacy_requests
language plpgsql security definer set search_path=public
as $$
declare
  request public.privacy_requests;
  contact public.contacts;
  execution public.privacy_executions;
  job public.generated_jobs;
  scope jsonb;
  result jsonb;
  legal_hold_manifest jsonb:='{}'::jsonb;
  completed_at_value timestamptz:=clock_timestamp();
  changes jsonb;
begin
  select * into request from public.privacy_requests where id=target_request for update;
  if not found or request.workspace_id<>public.current_workspace_id()
    or request.identity_status<>'VERIFIED' then raise exception 'privacy_execution_not_authorized'; end if;
  select * into contact from public.contacts where id=request.requester_contact_id and workspace_id=request.workspace_id for update;
  if not found then raise exception 'privacy_contact_not_found'; end if;
  scope:=public.privacy_scope_snapshot(contact.id,request.workspace_id);
  if scope is null then raise exception 'privacy_scope_unavailable'; end if;

  insert into public.privacy_executions(
    workspace_id,request_id,request_type,status,scope_snapshot,requested_by,
    executed_by,reviewed_by,started_at
  ) values(
    request.workspace_id,request.id,request.request_type,'PROCESSING',scope,
    request.created_by,reviewer,reviewer,completed_at_value
  ) on conflict(request_id) do update set
    status='PROCESSING',scope_snapshot=excluded.scope_snapshot,
    executed_by=excluded.executed_by,reviewed_by=excluded.reviewed_by,
    failure_code=null,failure_detail=null,started_at=excluded.started_at,updated_at=now()
  returning * into execution;

  if request.request_type in ('ACCESS','EXPORT') then
    insert into public.generated_jobs(
      workspace_id,approval_request_id,privacy_request_id,job_type,parameters,created_by
    ) values(
      request.workspace_id,null,request.id,'PRIVACY_EXPORT',
      jsonb_build_object('privacyRequestId',request.id,'contactId',contact.id,'format','XLSX','scope',scope),
      request.created_by
    ) on conflict(privacy_request_id) do update set
      status='QUEUED',attempts=0,available_at=now(),error_message=null,
      artifact_path=null,expires_at=null,updated_at=now()
    returning * into job;
    update public.privacy_executions set
      status='QUEUED',generated_job_id=job.id,updated_at=now()
    where id=execution.id;
    update public.privacy_requests set status='EXECUTING',assigned_to=reviewer,updated_at=now()
    where id=request.id returning * into request;
    return request;
  end if;

  if request.request_type='CORRECTION' then
    changes:=request.requested_changes;
    if jsonb_typeof(changes)<>'object' or changes='{}'::jsonb
      or exists(select 1 from jsonb_object_keys(changes) as fields(key)
        where fields.key not in ('nameZh','nameEn','email','phone','title')) then
      raise exception 'privacy_correction_invalid';
    end if;
    result:=jsonb_build_object(
      'before',jsonb_build_object('nameZh',contact.name_zh,'nameEn',contact.name_en,'email',contact.email,'phone',contact.phone,'title',contact.title)
    );
    update public.contacts set
      name_zh=case when changes?'nameZh' then left(trim(changes->>'nameZh'),160) else name_zh end,
      name_en=case when changes?'nameEn' then left(trim(changes->>'nameEn'),160) else name_en end,
      email=case when changes?'email' then nullif(lower(trim(changes->>'email')),'')::citext else email end,
      phone=case when changes?'phone' then nullif(left(trim(changes->>'phone'),80),'') else phone end,
      title=case when changes?'title' then left(trim(changes->>'title'),160) else title end,
      updated_at=now()
    where id=contact.id returning * into contact;
    if nullif(contact.name_zh,'') is null or nullif(contact.name_en,'') is null then raise exception 'privacy_correction_invalid'; end if;
    result:=result||jsonb_build_object(
      'after',jsonb_build_object('nameZh',contact.name_zh,'nameEn',contact.name_en,'email',contact.email,'phone',contact.phone,'title',contact.title),
      'changedFields',(select jsonb_agg(fields.key order by fields.key)
        from jsonb_object_keys(changes) as fields(key))
    );
  elsif request.request_type='RESTRICTION' then
    insert into public.privacy_restrictions(
      workspace_id,contact_id,request_id,reason,created_by
    ) values(request.workspace_id,contact.id,request.id,request.decision_note,reviewer)
    on conflict(workspace_id,contact_id) do update set
      request_id=excluded.request_id,reason=excluded.reason,active=true,
      starts_at=now(),ends_at=null,updated_at=now();
    update public.contacts set do_not_contact=true,
      do_not_contact_reason='PRIVACY_RESTRICTION:'||request.id::text,updated_at=now()
    where id=contact.id;
    result:=jsonb_build_object('restricted',true,'scopes',array['MARKETING','EXPORT','COMMUNICATION']);
  elsif request.request_type='DELETION' then
    legal_hold_manifest:=jsonb_build_object(
      'studentRecords',coalesce((scope->>'studentRecords')::integer,0),
      'activities',coalesce((scope->>'activities')::integer,0),
      'reason','Statutory education, transaction, security, and audit records remain pseudonymized when retention is required.'
    );
    update public.contact_consents set status='REVOKED',revoked_at=now(),updated_by=reviewer,updated_at=now()
      where workspace_id=request.workspace_id and contact_id=contact.id and status='GRANTED';
    delete from public.household_members where workspace_id=request.workspace_id and contact_id=contact.id;
    delete from public.student_guardian_relationships where workspace_id=request.workspace_id and guardian_contact_id=contact.id;
    update public.opportunities set primary_contact_id=null,updated_at=now()
      where workspace_id=request.workspace_id and primary_contact_id=contact.id;
    update public.appointment_attendees set contact_id=null
      where workspace_id=request.workspace_id and contact_id=contact.id;
    update public.crm_activities set contact_id=null,updated_at=now()
      where workspace_id=request.workspace_id and contact_id=contact.id;
    update public.contacts set
      organization_id=null,name_zh='已删除联系人',name_en='Deleted contact',email=null,
      phone=null,title='',status='PROTECTED',completeness=0,do_not_contact=true,
      do_not_contact_reason='PRIVACY_DELETION:'||request.id::text,last_interaction_at=null,updated_at=now()
    where id=contact.id;
    insert into public.privacy_restrictions(
      workspace_id,contact_id,request_id,reason,created_by
    ) values(request.workspace_id,contact.id,request.id,'PRIVACY_DELETION',reviewer)
    on conflict(workspace_id,contact_id) do update set
      request_id=excluded.request_id,reason=excluded.reason,active=true,
      starts_at=now(),ends_at=null,updated_at=now();
    result:=jsonb_build_object('anonymized',true,'detachedRelationships',jsonb_build_object(
      'householdMemberships',scope->'householdMemberships','guardianRelationships',scope->'guardianRelationships',
      'opportunities',scope->'opportunities','appointments',scope->'appointments'
    ));
  else
    raise exception 'privacy_execution_type_invalid';
  end if;

  update public.privacy_executions set
    status='COMPLETED',result_summary=result,legal_hold=legal_hold_manifest,
    receipt_sha256=encode(extensions.digest(
      request.id::text||request.request_type||scope::text||result::text||legal_hold_manifest::text||completed_at_value::text,
      'sha256'
    ),'hex'),completed_at=completed_at_value,updated_at=now()
  where id=execution.id;
  update public.privacy_requests set
    status='FULFILLED',fulfilled_at=completed_at_value,assigned_to=reviewer,updated_at=now()
  where id=request.id returning * into request;
  return request;
end;
$$;

create or replace function public.complete_privacy_export_execution(
  target_request uuid,target_job uuid,object_path text,artifact_expires_at timestamptz,
  exported_rows integer,artifact_sha256 text
)
returns void
language plpgsql security definer set search_path=public
as $$
declare execution public.privacy_executions;
begin
  if auth.role()<>'service_role' or exported_rows<1 or artifact_sha256!~'^[a-f0-9]{64}$' then
    raise exception 'privacy_export_completion_invalid';
  end if;
  select * into execution from public.privacy_executions
    where request_id=target_request and generated_job_id=target_job and status in ('QUEUED','PROCESSING') for update;
  if not found or not exists(select 1 from public.generated_jobs where id=target_job and privacy_request_id=target_request and status='READY') then
    raise exception 'privacy_export_execution_not_found';
  end if;
  update public.privacy_executions set
    status='COMPLETED',artifact_path=object_path,artifact_expires_at=artifact_expires_at,
    exported_row_count=exported_rows,receipt_sha256=artifact_sha256,
    result_summary=jsonb_build_object('artifactReady',true,'exportedRows',exported_rows,'format','XLSX'),
    completed_at=now(),updated_at=now()
  where id=execution.id;
  update public.privacy_requests set status='FULFILLED',fulfilled_at=now(),updated_at=now()
    where id=target_request and status='EXECUTING';
end;
$$;

create or replace function public.fail_privacy_export_execution(
  target_request uuid,target_job uuid,failure text
)
returns void
language plpgsql security definer set search_path=public
as $$
begin
  if auth.role()<>'service_role' then raise exception 'privacy_export_completion_invalid'; end if;
  update public.privacy_executions set status='FAILED',failure_code='PRIVACY_EXPORT_FAILED',
    failure_detail=left(coalesce(failure,'UNKNOWN'),500),updated_at=now()
  where request_id=target_request and generated_job_id=target_job and status in ('QUEUED','PROCESSING');
  update public.privacy_requests set status='EXECUTION_FAILED',updated_at=now()
    where id=target_request and status='EXECUTING';
end;
$$;

create or replace function public.manage_privacy_request(
  target_request uuid,next_status text,identity_result text,decision text
) returns public.privacy_requests
language plpgsql security definer set search_path=public
as $$
declare
  request_row public.privacy_requests;
  normalized_status text:=upper(trim(coalesce(next_status,'')));
  normalized_identity text:=upper(trim(coalesce(identity_result,'')));
  normalized_decision text:=nullif(trim(coalesce(decision,'')),'');
  actor_role text:=public.current_crm_role();
  created_task uuid;
begin
  if actor_role not in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR') then raise exception 'privacy_management_forbidden'; end if;
  if normalized_identity not in ('PENDING','VERIFIED','FAILED') then raise exception 'privacy_identity_invalid'; end if;
  if normalized_decision is null then raise exception 'privacy_decision_note_required'; end if;
  select * into request_row from public.privacy_requests
    where id=target_request and workspace_id=public.current_workspace_id() for update;
  if not found then raise exception 'privacy_request_not_found'; end if;
  if not (
    (request_row.status='RECEIVED' and normalized_status in ('IDENTITY_REVIEW','CANCELLED'))
    or (request_row.status='IDENTITY_REVIEW' and normalized_status in ('IN_PROGRESS','REJECTED','CANCELLED'))
    or (request_row.status='IN_PROGRESS' and normalized_status in ('WAITING_APPROVAL','FULFILLED','REJECTED','CANCELLED'))
    or (request_row.status='WAITING_APPROVAL' and normalized_status in ('FULFILLED','REJECTED'))
    or (request_row.status='EXECUTION_FAILED' and normalized_status in ('IN_PROGRESS','REJECTED','CANCELLED'))
  ) then raise exception 'privacy_transition_invalid'; end if;
  if normalized_status in ('IN_PROGRESS','WAITING_APPROVAL','FULFILLED') and normalized_identity<>'VERIFIED' then
    raise exception 'privacy_identity_verification_required';
  end if;
  if request_row.request_type in ('EXPORT','DELETION') then
    if request_row.status='IN_PROGRESS' and normalized_status='FULFILLED' then raise exception 'privacy_approval_required'; end if;
    if request_row.status='IN_PROGRESS' and normalized_status='WAITING_APPROVAL' then
      insert into public.crm_tasks(workspace_id,title_zh,title_en,related_type,related_id,related_label,status,priority,owner_id,due_at,created_by)
      values(request_row.workspace_id,case request_row.request_type when 'EXPORT' then '复核隐私数据导出' else '复核隐私删除请求' end,case request_row.request_type when 'EXPORT' then 'Review privacy data export' else 'Review privacy deletion request' end,'PRIVACY_REQUEST',request_row.id,request_row.request_type,'WAITING_APPROVAL','URGENT',null,request_row.due_at,auth.uid())
      returning id into created_task;
    elsif request_row.status='WAITING_APPROVAL' and normalized_status='FULFILLED' then
      if request_row.assigned_to=auth.uid() then raise exception 'privacy_second_reviewer_required'; end if;
      if request_row.execution_task_id is null then raise exception 'privacy_approval_task_missing'; end if;
      update public.crm_tasks set status='DONE',completed_at=now(),updated_at=now(),owner_id=auth.uid()
        where id=request_row.execution_task_id and workspace_id=request_row.workspace_id;
    end if;
  elsif normalized_status='WAITING_APPROVAL' then raise exception 'privacy_approval_not_required'; end if;

  update public.privacy_requests set
    identity_status=normalized_identity,decision_note=normalized_decision,
    assigned_to=case when normalized_status='WAITING_APPROVAL' then auth.uid() when normalized_status in ('FULFILLED','REJECTED','CANCELLED') then assigned_to else auth.uid() end,
    execution_task_id=coalesce(created_task,execution_task_id),updated_at=now()
  where id=request_row.id returning * into request_row;
  if normalized_status='FULFILLED' then return public.start_privacy_execution(request_row.id,auth.uid()); end if;
  if normalized_status='REJECTED' and request_row.execution_task_id is not null then
    update public.crm_tasks set status='DONE',completed_at=now(),updated_at=now(),owner_id=auth.uid()
      where id=request_row.execution_task_id and workspace_id=request_row.workspace_id;
  end if;
  update public.privacy_requests set status=normalized_status,
    fulfilled_at=case when normalized_status='FULFILLED' then now() else fulfilled_at end,updated_at=now()
  where id=request_row.id returning * into request_row;
  return request_row;
end;
$$;

create or replace function public.contact_channel_allowed(target_contact uuid,target_channel text,target_purpose text)
returns boolean language sql stable security definer set search_path=public
as $$
  select exists(
    select 1 from public.contacts c
    join public.contact_consents cc on cc.contact_id=c.id and cc.workspace_id=c.workspace_id
    where c.id=target_contact and c.workspace_id=public.current_workspace_id() and not c.do_not_contact
      and not exists(select 1 from public.privacy_restrictions restriction
        where restriction.workspace_id=c.workspace_id and restriction.contact_id=c.id
          and restriction.active and (restriction.ends_at is null or restriction.ends_at>now())
          and ('COMMUNICATION'=any(restriction.scopes) or upper(target_purpose)=any(restriction.scopes)))
      and cc.channel=upper(target_channel) and cc.purpose=upper(target_purpose) and cc.status='GRANTED'
      and (cc.retention_until is null or cc.retention_until>=current_date)
  );
$$;

create or replace function public.marketing_export_rows(target_workspace uuid,export_channel text)
returns table(contact_id uuid,name_zh text,name_en text,email text,phone text,channel text,consent_source text,obtained_at timestamptz,retention_until date)
language sql stable security definer set search_path=public
as $$
  select c.id,c.name_zh,c.name_en,c.email::text,c.phone,cc.channel,cc.source,cc.obtained_at,cc.retention_until
  from public.contacts c join public.contact_consents cc on cc.contact_id=c.id and cc.workspace_id=c.workspace_id
  where c.workspace_id=target_workspace and not c.do_not_contact
    and not exists(select 1 from public.privacy_restrictions restriction
      where restriction.workspace_id=c.workspace_id and restriction.contact_id=c.id
        and restriction.active and (restriction.ends_at is null or restriction.ends_at>now())
        and ('MARKETING'=any(restriction.scopes) or 'EXPORT'=any(restriction.scopes)))
    and cc.channel=upper(export_channel) and cc.purpose='MARKETING' and cc.status='GRANTED'
    and (cc.retention_until is null or cc.retention_until>=current_date)
  order by c.name_en,c.id;
$$;

revoke all on function public.privacy_scope_snapshot(uuid,uuid),
  public.start_privacy_execution(uuid,uuid),
  public.complete_privacy_export_execution(uuid,uuid,text,timestamptz,integer,text),
  public.fail_privacy_export_execution(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.complete_privacy_export_execution(uuid,uuid,text,timestamptz,integer,text),
  public.fail_privacy_export_execution(uuid,uuid,text) to service_role;
revoke all on function public.manage_privacy_request(uuid,text,text,text) from public,anon;
grant execute on function public.manage_privacy_request(uuid,text,text,text) to authenticated;

drop trigger if exists audit_privacy_executions on public.privacy_executions;
create trigger audit_privacy_executions after insert or update or delete on public.privacy_executions
for each row execute procedure public.audit_row_change();
drop trigger if exists audit_privacy_restrictions on public.privacy_restrictions;
create trigger audit_privacy_restrictions after insert or update or delete on public.privacy_restrictions
for each row execute procedure public.audit_row_change();

notify pgrst,'reload schema';
