create extension if not exists pgcrypto;

create or replace function public.crm_role()
returns text language sql stable
as $$ select upper(coalesce(auth.jwt()->'app_metadata'->>'role', '')); $$;

create table if not exists public.approval_requests (
  id uuid primary key default gen_random_uuid(),
  request_number text not null unique,
  request_type text not null check (request_type in ('CONTRACT_SIGN', 'CONTRACT_EXPORT', 'PERFORMANCE_SUMMARY', 'PERFORMANCE_ALLOCATION')),
  business_object_type text not null,
  business_object_id text not null,
  requester_id uuid not null references auth.users(id),
  required_role text not null default 'ADMIN' check (required_role in ('ADMIN', 'SUPER_ADMIN')),
  status text not null default 'PENDING' check (status in ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED')),
  reason text not null,
  decision_reason text,
  decided_by uuid references auth.users(id),
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint approval_no_self_decision check (decided_by is null or decided_by <> requester_id),
  constraint approval_decision_complete check (
    (status = 'PENDING' and decided_by is null and decided_at is null)
    or (status in ('APPROVED', 'REJECTED') and decided_by is not null and decided_at is not null)
    or status = 'CANCELLED'
  )
);
create index if not exists approval_requests_queue_idx on public.approval_requests(status, required_role, created_at desc);
create index if not exists approval_requests_object_idx on public.approval_requests(business_object_type, business_object_id);

create or replace function public.set_approval_required_role()
returns trigger language plpgsql set search_path = public
as $$ begin
  new.required_role := case when new.request_type = 'CONTRACT_EXPORT' then 'SUPER_ADMIN' else 'ADMIN' end;
  return new;
end; $$;
drop trigger if exists derive_approval_required_role on public.approval_requests;
create trigger derive_approval_required_role before insert on public.approval_requests for each row execute procedure public.set_approval_required_role();

create table if not exists public.approval_actions (
  id bigint generated always as identity primary key,
  approval_request_id uuid not null references public.approval_requests(id) on delete cascade,
  actor_id uuid not null references auth.users(id),
  action text not null check (action in ('SUBMITTED', 'APPROVED', 'REJECTED', 'CANCELLED', 'COMMENTED')),
  comment text,
  created_at timestamptz not null default now()
);
create index if not exists approval_actions_request_idx on public.approval_actions(approval_request_id, created_at);

create table if not exists public.performance_targets (
  id uuid primary key default gen_random_uuid(),
  manager_id uuid not null references auth.users(id),
  period_start date not null,
  period_end date not null,
  currency text not null default 'CNY' check (currency ~ '^[A-Z]{3}$'),
  target_amount numeric(14,2) not null check (target_amount > 0),
  status text not null default 'DRAFT' check (status in ('DRAFT', 'PENDING_APPROVAL', 'ACTIVE', 'CLOSED')),
  version integer not null default 1 check (version > 0),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint performance_target_period check (period_end >= period_start),
  unique(manager_id, period_start, period_end, version)
);

create table if not exists public.performance_allocations (
  id uuid primary key default gen_random_uuid(),
  target_id uuid not null references public.performance_targets(id) on delete cascade,
  contributor_id uuid not null references auth.users(id),
  contributor_role text not null check (contributor_role in ('SALES_SPECIALIST', 'SALES_SUPPORT')),
  attribution_type text not null check (attribution_type in ('DIRECT', 'ASSISTED')),
  allocated_amount numeric(14,2) not null check (allocated_amount > 0),
  verified_amount numeric(14,2) not null default 0 check (verified_amount >= 0),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(target_id, contributor_id)
);

create or replace function public.check_performance_allocation_total()
returns trigger language plpgsql set search_path = public
as $$
declare allowed numeric(14,2); allocated numeric(14,2);
begin
  select target_amount into allowed from public.performance_targets where id = new.target_id for update;
  select coalesce(sum(allocated_amount), 0) into allocated from public.performance_allocations where target_id = new.target_id and id <> new.id;
  if allocated + new.allocated_amount > allowed then raise exception 'allocation_total_exceeds_target'; end if;
  return new;
end; $$;
drop trigger if exists enforce_performance_allocation_total on public.performance_allocations;
create trigger enforce_performance_allocation_total before insert or update on public.performance_allocations for each row execute procedure public.check_performance_allocation_total();

alter table public.approval_requests enable row level security;
alter table public.approval_actions enable row level security;
alter table public.performance_targets enable row level security;
alter table public.performance_allocations enable row level security;

create policy "approval participants can read" on public.approval_requests for select to authenticated
  using (requester_id = auth.uid() or public.crm_role() in ('ADMIN', 'SUPER_ADMIN'));
create policy "authenticated users submit approvals" on public.approval_requests for insert to authenticated
  with check (requester_id = auth.uid() and status = 'PENDING' and decided_by is null);
create policy "approval participants read audit" on public.approval_actions for select to authenticated
  using (exists (select 1 from public.approval_requests r where r.id = approval_request_id and (r.requester_id = auth.uid() or public.crm_role() in ('ADMIN', 'SUPER_ADMIN'))));
create policy "participants append permitted audit" on public.approval_actions for insert to authenticated
  with check (actor_id = auth.uid() and exists (
    select 1 from public.approval_requests r where r.id = approval_request_id and (
      (r.requester_id = auth.uid() and action in ('SUBMITTED', 'CANCELLED', 'COMMENTED'))
      or (r.requester_id <> auth.uid() and public.crm_role() in ('ADMIN', 'SUPER_ADMIN') and action = 'COMMENTED')
    )
  ));

create or replace function public.decide_approval(request_id uuid, decision text, decision_comment text default null)
returns public.approval_requests language plpgsql security definer set search_path = public
as $$
declare request public.approval_requests; actor_role text := public.crm_role();
begin
  if auth.uid() is null or actor_role not in ('ADMIN', 'SUPER_ADMIN') then raise exception 'approval_not_authorized'; end if;
  if decision not in ('APPROVED', 'REJECTED') then raise exception 'approval_invalid_decision'; end if;
  if decision = 'REJECTED' and nullif(trim(decision_comment), '') is null then raise exception 'approval_rejection_reason_required'; end if;
  select * into request from public.approval_requests where id = request_id for update;
  if not found or request.status <> 'PENDING' then raise exception 'approval_not_pending'; end if;
  if request.requester_id = auth.uid() then raise exception 'approval_self_decision_forbidden'; end if;
  if request.required_role = 'SUPER_ADMIN' and actor_role <> 'SUPER_ADMIN' then raise exception 'approval_super_admin_required'; end if;
  update public.approval_requests set status = decision, decision_reason = nullif(trim(decision_comment), ''), decided_by = auth.uid(), decided_at = now(), updated_at = now() where id = request_id returning * into request;
  insert into public.approval_actions(approval_request_id, actor_id, action, comment) values (request_id, auth.uid(), decision, nullif(trim(decision_comment), ''));
  return request;
end; $$;
revoke all on function public.decide_approval(uuid, text, text) from public;
grant execute on function public.decide_approval(uuid, text, text) to authenticated;

create policy "sales hierarchy reads targets" on public.performance_targets for select to authenticated
  using (manager_id = auth.uid() or public.crm_role() in ('SUPER_ADMIN', 'ADMIN', 'SALES_DIRECTOR'));
create policy "managers create targets" on public.performance_targets for insert to authenticated
  with check (created_by = auth.uid() and public.crm_role() in ('SUPER_ADMIN', 'ADMIN', 'SALES_DIRECTOR', 'SALES_MANAGER'));
create policy "target owners update drafts" on public.performance_targets for update to authenticated
  using ((manager_id = auth.uid() and status in ('DRAFT', 'PENDING_APPROVAL')) or public.crm_role() in ('SUPER_ADMIN', 'ADMIN', 'SALES_DIRECTOR'));
create policy "allocation participants read" on public.performance_allocations for select to authenticated
  using (contributor_id = auth.uid() or exists (select 1 from public.performance_targets t where t.id = target_id and t.manager_id = auth.uid()) or public.crm_role() in ('SUPER_ADMIN', 'ADMIN', 'SALES_DIRECTOR'));
create policy "target owners manage allocations" on public.performance_allocations for all to authenticated
  using (exists (select 1 from public.performance_targets t where t.id = target_id and (t.manager_id = auth.uid() or public.crm_role() in ('SUPER_ADMIN', 'ADMIN', 'SALES_DIRECTOR'))))
  with check (created_by = auth.uid() and exists (select 1 from public.performance_targets t where t.id = target_id and (t.manager_id = auth.uid() or public.crm_role() in ('SUPER_ADMIN', 'ADMIN', 'SALES_DIRECTOR'))));

grant select, insert on public.approval_requests to authenticated;
grant select, insert on public.approval_actions to authenticated;
grant select, insert, update on public.performance_targets to authenticated;
grant select, insert, update, delete on public.performance_allocations to authenticated;
grant usage, select on sequence public.approval_actions_id_seq to authenticated;
