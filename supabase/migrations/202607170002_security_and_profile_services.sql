drop policy if exists "users read own profile" on public.user_profiles;
create policy "users and administrators read profiles" on public.user_profiles for select to authenticated
using (user_id=auth.uid() or public.crm_role() in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR'));

create or replace function public.ensure_crm_user_preferences()
returns trigger language plpgsql security definer set search_path=public
as $$ begin
  insert into public.user_preferences(user_id,workspace_id) values(new.user_id,new.workspace_id) on conflict(user_id) do nothing;
  return new;
end; $$;
drop trigger if exists workspace_membership_preferences on public.workspace_memberships;
create trigger workspace_membership_preferences after insert on public.workspace_memberships for each row execute procedure public.ensure_crm_user_preferences();

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('crm-avatars','crm-avatars',false,5242880,array['image/png','image/jpeg','image/webp'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists "users read own crm avatar" on storage.objects;
create policy "users read own crm avatar" on storage.objects for select to authenticated
using(bucket_id='crm-avatars' and (storage.foldername(name))[1]=auth.uid()::text);
drop policy if exists "users upload own crm avatar" on storage.objects;
create policy "users upload own crm avatar" on storage.objects for insert to authenticated
with check(bucket_id='crm-avatars' and (storage.foldername(name))[1]=auth.uid()::text);
drop policy if exists "users update own crm avatar" on storage.objects;
create policy "users update own crm avatar" on storage.objects for update to authenticated
using(bucket_id='crm-avatars' and (storage.foldername(name))[1]=auth.uid()::text)
with check(bucket_id='crm-avatars' and (storage.foldername(name))[1]=auth.uid()::text);
drop policy if exists "users delete own crm avatar" on storage.objects;
create policy "users delete own crm avatar" on storage.objects for delete to authenticated
using(bucket_id='crm-avatars' and (storage.foldername(name))[1]=auth.uid()::text);

grant select on storage.objects to authenticated;
grant insert,update,delete on storage.objects to authenticated;
