-- Contract drafting and renewal are explicit, audited workflows.

create or replace function public.create_contract_draft(contract_no text, target_organization uuid, target_product uuid, period_start date, period_end date, contract_currency text, contract_amount numeric, relationship smallint default 1)
returns public.contracts language plpgsql security definer set search_path=public
as $$
declare result public.contracts; organization public.organizations;
begin
  if public.current_crm_role() not in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER','SALES_SPECIALIST') then raise exception 'contract_not_authorized'; end if;
  if nullif(trim(contract_no),'') is null or period_end<period_start or contract_amount<0 or contract_currency!~'^[A-Z]{3}$' or relationship not between 1 and 4 then raise exception 'contract_invalid'; end if;
  select * into organization from public.organizations where id=target_organization and workspace_id=public.current_workspace_id();
  if not found or not public.can_access_owned_record(organization.workspace_id,'ORGANIZATION',organization.id,organization.owner_id,false) then raise exception 'contract_organization_not_found'; end if;
  if target_product is not null and not exists(select 1 from public.products where id=target_product and workspace_id=organization.workspace_id and active) then raise exception 'contract_product_not_found'; end if;
  insert into public.contracts(workspace_id,contract_number,organization_id,product_id,start_date,end_date,currency,contract_value,status,relationship_level,owner_id,created_by)
  values(organization.workspace_id,trim(contract_no),organization.id,target_product,period_start,period_end,contract_currency,contract_amount,'DRAFT',relationship,auth.uid(),auth.uid()) returning * into result;
  return result;
end; $$;

create or replace function public.create_contract_renewal(source_contract uuid)
returns public.contracts language plpgsql security definer set search_path=public
as $$
declare source public.contracts; result public.contracts; next_start date; next_end date; next_number text;
begin
  select * into source from public.contracts where id=source_contract and workspace_id=public.current_workspace_id() for update;
  if not found or source.status not in ('ACTIVE','RENEWAL_PREP','NEGOTIATING','RISK') then raise exception 'renewal_source_invalid'; end if;
  if not public.can_access_owned_record(source.workspace_id,'CONTRACT',source.id,source.owner_id,true) then raise exception 'contract_not_authorized'; end if;
  if exists(select 1 from public.contracts where renewal_of_id=source.id) then raise exception 'renewal_already_exists'; end if;
  next_start:=source.end_date+1;next_end:=next_start+(source.end_date-source.start_date);next_number:=source.contract_number||'-R'||extract(year from next_start)::integer;
  insert into public.contracts(workspace_id,contract_number,organization_id,product_id,start_date,end_date,currency,contract_value,status,relationship_level,owner_id,created_by,renewal_of_id)
  values(source.workspace_id,next_number,source.organization_id,source.product_id,next_start,next_end,source.currency,source.contract_value,'DRAFT',source.relationship_level,coalesce(source.owner_id,auth.uid()),auth.uid(),source.id) returning * into result;
  update public.contracts set status='RENEWAL_PREP',updated_at=now() where id=source.id and status='ACTIVE';
  return result;
end; $$;

revoke all on function public.create_contract_draft(text,uuid,uuid,date,date,text,numeric,smallint),public.create_contract_renewal(uuid) from public;
grant execute on function public.create_contract_draft(text,uuid,uuid,date,date,text,numeric,smallint),public.create_contract_renewal(uuid) to authenticated;
