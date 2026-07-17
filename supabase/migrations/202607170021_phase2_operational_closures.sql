-- v0.8.0: customer 360, consent, quote-to-reconciliation, import quality, and calendar delivery.

alter table public.contacts add column if not exists do_not_contact boolean not null default false;
alter table public.contacts add column if not exists do_not_contact_reason text not null default '';

create table if not exists public.contact_consents (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default public.current_workspace_id() references public.workspaces(id),
  contact_id uuid not null references public.contacts(id) on delete cascade,
  channel text not null check (channel in ('EMAIL','SMS','PHONE','WECHAT','WHATSAPP')),
  purpose text not null check (purpose in ('MARKETING','SERVICE','TRANSACTIONAL','EVENT')),
  status text not null check (status in ('GRANTED','REVOKED','EXPIRED')),
  source text not null,
  evidence_note text not null default '',
  obtained_at timestamptz,
  revoked_at timestamptz,
  retention_until date,
  quiet_hours_start time,
  quiet_hours_end time,
  created_by uuid not null default auth.uid() references auth.users(id),
  updated_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(workspace_id,contact_id,channel,purpose),
  check ((status='GRANTED' and obtained_at is not null and revoked_at is null) or (status='REVOKED' and revoked_at is not null) or status='EXPIRED')
);
create index if not exists contact_consents_contact_idx on public.contact_consents(workspace_id,contact_id,status);

alter table public.approval_requests drop constraint if exists approval_requests_request_type_check;
alter table public.approval_requests add constraint approval_requests_request_type_check check (request_type in ('CONTRACT_SIGN','CONTRACT_EXPORT','PERFORMANCE_SUMMARY','PERFORMANCE_ALLOCATION','QUOTE_DISCOUNT','REFUND'));

create table if not exists public.quotes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default public.current_workspace_id() references public.workspaces(id),
  quote_number text not null,
  organization_id uuid not null references public.organizations(id),
  opportunity_id uuid references public.opportunities(id) on delete set null,
  product_id uuid references public.products(id) on delete set null,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  valid_until date not null,
  status text not null default 'DRAFT' check (status in ('DRAFT','PENDING_DISCOUNT_APPROVAL','APPROVED','ACCEPTED','REJECTED','EXPIRED','CONVERTED')),
  current_version integer not null default 1 check (current_version>0),
  discount_approval_id uuid references public.approval_requests(id) on delete set null,
  owner_id uuid not null default auth.uid() references auth.users(id),
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(workspace_id,quote_number)
);
create index if not exists quotes_scope_idx on public.quotes(workspace_id,status,updated_at desc);

create table if not exists public.quote_versions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default public.current_workspace_id() references public.workspaces(id),
  quote_id uuid not null references public.quotes(id) on delete cascade,
  version integer not null check (version>0),
  subtotal numeric(14,2) not null check (subtotal>=0),
  discount_amount numeric(14,2) not null default 0 check (discount_amount>=0),
  total_amount numeric(14,2) generated always as (subtotal-discount_amount) stored,
  terms_zh text not null default '',
  terms_en text not null default '',
  line_items jsonb not null default '[]'::jsonb,
  change_note text not null default '',
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  unique(quote_id,version),
  check (discount_amount<=subtotal)
);
create index if not exists quote_versions_quote_idx on public.quote_versions(workspace_id,quote_id,version desc);

alter table public.contracts add column if not exists quote_id uuid references public.quotes(id) on delete set null;

create table if not exists public.receivable_schedules (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default public.current_workspace_id() references public.workspaces(id),
  contract_id uuid not null references public.contracts(id) on delete cascade,
  installment_number integer not null check (installment_number>0),
  due_date date not null,
  amount numeric(14,2) not null check (amount>0),
  paid_amount numeric(14,2) not null default 0 check (paid_amount>=0),
  status text not null default 'SCHEDULED' check (status in ('SCHEDULED','PARTIALLY_PAID','PAID','OVERDUE','CANCELLED')),
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(contract_id,installment_number),
  check (paid_amount<=amount)
);
create index if not exists receivable_due_idx on public.receivable_schedules(workspace_id,status,due_date);

alter table public.payments add column if not exists receivable_schedule_id uuid references public.receivable_schedules(id) on delete set null;
alter table public.payments add column if not exists refunded_amount numeric(14,2) not null default 0 check (refunded_amount>=0 and refunded_amount<=amount);
alter table public.payments add column if not exists settlement_status text not null default 'UNMATCHED' check (settlement_status in ('UNMATCHED','MATCHED','PARTIAL','EXCEPTION'));

create table if not exists public.refunds (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default public.current_workspace_id() references public.workspaces(id),
  refund_number text not null,
  payment_id uuid not null references public.payments(id),
  amount numeric(14,2) not null check (amount>0),
  reason text not null,
  receipt_reference text,
  status text not null default 'PENDING_APPROVAL' check (status in ('PENDING_APPROVAL','APPROVED','PAID','REJECTED','CANCELLED')),
  approval_request_id uuid references public.approval_requests(id) on delete set null,
  requested_by uuid not null default auth.uid() references auth.users(id),
  approved_by uuid references auth.users(id),
  refunded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(workspace_id,refund_number)
);
create index if not exists refunds_payment_idx on public.refunds(workspace_id,payment_id,status);

create table if not exists public.reconciliation_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default public.current_workspace_id() references public.workspaces(id),
  contract_id uuid not null references public.contracts(id),
  payment_id uuid references public.payments(id) on delete set null,
  expected_amount numeric(14,2) not null,
  actual_amount numeric(14,2) not null,
  difference numeric(14,2) generated always as (actual_amount-expected_amount) stored,
  status text not null default 'OPEN' check (status in ('OPEN','MATCHED','INVESTIGATING','RESOLVED')),
  reason text not null default '',
  assigned_to uuid references auth.users(id),
  resolved_by uuid references auth.users(id),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(payment_id)
);
create index if not exists reconciliation_queue_idx on public.reconciliation_items(workspace_id,status,updated_at desc);

create table if not exists public.import_batches (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default public.current_workspace_id() references public.workspaces(id),
  resource_type text not null check (resource_type in ('ORGANIZATIONS','CONTACTS')),
  original_filename text not null,
  file_hash text not null,
  idempotency_key text not null,
  field_mapping jsonb not null,
  status text not null default 'VALIDATING' check (status in ('VALIDATING','NEEDS_DECISION','READY','PROCESSING','COMPLETED','PARTIAL_FAILED','ROLLED_BACK')),
  total_rows integer not null default 0,
  valid_rows integer not null default 0,
  invalid_rows integer not null default 0,
  duplicate_rows integer not null default 0,
  applied_rows integer not null default 0,
  failed_rows integer not null default 0,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  rolled_back_at timestamptz,
  unique(workspace_id,idempotency_key)
);
create index if not exists import_batches_queue_idx on public.import_batches(workspace_id,status,created_at desc);

create table if not exists public.import_rows (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default public.current_workspace_id() references public.workspaces(id),
  batch_id uuid not null references public.import_batches(id) on delete cascade,
  row_number integer not null check (row_number>0),
  raw_data jsonb not null,
  normalized_data jsonb not null default '{}'::jsonb,
  status text not null default 'PENDING' check (status in ('PENDING','VALID','INVALID','DUPLICATE','DECIDED','APPLIED','FAILED','SKIPPED','ROLLED_BACK')),
  errors jsonb not null default '[]'::jsonb,
  decision text check (decision is null or decision in ('CREATE','UPDATE','MERGE','SKIP')),
  duplicate_entity_id uuid,
  duplicate_score smallint check (duplicate_score is null or duplicate_score between 0 and 100),
  duplicate_reasons jsonb not null default '[]'::jsonb,
  applied_entity_id uuid,
  before_snapshot jsonb,
  after_snapshot jsonb,
  last_error text,
  decided_by uuid references auth.users(id),
  decided_at timestamptz,
  applied_at timestamptz,
  unique(batch_id,row_number)
);
create index if not exists import_rows_work_idx on public.import_rows(workspace_id,batch_id,status,row_number);

create table if not exists public.data_quality_issues (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default public.current_workspace_id() references public.workspaces(id),
  rule_key text not null,
  entity_type text not null,
  entity_id uuid not null,
  severity text not null check (severity in ('LOW','MEDIUM','HIGH')),
  title_key text not null,
  details jsonb not null default '{}'::jsonb,
  status text not null default 'OPEN' check (status in ('OPEN','ASSIGNED','RESOLVED','DISMISSED')),
  assigned_to uuid references auth.users(id),
  resolution_note text not null default '',
  resolved_by uuid references auth.users(id),
  resolved_at timestamptz,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique(workspace_id,rule_key,entity_type,entity_id)
);
create index if not exists data_quality_queue_idx on public.data_quality_issues(workspace_id,status,severity,last_seen_at desc);

create table if not exists public.appointment_attendees (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default public.current_workspace_id() references public.workspaces(id),
  appointment_id uuid not null references public.appointments(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete set null,
  email citext not null,
  name text not null default '',
  consent_confirmed boolean not null default false,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  unique(appointment_id,email)
);

create table if not exists public.calendar_deliveries (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default public.current_workspace_id() references public.workspaces(id),
  appointment_id uuid not null references public.appointments(id) on delete cascade,
  attendee_id uuid not null references public.appointment_attendees(id) on delete cascade,
  event_version integer not null check (event_version>0),
  delivery_type text not null check (delivery_type in ('INVITE','UPDATE','CANCEL')),
  status text not null default 'QUEUED' check (status in ('QUEUED','SENDING','DELIVERED','FAILED','CANCELLED')),
  idempotency_key text not null unique,
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  delivered_at timestamptz,
  provider_message_id text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(appointment_id,attendee_id,event_version,delivery_type)
);
create index if not exists calendar_delivery_queue_idx on public.calendar_deliveries(status,available_at,created_at);
alter table public.appointments add column if not exists event_version integer not null default 1 check (event_version>0);

create or replace function public.set_approval_required_role()
returns trigger language plpgsql set search_path=public
as $$ begin
  new.required_role:=case when new.request_type='CONTRACT_EXPORT' then 'SUPER_ADMIN' else 'ADMIN' end;
  return new;
end; $$;

create or replace function public.contact_channel_allowed(target_contact uuid, target_channel text, target_purpose text)
returns boolean language sql stable security definer set search_path=public
as $$
  select exists(
    select 1 from public.contacts c join public.contact_consents cc on cc.contact_id=c.id and cc.workspace_id=c.workspace_id
    where c.id=target_contact and c.workspace_id=public.current_workspace_id() and not c.do_not_contact
      and cc.channel=upper(target_channel) and cc.purpose=upper(target_purpose) and cc.status='GRANTED'
      and (cc.retention_until is null or cc.retention_until>=current_date)
  );
$$;

create or replace function public.save_contact_consent(target_contact uuid, target_channel text, target_purpose text, target_status text, consent_source text, evidence text default '', retained_until date default null, quiet_start time default null, quiet_end time default null)
returns public.contact_consents language plpgsql security definer set search_path=public
as $$
declare result public.contact_consents; contact public.contacts;
begin
  select * into contact from public.contacts where id=target_contact and workspace_id=public.current_workspace_id();
  if not found or not public.can_access_owned_record(contact.workspace_id,'CONTACT',contact.id,contact.owner_id,true) then raise exception 'consent_not_authorized'; end if;
  if upper(target_channel) not in ('EMAIL','SMS','PHONE','WECHAT','WHATSAPP') or upper(target_purpose) not in ('MARKETING','SERVICE','TRANSACTIONAL','EVENT') or upper(target_status) not in ('GRANTED','REVOKED') or nullif(trim(consent_source),'') is null then raise exception 'consent_invalid'; end if;
  insert into public.contact_consents(workspace_id,contact_id,channel,purpose,status,source,evidence_note,obtained_at,revoked_at,retention_until,quiet_hours_start,quiet_hours_end,created_by,updated_by)
  values(contact.workspace_id,contact.id,upper(target_channel),upper(target_purpose),upper(target_status),trim(consent_source),trim(coalesce(evidence,'')),case when upper(target_status)='GRANTED' then now() end,case when upper(target_status)='REVOKED' then now() end,retained_until,quiet_start,quiet_end,auth.uid(),auth.uid())
  on conflict(workspace_id,contact_id,channel,purpose) do update set status=excluded.status,source=excluded.source,evidence_note=excluded.evidence_note,obtained_at=case when excluded.status='GRANTED' then now() else contact_consents.obtained_at end,revoked_at=case when excluded.status='REVOKED' then now() else null end,retention_until=excluded.retention_until,quiet_hours_start=excluded.quiet_hours_start,quiet_hours_end=excluded.quiet_hours_end,updated_by=auth.uid(),updated_at=now()
  returning * into result;
  return result;
end; $$;

create or replace function public.create_quote(quote_no text, target_organization uuid, target_opportunity uuid, target_product uuid, quote_currency text, quote_subtotal numeric, quote_discount numeric, valid_through date, terms_zh text default '', terms_en text default '')
returns public.quotes language plpgsql security definer set search_path=public
as $$
declare result public.quotes; organization public.organizations;
begin
  select * into organization from public.organizations where id=target_organization and workspace_id=public.current_workspace_id();
  if not found or not public.can_access_owned_record(organization.workspace_id,'ORGANIZATION',organization.id,organization.owner_id,true) then raise exception 'quote_not_authorized'; end if;
  if nullif(trim(quote_no),'') is null or quote_currency!~'^[A-Z]{3}$' or quote_subtotal<0 or quote_discount<0 or quote_discount>quote_subtotal or valid_through<current_date then raise exception 'quote_invalid'; end if;
  insert into public.quotes(workspace_id,quote_number,organization_id,opportunity_id,product_id,currency,valid_until,owner_id,created_by)
  values(organization.workspace_id,trim(quote_no),organization.id,target_opportunity,target_product,upper(quote_currency),valid_through,auth.uid(),auth.uid()) returning * into result;
  insert into public.quote_versions(workspace_id,quote_id,version,subtotal,discount_amount,terms_zh,terms_en,created_by)
  values(result.workspace_id,result.id,1,quote_subtotal,quote_discount,trim(coalesce(terms_zh,'')),trim(coalesce(terms_en,'')),auth.uid());
  return result;
end; $$;

create or replace function public.add_quote_version(target_quote uuid, quote_subtotal numeric, quote_discount numeric, terms_zh text, terms_en text, change_reason text)
returns public.quote_versions language plpgsql security definer set search_path=public
as $$
declare quote public.quotes; result public.quote_versions; next_version integer;
begin
  select * into quote from public.quotes where id=target_quote and workspace_id=public.current_workspace_id() for update;
  if not found or quote.status not in ('DRAFT','REJECTED') or not public.can_access_owned_record(quote.workspace_id,'QUOTE',quote.id,quote.owner_id,true) then raise exception 'quote_not_editable'; end if;
  if quote_subtotal<0 or quote_discount<0 or quote_discount>quote_subtotal or nullif(trim(change_reason),'') is null then raise exception 'quote_version_invalid'; end if;
  next_version:=quote.current_version+1;
  insert into public.quote_versions(workspace_id,quote_id,version,subtotal,discount_amount,terms_zh,terms_en,change_note,created_by)
  values(quote.workspace_id,quote.id,next_version,quote_subtotal,quote_discount,trim(coalesce(terms_zh,'')),trim(coalesce(terms_en,'')),trim(change_reason),auth.uid()) returning * into result;
  update public.quotes set current_version=next_version,status='DRAFT',discount_approval_id=null,updated_at=now() where id=quote.id;
  return result;
end; $$;

create or replace function public.submit_quote(target_quote uuid, business_reason text)
returns public.quotes language plpgsql security definer set search_path=public
as $$
declare quote public.quotes; version public.quote_versions; request public.approval_requests;
begin
  select * into quote from public.quotes where id=target_quote and workspace_id=public.current_workspace_id() for update;
  if not found or quote.status<>'DRAFT' or not public.can_access_owned_record(quote.workspace_id,'QUOTE',quote.id,quote.owner_id,true) then raise exception 'quote_not_submittable'; end if;
  select * into version from public.quote_versions where quote_id=quote.id and version=quote.current_version;
  if version.discount_amount>0 then
    request:=public.create_approval('QUOTE_DISCOUNT','QUOTE',quote.id::text,business_reason);
    update public.quotes set status='PENDING_DISCOUNT_APPROVAL',discount_approval_id=request.id,updated_at=now() where id=quote.id returning * into quote;
  else update public.quotes set status='APPROVED',updated_at=now() where id=quote.id returning * into quote;
  end if;
  return quote;
end; $$;

create or replace function public.accept_quote(target_quote uuid)
returns public.quotes language plpgsql security definer set search_path=public
as $$
declare result public.quotes;
begin
  update public.quotes set status='ACCEPTED',updated_at=now() where id=target_quote and workspace_id=public.current_workspace_id() and status='APPROVED' and valid_until>=current_date and public.can_access_owned_record(workspace_id,'QUOTE',id,owner_id,true) returning * into result;
  if not found then raise exception 'quote_not_acceptable'; end if;
  return result;
end; $$;

create or replace function public.convert_quote_to_contract(target_quote uuid, contract_no text, period_start date, period_end date)
returns public.contracts language plpgsql security definer set search_path=public
as $$
declare quote public.quotes; version public.quote_versions; result public.contracts;
begin
  select * into quote from public.quotes where id=target_quote and workspace_id=public.current_workspace_id() for update;
  if not found or quote.status<>'ACCEPTED' or period_end<period_start or not public.can_access_owned_record(quote.workspace_id,'QUOTE',quote.id,quote.owner_id,true) then raise exception 'quote_not_convertible'; end if;
  select * into version from public.quote_versions where quote_id=quote.id and version=quote.current_version;
  insert into public.contracts(workspace_id,contract_number,organization_id,product_id,start_date,end_date,currency,contract_value,status,owner_id,created_by,quote_id)
  values(quote.workspace_id,trim(contract_no),quote.organization_id,quote.product_id,period_start,period_end,quote.currency,version.total_amount,'DRAFT',quote.owner_id,auth.uid(),quote.id) returning * into result;
  update public.quotes set status='CONVERTED',updated_at=now() where id=quote.id;
  return result;
end; $$;

create or replace function public.save_receivable_schedule(target_contract uuid, installments jsonb)
returns setof public.receivable_schedules language plpgsql security definer set search_path=public
as $$
declare contract public.contracts; item jsonb; total numeric:=0; index_no integer:=0;
begin
  select * into contract from public.contracts where id=target_contract and workspace_id=public.current_workspace_id() for update;
  if not found or not public.can_access_owned_record(contract.workspace_id,'CONTRACT',contract.id,contract.owner_id,true) then raise exception 'receivable_not_authorized'; end if;
  if exists(select 1 from public.payments where contract_id=contract.id and status='CONFIRMED') then raise exception 'receivable_has_payments'; end if;
  if jsonb_typeof(installments)<>'array' or jsonb_array_length(installments)=0 then raise exception 'receivable_invalid'; end if;
  for item in select * from jsonb_array_elements(installments) loop
    index_no:=index_no+1; total:=total+(item->>'amount')::numeric;
    if (item->>'amount')::numeric<=0 or (item->>'dueDate')::date<contract.start_date then raise exception 'receivable_invalid'; end if;
  end loop;
  if total<>contract.contract_value then raise exception 'receivable_total_mismatch'; end if;
  delete from public.receivable_schedules where contract_id=contract.id;
  index_no:=0;
  for item in select * from jsonb_array_elements(installments) loop
    index_no:=index_no+1;
    insert into public.receivable_schedules(workspace_id,contract_id,installment_number,due_date,amount,created_by) values(contract.workspace_id,contract.id,index_no,(item->>'dueDate')::date,(item->>'amount')::numeric,auth.uid());
  end loop;
  return query select * from public.receivable_schedules where contract_id=contract.id order by installment_number;
end; $$;

create or replace function public.refresh_receivable(target_schedule uuid)
returns void language plpgsql security definer set search_path=public
as $$
declare net numeric; schedule public.receivable_schedules;
begin
  select * into schedule from public.receivable_schedules where id=target_schedule for update;
  if not found then return; end if;
  select coalesce(sum(p.amount-p.refunded_amount),0) into net from public.payments p where p.receivable_schedule_id=schedule.id and p.status in ('CONFIRMED','REFUNDED');
  update public.receivable_schedules set paid_amount=least(amount,net),status=case when net>=amount then 'PAID' when net>0 then 'PARTIALLY_PAID' when due_date<current_date then 'OVERDUE' else 'SCHEDULED' end,updated_at=now() where id=schedule.id;
end; $$;

create or replace function public.record_payment(target_contract uuid, target_schedule uuid, payment_amount numeric, payment_currency text, payment_reference text, paid_on timestamptz)
returns public.payments language plpgsql security definer set search_path=public
as $$
declare contract public.contracts; schedule public.receivable_schedules; result public.payments; remaining numeric;
begin
  if public.current_crm_role() not in ('SUPER_ADMIN','ADMIN') then raise exception 'payment_not_authorized'; end if;
  select * into contract from public.contracts where id=target_contract and workspace_id=public.current_workspace_id();
  select * into schedule from public.receivable_schedules where id=target_schedule and contract_id=contract.id for update;
  if not found or payment_currency<>contract.currency or payment_amount<=0 or nullif(trim(payment_reference),'') is null then raise exception 'payment_invalid'; end if;
  remaining:=schedule.amount-schedule.paid_amount;
  if payment_amount>remaining then raise exception 'payment_exceeds_receivable'; end if;
  insert into public.payments(workspace_id,contract_id,product_id,receivable_schedule_id,amount,currency,status,paid_at,reference,verified_by,settlement_status)
  values(contract.workspace_id,contract.id,contract.product_id,schedule.id,payment_amount,contract.currency,'CONFIRMED',coalesce(paid_on,now()),trim(payment_reference),auth.uid(),'MATCHED') returning * into result;
  perform public.refresh_receivable(schedule.id);
  insert into public.reconciliation_items(workspace_id,contract_id,payment_id,expected_amount,actual_amount,status,assigned_to)
  values(contract.workspace_id,contract.id,result.id,payment_amount,payment_amount,'MATCHED',auth.uid());
  return result;
end; $$;

create or replace function public.request_refund(target_payment uuid, refund_amount numeric, refund_reason text)
returns public.refunds language plpgsql security definer set search_path=public
as $$
declare payment public.payments; result public.refunds; request public.approval_requests; committed numeric;
begin
  select * into payment from public.payments where id=target_payment and workspace_id=public.current_workspace_id() and status in ('CONFIRMED','REFUNDED') for update;
  if not found or nullif(trim(refund_reason),'') is null or refund_amount<=0 then raise exception 'refund_invalid'; end if;
  select coalesce(sum(amount),0) into committed from public.refunds where payment_id=payment.id and status in ('PENDING_APPROVAL','APPROVED','PAID');
  if committed+refund_amount>payment.amount then raise exception 'refund_exceeds_payment'; end if;
  insert into public.refunds(workspace_id,refund_number,payment_id,amount,reason,requested_by)
  values(payment.workspace_id,'RF-'||to_char(clock_timestamp(),'YYYYMMDDHH24MISSMS'),payment.id,refund_amount,trim(refund_reason),auth.uid()) returning * into result;
  request:=public.create_approval('REFUND','REFUND',result.id::text,refund_reason);
  update public.refunds set approval_request_id=request.id where id=result.id returning * into result;
  return result;
end; $$;

create or replace function public.complete_refund(target_refund uuid, receipt text)
returns public.refunds language plpgsql security definer set search_path=public
as $$
declare result public.refunds; payment public.payments; total_refunded numeric;
begin
  if public.current_crm_role() not in ('SUPER_ADMIN','ADMIN') or nullif(trim(receipt),'') is null then raise exception 'refund_completion_not_authorized'; end if;
  update public.refunds set status='PAID',receipt_reference=trim(receipt),refunded_at=now(),updated_at=now() where id=target_refund and workspace_id=public.current_workspace_id() and status='APPROVED' returning * into result;
  if not found then raise exception 'refund_not_approved'; end if;
  select * into payment from public.payments where id=result.payment_id for update;
  select coalesce(sum(amount),0) into total_refunded from public.refunds where payment_id=payment.id and status='PAID';
  update public.payments set refunded_amount=total_refunded,status=case when total_refunded=amount then 'REFUNDED' else status end,settlement_status=case when total_refunded=amount then 'UNMATCHED' else 'PARTIAL' end where id=payment.id returning * into payment;
  perform public.refresh_receivable(payment.receivable_schedule_id);
  update public.reconciliation_items set actual_amount=payment.amount-payment.refunded_amount,status=case when payment.refunded_amount=0 then 'MATCHED' else 'OPEN' end,reason=case when payment.refunded_amount>0 then 'REFUND_RECONCILIATION_REQUIRED' else '' end,updated_at=now() where payment_id=payment.id;
  return result;
end; $$;

create or replace function public.phase2_approval_side_effect()
returns trigger language plpgsql security definer set search_path=public
as $$
begin
  if old.status='PENDING' and new.status in ('APPROVED','REJECTED') and new.request_type='QUOTE_DISCOUNT' then
    update public.quotes set status=case when new.status='APPROVED' then 'APPROVED' else 'DRAFT' end,updated_at=now() where id=new.business_object_id::uuid and discount_approval_id=new.id;
  elsif old.status='PENDING' and new.status in ('APPROVED','REJECTED') and new.request_type='REFUND' then
    update public.refunds set status=case when new.status='APPROVED' then 'APPROVED' else 'REJECTED' end,approved_by=case when new.status='APPROVED' then new.decided_by end,updated_at=now() where id=new.business_object_id::uuid and approval_request_id=new.id;
  end if;
  return new;
end; $$;
drop trigger if exists phase2_approval_effect on public.approval_requests;
create trigger phase2_approval_effect after update of status on public.approval_requests for each row execute procedure public.phase2_approval_side_effect();

create or replace function public.customer_timeline(target_organization uuid, page_number integer default 1, page_size integer default 20, event_types text[] default null)
returns jsonb language plpgsql stable security definer set search_path=public
as $$
declare result jsonb; organization public.organizations; offset_rows integer:=greatest(0,(greatest(page_number,1)-1)*least(greatest(page_size,1),50)); limit_rows integer:=least(greatest(page_size,1),50);
begin
  select * into organization from public.organizations where id=target_organization and workspace_id=public.current_workspace_id();
  if not found or not public.can_access_owned_record(organization.workspace_id,'ORGANIZATION',organization.id,organization.owner_id,false) then raise exception 'timeline_not_authorized'; end if;
  with events as (
    select o.created_at occurred_at,'ORGANIZATION' event_type,o.id entity_id,o.name_zh title_zh,o.name_en title_en,o.status summary,jsonb_build_object('href','/schools/'||o.id) metadata from public.organizations o where o.id=organization.id
    union all select c.created_at,'CONTACT',c.id,c.name_zh,c.name_en,coalesce(c.email::text,c.phone,''),jsonb_build_object('href','/people/'||c.id) from public.contacts c where c.organization_id=organization.id
    union all select op.created_at,'OPPORTUNITY',op.id,op.title_zh,op.title_en,op.stage,jsonb_build_object('amount',op.amount,'currency',op.currency,'href','/opportunities') from public.opportunities op where op.organization_id=organization.id
    union all select t.created_at,'TASK',t.id,t.title_zh,t.title_en,t.status,jsonb_build_object('href','/tasks') from public.crm_tasks t where (t.related_type='ORGANIZATION' and t.related_id=organization.id) or (t.related_type='CONTACT' and t.related_id in (select id from public.contacts where organization_id=organization.id))
    union all select a.occurred_at,'ACTIVITY',a.id,a.summary_zh,a.summary_en,a.activity_type,jsonb_build_object('href','/schools/'||organization.id) from public.crm_activities a where a.organization_id=organization.id
    union all select a.starts_at,'APPOINTMENT',a.id,a.title_zh,a.title_en,a.status,jsonb_build_object('href','/calendar') from public.appointments a where (a.related_type='ORGANIZATION' and a.related_id=organization.id) or (a.related_type='CONTACT' and a.related_id in (select id from public.contacts where organization_id=organization.id))
    union all select c.created_at,'CONTRACT',c.id,c.contract_number,c.contract_number,c.status,jsonb_build_object('amount',c.contract_value,'currency',c.currency,'href','/contracts') from public.contracts c where c.organization_id=organization.id
    union all select p.coalesce_paid,p.event_type,p.entity_id,p.title_zh,p.title_en,p.summary,p.metadata from (select coalesce(pay.paid_at,pay.created_at) coalesce_paid,'PAYMENT'::text event_type,pay.id entity_id,coalesce(pay.reference,'') title_zh,coalesce(pay.reference,'') title_en,pay.status summary,jsonb_build_object('amount',pay.amount,'currency',pay.currency,'href','/finance') metadata from public.payments pay join public.contracts c on c.id=pay.contract_id where c.organization_id=organization.id) p
    union all select r.achieved_at,'RELATIONSHIP',r.id,r.milestone_type,r.milestone_type,r.evidence_status,jsonb_build_object('note',r.evidence_note,'href','/sales/performance') from public.relationship_milestones r where r.organization_id=organization.id
    union all select ar.created_at,'APPROVAL',ar.id,ar.request_number,ar.request_number,ar.status,jsonb_build_object('requestType',ar.request_type,'href','/admin/approvals') from public.approval_requests ar where (ar.business_object_type='ORGANIZATION' and ar.business_object_id=organization.id::text) or (ar.business_object_type='CONTRACT' and ar.business_object_id in (select id::text from public.contracts where organization_id=organization.id)) or (ar.business_object_type='QUOTE' and ar.business_object_id in (select id::text from public.quotes where organization_id=organization.id))
  ), filtered as (select * from events where event_types is null or event_type=any(event_types))
  select jsonb_build_object('items',coalesce((select jsonb_agg(jsonb_build_object('occurredAt',occurred_at,'type',event_type,'entityId',entity_id,'titleZh',title_zh,'titleEn',title_en,'summary',summary,'metadata',metadata) order by occurred_at desc,entity_id) from (select * from filtered order by occurred_at desc,entity_id limit limit_rows offset offset_rows) page),'[]'::jsonb),'total',(select count(*) from filtered),'page',greatest(page_number,1),'pageSize',limit_rows) into result;
  return result;
end; $$;

create or replace function public.create_import_batch(resource text, filename text, content_hash text, request_key text, mapping jsonb, rows jsonb)
returns public.import_batches language plpgsql security definer set search_path=public
as $$
declare batch public.import_batches; item jsonb; row_no integer:=0; normalized jsonb; errors jsonb; duplicate_id uuid; duplicate_score integer; reasons jsonb;
begin
  if public.current_crm_role() not in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER') then raise exception 'import_not_authorized'; end if;
  if upper(resource) not in ('ORGANIZATIONS','CONTACTS') or jsonb_typeof(rows)<>'array' or jsonb_array_length(rows)=0 or jsonb_array_length(rows)>500 then raise exception 'import_invalid'; end if;
  insert into public.import_batches(workspace_id,resource_type,original_filename,file_hash,idempotency_key,field_mapping,created_by)
  values(public.current_workspace_id(),upper(resource),left(filename,180),content_hash,request_key,mapping,auth.uid()) on conflict(workspace_id,idempotency_key) do update set idempotency_key=excluded.idempotency_key returning * into batch;
  if batch.total_rows>0 then return batch; end if;
  for item in select * from jsonb_array_elements(rows) loop
    row_no:=row_no+1; errors:='[]'::jsonb; duplicate_id:=null; duplicate_score:=null; reasons:='[]'::jsonb;
    normalized:=jsonb_build_object('nameZh',trim(coalesce(item->>'nameZh','')),'nameEn',trim(coalesce(item->>'nameEn','')),'email',lower(trim(coalesce(item->>'email',''))),'phone',trim(coalesce(item->>'phone','')),'city',trim(coalesce(item->>'city','')),'title',trim(coalesce(item->>'title','')));
    if normalized->>'nameZh'='' then errors:=errors||'[{"code":"NAME_ZH_REQUIRED"}]'::jsonb; end if;
    if normalized->>'nameEn'='' then errors:=errors||'[{"code":"NAME_EN_REQUIRED"}]'::jsonb; end if;
    if upper(resource)='CONTACTS' and normalized->>'email'='' and normalized->>'phone'='' then errors:=errors||'[{"code":"CONTACT_METHOD_REQUIRED"}]'::jsonb; end if;
    if jsonb_array_length(errors)=0 then
      if upper(resource)='CONTACTS' then
        select c.id,case when c.email= nullif(normalized->>'email','')::citext then 100 when c.phone<>'' and c.phone=normalized->>'phone' then 95 else 75 end,jsonb_build_array(case when c.email=nullif(normalized->>'email','')::citext then 'EMAIL' when c.phone=normalized->>'phone' then 'PHONE' else 'BILINGUAL_NAME' end) into duplicate_id,duplicate_score,reasons from public.contacts c where c.workspace_id=batch.workspace_id and ((normalized->>'email'<>'' and c.email=normalized->>'email'::citext) or (normalized->>'phone'<>'' and c.phone=normalized->>'phone') or (lower(c.name_zh)=lower(normalized->>'nameZh') and lower(c.name_en)=lower(normalized->>'nameEn'))) order by case when c.email=normalized->>'email'::citext then 1 else 2 end limit 1;
      else
        select o.id,90,'["BILINGUAL_NAME"]'::jsonb into duplicate_id,duplicate_score,reasons from public.organizations o where o.workspace_id=batch.workspace_id and (lower(o.name_zh)=lower(normalized->>'nameZh') or lower(o.name_en)=lower(normalized->>'nameEn')) limit 1;
      end if;
    end if;
    insert into public.import_rows(workspace_id,batch_id,row_number,raw_data,normalized_data,status,errors,duplicate_entity_id,duplicate_score,duplicate_reasons)
    values(batch.workspace_id,batch.id,row_no,item,normalized,case when jsonb_array_length(errors)>0 then 'INVALID' when duplicate_id is not null then 'DUPLICATE' else 'VALID' end,errors,duplicate_id,duplicate_score,reasons);
  end loop;
  update public.import_batches b set total_rows=(select count(*) from public.import_rows where batch_id=b.id),valid_rows=(select count(*) from public.import_rows where batch_id=b.id and status='VALID'),invalid_rows=(select count(*) from public.import_rows where batch_id=b.id and status='INVALID'),duplicate_rows=(select count(*) from public.import_rows where batch_id=b.id and status='DUPLICATE'),status=case when exists(select 1 from public.import_rows where batch_id=b.id and status='DUPLICATE') then 'NEEDS_DECISION' when exists(select 1 from public.import_rows where batch_id=b.id and status='INVALID') then 'PARTIAL_FAILED' else 'READY' end,updated_at=now() where b.id=batch.id returning * into batch;
  return batch;
end; $$;

create or replace function public.decide_import_row(target_row uuid, chosen_action text)
returns public.import_rows language plpgsql security definer set search_path=public
as $$
declare result public.import_rows; batch public.import_batches;
begin
  select b.* into batch from public.import_rows r join public.import_batches b on b.id=r.batch_id where r.id=target_row and b.workspace_id=public.current_workspace_id() and b.created_by=auth.uid();
  if not found or upper(chosen_action) not in ('CREATE','UPDATE','MERGE','SKIP') then raise exception 'import_decision_invalid'; end if;
  update public.import_rows set decision=upper(chosen_action),status=case when upper(chosen_action)='SKIP' then 'SKIPPED' else 'DECIDED' end,decided_by=auth.uid(),decided_at=now() where id=target_row and status='DUPLICATE' returning * into result;
  if not found then raise exception 'import_row_not_decidable'; end if;
  update public.import_batches set status=case when exists(select 1 from public.import_rows where batch_id=batch.id and status='DUPLICATE') then 'NEEDS_DECISION' when exists(select 1 from public.import_rows where batch_id=batch.id and status='INVALID') then 'PARTIAL_FAILED' else 'READY' end,updated_at=now() where id=batch.id;
  return result;
end; $$;

create or replace function public.process_import_batch(target_batch uuid, batch_size integer default 50)
returns public.import_batches language plpgsql security definer set search_path=public
as $$
declare batch public.import_batches; item public.import_rows; entity_id uuid; before_row jsonb; after_row jsonb; processed integer:=0;
begin
  select * into batch from public.import_batches where id=target_batch and workspace_id=public.current_workspace_id() and created_by=auth.uid() for update;
  if not found or batch.status not in ('READY','PROCESSING','PARTIAL_FAILED') or exists(select 1 from public.import_rows where batch_id=batch.id and status='DUPLICATE') then raise exception 'import_not_ready'; end if;
  update public.import_batches set status='PROCESSING',updated_at=now() where id=batch.id;
  for item in select * from public.import_rows where batch_id=batch.id and status in ('VALID','DECIDED') order by row_number for update skip locked limit greatest(1,least(batch_size,100)) loop
    begin
      entity_id:=null;before_row:=null;
      if coalesce(item.decision,'CREATE')='CREATE' and batch.resource_type='CONTACTS' then
        insert into public.contacts(workspace_id,name_zh,name_en,email,phone,title,status,owner_id,created_by) values(batch.workspace_id,item.normalized_data->>'nameZh',item.normalized_data->>'nameEn',nullif(item.normalized_data->>'email','')::citext,nullif(item.normalized_data->>'phone',''),item.normalized_data->>'title','UNVERIFIED',auth.uid(),auth.uid()) returning id into entity_id;
      elsif coalesce(item.decision,'CREATE')='CREATE' then
        insert into public.organizations(workspace_id,name_zh,name_en,city,status,owner_id,created_by) values(batch.workspace_id,item.normalized_data->>'nameZh',item.normalized_data->>'nameEn',item.normalized_data->>'city','UNVERIFIED',auth.uid(),auth.uid()) returning id into entity_id;
      elsif item.decision in ('UPDATE','MERGE') and batch.resource_type='CONTACTS' then
        select to_jsonb(c) into before_row from public.contacts c where id=item.duplicate_entity_id for update;
        update public.contacts set name_zh=item.normalized_data->>'nameZh',name_en=item.normalized_data->>'nameEn',email=coalesce(nullif(item.normalized_data->>'email','')::citext,email),phone=coalesce(nullif(item.normalized_data->>'phone',''),phone),title=coalesce(nullif(item.normalized_data->>'title',''),title),updated_at=now() where id=item.duplicate_entity_id returning id into entity_id;
      elsif item.decision in ('UPDATE','MERGE') then
        select to_jsonb(o) into before_row from public.organizations o where id=item.duplicate_entity_id for update;
        update public.organizations set name_zh=item.normalized_data->>'nameZh',name_en=item.normalized_data->>'nameEn',city=coalesce(nullif(item.normalized_data->>'city',''),city),updated_at=now() where id=item.duplicate_entity_id returning id into entity_id;
      end if;
      if batch.resource_type='CONTACTS' then select to_jsonb(c) into after_row from public.contacts c where id=entity_id; else select to_jsonb(o) into after_row from public.organizations o where id=entity_id; end if;
      update public.import_rows set status='APPLIED',applied_entity_id=entity_id,before_snapshot=before_row,after_snapshot=after_row,applied_at=now(),last_error=null where id=item.id;
    exception when others then update public.import_rows set status='FAILED',last_error=left(sqlerrm,500) where id=item.id;
    end;
    processed:=processed+1;
  end loop;
  update public.import_batches b set applied_rows=(select count(*) from public.import_rows where batch_id=b.id and status='APPLIED'),failed_rows=(select count(*) from public.import_rows where batch_id=b.id and status='FAILED'),status=case when exists(select 1 from public.import_rows where batch_id=b.id and status in ('VALID','DECIDED')) then 'PROCESSING' when exists(select 1 from public.import_rows where batch_id=b.id and status in ('INVALID','FAILED')) then 'PARTIAL_FAILED' else 'COMPLETED' end,completed_at=case when not exists(select 1 from public.import_rows where batch_id=b.id and status in ('VALID','DECIDED')) then now() end,updated_at=now() where b.id=batch.id returning * into batch;
  return batch;
end; $$;

create or replace function public.rollback_import_batch(target_batch uuid)
returns public.import_batches language plpgsql security definer set search_path=public
as $$
declare batch public.import_batches; item public.import_rows; current_row jsonb;
begin
  select * into batch from public.import_batches where id=target_batch and workspace_id=public.current_workspace_id() and created_by=auth.uid() and status in ('COMPLETED','PARTIAL_FAILED') for update;
  if not found then raise exception 'import_not_rollbackable'; end if;
  for item in select * from public.import_rows where batch_id=batch.id and status='APPLIED' order by row_number desc for update loop
    if batch.resource_type='CONTACTS' then select to_jsonb(c) into current_row from public.contacts c where id=item.applied_entity_id for update; else select to_jsonb(o) into current_row from public.organizations o where id=item.applied_entity_id for update; end if;
    if (current_row->>'updated_at') is distinct from (item.after_snapshot->>'updated_at') then raise exception 'import_rollback_conflict_row_%',item.row_number; end if;
    if item.before_snapshot is null then
      if batch.resource_type='CONTACTS' then delete from public.contacts where id=item.applied_entity_id; else delete from public.organizations where id=item.applied_entity_id; end if;
    elsif batch.resource_type='CONTACTS' then
      update public.contacts set name_zh=item.before_snapshot->>'name_zh',name_en=item.before_snapshot->>'name_en',email=nullif(item.before_snapshot->>'email','')::citext,phone=item.before_snapshot->>'phone',title=coalesce(item.before_snapshot->>'title',''),status=item.before_snapshot->>'status',updated_at=(item.before_snapshot->>'updated_at')::timestamptz where id=item.applied_entity_id;
    else
      update public.organizations set name_zh=item.before_snapshot->>'name_zh',name_en=item.before_snapshot->>'name_en',city=coalesce(item.before_snapshot->>'city',''),curriculum=coalesce(item.before_snapshot->>'curriculum',''),status=item.before_snapshot->>'status',updated_at=(item.before_snapshot->>'updated_at')::timestamptz where id=item.applied_entity_id;
    end if;
    update public.import_rows set status='ROLLED_BACK' where id=item.id;
  end loop;
  update public.import_batches set status='ROLLED_BACK',rolled_back_at=now(),updated_at=now() where id=batch.id returning * into batch;
  return batch;
end; $$;

create or replace function public.run_data_quality_rules()
returns integer language plpgsql security definer set search_path=public
as $$
declare marker timestamptz:=clock_timestamp(); affected integer;
begin
  if public.current_crm_role() not in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER') then raise exception 'quality_not_authorized'; end if;
  insert into public.data_quality_issues(workspace_id,rule_key,entity_type,entity_id,severity,title_key,details,last_seen_at)
  select workspace_id,'CONTACT_METHOD_MISSING','CONTACT',id,'HIGH','quality.rule.contactMethod',jsonb_build_object('nameZh',name_zh,'nameEn',name_en),marker from public.contacts where workspace_id=public.current_workspace_id() and email is null and coalesce(phone,'')=''
  on conflict(workspace_id,rule_key,entity_type,entity_id) do update set status=case when data_quality_issues.status='RESOLVED' then 'OPEN' else data_quality_issues.status end,details=excluded.details,last_seen_at=marker;
  insert into public.data_quality_issues(workspace_id,rule_key,entity_type,entity_id,severity,title_key,details,last_seen_at)
  select workspace_id,'OPPORTUNITY_NEXT_ACTION_MISSING','OPPORTUNITY',id,'MEDIUM','quality.rule.nextAction',jsonb_build_object('titleZh',title_zh,'titleEn',title_en),marker from public.opportunities where workspace_id=public.current_workspace_id() and stage not in ('WON','LOST') and next_action_zh='' and next_action_en=''
  on conflict(workspace_id,rule_key,entity_type,entity_id) do update set status=case when data_quality_issues.status='RESOLVED' then 'OPEN' else data_quality_issues.status end,details=excluded.details,last_seen_at=marker;
  insert into public.data_quality_issues(workspace_id,rule_key,entity_type,entity_id,severity,title_key,details,last_seen_at)
  select workspace_id,'ORGANIZATION_OWNER_MISSING','ORGANIZATION',id,'HIGH','quality.rule.owner',jsonb_build_object('nameZh',name_zh,'nameEn',name_en),marker from public.organizations where workspace_id=public.current_workspace_id() and owner_id is null
  on conflict(workspace_id,rule_key,entity_type,entity_id) do update set status=case when data_quality_issues.status='RESOLVED' then 'OPEN' else data_quality_issues.status end,details=excluded.details,last_seen_at=marker;
  update public.data_quality_issues set status='RESOLVED',resolution_note='AUTO_RESOLVED',resolved_at=now(),resolved_by=auth.uid() where workspace_id=public.current_workspace_id() and status in ('OPEN','ASSIGNED') and last_seen_at<marker;
  select count(*) into affected from public.data_quality_issues where workspace_id=public.current_workspace_id() and status in ('OPEN','ASSIGNED');
  return affected;
end; $$;

create or replace function public.resolve_data_quality_issue(target_issue uuid, resolution text, dismiss boolean default false)
returns public.data_quality_issues language plpgsql security definer set search_path=public
as $$
declare result public.data_quality_issues;
begin
  update public.data_quality_issues set status=case when dismiss then 'DISMISSED' else 'RESOLVED' end,resolution_note=trim(resolution),resolved_by=auth.uid(),resolved_at=now() where id=target_issue and workspace_id=public.current_workspace_id() and status in ('OPEN','ASSIGNED') and nullif(trim(resolution),'') is not null returning * into result;
  if not found then raise exception 'quality_resolution_invalid'; end if;
  return result;
end; $$;

create or replace function public.create_appointment_with_delivery(title_zh text, title_en text, event_type text, relation_type text, relation_id uuid, relation_label text, starts timestamptz, ends timestamptz, event_channel text, reminders integer[], attendees jsonb)
returns public.appointments language plpgsql security definer set search_path=public
as $$
declare result public.appointments; attendee jsonb; attendee_row public.appointment_attendees;
begin
  if ends<=starts or event_type not in ('MEETING','CONSULTATION','FOLLOW_UP','DEADLINE') then raise exception 'appointment_invalid'; end if;
  insert into public.appointments(workspace_id,title_zh,title_en,appointment_type,related_type,related_id,related_label,starts_at,ends_at,channel,reminder_minutes,owner_id,created_by,event_version)
  values(public.current_workspace_id(),trim(title_zh),trim(title_en),event_type,relation_type,relation_id,coalesce(relation_label,''),starts,ends,coalesce(event_channel,''),reminders,auth.uid(),auth.uid(),1) returning * into result;
  if jsonb_typeof(attendees)='array' then
    for attendee in select * from jsonb_array_elements(attendees) loop
      if nullif(trim(attendee->>'email'),'') is null or coalesce((attendee->>'consentConfirmed')::boolean,false)=false then raise exception 'appointment_attendee_consent_required'; end if;
      if attendee->>'contactId' is not null and not public.contact_channel_allowed((attendee->>'contactId')::uuid,'EMAIL','EVENT') then raise exception 'appointment_contact_event_consent_required'; end if;
      insert into public.appointment_attendees(workspace_id,appointment_id,contact_id,email,name,consent_confirmed,created_by)
      values(result.workspace_id,result.id,nullif(attendee->>'contactId','')::uuid,lower(trim(attendee->>'email'))::citext,trim(coalesce(attendee->>'name','')),true,auth.uid()) returning * into attendee_row;
      insert into public.calendar_deliveries(workspace_id,appointment_id,attendee_id,event_version,delivery_type,idempotency_key)
      values(result.workspace_id,result.id,attendee_row.id,1,'INVITE',result.id||':'||attendee_row.id||':1:INVITE');
    end loop;
  end if;
  return result;
end; $$;

create or replace function public.update_appointment_delivery(target_appointment uuid, action text, starts timestamptz default null, ends timestamptz default null)
returns public.appointments language plpgsql security definer set search_path=public
as $$
declare result public.appointments; next_version integer; delivery_type text:=upper(action);
begin
  select * into result from public.appointments where id=target_appointment and workspace_id=public.current_workspace_id() and public.can_access_owned_record(workspace_id,'APPOINTMENT',id,owner_id,true) for update;
  if not found or delivery_type not in ('UPDATE','CANCEL') then raise exception 'appointment_update_invalid'; end if;
  next_version:=result.event_version+1;
  update public.appointments set starts_at=coalesce(starts,starts_at),ends_at=coalesce(ends,ends_at),status=case when delivery_type='CANCEL' then 'CANCELLED' else status end,event_version=next_version,updated_at=now() where id=result.id returning * into result;
  insert into public.calendar_deliveries(workspace_id,appointment_id,attendee_id,event_version,delivery_type,idempotency_key)
  select result.workspace_id,result.id,a.id,next_version,delivery_type,result.id||':'||a.id||':'||next_version||':'||delivery_type from public.appointment_attendees a where a.appointment_id=result.id on conflict do nothing;
  return result;
end; $$;

create or replace function public.claim_calendar_deliveries(batch_size integer default 20)
returns setof public.calendar_deliveries language plpgsql security definer set search_path=public
as $$
begin
  return query with claimed as (select id from public.calendar_deliveries where status in ('QUEUED','FAILED') and available_at<=now() and attempts<5 order by available_at for update skip locked limit greatest(1,least(batch_size,100))) update public.calendar_deliveries d set status='SENDING',attempts=d.attempts+1,updated_at=now() from claimed where d.id=claimed.id returning d.*;
end; $$;

create or replace function public.complete_calendar_delivery(delivery_id uuid, provider_id text default null)
returns void language sql security definer set search_path=public as $$ update public.calendar_deliveries set status='DELIVERED',delivered_at=now(),provider_message_id=provider_id,last_error=null,updated_at=now() where id=delivery_id and status='SENDING'; $$;

create or replace function public.fail_calendar_delivery(delivery_id uuid, failure text)
returns void language sql security definer set search_path=public as $$ update public.calendar_deliveries set status='FAILED',last_error=left(failure,500),available_at=now()+make_interval(mins=>least(60,power(2,greatest(attempts,1))::integer)),updated_at=now() where id=delivery_id and status='SENDING'; $$;

alter table public.contact_consents enable row level security;
alter table public.quotes enable row level security;
alter table public.quote_versions enable row level security;
alter table public.receivable_schedules enable row level security;
alter table public.refunds enable row level security;
alter table public.reconciliation_items enable row level security;
alter table public.import_batches enable row level security;
alter table public.import_rows enable row level security;
alter table public.data_quality_issues enable row level security;
alter table public.appointment_attendees enable row level security;
alter table public.calendar_deliveries enable row level security;

create policy "scoped contact consents" on public.contact_consents for select to authenticated using(exists(select 1 from public.contacts c where c.id=contact_id and public.can_access_owned_record(c.workspace_id,'CONTACT',c.id,c.owner_id,false)));
create policy "scoped quotes" on public.quotes for select to authenticated using(public.can_access_owned_record(workspace_id,'QUOTE',id,owner_id,false));
create policy "scoped quote versions" on public.quote_versions for select to authenticated using(exists(select 1 from public.quotes q where q.id=quote_id and public.can_access_owned_record(q.workspace_id,'QUOTE',q.id,q.owner_id,false)));
create policy "scoped receivables" on public.receivable_schedules for select to authenticated using(exists(select 1 from public.contracts c where c.id=contract_id and public.can_access_owned_record(c.workspace_id,'CONTRACT',c.id,c.owner_id,false)));
create policy "refund participants" on public.refunds for select to authenticated using(public.is_workspace_member(workspace_id) and (requested_by=auth.uid() or public.current_crm_role() in ('SUPER_ADMIN','ADMIN')));
create policy "reconciliation leaders" on public.reconciliation_items for select to authenticated using(public.is_workspace_member(workspace_id) and public.current_crm_role() in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER'));
create policy "import owners read batches" on public.import_batches for select to authenticated using(public.is_workspace_member(workspace_id) and (created_by=auth.uid() or public.current_crm_role() in ('SUPER_ADMIN','ADMIN')));
create policy "import owners read rows" on public.import_rows for select to authenticated using(exists(select 1 from public.import_batches b where b.id=batch_id and (b.created_by=auth.uid() or public.current_crm_role() in ('SUPER_ADMIN','ADMIN'))));
create policy "quality leaders" on public.data_quality_issues for select to authenticated using(public.is_workspace_member(workspace_id) and public.current_crm_role() in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER'));
create policy "appointment attendees scoped" on public.appointment_attendees for select to authenticated using(exists(select 1 from public.appointments a where a.id=appointment_id and public.can_access_owned_record(a.workspace_id,'APPOINTMENT',a.id,a.owner_id,false)));
create policy "calendar deliveries scoped" on public.calendar_deliveries for select to authenticated using(exists(select 1 from public.appointments a where a.id=appointment_id and public.can_access_owned_record(a.workspace_id,'APPOINTMENT',a.id,a.owner_id,false)));

grant select on public.contact_consents,public.quotes,public.quote_versions,public.receivable_schedules,public.refunds,public.reconciliation_items,public.import_batches,public.import_rows,public.data_quality_issues,public.appointment_attendees,public.calendar_deliveries to authenticated;

revoke all on function public.contact_channel_allowed(uuid,text,text),public.save_contact_consent(uuid,text,text,text,text,text,date,time,time),public.create_quote(text,uuid,uuid,uuid,text,numeric,numeric,date,text,text),public.add_quote_version(uuid,numeric,numeric,text,text,text),public.submit_quote(uuid,text),public.accept_quote(uuid),public.convert_quote_to_contract(uuid,text,date,date),public.save_receivable_schedule(uuid,jsonb),public.record_payment(uuid,uuid,numeric,text,text,timestamptz),public.request_refund(uuid,numeric,text),public.complete_refund(uuid,text),public.customer_timeline(uuid,integer,integer,text[]),public.create_import_batch(text,text,text,text,jsonb,jsonb),public.decide_import_row(uuid,text),public.process_import_batch(uuid,integer),public.rollback_import_batch(uuid),public.run_data_quality_rules(),public.resolve_data_quality_issue(uuid,text,boolean),public.create_appointment_with_delivery(text,text,text,text,uuid,text,timestamptz,timestamptz,text,integer[],jsonb),public.update_appointment_delivery(uuid,text,timestamptz,timestamptz) from public;
grant execute on function public.contact_channel_allowed(uuid,text,text),public.save_contact_consent(uuid,text,text,text,text,text,date,time,time),public.create_quote(text,uuid,uuid,uuid,text,numeric,numeric,date,text,text),public.add_quote_version(uuid,numeric,numeric,text,text,text),public.submit_quote(uuid,text),public.accept_quote(uuid),public.convert_quote_to_contract(uuid,text,date,date),public.save_receivable_schedule(uuid,jsonb),public.record_payment(uuid,uuid,numeric,text,text,timestamptz),public.request_refund(uuid,numeric,text),public.complete_refund(uuid,text),public.customer_timeline(uuid,integer,integer,text[]),public.create_import_batch(text,text,text,text,jsonb,jsonb),public.decide_import_row(uuid,text),public.process_import_batch(uuid,integer),public.rollback_import_batch(uuid),public.run_data_quality_rules(),public.resolve_data_quality_issue(uuid,text,boolean),public.create_appointment_with_delivery(text,text,text,text,uuid,text,timestamptz,timestamptz,text,integer[],jsonb),public.update_appointment_delivery(uuid,text,timestamptz,timestamptz) to authenticated;
revoke all on function public.claim_calendar_deliveries(integer),public.complete_calendar_delivery(uuid,text),public.fail_calendar_delivery(uuid,text) from public,anon,authenticated;
grant execute on function public.claim_calendar_deliveries(integer),public.complete_calendar_delivery(uuid,text),public.fail_calendar_delivery(uuid,text) to service_role;

do $$
declare table_name text;
begin
  foreach table_name in array array['contact_consents','quotes','quote_versions','receivable_schedules','refunds','reconciliation_items','import_batches','import_rows','data_quality_issues','appointment_attendees','calendar_deliveries'] loop
    execute format('drop trigger if exists audit_%I on public.%I',table_name,table_name);
    execute format('create trigger audit_%I after insert or update or delete on public.%I for each row execute procedure public.audit_row_change()',table_name,table_name);
  end loop;
end $$;
