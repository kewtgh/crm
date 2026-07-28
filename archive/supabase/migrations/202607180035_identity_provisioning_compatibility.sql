-- v1.0.0: support GoTrue's two-step admin-user provisioning without allowing
-- later Auth metadata changes to reactivate or mutate an existing membership.

create or replace function public.handle_new_crm_membership()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  valid_roles constant text[]:=array[
    'SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER',
    'SALES_SPECIALIST','SALES_SUPPORT'
  ];
  new_role text:=upper(coalesce(new.raw_app_meta_data->>'role',''));
  old_role text;
  requested_workspace uuid;
begin
  if new_role<>all(valid_roles) then
    return new;
  end if;

  if tg_op='UPDATE' then
    old_role:=upper(coalesce(old.raw_app_meta_data->>'role',''));

    -- Auth may insert an account first and attach app_metadata immediately
    -- afterwards. Only that first transition may provision membership.
    if old_role=any(valid_roles)
      or exists(
        select 1 from public.workspace_memberships
        where user_id=new.id
      )
    then
      return new;
    end if;
  end if;

  begin
    requested_workspace:=nullif(new.raw_app_meta_data->>'workspace_id','')::uuid;
  exception when invalid_text_representation then
    raise exception 'workspace_context_invalid';
  end;

  if requested_workspace is null then
    select id into requested_workspace
    from public.workspaces
    order by id
    limit 1;
    if (select count(*) from public.workspaces)<>1 then
      raise exception 'workspace_context_required';
    end if;
  end if;
  if not exists(select 1 from public.workspaces where id=requested_workspace) then
    raise exception 'workspace_context_invalid';
  end if;

  insert into public.workspace_memberships(workspace_id,user_id,role,status)
  values(requested_workspace,new.id,new_role,'ACTIVE')
  on conflict(workspace_id,user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_crm_membership on auth.users;
create trigger on_auth_user_created_crm_membership
after insert or update of raw_app_meta_data on auth.users
for each row execute procedure public.handle_new_crm_membership();
