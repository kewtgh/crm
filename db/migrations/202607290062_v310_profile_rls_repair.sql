drop policy if exists "users and administrators read profiles" on public.user_profiles;
create policy "users and administrators read profiles"
on public.user_profiles
for select
to crm_app
using (
  user_id = app_auth.current_user_id()
  or public.current_crm_role() in ('SUPER_ADMIN', 'ADMIN', 'SALES_DIRECTOR')
);
