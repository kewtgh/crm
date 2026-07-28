-- The service role bypasses RLS but still needs SQL privileges for the narrowly
-- scoped staff-administration operations performed by the server.
grant select, update on public.workspace_memberships to service_role;
grant select, insert, update on public.sales_team_members to service_role;
grant insert on public.audit_events to service_role;
grant usage, select on sequence public.audit_events_id_seq to service_role;
