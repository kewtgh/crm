set search_path=public,extensions;

-- Separate template categories while retaining the existing personal/public RLS.
alter table public.customer_email_templates add column category text not null default 'EMAIL'
  check(category in ('EMAIL','PORTAL'));
drop function public.save_customer_email_template(uuid,integer,text,jsonb,boolean,text);
create function public.save_customer_email_template(target_template uuid, expected_revision integer,
  template_name text, template_content jsonb, archive boolean default false,
  template_visibility text default 'PERSONAL', template_category text default 'EMAIL')
returns public.customer_email_templates language plpgsql security invoker
set search_path=public,app_auth,extensions as $$
declare existing public.customer_email_templates; result public.customer_email_templates;
begin
  if target_template is null or (expected_revision is not null and expected_revision<1)
    or template_visibility is null or template_visibility not in ('PERSONAL','WORKSPACE')
    or template_category is null or template_category not in ('EMAIL','PORTAL') then raise exception 'email_template_invalid'; end if;
  if template_visibility='WORKSPACE' and public.current_crm_role() not in ('SUPER_ADMIN','ADMIN') then
    raise exception 'email_template_public_forbidden'; end if;
  perform pg_advisory_xact_lock(hashtextextended('email-template:'||target_template::text,0));
  select * into existing from public.customer_email_templates
    where id=target_template and workspace_id=public.current_workspace_id()
      and ((visibility='PERSONAL' and owned_by=app_auth.current_user_id())
        or (visibility='WORKSPACE' and public.current_crm_role() in ('SUPER_ADMIN','ADMIN'))) for update;
  if not found then
    if expected_revision is not null or archive then raise exception 'email_template_not_found'; end if;
    insert into public.customer_email_templates(id,name,content,visibility,category)
      values(target_template,trim(template_name),template_content,template_visibility,template_category) returning * into result;
    return result;
  end if;
  if existing.category<>template_category then raise exception 'email_template_not_found'; end if;
  if expected_revision is null then
    if not archive and existing.revision=1 and existing.archived_at is null
      and existing.visibility=template_visibility and existing.name=trim(template_name) and existing.content=template_content then return existing; end if;
    raise exception 'email_template_idempotency_conflict';
  end if;
  if not archive and existing.visibility<>template_visibility then raise exception 'email_template_version_conflict'; end if;
  if existing.revision=expected_revision+1 and (
    (archive and existing.archived_at is not null) or
    (not archive and existing.archived_at is null and existing.name=trim(template_name) and existing.content=template_content)
  ) then return existing; end if;
  if existing.archived_at is not null then raise exception 'email_template_not_found'; end if;
  if existing.revision<>expected_revision then raise exception 'email_template_version_conflict'; end if;
  if archive then update public.customer_email_templates set archived_at=clock_timestamp() where id=target_template returning * into result;
  else update public.customer_email_templates set name=trim(template_name),content=template_content where id=target_template returning * into result; end if;
  return result;
end;
$$;
revoke all on function public.save_customer_email_template(uuid,integer,text,jsonb,boolean,text,text) from public,crm_system,crm_worker;
grant execute on function public.save_customer_email_template(uuid,integer,text,jsonb,boolean,text,text) to crm_app;

-- Structured facets are derived only from accessible, non-archived household relationships.
create function public.portal_invitation_recipients(search_query text default '', region text default '',
  tag text default '', customer_type text default '', page_number integer default 1)
returns jsonb language sql stable security invoker set search_path=public,app_auth,extensions as $$
  with relationships as (
    select hm.household_id,hm.contact_id from public.household_members hm where hm.workspace_id=public.current_workspace_id()
    union
    select s.household_id,r.guardian_contact_id from public.students s
      join public.student_guardian_relationships r on r.student_id=s.id and r.workspace_id=s.workspace_id
      where s.workspace_id=public.current_workspace_id() and s.household_id is not null and s.archived_at is null and s.status<>'ARCHIVED'
  ), accessible as materialized (
    select h.id as household_id,h.name_zh as household_zh,h.name_en as household_en,
      c.id as contact_id,c.name_zh,c.name_en,c.email,coalesce(c.tags,'{}'::text[]) as tags,c.contact_type,coalesce(o.city,'') as city
    from relationships r join public.households h on h.id=r.household_id
      join public.contacts c on c.id=r.contact_id and c.workspace_id=h.workspace_id
      left join public.organizations o on o.id=c.organization_id and o.workspace_id=c.workspace_id and o.archived_at is null
    where h.workspace_id=public.current_workspace_id() and public.is_workspace_member(h.workspace_id)
      and h.archived_at is null and h.status<>'ARCHIVED' and c.archived_at is null
      and nullif(trim(c.email::text),'') is not null and not c.do_not_contact
      and public.current_crm_role() in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER','SALES_SPECIALIST','SALES_SUPPORT')
  ), filtered as materialized (
    select * from accessible a where (search_query='' or strpos(lower(concat_ws(' ',a.household_zh,a.household_en,a.name_zh,a.name_en,a.email)),lower(search_query))>0)
      and (region='' or a.city=region) and (tag='' or tag=any(a.tags)) and (customer_type='' or a.contact_type=customer_type)
  ), paged as (
    select * from filtered order by household_zh,household_en,name_zh,household_id,contact_id
      limit 20 offset ((greatest(1,least(page_number,10000))-1)*20)
  )
  select jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(p)) from paged p),'[]'::jsonb),'total',(select count(*) from filtered),
    'regions',coalesce((select jsonb_agg(x.city) from (select distinct city from accessible where city<>'' order by city limit 200) x),'[]'::jsonb),
    'tags',coalesce((select jsonb_agg(x.tag) from (select distinct unnest(tags) as tag from accessible order by tag limit 200) x),'[]'::jsonb),
    'types',coalesce((select jsonb_agg(x.contact_type) from (select distinct contact_type from accessible order by contact_type) x),'[]'::jsonb));
$$;
revoke all on function public.portal_invitation_recipients(text,text,text,text,integer) from public,crm_system,crm_worker;
grant execute on function public.portal_invitation_recipients(text,text,text,text,integer) to crm_app;
