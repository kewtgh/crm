-- v0.9.0: final function-body corrections found by plpgsql_check.
-- This forward migration keeps already-upgraded environments aligned while the
-- original 025/026 definitions remain clean for new installations.

create or replace function public.create_quote(
  quote_no text,target_organization uuid,target_opportunity uuid,target_product uuid,
  quote_currency text,quote_subtotal numeric,quote_discount numeric,valid_through date,
  terms_zh text default '',terms_en text default ''
)
returns public.quotes
language plpgsql
security definer
set search_path=public
as $$
declare
  result public.quotes;
  organization public.organizations;
  opportunity public.opportunities;
begin
  select * into organization from public.organizations
    where id=target_organization and workspace_id=public.current_workspace_id();
  if not found
    or not public.can_access_owned_record(
      organization.workspace_id,'ORGANIZATION',organization.id,organization.owner_id,true
    ) then
    raise exception 'quote_not_authorized';
  end if;
  if target_opportunity is not null then
    select * into opportunity from public.opportunities
      where id=target_opportunity and workspace_id=organization.workspace_id
        and organization_id=organization.id;
    if not found
      or not public.can_access_owned_record(
        opportunity.workspace_id,'OPPORTUNITY',opportunity.id,opportunity.owner_id,false
      ) then
      raise exception 'quote_opportunity_invalid';
    end if;
  end if;
  if target_product is not null then
    perform 1 from public.products
      where id=target_product and workspace_id=organization.workspace_id and active;
    if not found then raise exception 'quote_product_invalid'; end if;
  end if;
  if nullif(trim(quote_no),'') is null or upper(quote_currency)!~'^[A-Z]{3}$'
    or quote_subtotal<0 or quote_discount<0 or quote_discount>quote_subtotal
    or valid_through<current_date then
    raise exception 'quote_invalid';
  end if;
  insert into public.quotes(
    workspace_id,quote_number,organization_id,opportunity_id,product_id,currency,
    valid_until,owner_id,created_by
  ) values(
    organization.workspace_id,trim(quote_no),organization.id,target_opportunity,target_product,
    upper(quote_currency),valid_through,auth.uid(),auth.uid()
  ) returning * into result;
  insert into public.quote_versions(
    workspace_id,quote_id,version,subtotal,discount_amount,terms_zh,terms_en,created_by
  ) values(
    result.workspace_id,result.id,1,quote_subtotal,quote_discount,
    trim(coalesce(terms_zh,'')),trim(coalesce(terms_en,'')),auth.uid()
  );
  return result;
end;
$$;

create or replace function public.explain_record_access(
  resource_type text,resource_id uuid,requested_action text default 'READ'
)
returns jsonb
language plpgsql
stable
security definer
set search_path=public
as $$
declare
  ws uuid:=public.current_workspace_id();
  normalized_type text:=upper(trim(resource_type));
  needs_edit boolean:=upper(trim(requested_action))<>'READ';
  target_owner uuid;
  target_status text;
  allowed boolean:=false;
  actor_role text:=public.current_crm_role();
  explanation text;
begin
  if ws is null or actor_role='' then raise exception 'permission_explanation_not_authorized'; end if;
  if normalized_type='ORGANIZATION' then
    select owner_id,status into target_owner,target_status
      from public.organizations where id=$2 and workspace_id=ws;
  elsif normalized_type='CONTACT' then
    select owner_id,status into target_owner,target_status
      from public.contacts where id=$2 and workspace_id=ws;
  elsif normalized_type='OPPORTUNITY' then
    select owner_id,stage into target_owner,target_status
      from public.opportunities where id=$2 and workspace_id=ws;
  elsif normalized_type='CONTRACT' then
    select owner_id,status into target_owner,target_status
      from public.contracts where id=$2 and workspace_id=ws;
  elsif normalized_type='APPOINTMENT' then
    select owner_id,status into target_owner,target_status
      from public.appointments where id=$2 and workspace_id=ws;
  elsif normalized_type='TASK' then
    select owner_id,status into target_owner,target_status
      from public.crm_tasks where id=$2 and workspace_id=ws;
  elsif normalized_type='QUOTE' then
    select owner_id,status into target_owner,target_status
      from public.quotes where id=$2 and workspace_id=ws;
  else
    raise exception 'permission_explanation_invalid_resource';
  end if;
  if not found then
    return jsonb_build_object(
      'exists',false,'allowed',false,'resourceType',normalized_type,
      'resourceId',$2,'action',upper(requested_action),
      'reason','RECORD_NOT_FOUND_IN_WORKSPACE','role',actor_role
    );
  end if;
  allowed:=public.can_access_owned_record(ws,normalized_type,$2,target_owner,needs_edit);
  explanation:=case
    when actor_role in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR') then 'ROLE_SCOPE'
    when target_owner=auth.uid() then 'RECORD_OWNER'
    when exists(
      select 1 from public.record_collaborators c
      where c.workspace_id=ws and c.resource_type=normalized_type
        and c.resource_id=$2 and c.user_id=auth.uid()
        and (not needs_edit or c.access_level='EDIT')
    ) then 'EXPLICIT_COLLABORATOR'
    when allowed then 'TEAM_HIERARCHY'
    else 'OUTSIDE_ROLE_TEAM_OWNER_SCOPE'
  end;
  return jsonb_build_object(
    'exists',true,'allowed',allowed,'resourceType',normalized_type,
    'resourceId',$2,'action',upper(requested_action),'reason',explanation,
    'role',actor_role,'isOwner',target_owner=auth.uid(),'status',target_status,
    'mfaLevel',coalesce(auth.jwt()->>'aal','aal1'),'workspaceId',ws
  );
end;
$$;

create or replace function public.record_customer_activity(
  target_organization uuid,target_contact uuid,target_opportunity uuid,
  activity_kind text,occurred timestamptz,summary_zh text,summary_en text,
  next_step_zh text,next_step_en text
)
returns public.crm_activities
language plpgsql
security definer
set search_path=public
as $$
declare
  organization public.organizations;
  result public.crm_activities;
begin
  select * into organization from public.organizations
    where id=target_organization and workspace_id=public.current_workspace_id();
  if not found
    or not public.can_access_owned_record(
      organization.workspace_id,'ORGANIZATION',organization.id,organization.owner_id,true
    ) then
    raise exception 'activity_not_authorized';
  end if;
  if upper(activity_kind) not in (
    'CALL','EMAIL','MEETING','VISIT','MEAL','NOTE','CAMPAIGN','PAYMENT_FOLLOW_UP'
  ) or nullif(trim(summary_zh),'') is null or nullif(trim(summary_en),'') is null
    or nullif(trim(next_step_zh),'') is null or nullif(trim(next_step_en),'') is null
    or occurred>now()+interval '5 minutes' then
    raise exception 'activity_invalid';
  end if;
  if target_contact is not null then
    perform 1 from public.contacts
      where id=target_contact and workspace_id=organization.workspace_id
        and organization_id=organization.id;
    if not found then raise exception 'activity_contact_invalid'; end if;
  end if;
  if target_opportunity is not null then
    perform 1 from public.opportunities
      where id=target_opportunity and workspace_id=organization.workspace_id
        and organization_id=organization.id;
    if not found then raise exception 'activity_opportunity_invalid'; end if;
  end if;
  insert into public.crm_activities(
    workspace_id,organization_id,contact_id,opportunity_id,activity_type,occurred_at,
    summary_zh,summary_en,next_step_zh,next_step_en,owner_id,created_by
  ) values(
    organization.workspace_id,organization.id,target_contact,target_opportunity,upper(activity_kind),
    coalesce(occurred,now()),trim(summary_zh),trim(summary_en),trim(next_step_zh),trim(next_step_en),
    auth.uid(),auth.uid()
  ) returning * into result;
  update public.organizations set last_contact_at=result.occurred_at,updated_at=now()
    where id=organization.id;
  if target_contact is not null then
    update public.contacts set last_interaction_at=result.occurred_at,updated_at=now()
      where id=target_contact;
  end if;
  if target_opportunity is not null then
    update public.opportunities set last_activity_at=result.occurred_at,updated_at=now()
      where id=target_opportunity;
  end if;
  return result;
end;
$$;

create or replace function public.change_opportunity_stage(
  target_opportunity uuid,next_stage text,next_probability integer,
  next_expected_close date,next_action_zh text,next_action_en text,
  stage_reason text default '',stage_evidence text default ''
)
returns public.opportunities
language plpgsql
security definer
set search_path=public
as $$
declare
  current public.opportunities;
  result public.opportunities;
  normalized_stage text:=upper(next_stage);
begin
  select * into current from public.opportunities
    where id=target_opportunity and workspace_id=public.current_workspace_id() for update;
  if not found
    or not public.can_access_owned_record(
      current.workspace_id,'OPPORTUNITY',current.id,current.owner_id,true
    ) then
    raise exception 'opportunity_not_authorized';
  end if;
  if normalized_stage not in ('DISCOVERY','EVALUATION','HESITATION','PAYMENT','WON','LOST')
    or next_probability not between 0 and 100 then
    raise exception 'opportunity_stage_invalid';
  end if;
  if normalized_stage='WON' and next_probability<>100 then
    raise exception 'opportunity_probability_invalid';
  end if;
  if normalized_stage='LOST' and next_probability<>0 then
    raise exception 'opportunity_probability_invalid';
  end if;
  update public.opportunities set
    stage=normalized_stage,probability=next_probability,
    expected_close_date=case
      when normalized_stage in ('WON','LOST') then current.expected_close_date
      else next_expected_close end,
    next_action_zh=case
      when normalized_stage in ('WON','LOST') then current.next_action_zh else trim($5) end,
    next_action_en=case
      when normalized_stage in ('WON','LOST') then current.next_action_en else trim($6) end,
    lost_reason=case when normalized_stage='LOST' then trim(stage_reason) else null end,
    won_evidence=case when normalized_stage='WON' then trim(stage_evidence) else '' end,
    closed_at=case when normalized_stage in ('WON','LOST') then now() else null end,
    updated_at=now()
  where id=current.id returning * into result;
  insert into public.opportunity_stage_history(
    workspace_id,opportunity_id,from_stage,to_stage,reason,evidence,changed_by
  ) values(
    result.workspace_id,result.id,current.stage,result.stage,
    trim(coalesce(stage_reason,'')),trim(coalesce(stage_evidence,'')),auth.uid()
  );
  return result;
end;
$$;

create or replace function public.set_product_price(
  target_product uuid,price_currency text,price_amount numeric,effective_on date
)
returns public.product_prices
language plpgsql
security definer
set search_path=public
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
    where id=target_product and workspace_id=public.current_workspace_id();
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
    target_product,price_currency,price_amount,effective_on,auth.uid()
  ) returning * into result;
  return result;
end;
$$;

create or replace function public.consumption_report(
  report_period text,report_currency text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path=public
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
            and older_c.organization_id=c.organization_id
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
          count(distinct c.organization_id) customers
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
        join public.organizations o on o.id=c.organization_id
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
