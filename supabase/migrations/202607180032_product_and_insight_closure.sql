-- v0.9.1: complete renewal, catalog/FX, integration, NBA and business insight
-- capabilities so the new tables participate in real workflows.

-- ---------------------------------------------------------------------------
-- Renewal playbook context and automatic windows.
-- ---------------------------------------------------------------------------

alter table public.contract_renewal_playbooks
  add column if not exists health_score integer not null default 50
    check(health_score between 0 and 100);
alter table public.contract_renewal_playbooks
  add column if not exists window_days integer;
alter table public.contract_renewal_playbooks
  add column if not exists last_auto_evaluated_at timestamptz;

create or replace function public.renewal_playbook_context(target_contract uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path=public
as $$
declare
  contract public.contracts;
  organization public.organizations;
  existing public.contract_renewal_playbooks;
  days_remaining integer;
  suggested_stage text;
  suggested_risk text;
  suggested_window integer;
  suggested_due timestamptz;
  health integer;
begin
  select * into contract from public.contracts
    where id=target_contract and workspace_id=public.current_workspace_id();
  if not found or not public.can_access_owned_record(
    contract.workspace_id,'CONTRACT',contract.id,contract.owner_id,false
  ) then raise exception 'renewal_playbook_not_authorized'; end if;
  select * into organization from public.organizations where id=contract.organization_id;
  select * into existing from public.contract_renewal_playbooks
    where workspace_id=contract.workspace_id and contract_id=contract.id;
  days_remaining:=contract.end_date-current_date;
  suggested_window:=case
    when days_remaining>90 then 90 when days_remaining>60 then 60
    when days_remaining>30 then 30 when days_remaining>14 then 14
    when days_remaining>7 then 7 else 0 end;
  suggested_stage:=case
    when days_remaining>90 then 'NOT_STARTED'
    when days_remaining>60 then 'DISCOVERY'
    when days_remaining>30 then 'PROPOSAL'
    when days_remaining>14 then 'NEGOTIATION'
    else 'COMMITTED' end;
  health:=greatest(0,least(100,
    40
    +case contract.status when 'ACTIVE' then 20 when 'RENEWAL_PREP' then 10
      when 'NEGOTIATING' then 5 when 'RISK' then -25 else -10 end
    +contract.relationship_level*8
    +case when organization.last_contact_at>=now()-interval '30 days' then 15
      when organization.last_contact_at>=now()-interval '60 days' then 5 else -10 end
  ));
  suggested_risk:=case when contract.status='RISK' or days_remaining<0 or health<45 then 'HIGH'
    when days_remaining<=30 or health<70 then 'MEDIUM' else 'LOW' end;
  suggested_due:=case
    when days_remaining<=0 then now()
    when suggested_window=0 then now()+interval '3 days'
    else least(
      (contract.end_date-suggested_window)::timestamp+time '09:00',
      now()+interval '14 days'
    ) end;
  return jsonb_build_object(
    'contractId',contract.id,'daysRemaining',days_remaining,
    'ownerId',contract.owner_id,'healthScore',health,
    'overdue',coalesce(existing.due_at<now()
      and existing.stage not in ('RENEWED','LOST'),false),
    'existing',case when existing.id is null then null else jsonb_build_object(
      'id',existing.id,'stage',existing.stage,'risk',existing.risk_level,
      'actionZh',existing.next_action_zh,'actionEn',existing.next_action_en,
      'dueAt',existing.due_at,'outcome',existing.outcome_reason,
      'healthScore',existing.health_score,'windowDays',existing.window_days
    ) end,
    'suggestion',jsonb_build_object(
      'stage',suggested_stage,'risk',suggested_risk,'dueAt',suggested_due,
      'windowDays',suggested_window,'healthScore',health,
      'actionZh',case suggested_stage
        when 'NOT_STARTED' then '确认续约负责人并安排首次续约沟通'
        when 'DISCOVERY' then '确认续约目标、关键决策人和预算'
        when 'PROPOSAL' then '完成续约方案和商业条款评审'
        when 'NEGOTIATION' then '推进关键条款并关闭未决问题'
        else '确认签署计划或记录流失原因' end,
      'actionEn',case suggested_stage
        when 'NOT_STARTED' then 'Confirm the renewal owner and schedule the first renewal conversation'
        when 'DISCOVERY' then 'Confirm renewal goals, decision makers, and budget'
        when 'PROPOSAL' then 'Complete the renewal proposal and commercial review'
        when 'NEGOTIATION' then 'Advance key terms and close outstanding issues'
        else 'Confirm the signing plan or record the loss reason' end
    )
  );
end;
$$;

create or replace function public.save_renewal_playbook(
  target_contract uuid,playbook_stage text,risk text,
  action_zh text,action_en text,action_due timestamptz,outcome text default ''
)
returns public.contract_renewal_playbooks
language plpgsql
security definer
set search_path=public
as $$
declare
  contract public.contracts;
  result public.contract_renewal_playbooks;
  context jsonb;
begin
  select * into contract from public.contracts
    where id=target_contract and workspace_id=public.current_workspace_id();
  if not found or not public.can_access_owned_record(
    contract.workspace_id,'CONTRACT',contract.id,contract.owner_id,true
  ) then raise exception 'renewal_playbook_not_authorized'; end if;
  if upper(playbook_stage) not in (
      'NOT_STARTED','DISCOVERY','PROPOSAL','NEGOTIATION','COMMITTED','RENEWED','LOST'
    ) or upper(risk) not in ('LOW','MEDIUM','HIGH')
    or nullif(trim(action_zh),'') is null or nullif(trim(action_en),'') is null
    or action_due is null then
    raise exception 'renewal_playbook_invalid';
  end if;
  if upper(playbook_stage) in ('RENEWED','LOST') and nullif(trim(outcome),'') is null then
    raise exception 'renewal_outcome_required';
  end if;
  context:=public.renewal_playbook_context(contract.id);
  insert into public.contract_renewal_playbooks(
    workspace_id,contract_id,stage,risk_level,next_action_zh,next_action_en,due_at,
    owner_id,outcome_reason,health_score,window_days,last_auto_evaluated_at,
    created_by,updated_by
  ) values(
    contract.workspace_id,contract.id,upper(playbook_stage),upper(risk),
    trim(action_zh),trim(action_en),action_due,coalesce(contract.owner_id,auth.uid()),
    trim(coalesce(outcome,'')),(context->>'healthScore')::integer,
    (context->'suggestion'->>'windowDays')::integer,now(),auth.uid(),auth.uid()
  ) on conflict(workspace_id,contract_id) do update set
    stage=excluded.stage,risk_level=excluded.risk_level,
    next_action_zh=excluded.next_action_zh,next_action_en=excluded.next_action_en,
    due_at=excluded.due_at,outcome_reason=excluded.outcome_reason,
    health_score=excluded.health_score,window_days=excluded.window_days,
    last_auto_evaluated_at=now(),updated_by=auth.uid(),updated_at=now()
  returning * into result;
  return result;
end;
$$;

revoke all on function public.renewal_playbook_context(uuid),
  public.save_renewal_playbook(uuid,text,text,text,text,timestamptz,text)
from public,anon;
grant execute on function public.renewal_playbook_context(uuid),
  public.save_renewal_playbook(uuid,text,text,text,text,timestamptz,text)
to authenticated;

create or replace function public.contract_summary()
returns jsonb
language sql
stable
security definer
set search_path=public
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
      join public.organizations o on o.id=r.organization_id
      left join public.sales_team_members m on m.auth_user_id=r.owner_id
        and m.workspace_id=r.workspace_id
      where r.workspace_id=public.current_workspace_id()
        and r.status in ('ACTIVE','RENEWAL_PREP','NEGOTIATING','RISK')
        and r.end_date<=current_date+90
    ),'[]'::jsonb)
  )
  from public.contracts c where c.workspace_id=public.current_workspace_id();
$$;

-- ---------------------------------------------------------------------------
-- Versioned bundles and quote/contract/payment FX lock.
-- ---------------------------------------------------------------------------

alter table public.product_bundles add column if not exists version integer not null default 1;
alter table public.product_bundles add column if not exists effective_from timestamptz not null default now();
alter table public.product_bundles add column if not exists effective_to timestamptz;
alter table public.product_bundles add column if not exists supersedes_id uuid
  references public.product_bundles(id) on delete set null;
alter table public.product_bundles drop constraint if exists product_bundles_workspace_id_code_key;
create unique index if not exists product_bundles_code_version_uidx
  on public.product_bundles(workspace_id,code,version);
create unique index if not exists product_bundles_active_code_uidx
  on public.product_bundles(workspace_id,code) where effective_to is null;

alter table public.quote_versions add column if not exists bundle_id uuid
  references public.product_bundles(id) on delete restrict;
alter table public.quote_versions add column if not exists bundle_version integer;
alter table public.quote_versions add column if not exists exchange_rate_snapshot_id uuid
  references public.exchange_rate_snapshots(id) on delete restrict;
alter table public.quote_versions add column if not exists base_currency text;
alter table public.quote_versions add column if not exists base_total_amount numeric(14,2);
alter table public.contracts add column if not exists exchange_rate_snapshot_id uuid
  references public.exchange_rate_snapshots(id) on delete restrict;
alter table public.contracts add column if not exists base_currency text;
alter table public.contracts add column if not exists base_contract_value numeric(14,2);
alter table public.payments add column if not exists exchange_rate_snapshot_id uuid
  references public.exchange_rate_snapshots(id) on delete restrict;
alter table public.payments add column if not exists base_currency text;
alter table public.payments add column if not exists base_amount numeric(14,2);

create or replace function public.create_product_bundle(
  bundle_code text,bundle_name_zh text,bundle_name_en text,bundle_items jsonb
)
returns public.product_bundles
language plpgsql
security definer
set search_path=public
as $$
declare
  ws uuid:=public.current_workspace_id();
  result public.product_bundles;
  previous public.product_bundles;
  item jsonb;
  product public.products;
  quantity_value numeric;
  ceiling_value numeric;
  next_version integer;
begin
  if auth.uid() is null
    or public.current_crm_role() not in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR')
    or ws is null or upper(trim(bundle_code))!~'^[A-Z0-9-]{2,40}$'
    or char_length(trim(bundle_name_zh)) not between 2 and 100
    or char_length(trim(bundle_name_en)) not between 2 and 120
    or jsonb_typeof(bundle_items)<>'array'
    or jsonb_array_length(bundle_items) not between 1 and 50 then
    raise exception 'product_bundle_invalid';
  end if;
  select * into previous from public.product_bundles
    where workspace_id=ws and code=upper(trim(bundle_code)) and effective_to is null for update;
  select coalesce(max(version),0)+1 into next_version from public.product_bundles
    where workspace_id=ws and code=upper(trim(bundle_code));
  if previous.id is not null then
    update public.product_bundles set
      active=false,effective_to=now(),updated_at=now() where id=previous.id;
  end if;
  insert into public.product_bundles(
    workspace_id,code,name_zh,name_en,version,effective_from,supersedes_id,created_by
  ) values(
    ws,upper(trim(bundle_code)),trim(bundle_name_zh),trim(bundle_name_en),
    next_version,now(),previous.id,auth.uid()
  ) returning * into result;
  for item in select value from jsonb_array_elements(bundle_items) loop
    quantity_value:=(item->>'quantity')::numeric;
    ceiling_value:=(item->>'discountCeiling')::numeric;
    select * into product from public.products
      where id=(item->>'productId')::uuid and workspace_id=ws and active=true;
    if not found or quantity_value<=0 or quantity_value>1000
      or ceiling_value<0 or ceiling_value>100
      or jsonb_typeof(item->'optional')<>'boolean' then
      raise exception 'product_bundle_item_invalid';
    end if;
    insert into public.product_bundle_items(
      bundle_id,product_id,quantity,optional,discount_ceiling
    ) values(
      result.id,product.id,quantity_value,(item->>'optional')::boolean,ceiling_value
    );
  end loop;
  return result;
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception 'product_bundle_item_invalid';
end;
$$;

create or replace function public.create_quote_v091(
  quote_no text,target_organization uuid,target_opportunity uuid,target_product uuid,
  target_bundle uuid,target_exchange_rate uuid,quote_currency text,
  quote_subtotal numeric,quote_discount numeric,valid_through date,
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
  bundle public.product_bundles;
  rate public.exchange_rate_snapshots;
  base text;
  base_total numeric;
  line_items jsonb:='[]'::jsonb;
  ceiling numeric;
begin
  select * into organization from public.organizations
    where id=target_organization and workspace_id=public.current_workspace_id();
  if not found or not public.can_access_owned_record(
    organization.workspace_id,'ORGANIZATION',organization.id,organization.owner_id,true
  ) then raise exception 'quote_not_authorized'; end if;
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
        and rates.quote_currency=upper(create_quote_v091.quote_currency)
        and rates.effective_at<=now();
    if not found then raise exception 'quote_exchange_rate_required'; end if;
    base_total:=round((quote_subtotal-quote_discount)/rate.rate,2);
  end if;
  insert into public.quotes(
    workspace_id,quote_number,organization_id,opportunity_id,product_id,
    currency,valid_until,owner_id,created_by
  ) values(
    organization.workspace_id,trim(quote_no),organization.id,target_opportunity,
    coalesce(target_product,(select product_id from public.product_bundle_items
      where bundle_id=bundle.id and not optional order by product_id limit 1)),
    upper(quote_currency),valid_through,auth.uid(),auth.uid()
  ) returning * into result;
  insert into public.quote_versions(
    workspace_id,quote_id,version,subtotal,discount_amount,terms_zh,terms_en,
    line_items,bundle_id,bundle_version,exchange_rate_snapshot_id,
    base_currency,base_total_amount,created_by
  ) values(
    result.workspace_id,result.id,1,quote_subtotal,quote_discount,
    trim(coalesce(terms_zh,'')),trim(coalesce(terms_en,'')),line_items,
    bundle.id,bundle.version,rate.id,base,base_total,auth.uid()
  );
  return result;
end;
$$;

create or replace function public.submit_quote(target_quote uuid,business_reason text)
returns public.quotes
language plpgsql
security definer
set search_path=public
as $$
declare
  quote public.quotes;
  selected_version public.quote_versions;
  request public.approval_requests;
  ceiling numeric;
begin
  select * into quote from public.quotes q
    where q.id=target_quote and q.workspace_id=public.current_workspace_id() for update;
  if not found or quote.status<>'DRAFT'
    or not public.can_access_owned_record(quote.workspace_id,'QUOTE',quote.id,quote.owner_id,true)
  then raise exception 'quote_not_submittable'; end if;
  select * into selected_version from public.quote_versions qv
    where qv.quote_id=quote.id and qv.version=quote.current_version;
  if selected_version.bundle_id is not null then
    select min(discount_ceiling) into ceiling from public.product_bundle_items
      where bundle_id=selected_version.bundle_id and not optional;
    if selected_version.subtotal>0
      and selected_version.discount_amount*100/selected_version.subtotal>coalesce(ceiling,0) then
      raise exception 'quote_bundle_discount_exceeded';
    end if;
  end if;
  if selected_version.base_currency is null or selected_version.base_total_amount is null then
    raise exception 'quote_currency_lock_missing';
  end if;
  if selected_version.discount_amount>0 then
    request:=public.create_approval('QUOTE_DISCOUNT','QUOTE',quote.id::text,business_reason);
    update public.quotes set
      status='PENDING_DISCOUNT_APPROVAL',discount_approval_id=request.id,updated_at=now()
    where id=quote.id returning * into quote;
  else
    update public.quotes set status='APPROVED',updated_at=now()
      where id=quote.id returning * into quote;
  end if;
  return quote;
end;
$$;

create or replace function public.convert_quote_to_contract(
  target_quote uuid,contract_no text,period_start date,period_end date
)
returns public.contracts
language plpgsql
security definer
set search_path=public
as $$
declare quote public.quotes;selected_version public.quote_versions;result public.contracts;
begin
  select * into quote from public.quotes q
    where q.id=target_quote and q.workspace_id=public.current_workspace_id() for update;
  if not found or quote.status<>'ACCEPTED' or period_end<period_start
    or not public.can_access_owned_record(quote.workspace_id,'QUOTE',quote.id,quote.owner_id,true)
  then raise exception 'quote_not_convertible'; end if;
  select * into selected_version from public.quote_versions qv
    where qv.quote_id=quote.id and qv.version=quote.current_version;
  insert into public.contracts(
    workspace_id,contract_number,organization_id,product_id,start_date,end_date,
    currency,contract_value,status,owner_id,created_by,quote_id,
    exchange_rate_snapshot_id,base_currency,base_contract_value
  ) values(
    quote.workspace_id,trim(contract_no),quote.organization_id,quote.product_id,
    period_start,period_end,quote.currency,selected_version.total_amount,'DRAFT',
    quote.owner_id,auth.uid(),quote.id,selected_version.exchange_rate_snapshot_id,
    selected_version.base_currency,selected_version.base_total_amount
  ) returning * into result;
  update public.quotes set status='CONVERTED',updated_at=now() where id=quote.id;
  return result;
end;
$$;

create or replace function public.lock_payment_exchange_context()
returns trigger
language plpgsql
set search_path=public
as $$
declare contract public.contracts;rate_value numeric;
begin
  select * into contract from public.contracts where id=new.contract_id;
  new.exchange_rate_snapshot_id:=contract.exchange_rate_snapshot_id;
  new.base_currency:=coalesce(contract.base_currency,contract.currency);
  if contract.exchange_rate_snapshot_id is null then
    new.base_amount:=new.amount;
  else
    select rate into rate_value from public.exchange_rate_snapshots
      where id=contract.exchange_rate_snapshot_id;
    new.base_amount:=round(new.amount/rate_value,2);
  end if;
  return new;
end;
$$;
drop trigger if exists payments_lock_exchange_context on public.payments;
create trigger payments_lock_exchange_context
before insert or update of amount,contract_id on public.payments
for each row execute procedure public.lock_payment_exchange_context();

revoke all on function public.create_quote_v091(
  text,uuid,uuid,uuid,uuid,uuid,text,numeric,numeric,date,text,text
) from public,anon;
grant execute on function public.create_quote_v091(
  text,uuid,uuid,uuid,uuid,uuid,text,numeric,numeric,date,text,text
) to authenticated;

-- ---------------------------------------------------------------------------
-- Configurable integrations and a leased sync queue.
-- ---------------------------------------------------------------------------

alter table public.worker_heartbeats drop constraint if exists worker_heartbeats_worker_key_check;
alter table public.worker_heartbeats add constraint worker_heartbeats_worker_key_check
  check(worker_key in (
    'REMINDERS','NOTIFICATION_OUTBOX','CALENDAR_DELIVERIES',
    'GENERATED_JOBS','WEBHOOK_INBOX','INTEGRATION_SYNC'
  ));

create table if not exists public.integration_sync_jobs(
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  connection_id uuid not null references public.integration_connections(id) on delete cascade,
  provider text not null,
  sync_direction text not null,
  cursor_before text,
  cursor_after text,
  status text not null default 'QUEUED'
    check(status in ('QUEUED','PROCESSING','COMPLETED','FAILED','DEAD')),
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  lease_expires_at timestamptz,
  locked_by text,
  lease_token uuid,
  last_error text,
  requested_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  updated_at timestamptz not null default now()
);
create index if not exists integration_sync_jobs_queue_idx
  on public.integration_sync_jobs(workspace_id,status,available_at);
alter table public.integration_sync_jobs enable row level security;
create policy "administrators read integration sync jobs"
  on public.integration_sync_jobs for select to authenticated
  using(public.is_workspace_member(workspace_id)
    and public.current_crm_role() in ('SUPER_ADMIN','ADMIN'));
grant select on public.integration_sync_jobs to authenticated;
revoke insert,update,delete on public.integration_connections,public.integration_sync_jobs
from authenticated;

create or replace function public.configure_integration(
  target_provider text,next_status text,next_direction text,account_label text
)
returns public.integration_connections
language plpgsql security definer set search_path=public
as $$
declare result public.integration_connections;ws uuid:=public.current_workspace_id();
begin
  if public.current_crm_role() not in ('SUPER_ADMIN','ADMIN')
    or upper(target_provider) not in ('MICROSOFT_365','GOOGLE_CALENDAR','EMAIL','E_SIGNATURE','ACCOUNTING')
    or upper(next_status) not in ('DISCONNECTED','CONNECTING','CONNECTED','DEGRADED','ACTION_REQUIRED')
    or upper(next_direction) not in ('NONE','IMPORT_ONLY','EXPORT_ONLY','BIDIRECTIONAL')
  then raise exception 'integration_configuration_invalid'; end if;
  update public.integration_connections set
    status=upper(next_status),sync_direction=upper(next_direction),
    external_account_label=trim(coalesce(account_label,'')),configured_by=auth.uid(),
    last_error=null,updated_at=now()
  where workspace_id=ws and provider=upper(target_provider)
  returning * into result;
  if not found then raise exception 'integration_not_found'; end if;
  return result;
end;
$$;

create or replace function public.request_integration_sync(target_provider text)
returns public.integration_sync_jobs
language plpgsql security definer set search_path=public
as $$
declare connection public.integration_connections;result public.integration_sync_jobs;
begin
  if public.current_crm_role() not in ('SUPER_ADMIN','ADMIN') then
    raise exception 'integration_sync_not_authorized';
  end if;
  select * into connection from public.integration_connections
    where workspace_id=public.current_workspace_id() and provider=upper(target_provider) for update;
  if not found or connection.status not in ('CONNECTED','DEGRADED')
    or connection.sync_direction='NONE' then raise exception 'integration_not_ready'; end if;
  if exists(select 1 from public.integration_sync_jobs
    where connection_id=connection.id and status in ('QUEUED','PROCESSING')) then
    raise exception 'integration_sync_already_queued';
  end if;
  insert into public.integration_sync_jobs(
    workspace_id,connection_id,provider,sync_direction,cursor_before,requested_by
  ) values(
    connection.workspace_id,connection.id,connection.provider,
    connection.sync_direction,connection.cursor_value,auth.uid()
  ) returning * into result;
  return result;
end;
$$;

create or replace function public.claim_integration_sync_jobs(
  batch_size integer,worker_id text,lease_seconds integer default 900
)
returns setof public.integration_sync_jobs
language plpgsql security definer set search_path=public
as $$
begin
  return query with claimed as (
    select id from public.integration_sync_jobs
    where ((status in ('QUEUED','FAILED') and available_at<=now())
      or (status='PROCESSING' and lease_expires_at<now()))
      and attempts<5
    order by created_at for update skip locked limit greatest(1,least(batch_size,50))
  )
  update public.integration_sync_jobs q set
    status='PROCESSING',attempts=q.attempts+1,locked_at=now(),
    lease_expires_at=now()+make_interval(secs=>greatest(60,least(lease_seconds,3600))),
    locked_by=left(worker_id,120),lease_token=gen_random_uuid(),updated_at=now()
  from claimed where q.id=claimed.id returning q.*;
end;
$$;

create or replace function public.complete_integration_sync_job(
  job_id uuid,token uuid,next_cursor text
)
returns void
language plpgsql security definer set search_path=public
as $$
declare job public.integration_sync_jobs;
begin
  update public.integration_sync_jobs set
    status='COMPLETED',cursor_after=next_cursor,completed_at=now(),
    locked_at=null,lease_expires_at=null,locked_by=null,lease_token=null,
    last_error=null,updated_at=now()
  where id=job_id and status='PROCESSING' and lease_token=token and lease_expires_at>=now()
  returning * into job;
  if not found then raise exception 'worker_lease_lost'; end if;
  update public.integration_connections set
    cursor_value=next_cursor,last_synced_at=now(),last_error=null,status='CONNECTED',updated_at=now()
  where id=job.connection_id;
end;
$$;

create or replace function public.fail_integration_sync_job(
  job_id uuid,token uuid,failure text
)
returns void
language plpgsql security definer set search_path=public
as $$
declare job public.integration_sync_jobs;
begin
  update public.integration_sync_jobs set
    status=case when attempts>=5 then 'DEAD' else 'FAILED' end,
    available_at=now()+make_interval(mins=>least(360,power(2,greatest(attempts,1))::integer)),
    last_error=left(coalesce(failure,'UNKNOWN'),500),locked_at=null,
    lease_expires_at=null,locked_by=null,lease_token=null,updated_at=now()
  where id=job_id and status='PROCESSING' and lease_token=token returning * into job;
  if not found then raise exception 'worker_lease_lost'; end if;
  update public.integration_connections set
    status=case when job.status='DEAD' then 'ACTION_REQUIRED' else 'DEGRADED' end,
    last_error=job.last_error,updated_at=now() where id=job.connection_id;
end;
$$;

create or replace function public.record_worker_heartbeat(
  worker text,successful boolean,failure text default null,details jsonb default '{}'::jsonb
)
returns public.worker_heartbeats
language plpgsql security definer set search_path=public
as $$
declare result public.worker_heartbeats;normalized text:=upper(worker);
begin
  if normalized not in (
    'REMINDERS','NOTIFICATION_OUTBOX','CALENDAR_DELIVERIES',
    'GENERATED_JOBS','WEBHOOK_INBOX','INTEGRATION_SYNC'
  ) then raise exception 'worker_key_invalid'; end if;
  insert into public.worker_heartbeats(
    worker_key,last_seen_at,last_success_at,last_failure_at,
    consecutive_failures,last_error,metadata,updated_at
  ) values(
    normalized,now(),case when successful then now() end,
    case when not successful then now() end,case when successful then 0 else 1 end,
    case when successful then null else left(coalesce(failure,'UNKNOWN'),500) end,
    coalesce(details,'{}'::jsonb),now()
  ) on conflict(worker_key) do update set
    last_seen_at=now(),
    last_success_at=case when successful then now() else worker_heartbeats.last_success_at end,
    last_failure_at=case when successful then worker_heartbeats.last_failure_at else now() end,
    consecutive_failures=case when successful then 0 else worker_heartbeats.consecutive_failures+1 end,
    last_error=case when successful then null else left(coalesce(failure,'UNKNOWN'),500) end,
    metadata=coalesce(details,'{}'::jsonb),updated_at=now()
  returning * into result;
  return result;
end;
$$;

revoke all on function public.configure_integration(text,text,text,text),
  public.request_integration_sync(text),
  public.claim_integration_sync_jobs(integer,text,integer),
  public.complete_integration_sync_job(uuid,uuid,text),
  public.fail_integration_sync_job(uuid,uuid,text)
from public,anon;
grant execute on function public.configure_integration(text,text,text,text),
  public.request_integration_sync(text) to authenticated;
revoke all on function public.claim_integration_sync_jobs(integer,text,integer),
  public.complete_integration_sync_job(uuid,uuid,text),
  public.fail_integration_sync_job(uuid,uuid,text)
from authenticated;
grant execute on function public.claim_integration_sync_jobs(integer,text,integer),
  public.complete_integration_sync_job(uuid,uuid,text),
  public.fail_integration_sync_job(uuid,uuid,text)
to service_role;

-- Add integration jobs to the already complete operations/readiness snapshots.
alter function public.operational_snapshot() rename to operational_snapshot_core_v091;
create or replace function public.operational_snapshot()
returns jsonb
language plpgsql stable security definer set search_path=public
as $$
declare base jsonb;ws uuid:=public.current_workspace_id();integration_metric jsonb;
begin
  base:=public.operational_snapshot_core_v091();
  integration_metric:=jsonb_build_object(
    'key','INTEGRATION_SYNC','slaMinutes',30,
    'pending',(select count(*) from public.integration_sync_jobs where workspace_id=ws and status in ('QUEUED','PROCESSING','FAILED')),
    'failed',(select count(*) from public.integration_sync_jobs where workspace_id=ws and status in ('FAILED','DEAD')),
    'stuck',(select count(*) from public.integration_sync_jobs where workspace_id=ws and status='PROCESSING' and lease_expires_at<now()),
    'breached',(select count(*) from public.integration_sync_jobs where workspace_id=ws and status not in ('COMPLETED') and created_at<now()-interval '30 minutes'),
    'oldest',(select min(created_at) from public.integration_sync_jobs where workspace_id=ws and status not in ('COMPLETED'))
  );
  return jsonb_set(base,'{queues}',coalesce(base->'queues','[]'::jsonb)||jsonb_build_array(integration_metric));
end;
$$;

alter function public.service_readiness_snapshot(uuid) rename to service_readiness_snapshot_core_v091;
create or replace function public.service_readiness_snapshot(
  target_workspace uuid default '00000000-0000-4000-8000-000000000001'
)
returns jsonb
language plpgsql stable security definer set search_path=public
as $$
declare base jsonb;integration_failed integer;integration_stuck integer;missing integer;
begin
  base:=public.service_readiness_snapshot_core_v091(target_workspace);
  select count(*) into integration_failed from public.integration_sync_jobs
    where workspace_id=target_workspace and status in ('FAILED','DEAD');
  select count(*) into integration_stuck from public.integration_sync_jobs
    where workspace_id=target_workspace and status='PROCESSING' and lease_expires_at<now();
  missing:=greatest(0,6-coalesce((base->>'registeredWorkers')::integer,0));
  return base||jsonb_build_object(
    'missingWorkers',missing,
    'staleWorkers',(base->>'staleWorkers')::integer
      -(base->>'missingWorkers')::integer+missing,
    'failedJobs',(base->>'failedJobs')::integer+integration_failed,
    'stuckJobs',(base->>'stuckJobs')::integer+integration_stuck,
    'ready',((base->>'staleWorkers')::integer-(base->>'missingWorkers')::integer+missing)=0
      and (base->>'failedJobs')::integer+integration_failed=0
      and (base->>'stuckJobs')::integer+integration_stuck=0
  );
end;
$$;

revoke all on function public.operational_snapshot() from public,anon;
grant execute on function public.operational_snapshot() to authenticated;
revoke all on function public.service_readiness_snapshot(uuid)
  from public,anon,authenticated;
grant execute on function public.service_readiness_snapshot(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- NBA evaluation ledger and business outcome analytics.
-- ---------------------------------------------------------------------------

create table if not exists public.next_action_generation_batches(
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  requested_by uuid references auth.users(id),
  target_organization_id uuid references public.organizations(id) on delete set null,
  generated_count integer not null default 0,
  created_at timestamptz not null default now()
);
create table if not exists public.next_action_evaluations(
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  batch_id uuid not null references public.next_action_generation_batches(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  rule_key text not null,
  rule_version text not null,
  applicable boolean not null,
  reason text not null,
  action_id uuid references public.next_best_actions(id) on delete set null,
  created_at timestamptz not null default now(),
  unique(batch_id,organization_id,rule_key)
);
alter table public.next_action_generation_batches enable row level security;
alter table public.next_action_evaluations enable row level security;
create policy "members read NBA batches" on public.next_action_generation_batches
  for select to authenticated using(public.is_workspace_member(workspace_id));
create policy "members read NBA evaluations" on public.next_action_evaluations
  for select to authenticated using(public.is_workspace_member(workspace_id));
grant select on public.next_action_generation_batches,public.next_action_evaluations to authenticated;

alter function public.generate_next_best_actions(uuid) rename to generate_next_best_actions_core_v091;
create or replace function public.generate_next_best_actions(target_organization uuid default null)
returns integer
language plpgsql
security definer
set search_path=public
as $$
declare
  generated integer;
  batch public.next_action_generation_batches;
  organization public.organizations;
  rule_name text;
  action public.next_best_actions;
begin
  generated:=public.generate_next_best_actions_core_v091(target_organization);
  insert into public.next_action_generation_batches(
    workspace_id,requested_by,target_organization_id,generated_count
  ) values(
    public.current_workspace_id(),auth.uid(),target_organization,generated
  ) returning * into batch;
  for organization in select * from public.organizations
    where workspace_id=public.current_workspace_id()
      and (target_organization is null or id=target_organization)
      and public.can_access_owned_record(workspace_id,'ORGANIZATION',id,owner_id,false)
  loop
    foreach rule_name in array array['STALE_RELATIONSHIP','RENEWAL_WINDOW','PIPELINE_HYGIENE'] loop
      select * into action from public.next_best_actions
        where workspace_id=organization.workspace_id and organization_id=organization.id
          and rule_key=rule_name and status='SUGGESTED'
        order by updated_at desc limit 1;
      insert into public.next_action_evaluations(
        workspace_id,batch_id,organization_id,rule_key,rule_version,
        applicable,reason,action_id
      ) values(
        organization.workspace_id,batch.id,organization.id,rule_name,'rules-2026.07.1',
        action.id is not null,
        case when action.id is not null then 'RULE_MATCHED' else 'RULE_NOT_APPLICABLE' end,
        action.id
      );
    end loop;
  end loop;
  return generated;
end;
$$;

create or replace function public.business_improvement_snapshot()
returns jsonb
language plpgsql
stable
security definer
set search_path=public
as $$
declare
  ws uuid:=public.current_workspace_id();
  total_customers integer;
  retained_customers integer;
  renewed integer;
  lost integer;
  overdue_renewals integer;
  suggested integer;
  accepted integer;
  rejected integer;
  completed integer;
  forecast numeric;
  actual numeric;
  queue_pending integer:=0;
  queue_breached integer:=0;
  queue jsonb;
begin
  if ws is null then raise exception 'analytics_not_authorized'; end if;
  select count(distinct organization_id) into total_customers from public.contracts
    where workspace_id=ws and start_date>=current_date-365;
  select count(distinct organization_id) into retained_customers from public.contracts
    where workspace_id=ws and status in ('ACTIVE','RENEWAL_PREP','NEGOTIATING')
      and end_date>=current_date;
  select count(*) filter(where stage='RENEWED'),count(*) filter(where stage='LOST'),
    count(*) filter(where due_at<now() and stage not in ('RENEWED','LOST'))
  into renewed,lost,overdue_renewals from public.contract_renewal_playbooks where workspace_id=ws;
  select count(*) filter(where status='SUGGESTED'),
    count(*) filter(where status='ACCEPTED'),
    count(*) filter(where status='REJECTED'),
    count(*) filter(where status='ACCEPTED' and exists(
      select 1 from public.crm_tasks t where t.id=next_best_actions.draft_task_id and t.status='DONE'
    ))
  into suggested,accepted,rejected,completed from public.next_best_actions where workspace_id=ws;
  select coalesce(sum(amount*probability/100.0),0) into forecast from public.opportunities
    where workspace_id=ws and expected_close_date between current_date-90 and current_date;
  select coalesce(sum(contract_value),0) into actual from public.contracts
    where workspace_id=ws and created_at>=now()-interval '90 days'
      and status not in ('CANCELLED','EXPIRED');
  for queue in select value from jsonb_array_elements(public.operational_snapshot()->'queues') loop
    queue_pending:=queue_pending+coalesce((queue->>'pending')::integer,0);
    queue_breached:=queue_breached+coalesce((queue->>'breached')::integer,0);
  end loop;
  return jsonb_build_object(
    'retention',jsonb_build_object(
      'eligible',total_customers,'retained',retained_customers,
      'rate',case when total_customers=0 then 0 else round(100.0*retained_customers/total_customers,1) end),
    'renewal',jsonb_build_object(
      'renewed',renewed,'lost',lost,'overdue',overdue_renewals,
      'conversionRate',case when renewed+lost=0 then 0 else round(100.0*renewed/(renewed+lost),1) end),
    'forecast',jsonb_build_object(
      'forecast',forecast,'actual',actual,
      'accuracy',case when greatest(forecast,actual)=0 then 100
        else round(greatest(0,100-100*abs(forecast-actual)/greatest(forecast,actual)),1) end),
    'queueSla',jsonb_build_object(
      'pending',queue_pending,'breached',queue_breached,
      'attainment',case when queue_pending=0 then 100
        else round(100.0*greatest(queue_pending-queue_breached,0)/queue_pending,1) end),
    'nextBestAction',jsonb_build_object(
      'suggested',suggested,'accepted',accepted,'rejected',rejected,'completed',completed,
      'adoptionRate',case when accepted+rejected=0 then 0
        else round(100.0*accepted/(accepted+rejected),1) end,
      'completionRate',case when accepted=0 then 0 else round(100.0*completed/accepted,1) end)
  );
end;
$$;

revoke all on function public.generate_next_best_actions(uuid),
  public.business_improvement_snapshot() from public,anon;
grant execute on function public.generate_next_best_actions(uuid),
  public.business_improvement_snapshot() to authenticated;

-- ---------------------------------------------------------------------------
-- Permission explanations must remain available at AAL1 to explain why a
-- privileged action is denied.
-- ---------------------------------------------------------------------------

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
  ws uuid;
  normalized_type text:=upper(trim(resource_type));
  normalized_action text:=upper(trim(requested_action));
  needs_edit boolean;
  target_owner uuid;
  target_status text;
  allowed boolean:=false;
  actor_role text;
  explanation text;
  aal text:=coalesce(auth.jwt()->>'aal','aal1');
begin
  select workspace_id,role into ws,actor_role from public.workspace_memberships
    where user_id=auth.uid() and status='ACTIVE' order by created_at limit 1;
  if ws is null or actor_role is null then
    raise exception 'permission_explanation_not_authorized';
  end if;
  if normalized_action not in ('READ','EDIT','DELETE','APPROVE','RETRY') then
    raise exception 'permission_explanation_invalid_action';
  end if;
  needs_edit:=normalized_action<>'READ';
  if actor_role in ('SUPER_ADMIN','ADMIN') and needs_edit and aal<>'aal2' then
    return jsonb_build_object(
      'exists',null,'allowed',false,'resourceType',normalized_type,
      'resourceId',resource_id,'action',normalized_action,'reason','MFA_REQUIRED',
      'role',actor_role,'mfaLevel',aal,'requiredMfaLevel','aal2','workspaceId',ws
    );
  end if;
  if normalized_type='ORGANIZATION' then
    select owner_id,status into target_owner,target_status from public.organizations where id=resource_id and workspace_id=ws;
  elsif normalized_type='CONTACT' then
    select owner_id,status into target_owner,target_status from public.contacts where id=resource_id and workspace_id=ws;
  elsif normalized_type='OPPORTUNITY' then
    select owner_id,stage into target_owner,target_status from public.opportunities where id=resource_id and workspace_id=ws;
  elsif normalized_type='CONTRACT' then
    select owner_id,status into target_owner,target_status from public.contracts where id=resource_id and workspace_id=ws;
  elsif normalized_type='APPOINTMENT' then
    select owner_id,status into target_owner,target_status from public.appointments where id=resource_id and workspace_id=ws;
  elsif normalized_type='TASK' then
    select owner_id,status into target_owner,target_status from public.crm_tasks where id=resource_id and workspace_id=ws;
  elsif normalized_type='QUOTE' then
    select owner_id,status into target_owner,target_status from public.quotes where id=resource_id and workspace_id=ws;
  else raise exception 'permission_explanation_invalid_resource';
  end if;
  if not found then
    return jsonb_build_object(
      'exists',false,'allowed',false,'resourceType',normalized_type,
      'resourceId',resource_id,'action',normalized_action,
      'reason','RECORD_NOT_FOUND_IN_WORKSPACE','role',actor_role,
      'mfaLevel',aal,'workspaceId',ws
    );
  end if;
  allowed:=public.can_access_owned_record(ws,normalized_type,resource_id,target_owner,needs_edit);
  explanation:=case
    when actor_role in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR') then 'ROLE_SCOPE'
    when target_owner=auth.uid() then 'RECORD_OWNER'
    when exists(select 1 from public.record_collaborators c
      where c.workspace_id=ws and c.resource_type=normalized_type
        and c.resource_id=$2 and c.user_id=auth.uid()
        and (not needs_edit or c.access_level='EDIT')) then 'EXPLICIT_COLLABORATOR'
    when allowed then 'TEAM_HIERARCHY' else 'OUTSIDE_ROLE_TEAM_OWNER_SCOPE' end;
  return jsonb_build_object(
    'exists',true,'allowed',allowed,'resourceType',normalized_type,
    'resourceId',resource_id,'action',normalized_action,'reason',explanation,
    'role',actor_role,'isOwner',target_owner=auth.uid(),'status',target_status,
    'mfaLevel',aal,'requiredMfaLevel',case when needs_edit
      and actor_role in ('SUPER_ADMIN','ADMIN') then 'aal2' else 'aal1' end,
    'workspaceId',ws
  );
end;
$$;

drop trigger if exists audit_integration_sync_jobs on public.integration_sync_jobs;
create trigger audit_integration_sync_jobs
after insert or update or delete on public.integration_sync_jobs
for each row execute procedure public.audit_row_change();
drop trigger if exists audit_next_action_generation_batches on public.next_action_generation_batches;
create trigger audit_next_action_generation_batches
after insert or update or delete on public.next_action_generation_batches
for each row execute procedure public.audit_row_change();
