alter table app_auth.sessions
  add column if not exists persistent boolean not null default false;

-- Sessions created before this migration did not record the remember-login
-- choice. Their absolute lifetime is the durable server-side evidence: only
-- remembered sessions were issued for longer than the 12-hour transient limit.
update app_auth.sessions
set persistent = true
where absolute_expires_at - created_at > interval '12 hours';

-- Restore remembered sessions that still have a valid absolute lifetime. This
-- never revives revoked sessions or extends their original 15/30-day boundary.
update app_auth.sessions
set idle_expires_at = absolute_expires_at
where persistent
  and revoked_at is null
  and absolute_expires_at > now();
