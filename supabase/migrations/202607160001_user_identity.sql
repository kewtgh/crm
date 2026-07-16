create extension if not exists citext;

create table if not exists public.user_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  username citext not null unique,
  display_name_zh text not null,
  display_name_en text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint username_format check (username::text ~ '^[a-z][a-z0-9._-]{2,31}$')
);

insert into public.user_profiles(user_id, username, display_name_zh, display_name_en)
select id,
  left(case when candidate ~ '^[a-z]' then candidate else 'u-' || coalesce(nullif(candidate, ''), left(id::text, 6)) end || case when exists (select 1 from public.user_profiles p where p.username = candidate::citext) then '-' || left(id::text, 6) else '' end, 32),
  coalesce(raw_user_meta_data->>'chinese_name', ''), coalesce(raw_user_meta_data->>'english_name', raw_user_meta_data->>'full_name', '')
from auth.users u cross join lateral (select coalesce(nullif(lower(raw_user_meta_data->>'username'), ''), regexp_replace(lower(split_part(email, '@', 1)), '[^a-z0-9._-]', '', 'g')) as candidate) names where not exists (select 1 from public.user_profiles p where p.user_id = u.id);

alter table public.user_profiles enable row level security;
create policy "users read own profile" on public.user_profiles for select to authenticated using (auth.uid() = user_id);
create policy "users update own names" on public.user_profiles for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

create or replace function public.username_available(candidate text)
returns boolean language sql stable security definer set search_path = public
as $$ select candidate ~ '^[a-z][a-z0-9._-]{2,31}$' and not exists (select 1 from public.user_profiles where username = candidate::citext); $$;
revoke all on function public.username_available(text) from public;
grant execute on function public.username_available(text) to anon, authenticated;

create or replace function public.handle_new_lumina_crm_user()
returns trigger language plpgsql security definer set search_path = public
as $$ begin
  insert into public.user_profiles(user_id, username, display_name_zh, display_name_en)
  values (new.id, lower(new.raw_user_meta_data->>'username'), coalesce(new.raw_user_meta_data->>'chinese_name',''), coalesce(new.raw_user_meta_data->>'english_name',''));
  return new;
end; $$;

drop trigger if exists on_auth_user_created_profile on auth.users;
create trigger on_auth_user_created_profile after insert on auth.users for each row execute procedure public.handle_new_lumina_crm_user();
