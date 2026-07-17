-- v0.9.0: trustworthy metrics, explainable access, operational queues,
-- renewal playbooks, guarded pipeline stages, merge previews, integrations,
-- exchange-rate snapshots and rules-first next best actions.

-- ---------------------------------------------------------------------------
-- Trustworthy relationship health and permission explanations
-- ---------------------------------------------------------------------------

create or replace function public.workspace_relationship_health()
returns jsonb
language plpgsql
stable
security definer
set search_path=public
as $$
declare
  total_organizations integer;
  current_milestones integer;
  previous_milestones integer;
  current_score numeric;
  previous_score numeric;
begin
  select count(*) into total_organizations
  from public.organizations o
  where o.workspace_id=public.current_workspace_id()
    and public.can_access_owned_record(o.workspace_id,'ORGANIZATION',o.id,o.owner_id,false);

  if total_organizations=0 then
    return jsonb_build_object(
      'hasData',false,'score',null,'weeklyDelta',null,'sampleSize',0,
      'basis','RELATIONSHIP_MILESTONES'
    );
  end if;

  select count(*) into current_milestones
  from public.relationship_milestones r
  join public.organizations o on o.id=r.organization_id and o.workspace_id=r.workspace_id
  where r.workspace_id=public.current_workspace_id()
    and r.evidence_status<>'REJECTED'
    and public.can_access_owned_record(o.workspace_id,'ORGANIZATION',o.id,o.owner_id,false);

  select count(*) into previous_milestones
  from public.relationship_milestones r
  join public.organizations o on o.id=r.organization_id and o.workspace_id=r.workspace_id
  where r.workspace_id=public.current_workspace_id()
    and r.evidence_status<>'REJECTED'
    and r.achieved_at<now()-interval '7 days'
    and public.can_access_owned_record(o.workspace_id,'ORGANIZATION',o.id,o.owner_id,false);

  current_score:=round(100.0*current_milestones/(total_organizations*4),1);
  previous_score:=round(100.0*previous_milestones/(total_organizations*4),1);
  return jsonb_build_object(
    'hasData',true,
    'score',current_score,
    'weeklyDelta',round(current_score-previous_score,1),
    'sampleSize',total_organizations,
    'achievedMilestones',current_milestones,
    'possibleMilestones',total_organizations*4,
    'basis','RELATIONSHIP_MILESTONES'
  );
end;
$$;

create or replace function public.explain_record_access(resource_type text,resource_id uuid,requested_action text default 'READ')
returns jsonb
language plpgsql
stable
security definer
set search_path=public
as $$
declare
  ws uuid:=public.current_workspace_id();
  normalized_type text:=upper(trim(resource_type));
  needs_edit boolean:=upper(trim(requested_action))<>'READ';
  target_owner uuid;
  target_status text;
  allowed boolean:=false;
  actor_role text:=public.current_crm_role();
  explanation text;
begin
  if ws is null or actor_role='' then raise exception 'permission_explanation_not_authorized'; end if;
  if normalized_type='ORGANIZATION' then
    select owner_id,status into target_owner,target_status from public.organizations where id=resource_id and workspace_id=ws;
  elsif normalized_type='CONTACT' then
    select owner_id,status into target_owner,target_status from public.contacts where id=resource_id and workspace_id=ws;
  elsif normalized_type='OPPORTUNITY' then
    select owner_id,stage into target_owner,target_status from public.opportunities where id=resource_id and workspace_id=ws;
  elsif normalized_type='CONTRACT' then
    select owner_id,status into target_owner,target_status from public.contracts where id=resource_id and workspace_id=ws;
  elsif normalized_type='APPOINTMENT' then
    select owner_id,status into target_owner,target_status from public.appointments where id=resource_id and workspace_id=ws;
  elsif normalized_type='TASK' then
    select owner_id,status into target_owner,target_status from public.crm_tasks where id=resource_id and workspace_id=ws;
  elsif normalized_type='QUOTE' then
    select owner_id,status into target_owner,target_status from public.quotes where id=resource_id and workspace_id=ws;
  else
    raise exception 'permission_explanation_invalid_resource';
  end if;

  if not found then
    return jsonb_build_object(
      'exists',false,'allowed',false,'resourceType',normalized_type,
      'resourceId',resource_id,'action',upper(requested_action),
      'reason','RECORD_NOT_FOUND_IN_WORKSPACE','role',actor_role
    );
  end if;

  allowed:=public.can_access_owned_record(ws,normalized_type,resource_id,target_owner,needs_edit);
  explanation:=case
    when actor_role in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR') then 'ROLE_SCOPE'
    when target_owner=auth.uid() then 'RECORD_OWNER'
    when exists(
      select 1 from public.record_collaborators c
      where c.workspace_id=ws and c.resource_type=normalized_type
        and c.resource_id=$2 and c.user_id=auth.uid()
        and (not needs_edit or c.access_level='EDIT')
    ) then 'EXPLICIT_COLLABORATOR'
    when allowed then 'TEAM_HIERARCHY'
    else 'OUTSIDE_ROLE_TEAM_OWNER_SCOPE'
  end;
  return jsonb_build_object(
    'exists',true,'allowed',allowed,'resourceType',normalized_type,
    'resourceId',resource_id,'action',upper(requested_action),'reason',explanation,
    'role',actor_role,'isOwner',target_owner=auth.uid(),'status',target_status,
    'mfaLevel',coalesce(auth.jwt()->>'aal','aal1'),'workspaceId',ws
  );
end;
$$;

revoke all on function public.workspace_relationship_health(),
  public.explain_record_access(text,uuid,text) from public,anon;
grant execute on function public.workspace_relationship_health(),
  public.explain_record_access(text,uuid,text) to authenticated;

-- ---------------------------------------------------------------------------
-- Customer activity composer
-- ---------------------------------------------------------------------------

alter table public.crm_activities drop constraint if exists crm_activities_activity_type_check;
alter table public.crm_activities add constraint crm_activities_activity_type_check
  check(activity_type in ('CALL','EMAIL','MEETING','VISIT','MEAL','NOTE','CAMPAIGN','PAYMENT_FOLLOW_UP'));

create or replace function public.record_customer_activity(
  target_organization uuid,target_contact uuid,target_opportunity uuid,
  activity_kind text,occurred timestamptz,summary_zh text,summary_en text,
  next_step_zh text,next_step_en text
)
returns public.crm_activities
language plpgsql
security definer
set search_path=public
as $$
declare
  organization public.organizations;
  result public.crm_activities;
begin
  select * into organization from public.organizations
    where id=target_organization and workspace_id=public.current_workspace_id();
  if not found
    or not public.can_access_owned_record(organization.workspace_id,'ORGANIZATION',organization.id,organization.owner_id,true) then
    raise exception 'activity_not_authorized';
  end if;
  if upper(activity_kind) not in ('CALL','EMAIL','MEETING','VISIT','MEAL','NOTE','CAMPAIGN','PAYMENT_FOLLOW_UP')
    or nullif(trim(summary_zh),'') is null or nullif(trim(summary_en),'') is null
    or nullif(trim(next_step_zh),'') is null or nullif(trim(next_step_en),'') is null
    or occurred>now()+interval '5 minutes' then
    raise exception 'activity_invalid';
  end if;
  if target_contact is not null then
    perform 1 from public.contacts
      where id=target_contact and workspace_id=organization.workspace_id
        and organization_id=organization.id;
    if not found then raise exception 'activity_contact_invalid'; end if;
  end if;
  if target_opportunity is not null then
    perform 1 from public.opportunities
      where id=target_opportunity and workspace_id=organization.workspace_id
        and organization_id=organization.id;
    if not found then raise exception 'activity_opportunity_invalid'; end if;
  end if;
  insert into public.crm_activities(
    workspace_id,organization_id,contact_id,opportunity_id,activity_type,occurred_at,
    summary_zh,summary_en,next_step_zh,next_step_en,owner_id,created_by
  ) values(
    organization.workspace_id,organization.id,target_contact,target_opportunity,upper(activity_kind),
    coalesce(occurred,now()),trim(summary_zh),trim(summary_en),trim(next_step_zh),trim(next_step_en),
    auth.uid(),auth.uid()
  ) returning * into result;
  update public.organizations set last_contact_at=result.occurred_at,updated_at=now()
    where id=organization.id;
  if target_contact is not null then
    update public.contacts set last_interaction_at=result.occurred_at,updated_at=now()
      where id=target_contact;
  end if;
  if target_opportunity is not null then
    update public.opportunities set last_activity_at=result.occurred_at,updated_at=now()
      where id=target_opportunity;
  end if;
  return result;
end;
$$;

revoke insert on public.crm_activities from authenticated;
revoke all on function public.record_customer_activity(uuid,uuid,uuid,text,timestamptz,text,text,text,text)
  from public,anon;
grant execute on function public.record_customer_activity(uuid,uuid,uuid,text,timestamptz,text,text,text,text)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Renewal playbooks
-- ---------------------------------------------------------------------------

create table if not exists public.contract_renewal_playbooks(
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  contract_id uuid not null,
  stage text not null default 'NOT_STARTED'
    check(stage in ('NOT_STARTED','DISCOVERY','PROPOSAL','NEGOTIATION','COMMITTED','RENEWED','LOST')),
  risk_level text not null default 'MEDIUM' check(risk_level in ('LOW','MEDIUM','HIGH')),
  next_action_zh text not null,
  next_action_en text not null,
  due_at timestamptz not null,
  owner_id uuid not null references auth.users(id),
  outcome_reason text not null default '',
  created_by uuid not null references auth.users(id),
  updated_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(workspace_id,contract_id),
  foreign key(workspace_id,contract_id) references public.contracts(workspace_id,id)
);
create index if not exists contract_renewal_playbooks_due_idx
  on public.contract_renewal_playbooks(workspace_id,stage,due_at);
alter table public.contract_renewal_playbooks enable row level security;
create policy "renewal playbooks follow contract scope"
  on public.contract_renewal_playbooks for select to authenticated
  using(exists(
    select 1 from public.contracts c where c.id=contract_id
      and public.can_access_owned_record(c.workspace_id,'CONTRACT',c.id,c.owner_id,false)
  ));

create or replace function public.save_renewal_playbook(
  target_contract uuid,playbook_stage text,risk text,
  action_zh text,action_en text,action_due timestamptz,outcome text default ''
)
returns public.contract_renewal_playbooks
language plpgsql
security definer
set search_path=public
as $$
declare contract public.contracts;result public.contract_renewal_playbooks;
begin
  select * into contract from public.contracts
    where id=target_contract and workspace_id=public.current_workspace_id();
  if not found
    or not public.can_access_owned_record(contract.workspace_id,'CONTRACT',contract.id,contract.owner_id,true) then
    raise exception 'renewal_playbook_not_authorized';
  end if;
  if upper(playbook_stage) not in ('NOT_STARTED','DISCOVERY','PROPOSAL','NEGOTIATION','COMMITTED','RENEWED','LOST')
    or upper(risk) not in ('LOW','MEDIUM','HIGH')
    or nullif(trim(action_zh),'') is null or nullif(trim(action_en),'') is null then
    raise exception 'renewal_playbook_invalid';
  end if;
  if upper(playbook_stage) in ('RENEWED','LOST') and nullif(trim(outcome),'') is null then
    raise exception 'renewal_outcome_required';
  end if;
  insert into public.contract_renewal_playbooks(
    workspace_id,contract_id,stage,risk_level,next_action_zh,next_action_en,due_at,
    owner_id,outcome_reason,created_by,updated_by
  ) values(
    contract.workspace_id,contract.id,upper(playbook_stage),upper(risk),trim(action_zh),trim(action_en),
    action_due,coalesce(contract.owner_id,auth.uid()),trim(coalesce(outcome,'')),auth.uid(),auth.uid()
  ) on conflict(workspace_id,contract_id) do update set
    stage=excluded.stage,risk_level=excluded.risk_level,next_action_zh=excluded.next_action_zh,
    next_action_en=excluded.next_action_en,due_at=excluded.due_at,
    outcome_reason=excluded.outcome_reason,updated_by=auth.uid(),updated_at=now()
  returning * into result;
  return result;
end;
$$;

grant select on public.contract_renewal_playbooks to authenticated;
revoke all on function public.save_renewal_playbook(uuid,text,text,text,text,timestamptz,text)
  from public,anon;
grant execute on function public.save_renewal_playbook(uuid,text,text,text,text,timestamptz,text)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Guarded opportunity stages and history
-- ---------------------------------------------------------------------------

alter table public.opportunities add column if not exists won_evidence text not null default '';

create table if not exists public.opportunity_stage_history(
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  opportunity_id uuid not null,
  from_stage text not null,
  to_stage text not null,
  reason text not null default '',
  evidence text not null default '',
  changed_by uuid not null references auth.users(id),
  changed_at timestamptz not null default now(),
  foreign key(workspace_id,opportunity_id) references public.opportunities(workspace_id,id)
);
create index if not exists opportunity_stage_history_timeline_idx
  on public.opportunity_stage_history(workspace_id,opportunity_id,changed_at desc);
alter table public.opportunity_stage_history enable row level security;
create policy "opportunity history follows opportunity scope"
  on public.opportunity_stage_history for select to authenticated
  using(exists(
    select 1 from public.opportunities o where o.id=opportunity_id
      and public.can_access_owned_record(o.workspace_id,'OPPORTUNITY',o.id,o.owner_id,false)
  ));

create or replace function public.enforce_opportunity_business_rules()
returns trigger
language plpgsql
set search_path=public
as $$
begin
  if new.stage not in ('WON','LOST') then
    if nullif(trim(new.next_action_zh),'') is null
      or nullif(trim(new.next_action_en),'') is null
      or new.expected_close_date is null then
      raise exception 'opportunity_next_action_required';
    end if;
    new.closed_at:=null;
    new.lost_reason:=null;
    new.won_evidence:='';
  elsif new.stage='WON' and nullif(trim(new.won_evidence),'') is null then
    raise exception 'opportunity_won_evidence_required';
  elsif new.stage='LOST' and nullif(trim(new.lost_reason),'') is null then
    raise exception 'opportunity_lost_reason_required';
  end if;
  return new;
end;
$$;
drop trigger if exists opportunity_business_rules on public.opportunities;
create trigger opportunity_business_rules
before insert or update of stage,expected_close_date,next_action_zh,next_action_en,lost_reason,won_evidence
on public.opportunities for each row execute procedure public.enforce_opportunity_business_rules();

create or replace function public.change_opportunity_stage(
  target_opportunity uuid,next_stage text,next_probability integer,
  next_expected_close date,next_action_zh text,next_action_en text,
  stage_reason text default '',stage_evidence text default ''
)
returns public.opportunities
language plpgsql
security definer
set search_path=public
as $$
declare current public.opportunities;result public.opportunities;normalized_stage text:=upper(next_stage);
begin
  select * into current from public.opportunities
    where id=target_opportunity and workspace_id=public.current_workspace_id() for update;
  if not found
    or not public.can_access_owned_record(current.workspace_id,'OPPORTUNITY',current.id,current.owner_id,true) then
    raise exception 'opportunity_not_authorized';
  end if;
  if normalized_stage not in ('DISCOVERY','EVALUATION','HESITATION','PAYMENT','WON','LOST')
    or next_probability not between 0 and 100 then
    raise exception 'opportunity_stage_invalid';
  end if;
  if normalized_stage='WON' and next_probability<>100 then raise exception 'opportunity_probability_invalid'; end if;
  if normalized_stage='LOST' and next_probability<>0 then raise exception 'opportunity_probability_invalid'; end if;
  update public.opportunities set
    stage=normalized_stage,probability=next_probability,
    expected_close_date=case when normalized_stage in ('WON','LOST') then current.expected_close_date else next_expected_close end,
    next_action_zh=case when normalized_stage in ('WON','LOST') then current.next_action_zh else trim($5) end,
    next_action_en=case when normalized_stage in ('WON','LOST') then current.next_action_en else trim($6) end,
    lost_reason=case when normalized_stage='LOST' then trim(stage_reason) else null end,
    won_evidence=case when normalized_stage='WON' then trim(stage_evidence) else '' end,
    closed_at=case when normalized_stage in ('WON','LOST') then now() else null end,
    updated_at=now()
  where id=current.id returning * into result;
  insert into public.opportunity_stage_history(
    workspace_id,opportunity_id,from_stage,to_stage,reason,evidence,changed_by
  ) values(
    result.workspace_id,result.id,current.stage,result.stage,
    trim(coalesce(stage_reason,'')),trim(coalesce(stage_evidence,'')),auth.uid()
  );
  return result;
end;
$$;

revoke update on public.opportunities from authenticated;
grant select on public.opportunity_stage_history to authenticated;
revoke all on function public.change_opportunity_stage(uuid,text,integer,date,text,text,text,text)
  from public,anon;
grant execute on function public.change_opportunity_stage(uuid,text,integer,date,text,text,text,text)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Duplicate preview, controlled merge, and import dry run
-- ---------------------------------------------------------------------------

create or replace function public.duplicate_merge_preview(
  resource text,target_record uuid,source_record uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path=public
as $$
declare target_json jsonb;source_json jsonb;impact jsonb;normalized text:=upper(resource);
begin
  if target_record=source_record then raise exception 'duplicate_same_record'; end if;
  if normalized='CONTACTS' then
    select jsonb_build_object(
      'id',id,'nameZh',name_zh,'nameEn',name_en,'email',email,'phone',phone,
      'title',title,'status',status,'completeness',completeness
    ) into target_json from public.contacts c
      where c.id=target_record and c.workspace_id=public.current_workspace_id()
        and public.can_access_owned_record(c.workspace_id,'CONTACT',c.id,c.owner_id,true);
    select jsonb_build_object(
      'id',id,'nameZh',name_zh,'nameEn',name_en,'email',email,'phone',phone,
      'title',title,'status',status,'completeness',completeness
    ) into source_json from public.contacts c
      where c.id=source_record and c.workspace_id=public.current_workspace_id()
        and public.can_access_owned_record(c.workspace_id,'CONTACT',c.id,c.owner_id,true);
    select jsonb_build_object(
      'activities',(select count(*) from public.crm_activities where contact_id=source_record),
      'opportunities',(select count(*) from public.opportunities where primary_contact_id=source_record),
      'consents',(select count(*) from public.contact_consents where contact_id=source_record),
      'appointments',(select count(*) from public.appointment_attendees where contact_id=source_record)
    ) into impact;
  elsif normalized='ORGANIZATIONS' then
    select jsonb_build_object(
      'id',id,'nameZh',name_zh,'nameEn',name_en,'city',city,'curriculum',curriculum,
      'status',status,'completeness',completeness,'contactCoverage',key_contact_coverage
    ) into target_json from public.organizations o
      where o.id=target_record and o.workspace_id=public.current_workspace_id()
        and public.can_access_owned_record(o.workspace_id,'ORGANIZATION',o.id,o.owner_id,true);
    select jsonb_build_object(
      'id',id,'nameZh',name_zh,'nameEn',name_en,'city',city,'curriculum',curriculum,
      'status',status,'completeness',completeness,'contactCoverage',key_contact_coverage
    ) into source_json from public.organizations o
      where o.id=source_record and o.workspace_id=public.current_workspace_id()
        and public.can_access_owned_record(o.workspace_id,'ORGANIZATION',o.id,o.owner_id,true);
    select jsonb_build_object(
      'contacts',(select count(*) from public.contacts where organization_id=source_record),
      'opportunities',(select count(*) from public.opportunities where organization_id=source_record),
      'contracts',(select count(*) from public.contracts where organization_id=source_record),
      'activities',(select count(*) from public.crm_activities where organization_id=source_record),
      'quotes',(select count(*) from public.quotes where organization_id=source_record)
    ) into impact;
  else
    raise exception 'duplicate_resource_invalid';
  end if;
  if target_json is null or source_json is null then raise exception 'duplicate_record_not_authorized'; end if;
  return jsonb_build_object(
    'resource',normalized,'target',target_json,'source',source_json,'impact',impact,
    'recommendedMaster',case
      when coalesce((target_json->>'completeness')::integer,0)>=coalesce((source_json->>'completeness')::integer,0)
        then target_record else source_record end,
    'requiresConfirmation',true
  );
end;
$$;

create or replace function public.merge_duplicate_records(
  resource text,target_record uuid,source_record uuid,field_choices jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare
  normalized text:=upper(resource);
  target_contact public.contacts;source_contact public.contacts;
  target_org public.organizations;source_org public.organizations;
begin
  if public.current_crm_role() not in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER')
    or target_record=source_record then
    raise exception 'duplicate_merge_not_authorized';
  end if;
  if normalized='CONTACTS' then
    select * into target_contact from public.contacts
      where id=target_record and workspace_id=public.current_workspace_id() for update;
    select * into source_contact from public.contacts
      where id=source_record and workspace_id=public.current_workspace_id() for update;
    if target_contact.id is null or source_contact.id is null
      or not public.can_access_owned_record(target_contact.workspace_id,'CONTACT',target_contact.id,target_contact.owner_id,true)
      or not public.can_access_owned_record(source_contact.workspace_id,'CONTACT',source_contact.id,source_contact.owner_id,true) then
      raise exception 'duplicate_merge_not_authorized';
    end if;
    update public.crm_activities set contact_id=target_contact.id where contact_id=source_contact.id;
    update public.opportunities set primary_contact_id=target_contact.id where primary_contact_id=source_contact.id;
    update public.appointment_attendees set contact_id=target_contact.id where contact_id=source_contact.id;
    insert into public.contact_consents(
      workspace_id,contact_id,channel,purpose,status,source,evidence_note,obtained_at,revoked_at,
      retention_until,quiet_hours_start,quiet_hours_end,created_by,updated_by,created_at,updated_at
    )
    select workspace_id,target_contact.id,channel,purpose,status,source,evidence_note,obtained_at,revoked_at,
      retention_until,quiet_hours_start,quiet_hours_end,created_by,updated_by,created_at,updated_at
    from public.contact_consents where contact_id=source_contact.id
    on conflict(workspace_id,contact_id,channel,purpose) do nothing;
    delete from public.contact_consents where contact_id=source_contact.id;
    update public.crm_tasks set related_id=target_contact.id,related_label=target_contact.name_zh
      where related_type='CONTACT' and related_id=source_contact.id;
    update public.appointments set related_id=target_contact.id,related_label=target_contact.name_zh
      where related_type='CONTACT' and related_id=source_contact.id;
    delete from public.contacts where id=source_contact.id;
    update public.contacts set
      name_zh=case when field_choices->>'nameZh'='SOURCE' then source_contact.name_zh else target_contact.name_zh end,
      name_en=case when field_choices->>'nameEn'='SOURCE' then source_contact.name_en else target_contact.name_en end,
      email=case when field_choices->>'email'='SOURCE' then source_contact.email else target_contact.email end,
      phone=case when field_choices->>'phone'='SOURCE' then source_contact.phone else target_contact.phone end,
      title=case when field_choices->>'title'='SOURCE' then source_contact.title else target_contact.title end,
      completeness=greatest(target_contact.completeness,source_contact.completeness),
      updated_at=now()
    where id=target_contact.id;
  elsif normalized='ORGANIZATIONS' then
    select * into target_org from public.organizations
      where id=target_record and workspace_id=public.current_workspace_id() for update;
    select * into source_org from public.organizations
      where id=source_record and workspace_id=public.current_workspace_id() for update;
    if target_org.id is null or source_org.id is null
      or not public.can_access_owned_record(target_org.workspace_id,'ORGANIZATION',target_org.id,target_org.owner_id,true)
      or not public.can_access_owned_record(source_org.workspace_id,'ORGANIZATION',source_org.id,source_org.owner_id,true) then
      raise exception 'duplicate_merge_not_authorized';
    end if;
    update public.contacts set organization_id=target_org.id where organization_id=source_org.id;
    update public.opportunities set organization_id=target_org.id where organization_id=source_org.id;
    update public.contracts set organization_id=target_org.id where organization_id=source_org.id;
    update public.crm_activities set organization_id=target_org.id where organization_id=source_org.id;
    update public.quotes set organization_id=target_org.id where organization_id=source_org.id;
    update public.account_plans set organization_id=target_org.id where organization_id=source_org.id;
    insert into public.relationship_milestones(
      workspace_id,organization_id,milestone_type,achieved_at,evidence_note,evidence_status,
      achieved_by,verified_by,verified_at,created_at,updated_at
    )
    select workspace_id,target_org.id,milestone_type,achieved_at,evidence_note,evidence_status,
      achieved_by,verified_by,verified_at,created_at,updated_at
    from public.relationship_milestones where organization_id=source_org.id
    on conflict(workspace_id,organization_id,milestone_type) do update set
      achieved_at=greatest(relationship_milestones.achieved_at,excluded.achieved_at),
      evidence_note=case when excluded.evidence_note<>'' then excluded.evidence_note else relationship_milestones.evidence_note end,
      updated_at=now();
    delete from public.relationship_milestones where organization_id=source_org.id;
    update public.crm_tasks set related_id=target_org.id,related_label=target_org.name_zh
      where related_type='ORGANIZATION' and related_id=source_org.id;
    update public.appointments set related_id=target_org.id,related_label=target_org.name_zh
      where related_type='ORGANIZATION' and related_id=source_org.id;
    delete from public.organizations where id=source_org.id;
    update public.organizations set
      name_zh=case when field_choices->>'nameZh'='SOURCE' then source_org.name_zh else target_org.name_zh end,
      name_en=case when field_choices->>'nameEn'='SOURCE' then source_org.name_en else target_org.name_en end,
      city=case when field_choices->>'city'='SOURCE' then source_org.city else target_org.city end,
      curriculum=case when field_choices->>'curriculum'='SOURCE' then source_org.curriculum else target_org.curriculum end,
      completeness=greatest(target_org.completeness,source_org.completeness),
      key_contact_coverage=greatest(target_org.key_contact_coverage,source_org.key_contact_coverage),
      updated_at=now()
    where id=target_org.id;
  else
    raise exception 'duplicate_resource_invalid';
  end if;
  insert into public.audit_events(
    workspace_id,actor_id,entity_type,entity_id,action,after_data,request_id
  ) values(
    public.current_workspace_id(),auth.uid(),'duplicate_merge',target_record::text,'MERGE',
    jsonb_build_object('resource',normalized,'sourceId',source_record,'fieldChoices',field_choices),
    txid_current()::text
  );
  return target_record;
end;
$$;

create or replace function public.import_dry_run(target_batch uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path=public
as $$
declare batch public.import_batches;
begin
  select * into batch from public.import_batches
    where id=target_batch and workspace_id=public.current_workspace_id()
      and (created_by=auth.uid() or public.current_crm_role() in ('SUPER_ADMIN','ADMIN'));
  if not found then raise exception 'import_not_authorized'; end if;
  return jsonb_build_object(
    'batchId',batch.id,'status',batch.status,'resourceType',batch.resource_type,
    'total',(select count(*) from public.import_rows where batch_id=batch.id),
    'create',(select count(*) from public.import_rows where batch_id=batch.id and coalesce(decision,'CREATE')='CREATE' and status in ('VALID','DECIDED')),
    'update',(select count(*) from public.import_rows where batch_id=batch.id and decision='UPDATE' and status='DECIDED'),
    'merge',(select count(*) from public.import_rows where batch_id=batch.id and decision='MERGE' and status='DECIDED'),
    'skip',(select count(*) from public.import_rows where batch_id=batch.id and status='SKIPPED'),
    'invalid',(select count(*) from public.import_rows where batch_id=batch.id and status in ('INVALID','FAILED')),
    'unresolved',(select count(*) from public.import_rows where batch_id=batch.id and status='DUPLICATE'),
    'canExecute',not exists(
      select 1 from public.import_rows where batch_id=batch.id and status in ('DUPLICATE','INVALID')
    ),
    'generatedAt',now()
  );
end;
$$;

revoke all on function public.duplicate_merge_preview(text,uuid,uuid),
  public.merge_duplicate_records(text,uuid,uuid,jsonb),
  public.import_dry_run(uuid) from public,anon;
grant execute on function public.duplicate_merge_preview(text,uuid,uuid),
  public.merge_duplicate_records(text,uuid,uuid,jsonb),
  public.import_dry_run(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Worker operations and safe retries
-- ---------------------------------------------------------------------------

create table if not exists public.worker_heartbeats(
  worker_key text primary key check(worker_key in (
    'REMINDERS','NOTIFICATION_OUTBOX','CALENDAR_DELIVERIES','GENERATED_JOBS','WEBHOOK_INBOX'
  )),
  last_seen_at timestamptz not null default now(),
  last_success_at timestamptz,
  last_failure_at timestamptz,
  consecutive_failures integer not null default 0,
  last_error text,
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.worker_heartbeats enable row level security;
create policy "administrators read worker heartbeats"
  on public.worker_heartbeats for select to authenticated
  using(public.current_crm_role() in ('SUPER_ADMIN','ADMIN'));

create or replace function public.record_worker_heartbeat(
  worker text,successful boolean,failure text default null,details jsonb default '{}'::jsonb
)
returns public.worker_heartbeats
language plpgsql
security definer
set search_path=public
as $$
declare result public.worker_heartbeats;normalized text:=upper(worker);
begin
  if normalized not in ('REMINDERS','NOTIFICATION_OUTBOX','CALENDAR_DELIVERIES','GENERATED_JOBS','WEBHOOK_INBOX') then
    raise exception 'worker_key_invalid';
  end if;
  insert into public.worker_heartbeats(
    worker_key,last_seen_at,last_success_at,last_failure_at,consecutive_failures,last_error,metadata,updated_at
  ) values(
    normalized,now(),case when successful then now() end,case when not successful then now() end,
    case when successful then 0 else 1 end,
    case when successful then null else left(coalesce(failure,'UNKNOWN'),500) end,
    coalesce(details,'{}'::jsonb),now()
  ) on conflict(worker_key) do update set
    last_seen_at=now(),
    last_success_at=case when successful then now() else worker_heartbeats.last_success_at end,
    last_failure_at=case when successful then worker_heartbeats.last_failure_at else now() end,
    consecutive_failures=case when successful then 0 else worker_heartbeats.consecutive_failures+1 end,
    last_error=case when successful then null else left(coalesce(failure,'UNKNOWN'),500) end,
    metadata=coalesce(details,'{}'::jsonb),updated_at=now()
  returning * into result;
  return result;
end;
$$;

create or replace function public.operational_snapshot()
returns jsonb
language plpgsql
stable
security definer
set search_path=public
as $$
declare ws uuid:=public.current_workspace_id();
begin
  if public.current_crm_role() not in ('SUPER_ADMIN','ADMIN') or ws is null then
    raise exception 'operations_not_authorized';
  end if;
  return jsonb_build_object(
    'generatedAt',now(),
    'queues',jsonb_build_array(
      jsonb_build_object(
        'key','APPROVALS','pending',(select count(*) from public.approval_requests where workspace_id=ws and status='PENDING'),
        'failed',(select count(*) from public.approval_requests where workspace_id=ws and execution_status='FAILED'),
        'oldest',(select min(created_at) from public.approval_requests where workspace_id=ws and status='PENDING')
      ),
      jsonb_build_object(
        'key','REFUNDS','pending',(select count(*) from public.refunds where workspace_id=ws and status in ('PENDING_APPROVAL','APPROVED')),
        'failed',0,'oldest',(select min(created_at) from public.refunds where workspace_id=ws and status in ('PENDING_APPROVAL','APPROVED'))
      ),
      jsonb_build_object(
        'key','NOTIFICATION_OUTBOX','pending',(select count(*) from public.notification_outbox where workspace_id=ws and status in ('PENDING','SENDING','FAILED')),
        'failed',(select count(*) from public.notification_outbox where workspace_id=ws and status in ('FAILED','DEAD')),
        'oldest',(select min(created_at) from public.notification_outbox where workspace_id=ws and status in ('PENDING','SENDING','FAILED','DEAD'))
      ),
      jsonb_build_object(
        'key','CALENDAR_DELIVERIES','pending',(select count(*) from public.calendar_deliveries where workspace_id=ws and status in ('QUEUED','SENDING','FAILED')),
        'failed',(select count(*) from public.calendar_deliveries where workspace_id=ws and status='FAILED'),
        'oldest',(select min(created_at) from public.calendar_deliveries where workspace_id=ws and status in ('QUEUED','SENDING','FAILED'))
      ),
      jsonb_build_object(
        'key','GENERATED_JOBS','pending',(select count(*) from public.generated_jobs where workspace_id=ws and status in ('QUEUED','PROCESSING','FAILED')),
        'failed',(select count(*) from public.generated_jobs where workspace_id=ws and status='FAILED'),
        'oldest',(select min(created_at) from public.generated_jobs where workspace_id=ws and status in ('QUEUED','PROCESSING','FAILED'))
      ),
      jsonb_build_object(
        'key','IMPORTS','pending',(select count(*) from public.import_batches where workspace_id=ws and status in ('VALIDATING','NEEDS_DECISION','READY','PROCESSING','PARTIAL_FAILED')),
        'failed',(select count(*) from public.import_batches where workspace_id=ws and status='PARTIAL_FAILED'),
        'oldest',(select min(created_at) from public.import_batches where workspace_id=ws and status in ('VALIDATING','NEEDS_DECISION','READY','PROCESSING','PARTIAL_FAILED'))
      ),
      jsonb_build_object(
        'key','DATA_QUALITY','pending',(select count(*) from public.data_quality_issues where workspace_id=ws and status in ('OPEN','ASSIGNED')),
        'failed',(select count(*) from public.data_quality_issues where workspace_id=ws and status in ('OPEN','ASSIGNED') and severity='HIGH'),
        'oldest',(select min(first_seen_at) from public.data_quality_issues where workspace_id=ws and status in ('OPEN','ASSIGNED'))
      )
    ),
    'workers',coalesce((
      select jsonb_agg(jsonb_build_object(
        'key',worker_key,'lastSeenAt',last_seen_at,'lastSuccessAt',last_success_at,
        'lastFailureAt',last_failure_at,'consecutiveFailures',consecutive_failures,
        'lastError',last_error,'stale',last_seen_at<now()-interval '15 minutes',
        'metadata',metadata
      ) order by worker_key) from public.worker_heartbeats
    ),'[]'::jsonb)
  );
end;
$$;

create or replace function public.retry_operational_job(job_type text,job_id uuid)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare normalized text:=upper(job_type);
begin
  if public.current_crm_role() not in ('SUPER_ADMIN','ADMIN') then
    raise exception 'operations_not_authorized';
  end if;
  if normalized='NOTIFICATION_OUTBOX' then
    update public.notification_outbox set status='PENDING',next_attempt_at=now(),last_error=null,updated_at=now()
      where id=job_id and status in ('FAILED','DEAD');
  elsif normalized='CALENDAR_DELIVERIES' then
    update public.calendar_deliveries set status='QUEUED',available_at=now(),last_error=null,updated_at=now()
      where id=job_id and status='FAILED';
  elsif normalized='GENERATED_JOBS' then
    update public.generated_jobs set status='QUEUED',artifact_path=null,expires_at=null,updated_at=now()
      where id=job_id and status='FAILED';
  elsif normalized='REMINDERS' then
    update public.reminders set status='PENDING',scheduled_at=now(),last_error=null
      where id=job_id and status='FAILED';
  else
    raise exception 'operational_job_type_invalid';
  end if;
  if not found then raise exception 'operational_job_not_retryable'; end if;
end;
$$;

create or replace function public.operational_retryable_jobs()
returns jsonb
language plpgsql
stable
security definer
set search_path=public
as $$
declare ws uuid:=public.current_workspace_id();result jsonb;
begin
  if public.current_crm_role() not in ('SUPER_ADMIN','ADMIN') or ws is null then
    raise exception 'operations_not_authorized';
  end if;
  select coalesce(jsonb_agg(to_jsonb(j) order by j."updatedAt" desc),'[]'::jsonb)
  into result
  from (
    select id,'NOTIFICATION_OUTBOX'::text type,template_key label,status,
      coalesce(last_error,'') error,updated_at "updatedAt"
    from public.notification_outbox
    where workspace_id=ws and status in ('FAILED','DEAD')
    union all
    select id,'CALENDAR_DELIVERIES',delivery_type,status,
      coalesce(last_error,''),updated_at
    from public.calendar_deliveries
    where workspace_id=ws and status='FAILED'
    union all
    select id,'GENERATED_JOBS',job_type,status,
      coalesce(error_message,''),updated_at
    from public.generated_jobs
    where workspace_id=ws and status='FAILED'
    union all
    select id,'REMINDERS',reminder_type,status,
      coalesce(last_error,''),created_at
    from public.reminders
    where workspace_id=ws and status='FAILED'
    order by "updatedAt" desc limit 50
  ) j;
  return result;
end;
$$;

grant select on public.worker_heartbeats to authenticated;
revoke all on function public.record_worker_heartbeat(text,boolean,text,jsonb) from public,anon,authenticated;
grant execute on function public.record_worker_heartbeat(text,boolean,text,jsonb) to service_role;
revoke all on function public.operational_snapshot() from public,anon;
grant execute on function public.operational_snapshot() to authenticated;
revoke all on function public.operational_retryable_jobs() from public,anon;
grant execute on function public.operational_retryable_jobs() to authenticated;
revoke all on function public.retry_operational_job(text,uuid) from public,anon;
grant execute on function public.retry_operational_job(text,uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Integration and webhook inbox
-- ---------------------------------------------------------------------------

create table if not exists public.integration_connections(
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  provider text not null check(provider in (
    'MICROSOFT_365','GOOGLE_CALENDAR','EMAIL','E_SIGNATURE','ACCOUNTING'
  )),
  status text not null default 'DISCONNECTED'
    check(status in ('DISCONNECTED','CONNECTING','CONNECTED','DEGRADED','ACTION_REQUIRED')),
  sync_direction text not null default 'NONE'
    check(sync_direction in ('NONE','IMPORT_ONLY','EXPORT_ONLY','BIDIRECTIONAL')),
  external_account_label text not null default '',
  cursor_value text,
  last_synced_at timestamptz,
  last_error text,
  configured_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(workspace_id,provider)
);

insert into public.integration_connections(workspace_id,provider)
select w.id,p.provider
from public.workspaces w
cross join (values
  ('MICROSOFT_365'),('GOOGLE_CALENDAR'),('EMAIL'),('E_SIGNATURE'),('ACCOUNTING')
) p(provider)
on conflict(workspace_id,provider) do nothing;

create table if not exists public.webhook_inbox(
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  provider text not null,
  event_id text not null,
  event_type text not null,
  payload jsonb not null,
  signature_digest text not null,
  status text not null default 'RECEIVED'
    check(status in ('RECEIVED','PROCESSING','PROCESSED','FAILED','DEAD')),
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  last_error text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  updated_at timestamptz not null default now(),
  unique(workspace_id,provider,event_id)
);
create index if not exists webhook_inbox_queue_idx
  on public.webhook_inbox(status,available_at,received_at);

alter table public.integration_connections enable row level security;
alter table public.webhook_inbox enable row level security;
create policy "leaders read integrations" on public.integration_connections for select to authenticated
  using(public.is_workspace_member(workspace_id)
    and public.current_crm_role() in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR'));
create policy "administrators read webhook inbox" on public.webhook_inbox for select to authenticated
  using(public.is_workspace_member(workspace_id)
    and public.current_crm_role() in ('SUPER_ADMIN','ADMIN'));

create or replace function public.claim_webhook_events(batch_size integer default 20)
returns setof public.webhook_inbox
language plpgsql
security definer
set search_path=public
as $$
begin
  return query
  with claimed as (
    select id from public.webhook_inbox
    where status in ('RECEIVED','FAILED') and available_at<=now() and attempts<8
    order by received_at for update skip locked limit greatest(1,least(batch_size,100))
  )
  update public.webhook_inbox w set status='PROCESSING',attempts=w.attempts+1,updated_at=now()
  from claimed where w.id=claimed.id returning w.*;
end;
$$;
create or replace function public.complete_webhook_event(target_event uuid)
returns void language sql security definer set search_path=public
as $$ update public.webhook_inbox set status='PROCESSED',processed_at=now(),last_error=null,updated_at=now() where id=target_event and status='PROCESSING'; $$;
create or replace function public.fail_webhook_event(target_event uuid,failure text)
returns void language sql security definer set search_path=public
as $$ update public.webhook_inbox set status=case when attempts>=8 then 'DEAD' else 'FAILED' end,last_error=left(failure,500),available_at=now()+make_interval(mins=>least(360,power(2,greatest(attempts,1))::integer)),updated_at=now() where id=target_event and status='PROCESSING'; $$;

grant select on public.integration_connections,public.webhook_inbox to authenticated;
revoke all on function public.claim_webhook_events(integer),
  public.complete_webhook_event(uuid),public.fail_webhook_event(uuid,text)
  from public,anon,authenticated;
grant execute on function public.claim_webhook_events(integer),
  public.complete_webhook_event(uuid),public.fail_webhook_event(uuid,text)
  to service_role;

-- ---------------------------------------------------------------------------
-- Product bundles and locked exchange-rate snapshots
-- ---------------------------------------------------------------------------

create table if not exists public.product_bundles(
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  code citext not null,
  name_zh text not null,
  name_en text not null,
  active boolean not null default true,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(workspace_id,code)
);
create table if not exists public.product_bundle_items(
  bundle_id uuid not null references public.product_bundles(id) on delete cascade,
  product_id uuid not null references public.products(id),
  quantity numeric(10,2) not null default 1 check(quantity>0),
  optional boolean not null default false,
  discount_ceiling numeric(5,2) not null default 0 check(discount_ceiling between 0 and 100),
  primary key(bundle_id,product_id)
);
create table if not exists public.exchange_rate_snapshots(
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  base_currency text not null check(base_currency~'^[A-Z]{3}$'),
  quote_currency text not null check(quote_currency~'^[A-Z]{3}$'),
  rate numeric(20,8) not null check(rate>0),
  source text not null,
  effective_at timestamptz not null,
  locked_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique(workspace_id,base_currency,quote_currency,effective_at),
  check(base_currency<>quote_currency)
);
create index if not exists exchange_rate_lookup_idx
  on public.exchange_rate_snapshots(workspace_id,base_currency,quote_currency,effective_at desc);

alter table public.product_bundles enable row level security;
alter table public.product_bundle_items enable row level security;
alter table public.exchange_rate_snapshots enable row level security;
create policy "members read product bundles" on public.product_bundles for select to authenticated
  using(public.is_workspace_member(workspace_id));
create policy "members read product bundle items" on public.product_bundle_items for select to authenticated
  using(exists(select 1 from public.product_bundles b where b.id=bundle_id and public.is_workspace_member(b.workspace_id)));
create policy "members read exchange rate snapshots" on public.exchange_rate_snapshots for select to authenticated
  using(public.is_workspace_member(workspace_id));

create or replace function public.create_product_bundle(
  bundle_code text,bundle_name_zh text,bundle_name_en text,bundle_items jsonb
)
returns public.product_bundles
language plpgsql
security definer
set search_path=public
as $$
declare
  ws uuid:=public.current_workspace_id();
  result public.product_bundles;
  item jsonb;
  product public.products;
  quantity_value numeric;
  ceiling_value numeric;
begin
  if auth.uid() is null
    or public.current_crm_role() not in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR')
    or ws is null
    or upper(trim(bundle_code))!~'^[A-Z0-9-]{2,40}$'
    or char_length(trim(bundle_name_zh)) not between 2 and 100
    or char_length(trim(bundle_name_en)) not between 2 and 120
    or jsonb_typeof(bundle_items)<>'array'
    or jsonb_array_length(bundle_items) not between 1 and 50 then
    raise exception 'product_bundle_invalid';
  end if;

  insert into public.product_bundles(
    workspace_id,code,name_zh,name_en,created_by
  ) values(
    ws,upper(trim(bundle_code)),trim(bundle_name_zh),trim(bundle_name_en),auth.uid()
  ) returning * into result;

  for item in select value from jsonb_array_elements(bundle_items) loop
    quantity_value:=(item->>'quantity')::numeric;
    ceiling_value:=(item->>'discountCeiling')::numeric;
    select * into product from public.products
      where id=(item->>'productId')::uuid
        and workspace_id=ws and active=true;
    if not found
      or quantity_value<=0 or quantity_value>1000
      or ceiling_value<0 or ceiling_value>100
      or jsonb_typeof(item->'optional')<>'boolean' then
      raise exception 'product_bundle_item_invalid';
    end if;
    insert into public.product_bundle_items(
      bundle_id,product_id,quantity,optional,discount_ceiling
    ) values(
      result.id,product.id,quantity_value,(item->>'optional')::boolean,ceiling_value
    );
  end loop;
  return result;
exception
  when unique_violation then raise exception 'product_bundle_duplicate';
  when invalid_text_representation or numeric_value_out_of_range then
    raise exception 'product_bundle_item_invalid';
end;
$$;

create or replace function public.record_exchange_rate_snapshot(
  base text,quote text,snapshot_rate numeric,rate_source text,effective timestamptz
)
returns public.exchange_rate_snapshots
language plpgsql
security definer
set search_path=public
as $$
declare result public.exchange_rate_snapshots;
begin
  if public.current_crm_role() not in ('SUPER_ADMIN','ADMIN')
    or upper(base)!~'^[A-Z]{3}$' or upper(quote)!~'^[A-Z]{3}$'
    or upper(base)=upper(quote) or snapshot_rate<=0
    or nullif(trim(rate_source),'') is null then
    raise exception 'exchange_rate_invalid';
  end if;
  insert into public.exchange_rate_snapshots(
    workspace_id,base_currency,quote_currency,rate,source,effective_at,locked_by
  ) values(
    public.current_workspace_id(),upper(base),upper(quote),snapshot_rate,
    trim(rate_source),effective,auth.uid()
  ) returning * into result;
  return result;
end;
$$;

grant select on public.product_bundles,public.product_bundle_items to authenticated;
revoke insert,update,delete on public.product_bundles,public.product_bundle_items from authenticated;
grant select on public.exchange_rate_snapshots to authenticated;
revoke all on function public.create_product_bundle(text,text,text,jsonb),
  public.record_exchange_rate_snapshot(text,text,numeric,text,timestamptz)
  from public,anon;
grant execute on function public.create_product_bundle(text,text,text,jsonb),
  public.record_exchange_rate_snapshot(text,text,numeric,text,timestamptz)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Rules-first Next Best Action
-- ---------------------------------------------------------------------------

alter table public.crm_tasks drop constraint if exists crm_tasks_status_check;
alter table public.crm_tasks add constraint crm_tasks_status_check
  check(status in ('DRAFT','TODO','IN_PROGRESS','WAITING_APPROVAL','DONE','OVERDUE'));

create table if not exists public.next_best_actions(
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  organization_id uuid not null,
  opportunity_id uuid,
  rule_key text not null,
  rule_version text not null,
  priority text not null check(priority in ('LOW','MEDIUM','HIGH')),
  title_zh text not null,
  title_en text not null,
  rationale_zh text not null,
  rationale_en text not null,
  evidence jsonb not null,
  confidence numeric(4,3) not null check(confidence between 0 and 1),
  status text not null default 'SUGGESTED'
    check(status in ('SUGGESTED','ACCEPTED','REJECTED','EXPIRED')),
  valid_until timestamptz not null,
  decision_reason text,
  decided_by uuid references auth.users(id),
  decided_at timestamptz,
  draft_task_id uuid references public.crm_tasks(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key(workspace_id,organization_id) references public.organizations(workspace_id,id),
  foreign key(workspace_id,opportunity_id) references public.opportunities(workspace_id,id)
);
create unique index if not exists next_best_actions_one_active_rule_uidx
  on public.next_best_actions(workspace_id,organization_id,rule_key)
  where status='SUGGESTED';
create index if not exists next_best_actions_queue_idx
  on public.next_best_actions(workspace_id,status,priority,valid_until);
alter table public.next_best_actions enable row level security;
create policy "next actions follow organization scope" on public.next_best_actions for select to authenticated
  using(exists(
    select 1 from public.organizations o where o.id=organization_id
      and public.can_access_owned_record(o.workspace_id,'ORGANIZATION',o.id,o.owner_id,false)
  ));

create or replace function public.generate_next_best_actions(target_organization uuid default null)
returns integer
language plpgsql
security definer
set search_path=public
as $$
declare organization public.organizations;created_count integer:=0;
begin
  update public.next_best_actions set status='EXPIRED',updated_at=now()
    where workspace_id=public.current_workspace_id() and status='SUGGESTED' and valid_until<=now();
  for organization in
    select o.* from public.organizations o
    where o.workspace_id=public.current_workspace_id()
      and (target_organization is null or o.id=target_organization)
      and public.can_access_owned_record(o.workspace_id,'ORGANIZATION',o.id,o.owner_id,false)
  loop
    if organization.last_contact_at is null or organization.last_contact_at<now()-interval '30 days' then
      insert into public.next_best_actions(
        workspace_id,organization_id,rule_key,rule_version,priority,title_zh,title_en,
        rationale_zh,rationale_en,evidence,confidence,valid_until
      ) values(
        organization.workspace_id,organization.id,'STALE_RELATIONSHIP','rules-2026.07.1','HIGH',
        '安排客户关系回访','Schedule a relationship follow-up',
        '该客户超过 30 天没有记录有效互动。','No qualifying interaction has been recorded for more than 30 days.',
        jsonb_build_object('lastContactAt',organization.last_contact_at,'thresholdDays',30),
        0.95,now()+interval '14 days'
      ) on conflict(workspace_id,organization_id,rule_key) where status='SUGGESTED'
        do update set evidence=excluded.evidence,valid_until=excluded.valid_until,updated_at=now();
      created_count:=created_count+1;
    end if;
    if exists(
      select 1 from public.contracts c where c.organization_id=organization.id
        and c.workspace_id=organization.workspace_id
        and c.status in ('ACTIVE','RENEWAL_PREP','NEGOTIATING','RISK')
        and c.end_date between current_date and current_date+90
    ) then
      insert into public.next_best_actions(
        workspace_id,organization_id,rule_key,rule_version,priority,title_zh,title_en,
        rationale_zh,rationale_en,evidence,confidence,valid_until
      ) values(
        organization.workspace_id,organization.id,'RENEWAL_WINDOW','rules-2026.07.1','HIGH',
        '启动续约 Playbook','Start the renewal playbook',
        '该客户存在 90 天内到期且尚未关闭的合同。','An active contract expires within 90 days.',
        jsonb_build_object('windowDays',90),0.99,now()+interval '7 days'
      ) on conflict(workspace_id,organization_id,rule_key) where status='SUGGESTED'
        do update set evidence=excluded.evidence,valid_until=excluded.valid_until,updated_at=now();
      created_count:=created_count+1;
    end if;
    if exists(
      select 1 from public.opportunities o where o.organization_id=organization.id
        and o.workspace_id=organization.workspace_id and o.stage not in ('WON','LOST')
        and (o.next_action_zh='' or o.next_action_en='' or o.expected_close_date is null)
    ) then
      insert into public.next_best_actions(
        workspace_id,organization_id,rule_key,rule_version,priority,title_zh,title_en,
        rationale_zh,rationale_en,evidence,confidence,valid_until
      ) values(
        organization.workspace_id,organization.id,'PIPELINE_HYGIENE','rules-2026.07.1','MEDIUM',
        '补全商机下一步','Complete the opportunity next step',
        '开放商机缺少下一步行动或预计成交日期。','An open opportunity is missing its next action or expected close date.',
        jsonb_build_object('rule','OPEN_OPPORTUNITY_REQUIRED_FIELDS'),0.99,now()+interval '7 days'
      ) on conflict(workspace_id,organization_id,rule_key) where status='SUGGESTED'
        do update set evidence=excluded.evidence,valid_until=excluded.valid_until,updated_at=now();
      created_count:=created_count+1;
    end if;
  end loop;
  return created_count;
end;
$$;

create or replace function public.decide_next_best_action(
  target_action uuid,decision text,reason text default ''
)
returns public.next_best_actions
language plpgsql
security definer
set search_path=public
as $$
declare action public.next_best_actions;organization public.organizations;task public.crm_tasks;
begin
  select * into action from public.next_best_actions
    where id=target_action and workspace_id=public.current_workspace_id()
      and status='SUGGESTED' and valid_until>now() for update;
  if not found or upper(decision) not in ('ACCEPTED','REJECTED') then
    raise exception 'next_action_not_decidable';
  end if;
  select * into organization from public.organizations where id=action.organization_id;
  if not public.can_access_owned_record(
    organization.workspace_id,'ORGANIZATION',organization.id,organization.owner_id,true
  ) then raise exception 'next_action_not_authorized'; end if;
  if upper(decision)='REJECTED' and nullif(trim(reason),'') is null then
    raise exception 'next_action_rejection_reason_required';
  end if;
  if upper(decision)='ACCEPTED' then
    insert into public.crm_tasks(
      workspace_id,title_zh,title_en,related_type,related_id,related_label,status,
      priority,owner_id,due_at,created_by
    ) values(
      action.workspace_id,action.title_zh,action.title_en,'ORGANIZATION',organization.id,
      organization.name_zh,'DRAFT',
      case action.priority when 'HIGH' then 'HIGH' when 'MEDIUM' then 'NORMAL' else 'LOW' end,
      coalesce(organization.owner_id,auth.uid()),least(action.valid_until,now()+interval '7 days'),auth.uid()
    ) returning * into task;
  end if;
  update public.next_best_actions set
    status=upper(decision),decision_reason=nullif(trim(reason),''),
    decided_by=auth.uid(),decided_at=now(),draft_task_id=task.id,updated_at=now()
  where id=action.id returning * into action;
  return action;
end;
$$;

grant select on public.next_best_actions to authenticated;
revoke all on function public.generate_next_best_actions(uuid),
  public.decide_next_best_action(uuid,text,text) from public,anon;
grant execute on function public.generate_next_best_actions(uuid),
  public.decide_next_best_action(uuid,text,text) to authenticated;

-- Audit every new mutable business table.
do $$
declare table_name text;
begin
  foreach table_name in array array[
    'contract_renewal_playbooks','opportunity_stage_history','integration_connections',
    'product_bundles','exchange_rate_snapshots','next_best_actions'
  ] loop
    execute format('drop trigger if exists audit_%I on public.%I',table_name,table_name);
    execute format(
      'create trigger audit_%I after insert or update or delete on public.%I for each row execute procedure public.audit_row_change()',
      table_name,table_name
    );
  end loop;
end $$;
