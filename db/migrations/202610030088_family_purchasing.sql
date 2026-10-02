-- Explicit purchasing parties: acquisition channel is not the buyer.
set search_path=public,extensions;
alter table public.contracts alter column organization_id drop not null;
alter table public.quotes alter column organization_id drop not null;
alter table public.contracts add column household_id uuid,
  add constraint contracts_workspace_household_fk foreign key(workspace_id,household_id) references public.households(workspace_id,id),
  add constraint contracts_one_buyer check(num_nonnulls(organization_id,household_id)=1);
alter table public.quotes add column household_id uuid,
  add constraint quotes_workspace_household_fk foreign key(workspace_id,household_id) references public.households(workspace_id,id),
  add constraint quotes_one_buyer check(num_nonnulls(organization_id,household_id)=1);
create index contracts_household_idx on public.contracts(workspace_id,household_id);
create index quotes_household_idx on public.quotes(workspace_id,household_id);
create view public.financial_customer_names with(security_invoker=true) as
 select id,workspace_id,name_zh,name_en,organization_type,'ORGANIZATION'::text buyer_type from public.organizations
 union all select id,workspace_id,name_zh,name_en,'FAMILY'::text,'HOUSEHOLD'::text from public.households;
grant select on public.financial_customer_names to crm_app;

create function public.create_buyer_contract(contract_no text,target_organization uuid,target_household uuid,target_product uuid,period_start date,period_end date,contract_currency text,contract_amount numeric,relationship smallint default 1)
returns public.contracts language plpgsql security definer set search_path=public,app_auth,extensions as $$
declare result public.contracts; ws uuid:=public.current_workspace_id();
begin
 if public.current_crm_role() not in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER','SALES_SPECIALIST')
   or app_auth.current_user_id() is null then raise exception 'contract_not_authorized'; end if;
 if num_nonnulls(target_organization,target_household)<>1 or contract_no is null or length(trim(contract_no)) not between 2 and 80
   or period_start is null or period_end is null or period_end<period_start or contract_amount is null or contract_amount<0
   or contract_amount<>round(contract_amount,2) or contract_currency is null or contract_currency!~'^[A-Z]{3}$'
   or relationship is null or relationship not between 1 and 4 then raise exception 'contract_invalid'; end if;
 if not public.customer_subject_access(case when target_household is null then 'ORGANIZATION' else 'HOUSEHOLD' end,coalesce(target_household,target_organization),false)
   then raise exception 'contract_buyer_not_found'; end if;
 if target_product is not null and not exists(select 1 from public.products where id=target_product and workspace_id=ws and active and archived_at is null)
   then raise exception 'contract_product_not_found'; end if;
 insert into public.contracts(workspace_id,contract_number,organization_id,household_id,product_id,start_date,end_date,currency,contract_value,status,relationship_level,owner_id,created_by)
 values(ws,trim(contract_no),target_organization,target_household,target_product,period_start,period_end,contract_currency,contract_amount,'DRAFT',relationship,app_auth.current_user_id(),app_auth.current_user_id()) returning * into result;
 return result;
end $$;
revoke all on function public.create_buyer_contract(text,uuid,uuid,uuid,date,date,text,numeric,smallint) from public,crm_system;
grant execute on function public.create_buyer_contract(text,uuid,uuid,uuid,date,date,text,numeric,smallint) to crm_app;
create or replace function public.create_contract_draft(contract_no text,target_organization uuid,target_product uuid,period_start date,period_end date,contract_currency text,contract_amount numeric,relationship smallint default 1)
returns public.contracts language sql security invoker set search_path=public,app_auth,extensions as $$
 select public.create_buyer_contract(contract_no,target_organization,null,target_product,period_start,period_end,contract_currency,contract_amount,relationship);
$$;
create or replace function public.create_contract_renewal(source_contract uuid)
returns public.contracts language plpgsql security definer set search_path=public,app_auth,extensions
as $$
declare source public.contracts; result public.contracts; next_start date; next_end date; next_number text;
begin
  select * into source from public.contracts where id=source_contract and workspace_id=public.current_workspace_id() for update;
  if not found or source.status not in ('ACTIVE','RENEWAL_PREP','NEGOTIATING','RISK') then raise exception 'renewal_source_invalid'; end if;
  if not public.can_access_owned_record(source.workspace_id,'CONTRACT',source.id,source.owner_id,true) then raise exception 'contract_not_authorized'; end if;
  if exists(select 1 from public.contracts where renewal_of_id=source.id) then raise exception 'renewal_already_exists'; end if;
  next_start:=source.end_date+1;next_end:=next_start+(source.end_date-source.start_date);next_number:=source.contract_number||'-R'||extract(year from next_start)::integer;
  insert into public.contracts(workspace_id,contract_number,organization_id,household_id,product_id,start_date,end_date,currency,contract_value,status,relationship_level,owner_id,created_by,renewal_of_id)
  values(source.workspace_id,next_number,source.organization_id,source.household_id,source.product_id,next_start,next_end,source.currency,source.contract_value,'DRAFT',source.relationship_level,coalesce(source.owner_id,app_auth.current_user_id()),app_auth.current_user_id(),source.id) returning * into result;
  update public.contracts set status='RENEWAL_PREP',updated_at=now() where id=source.id and status='ACTIVE';
  return result;
end; $$;
create or replace function public.create_buyer_quote(
  quote_no text,target_organization uuid,target_household uuid,target_opportunity uuid,target_product uuid,
  target_bundle uuid,target_exchange_rate uuid,quote_currency text,
  quote_subtotal numeric,quote_discount numeric,valid_through date,
  terms_zh text default '',terms_en text default ''
)
returns public.quotes
language plpgsql
security definer
set search_path=public,app_auth,extensions
as $$
declare
  result public.quotes;
  organization public.organizations;
  bundle public.product_bundles;
  rate public.exchange_rate_snapshots;
  base text;
  base_total numeric;
  line_items jsonb:='[]'::jsonb;
  ceiling numeric;
begin
  if public.current_crm_role() not in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER','SALES_SPECIALIST')
    then raise exception 'quote_not_authorized'; end if;
  if num_nonnulls(target_organization,target_household)<>1 or not public.customer_subject_access(
    case when target_household is null then 'ORGANIZATION' else 'HOUSEHOLD' end,coalesce(target_household,target_organization),true)
    then raise exception 'quote_not_authorized'; end if;
  organization.workspace_id:=public.current_workspace_id(); organization.id:=target_organization;
  if (target_product is null)=(target_bundle is null) then raise exception 'quote_product_or_bundle_required'; end if;
  if target_product is not null and not exists(select 1 from public.products where id=target_product and workspace_id=organization.workspace_id and active and archived_at is null)
    then raise exception 'quote_product_invalid'; end if;
  if target_opportunity is not null and not exists(select 1 from public.opportunities o where o.id=target_opportunity and o.workspace_id=organization.workspace_id
    and o.organization_id is not distinct from target_organization and o.household_id is not distinct from target_household
    and public.can_access_owned_record(o.workspace_id,'OPPORTUNITY',o.id,o.owner_id,false)) then raise exception 'quote_opportunity_invalid'; end if;
  if quote_no is null or quote_currency is null or quote_subtotal is null or quote_discount is null or valid_through is null
    or quote_subtotal<>round(quote_subtotal,2) or quote_discount<>round(quote_discount,2) then raise exception 'quote_invalid'; end if;
  select default_currency into base from public.workspaces where id=organization.workspace_id;
  if nullif(trim(quote_no),'') is null or upper(quote_currency)!~'^[A-Z]{3}$'
    or quote_subtotal<0 or quote_discount<0 or quote_discount>quote_subtotal
    or valid_through<current_date then raise exception 'quote_invalid'; end if;
  if target_bundle is not null then
    select * into bundle from public.product_bundles
      where id=target_bundle and workspace_id=organization.workspace_id
        and active and effective_to is null;
    if not found then raise exception 'quote_bundle_invalid'; end if;
    select min(discount_ceiling) into ceiling from public.product_bundle_items
      where bundle_id=bundle.id and not optional;
    if quote_subtotal>0 and quote_discount*100/quote_subtotal>coalesce(ceiling,0) then
      raise exception 'quote_bundle_discount_exceeded';
    end if;
    select coalesce(jsonb_agg(jsonb_build_object(
      'productId',i.product_id,'quantity',i.quantity,'optional',i.optional,
      'discountCeiling',i.discount_ceiling,'bundleId',bundle.id,
      'bundleVersion',bundle.version
    ) order by p.code),'[]'::jsonb) into line_items
    from public.product_bundle_items i join public.products p on p.id=i.product_id
    where i.bundle_id=bundle.id;
  end if;
  if upper(quote_currency)=base then
    if target_exchange_rate is not null then raise exception 'quote_exchange_rate_invalid'; end if;
    base_total:=quote_subtotal-quote_discount;
  else
    select * into rate from public.exchange_rate_snapshots rates
      where rates.id=target_exchange_rate
        and rates.workspace_id=organization.workspace_id
        and rates.base_currency=base
        and rates.quote_currency=upper(create_buyer_quote.quote_currency)
        and rates.effective_at<=now();
    if not found then raise exception 'quote_exchange_rate_required'; end if;
    base_total:=round((quote_subtotal-quote_discount)/rate.rate,2);
  end if;
  insert into public.quotes(
    workspace_id,quote_number,organization_id,household_id,opportunity_id,product_id,
    currency,valid_until,owner_id,created_by
  ) values(
    organization.workspace_id,trim(quote_no),organization.id,target_household,target_opportunity,
    coalesce(target_product,(select product_id from public.product_bundle_items
      where bundle_id=bundle.id and not optional order by product_id limit 1)),
    upper(quote_currency),valid_through,app_auth.current_user_id(),app_auth.current_user_id()
  ) returning * into result;
  insert into public.quote_versions(
    workspace_id,quote_id,version,subtotal,discount_amount,terms_zh,terms_en,
    line_items,bundle_id,bundle_version,exchange_rate_snapshot_id,
    base_currency,base_total_amount,created_by
  ) values(
    result.workspace_id,result.id,1,quote_subtotal,quote_discount,
    trim(coalesce(terms_zh,'')),trim(coalesce(terms_en,'')),line_items,
    bundle.id,bundle.version,rate.id,base,base_total,app_auth.current_user_id()
  );
  return result;
end;
$$;
revoke all on function public.create_buyer_quote(text,uuid,uuid,uuid,uuid,uuid,uuid,text,numeric,numeric,date,text,text) from public,crm_system;
grant execute on function public.create_buyer_quote(text,uuid,uuid,uuid,uuid,uuid,uuid,text,numeric,numeric,date,text,text) to crm_app;
create or replace function public.convert_quote_to_contract(
  target_quote uuid,contract_no text,period_start date,period_end date
)
returns public.contracts
language plpgsql
security definer
set search_path=public,app_auth,extensions
as $$
declare quote public.quotes;selected_version public.quote_versions;result public.contracts;
begin
  select * into quote from public.quotes q
    where q.id=target_quote and q.workspace_id=public.current_workspace_id() for update;
  if not found or quote.status<>'ACCEPTED' or period_start is null or period_end is null or nullif(trim(contract_no),'') is null or period_end<period_start
    or not public.can_access_owned_record(quote.workspace_id,'QUOTE',quote.id,quote.owner_id,true)
  then raise exception 'quote_not_convertible'; end if;
  select * into selected_version from public.quote_versions qv
    where qv.quote_id=quote.id and qv.version=quote.current_version;
  insert into public.contracts(
    workspace_id,contract_number,organization_id,household_id,product_id,start_date,end_date,
    currency,contract_value,status,owner_id,created_by,quote_id,
    exchange_rate_snapshot_id,base_currency,base_contract_value
  ) values(
    quote.workspace_id,trim(contract_no),quote.organization_id,quote.household_id,quote.product_id,
    period_start,period_end,quote.currency,selected_version.total_amount,'DRAFT',
    quote.owner_id,app_auth.current_user_id(),quote.id,selected_version.exchange_rate_snapshot_id,
    selected_version.base_currency,selected_version.base_total_amount
  ) returning * into result;
  update public.quotes set status='CONVERTED',updated_at=now() where id=quote.id;
  return result;
end;
$$;
create or replace function public.contract_summary()
returns jsonb
language sql
stable
security invoker
set search_path=public,app_auth,extensions
as $$
  select jsonb_build_object(
    'validCount',count(*) filter(where c.status not in ('CANCELLED','EXPIRED')),
    'renewalCount',count(*) filter(where c.status in ('ACTIVE','RENEWAL_PREP','NEGOTIATING','RISK')
      and c.end_date between current_date and current_date+90),
    'under30Count',count(*) filter(where c.status in ('ACTIVE','RENEWAL_PREP','NEGOTIATING','RISK')
      and c.end_date between current_date and current_date+30),
    'riskCount',count(*) filter(where c.status='RISK'),
    'renewalByCurrency',coalesce((
      select jsonb_object_agg(currency,total) from (
        select currency,sum(contract_value) total from public.contracts
        where workspace_id=public.current_workspace_id()
          and status in ('ACTIVE','RENEWAL_PREP','NEGOTIATING','RISK')
          and end_date between current_date and current_date+90 group by currency
      ) totals
    ),'{}'::jsonb),
    'lifecycle',jsonb_build_object(
      'draft',count(*) filter(where c.status in ('DRAFT','PENDING_APPROVAL')),
      'active',count(*) filter(where c.status='ACTIVE'),
      'preparing',count(*) filter(where c.status='RENEWAL_PREP'),
      'negotiating',count(*) filter(where c.status='NEGOTIATING'),
      'risk',count(*) filter(where c.status='RISK')
    ),
    'renewalAlerts',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',r.id,'customer',o.name_zh,'english',o.name_en,
        'start',r.start_date,'end',r.end_date,
        'days',r.end_date-current_date,'value',r.contract_value,
        'currency',r.currency,'owner',coalesce(m.name_zh||' / '||m.name_en,'—'),
        'status',r.status,'relationLevel',r.relationship_level
      ) order by r.end_date)
      from public.contracts r
      join public.financial_customer_names o on o.id=coalesce(r.organization_id,r.household_id) and o.buyer_type=case when r.household_id is null then 'ORGANIZATION' else 'HOUSEHOLD' end
      left join public.sales_team_members m on m.auth_user_id=r.owner_id
        and m.workspace_id=r.workspace_id
      where r.workspace_id=public.current_workspace_id()
        and r.status in ('ACTIVE','RENEWAL_PREP','NEGOTIATING','RISK')
        and r.end_date<=current_date+90
    ),'[]'::jsonb)
  )
  from public.contracts c where c.workspace_id=public.current_workspace_id();
$$;
create or replace function public.consumption_report(
  report_period text,report_currency text default null
)
returns jsonb
language plpgsql
stable
security invoker
set search_path=public,app_auth,extensions
as $$
declare
  ws uuid:=public.current_workspace_id();
  range_start date;
  range_end date;
  previous_start date;
  selected_currency text;
  total numeric:=0;
  previous_total numeric:=0;
  orders bigint:=0;
  renewal_rate numeric:=0;
  result jsonb;
begin
  if ws is null or report_period not in ('month','quarter','year') then
    raise exception 'analytics_invalid_request';
  end if;
  if report_period='month' then
    range_start:=date_trunc('month',current_date)::date;
    range_end:=(range_start+interval '1 month')::date;
    previous_start:=(range_start-interval '1 month')::date;
  elsif report_period='quarter' then
    range_start:=date_trunc('quarter',current_date)::date;
    range_end:=(range_start+interval '3 months')::date;
    previous_start:=(range_start-interval '3 months')::date;
  else
    range_start:=date_trunc('year',current_date)::date;
    range_end:=(range_start+interval '1 year')::date;
    previous_start:=(range_start-interval '1 year')::date;
  end if;
  select coalesce(upper(report_currency),w.default_currency)
    into selected_currency from public.workspaces w where w.id=ws;
  if selected_currency!~'^[A-Z]{3}$' then raise exception 'analytics_invalid_currency'; end if;
  select coalesce(sum(amount),0),count(*) into total,orders
    from public.payments
    where workspace_id=ws and status='CONFIRMED' and currency=selected_currency
      and paid_at>=range_start and paid_at<range_end;
  select coalesce(sum(amount),0) into previous_total
    from public.payments
    where workspace_id=ws and status='CONFIRMED' and currency=selected_currency
      and paid_at>=previous_start and paid_at<range_start;
  select case when count(*)=0 then 0 else round(
    100.0*count(*) filter(where exists(
      select 1 from public.contracts child
      where child.renewal_of_id=base.id
        and child.status in ('ACTIVE','RENEWAL_PREP','NEGOTIATING')
    ))/count(*),1) end
  into renewal_rate
  from public.contracts base
  where base.workspace_id=ws and base.end_date>=range_start
    and base.end_date<range_end and base.status<>'CANCELLED';
  select jsonb_build_object(
    'period',report_period,
    'label',range_start::text||' — '||(range_end-1)::text,
    'currency',selected_currency,
    'availableCurrencies',coalesce((
      select jsonb_agg(currency order by currency)
      from (
        select distinct currency from public.payments
        where workspace_id=ws and status='CONFIRMED'
      ) available
    ),'[]'::jsonb),
    'total',total,
    'orders',orders,
    'average',case when orders=0 then 0 else round(total/orders) end,
    'renewal',renewal_rate,
    'compare',case when previous_total=0 then 0
      else round(100*(total-previous_total)/previous_total,1) end,
    'newCustomerTotal',coalesce((
      select sum(p.amount)
      from public.payments p
      join public.contracts c on c.id=p.contract_id
      where p.workspace_id=ws and p.status='CONFIRMED'
        and p.currency=selected_currency
        and p.paid_at>=range_start and p.paid_at<range_end
        and not exists(
          select 1 from public.payments older
          join public.contracts older_c on older_c.id=older.contract_id
          where older.status='CONFIRMED' and older.workspace_id=ws
            and older_c.organization_id is not distinct from c.organization_id and older_c.household_id is not distinct from c.household_id
            and older.paid_at<range_start
        )
    ),0),
    'trend',coalesce((
      select jsonb_agg(jsonb_build_array(label,amount) order by sort_key)
      from (
        select
          case
            when report_period='month' then
              'W'||(floor((extract(day from paid_at)::int-1)/7)+1)::int::text
            when report_period='quarter' then to_char(paid_at,'YYYY-MM')
            else 'Q'||extract(quarter from paid_at)::int::text
          end label,
          case
            when report_period='month' then floor((extract(day from paid_at)::int-1)/7)+1
            when report_period='quarter' then extract(month from paid_at)
            else extract(quarter from paid_at)
          end sort_key,
          sum(amount) amount
        from public.payments
        where workspace_id=ws and status='CONFIRMED' and currency=selected_currency
          and paid_at>=range_start and paid_at<range_end
        group by 1,2
      ) trend_rows
    ),'[]'::jsonb),
    'productMix',coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'nameZh',name_zh,'nameEn',name_en,'value',amount,'customers',customers
        ) order by amount desc
      )
      from (
        select coalesce(pr.name_zh,'其他') name_zh,
          coalesce(pr.name_en,'Other') name_en,sum(p.amount) amount,
          count(distinct (c.organization_id,c.household_id)) customers
        from public.payments p
        join public.contracts c on c.id=p.contract_id
        left join public.products pr on pr.id=p.product_id
        where p.workspace_id=ws and p.status='CONFIRMED'
          and p.currency=selected_currency
          and p.paid_at>=range_start and p.paid_at<range_end
        group by pr.id,pr.name_zh,pr.name_en
      ) mix
    ),'[]'::jsonb),
    'topCustomers',coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'nameZh',name_zh,'nameEn',name_en,
          'customerType',lower(organization_type),
          'productsZh',products_zh,'productsEn',products_en,'amount',amount
        ) order by amount desc
      )
      from (
        select o.id,o.name_zh,o.name_en,o.organization_type,
          sum(p.amount) amount,
          array_remove(array_agg(distinct pr.name_zh),null) products_zh,
          array_remove(array_agg(distinct pr.name_en),null) products_en
        from public.payments p
        join public.contracts c on c.id=p.contract_id
        join public.financial_customer_names o on o.id=coalesce(c.organization_id,c.household_id) and o.buyer_type=case when c.household_id is null then 'ORGANIZATION' else 'HOUSEHOLD' end
        left join public.products pr on pr.id=p.product_id
        where p.workspace_id=ws and p.status='CONFIRMED'
          and p.currency=selected_currency
          and p.paid_at>=range_start and p.paid_at<range_end
        group by o.id,o.name_zh,o.name_en,o.organization_type
        order by amount desc limit 10
      ) customers
    ),'[]'::jsonb)
  ) into result;
  return result;
end;
$$;
create or replace function public.product_catalog_snapshot()
returns jsonb language sql stable security invoker set search_path=public,app_auth,extensions
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
      count(distinct (con.organization_id,con.household_id)) customers from public.payments pay join public.contracts con on con.id=pay.contract_id
      where pay.workspace_id=p.workspace_id and pay.product_id=p.id and pay.status='CONFIRMED' group by pay.currency) m
  ) metric_rows on true
  left join lateral (
    select jsonb_agg(jsonb_build_object(
      'organizationId',buyer.organization_id,'buyerType',buyer.buyer_type,'nameZh',buyer.name_zh,'nameEn',buyer.name_en,
      'contractId',buyer.contract_id,'contractNumber',buyer.contract_number,'contractStatus',buyer.contract_status,
      'relationshipLevel',buyer.relationship_level,'currency',buyer.currency,'contractValue',buyer.contract_value,'confirmedSpend',buyer.confirmed_spend
    ) order by buyer.name_en,buyer.contract_number) items
    from (
      select organization.buyer_type,organization.id organization_id,organization.name_zh,organization.name_en,contract.id contract_id,
        contract.contract_number,contract.status contract_status,contract.relationship_level,contract.currency,contract.contract_value,
        coalesce(sum(greatest(payment.amount-coalesce(payment.refunded_amount,0),0))
          filter(where payment.status='CONFIRMED' and (payment.product_id=p.id or payment.product_id is null)),0) confirmed_spend
      from public.contracts contract join public.financial_customer_names organization on organization.id=coalesce(contract.organization_id,contract.household_id) and organization.buyer_type=case when contract.household_id is null then 'ORGANIZATION' else 'HOUSEHOLD' end and organization.workspace_id=contract.workspace_id
      left join public.payments payment on payment.contract_id=contract.id and payment.workspace_id=contract.workspace_id
      where contract.workspace_id=p.workspace_id and contract.product_id=p.id
      group by organization.buyer_type,organization.id,organization.name_zh,organization.name_en,contract.id,contract.contract_number,
        contract.status,contract.relationship_level,contract.currency,contract.contract_value
    ) buyer
  ) purchaser_rows on true
  where p.workspace_id=public.current_workspace_id() and p.archived_at is null;
$$;
