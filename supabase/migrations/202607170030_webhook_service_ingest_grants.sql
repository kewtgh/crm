-- v0.9.0: the signed server webhook endpoint inserts with the service role and
-- needs INSERT + SELECT for PostgREST return=representation. DELETE is limited
-- to the same trusted service role for retention jobs and isolated smoke cleanup.
grant insert,select,delete on public.webhook_inbox to service_role;
revoke insert,update,delete on public.webhook_inbox from anon,authenticated;
