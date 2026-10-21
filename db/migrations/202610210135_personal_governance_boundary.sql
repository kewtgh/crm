set search_path=public,app_auth,extensions;

-- Non-administrators see their requests and reviews actually assigned to them,
-- not all requests made by a colleague in a team they lead.
drop policy staff_role_read_boundary on public.approval_requests;
create policy staff_role_read_boundary on public.approval_requests as restrictive for select to crm_app
 using(public.is_workspace_member(workspace_id));
create policy personal_approval_boundary on public.approval_requests as restrictive for select to crm_app using(
 public.is_workspace_member(workspace_id) and (
 public.crm_role() in('SUPER_ADMIN','ADMIN') or requester_id=app_auth.current_user_id()
 or (required_role='TEAM_LEAD' and public.crm_role() in('SALES_DIRECTOR','SALES_MANAGER') and exists(
  select 1 from public.sales_teams t
  join public.sales_team_members requester on requester.team_id=t.id
  join public.sales_team_members leader on leader.id=t.lead_member_id
  where requester.auth_user_id=approval_requests.requester_id and requester.active and leader.active
   and leader.auth_user_id=app_auth.current_user_id() and t.workspace_id=approval_requests.workspace_id and t.active))));

create function public.personal_recycle_access(kind text,r jsonb) returns boolean
language sql stable security definer set search_path=public,app_auth as $$
 select coalesce(public.is_workspace_member(public.current_workspace_id())
 and coalesce(r->>'owner_id',r->>'assigned_to',r->>'created_by')=app_auth.current_user_id()::text
 and public.business_record_delete_access(kind,r),false);
$$;
revoke all on function public.personal_recycle_access(text,jsonb) from public;
grant execute on function public.personal_recycle_access(text,jsonb) to crm_app;

-- Reuse the fixed resource catalog of the existing administrative bin, including
-- the seven original resource kinds. Filter before ordering and limiting.
do $$declare definition text;needle text;begin
 definition:=pg_get_functiondef('public.list_deleted_business_records()'::regprocedure);
 definition:=replace(definition,'public.list_deleted_business_records()','public.list_personal_recycle_bin()');
 needle:='if public.current_crm_role()<>''SUPER_ADMIN'' or app_auth.current_user_id() is null then raise exception ''super_admin_required'';end if;';
 if strpos(definition,needle)=0 then raise exception 'RECYCLE_DEFINITION_CHANGED';end if;
 definition:=replace(definition,needle,'if app_auth.current_user_id() is null or not public.is_workspace_member(public.current_workspace_id()) then raise exception ''RECYCLE_ACCESS_DENIED'';end if;');
 needle:='if coalesce(app_auth.current_claims()->>''aal'',''aal1'')<>''aal2'' then raise exception ''mfa_required'';end if;';
 if strpos(definition,needle)=0 then raise exception 'RECYCLE_DEFINITION_CHANGED';end if;
 definition:=replace(definition,needle,'');
 definition:=replace(definition,'foreach pair slice 1 in array array[',
  'foreach pair slice 1 in array array[[''ORGANIZATION'',''organizations''],[''CONTACT'',''contacts''],[''TASK'',''crm_tasks''],[''STUDENT'',''students''],[''HOUSEHOLD'',''households''],[''PRODUCT'',''products''],[''LEAD'',''leads''],');
 needle:='where workspace_id=$2 and archived_at is not null order by';
 if strpos(definition,needle)=0 then raise exception 'RECYCLE_DEFINITION_CHANGED';end if;
 definition:=replace(definition,needle,'where workspace_id=$2 and archived_at is not null and public.personal_recycle_access($1,to_jsonb(x)) order by');
 definition:=replace(definition,'''labelZh'',coalesce(r->>''name_zh'',','''labelZh'',coalesce(r->>''name_zh'',r->>''title_zh'',');
 definition:=replace(definition,'''labelEn'',coalesce(r->>''name_en'',','''labelEn'',coalesce(r->>''name_en'',r->>''title_en'',');
 execute definition;
end $$;
revoke all on function public.list_personal_recycle_bin() from public,crm_system,crm_worker;
grant execute on function public.list_personal_recycle_bin() to crm_app;

create function public.restore_personal_recycle_record(entity_kind text,entity_id uuid) returns boolean
language plpgsql security definer set search_path=public,app_auth as $$
declare kind text:=upper(trim(entity_kind));table_name text:=public.deletion_resource_table(kind);r jsonb;extra text:='';ws uuid:=public.current_workspace_id();begin
 if app_auth.current_user_id() is null or not public.is_workspace_member(ws) or table_name is null then raise exception 'RECYCLE_ACCESS_DENIED';end if;
 execute format('select to_jsonb(x) from public.%I x where id=$1 and workspace_id=$2 and archived_at is not null for update',table_name) into r using entity_id,ws;
 if r is null or not public.personal_recycle_access(kind,r) then raise exception 'RECYCLE_ACCESS_DENIED';end if;
 if r ? 'revision' then extra:=extra||',revision=revision+1';end if;
 if r ? 'updated_at' then extra:=extra||',updated_at=clock_timestamp()';end if;
 if kind in('STUDENT','HOUSEHOLD') then extra:=extra||',status=''ACTIVE''';end if;
 if kind='PRODUCT' then extra:=extra||',active=(lifecycle_status=''ACTIVE'')';end if;
 execute format('update public.%I set archived_at=null%s where id=$1 and workspace_id=$2',table_name,extra) using entity_id,ws;
 insert into public.audit_events(workspace_id,actor_id,entity_type,entity_id,action) values(ws,app_auth.current_user_id(),kind,entity_id,'RECORD_RESTORED');
 return true;
end $$;
revoke all on function public.restore_personal_recycle_record(text,uuid) from public,crm_system,crm_worker;
grant execute on function public.restore_personal_recycle_record(text,uuid) to crm_app;
