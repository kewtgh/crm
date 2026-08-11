set search_path = public, extensions;

-- Product narratives are business content. They remain bilingual and Markdown
-- capable instead of being compressed into a single unstructured label.
alter table public.products add column if not exists description_zh_markdown text not null default '';
alter table public.products add column if not exists description_en_markdown text not null default '';

-- Contact verification status, day-to-day contact status, and relationship
-- maturity are separate concepts and must not overwrite one another.
alter table public.contacts add column if not exists contact_status text not null default 'NEW';
alter table public.contacts add column if not exists communication_level smallint not null default 1;
alter table public.contacts add column if not exists notes_markdown text not null default '';
alter table public.contacts drop constraint if exists contacts_contact_status_check;
alter table public.contacts add constraint contacts_contact_status_check
  check(contact_status in ('NEW','ATTEMPTING','CONNECTED','FOLLOW_UP','DORMANT'));
alter table public.contacts drop constraint if exists contacts_communication_level_check;
alter table public.contacts add constraint contacts_communication_level_check
  check(communication_level between 1 and 4);
create index if not exists contacts_workspace_contact_status_idx
  on public.contacts(workspace_id,contact_status,updated_at desc) where archived_at is null;

-- Preserve the relationship level already recorded on customer contracts by
-- projecting the highest known organization level onto its contacts.
update public.contacts contact
set communication_level=known.level
from (
  select workspace_id,organization_id,max(relationship_level)::smallint level
  from public.contracts
  group by workspace_id,organization_id
) known
where contact.workspace_id=known.workspace_id and contact.organization_id=known.organization_id
  and contact.communication_level<known.level;

-- A staff member can belong to several teams and can lead several teams. A
-- pending row is also the durable employee-initiated membership request.
create table if not exists public.sales_team_memberships (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  team_id uuid not null references public.sales_teams(id) on delete cascade,
  member_id uuid not null references public.sales_team_members(id) on delete cascade,
  membership_role text not null default 'MEMBER' check(membership_role in ('MEMBER','LEAD')),
  status text not null default 'PENDING' check(status in ('PENDING','ACTIVE','REJECTED')),
  requested_by uuid not null references app_auth.accounts(id),
  reviewed_by uuid references app_auth.accounts(id),
  requested_at timestamptz not null default now(),
  reviewed_at timestamptz,
  updated_at timestamptz not null default now(),
  unique(workspace_id,team_id,member_id)
);
create index if not exists sales_team_memberships_member_idx
  on public.sales_team_memberships(workspace_id,member_id,status,updated_at desc);
create index if not exists sales_team_memberships_team_idx
  on public.sales_team_memberships(workspace_id,team_id,status,membership_role);

insert into public.sales_team_memberships(
  workspace_id,team_id,member_id,membership_role,status,requested_by,reviewed_by,reviewed_at
)
select member.workspace_id,member.team_id,member.id,
  case when team.lead_member_id=member.id then 'LEAD' else 'MEMBER' end,
  'ACTIVE',coalesce(member.auth_user_id,team.created_by),team.created_by,now()
from public.sales_team_members member
join public.sales_teams team on team.id=member.team_id and team.workspace_id=member.workspace_id
where member.team_id is not null and coalesce(member.auth_user_id,team.created_by) is not null
on conflict(workspace_id,team_id,member_id) do update set
  membership_role=excluded.membership_role,status='ACTIVE',reviewed_by=excluded.reviewed_by,
  reviewed_at=excluded.reviewed_at,updated_at=now();

alter table public.sales_team_memberships enable row level security;
drop policy if exists "members read own team memberships" on public.sales_team_memberships;
create policy "members read own team memberships" on public.sales_team_memberships for select to crm_app
using(
  workspace_id=public.current_workspace_id() and (
    exists(select 1 from public.sales_team_members member where member.id=member_id and member.auth_user_id=app_auth.current_user_id())
    or public.current_crm_role() in ('SUPER_ADMIN','ADMIN')
  )
);
revoke all on public.sales_team_memberships from public;
grant select on public.sales_team_memberships to crm_app;

drop function if exists public.create_product_with_price(text,text,text,text,text,text,text,numeric);
create function public.create_product_with_price(
  product_code text,product_name_zh text,product_name_en text,product_billing text,
  product_duration_zh text,product_duration_en text,product_description_zh_markdown text,
  product_description_en_markdown text,price_currency text,price_amount numeric
) returns public.products language plpgsql security definer set search_path=public,app_auth,extensions
as $$
declare created public.products;
begin
  if public.crm_role() not in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER') then raise exception 'product_not_authorized'; end if;
  if product_code !~ '^[A-Za-z0-9-]{2,40}$' or price_amount<0 then raise exception 'product_invalid'; end if;
  insert into public.products(
    workspace_id,code,name_zh,name_en,billing_unit,duration_zh,duration_en,
    description_zh_markdown,description_en_markdown,created_by
  ) values(
    public.current_workspace_id(),upper(product_code),trim(product_name_zh),trim(product_name_en),
    upper(product_billing),trim(product_duration_zh),trim(product_duration_en),
    coalesce(product_description_zh_markdown,''),coalesce(product_description_en_markdown,''),app_auth.current_user_id()
  ) returning * into created;
  insert into public.product_prices(product_id,currency,amount,effective_from,created_by)
  values(created.id,upper(price_currency),price_amount,current_date,app_auth.current_user_id());
  return created;
end;
$$;

drop function if exists public.update_product_record(uuid,timestamptz,text,text,text,text,text,text,boolean);
create function public.update_product_record(
  target_product uuid,expected_updated_at timestamptz,product_code text,
  product_name_zh text,product_name_en text,product_billing text,
  product_duration_zh text,product_duration_en text,product_description_zh_markdown text,
  product_description_en_markdown text,product_is_default boolean
) returns public.products
language plpgsql security definer set search_path=public,app_auth,extensions
as $$
declare result public.products;
begin
  if public.current_crm_role() not in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR')
    or nullif(trim(product_code),'') is null
    or nullif(trim(product_name_zh),'') is null or nullif(trim(product_name_en),'') is null
    or upper(product_billing) not in ('PROJECT','TERM','MONTH','YEAR','SCHOOL_YEAR','SEASON')
    or nullif(trim(product_duration_zh),'') is null or nullif(trim(product_duration_en),'') is null then
    raise exception 'product_update_forbidden';
  end if;
  if coalesce(product_is_default,false) then
    update public.products set is_default=false,updated_at=now()
    where workspace_id=public.current_workspace_id() and is_default and id<>target_product;
  end if;
  update public.products set code=upper(trim(product_code)),name_zh=trim(product_name_zh),
    name_en=trim(product_name_en),billing_unit=upper(product_billing),
    duration_zh=trim(product_duration_zh),duration_en=trim(product_duration_en),
    description_zh_markdown=coalesce(product_description_zh_markdown,''),
    description_en_markdown=coalesce(product_description_en_markdown,''),
    is_default=coalesce(product_is_default,false),updated_at=now()
  where id=target_product and workspace_id=public.current_workspace_id() and updated_at=expected_updated_at
  returning * into result;
  if not found then
    if exists(select 1 from public.products where id=target_product and workspace_id=public.current_workspace_id())
      then raise exception 'product_version_conflict'; else raise exception 'product_not_found'; end if;
  end if;
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
    'active',p.active,'isDefault',p.is_default,'updatedAt',p.updated_at,
    'prices',coalesce(price_rows.items,'[]'::jsonb),'metrics',coalesce(metric_rows.items,'{}'::jsonb),
    'purchasers',coalesce(purchaser_rows.items,'[]'::jsonb)
  ) order by p.is_default desc,p.name_en),'[]'::jsonb)
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
      count(distinct con.organization_id) customers from public.payments pay
      join public.contracts con on con.id=pay.contract_id
      where pay.workspace_id=p.workspace_id and pay.product_id=p.id and pay.status='CONFIRMED'
      group by pay.currency) m
  ) metric_rows on true
  left join lateral (
    select jsonb_agg(jsonb_build_object(
      'organizationId',buyer.organization_id,'nameZh',buyer.name_zh,'nameEn',buyer.name_en,
      'contractId',buyer.contract_id,'contractNumber',buyer.contract_number,'contractStatus',buyer.contract_status,
      'relationshipLevel',buyer.relationship_level,'currency',buyer.currency,
      'contractValue',buyer.contract_value,'confirmedSpend',buyer.confirmed_spend
    ) order by buyer.name_en,buyer.contract_number) items
    from (
      select organization.id organization_id,organization.name_zh,organization.name_en,
        contract.id contract_id,contract.contract_number,contract.status contract_status,
        contract.relationship_level,contract.currency,contract.contract_value,
        coalesce(sum(greatest(payment.amount-coalesce(payment.refunded_amount,0),0))
          filter(where payment.status='CONFIRMED' and (payment.product_id=p.id or payment.product_id is null)),0) confirmed_spend
      from public.contracts contract
      join public.organizations organization on organization.id=contract.organization_id and organization.workspace_id=contract.workspace_id
      left join public.payments payment on payment.contract_id=contract.id and payment.workspace_id=contract.workspace_id
      where contract.workspace_id=p.workspace_id and contract.product_id=p.id
      group by organization.id,organization.name_zh,organization.name_en,contract.id,
        contract.contract_number,contract.status,contract.relationship_level,contract.currency,contract.contract_value
    ) buyer
  ) purchaser_rows on true
  where p.workspace_id=public.current_workspace_id();
$$;

create or replace function public.update_contact_profile(
  target_contact uuid,expected_updated_at timestamptz,next_name_zh text,next_name_en text,
  next_email text,next_phone text,next_title text,next_record_status text,next_contact_type text,
  next_contact_status text,next_communication_level integer,next_notes_markdown text
) returns public.contacts language plpgsql security definer set search_path=public,app_auth,extensions
as $$
declare result public.contacts;
begin
  select * into result from public.contacts
  where id=target_contact and workspace_id=public.current_workspace_id() for update;
  if not found or not public.can_access_owned_record(result.workspace_id,'CONTACT',result.id,result.owner_id,true)
    then raise exception 'crm_update_forbidden'; end if;
  if result.updated_at<>expected_updated_at then raise exception 'crm_version_conflict'; end if;
  if nullif(trim(next_name_zh),'') is null or nullif(trim(next_name_en),'') is null
    or (nullif(trim(next_email),'') is null and nullif(trim(next_phone),'') is null)
    or upper(next_record_status) not in ('ACTIVE','FOLLOW_UP','VERIFIED','PROTECTED','UNVERIFIED')
    or upper(next_contact_type) not in ('CONTACT','PARENT','STUDENT','SCHOOL_STAFF','PAYER')
    or upper(next_contact_status) not in ('NEW','ATTEMPTING','CONNECTED','FOLLOW_UP','DORMANT')
    or next_communication_level not between 1 and 4 then raise exception 'contact_profile_invalid'; end if;
  update public.contacts set name_zh=trim(next_name_zh),name_en=trim(next_name_en),
    email=nullif(trim(next_email),'')::citext,phone=nullif(trim(next_phone),''),title=trim(coalesce(next_title,'')),
    status=upper(next_record_status),contact_type=upper(next_contact_type),contact_status=upper(next_contact_status),
    communication_level=next_communication_level,notes_markdown=coalesce(next_notes_markdown,''),updated_at=now()
  where id=target_contact returning * into result;
  return result;
end;
$$;

-- Contact notes can contain sensitive business context and must not be copied
-- into the broad audit payload. The update action itself remains audited.
create or replace function public.audit_row_change()
returns trigger language plpgsql security definer set search_path=public,app_auth,extensions
as $$
declare ws uuid; entity text; before_row jsonb; after_row jsonb;
begin
  before_row:=case when tg_op='INSERT' then null else to_jsonb(old) end;
  after_row:=case when tg_op='DELETE' then null else to_jsonb(new) end;
  if tg_table_name='contacts' then before_row:=before_row-'email'-'phone'-'notes_markdown'; after_row:=after_row-'email'-'phone'-'notes_markdown'; end if;
  if tg_table_name='payments' then before_row:=before_row-'reference'; after_row:=after_row-'reference'; end if;
  ws:=coalesce((after_row->>'workspace_id')::uuid,(before_row->>'workspace_id')::uuid,public.current_workspace_id());
  entity:=coalesce(after_row->>'id',before_row->>'id',after_row->>'user_id',before_row->>'user_id');
  if entity is null then raise exception 'audit_entity_identity_missing for %',tg_table_name; end if;
  insert into public.audit_events(workspace_id,actor_id,entity_type,entity_id,action,before_data,after_data,request_id)
  values(ws,app_auth.current_user_id(),tg_table_name,entity,tg_op,before_row,after_row,txid_current()::text);
  return coalesce(new,old);
end;
$$;

revoke all on function public.create_product_with_price(text,text,text,text,text,text,text,text,text,numeric),
  public.update_product_record(uuid,timestamptz,text,text,text,text,text,text,text,text,boolean),
  public.update_contact_profile(uuid,timestamptz,text,text,text,text,text,text,text,text,integer,text) from public;
grant execute on function public.create_product_with_price(text,text,text,text,text,text,text,text,text,numeric),
  public.update_product_record(uuid,timestamptz,text,text,text,text,text,text,text,text,boolean),
  public.update_contact_profile(uuid,timestamptz,text,text,text,text,text,text,text,text,integer,text) to crm_app;
