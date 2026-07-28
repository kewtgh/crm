-- Generated from the preserved pre-exit migration history.
-- Supabase platform primitives were replaced with self-hosted PostgreSQL primitives.
set search_path = public, extensions;

alter table public.appointments add column if not exists channel text not null default '';
alter table public.appointments add column if not exists related_label text not null default '';
alter table public.appointments add column if not exists completed_at timestamptz;

create index if not exists appointments_workspace_starts_idx on public.appointments(workspace_id,starts_at,status);

create or replace function public.complete_appointment(appointment_id uuid)
returns public.appointments language plpgsql security invoker set search_path=public,app_auth,extensions
as $$
declare result public.appointments;
begin
  update public.appointments set status='COMPLETED',completed_at=now(),updated_at=now()
  where id=appointment_id and workspace_id=public.current_workspace_id() returning * into result;
  if not found then raise exception 'appointment_not_found'; end if;
  return result;
end; $$;

grant execute on function public.complete_appointment(uuid) to crm_app;
