-- v2.7.0: one-time MFA recovery codes and super-administrator terminal execution.
create table if not exists public.mfa_recovery_codes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  code_hash text not null check (code_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  unique (user_id, code_hash)
);

alter table public.mfa_recovery_codes enable row level security;
drop policy if exists mfa_recovery_codes_owner_select on public.mfa_recovery_codes;
drop policy if exists mfa_recovery_codes_owner_insert on public.mfa_recovery_codes;
drop policy if exists mfa_recovery_codes_owner_delete on public.mfa_recovery_codes;
create policy mfa_recovery_codes_owner_select on public.mfa_recovery_codes for select to authenticated using (user_id = auth.uid());
create policy mfa_recovery_codes_owner_insert on public.mfa_recovery_codes for insert to authenticated with check (user_id = auth.uid());
create policy mfa_recovery_codes_owner_delete on public.mfa_recovery_codes for delete to authenticated using (user_id = auth.uid());
revoke all on public.mfa_recovery_codes from public;
grant select, insert, delete on public.mfa_recovery_codes to authenticated;

-- Super administrators are the terminal authority. They may execute their own
-- request synchronously; every execution still leaves the immutable approval audit.
create or replace function public.super_admin_execute_approval(request_id uuid)
returns public.approval_requests
language plpgsql
security definer
set search_path=public
as $$
declare request public.approval_requests; object_uuid uuid;
begin
  if auth.uid() is null or public.current_crm_role() <> 'SUPER_ADMIN' then
    raise exception 'super_admin_required';
  end if;
  select * into request from public.approval_requests
    where id=request_id and workspace_id=public.current_workspace_id() for update;
  if not found or request.status <> 'PENDING' then raise exception 'approval_not_pending'; end if;
  if request.requester_id <> auth.uid() then raise exception 'approval_requester_mismatch'; end if;

  update public.approval_requests set status='APPROVED', decision_reason='超级管理员直接执行',
    decided_by=auth.uid(), decided_at=now(), updated_at=now()
  where id=request_id returning * into request;
  insert into public.approval_actions(approval_request_id,actor_id,action,comment)
    values(request_id,auth.uid(),'APPROVED','SUPER_ADMIN_DIRECT_EXECUTION');

  begin
    if request.request_type in ('CONTRACT_SIGN','CONTRACT_EXPORT','PERFORMANCE_ALLOCATION') then
      object_uuid:=request.business_object_id::uuid;
    end if;
    if request.request_type='CONTRACT_SIGN' then
      update public.contracts set status='ACTIVE',signed_at=coalesce(signed_at,now()),updated_at=now()
        where id=object_uuid and workspace_id=request.workspace_id and status='PENDING_APPROVAL';
      if not found then raise exception 'contract_state_changed'; end if;
    elsif request.request_type='PERFORMANCE_ALLOCATION' then
      update public.performance_targets set status='ACTIVE',updated_at=now()
        where id=object_uuid and workspace_id=request.workspace_id and status='PENDING_APPROVAL';
      if not found then raise exception 'performance_state_changed'; end if;
    elsif request.request_type in ('CONTRACT_EXPORT','PERFORMANCE_SUMMARY','MARKETING_CONTACT_EXPORT','CRM_EXPORT') then
      insert into public.generated_jobs(workspace_id,approval_request_id,job_type,parameters,created_by)
      values(request.workspace_id,request.id,request.request_type,
        case when request.request_type='CRM_EXPORT' then request.request_payload
          else jsonb_build_object('objectType',request.business_object_type,'objectId',request.business_object_id) end,
        request.requester_id)
      on conflict(approval_request_id) do nothing;
    end if;
    update public.approval_requests set execution_status='SUCCEEDED',executed_at=now(),execution_error=null
      where id=request.id returning * into request;
  exception when others then
    update public.approval_requests set execution_status='FAILED',executed_at=now(),execution_error=left(sqlerrm,500)
      where id=request.id returning * into request;
  end;
  return request;
end;
$$;

revoke all on function public.super_admin_execute_approval(uuid) from public;
grant execute on function public.super_admin_execute_approval(uuid) to authenticated;

-- Business records use a recoverable archive instead of physical deletion.
-- Existing archived_at columns form the recycle bin and are retained for 30 days.
create or replace function public.purge_expired_crm_recycle_bin()
returns integer language plpgsql security definer set search_path=public as $$
declare removed integer:=0; affected integer;
begin
  if current_user not in ('postgres','service_role') then raise exception 'service_role_required'; end if;
  delete from public.students where archived_at < now()-interval '30 days'; get diagnostics affected=row_count; removed:=removed+affected;
  delete from public.households where archived_at < now()-interval '30 days'; get diagnostics affected=row_count; removed:=removed+affected;
  delete from public.contacts where archived_at < now()-interval '30 days'; get diagnostics affected=row_count; removed:=removed+affected;
  delete from public.organizations where archived_at < now()-interval '30 days'; get diagnostics affected=row_count; removed:=removed+affected;
  delete from public.crm_tasks where archived_at < now()-interval '30 days'; get diagnostics affected=row_count; removed:=removed+affected;
  return removed;
end;
$$;
revoke all on function public.purge_expired_crm_recycle_bin() from public, authenticated;
grant execute on function public.purge_expired_crm_recycle_bin() to service_role;

create or replace function public.restore_crm_recycle_bin(entity_kind text, entity_id uuid)
returns boolean language plpgsql security definer set search_path=public as $$
declare restored integer:=0; kind text:=upper(trim(entity_kind)); ws uuid:=public.current_workspace_id();
begin
  if auth.uid() is null or public.current_crm_role()<>'SUPER_ADMIN' then raise exception 'super_admin_required'; end if;
  if kind='ORGANIZATION' then
    update public.organizations set archived_at=null,updated_at=now() where id=entity_id and workspace_id=ws and archived_at is not null;
  elsif kind='CONTACT' then
    update public.contacts set archived_at=null,updated_at=now() where id=entity_id and workspace_id=ws and archived_at is not null;
  elsif kind='TASK' then
    update public.crm_tasks set archived_at=null,updated_at=now() where id=entity_id and workspace_id=ws and archived_at is not null;
  elsif kind='STUDENT' then
    update public.students set archived_at=null,status='ACTIVE',updated_at=now() where id=entity_id and workspace_id=ws and archived_at is not null;
  elsif kind='HOUSEHOLD' then
    update public.households set archived_at=null,status='ACTIVE',updated_at=now() where id=entity_id and workspace_id=ws and archived_at is not null;
  else
    raise exception 'recycle_entity_invalid';
  end if;
  get diagnostics restored=row_count;
  if restored=0 then raise exception 'recycle_entity_not_found'; end if;
  return true;
end;
$$;
revoke all on function public.restore_crm_recycle_bin(text,uuid) from public,anon;
grant execute on function public.restore_crm_recycle_bin(text,uuid) to authenticated;
