-- Staff-only identity boundary. CRM customer contacts are never authentication users.
revoke all on function public.username_available(text) from anon;
grant execute on function public.username_available(text) to authenticated;

comment on table public.user_profiles is
  'Profiles for invited operating-company staff accounts only; never customer, parent, or student identities.';
