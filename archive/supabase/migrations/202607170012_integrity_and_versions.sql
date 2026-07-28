-- Close accounting and lifecycle gaps discovered during the post-implementation review.

alter table public.contract_versions add column if not exists workspace_id uuid references public.workspaces(id);
update public.contract_versions v set workspace_id=c.workspace_id from public.contracts c where c.id=v.contract_id and v.workspace_id is null;
alter table public.contract_versions alter column workspace_id set default public.current_workspace_id();
alter table public.contract_versions alter column workspace_id set not null;
create index if not exists contract_versions_workspace_idx on public.contract_versions(workspace_id,contract_id,version desc);

insert into public.performance_contributions(workspace_id,payment_id,contributor_member_id,attribution_type,amount,verified_by,verified_at,created_by)
select p.workspace_id,p.id,m.id,'DIRECT',p.amount,p.verified_by,coalesce(p.paid_at,p.created_at),p.verified_by
from public.payments p
join public.contracts c on c.id=p.contract_id
join public.sales_team_members m on m.workspace_id=p.workspace_id and m.auth_user_id=c.owner_id and m.active
where p.status='CONFIRMED'
on conflict(payment_id,contributor_member_id) do nothing;

create or replace function public.submit_performance_plan(plan_id uuid, business_reason text)
returns public.approval_requests language plpgsql security definer set search_path=public
as $$
declare target public.performance_targets; request public.approval_requests; allocated numeric;
begin
  select * into target from public.performance_targets where id=plan_id and workspace_id=public.current_workspace_id() for update;
  if not found or target.status<>'DRAFT' then raise exception 'performance_plan_not_draft'; end if;
  if target.manager_id<>auth.uid() and public.current_crm_role() not in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR') then raise exception 'performance_not_authorized'; end if;
  select coalesce(sum(allocated_amount),0) into allocated from public.performance_allocations where target_id=plan_id;
  if allocated<>target.target_amount then raise exception 'performance_target_not_fully_allocated'; end if;
  update public.performance_targets set status='PENDING_APPROVAL',updated_at=now() where id=plan_id;
  request:=public.create_approval('PERFORMANCE_ALLOCATION','PERFORMANCE_TARGET',plan_id::text,business_reason);
  return request;
end; $$;

create or replace function public.capture_contract_version()
returns trigger language plpgsql security definer set search_path=public
as $$
declare next_version integer;
begin
  if tg_op='INSERT' or (to_jsonb(new)-'updated_at') is distinct from (to_jsonb(old)-'updated_at') then
    select coalesce(max(version),0)+1 into next_version from public.contract_versions where contract_id=new.id;
    insert into public.contract_versions(workspace_id,contract_id,version,snapshot,change_note,created_by)
    values(new.workspace_id,new.id,next_version,to_jsonb(new)-'created_by',case when tg_op='INSERT' then 'CONTRACT_CREATED' else 'CONTRACT_UPDATED' end,coalesce(auth.uid(),new.created_by));
  end if;
  return new;
end; $$;
drop trigger if exists contracts_capture_version on public.contracts;
create trigger contracts_capture_version after insert or update on public.contracts for each row execute procedure public.capture_contract_version();

insert into public.contract_versions(workspace_id,contract_id,version,snapshot,change_note,created_by)
select c.workspace_id,c.id,1,to_jsonb(c)-'created_by','MIGRATION_BASELINE',c.created_by from public.contracts c
where not exists(select 1 from public.contract_versions v where v.contract_id=c.id);

create or replace function public.set_product_price(target_product uuid, price_currency text, price_amount numeric, effective_on date)
returns public.product_prices language plpgsql security definer set search_path=public
as $$
declare product public.products; result public.product_prices; current_price public.product_prices;
begin
  if public.current_crm_role() not in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR') then raise exception 'product_price_not_authorized'; end if;
  if price_currency!~'^[A-Z]{3}$' or price_amount<0 or effective_on<current_date then raise exception 'product_price_invalid'; end if;
  select * into product from public.products where id=target_product and workspace_id=public.current_workspace_id();
  if not found then raise exception 'product_not_found'; end if;
  select * into current_price from public.product_prices where product_id=target_product and currency=price_currency and effective_to is null for update;
  if found then
    if current_price.effective_from=effective_on then update public.product_prices set amount=price_amount where id=current_price.id returning * into result; return result; end if;
    update public.product_prices set effective_to=effective_on-1 where id=current_price.id;
  end if;
  insert into public.product_prices(product_id,currency,amount,effective_from,created_by) values(target_product,price_currency,price_amount,effective_on,auth.uid()) returning * into result;
  return result;
end; $$;

revoke all on function public.set_product_price(uuid,text,numeric,date) from public;
grant execute on function public.set_product_price(uuid,text,numeric,date) to authenticated;
