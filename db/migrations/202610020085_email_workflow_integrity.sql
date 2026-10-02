set search_path=public,extensions;

alter table public.customer_email_templates
  add column revision integer not null default 1 check(revision>0),
  add column archived_at timestamptz,
  add column visibility text not null default 'PERSONAL' check(visibility in ('PERSONAL','WORKSPACE'));

drop policy "owners manage customer email templates" on public.customer_email_templates;
create policy "read personal or workspace templates" on public.customer_email_templates for select to crm_app
  using(workspace_id=public.current_workspace_id() and public.is_workspace_member(workspace_id)
    and public.current_crm_role() in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER','SALES_SPECIALIST','SALES_SUPPORT')
    and (visibility='WORKSPACE' or owned_by=app_auth.current_user_id()));
create policy "write own or administrator workspace templates" on public.customer_email_templates for all to crm_app
  using(workspace_id=public.current_workspace_id() and public.is_workspace_member(workspace_id)
    and public.current_crm_role() in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER','SALES_SPECIALIST','SALES_SUPPORT')
    and ((visibility='PERSONAL' and owned_by=app_auth.current_user_id())
      or (visibility='WORKSPACE' and public.current_crm_role() in ('SUPER_ADMIN','ADMIN'))))
  with check(workspace_id=public.current_workspace_id() and public.is_workspace_member(workspace_id)
    and public.current_crm_role() in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER','SALES_SPECIALIST','SALES_SUPPORT')
    and ((visibility='PERSONAL' and owned_by=app_auth.current_user_id())
      or (visibility='WORKSPACE' and public.current_crm_role() in ('SUPER_ADMIN','ADMIN'))));

create function public.customer_email_template_revision()
returns trigger language plpgsql set search_path=public,extensions as $$
begin
  new.revision:=old.revision+1;
  new.updated_at:=clock_timestamp();
  return new;
end;
$$;
create trigger customer_email_template_revision before update on public.customer_email_templates
  for each row execute function public.customer_email_template_revision();

-- Invoker security retains the existing workspace and personal-owner policies.
-- The transaction lock also serializes concurrent first requests with the same UUID.
create function public.save_customer_email_template(target_template uuid, expected_revision integer,
  template_name text, template_content jsonb, archive boolean default false, template_visibility text default 'PERSONAL')
returns public.customer_email_templates language plpgsql security invoker
set search_path=public,app_auth,extensions as $$
declare existing public.customer_email_templates; result public.customer_email_templates;
begin
  if target_template is null or (expected_revision is not null and expected_revision<1)
    or template_visibility is null or template_visibility not in ('PERSONAL','WORKSPACE') then
    raise exception 'email_template_invalid';
  end if;
  if template_visibility='WORKSPACE' and public.current_crm_role() not in ('SUPER_ADMIN','ADMIN') then
    raise exception 'email_template_public_forbidden';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('email-template:'||target_template::text,0));
  select * into existing from public.customer_email_templates
    where id=target_template and workspace_id=public.current_workspace_id()
      and ((visibility='PERSONAL' and owned_by=app_auth.current_user_id())
        or (visibility='WORKSPACE' and public.current_crm_role() in ('SUPER_ADMIN','ADMIN'))) for update;
  if not found then
    if expected_revision is not null or archive then raise exception 'email_template_not_found'; end if;
    insert into public.customer_email_templates(id,name,content,visibility)
      values(target_template,trim(template_name),template_content,template_visibility) returning * into result;
    return result;
  end if;
  if expected_revision is null then
    if not archive and existing.revision=1 and existing.archived_at is null
      and existing.visibility=template_visibility and existing.name=trim(template_name) and existing.content=template_content then return existing; end if;
    raise exception 'email_template_idempotency_conflict';
  end if;
  if not archive and existing.visibility<>template_visibility then raise exception 'email_template_version_conflict'; end if;
  -- An identical retry after a lost response returns the accepted revision.
  if existing.revision=expected_revision+1 and (
    (archive and existing.archived_at is not null) or
    (not archive and existing.archived_at is null and existing.name=trim(template_name) and existing.content=template_content)
  ) then return existing; end if;
  if existing.archived_at is not null then raise exception 'email_template_not_found'; end if;
  if existing.revision<>expected_revision then raise exception 'email_template_version_conflict'; end if;
  if archive then
    update public.customer_email_templates set archived_at=clock_timestamp() where id=target_template returning * into result;
  else
    update public.customer_email_templates set name=trim(template_name),content=template_content
      where id=target_template returning * into result;
  end if;
  return result;
end;
$$;
revoke all on function public.save_customer_email_template(uuid,integer,text,jsonb,boolean,text) from public,crm_system,crm_worker;
grant execute on function public.save_customer_email_template(uuid,integer,text,jsonb,boolean,text) to crm_app;

-- Return only accessible IDs and eligibility, never consent evidence or private fields.
create function public.customer_email_eligibility(contact_ids uuid[], message_purpose text)
returns table(id uuid,allowed boolean) language sql stable security invoker
set search_path=public,app_auth,extensions as $$
  select c.id,public.contact_channel_allowed(c.id,'EMAIL',message_purpose)
  from public.contacts c where c.id=any(contact_ids) and c.archived_at is null
    and c.workspace_id=public.current_workspace_id() and cardinality(contact_ids) between 1 and 50
    and message_purpose in ('SERVICE','MARKETING');
$$;
revoke all on function public.customer_email_eligibility(uuid[],text) from public,crm_system,crm_worker;
grant execute on function public.customer_email_eligibility(uuid[],text) to crm_app;
