-- Disambiguate the privacy execution legal-hold manifest variable.
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

notify pgrst,'reload schema';

