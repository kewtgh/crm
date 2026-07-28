-- Resolve PL/pgSQL ambiguity between the quote_versions.version column and a
-- record variable. Keep this as a forward migration because 021 may already
-- be present in deployed databases.

create or replace function public.submit_quote(target_quote uuid, business_reason text)
returns public.quotes language plpgsql security definer set search_path=public
as $$
declare
  quote public.quotes;
  selected_version public.quote_versions;
  request public.approval_requests;
begin
  select * into quote
  from public.quotes q
  where q.id=target_quote and q.workspace_id=public.current_workspace_id()
  for update;

  if not found
    or quote.status<>'DRAFT'
    or not public.can_access_owned_record(quote.workspace_id,'QUOTE',quote.id,quote.owner_id,true)
  then
    raise exception 'quote_not_submittable';
  end if;

  select * into selected_version
  from public.quote_versions qv
  where qv.quote_id=quote.id and qv.version=quote.current_version;

  if selected_version.discount_amount>0 then
    request:=public.create_approval('QUOTE_DISCOUNT','QUOTE',quote.id::text,business_reason);
    update public.quotes
    set status='PENDING_DISCOUNT_APPROVAL', discount_approval_id=request.id, updated_at=now()
    where id=quote.id
    returning * into quote;
  else
    update public.quotes
    set status='APPROVED', updated_at=now()
    where id=quote.id
    returning * into quote;
  end if;

  return quote;
end;
$$;

create or replace function public.convert_quote_to_contract(target_quote uuid, contract_no text, period_start date, period_end date)
returns public.contracts language plpgsql security definer set search_path=public
as $$
declare
  quote public.quotes;
  selected_version public.quote_versions;
  result public.contracts;
begin
  select * into quote
  from public.quotes q
  where q.id=target_quote and q.workspace_id=public.current_workspace_id()
  for update;

  if not found
    or quote.status<>'ACCEPTED'
    or period_end<period_start
    or not public.can_access_owned_record(quote.workspace_id,'QUOTE',quote.id,quote.owner_id,true)
  then
    raise exception 'quote_not_convertible';
  end if;

  select * into selected_version
  from public.quote_versions qv
  where qv.quote_id=quote.id and qv.version=quote.current_version;

  insert into public.contracts(
    workspace_id, contract_number, organization_id, product_id, start_date,
    end_date, currency, contract_value, status, owner_id, created_by, quote_id
  ) values (
    quote.workspace_id, trim(contract_no), quote.organization_id, quote.product_id,
    period_start, period_end, quote.currency, selected_version.total_amount,
    'DRAFT', quote.owner_id, auth.uid(), quote.id
  ) returning * into result;

  update public.quotes set status='CONVERTED', updated_at=now() where id=quote.id;
  return result;
end;
$$;
