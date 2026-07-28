-- Generated from the preserved pre-exit migration history.
-- Supabase platform primitives were replaced with self-hosted PostgreSQL primitives.
set search_path = public, extensions;

-- v2.6.0: keep user timezones inside the application-supported, release-tested set.
update public.user_preferences
set timezone = 'Asia/Taipei', updated_at = now()
where timezone not in (
  'Asia/Taipei',
  'Asia/Shanghai',
  'Asia/Singapore',
  'Europe/London',
  'America/New_York'
);

alter table public.user_preferences
  drop constraint if exists user_preferences_timezone_valid;

alter table public.user_preferences
  add constraint user_preferences_timezone_valid check (
    timezone in (
      'Asia/Taipei',
      'Asia/Shanghai',
      'Asia/Singapore',
      'Europe/London',
      'America/New_York'
    )
  );
