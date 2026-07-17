-- v0.9.0: make PostgreSQL the final authorization and tenant-integrity boundary.

-- The legacy v0.7 refund function bypasses the v0.8 approval/refund ledger.
revoke all on function public.refund_payment(uuid,text) from public,anon,authenticated;
drop function if exists public.refund_payment(uuid,text);

-- Approval rows and their audit trail are append-only through controlled RPCs.
drop policy if exists "authenticated users submit approvals" on public.approval_requests;
drop policy if exists "participants append permitted audit" on public.approval_actions;
revoke insert on public.approval_requests,public.approval_actions from authenticated;

-- Tenant-qualified keys prevent new cross-workspace relationships even when a
-- Security Definer function or service client supplies an arbitrary UUID.
create unique index if not exists organizations_workspace_id_uidx on public.organizations(workspace_id,id);
create unique index if not exists contacts_workspace_id_uidx on public.contacts(workspace_id,id);
create unique index if not exists products_workspace_id_uidx on public.products(workspace_id,id);
create unique index if not exists opportunities_workspace_id_uidx on public.opportunities(workspace_id,id);
create unique index if not exists contracts_workspace_id_uidx on public.contracts(workspace_id,id);
create unique index if not exists payments_workspace_id_uidx on public.payments(workspace_id,id);
create unique index if not exists quotes_workspace_id_uidx on public.quotes(workspace_id,id);

do $$
begin
  if not exists(select 1 from pg_constraint where conname='contacts_workspace_organization_fk') then
    alter table public.contacts add constraint contacts_workspace_organization_fk
      foreign key(workspace_id,organization_id) references public.organizations(workspace_id,id) not valid;
  end if;
  if not exists(select 1 from pg_constraint where conname='opportunities_workspace_organization_fk') then
    alter table public.opportunities add constraint opportunities_workspace_organization_fk
      foreign key(workspace_id,organization_id) references public.organizations(workspace_id,id) not valid;
  end if;
  if not exists(select 1 from pg_constraint where conname='opportunities_workspace_contact_fk') then
    alter table public.opportunities add constraint opportunities_workspace_contact_fk
      foreign key(workspace_id,primary_contact_id) references public.contacts(workspace_id,id) not valid;
  end if;
  if not exists(select 1 from pg_constraint where conname='opportunities_workspace_product_fk') then
    alter table public.opportunities add constraint opportunities_workspace_product_fk
      foreign key(workspace_id,product_id) references public.products(workspace_id,id) not valid;
  end if;
  if not exists(select 1 from pg_constraint where conname='contracts_workspace_organization_fk') then
    alter table public.contracts add constraint contracts_workspace_organization_fk
      foreign key(workspace_id,organization_id) references public.organizations(workspace_id,id) not valid;
  end if;
  if not exists(select 1 from pg_constraint where conname='contracts_workspace_product_fk') then
    alter table public.contracts add constraint contracts_workspace_product_fk
      foreign key(workspace_id,product_id) references public.products(workspace_id,id) not valid;
  end if;
  if not exists(select 1 from pg_constraint where conname='payments_workspace_contract_fk') then
    alter table public.payments add constraint payments_workspace_contract_fk
      foreign key(workspace_id,contract_id) references public.contracts(workspace_id,id) not valid;
  end if;
  if not exists(select 1 from pg_constraint where conname='payments_workspace_product_fk') then
    alter table public.payments add constraint payments_workspace_product_fk
      foreign key(workspace_id,product_id) references public.products(workspace_id,id) not valid;
  end if;
  if not exists(select 1 from pg_constraint where conname='quotes_workspace_organization_fk') then
    alter table public.quotes add constraint quotes_workspace_organization_fk
      foreign key(workspace_id,organization_id) references public.organizations(workspace_id,id) not valid;
  end if;
  if not exists(select 1 from pg_constraint where conname='quotes_workspace_opportunity_fk') then
    alter table public.quotes add constraint quotes_workspace_opportunity_fk
      foreign key(workspace_id,opportunity_id) references public.opportunities(workspace_id,id) not valid;
  end if;
  if not exists(select 1 from pg_constraint where conname='quotes_workspace_product_fk') then
    alter table public.quotes add constraint quotes_workspace_product_fk
      foreign key(workspace_id,product_id) references public.products(workspace_id,id) not valid;
  end if;
end $$;

create or replace function public.create_approval(request_kind text, object_type text, object_id text, business_reason text)
returns public.approval_requests
language plpgsql
security definer
set search_path=public
as $$
declare
  created public.approval_requests;
  next_number text;
  object_uuid uuid;
  ws uuid:=public.current_workspace_id();
  actor_role text:=public.current_crm_role();
  contract_row public.contracts;
  target_row public.performance_targets;
  quote_row public.quotes;
  refund_row public.refunds;
  payment_row public.payments;
begin
  request_kind:=upper(trim(coalesce(request_kind,'')));
  object_type:=upper(trim(coalesce(object_type,'')));
  if auth.uid() is null or ws is null or actor_role='' or nullif(trim(business_reason),'') is null then
    raise exception 'approval_not_authorized';
  end if;

  if request_kind in ('CONTRACT_SIGN','CONTRACT_EXPORT') then
    if object_type<>'CONTRACT' then raise exception 'approval_invalid_object'; end if;
    begin object_uuid:=object_id::uuid; exception when invalid_text_representation then raise exception 'approval_invalid_object'; end;
    select * into contract_row from public.contracts where id=object_uuid and workspace_id=ws;
    if not found or contract_row.status not in ('DRAFT','NEGOTIATING','RISK')
      or not public.can_access_owned_record(contract_row.workspace_id,'CONTRACT',contract_row.id,contract_row.owner_id,true)
      or actor_role not in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER','SALES_SPECIALIST') then
      raise exception 'approval_not_authorized';
    end if;
  elsif request_kind='PERFORMANCE_ALLOCATION' then
    if object_type<>'PERFORMANCE_TARGET' or actor_role not in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER') then
      raise exception 'approval_not_authorized';
    end if;
    begin object_uuid:=object_id::uuid; exception when invalid_text_representation then raise exception 'approval_invalid_object'; end;
    select * into target_row from public.performance_targets where id=object_uuid and workspace_id=ws;
    if not found or target_row.status<>'PENDING_APPROVAL'
      or (actor_role='SALES_MANAGER' and target_row.manager_id<>auth.uid()) then
      raise exception 'approval_object_not_found';
    end if;
  elsif request_kind='PERFORMANCE_SUMMARY' then
    if object_type<>'PERFORMANCE_SUMMARY' or object_id!~'^[a-zA-Z0-9_-]{3,80}$'
      or actor_role not in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER') then
      raise exception 'approval_not_authorized';
    end if;
  elsif request_kind='QUOTE_DISCOUNT' then
    if object_type<>'QUOTE' then raise exception 'approval_invalid_object'; end if;
    begin object_uuid:=object_id::uuid; exception when invalid_text_representation then raise exception 'approval_invalid_object'; end;
    select * into quote_row from public.quotes where id=object_uuid and workspace_id=ws;
    if not found or quote_row.status<>'DRAFT'
      or not public.can_access_owned_record(quote_row.workspace_id,'QUOTE',quote_row.id,quote_row.owner_id,true) then
      raise exception 'approval_not_authorized';
    end if;
  elsif request_kind='REFUND' then
    if object_type<>'REFUND' then raise exception 'approval_invalid_object'; end if;
    begin object_uuid:=object_id::uuid; exception when invalid_text_representation then raise exception 'approval_invalid_object'; end;
    select * into refund_row from public.refunds
      where id=object_uuid and workspace_id=ws and status='PENDING_APPROVAL' and requested_by=auth.uid();
    if not found then raise exception 'approval_object_not_found'; end if;
    select * into payment_row from public.payments where id=refund_row.payment_id and workspace_id=ws;
    select * into contract_row from public.contracts where id=payment_row.contract_id and workspace_id=ws;
    if not found or not public.can_access_owned_record(contract_row.workspace_id,'CONTRACT',contract_row.id,contract_row.owner_id,true)
      or actor_role not in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER','SALES_SPECIALIST') then
      raise exception 'approval_not_authorized';
    end if;
  elsif request_kind='MARKETING_CONTACT_EXPORT' then
    if object_type<>'MARKETING_CONTACT_EXPORT'
      or object_id!~'^(EMAIL|SMS|PHONE|WECHAT|WHATSAPP):MARKETING:[a-f0-9-]{36}$'
      or actor_role not in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER') then
      raise exception 'approval_not_authorized';
    end if;
  else
    raise exception 'approval_invalid_type';
  end if;

  next_number:='APR-'||to_char(clock_timestamp(),'YYMMDD')||'-'||lpad(nextval('public.approval_actions_id_seq')::text,6,'0');
  insert into public.approval_requests(
    workspace_id,request_number,request_type,business_object_type,business_object_id,
    requester_id,reason,expires_at
  ) values(
    ws,next_number,request_kind,object_type,object_id,auth.uid(),trim(business_reason),now()+interval '7 days'
  ) returning * into created;

  if request_kind='CONTRACT_SIGN' then
    update public.contracts set status='PENDING_APPROVAL',updated_at=now()
      where id=object_uuid and workspace_id=ws and status in ('DRAFT','NEGOTIATING','RISK');
    if not found then raise exception 'contract_state_changed'; end if;
  end if;
  insert into public.approval_actions(approval_request_id,actor_id,action,comment)
    values(created.id,auth.uid(),'SUBMITTED',trim(business_reason));
  return created;
exception when unique_violation then
  raise exception 'approval_already_pending';
end;
$$;

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
    or not public.can_access_owned_record(organization.workspace_id,'ORGANIZATION',organization.id,organization.owner_id,true) then
    raise exception 'quote_not_authorized';
  end if;
  if target_opportunity is not null then
    select * into opportunity from public.opportunities
      where id=target_opportunity and workspace_id=organization.workspace_id
        and organization_id=organization.id;
    if not found
      or not public.can_access_owned_record(opportunity.workspace_id,'OPPORTUNITY',opportunity.id,opportunity.owner_id,false) then
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

create or replace function public.request_refund(target_payment uuid,refund_amount numeric,refund_reason text)
returns public.refunds
language plpgsql
security definer
set search_path=public
as $$
declare
  payment public.payments;
  contract public.contracts;
  result public.refunds;
  request public.approval_requests;
  committed numeric;
  actor_role text:=public.current_crm_role();
begin
  if actor_role not in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER','SALES_SPECIALIST') then
    raise exception 'refund_not_authorized';
  end if;
  select * into payment from public.payments
    where id=target_payment and workspace_id=public.current_workspace_id()
      and status in ('CONFIRMED','REFUNDED') for update;
  if not found or nullif(trim(refund_reason),'') is null or refund_amount<=0 then
    raise exception 'refund_invalid';
  end if;
  select * into contract from public.contracts
    where id=payment.contract_id and workspace_id=payment.workspace_id;
  if not found
    or not public.can_access_owned_record(contract.workspace_id,'CONTRACT',contract.id,contract.owner_id,true) then
    raise exception 'refund_not_authorized';
  end if;
  select coalesce(sum(amount),0) into committed from public.refunds
    where payment_id=payment.id and workspace_id=payment.workspace_id
      and status in ('PENDING_APPROVAL','APPROVED','PAID');
  if committed+refund_amount>payment.amount then raise exception 'refund_exceeds_payment'; end if;
  insert into public.refunds(workspace_id,refund_number,payment_id,amount,reason,requested_by)
    values(
      payment.workspace_id,
      'RF-'||to_char(clock_timestamp(),'YYYYMMDDHH24MISSMS')||'-'||substr(gen_random_uuid()::text,1,8),
      payment.id,refund_amount,trim(refund_reason),auth.uid()
    ) returning * into result;
  request:=public.create_approval('REFUND','REFUND',result.id::text,refund_reason);
  update public.refunds set approval_request_id=request.id,updated_at=now()
    where id=result.id returning * into result;
  return result;
end;
$$;

create or replace function public.request_marketing_contact_export(export_channel text,business_reason text)
returns public.approval_requests
language plpgsql
security definer
set search_path=public
as $$
declare object_id text;eligible integer;actor_role text:=public.current_crm_role();
begin
  if actor_role not in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER') then
    raise exception 'marketing_export_not_authorized';
  end if;
  if upper(export_channel) not in ('EMAIL','SMS','PHONE','WECHAT','WHATSAPP') then
    raise exception 'marketing_channel_invalid';
  end if;
  select count(*) into eligible from public.contacts c
    where c.workspace_id=public.current_workspace_id()
      and public.contact_channel_allowed(c.id,upper(export_channel),'MARKETING');
  if eligible=0 then raise exception 'marketing_no_eligible_contacts'; end if;
  object_id:=upper(export_channel)||':MARKETING:'||gen_random_uuid();
  return public.create_approval(
    'MARKETING_CONTACT_EXPORT','MARKETING_CONTACT_EXPORT',object_id,business_reason
  );
end;
$$;

create or replace function public.resolve_data_quality_issue(target_issue uuid,resolution text,dismiss boolean default false)
returns public.data_quality_issues
language plpgsql
security definer
set search_path=public
as $$
declare result public.data_quality_issues;
begin
  if public.current_crm_role() not in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER') then
    raise exception 'quality_not_authorized';
  end if;
  update public.data_quality_issues
    set status=case when dismiss then 'DISMISSED' else 'RESOLVED' end,
      resolution_note=trim(resolution),resolved_by=auth.uid(),resolved_at=now()
    where id=target_issue and workspace_id=public.current_workspace_id()
      and status in ('OPEN','ASSIGNED') and nullif(trim(resolution),'') is not null
    returning * into result;
  if not found then raise exception 'quality_resolution_invalid'; end if;
  return result;
end;
$$;

create or replace function public.validate_import_row_scope()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare batch public.import_batches;
begin
  select * into batch from public.import_batches where id=new.batch_id;
  if not found or new.workspace_id<>batch.workspace_id then
    raise exception 'import_row_workspace_invalid';
  end if;
  if new.duplicate_entity_id is not null then
    if batch.resource_type='CONTACTS'
      and not exists(select 1 from public.contacts where id=new.duplicate_entity_id and workspace_id=batch.workspace_id) then
      raise exception 'import_duplicate_scope_invalid';
    elsif batch.resource_type='ORGANIZATIONS'
      and not exists(select 1 from public.organizations where id=new.duplicate_entity_id and workspace_id=batch.workspace_id) then
      raise exception 'import_duplicate_scope_invalid';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists import_rows_scope_guard on public.import_rows;
create trigger import_rows_scope_guard
before insert or update of workspace_id,batch_id,duplicate_entity_id
on public.import_rows for each row execute procedure public.validate_import_row_scope();

create or replace function public.create_appointment_with_delivery(
  title_zh text,title_en text,event_type text,relation_type text,relation_id uuid,
  relation_label text,starts timestamptz,ends timestamptz,event_channel text,
  reminders integer[],attendees jsonb
)
returns public.appointments
language plpgsql
security definer
set search_path=public
as $$
declare
  result public.appointments;
  attendee jsonb;
  attendee_row public.appointment_attendees;
  contact public.contacts;
  organization public.organizations;
begin
  if ends<=starts or event_type not in ('MEETING','CONSULTATION','FOLLOW_UP','DEADLINE')
    or nullif(trim(title_zh),'') is null or nullif(trim(title_en),'') is null then
    raise exception 'appointment_invalid';
  end if;
  if (relation_type is null)<>(relation_id is null) then raise exception 'appointment_relation_invalid'; end if;
  if relation_type='ORGANIZATION' then
    select * into organization from public.organizations
      where id=relation_id and workspace_id=public.current_workspace_id();
    if not found
      or not public.can_access_owned_record(organization.workspace_id,'ORGANIZATION',organization.id,organization.owner_id,true) then
      raise exception 'appointment_relation_invalid';
    end if;
  elsif relation_type='CONTACT' then
    select * into contact from public.contacts
      where id=relation_id and workspace_id=public.current_workspace_id();
    if not found
      or not public.can_access_owned_record(contact.workspace_id,'CONTACT',contact.id,contact.owner_id,true) then
      raise exception 'appointment_relation_invalid';
    end if;
  elsif relation_type is not null then
    raise exception 'appointment_relation_invalid';
  end if;

  insert into public.appointments(
    workspace_id,title_zh,title_en,appointment_type,related_type,related_id,related_label,
    starts_at,ends_at,channel,reminder_minutes,owner_id,created_by,event_version
  ) values(
    public.current_workspace_id(),trim(title_zh),trim(title_en),event_type,relation_type,relation_id,
    coalesce(relation_label,''),starts,ends,coalesce(event_channel,''),reminders,
    auth.uid(),auth.uid(),1
  ) returning * into result;

  if jsonb_typeof(attendees)='array' then
    for attendee in select * from jsonb_array_elements(attendees) loop
      if nullif(trim(attendee->>'email'),'') is null
        or coalesce((attendee->>'consentConfirmed')::boolean,false)=false then
        raise exception 'appointment_attendee_consent_required';
      end if;
      if nullif(attendee->>'contactId','') is not null then
        select * into contact from public.contacts
          where id=(attendee->>'contactId')::uuid and workspace_id=result.workspace_id;
        if not found or contact.email is null
          or lower(contact.email::text)<>lower(trim(attendee->>'email'))
          or not public.contact_channel_allowed(contact.id,'EMAIL','EVENT') then
          raise exception 'appointment_contact_event_consent_required';
        end if;
      end if;
      insert into public.appointment_attendees(
        workspace_id,appointment_id,contact_id,email,name,consent_confirmed,created_by
      ) values(
        result.workspace_id,result.id,nullif(attendee->>'contactId','')::uuid,
        lower(trim(attendee->>'email'))::citext,trim(coalesce(attendee->>'name','')),true,auth.uid()
      ) returning * into attendee_row;
      insert into public.calendar_deliveries(
        workspace_id,appointment_id,attendee_id,event_version,delivery_type,idempotency_key
      ) values(
        result.workspace_id,result.id,attendee_row.id,1,'INVITE',
        result.id||':'||attendee_row.id||':1:INVITE'
      );
    end loop;
  end if;
  return result;
end;
$$;

revoke all on function public.create_approval(text,text,text,text),
  public.create_quote(text,uuid,uuid,uuid,text,numeric,numeric,date,text,text),
  public.request_refund(uuid,numeric,text),
  public.request_marketing_contact_export(text,text),
  public.resolve_data_quality_issue(uuid,text,boolean),
  public.create_appointment_with_delivery(text,text,text,text,uuid,text,timestamptz,timestamptz,text,integer[],jsonb)
from public,anon;

grant execute on function public.create_approval(text,text,text,text),
  public.create_quote(text,uuid,uuid,uuid,text,numeric,numeric,date,text,text),
  public.request_refund(uuid,numeric,text),
  public.request_marketing_contact_export(text,text),
  public.resolve_data_quality_issue(uuid,text,boolean),
  public.create_appointment_with_delivery(text,text,text,text,uuid,text,timestamptz,timestamptz,text,integer[],jsonb)
to authenticated;
