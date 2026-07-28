insert into public.user_profiles(user_id, username, display_name_zh, display_name_en)
select id,
  left(case when candidate ~ '^[a-z]' then candidate else 'u-' || coalesce(nullif(candidate, ''), left(id::text, 6)) end || case when exists (select 1 from public.user_profiles p where p.username = candidate::citext) then '-' || left(id::text, 6) else '' end, 32),
  coalesce(raw_user_meta_data->>'chinese_name', ''), coalesce(raw_user_meta_data->>'english_name', raw_user_meta_data->>'full_name', '')
from auth.users u cross join lateral (select coalesce(nullif(lower(raw_user_meta_data->>'username'), ''), regexp_replace(lower(split_part(email, '@', 1)), '[^a-z0-9._-]', '', 'g')) as candidate) names
where not exists (select 1 from public.user_profiles p where p.user_id = u.id);
