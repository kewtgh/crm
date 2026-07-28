-- Activity detachment during privacy deletion needs a mutation timestamp.
alter table public.crm_activities
  add column if not exists updated_at timestamptz not null default now();

notify pgrst,'reload schema';
