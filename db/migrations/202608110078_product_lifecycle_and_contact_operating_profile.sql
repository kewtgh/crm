-- Products need an explicit lifecycle and contacts need enough structured
-- operating context to drive ownership, follow-up and segmentation.
set search_path = public, extensions;

alter table public.products add column if not exists lifecycle_status text not null default 'ACTIVE';
update public.products set lifecycle_status=case when active then 'ACTIVE' else 'PAUSED' end;
alter table public.products drop constraint if exists products_lifecycle_status_check;
alter table public.products add constraint products_lifecycle_status_check
  check(lifecycle_status in ('DRAFT','ACTIVE','PAUSED'));
create index if not exists products_workspace_lifecycle_idx
  on public.products(workspace_id,lifecycle_status,is_default desc,name_en);

alter table public.contacts
  add column if not exists preferred_contact_method text not null default 'EMAIL',
  add column if not exists preferred_language text not null default '',
  add column if not exists acquisition_source text not null default '',
  add column if not exists decision_role text not null default 'UNKNOWN',
  add column if not exists tags text[] not null default '{}',
  add column if not exists next_follow_up_at timestamptz;
alter table public.contacts drop constraint if exists contacts_preferred_method_check;
alter table public.contacts add constraint contacts_preferred_method_check
  check(preferred_contact_method in ('EMAIL','PHONE','SMS','WECHAT','WHATSAPP','IN_PERSON'));
alter table public.contacts drop constraint if exists contacts_decision_role_check;
alter table public.contacts add constraint contacts_decision_role_check
  check(decision_role in ('UNKNOWN','DECISION_MAKER','INFLUENCER','USER','GATEKEEPER','OTHER'));
create index if not exists contacts_workspace_follow_up_idx
  on public.contacts(workspace_id,next_follow_up_at) where archived_at is null and next_follow_up_at is not null;
create index if not exists contacts_workspace_tags_idx on public.contacts using gin(tags);

drop function if exists public.create_product_with_price(text,text,text,text,text,text,text,text,text,numeric);
create function public.create_product_with_price(
  product_code text,product_name_zh text,product_name_en text,product_billing text,
  product_duration_zh text,product_duration_en text,product_description_zh_markdown text,
  product_description_en_markdown text,product_lifecycle_status text,price_currency text,price_amount numeric
) returns public.products language plpgsql security definer set search_path=public,app_auth,extensions
as $$
declare created public.products; normalized_lifecycle text:=upper(trim(product_lifecycle_status));
begin
  if public.crm_role() not in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER') then raise exception 'product_not_authorized'; end if;
  if product_code !~ '^[A-Za-z0-9-]{2,40}$' or price_amount<0
    or normalized_lifecycle not in ('DRAFT','ACTIVE','PAUSED') then raise exception 'product_invalid'; end if;
  insert into public.products(
    workspace_id,code,name_zh,name_en,billing_unit,duration_zh,duration_en,
    description_zh_markdown,description_en_markdown,lifecycle_status,active,created_by
  ) values(
    public.current_workspace_id(),upper(product_code),trim(product_name_zh),trim(product_name_en),
    upper(product_billing),trim(product_duration_zh),trim(product_duration_en),
    coalesce(product_description_zh_markdown,''),coalesce(product_description_en_markdown,''),
    normalized_lifecycle,normalized_lifecycle='ACTIVE',app_auth.current_user_id()
  ) returning * into created;
  insert into public.product_prices(product_id,currency,amount,effective_from,created_by)
  values(created.id,upper(price_currency),price_amount,current_date,app_auth.current_user_id());
  return created;
end;
$$;

drop function if exists public.update_product_record(uuid,timestamptz,text,text,text,text,text,text,text,text,boolean);
create function public.update_product_record(
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
  where id=target_product and workspace_id=public.current_workspace_id() returning * into result;
  if not found then raise exception 'product_not_found'; end if;
  insert into public.mutation_receipts(workspace_id,request_key,operation,result,created_by)
  values(public.current_workspace_id(),p_request_key,'PRODUCT_LIFECYCLE',to_jsonb(result),app_auth.current_user_id());
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
  where p.workspace_id=public.current_workspace_id();
$$;

drop function if exists public.update_contact_profile(uuid,timestamptz,text,text,text,text,text,text,text,text,integer,text);
create function public.update_contact_profile(
  target_contact uuid,expected_updated_at timestamptz,next_name_zh text,next_name_en text,
  next_email text,next_phone text,next_title text,next_record_status text,next_contact_type text,
  next_contact_status text,next_communication_level integer,next_notes_markdown text,next_owner_id uuid,
  next_preferred_contact_method text,next_preferred_language text,next_acquisition_source text,
  next_decision_role text,next_tags text[],next_follow_up_at timestamptz
) returns public.contacts language plpgsql security definer set search_path=public,app_auth,extensions
as $$
declare result public.contacts;
begin
  select * into result from public.contacts where id=target_contact and workspace_id=public.current_workspace_id() for update;
  if not found or not public.can_access_owned_record(result.workspace_id,'CONTACT',result.id,result.owner_id,true)
    then raise exception 'crm_update_forbidden'; end if;
  if result.updated_at<>expected_updated_at then raise exception 'crm_version_conflict'; end if;
  if nullif(trim(next_name_zh),'') is null or nullif(trim(next_name_en),'') is null
    or (nullif(trim(next_email),'') is null and nullif(trim(next_phone),'') is null)
    or upper(next_record_status) not in ('ACTIVE','FOLLOW_UP','VERIFIED','PROTECTED','UNVERIFIED')
    or upper(next_contact_type) not in ('CONTACT','PARENT','STUDENT','SCHOOL_STAFF','PAYER')
    or upper(next_contact_status) not in ('NEW','ATTEMPTING','CONNECTED','FOLLOW_UP','DORMANT')
    or next_communication_level not between 1 and 4
    or upper(next_preferred_contact_method) not in ('EMAIL','PHONE','SMS','WECHAT','WHATSAPP','IN_PERSON')
    or upper(next_decision_role) not in ('UNKNOWN','DECISION_MAKER','INFLUENCER','USER','GATEKEEPER','OTHER')
    then raise exception 'contact_profile_invalid'; end if;
  if next_owner_id is distinct from result.owner_id then
    if public.current_crm_role() not in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR') or not exists(
      select 1 from public.workspace_memberships membership where membership.workspace_id=result.workspace_id
        and membership.user_id=next_owner_id and membership.status='ACTIVE'
    ) then raise exception 'contact_owner_not_assignable'; end if;
  end if;
  update public.contacts set name_zh=trim(next_name_zh),name_en=trim(next_name_en),
    email=nullif(trim(next_email),'')::citext,phone=nullif(trim(next_phone),''),title=trim(coalesce(next_title,'')),
    status=upper(next_record_status),contact_type=upper(next_contact_type),contact_status=upper(next_contact_status),
    communication_level=next_communication_level,notes_markdown=coalesce(next_notes_markdown,''),owner_id=next_owner_id,
    preferred_contact_method=upper(next_preferred_contact_method),preferred_language=trim(coalesce(next_preferred_language,'')),
    acquisition_source=trim(coalesce(next_acquisition_source,'')),decision_role=upper(next_decision_role),
    tags=coalesce(next_tags,'{}'),next_follow_up_at=next_follow_up_at,updated_at=now()
  where id=target_contact returning * into result;
  return result;
end;
$$;

revoke all on function public.create_product_with_price(text,text,text,text,text,text,text,text,text,text,numeric),
  public.update_product_record(uuid,timestamptz,text,text,text,text,text,text,text,text,text,boolean),
  public.idempotent_set_product_lifecycle(uuid,text,text),
  public.update_contact_profile(uuid,timestamptz,text,text,text,text,text,text,text,text,integer,text,uuid,text,text,text,text,text[],timestamptz)
from public,crm_system;
grant execute on function public.create_product_with_price(text,text,text,text,text,text,text,text,text,text,numeric),
  public.update_product_record(uuid,timestamptz,text,text,text,text,text,text,text,text,text,boolean),
  public.idempotent_set_product_lifecycle(uuid,text,text),
  public.update_contact_profile(uuid,timestamptz,text,text,text,text,text,text,text,text,integer,text,uuid,text,text,text,text,text[],timestamptz)
to crm_app;
