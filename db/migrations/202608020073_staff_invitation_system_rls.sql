set search_path = public, app_auth, extensions;

drop policy if exists "system reads staff invitation deliveries"
  on public.staff_invitation_deliveries;
create policy "system reads staff invitation deliveries"
  on public.staff_invitation_deliveries for select to crm_system
  using (true);

drop policy if exists "system inserts staff invitation deliveries"
  on public.staff_invitation_deliveries;
create policy "system inserts staff invitation deliveries"
  on public.staff_invitation_deliveries for insert to crm_system
  with check (true);

drop policy if exists "system updates staff invitation deliveries"
  on public.staff_invitation_deliveries;
create policy "system updates staff invitation deliveries"
  on public.staff_invitation_deliveries for update to crm_system
  using (true)
  with check (true);
