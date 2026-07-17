insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('crm-exports','crm-exports',false,20971520,array['text/csv'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

alter table public.generated_jobs add column if not exists error_message text;
