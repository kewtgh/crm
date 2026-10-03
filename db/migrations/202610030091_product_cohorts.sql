-- Forward-only Product → Cohort foundation. No inferred historical backfill.
set search_path=public,app_auth,extensions;

create table public.product_cohorts(
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default public.current_workspace_id() references public.workspaces(id),
  product_id uuid not null,
  code citext not null check(code::text ~ '^[A-Za-z0-9-]{2,40}$'),
  name_zh text not null check(length(trim(name_zh)) between 1 and 120),
  name_en text not null check(length(trim(name_en)) between 1 and 120),
  intake_type text not null default 'CUSTOM' check(intake_type in ('SPRING','SUMMER','FALL','WINTER','CUSTOM')),
  academic_year text not null default '' check(length(academic_year)<=40),
  application_open_on date, application_deadline date, start_on date, end_on date,
  target_enrollment integer check(target_enrollment>=0), capacity integer check(capacity>=0),
  status text not null default 'DRAFT' check(status in ('DRAFT','RECRUITING','CLOSED','ACTIVE','COMPLETED','CANCELLED')),
  default_currency text not null default 'CNY' check(default_currency ~ '^[A-Z]{3}$'),
  owner_id uuid,
  revision integer not null default 1 check(revision>0),
  created_by uuid references app_auth.accounts(id),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique(workspace_id,code), unique(workspace_id,id),
  foreign key(workspace_id,product_id) references public.products(workspace_id,id),
  foreign key(workspace_id,owner_id) references public.workspace_memberships(workspace_id,user_id),
  constraint product_cohorts_dates_check check(
    (application_open_on is null or application_deadline is null or application_open_on<=application_deadline)
    and (application_open_on is null or start_on is null or application_open_on<=start_on)
    and (application_open_on is null or end_on is null or application_open_on<=end_on)
    and (application_deadline is null or start_on is null or application_deadline<=start_on)
    and (application_deadline is null or end_on is null or application_deadline<=end_on)
    and (start_on is null or end_on is null or start_on<=end_on)),
  constraint product_cohorts_target_capacity_check check(target_enrollment is null or capacity is null or target_enrollment<=capacity)
);
-- products_workspace_id_uidx (migration 025) already supplies the parent identity.
create index product_cohorts_product_start_idx on public.product_cohorts(workspace_id,product_id,start_on,id);
create index product_cohorts_product_status_idx on public.product_cohorts(workspace_id,product_id,status);

alter table public.product_cohorts enable row level security;
create policy "members read product cohorts" on public.product_cohorts for select to crm_app
  using(workspace_id=public.current_workspace_id() and public.is_workspace_member(workspace_id));
-- No DML policy: application writes must use the audited, revision-checked RPC.
revoke all on public.product_cohorts from public,crm_app;
grant select on public.product_cohorts to crm_app;

create function public.guard_product_cohort_parent() returns trigger
language plpgsql set search_path=public,app_auth,extensions as $$
begin
  if new.product_id is distinct from old.product_id or new.workspace_id is distinct from old.workspace_id
    or new.id is distinct from old.id then raise exception 'cohort_parent_immutable'; end if;
  return new;
end $$;
revoke all on function public.guard_product_cohort_parent() from public;
create trigger product_cohorts_immutable_parent before update on public.product_cohorts
  for each row execute function public.guard_product_cohort_parent();

create function public.save_product_cohort(record_id uuid,expected_revision integer,data jsonb,p_request_key text)
returns public.product_cohorts language plpgsql security definer set search_path=public,app_auth,extensions as $$
declare
  ws uuid:=public.current_workspace_id(); actor uuid:=app_auth.current_user_id();
  previous public.product_cohorts; result public.product_cohorts; candidate public.product_cohorts;
  receipt public.mutation_receipts; request_data jsonb;
  fields text[]:=array['product_id','code','name_zh','name_en','intake_type','academic_year',
    'application_open_on','application_deadline','start_on','end_on','target_enrollment','capacity','status','default_currency','owner_id'];
begin
  if actor is null or ws is null or not public.is_workspace_member(ws)
    or public.current_crm_role() not in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR')
    or coalesce(app_auth.current_claims()->>'aal','aal1')<>'aal2' then raise exception 'cohort_update_forbidden'; end if;
  if record_id is null or p_request_key is null or length(p_request_key) not between 8 and 160
    or expected_revision<=0 or jsonb_typeof(data) is distinct from 'object'
    or not data ?& fields or exists(select 1 from jsonb_object_keys(data) k where not k=any(fields))
    then raise exception 'cohort_input_invalid'; end if;
  request_data:=jsonb_build_object('actor',actor,'id',record_id,'revision',expected_revision,'data',data);
  perform pg_advisory_xact_lock(hashtextextended(ws::text||':'||p_request_key,0));
  select * into receipt from public.mutation_receipts where workspace_id=ws and request_key=p_request_key;
  if found then
    if receipt.operation<>'PRODUCT_COHORT_SAVE' or receipt.result->'request' is distinct from request_data
      then raise exception 'cohort_request_conflict'; end if;
    return jsonb_populate_record(null::public.product_cohorts,receipt.result->'item');
  end if;
  candidate:=jsonb_populate_record(null::public.product_cohorts,data);
  if candidate.owner_id is not null and not exists(select 1 from public.workspace_memberships
    where workspace_id=ws and user_id=candidate.owner_id and status='ACTIVE') then raise exception 'cohort_owner_invalid'; end if;
  -- Serialize creation/update for a stable client-generated ID, independently of request keys.
  perform pg_advisory_xact_lock(hashtextextended('product-cohort:'||record_id::text,0));
  select * into previous from public.product_cohorts where id=record_id and workspace_id=ws for update;
  if found then
    if candidate.product_id is distinct from previous.product_id then raise exception 'cohort_parent_immutable'; end if;
    if expected_revision is null or expected_revision<>previous.revision then raise exception 'cohort_version_conflict'; end if;
    update public.product_cohorts set code=upper(trim(candidate.code::text)),name_zh=trim(candidate.name_zh),name_en=trim(candidate.name_en),
      intake_type=candidate.intake_type,academic_year=trim(candidate.academic_year),application_open_on=candidate.application_open_on,
      application_deadline=candidate.application_deadline,start_on=candidate.start_on,end_on=candidate.end_on,
      target_enrollment=candidate.target_enrollment,capacity=candidate.capacity,status=candidate.status,
      default_currency=candidate.default_currency,owner_id=candidate.owner_id,revision=previous.revision+1,updated_at=clock_timestamp()
      where id=record_id and workspace_id=ws returning * into result;
  else
    if expected_revision is not null then raise exception 'cohort_not_found'; end if;
    perform 1 from public.products where id=candidate.product_id and workspace_id=ws and archived_at is null for share;
    if not found then raise exception 'cohort_product_not_found'; end if;
    insert into public.product_cohorts(id,workspace_id,product_id,code,name_zh,name_en,intake_type,academic_year,
      application_open_on,application_deadline,start_on,end_on,target_enrollment,capacity,status,default_currency,owner_id,created_by)
    values(record_id,ws,candidate.product_id,upper(trim(candidate.code::text)),trim(candidate.name_zh),trim(candidate.name_en),
      candidate.intake_type,trim(candidate.academic_year),candidate.application_open_on,candidate.application_deadline,candidate.start_on,
      candidate.end_on,candidate.target_enrollment,candidate.capacity,candidate.status,candidate.default_currency,candidate.owner_id,actor)
    returning * into result;
  end if;
  insert into public.audit_events(workspace_id,actor_id,action,entity_type,entity_id,before_data,after_data)
    values(ws,actor,case when previous.id is null then 'PRODUCT_COHORT_CREATED' else 'PRODUCT_COHORT_UPDATED' end,
      'PRODUCT_COHORT',result.id,to_jsonb(previous),to_jsonb(result));
  insert into public.mutation_receipts(workspace_id,request_key,operation,result,created_by)
    values(ws,p_request_key,'PRODUCT_COHORT_SAVE',jsonb_build_object('request',request_data,'item',to_jsonb(result)),actor);
  return result;
end $$;
revoke all on function public.save_product_cohort(uuid,integer,jsonb,text) from public;
grant execute on function public.save_product_cohort(uuid,integer,jsonb,text) to crm_app;
