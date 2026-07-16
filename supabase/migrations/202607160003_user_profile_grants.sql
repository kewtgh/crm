grant select on table public.user_profiles to authenticated;
grant update (display_name_zh, display_name_en) on table public.user_profiles to authenticated;
grant select, insert, update, delete on table public.user_profiles to service_role;
