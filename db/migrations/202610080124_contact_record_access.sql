set search_path=public,app_auth,extensions;

-- Contact-only policy. Other canonical owners retain their existing governance.
create function public.contact_actor_access(ws uuid,identity uuid,owner_user uuid,actor uuid,edit boolean default false)
returns boolean language sql stable security definer set search_path=public,app_auth,extensions as $$
 select exists(select 1 from public.workspace_memberships actor_membership where actor_membership.workspace_id=ws and actor_membership.user_id=actor and actor_membership.status='ACTIVE')
 and actor is not null
 and (not edit or (select role from public.workspace_memberships where workspace_id=ws and user_id=actor and status='ACTIVE') in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER','SALES_SPECIALIST','SALES_SUPPORT'))
 and ((select role from public.workspace_memberships where workspace_id=ws and user_id=actor and status='ACTIVE')='SUPER_ADMIN'
 or (not edit and (select role from public.workspace_memberships where workspace_id=ws and user_id=actor and status='ACTIVE')='ADMIN' and exists(select 1 from public.workspace_memberships owner_membership where owner_membership.workspace_id=ws and owner_membership.user_id=owner_user and owner_membership.status='ACTIVE' and owner_membership.role not in ('ADMIN','SUPER_ADMIN')))
 or owner_user=actor
 or exists(select 1 from public.record_collaborators g where g.workspace_id=ws and g.resource_type='CONTACT' and g.resource_id=identity and g.user_id=actor and (not edit or g.access_level='EDIT'))
 or (not edit and exists(
  with recursive chain as (
   select m.id,m.manager_member_id,m.auth_user_id,tm.team_id,array[m.id] path
   from public.sales_team_members m
   join public.sales_team_memberships tm on tm.member_id=m.id and tm.workspace_id=ws and tm.status='ACTIVE'
   join public.sales_teams team on team.id=tm.team_id and team.workspace_id=ws and team.active
   join public.workspace_memberships wm on wm.workspace_id=ws and wm.user_id=m.auth_user_id and wm.status='ACTIVE'
   where m.workspace_id=ws and m.auth_user_id=owner_user and m.active
   union all
   select m.id,m.manager_member_id,m.auth_user_id,c.team_id,c.path||m.id
   from chain c join public.sales_team_members m on m.id=c.manager_member_id
   join public.sales_team_memberships tm on tm.member_id=m.id and tm.workspace_id=ws and tm.team_id=c.team_id and tm.status='ACTIVE'
   join public.workspace_memberships wm on wm.workspace_id=ws and wm.user_id=m.auth_user_id and wm.status='ACTIVE'
   where m.workspace_id=ws and m.active and not m.id=any(c.path)
  ) select 1 from chain where auth_user_id=actor
 )));
$$;
revoke all on function public.contact_actor_access(uuid,uuid,uuid,uuid,boolean) from public,crm_app,crm_system,crm_worker;
create function public.contact_owner_access(ws uuid,identity uuid,owner_user uuid,edit boolean default false)
returns boolean language sql stable security definer set search_path=public,app_auth,extensions as $$
 select ws=public.current_workspace_id() and public.contact_actor_access(ws,identity,owner_user,app_auth.current_user_id(),edit);
$$;
revoke all on function public.contact_owner_access(uuid,uuid,uuid,boolean) from public,crm_system,crm_worker;
grant execute on function public.contact_owner_access(uuid,uuid,uuid,boolean) to crm_app;

CREATE OR REPLACE FUNCTION public.can_access_owned_record(target_workspace uuid, target_type text, target_id uuid, target_owner uuid, needs_edit boolean DEFAULT false)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'app_auth', 'extensions'
AS $function$
  select case when target_type='CONTACT' then public.contact_owner_access(target_workspace,target_id,target_owner,needs_edit) else public.is_workspace_member(target_workspace) and (
    public.current_crm_role() in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR')
    or target_owner = app_auth.current_user_id()
    or exists (
      select 1
      from public.sales_team_members manager
      join public.sales_team_members report on report.manager_member_id = manager.id
      where manager.workspace_id = target_workspace
        and manager.auth_user_id = app_auth.current_user_id()
        and manager.active and report.active
        and report.auth_user_id = target_owner
    )
    or exists (
      select 1 from public.record_collaborators c
      where c.workspace_id = target_workspace
        and c.resource_type = target_type
        and c.resource_id = target_id
        and c.user_id = app_auth.current_user_id()
        and (not needs_edit or c.access_level = 'EDIT')
    )
  ) end;
$function$;

create function public.contact_record_access(identity uuid,edit boolean default false) returns boolean
language sql stable security definer set search_path=public,app_auth as $$
 select exists(select 1 from public.contacts c where c.id=identity and public.contact_owner_access(c.workspace_id,c.id,c.owner_id,edit));
$$;
revoke all on function public.contact_record_access(uuid,boolean) from public,crm_system,crm_worker;
grant execute on function public.contact_record_access(uuid,boolean) to crm_app;

-- A definer reader must not bypass Contact visibility just because its parent is visible.
create view public.contact_visible_records with(security_barrier=true) as
 select * from public.contacts c where public.contact_owner_access(c.workspace_id,c.id,c.owner_id,false);
revoke all on public.contact_visible_records from public,crm_system,crm_worker;
grant select on public.contact_visible_records to crm_app;

create policy contact_read_boundary on public.contacts as restrictive for select to crm_app
 using(public.contact_owner_access(workspace_id,id,owner_id,false));
create policy contact_delete_boundary on public.contacts as restrictive for delete to crm_app
 using(public.contact_owner_access(workspace_id,id,owner_id,true));
-- Explicit grants cannot be manufactured by the old generic leader table policy.
create policy contact_grant_write_boundary on public.record_collaborators as restrictive for insert to crm_app
 with check(resource_type<>'CONTACT');
create policy contact_grant_update_boundary on public.record_collaborators as restrictive for update to crm_app
 using(resource_type<>'CONTACT') with check(resource_type<>'CONTACT');
create policy contact_grant_delete_boundary on public.record_collaborators as restrictive for delete to crm_app
 using(resource_type<>'CONTACT');
create policy contact_grant_read_boundary on public.record_collaborators as restrictive for select to crm_app
 using(resource_type<>'CONTACT' or public.contact_record_access(resource_id,false));
create policy household_person_boundary on public.household_members as restrictive for all to crm_app
 using(public.contact_record_access(contact_id,false)) with check(public.contact_record_access(contact_id,false));
create policy student_person_boundary on public.students as restrictive for select to crm_app
 using(public.contact_record_access(person_id,false));
create policy activity_person_boundary on public.crm_activities as restrictive for select to crm_app
 using(contact_id is null or public.contact_record_access(contact_id,false));
create policy opportunity_person_boundary on public.opportunities as restrictive for select to crm_app
 using(primary_contact_id is null or public.contact_record_access(primary_contact_id,false));
create policy consent_person_boundary on public.contact_consents as restrictive for select to crm_app
 using(public.contact_record_access(contact_id,false));

CREATE OR REPLACE FUNCTION public.crm_duplicate_check(resource text, candidate_email text DEFAULT NULL::text, candidate_phone text DEFAULT NULL::text, candidate_name_zh text DEFAULT NULL::text, candidate_name_en text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'app_auth', 'extensions'
AS $function$
declare result jsonb;
begin
  if not public.is_workspace_member(public.current_workspace_id()) then raise exception 'not_authorized'; end if;
  if resource='schools' then
    select coalesce(jsonb_agg(jsonb_build_object('id',id,'nameZh',name_zh,'nameEn',name_en,'reason','NAME')), '[]'::jsonb) into result
    from public.organizations where workspace_id=public.current_workspace_id() and (lower(name_zh)=lower(coalesce(candidate_name_zh,'')) or lower(name_en)=lower(coalesce(candidate_name_en,''))) limit 10;
  elsif resource='people' then
    select coalesce(jsonb_agg(jsonb_build_object('id',id,'nameZh',name_zh,'nameEn',name_en,'reason',case when email=candidate_email::citext then 'EMAIL' when phone=candidate_phone then 'PHONE' else 'NAME' end)), '[]'::jsonb) into result
    from public.contact_visible_records where workspace_id=public.current_workspace_id() and ((candidate_email is not null and email=candidate_email::citext) or (candidate_phone is not null and phone=candidate_phone) or (lower(name_zh)=lower(coalesce(candidate_name_zh,'')) and lower(name_en)=lower(coalesce(candidate_name_en,'')))) limit 10;
  else result := '[]'::jsonb;
  end if;
  return result;
end; $function$;


CREATE OR REPLACE FUNCTION public.customer_timeline(target_organization uuid, page_number integer DEFAULT 1, page_size integer DEFAULT 20, event_types text[] DEFAULT NULL::text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'app_auth', 'extensions'
AS $function$
declare result jsonb; organization public.organizations; offset_rows integer:=greatest(0,(greatest(page_number,1)-1)*least(greatest(page_size,1),50)); limit_rows integer:=least(greatest(page_size,1),50);
begin
  select * into organization from public.organizations where id=target_organization and workspace_id=public.current_workspace_id();
  if not found or not public.can_access_owned_record(organization.workspace_id,'ORGANIZATION',organization.id,organization.owner_id,false) then raise exception 'timeline_not_authorized'; end if;
  with events as (
    select o.created_at occurred_at,'ORGANIZATION' event_type,o.id entity_id,o.name_zh title_zh,o.name_en title_en,o.status summary,jsonb_build_object('href','/schools/'||o.id) metadata from public.organizations o where o.id=organization.id
    union all select c.created_at,'CONTACT',c.id,c.name_zh,c.name_en,coalesce(c.email::text,c.phone,''),jsonb_build_object('href','/people/'||c.id) from public.contact_visible_records c where c.organization_id=organization.id
    union all select op.created_at,'OPPORTUNITY',op.id,op.title_zh,op.title_en,op.stage,jsonb_build_object('amount',op.amount,'currency',op.currency,'href','/opportunities') from public.opportunities op where op.organization_id=organization.id
    union all select t.created_at,'TASK',t.id,t.title_zh,t.title_en,t.status,jsonb_build_object('href','/tasks') from public.crm_tasks t where (t.related_type='ORGANIZATION' and t.related_id=organization.id) or (t.related_type='CONTACT' and t.related_id in (select id from public.contact_visible_records where organization_id=organization.id))
    union all select a.occurred_at,'ACTIVITY',a.id,a.summary_zh,a.summary_en,a.activity_type,jsonb_build_object('href','/schools/'||organization.id) from public.crm_activities a where a.organization_id=organization.id and (a.contact_id is null or public.contact_record_access(a.contact_id,false))
    union all select a.starts_at,'APPOINTMENT',a.id,a.title_zh,a.title_en,a.status,jsonb_build_object('href','/calendar') from public.appointments a where (a.related_type='ORGANIZATION' and a.related_id=organization.id) or (a.related_type='CONTACT' and a.related_id in (select id from public.contact_visible_records where organization_id=organization.id))
    union all select c.created_at,'CONTRACT',c.id,c.contract_number,c.contract_number,c.status,jsonb_build_object('amount',c.contract_value,'currency',c.currency,'href','/contracts') from public.contracts c where c.organization_id=organization.id
    union all select p.coalesce_paid,p.event_type,p.entity_id,p.title_zh,p.title_en,p.summary,p.metadata from (select coalesce(pay.paid_at,pay.created_at) coalesce_paid,'PAYMENT'::text event_type,pay.id entity_id,coalesce(pay.reference,'') title_zh,coalesce(pay.reference,'') title_en,pay.status summary,jsonb_build_object('amount',pay.amount,'currency',pay.currency,'href','/finance') metadata from public.payments pay join public.contracts c on c.id=pay.contract_id where c.organization_id=organization.id) p
    union all select r.achieved_at,'RELATIONSHIP',r.id,r.milestone_type,r.milestone_type,r.evidence_status,jsonb_build_object('note',r.evidence_note,'href','/sales/performance') from public.relationship_milestones r where r.organization_id=organization.id
    union all select ar.created_at,'APPROVAL',ar.id,ar.request_number,ar.request_number,ar.status,jsonb_build_object('requestType',ar.request_type,'href','/admin/approvals') from public.approval_requests ar where (ar.business_object_type='ORGANIZATION' and ar.business_object_id=organization.id::text) or (ar.business_object_type='CONTRACT' and ar.business_object_id in (select id::text from public.contracts where organization_id=organization.id)) or (ar.business_object_type='QUOTE' and ar.business_object_id in (select id::text from public.quotes where organization_id=organization.id))
  ), filtered as (select * from events where event_types is null or event_type=any(event_types))
  select jsonb_build_object('items',coalesce((select jsonb_agg(jsonb_build_object('occurredAt',occurred_at,'type',event_type,'entityId',entity_id,'titleZh',title_zh,'titleEn',title_en,'summary',summary,'metadata',metadata) order by occurred_at desc,entity_id) from (select * from filtered order by occurred_at desc,entity_id limit limit_rows offset offset_rows) page),'[]'::jsonb),'total',(select count(*) from filtered),'page',greatest(page_number,1),'pageSize',limit_rows) into result;
  return result;
end; $function$;


CREATE OR REPLACE FUNCTION public.list_students_page(search_query text, page_number integer, page_size integer, status_filter text)
 RETURNS TABLE(id uuid, person_id uuid, student_number text, current_grade text, academic_year text, status text, updated_at timestamp with time zone, name_zh text, name_en text, household_name_zh text, household_name_en text, total_count bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'app_auth', 'extensions'
AS $function$
  select
    s.id,s.person_id,s.student_number,s.current_grade,s.academic_year,s.status,s.updated_at,
    c.name_zh,c.name_en,h.name_zh,h.name_en,count(*) over()
  from public.students s
  join public.contact_visible_records c on c.id=s.person_id and c.workspace_id=s.workspace_id
  left join public.households h on h.id=s.household_id and h.workspace_id=s.workspace_id
  where s.workspace_id=public.current_workspace_id()
    and (coalesce(status_filter,'all')='all' or s.status=upper(status_filter))
    and (
      nullif(trim(coalesce(search_query,'')),'') is null
      or c.name_zh ilike '%'||trim(search_query)||'%'
      or c.name_en ilike '%'||trim(search_query)||'%'
      or coalesce(s.student_number,'') ilike '%'||trim(search_query)||'%'
    )
  order by s.updated_at desc,s.id
  limit least(greatest(coalesce(page_size,20),1),50)
  offset (greatest(coalesce(page_number,1),1)-1)*least(greatest(coalesce(page_size,20),1),50);
$function$;


CREATE OR REPLACE FUNCTION public.communication_inbox_page(search_term text DEFAULT ''::text, page_number integer DEFAULT 1, requested_page_size integer DEFAULT 20)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'app_auth', 'extensions'
AS $function$
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
    join public.contact_visible_records contact on contact.id=thread.contact_id
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
$function$;


CREATE OR REPLACE FUNCTION public.communication_thread_snapshot(target_thread uuid, requested_message_page integer DEFAULT NULL::integer, requested_message_page_size integer DEFAULT 20)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'app_auth', 'extensions'
AS $function$
declare
  thread record;
  message_items jsonb;
  message_total integer;
  message_page_size integer:=greatest(
    1,least(coalesce(requested_message_page_size,20),50)
  );
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
  join public.contact_visible_records contact on contact.id=candidate.contact_id
  where candidate.id=target_thread
    and candidate.workspace_id=public.current_workspace_id()
    and app_auth.current_user_id() is not null;
  if not found then raise exception 'communication_thread_not_found'; end if;

  select count(*)::integer into message_total
  from public.communication_messages message
  where message.thread_id=thread.id;
  message_total_pages:=greatest(
    1,ceil(message_total::numeric/message_page_size)::integer
  );
  message_page:=case
    when requested_message_page is null then message_total_pages
    else greatest(1,least(requested_message_page,message_total_pages))
  end;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',message.id,
    'direction',message.direction,
    'body',message.body,
    'deliveryStatus',message.delivery_status,
    'failureCode',coalesce(message.delivery_failure_code,''),
    'retryAllowed',message.direction='OUTBOUND'
      and message.delivery_status='FAILED'
      and message.outcome_may_have_been_accepted=false,
    'attemptCount',message.attempt_count,
    'providerAttemptCount',message.provider_attempt_count,
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
$function$;


CREATE OR REPLACE FUNCTION public.explain_record_access(resource_type text, resource_id uuid, requested_action text DEFAULT 'READ'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'app_auth', 'extensions'
AS $function$
declare
  ws uuid;
  normalized_type text:=upper(trim(resource_type));
  normalized_action text:=upper(trim(requested_action));
  needs_edit boolean;
  target_owner uuid;
  target_status text;
  allowed boolean:=false;
  actor_role text;
  explanation text;
  aal text:=coalesce(app_auth.current_claims()->>'aal','aal1');
begin
  select workspace_id,role into ws,actor_role from public.workspace_memberships
    where user_id=app_auth.current_user_id() and status='ACTIVE' order by created_at limit 1;
  if ws is null or actor_role is null then
    raise exception 'permission_explanation_not_authorized';
  end if;
  if normalized_action not in ('READ','EDIT','DELETE','APPROVE','RETRY') then
    raise exception 'permission_explanation_invalid_action';
  end if;
  needs_edit:=normalized_action<>'READ';
  if actor_role in ('SUPER_ADMIN','ADMIN') and needs_edit and aal<>'aal2' then
    return jsonb_build_object(
      'exists',null,'allowed',false,'resourceType',normalized_type,
      'resourceId',resource_id,'action',normalized_action,'reason','MFA_REQUIRED',
      'role',actor_role,'mfaLevel',aal,'requiredMfaLevel','aal2','workspaceId',ws
    );
  end if;
  if normalized_type='ORGANIZATION' then
    select owner_id,status into target_owner,target_status from public.organizations where id=resource_id and workspace_id=ws;
  elsif normalized_type='CONTACT' then
    select owner_id,status into target_owner,target_status from public.contact_visible_records where id=resource_id and workspace_id=ws;
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
  else raise exception 'permission_explanation_invalid_resource';
  end if;
  if not found then
    return jsonb_build_object(
      'exists',false,'allowed',false,'resourceType',normalized_type,
      'resourceId',resource_id,'action',normalized_action,
      'reason','RECORD_NOT_FOUND_IN_WORKSPACE','role',actor_role,
      'mfaLevel',aal,'workspaceId',ws
    );
  end if;
  allowed:=public.can_access_owned_record(ws,normalized_type,resource_id,target_owner,needs_edit);
  explanation:=case
    when normalized_type<>'CONTACT' and actor_role in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR') then 'ROLE_SCOPE'
    when target_owner=app_auth.current_user_id() then 'RECORD_OWNER'
    when exists(select 1 from public.record_collaborators c
      where c.workspace_id=ws and c.resource_type=normalized_type
        and c.resource_id=$2 and c.user_id=app_auth.current_user_id()
        and (not needs_edit or c.access_level='EDIT')) then 'EXPLICIT_COLLABORATOR'
    when allowed then 'TEAM_HIERARCHY' else 'OUTSIDE_ROLE_TEAM_OWNER_SCOPE' end;
  return jsonb_build_object(
    'exists',true,'allowed',allowed,'resourceType',normalized_type,
    'resourceId',resource_id,'action',normalized_action,'reason',explanation,
    'role',actor_role,'isOwner',target_owner=app_auth.current_user_id(),'status',target_status,
    'mfaLevel',aal,'requiredMfaLevel',case when needs_edit
      and actor_role in ('SUPER_ADMIN','ADMIN') then 'aal2' else 'aal1' end,
    'workspaceId',ws
  );
end;
$function$;


CREATE OR REPLACE FUNCTION public.duplicate_merge_preview(resource text, target_record uuid, source_record uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'app_auth', 'extensions'
AS $function$
declare target_json jsonb;source_json jsonb;impact jsonb;normalized text:=upper(resource);
begin
  if target_record=source_record then raise exception 'duplicate_same_record'; end if;
  if normalized='CONTACTS' then
    select jsonb_build_object('id',id,'nameZh',name_zh,'nameEn',name_en,'email',email,
      'phone',phone,'title',title,'status',status) into target_json
    from public.contact_visible_records c where c.id=target_record and c.workspace_id=public.current_workspace_id()
      and public.can_access_owned_record(c.workspace_id,'CONTACT',c.id,c.owner_id,true);
    select jsonb_build_object('id',id,'nameZh',name_zh,'nameEn',name_en,'email',email,
      'phone',phone,'title',title,'status',status) into source_json
    from public.contact_visible_records c where c.id=source_record and c.workspace_id=public.current_workspace_id()
      and public.can_access_owned_record(c.workspace_id,'CONTACT',c.id,c.owner_id,true);
    select jsonb_build_object(
      'activities',(select count(*) from public.crm_activities where contact_id=source_record),
      'opportunities',(select count(*) from public.opportunities where primary_contact_id=source_record),
      'consents',(select count(*) from public.contact_consents where contact_id=source_record),
      'appointments',(select count(*) from public.appointment_attendees where contact_id=source_record)
    ) into impact;
  elsif normalized='ORGANIZATIONS' then
    select jsonb_build_object('id',id,'nameZh',name_zh,'nameEn',name_en,'city',city,
      'curriculum',curriculum,'status',status) into target_json
    from public.organizations o where o.id=target_record and o.workspace_id=public.current_workspace_id()
      and public.can_access_owned_record(o.workspace_id,'ORGANIZATION',o.id,o.owner_id,true);
    select jsonb_build_object('id',id,'nameZh',name_zh,'nameEn',name_en,'city',city,
      'curriculum',curriculum,'status',status) into source_json
    from public.organizations o where o.id=source_record and o.workspace_id=public.current_workspace_id()
      and public.can_access_owned_record(o.workspace_id,'ORGANIZATION',o.id,o.owner_id,true);
    select jsonb_build_object(
      'contacts',(select count(*) from public.contact_visible_records where organization_id=source_record),
      'opportunities',(select count(*) from public.opportunities where organization_id=source_record),
      'contracts',(select count(*) from public.contracts where organization_id=source_record),
      'activities',(select count(*) from public.crm_activities where organization_id=source_record),
      'quotes',(select count(*) from public.quotes where organization_id=source_record),
      'nextBestActions',(select count(*) from public.next_best_actions where organization_id=source_record)
    ) into impact;
  else
    raise exception 'duplicate_resource_invalid';
  end if;
  if target_json is null or source_json is null then
    raise exception 'duplicate_record_not_authorized';
  end if;
  return jsonb_build_object(
    'resource',normalized,'target',target_json,'source',source_json,'impact',impact,
    'editableFields',case when normalized='CONTACTS'
      then jsonb_build_array('nameZh','nameEn','email','phone','title','status')
      else jsonb_build_array('nameZh','nameEn','city','curriculum','status') end,
    'recommendedMaster',case
      when coalesce((select completeness from public.contact_visible_records where id=target_record),
        (select completeness from public.organizations where id=target_record),0)
        >=coalesce((select completeness from public.contact_visible_records where id=source_record),
          (select completeness from public.organizations where id=source_record),0)
      then target_record else source_record end,
    'requiresConfirmation',true
  );
end;
$function$;


CREATE OR REPLACE FUNCTION public.contact_channel_allowed(target_contact uuid, target_channel text, target_purpose text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'app_auth', 'extensions'
AS $function$
  select exists(
    select 1 from public.contact_visible_records c
    join public.contact_consents cc on cc.contact_id=c.id and cc.workspace_id=c.workspace_id
    where c.id=target_contact and c.workspace_id=public.current_workspace_id() and not c.do_not_contact
      and not exists(select 1 from public.privacy_restrictions restriction
        where restriction.workspace_id=c.workspace_id and restriction.contact_id=c.id
          and restriction.active and (restriction.ends_at is null or restriction.ends_at>now())
          and ('COMMUNICATION'=any(restriction.scopes) or upper(target_purpose)=any(restriction.scopes)))
      and cc.channel=upper(target_channel) and cc.purpose=upper(target_purpose) and cc.status='GRANTED'
      and (cc.retention_until is null or cc.retention_until>=current_date)
  );
$function$;


create function public.contact_access_snapshot(identity uuid) returns jsonb language plpgsql stable security definer set search_path=public,app_auth as $$
declare c public.contacts;result jsonb;
begin
 select * into c from public.contacts where id=identity;
 if not found or not public.contact_record_access(identity,false) then raise exception 'CONTACT_NOT_FOUND';end if;
 select jsonb_build_object('ownerId',c.owner_id,'scope','OWNER_HIERARCHY','canEdit',public.contact_record_access(identity,true),'canShare',c.owner_id=app_auth.current_user_id() or public.current_crm_role()='SUPER_ADMIN',
 'shares',coalesce((select jsonb_agg(jsonb_build_object('userId',g.user_id,'name',(select username from app_auth.accounts where id=g.user_id),'access',g.access_level) order by g.user_id) from public.record_collaborators g where g.workspace_id=c.workspace_id and g.resource_type='CONTACT' and g.resource_id=identity),'[]')) into result;
 return result;
end $$;
create function public.share_contact(identity uuid,recipient uuid,level text,p_request_key text) returns jsonb
language plpgsql security definer set search_path=public,app_auth,extensions as $$
declare c public.contacts;receipt public.mutation_receipts;fingerprint text;result jsonb;actor uuid:=app_auth.current_user_id();ws uuid:=public.current_workspace_id();
begin
 if actor is null or not public.is_workspace_member(ws) or not public.contact_record_access(identity,false) or length(coalesce(p_request_key,'')) not between 8 and 160 or level not in ('READ','EDIT','REVOKE') then raise exception 'PERMISSION_DENIED';end if;
 perform pg_advisory_xact_lock(hashtextextended(ws::text||':contact-access:'||p_request_key,0));
 fingerprint:=encode(digest(jsonb_build_array(identity,recipient,level)::text,'sha256'),'hex');
 select * into receipt from public.mutation_receipts where workspace_id=ws and request_key=p_request_key;
 if found then
  if receipt.created_by<>actor or receipt.operation<>'CONTACT_SHARE' or receipt.result->>'request_hash'<>fingerprint then raise exception 'PAYLOAD_REUSE';end if;
  return receipt.result->'item';
 end if;
 select * into c from public.contacts where id=identity and workspace_id=ws for update;
 if not found or (c.owner_id<>actor and public.current_crm_role()<>'SUPER_ADMIN') or not public.contact_record_access(identity,true) then raise exception 'PERMISSION_DENIED';end if;
 if not exists(select 1 from public.workspace_memberships where workspace_id=ws and user_id=recipient and status='ACTIVE') then raise exception 'INVALID_REFERENCE';end if;
 if level='REVOKE' then delete from public.record_collaborators where workspace_id=ws and resource_type='CONTACT' and resource_id=identity and user_id=recipient;
 else insert into public.record_collaborators(workspace_id,resource_type,resource_id,user_id,access_level,granted_by) values(ws,'CONTACT',identity,recipient,level,actor)
 on conflict(workspace_id,resource_type,resource_id,user_id) do update set access_level=excluded.access_level,granted_by=actor;end if;
 result:=public.contact_access_snapshot(identity);
 insert into public.audit_events(workspace_id,actor_id,action,entity_type,entity_id,after_data) values(ws,actor,'CONTACT_SHARE','CONTACT',identity,jsonb_build_object('recipient',recipient,'access',level));
 insert into public.mutation_receipts(workspace_id,request_key,operation,result,created_by) values(ws,p_request_key,'CONTACT_SHARE',jsonb_build_object('request_hash',fingerprint,'item',result),actor);
 return result;
end $$;
revoke all on function public.contact_access_snapshot(uuid),public.share_contact(uuid,uuid,text,text) from public,crm_system,crm_worker;
grant execute on function public.contact_access_snapshot(uuid),public.share_contact(uuid,uuid,text,text) to crm_app;

-- Consent decisions are independent of record shares. Current permission stays
-- in contact_consents; every subsequent decision appends its own history event.
create table public.contact_consent_events(
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id),
 contact_id uuid not null references public.contacts(id),consent_id uuid not null,
 channel text not null,purpose text not null,status text not null,source text not null,evidence_note text not null,
 effective_at timestamptz not null,retention_until date,recorded_by uuid references app_auth.accounts(id),recorded_at timestamptz not null default clock_timestamp()
);
alter table public.contact_consent_events enable row level security;
create policy consent_event_read on public.contact_consent_events for select to crm_app using(public.contact_record_access(contact_id,false));
grant select on public.contact_consent_events to crm_app;
revoke insert,update,delete on public.contact_consent_events from public,crm_app,crm_system,crm_worker;
create function public.capture_contact_consent_event() returns trigger language plpgsql security definer set search_path=public,app_auth as $$
begin
 insert into public.contact_consent_events(workspace_id,contact_id,consent_id,channel,purpose,status,source,evidence_note,effective_at,retention_until,recorded_by)
 values(new.workspace_id,new.contact_id,new.id,new.channel,new.purpose,new.status,new.source,new.evidence_note,
 case when new.status='REVOKED' then new.revoked_at else coalesce(new.obtained_at,new.updated_at) end,new.retention_until,new.updated_by);
 return new;
end $$;
create trigger contact_consent_change_history after insert or update on public.contact_consents for each row execute function public.capture_contact_consent_event();
create function public.reject_consent_event_change() returns trigger language plpgsql set search_path=public as $$begin raise exception 'CONSENT_HISTORY_IMMUTABLE';end $$;
create trigger consent_history_immutable before update or delete on public.contact_consent_events for each row execute function public.reject_consent_event_change();
revoke all on function public.capture_contact_consent_event(),public.reject_consent_event_change() from public;

create function public.record_contact_consent(identity uuid,data jsonb,p_request_key text) returns jsonb
language plpgsql security definer set search_path=public,app_auth,extensions as $$
declare actor uuid:=app_auth.current_user_id();ws uuid:=public.current_workspace_id();r public.mutation_receipts;fingerprint text;result jsonb;
begin
 if not public.contact_record_access(identity,true) or length(coalesce(p_request_key,'')) not between 8 and 160 then raise exception 'PERMISSION_DENIED';end if;
 perform pg_advisory_xact_lock(hashtextextended(ws::text||':contact-consent:'||p_request_key,0));
 fingerprint:=encode(digest(jsonb_build_array(identity,data)::text,'sha256'),'hex');
 select * into r from public.mutation_receipts where workspace_id=ws and request_key=p_request_key;
 if found then
  if r.created_by<>actor or r.operation<>'CONTACT_CONSENT' or r.result->>'request_hash'<>fingerprint then raise exception 'PAYLOAD_REUSE';end if;
  return r.result->'item';
 end if;
 perform 1 from public.contacts where id=identity for update;
 if data->>'operation'='consent' then
 result:=to_jsonb(public.save_contact_consent(identity,data->>'channel',data->>'purpose',data->>'status',data->>'source',coalesce(data->>'evidence',''),nullif(data->>'retentionUntil','')::date,nullif(data->>'quietStart','')::time,nullif(data->>'quietEnd','')::time));
 elsif data->>'operation'='doNotContact' then
  if coalesce((data->>'enabled')::boolean,false) and nullif(trim(data->>'reason'),'') is null then raise exception 'INVALID_CONSENT';end if;
  update public.contacts set do_not_contact=(data->>'enabled')::boolean,do_not_contact_reason=case when (data->>'enabled')::boolean then data->>'reason' else '' end,updated_at=clock_timestamp() where id=identity;
  result:=jsonb_build_object('id',identity,'doNotContact',(data->>'enabled')::boolean);
 else raise exception 'INVALID_CONSENT';end if;
 insert into public.audit_events(workspace_id,actor_id,action,entity_type,entity_id,after_data) values(ws,actor,'CONTACT_CONSENT','CONTACT',identity,jsonb_build_object('operation',data->>'operation','channel',data->>'channel','purpose',data->>'purpose','status',data->>'status'));
 insert into public.mutation_receipts(workspace_id,request_key,operation,result,created_by) values(ws,p_request_key,'CONTACT_CONSENT',jsonb_build_object('request_hash',fingerprint,'item',result),actor);
 return result;
end $$;
revoke all on function public.record_contact_consent(uuid,jsonb,text) from public,crm_system,crm_worker;
grant execute on function public.record_contact_consent(uuid,jsonb,text) to crm_app;

-- New parent facts belong to canonical people, never inferred from legacy
-- primary/secondary Household occupation labels.
alter table public.contacts add column occupation text not null default '' check(length(occupation)<=160);
alter table public.contacts add column employer text not null default '' check(length(employer)<=160);
create function public.create_household_with_people(data jsonb,p_request_key text) returns jsonb
language plpgsql security definer set search_path=public,app_auth,extensions as $$
declare ws uuid:=public.current_workspace_id();actor uuid:=app_auth.current_user_id();r public.mutation_receipts;fingerprint text;family jsonb;person jsonb;identity uuid;members jsonb:='[]';result jsonb;zh text;en text;
begin
 if actor is null or not public.is_workspace_member(ws) or public.current_crm_role() not in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER','SALES_SPECIALIST','SALES_SUPPORT') then raise exception 'PERMISSION_DENIED';end if;
 if length(coalesce(p_request_key,'')) not between 8 and 160 or jsonb_typeof(data->'household') is distinct from 'object' or jsonb_typeof(data->'people') is distinct from 'array' or jsonb_array_length(data->'people') not between 1 and 10 then raise exception 'INVALID_EDUCATION_INPUT';end if;
 if (select count(*) from jsonb_array_elements(data->'people') x where coalesce((x->>'primary')::boolean,false))>1 then raise exception 'INVALID_EDUCATION_INPUT';end if;
 fingerprint:=encode(digest(data::text,'sha256'),'hex');
 perform pg_advisory_xact_lock(hashtextextended(ws::text||':family-create:'||p_request_key,0));
 select * into r from public.mutation_receipts where workspace_id=ws and request_key=p_request_key;
 if found then
  if r.created_by<>actor or r.operation<>'HOUSEHOLD_PEOPLE_CREATE' or r.result->>'request_hash'<>fingerprint then raise exception 'PAYLOAD_REUSE';end if;
  return r.result->'item';
 end if;
 if data->'household' ?| array['primaryParentOccupation','secondaryParentOccupation'] then raise exception 'PERSON_FACT_REQUIRED';end if;
 family:=public.save_customer_record('HOUSEHOLDS',gen_random_uuid(),null,(data->'household')||jsonb_build_object('status','ACTIVE'));
 for person in select * from jsonb_array_elements(data->'people') loop
  if person ?| array['personId','householdId','workspaceId','ownerId'] then raise exception 'INVALID_REFERENCE';end if;
  zh:=nullif(trim(person->>'nameZh'),'');en:=nullif(trim(person->>'nameEn'),'');
  if coalesce(zh,en) is null or length(coalesce(zh,en))>160 or length(coalesce(en,zh))>160 then raise exception 'INVALID_EDUCATION_INPUT';end if;
  if coalesce(person->>'role','') not in ('PARENT','GUARDIAN','OTHER','PAYER') then raise exception 'INVALID_EDUCATION_INPUT';end if;
  insert into public.contacts(workspace_id,name_zh,name_en,contact_type,owner_id,created_by,email,phone,occupation,employer,title)
  values(ws,coalesce(zh,en),coalesce(en,zh),'PARENT',actor,actor,nullif(person->>'email','')::citext,nullif(person->>'phone',''),coalesce(person->>'occupation',''),coalesce(person->>'employer',''),coalesce(person->>'title','')) returning id into identity;
  members:=members||jsonb_build_array(to_jsonb(public.save_household_member((family->>'id')::uuid,identity,person->>'role',coalesce((person->>'primary')::boolean,false))));
 end loop;
 result:=jsonb_build_object('household',family,'members',members);
 insert into public.audit_events(workspace_id,actor_id,action,entity_type,entity_id,after_data) values(ws,actor,'HOUSEHOLD_PEOPLE_CREATE','HOUSEHOLD',(family->>'id')::uuid,jsonb_build_object('memberCount',jsonb_array_length(members)));
 insert into public.mutation_receipts(workspace_id,request_key,operation,result,created_by) values(ws,p_request_key,'HOUSEHOLD_PEOPLE_CREATE',jsonb_build_object('request_hash',fingerprint,'item',result),actor);
 return result;
end $$;
revoke all on function public.create_household_with_people(jsonb,text) from public,crm_system,crm_worker;
grant execute on function public.create_household_with_people(jsonb,text) to crm_app;

CREATE OR REPLACE FUNCTION public.record_customer_activity(target_organization uuid, target_contact uuid, target_opportunity uuid, activity_kind text, occurred timestamp with time zone, summary_zh text, summary_en text, next_step_zh text, next_step_en text)
 RETURNS crm_activities
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app_auth', 'extensions'
AS $function$
declare
  organization public.organizations;
  result public.crm_activities;
begin
  select * into organization from public.organizations
    where id=target_organization and workspace_id=public.current_workspace_id();
  if not found
    or not public.can_access_owned_record(
      organization.workspace_id,'ORGANIZATION',organization.id,organization.owner_id,true
    ) then
    raise exception 'activity_not_authorized';
  end if;
  if upper(activity_kind) not in (
    'CALL','EMAIL','MEETING','VISIT','MEAL','NOTE','CAMPAIGN','PAYMENT_FOLLOW_UP'
  ) or nullif(trim(summary_zh),'') is null or nullif(trim(summary_en),'') is null
    or nullif(trim(next_step_zh),'') is null or nullif(trim(next_step_en),'') is null
    or occurred>now()+interval '5 minutes' then
    raise exception 'activity_invalid';
  end if;
  if target_contact is not null then
    perform 1 from public.contact_visible_records
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
    app_auth.current_user_id(),app_auth.current_user_id()
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
$function$
;

CREATE OR REPLACE FUNCTION public.create_crm_task(task_title_zh text, task_title_en text, relation_type text, relation_id uuid, relation_label text, task_priority text, task_due_at timestamp with time zone, task_owner uuid)
 RETURNS crm_tasks
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app_auth', 'extensions'
AS $function$
declare
  result public.crm_tasks;
  owner_id uuid:=coalesce(task_owner,app_auth.current_user_id());
  ws uuid:=public.current_workspace_id();
begin
  if app_auth.current_user_id() is null or ws is null or not public.can_assign_crm_task(owner_id) then
    raise exception 'task_owner_not_assignable';
  end if;
  if nullif(trim(task_title_zh),'') is null or nullif(trim(task_title_en),'') is null
    or relation_type not in ('ORGANIZATION','CONTACT')
    or task_priority not in ('LOW','NORMAL','HIGH','URGENT')
    or task_due_at is null then
    raise exception 'task_input_invalid';
  end if;
  if relation_type='ORGANIZATION' and not exists(
    select 1 from public.organizations
    where id=relation_id and workspace_id=ws and archived_at is null
  ) then raise exception 'task_related_record_not_found';
  elsif relation_type='CONTACT' and not exists(
    select 1 from public.contact_visible_records
    where id=relation_id and workspace_id=ws and archived_at is null
  ) then raise exception 'task_related_record_not_found';
  end if;
  insert into public.crm_tasks(
    workspace_id,title_zh,title_en,related_type,related_id,related_label,
    status,priority,owner_id,due_at,created_by
  ) values(
    ws,trim(task_title_zh),trim(task_title_en),relation_type,relation_id,
    trim(relation_label),'TODO',task_priority,owner_id,task_due_at,app_auth.current_user_id()
  ) returning * into result;
  return result;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.create_communication_thread(target_contact uuid, target_subject text, target_channel text, target_purpose text, target_request_key text)
 RETURNS communication_threads
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app_auth', 'extensions'
AS $function$
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
      select 1 from public.contact_visible_records
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
$function$
;

create policy task_contact_boundary on public.crm_tasks as restrictive for select to crm_app
 using(related_type<>'CONTACT' or related_id is null or public.contact_record_access(related_id,false));
create policy appointment_contact_boundary on public.appointments as restrictive for select to crm_app
 using(related_type<>'CONTACT' or related_id is null or public.contact_record_access(related_id,false));
create policy attendee_contact_boundary on public.appointment_attendees as restrictive for select to crm_app
 using(contact_id is null or public.contact_record_access(contact_id,false));
create policy thread_contact_boundary on public.communication_threads as restrictive for select to crm_app
 using(public.contact_record_access(contact_id,false));
create policy message_contact_boundary on public.communication_messages as restrictive for select to crm_app
 using(exists(select 1 from public.communication_threads t where t.id=thread_id and public.contact_record_access(t.contact_id,false)));
create policy guardian_contact_boundary on public.student_guardian_relationships as restrictive for select to crm_app
 using(public.contact_record_access(guardian_contact_id,false) and public.education_business_student_access(student_id,false));
create policy audit_contact_boundary on public.audit_events as restrictive for select to crm_app
 using(upper(entity_type) not in ('CONTACT','CONTACTS') or entity_id is null or case when entity_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then public.contact_record_access(entity_id::uuid,false) else false end);

create view public.household_person_records with(security_invoker=true) as
 select m.id,m.workspace_id,m.household_id,m.contact_id,m.member_role,m.primary_contact,
 c.name_zh,c.name_en,c.email,c.phone,c.occupation,c.employer,c.title,c.updated_at,
 public.contact_record_access(c.id,true) can_edit
 from public.household_members m join public.contacts c on c.id=m.contact_id and c.workspace_id=m.workspace_id;
grant select on public.household_person_records to crm_app;
create function public.save_household_person(identity uuid,expected_updated_at timestamptz,data jsonb,p_request_key text) returns jsonb
language plpgsql security definer set search_path=public,app_auth,extensions as $$
declare ws uuid:=public.current_workspace_id();actor uuid:=app_auth.current_user_id();m public.household_members;c public.contacts;r public.mutation_receipts;fingerprint text;result jsonb;
begin
 if actor is null or not public.is_workspace_member(ws) or length(coalesce(p_request_key,'')) not between 8 and 160 then raise exception 'PERMISSION_DENIED';end if;
 fingerprint:=encode(digest(jsonb_build_array(identity,expected_updated_at,data)::text,'sha256'),'hex');
 perform pg_advisory_xact_lock(hashtextextended(ws::text||':family-person:'||p_request_key,0));
 select * into m from public.household_members where id=identity and workspace_id=ws;
 if not found or not public.contact_record_access(m.contact_id,true) or not public.customer_subject_access('HOUSEHOLD',m.household_id,true) then raise exception 'PERMISSION_DENIED';end if;
 select * into r from public.mutation_receipts where workspace_id=ws and request_key=p_request_key;
 if found then
  if r.created_by<>actor or r.operation<>'HOUSEHOLD_PERSON_SAVE' or r.result->>'request_hash'<>fingerprint then raise exception 'PAYLOAD_REUSE';end if;
  return r.result->'item';
 end if;
 select * into c from public.contacts where id=m.contact_id for update;
 if c.updated_at is distinct from expected_updated_at then raise exception 'STALE_TARGET';end if;
 if nullif(trim(data->>'nameZh'),'') is null and nullif(trim(data->>'nameEn'),'') is null then raise exception 'INVALID_EDUCATION_INPUT';end if;
 if exists(select 1 from jsonb_object_keys(data) k where k not in ('nameZh','nameEn','phone','email','occupation','employer','title')) then raise exception 'INVALID_EDUCATION_INPUT';end if;
 update public.contacts set name_zh=coalesce(nullif(trim(data->>'nameZh'),''),trim(data->>'nameEn')),name_en=coalesce(nullif(trim(data->>'nameEn'),''),trim(data->>'nameZh')),
 phone=nullif(data->>'phone',''),email=nullif(data->>'email','')::citext,occupation=coalesce(data->>'occupation',''),employer=coalesce(data->>'employer',''),title=coalesce(data->>'title',''),updated_at=clock_timestamp() where id=c.id;
 result:=jsonb_build_object('id',identity,'contactId',c.id);
 insert into public.audit_events(workspace_id,actor_id,action,entity_type,entity_id,after_data) values(ws,actor,'HOUSEHOLD_PERSON_SAVE','CONTACT',c.id,jsonb_build_object('memberId',identity));
 insert into public.mutation_receipts(workspace_id,request_key,operation,result,created_by) values(ws,p_request_key,'HOUSEHOLD_PERSON_SAVE',jsonb_build_object('request_hash',fingerprint,'item',result),actor);
 return result;
end $$;
revoke all on function public.save_household_person(uuid,timestamptz,jsonb,text) from public,crm_system,crm_worker;
grant execute on function public.save_household_person(uuid,timestamptz,jsonb,text) to crm_app;

-- Recheck the original sender at worker execution, independently of consent.
CREATE OR REPLACE FUNCTION public.claim_communication_deliveries_leased(target_workspace uuid, batch_size integer, worker_id text, lease_seconds integer DEFAULT 300)
 RETURNS TABLE(message_id uuid, thread_id uuid, recipient_email text, subject text, body text, recipient_display_name text, consent_purpose text, lease_token uuid, provider_attempt_count integer, first_provider_attempt_at timestamp with time zone, last_provider_attempt_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app_auth', 'extensions'
AS $function$
begin
  if target_workspace is null
    or not exists(select 1 from public.workspaces where id=target_workspace)
    or batch_size not between 1 and 40
    or nullif(trim(worker_id),'') is null
    or length(trim(worker_id))>120
    or lease_seconds not between 30 and 3600
  then
    raise exception 'communication_delivery_claim_invalid';
  end if;

  perform set_config('app.workspace_id',target_workspace::text,true);

  -- An expired owner that never crossed the provider boundary is safe to
  -- release. No existing row is changed unless a future Worker first leased it.
  update public.communication_messages message
  set delivery_status='QUEUED',
      next_attempt_at=now(),
      locked_at=null,
      lease_expires_at=null,
      locked_by=null,
      lease_token=null,
      delivery_failure_code='LEASE_EXPIRED_BEFORE_PROVIDER_ATTEMPT',
      last_error='LEASE_EXPIRED_BEFORE_PROVIDER_ATTEMPT',
      updated_at=now()
  where message.workspace_id=target_workspace
    and message.direction='OUTBOUND'
    and message.delivery_status='PROCESSING'
    and message.lease_expires_at<now()
    and message.outcome_may_have_been_accepted=false;

  -- Once an external attempt may have started, lease expiry is never treated
  -- as proof that the provider rejected the message.
  update public.communication_messages message
  set delivery_status='UNCERTAIN',
      next_attempt_at=null,
      locked_at=null,
      lease_expires_at=null,
      locked_by=null,
      lease_token=null,
      delivery_failure_code='LEASE_EXPIRED_AFTER_PROVIDER_ATTEMPT',
      last_error='LEASE_EXPIRED_AFTER_PROVIDER_ATTEMPT',
      dead_lettered_at=coalesce(message.dead_lettered_at,now()),
      outcome_may_have_been_accepted=true,
      updated_at=now()
  where message.workspace_id=target_workspace
    and message.direction='OUTBOUND'
    and message.delivery_status='PROCESSING'
    and message.lease_expires_at<now()
    and message.outcome_may_have_been_accepted=true;

  update public.communication_messages message
  set delivery_status='UNCERTAIN',
      next_attempt_at=null,
      delivery_failure_code='IDEMPOTENCY_WINDOW_EXPIRED',
      last_error='IDEMPOTENCY_WINDOW_EXPIRED',
      dead_lettered_at=coalesce(message.dead_lettered_at,now()),
      updated_at=now()
  where message.workspace_id=target_workspace
    and message.direction='OUTBOUND'
    and message.delivery_status='QUEUED'
    and message.next_attempt_at<=now()
    and message.outcome_may_have_been_accepted=true
    and message.first_provider_attempt_at<=now()-interval '23 hours';

  update public.communication_messages message
  set delivery_status=case
        when message.outcome_may_have_been_accepted then 'UNCERTAIN'
        else 'FAILED'
      end,
      next_attempt_at=null,
      delivery_failure_code='MAX_PROVIDER_ATTEMPTS',
      last_error='MAX_PROVIDER_ATTEMPTS',
      dead_lettered_at=coalesce(message.dead_lettered_at,now()),
      updated_at=now()
  where message.workspace_id=target_workspace
    and message.direction='OUTBOUND'
    and message.delivery_status='QUEUED'
    and message.next_attempt_at<=now()
    and message.provider_attempt_count>=public.communication_delivery_max_provider_attempts();

  update public.communication_messages message
  set delivery_status='FAILED',
      next_attempt_at=null,
      delivery_failure_code='THREAD_CLOSED',
      last_error='THREAD_CLOSED',
      dead_lettered_at=coalesce(message.dead_lettered_at,now()),
      updated_at=now()
  from public.communication_threads thread
  where message.workspace_id=target_workspace
    and message.thread_id=thread.id
    and message.direction='OUTBOUND'
    and message.delivery_status='QUEUED'
    and message.next_attempt_at<=now()
    and thread.status<>'OPEN';

  update public.communication_messages message
  set delivery_status='FAILED',
      next_attempt_at=null,
      delivery_failure_code='RECIPIENT_EMAIL_UNAVAILABLE',
      last_error='RECIPIENT_EMAIL_UNAVAILABLE',
      dead_lettered_at=coalesce(message.dead_lettered_at,now()),
      updated_at=now()
  from public.communication_threads thread
  join public.contacts contact on contact.id=thread.contact_id
  where message.workspace_id=target_workspace
    and message.thread_id=thread.id
    and message.direction='OUTBOUND'
    and message.delivery_status='QUEUED'
    and message.next_attempt_at<=now()
    and nullif(trim(contact.email::text),'') is null;

  update public.communication_messages message
  set delivery_status='FAILED',
      next_attempt_at=null,
      delivery_failure_code='CONSENT_REVOKED',
      last_error='CONSENT_REVOKED',
      dead_lettered_at=coalesce(message.dead_lettered_at,now()),
      updated_at=now()
  from public.communication_threads thread
  join public.contacts contact on contact.id=thread.contact_id
  where message.workspace_id=target_workspace
    and message.thread_id=thread.id
    and message.direction='OUTBOUND'
    and message.delivery_status='QUEUED'
    and message.next_attempt_at<=now()
    and nullif(trim(contact.email::text),'') is not null
    and (not public.contact_actor_access(target_workspace,contact.id,contact.owner_id,message.sent_by,false)
      or not public.communication_delivery_contact_allowed(
      target_workspace,thread.contact_id,thread.channel,thread.purpose
    ));

  return query
  with candidates as (
    select candidate.id
    from public.communication_messages candidate
    where candidate.workspace_id=target_workspace
      and candidate.direction='OUTBOUND'
      and candidate.delivery_status='QUEUED'
      and candidate.next_attempt_at<=now()
      and candidate.provider_attempt_count<
        public.communication_delivery_max_provider_attempts()
      and (
        candidate.outcome_may_have_been_accepted=false
        or candidate.first_provider_attempt_at>now()-interval '23 hours'
      )
    order by candidate.next_attempt_at,candidate.created_at,candidate.id
    for update skip locked
    limit batch_size
  ),
  claimed as (
    update public.communication_messages message
    set delivery_status='PROCESSING',
        next_attempt_at=null,
        locked_at=now(),
        lease_expires_at=now()+make_interval(secs=>lease_seconds),
        locked_by=left(trim(worker_id),120),
        lease_token=gen_random_uuid(),
        delivery_failure_code=null,
        last_error=null,
        dead_lettered_at=null,
        updated_at=now()
    from candidates
    where message.id=candidates.id
    returning message.*
  )
  select
    claimed.id,
    claimed.thread_id,
    contact.email::text,
    thread.subject,
    claimed.body,
    coalesce(
      nullif(trim(contact.name_en),''),
      nullif(trim(contact.name_zh),''),
      ''
    ),
    thread.purpose,
    claimed.lease_token,
    claimed.provider_attempt_count,
    claimed.first_provider_attempt_at,
    claimed.last_provider_attempt_at
  from claimed
  join public.communication_threads thread on thread.id=claimed.thread_id
  join public.contacts contact on contact.id=thread.contact_id
  order by claimed.created_at,claimed.id;
end;
$function$;

-- Workers receive an authoritative row allow-list tied to the immutable job requester.
create function public.contact_export_allowed_rows(target_job uuid,target_ids uuid[])
returns table(id uuid) language sql stable security definer set search_path=public,app_auth,extensions as $$
 select row_id from public.generated_jobs job cross join unnest(target_ids) row_id
 where job.id=target_job and job.workspace_id=public.current_workspace_id()
 and job.job_type in ('CRM_EXPORT','MARKETING_CONTACT_EXPORT') and cardinality(target_ids)<=1000
 and exists(select 1 from public.workspace_memberships wm where wm.workspace_id=job.workspace_id and wm.user_id=job.created_by and wm.status='ACTIVE')
 and case when job.job_type='MARKETING_CONTACT_EXPORT' or job.parameters->>'resource'='people' then
   exists(select 1 from public.contacts c where c.id=row_id and c.workspace_id=job.workspace_id and public.contact_actor_access(c.workspace_id,c.id,c.owner_id,job.created_by,false))
 when job.parameters->>'resource'='students' then
   exists(select 1 from public.students st join public.contacts c on c.id=st.person_id where st.id=row_id and st.workspace_id=job.workspace_id and public.contact_actor_access(c.workspace_id,c.id,c.owner_id,job.created_by,false))
 when job.parameters->>'resource'='tasks' then
   exists(select 1 from public.crm_tasks t where t.id=row_id and t.workspace_id=job.workspace_id and (t.related_type<>'CONTACT' or t.related_id is null or exists(select 1 from public.contacts c where c.id=t.related_id and public.contact_actor_access(c.workspace_id,c.id,c.owner_id,job.created_by,false))))
 when job.parameters->>'resource'='sales' then
   exists(select 1 from public.opportunities o where o.id=row_id and o.workspace_id=job.workspace_id and (o.primary_contact_id is null or exists(select 1 from public.contacts c where c.id=o.primary_contact_id and public.contact_actor_access(c.workspace_id,c.id,c.owner_id,job.created_by,false))))
 else false end;
$$;
revoke all on function public.contact_export_allowed_rows(uuid,uuid[]) from public,crm_app,crm_system;
grant execute on function public.contact_export_allowed_rows(uuid,uuid[]) to crm_worker;

-- A member mutation must not reveal or silently modify hidden sibling memberships.
CREATE OR REPLACE FUNCTION public.customer_relation_context(resource text, patch jsonb, operation text, expected jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app_auth', 'extensions'
AS $function$
declare previous jsonb;data jsonb;identity uuid;parent uuid;contact uuid;table_name text;column_name text;fields text[];siblings jsonb:='[]';
begin
 if not public.is_workspace_member(public.current_workspace_id()) or public.current_crm_role() not in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER','SALES_SPECIALIST','SALES_SUPPORT') then raise exception 'PERMISSION_DENIED';end if;
 if operation not in ('CREATE','UPDATE') then raise exception 'UNSUPPORTED_OPERATION';end if;
 if resource='HOUSEHOLD_MEMBERS' then
  parent:=(patch->>'household_id')::uuid;contact:=(patch->>'contact_id')::uuid;
  if not public.import_reference_access('HOUSEHOLD',parent,true) or not public.import_reference_access('CONTACT',contact,false) then raise exception 'INVALID_REFERENCE';end if;
  table_name:='household_members';column_name:='household_id';fields:=array['household_id','contact_id','member_role','primary_contact'];
  perform pg_advisory_xact_lock(hashtextextended('membership:'||parent::text,0));
  select to_jsonb(m) into previous from public.household_members m where household_id=parent and contact_id=contact and workspace_id=public.current_workspace_id() for update;
  data:='{"primary_contact":false}'::jsonb;
 elsif resource='STUDENT_GUARDIANS' then
  parent:=(patch->>'student_id')::uuid;contact:=(patch->>'guardian_contact_id')::uuid;
  if not public.import_reference_access('STUDENT',parent,true) or not public.import_reference_access('CONTACT',contact,false) then raise exception 'INVALID_REFERENCE';end if;
  table_name:='student_guardian_relationships';column_name:='student_id';fields:=array['student_id','guardian_contact_id','relationship_type','primary_guardian','emergency_contact','legal_authority'];
  perform pg_advisory_xact_lock(hashtextextended('guardian:'||parent::text,0));
  select to_jsonb(g) into previous from public.student_guardian_relationships g where student_id=parent and guardian_contact_id=contact and workspace_id=public.current_workspace_id() for update;
  data:='{"primary_guardian":false,"emergency_contact":false}'::jsonb;
  if operation='CREATE' and not patch ? 'legal_authority' then raise exception 'REQUIRED';end if;
 elsif resource in ('ORGANIZATION_CONTACT_INTELLIGENCE','ORGANIZATION_CONTACT_RELATIONSHIPS','ORGANIZATION_CONTACT_ASSOCIATIONS') then
  parent:=(patch->>'organization_id')::uuid;contact:=coalesce((patch->>'contact_id')::uuid,(patch->>'source_contact_id')::uuid);
  if not public.import_reference_access('ORGANIZATION',parent,true) or not public.import_reference_access('CONTACT',contact,true) then raise exception 'INVALID_REFERENCE';end if;
  perform pg_advisory_xact_lock(hashtextextended('channel:'||public.current_workspace_id()::text||parent::text,0));
  if resource='ORGANIZATION_CONTACT_ASSOCIATIONS' then
   select to_jsonb(c) into previous from public.contacts c where id=contact for update;
   if previous->>'organization_id' is not null then raise exception 'UNSUPPORTED_REASSIGNMENT';end if;
   if operation='UPDATE' then raise exception 'UNSUPPORTED_OPERATION';end if;
   if expected is not null and previous->>'updated_at' is distinct from expected->>'updated_at' then raise exception 'STALE_TARGET';end if;
   return jsonb_build_object('id',contact,'data',patch,'previous',null,'updated_at',previous->'updated_at','siblings','[]'::jsonb);
  end if;
  if not exists(select 1 from public.contacts where id=contact and organization_id=parent) then raise exception 'INVALID_REFERENCE';end if;
  if resource='ORGANIZATION_CONTACT_INTELLIGENCE' then
   fields:=array['organization_id','contact_id','key_contact_status','decision_power_score','contribution_score','working_style_markdown','cooperation_notes','potential_notes'];
   select to_jsonb(i) into previous from public.organization_contact_intelligence i where contact_id=contact and workspace_id=public.current_workspace_id() for update;
   data:='{"key_contact_status":"UNKNOWN","decision_power_score":null,"contribution_score":null,"working_style_markdown":"","cooperation_notes":"","potential_notes":""}'::jsonb;
  else
   if not public.import_reference_access('CONTACT',(patch->>'target_contact_id')::uuid,false) or not exists(select 1 from public.contacts where id=(patch->>'target_contact_id')::uuid and organization_id=parent) or patch->>'target_contact_id'=patch->>'source_contact_id' then raise exception 'INVALID_REFERENCE';end if;
   if patch->>'relationship_type' in ('PEER','WORKS_WITH') then patch:=patch||jsonb_build_object('source_contact_id',least((patch->>'source_contact_id')::uuid,(patch->>'target_contact_id')::uuid),'target_contact_id',greatest((patch->>'source_contact_id')::uuid,(patch->>'target_contact_id')::uuid));end if;
   fields:=array['organization_id','source_contact_id','target_contact_id','relationship_type','status','note'];
   select to_jsonb(r) into previous from public.organization_contact_relationships r where organization_id=parent and relationship_type=patch->>'relationship_type' and status='ACTIVE' and
    (case when relationship_type in ('PEER','WORKS_WITH') then least(source_contact_id,target_contact_id) else source_contact_id end)=(patch->>'source_contact_id')::uuid and
    (case when relationship_type in ('PEER','WORKS_WITH') then greatest(source_contact_id,target_contact_id) else target_contact_id end)=(patch->>'target_contact_id')::uuid for update;
   data:='{"status":"ACTIVE","note":""}'::jsonb;
  end if;
 else raise exception 'UNSUPPORTED_OPERATION';end if;
 if exists(select 1 from jsonb_object_keys(patch) k where not k=any(fields)) then raise exception 'UNKNOWN_COLUMN';end if;
 if previous is not null and operation='CREATE' then raise exception 'DUPLICATE_REVIEW';end if;
 if previous is null and operation='UPDATE' then raise exception 'INVALID_REFERENCE';end if;
 if operation='UPDATE' and expected is not null and (previous->>'revision' is distinct from expected->>'revision' or previous->>'id' is distinct from expected->>'id') then raise exception 'STALE_TARGET';end if;
 if previous is not null then data:=data||(select jsonb_object_agg(k,previous->k) from unnest(fields) k);end if;
 data:=data||patch;identity:=coalesce((previous->>'id')::uuid,gen_random_uuid());
 if table_name is not null then execute format('select coalesce(jsonb_agg(to_jsonb(r) order by id),''[]'') from public.%I r where %I=$1 and workspace_id=$2',table_name,column_name) into siblings using parent,public.current_workspace_id();end if;
 if exists(select 1 from jsonb_array_elements(siblings) item where not public.contact_record_access(coalesce((item->>'contact_id')::uuid,(item->>'guardian_contact_id')::uuid),false)) then raise exception 'PERMISSION_DENIED';end if;
 if expected is not null and expected ? 'siblings' and (select coalesce(jsonb_agg(jsonb_build_object('id',v->'id','revision',v->'revision') order by v->>'id'),'[]') from jsonb_array_elements(siblings) v) is distinct from expected->'siblings' then raise exception 'STALE_TARGET';end if;
 return jsonb_build_object('id',identity,'revision',previous->'revision','data',data,'previous',case when previous is null then null else (select jsonb_object_agg(k,previous->k) from unnest(fields) k) end,'siblings',siblings);
end$function$;

-- Governed staff role changes: role rank is never a substitute for reporting links.
create function public.change_staff_role(target_user uuid,new_role text,expected_role text,p_request_key text)
returns jsonb language plpgsql security definer set search_path=public,app_auth,extensions as $$
declare ws uuid:=public.current_workspace_id();actor uuid:=app_auth.current_user_id();actor_role text;target public.workspace_memberships;
 receipt public.mutation_receipts;fingerprint text;result jsonb;
begin
 if current_setting('app.aal',true) is distinct from 'aal2' then raise exception 'MFA_REQUIRED';end if;
 if actor is null or not public.is_workspace_member(ws) then raise exception 'ROLE_ASSIGNMENT_FORBIDDEN';end if;
 if new_role is null or new_role not in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER','SALES_SPECIALIST','SALES_SUPPORT')
 or expected_role is null or length(coalesce(p_request_key,'')) not between 8 and 160 then raise exception 'INVALID_INPUT';end if;
 perform pg_advisory_xact_lock(hashtextextended(ws::text||':staff-identity',0));
 perform 1 from public.workspace_memberships where workspace_id=ws and user_id in(actor,target_user) order by user_id for update;
 select role into actor_role from public.workspace_memberships where workspace_id=ws and user_id=actor and status='ACTIVE';
 if actor_role is null or actor_role not in ('SUPER_ADMIN','ADMIN') then raise exception 'ROLE_ASSIGNMENT_FORBIDDEN';end if;
 fingerprint:=encode(digest(jsonb_build_array(target_user,new_role,expected_role)::text,'sha256'),'hex');
 select * into receipt from public.mutation_receipts where workspace_id=ws and request_key=p_request_key;
 if found then
  if receipt.created_by<>actor or receipt.operation<>'STAFF_ROLE_CHANGE' or receipt.result->>'request_hash'<>fingerprint then raise exception 'PAYLOAD_REUSE';end if;
  return receipt.result->'item';
 end if;
 select * into target from public.workspace_memberships where workspace_id=ws and user_id=target_user;
 if not found then raise exception 'STAFF_USER_NOT_FOUND';end if;
 if actor_role='ADMIN' and (target.role in ('ADMIN','SUPER_ADMIN') or new_role in ('ADMIN','SUPER_ADMIN')) then raise exception 'ROLE_ASSIGNMENT_FORBIDDEN';end if;
 if target.role<>expected_role then raise exception 'STALE_TARGET';end if;
 if target.role='SUPER_ADMIN' and new_role<>'SUPER_ADMIN' and target.status='ACTIVE' and not exists(select 1 from public.workspace_memberships where workspace_id=ws and user_id<>target_user and role='SUPER_ADMIN' and status='ACTIVE') then raise exception 'LAST_SUPER_ADMIN_PROTECTED';end if;
 update public.workspace_memberships set role=new_role where workspace_id=ws and user_id=target_user;
 update public.sales_team_members set role=new_role where workspace_id=ws and auth_user_id=target_user;
 update app_auth.sessions set revoked_at=now(),revoked_reason='STAFF_ROLE_CHANGED' where user_id=target_user and revoked_at is null;
 result:=jsonb_build_object('id',target_user,'role',new_role,'previousRole',target.role);
 insert into public.audit_events(workspace_id,actor_id,entity_type,entity_id,action,before_data,after_data)
 values(ws,actor,'staff_user',target_user,'ROLE_CHANGE',jsonb_build_object('role',target.role),jsonb_build_object('role',new_role));
 insert into public.mutation_receipts(workspace_id,request_key,operation,result,created_by)
 values(ws,p_request_key,'STAFF_ROLE_CHANGE',jsonb_build_object('request_hash',fingerprint,'item',result),actor);
 return result;
end $$;
revoke all on function public.change_staff_role(uuid,text,text,text) from public,crm_system,crm_worker;
grant execute on function public.change_staff_role(uuid,text,text,text) to crm_app;

-- Linked audit snapshots obey the same Contact boundary as their canonical rows.
-- Check both old and new identities: an owner/relationship change cannot expose the old person.
create function public.contact_audit_payload_visible(data jsonb) returns boolean
language plpgsql stable security definer set search_path=public,app_auth as $$
declare field text; identity text;
begin
 foreach field in array array['contact_id','primary_contact_id','guardian_contact_id','source_contact_id','target_contact_id','person_id'] loop
  identity:=data->>field;
  if identity is not null then
   if identity !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return false;end if;
   if not public.contact_record_access(identity::uuid,false) then return false;end if;
  end if;
 end loop;
 return true;
end $$;
revoke all on function public.contact_audit_payload_visible(jsonb) from public,crm_system,crm_worker;
grant execute on function public.contact_audit_payload_visible(jsonb) to crm_app;
create policy audit_linked_contact_boundary on public.audit_events as restrictive for select to crm_app
 using(public.contact_audit_payload_visible(before_data) and public.contact_audit_payload_visible(after_data));

-- Extend existing controlled Contact pseudonymization to the new person fields.
create function public.contact_person_privacy_fields() returns trigger
language plpgsql set search_path=public as $$begin
 if new.do_not_contact_reason like 'PRIVACY_DELETION:%' then new.occupation:='';new.employer:='';end if;
 return new;
end $$;
create trigger contact_person_privacy_fields before insert or update on public.contacts
 for each row execute function public.contact_person_privacy_fields();
revoke all on function public.contact_person_privacy_fields() from public,crm_app,crm_system,crm_worker;
