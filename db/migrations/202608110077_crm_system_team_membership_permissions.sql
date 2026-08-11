-- CRM administration uses the narrowly privileged system role. Teams were
-- introduced after the generic system-role RLS policies, so they need explicit
-- policies just like the staff-invitation tables added later in the history.
set search_path = public, extensions;

grant select, insert, update on public.sales_team_memberships to crm_system;

drop policy if exists "system reads sales teams" on public.sales_teams;
create policy "system reads sales teams"
  on public.sales_teams for select to crm_system
  using (true);

drop policy if exists "system inserts sales teams" on public.sales_teams;
create policy "system inserts sales teams"
  on public.sales_teams for insert to crm_system
  with check (true);

drop policy if exists "system updates sales teams" on public.sales_teams;
create policy "system updates sales teams"
  on public.sales_teams for update to crm_system
  using (true)
  with check (true);

drop policy if exists "system reads team memberships" on public.sales_team_memberships;
create policy "system reads team memberships"
  on public.sales_team_memberships for select to crm_system
  using (true);

drop policy if exists "system inserts team memberships" on public.sales_team_memberships;
create policy "system inserts team memberships"
  on public.sales_team_memberships for insert to crm_system
  with check (true);

drop policy if exists "system updates team memberships" on public.sales_team_memberships;
create policy "system updates team memberships"
  on public.sales_team_memberships for update to crm_system
  using (true)
  with check (true);
