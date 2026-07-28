-- Existing staff retain their current passwords. Newly created staff must replace
-- the generated temporary password before entering the CRM.
alter table public.workspace_memberships
  add column if not exists must_change_password boolean;

update public.workspace_memberships
set must_change_password = false
where must_change_password is null;

alter table public.workspace_memberships
  alter column must_change_password set default true,
  alter column must_change_password set not null;

create or replace function public.complete_initial_password_change()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.workspace_memberships
  set must_change_password = false
  where user_id = auth.uid() and status = 'ACTIVE';

  if not found then
    raise exception 'ACTIVE_MEMBERSHIP_REQUIRED' using errcode = '42501';
  end if;
end;
$$;

revoke all on function public.complete_initial_password_change() from public;
grant execute on function public.complete_initial_password_change() to authenticated;

comment on column public.workspace_memberships.must_change_password is
  'True only while a staff account is using an administrator-generated temporary password.';
