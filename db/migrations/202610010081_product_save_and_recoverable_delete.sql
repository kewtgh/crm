-- Additive repair: keep all existing migration checksums intact.
-- Deleted products remain available to historical contracts, payments and quotes.
set search_path=public,app_auth,extensions;
alter table public.products add column if not exists archived_at timestamptz;
create index if not exists products_workspace_archived_idx
  on public.products(workspace_id,archived_at) where archived_at is not null;

create or replace function public.archive_product_record(target_product uuid,expected_updated_at timestamptz)
returns public.products language plpgsql security definer set search_path=public,app_auth,extensions as $$
declare result public.products;
begin
  if app_auth.current_user_id() is null
    or public.current_crm_role() not in ('SUPER_ADMIN','ADMIN')
    or coalesce(app_auth.current_claims()->>'aal','aal1')<>'aal2' then
    raise exception 'product_delete_not_authorized';
  end if;
  select * into result from public.products
    where id=target_product and workspace_id=public.current_workspace_id() for update;
  if not found then raise exception 'product_not_found'; end if;
  -- A repeated delete is harmless; a stale delete must not remove a newer edit.
  if result.archived_at is not null then return result; end if;
  if expected_updated_at is null or result.updated_at<>expected_updated_at then
    raise exception 'product_version_conflict';
  end if;
  update public.products set archived_at=now(),active=false,is_default=false,updated_at=now()
    where id=result.id returning * into result;
  return result;
end;
$$;
revoke all on function public.archive_product_record(uuid,timestamptz) from public;
grant execute on function public.archive_product_record(uuid,timestamptz) to crm_app;

-- Existing bundle versions must not provide a route back to selling deleted products.
create or replace function public.guard_quote_archived_products()
returns trigger language plpgsql security definer set search_path=public,app_auth,extensions as $$
begin
  if new.product_id is not null then
    perform 1 from public.products where id=new.product_id and workspace_id=new.workspace_id
      and archived_at is null for share;
    if not found then raise exception 'quote_product_invalid'; end if;
  end if;
  return new;
end;
$$;
revoke all on function public.guard_quote_archived_products() from public;
create trigger quotes_guard_archived_products before insert on public.quotes
  for each row execute function public.guard_quote_archived_products();

create or replace function public.guard_quote_bundle_archived_products()
returns trigger language plpgsql security definer set search_path=public,app_auth,extensions as $$
declare item record;
begin
  if new.version=1 and new.bundle_id is not null then
    for item in select p.archived_at from public.products p
      join public.product_bundle_items i on i.product_id=p.id
      where i.bundle_id=new.bundle_id order by p.id for share of p loop
      if item.archived_at is not null then raise exception 'quote_bundle_invalid'; end if;
    end loop;
  end if;
  return new;
end;
$$;
revoke all on function public.guard_quote_bundle_archived_products() from public;
create trigger quote_versions_guard_archived_products before insert on public.quote_versions
  for each row execute function public.guard_quote_bundle_archived_products();

create or replace function public.update_product_record(
  target_product uuid,expected_updated_at timestamptz,product_code text,
  product_name_zh text,product_name_en text,product_billing text,
  product_duration_zh text,product_duration_en text,product_description_zh_markdown text,
  product_description_en_markdown text,product_lifecycle_status text,product_is_default boolean
) returns public.products language plpgsql security definer set search_path=public,app_auth,extensions
as $$
declare result public.products; normalized_lifecycle text:=upper(trim(product_lifecycle_status));
begin
  if public.current_crm_role() not in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR')
    or nullif(trim(product_code),'') is null or nullif(trim(product_name_zh),'') is null or nullif(trim(product_name_en),'') is null
    or upper(product_billing) not in ('PROJECT','TERM','MONTH','YEAR','SCHOOL_YEAR','SEASON')
    or nullif(trim(product_duration_zh),'') is null or nullif(trim(product_duration_en),'') is null
    or normalized_lifecycle not in ('DRAFT','ACTIVE','PAUSED') then raise exception 'product_update_forbidden'; end if;
  perform 1 from public.products where id=target_product and workspace_id=public.current_workspace_id()
    and archived_at is null for update;
  if not found then raise exception 'product_not_found'; end if;
  if coalesce(product_is_default,false) then
    update public.products set is_default=false,updated_at=now()
    where workspace_id=public.current_workspace_id() and is_default and id<>target_product;
  end if;
  update public.products set code=upper(trim(product_code)),name_zh=trim(product_name_zh),name_en=trim(product_name_en),
    billing_unit=upper(product_billing),duration_zh=trim(product_duration_zh),duration_en=trim(product_duration_en),
    description_zh_markdown=coalesce(product_description_zh_markdown,''),description_en_markdown=coalesce(product_description_en_markdown,''),
    lifecycle_status=normalized_lifecycle,active=normalized_lifecycle='ACTIVE',is_default=coalesce(product_is_default,false),updated_at=now()
  where id=target_product and workspace_id=public.current_workspace_id() and updated_at=expected_updated_at returning * into result;
  if not found then
    if exists(select 1 from public.products where id=target_product and workspace_id=public.current_workspace_id())
      then raise exception 'product_version_conflict'; else raise exception 'product_not_found'; end if;
  end if;
  return result;
end;
$$;

create or replace function public.idempotent_set_product_lifecycle(
  target_product uuid,target_status text,p_request_key text
) returns public.products language plpgsql security definer set search_path=public,app_auth,extensions
as $$
declare existing_operation text;existing_result jsonb;result public.products;normalized_status text:=upper(trim(target_status));
begin
  if app_auth.current_user_id() is null or length(p_request_key) not between 8 and 160
    or public.current_crm_role() not in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR')
    or coalesce(app_auth.current_claims()->>'aal','aal1')<>'aal2'
    or normalized_status not in ('DRAFT','ACTIVE','PAUSED') then raise exception 'product_update_not_authorized'; end if;
  perform pg_advisory_xact_lock(hashtextextended(public.current_workspace_id()::text||':'||p_request_key,0));
  select operation,mutation_receipts.result into existing_operation,existing_result from public.mutation_receipts
  where workspace_id=public.current_workspace_id() and request_key=p_request_key;
  if found then
    if existing_operation<>'PRODUCT_LIFECYCLE' then raise exception 'mutation_receipt_conflict'; end if;
    return jsonb_populate_record(null::public.products,existing_result);
  end if;
  update public.products set lifecycle_status=normalized_status,active=normalized_status='ACTIVE',updated_at=now()
  where id=target_product and workspace_id=public.current_workspace_id() and archived_at is null returning * into result;
  if not found then raise exception 'product_not_found'; end if;
  insert into public.mutation_receipts(workspace_id,request_key,operation,result,created_by)
  values(public.current_workspace_id(),p_request_key,'PRODUCT_LIFECYCLE',to_jsonb(result),app_auth.current_user_id());
  return result;
end;
$$;

create or replace function public.set_product_price(
  target_product uuid,price_currency text,price_amount numeric,effective_on date
)
returns public.product_prices
language plpgsql
security definer
set search_path=public,app_auth,extensions
as $$
declare
  result public.product_prices;
  current_price public.product_prices;
begin
  if public.current_crm_role() not in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR') then
    raise exception 'product_price_not_authorized';
  end if;
  if price_currency!~'^[A-Z]{3}$' or price_amount<0 or effective_on<current_date then
    raise exception 'product_price_invalid';
  end if;
  perform 1 from public.products
    where id=target_product and workspace_id=public.current_workspace_id() and archived_at is null for update;
  if not found then raise exception 'product_not_found'; end if;
  select * into current_price from public.product_prices
    where product_id=target_product and currency=price_currency
      and effective_to is null for update;
  if found then
    if current_price.effective_from=effective_on then
      update public.product_prices set amount=price_amount
        where id=current_price.id returning * into result;
      return result;
    end if;
    update public.product_prices set effective_to=effective_on-1 where id=current_price.id;
  end if;
  insert into public.product_prices(
    product_id,currency,amount,effective_from,created_by
  ) values(
    target_product,price_currency,price_amount,effective_on,app_auth.current_user_id()
  ) returning * into result;
  return result;
end;
$$;

create or replace function public.product_catalog_snapshot()
returns jsonb language sql stable security definer set search_path=public,app_auth,extensions
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',p.id,'nameZh',p.name_zh,'nameEn',p.name_en,'code',p.code,
    'billing',p.billing_unit,'durationZh',p.duration_zh,'durationEn',p.duration_en,
    'descriptionZhMarkdown',p.description_zh_markdown,'descriptionEnMarkdown',p.description_en_markdown,
    'active',p.active,'lifecycleStatus',p.lifecycle_status,'isDefault',p.is_default,'updatedAt',p.updated_at,
    'prices',coalesce(price_rows.items,'[]'::jsonb),'metrics',coalesce(metric_rows.items,'{}'::jsonb),
    'purchasers',coalesce(purchaser_rows.items,'[]'::jsonb)
  ) order by case p.lifecycle_status when 'ACTIVE' then 0 when 'DRAFT' then 1 else 2 end,p.is_default desc,p.name_en),'[]'::jsonb)
  from public.products p
  left join lateral (
    select jsonb_agg(jsonb_build_object('currency',pp.currency,'amount',pp.amount,'effectiveFrom',pp.effective_from)
      order by case when pp.currency='CNY' then 0 else 1 end,pp.currency) items
    from public.product_prices pp where pp.product_id=p.id and pp.effective_from<=current_date
      and (pp.effective_to is null or pp.effective_to>=current_date)
  ) price_rows on true
  left join lateral (
    select jsonb_object_agg(m.currency,jsonb_build_object('revenue',m.revenue,'customers',m.customers)) items
    from (select pay.currency,sum(greatest(pay.amount-coalesce(pay.refunded_amount,0),0)) revenue,
      count(distinct con.organization_id) customers from public.payments pay join public.contracts con on con.id=pay.contract_id
      where pay.workspace_id=p.workspace_id and pay.product_id=p.id and pay.status='CONFIRMED' group by pay.currency) m
  ) metric_rows on true
  left join lateral (
    select jsonb_agg(jsonb_build_object(
      'organizationId',buyer.organization_id,'nameZh',buyer.name_zh,'nameEn',buyer.name_en,
      'contractId',buyer.contract_id,'contractNumber',buyer.contract_number,'contractStatus',buyer.contract_status,
      'relationshipLevel',buyer.relationship_level,'currency',buyer.currency,'contractValue',buyer.contract_value,'confirmedSpend',buyer.confirmed_spend
    ) order by buyer.name_en,buyer.contract_number) items
    from (
      select organization.id organization_id,organization.name_zh,organization.name_en,contract.id contract_id,
        contract.contract_number,contract.status contract_status,contract.relationship_level,contract.currency,contract.contract_value,
        coalesce(sum(greatest(payment.amount-coalesce(payment.refunded_amount,0),0))
          filter(where payment.status='CONFIRMED' and (payment.product_id=p.id or payment.product_id is null)),0) confirmed_spend
      from public.contracts contract join public.organizations organization on organization.id=contract.organization_id and organization.workspace_id=contract.workspace_id
      left join public.payments payment on payment.contract_id=contract.id and payment.workspace_id=contract.workspace_id
      where contract.workspace_id=p.workspace_id and contract.product_id=p.id
      group by organization.id,organization.name_zh,organization.name_en,contract.id,contract.contract_number,
        contract.status,contract.relationship_level,contract.currency,contract.contract_value
    ) buyer
  ) purchaser_rows on true
  where p.workspace_id=public.current_workspace_id() and p.archived_at is null;
$$;

create or replace function public.restore_crm_recycle_bin(entity_kind text, entity_id uuid)
returns boolean language plpgsql security definer set search_path=public,app_auth,extensions as $$
declare restored integer:=0; kind text:=upper(trim(entity_kind)); ws uuid:=public.current_workspace_id();
begin
  if app_auth.current_user_id() is null or public.current_crm_role()<>'SUPER_ADMIN' then raise exception 'super_admin_required'; end if;
  if coalesce(app_auth.current_claims()->>'aal','aal1')<>'aal2' then raise exception 'mfa_required'; end if;
  if kind='PRODUCT' then
    update public.products set archived_at=null,active=lifecycle_status='ACTIVE',updated_at=now()
      where id=entity_id and workspace_id=ws and archived_at is not null;
  elsif kind='ORGANIZATION' then
    update public.organizations set archived_at=null,updated_at=now() where id=entity_id and workspace_id=ws and archived_at is not null;
  elsif kind='CONTACT' then
    update public.contacts set archived_at=null,updated_at=now() where id=entity_id and workspace_id=ws and archived_at is not null;
  elsif kind='TASK' then
    update public.crm_tasks set archived_at=null,updated_at=now() where id=entity_id and workspace_id=ws and archived_at is not null;
  elsif kind='STUDENT' then
    update public.students set archived_at=null,status='ACTIVE',updated_at=now() where id=entity_id and workspace_id=ws and archived_at is not null;
  elsif kind='HOUSEHOLD' then
    update public.households set archived_at=null,status='ACTIVE',updated_at=now() where id=entity_id and workspace_id=ws and archived_at is not null;
  else
    raise exception 'recycle_entity_invalid';
  end if;
  get diagnostics restored=row_count;
  if restored=0 then raise exception 'recycle_entity_not_found'; end if;
  return true;
end;
$$;
revoke all on function public.restore_crm_recycle_bin(text,uuid) from public,crm_system;
grant execute on function public.restore_crm_recycle_bin(text,uuid) to crm_app;

-- Historical references retain archived products; only unused products expire.
create or replace function public.purge_expired_crm_recycle_bin()
returns integer language plpgsql security definer set search_path=public,app_auth,extensions as $$
declare removed integer:=0; affected integer; candidate uuid;
begin
  if app_auth.current_db_role()<>'service_role' then raise exception 'service_role_required'; end if;
  for candidate in select id from public.products where archived_at<now()-interval '30 days' for update skip locked loop
    begin
      delete from public.products p where p.id=candidate
        and not exists(select 1 from public.contracts where product_id=p.id)
        and not exists(select 1 from public.payments where product_id=p.id)
        and not exists(select 1 from public.opportunities where product_id=p.id)
        and not exists(select 1 from public.quotes where product_id=p.id)
        and not exists(select 1 from public.product_bundle_items where product_id=p.id);
      get diagnostics affected=row_count; removed:=removed+affected;
    exception when foreign_key_violation then
      -- A concurrent or future reference must not abort the other cleanup work.
      null;
    end;
  end loop;
  delete from public.students where archived_at<now()-interval '30 days'; get diagnostics affected=row_count; removed:=removed+affected;
  delete from public.households where archived_at<now()-interval '30 days'; get diagnostics affected=row_count; removed:=removed+affected;
  delete from public.contacts where archived_at<now()-interval '30 days'; get diagnostics affected=row_count; removed:=removed+affected;
  delete from public.organizations where archived_at<now()-interval '30 days'; get diagnostics affected=row_count; removed:=removed+affected;
  delete from public.crm_tasks where archived_at<now()-interval '30 days'; get diagnostics affected=row_count; removed:=removed+affected;
  return removed;
end;
$$;
revoke all on function public.purge_expired_crm_recycle_bin() from public,crm_app;
grant execute on function public.purge_expired_crm_recycle_bin() to crm_system,crm_worker;
