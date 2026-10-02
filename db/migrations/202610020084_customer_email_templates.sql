set search_path=public,extensions;

create table public.customer_email_templates (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default public.current_workspace_id() references public.workspaces(id),
  owned_by uuid not null default app_auth.current_user_id() references app_auth.accounts(id),
  name text not null check(length(trim(name)) between 1 and 80),
  content jsonb not null check(jsonb_typeof(content)='object' and content->>'purpose' in ('SERVICE','MARKETING')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index customer_email_templates_owner_idx on public.customer_email_templates(workspace_id,owned_by);
alter table public.customer_email_templates enable row level security;
create policy "owners manage customer email templates" on public.customer_email_templates for all to crm_app
  using(workspace_id=public.current_workspace_id() and public.is_workspace_member(workspace_id)
    and owned_by=app_auth.current_user_id() and public.current_crm_role() in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER','SALES_SPECIALIST','SALES_SUPPORT'))
  with check(workspace_id=public.current_workspace_id() and public.is_workspace_member(workspace_id)
    and owned_by=app_auth.current_user_id() and public.current_crm_role() in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER','SALES_SPECIALIST','SALES_SUPPORT'));
revoke all on public.customer_email_templates from public,crm_system,crm_worker;
grant select,insert,update,delete on public.customer_email_templates to crm_app;

-- SECURITY INVOKER intentionally preserves contact and organization row policies.
-- Region is the associated institution's city, not an inferred home address.
create function public.customer_email_recipients(search_query text default '', region text default '', tag text default '', customer_type text default '', page_number integer default 1)
returns jsonb language sql stable security invoker set search_path=public,app_auth,extensions as $$
  with accessible as materialized (
    select c.id,c.name_zh,c.name_en,c.email,c.contact_type,coalesce(c.tags,'{}'::text[]) as tags,
      coalesce(o.city,'') as city,(c.do_not_contact or c.email is null or trim(c.email::text)='') as blocked
    from public.contacts c left join public.organizations o on o.id=c.organization_id and o.archived_at is null
    where c.archived_at is null and c.workspace_id=public.current_workspace_id()
      and public.is_workspace_member(c.workspace_id)
      and public.current_crm_role() in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER','SALES_SPECIALIST','SALES_SUPPORT')
  ), filtered as materialized (
    select * from accessible a where (search_query='' or strpos(lower(concat_ws(' ',a.name_zh,a.name_en,a.email)),lower(search_query))>0)
      and (region='' or a.city=region) and (tag='' or tag=any(a.tags)) and (customer_type='' or a.contact_type=customer_type)
  ), paged as (
    select * from filtered order by name_zh,name_en,id limit 20 offset ((greatest(1,least(page_number,10000))-1)*20)
  )
  select jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(p)) from paged p),'[]'::jsonb),
    'total',(select count(*) from filtered),
    'regions',coalesce((select jsonb_agg(x.city) from (select distinct city from accessible where city<>'' order by city limit 200) x),'[]'::jsonb),
    'tags',coalesce((select jsonb_agg(x.tag) from (select distinct unnest(tags) as tag from accessible order by tag limit 200) x),'[]'::jsonb),
    'types',coalesce((select jsonb_agg(x.contact_type) from (select distinct contact_type from accessible order by contact_type) x),'[]'::jsonb));
$$;
revoke all on function public.customer_email_recipients(text,text,text,text,integer) from public,crm_system,crm_worker;
grant execute on function public.customer_email_recipients(text,text,text,text,integer) to crm_app;
