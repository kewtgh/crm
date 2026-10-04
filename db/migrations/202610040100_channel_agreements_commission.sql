set search_path=public,app_auth,extensions;

alter table public.enrollment_attributions add constraint enrollment_attributions_workspace_identity unique(workspace_id,id);

create table public.channel_agreements(
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id),organization_id uuid not null,
 agreement_code text not null check(length(trim(agreement_code)) between 1 and 80),name_zh text not null default '',name_en text not null default '',
 created_by uuid not null references app_auth.accounts(id),created_at timestamptz not null default clock_timestamp(),
 unique(workspace_id,id),unique(workspace_id,agreement_code),foreign key(workspace_id,organization_id) references public.organizations(workspace_id,id),
 check(length(name_zh)<=160 and length(name_en)<=160 and length(trim(name_zh||name_en))>0)
);
create table public.channel_agreement_versions(
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id),agreement_id uuid not null,
 version integer not null check(version>0),status text not null default 'DRAFT' check(status in ('DRAFT','ACTIVE','SUPERSEDED','TERMINATED','EXPIRED')),
 effective_from date not null,effective_to date,signed_on date,reference_number text,notes text not null default '' check(length(notes)<=4000),
 revision integer not null default 1 check(revision>0),created_by uuid not null references app_auth.accounts(id),created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),
 unique(workspace_id,id),unique(workspace_id,agreement_id,version),foreign key(workspace_id,agreement_id) references public.channel_agreements(workspace_id,id),
 check(effective_to is null or effective_to>=effective_from)
);
create table public.channel_commission_rules(
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id),agreement_version_id uuid not null,
 scope_type text not null check(scope_type in ('ALL_PRODUCTS','PRODUCT','COHORT')),product_id uuid,cohort_id uuid,
 attribution_type text not null check(attribution_type in ('PRIMARY','ASSIST')),basis_type text not null check(basis_type in ('FIXED_PER_ENROLLMENT','PERCENT_OF_NET_COLLECTED')),
 fixed_amount numeric(14,2),fixed_currency text check(fixed_currency~'^[A-Z]{3}$'),rate_bps integer,earning_event text check(earning_event in ('ENROLLMENT_ACTIVE','ENROLLMENT_COMPLETED')),
 unique(workspace_id,id),foreign key(workspace_id,agreement_version_id) references public.channel_agreement_versions(workspace_id,id),
 foreign key(workspace_id,product_id) references public.products(workspace_id,id),foreign key(workspace_id,product_id,cohort_id) references public.product_cohorts(workspace_id,product_id,id),
 check((scope_type='ALL_PRODUCTS' and product_id is null and cohort_id is null) or (scope_type='PRODUCT' and product_id is not null and cohort_id is null) or (scope_type='COHORT' and product_id is not null and cohort_id is not null)),
 check((basis_type='FIXED_PER_ENROLLMENT' and fixed_amount is not null and fixed_amount>0 and fixed_currency is not null and rate_bps is null and earning_event is not null) or
 (basis_type='PERCENT_OF_NET_COLLECTED' and rate_bps is not null and rate_bps between 1 and 10000 and fixed_amount is null and fixed_currency is null and earning_event is null))
);
create table public.commission_accruals(
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id),organization_id uuid not null,agreement_version_id uuid not null,rule_id uuid not null,
 attribution_id uuid,enrollment_id uuid,contract_id uuid,source_type text not null check(source_type in ('ENROLLMENT_ACTIVE','ENROLLMENT_COMPLETED','PAYMENT','REFUND')),source_id uuid,source_key text not null,
 currency text not null check(currency~'^[A-Z]{3}$'),basis_amount numeric(14,2) not null,rate_bps integer check(rate_bps between 1 and 10000),commission_amount numeric(14,2) not null,
 entry_type text not null check(entry_type in ('EARNED','REVERSAL')),accrued_at timestamptz not null,reverses_accrual_id uuid,created_by uuid references app_auth.accounts(id),created_at timestamptz not null default clock_timestamp(),
 unique(workspace_id,id),unique(workspace_id,source_key),
 foreign key(workspace_id,organization_id) references public.organizations(workspace_id,id),foreign key(workspace_id,agreement_version_id) references public.channel_agreement_versions(workspace_id,id),
 foreign key(workspace_id,rule_id) references public.channel_commission_rules(workspace_id,id),foreign key(workspace_id,contract_id) references public.contracts(workspace_id,id),
 foreign key(workspace_id,enrollment_id) references public.student_enrollments(workspace_id,id) on delete set null(enrollment_id),
 foreign key(workspace_id,attribution_id) references public.enrollment_attributions(workspace_id,id) on delete set null(attribution_id),
 foreign key(workspace_id,reverses_accrual_id) references public.commission_accruals(workspace_id,id),
 check((entry_type='EARNED' and basis_amount>=0 and commission_amount>=0 and reverses_accrual_id is null) or (entry_type='REVERSAL' and basis_amount<=0 and commission_amount<=0 and reverses_accrual_id is not null))
);
create index commission_accrual_org_idx on public.commission_accruals(workspace_id,organization_id,accrued_at desc);
create index commission_accrual_payment_idx on public.commission_accruals(workspace_id,source_type,source_id);
create table public.commission_settlements(
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id),organization_id uuid not null,currency text not null check(currency~'^[A-Z]{3}$'),
 period_start date,period_end date,status text not null default 'DRAFT' check(status in ('DRAFT','APPROVED','PAID','CANCELLED')),
 reference_number text,notes text not null default '' check(length(notes)<=4000),approved_at timestamptz,approved_by uuid references app_auth.accounts(id),paid_at timestamptz,paid_by uuid references app_auth.accounts(id),payment_reference text,cancel_reason text,
 revision integer not null default 1 check(revision>0),created_by uuid not null references app_auth.accounts(id),created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),
 unique(workspace_id,id),foreign key(workspace_id,organization_id) references public.organizations(workspace_id,id),check(period_end is null or period_start is null or period_end>=period_start),
 check(status not in ('APPROVED','PAID') or (approved_at is not null and approved_by is not null)),check(status<>'PAID' or (paid_at is not null and paid_by is not null and payment_reference is not null and length(trim(payment_reference))>0)),check(status<>'CANCELLED' or (cancel_reason is not null and length(trim(cancel_reason))>0))
);
create table public.commission_settlement_lines(
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id),settlement_id uuid not null,accrual_id uuid not null,reserved boolean not null default true,
 unique(workspace_id,id),unique(workspace_id,settlement_id,accrual_id),foreign key(workspace_id,settlement_id) references public.commission_settlements(workspace_id,id),foreign key(workspace_id,accrual_id) references public.commission_accruals(workspace_id,id)
);
create unique index commission_line_reserved_uidx on public.commission_settlement_lines(workspace_id,accrual_id) where reserved;

create function public.channel_commercial_access(org uuid,edit boolean default false) returns boolean language sql stable security definer set search_path=public,app_auth as $$
 select coalesce(app_auth.current_user_id() is not null and public.is_workspace_member(public.current_workspace_id()) and
 public.current_crm_role()=any(case when edit then array['SUPER_ADMIN','ADMIN','SALES_DIRECTOR'] else array['SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER'] end) and public.customer_subject_access('ORGANIZATION',org,false),false)
$$;
revoke all on function public.channel_commercial_access(uuid,boolean) from public;grant execute on function public.channel_commercial_access(uuid,boolean) to crm_app;
alter table public.channel_agreements enable row level security;alter table public.channel_agreement_versions enable row level security;alter table public.channel_commission_rules enable row level security;
alter table public.commission_accruals enable row level security;alter table public.commission_settlements enable row level security;alter table public.commission_settlement_lines enable row level security;
create policy channel_agreement_read on public.channel_agreements for select to crm_app using(workspace_id=public.current_workspace_id() and public.customer_subject_access('ORGANIZATION',organization_id,false));
create policy channel_version_read on public.channel_agreement_versions for select to crm_app using(exists(select 1 from public.channel_agreements a where a.id=agreement_id and a.workspace_id=channel_agreement_versions.workspace_id and public.channel_commercial_access(a.organization_id,false)));
create policy channel_rule_read on public.channel_commission_rules for select to crm_app using(exists(select 1 from public.channel_agreement_versions v where v.id=agreement_version_id and v.workspace_id=channel_commission_rules.workspace_id));
create policy commission_accrual_read on public.commission_accruals for select to crm_app using(workspace_id=public.current_workspace_id() and public.channel_commercial_access(organization_id,false));
create policy commission_settlement_read on public.commission_settlements for select to crm_app using(workspace_id=public.current_workspace_id() and public.channel_commercial_access(organization_id,false));
create policy commission_line_read on public.commission_settlement_lines for select to crm_app using(exists(select 1 from public.commission_settlements s where s.id=settlement_id and s.workspace_id=commission_settlement_lines.workspace_id));
grant select on public.channel_agreements,public.channel_agreement_versions,public.channel_commission_rules,public.commission_accruals,public.commission_settlements,public.commission_settlement_lines to crm_app;

create function public.lock_commission_workspace(ws uuid) returns void language sql security definer set search_path=public,extensions as $$select pg_advisory_xact_lock(hashtextextended('commission:'||ws::text,0))$$;
create function public.commission_receipt(key text,op text,payload jsonb) returns jsonb language plpgsql security definer set search_path=public,app_auth,extensions as $$
declare r public.mutation_receipts;begin
 if length(coalesce(key,'')) not between 8 and 120 then raise exception 'commission_input_invalid';end if;
 perform pg_advisory_xact_lock(hashtextextended('commission-request:'||public.current_workspace_id()::text||key,0));
 select * into r from public.mutation_receipts where workspace_id=public.current_workspace_id() and request_key=key;
 if found then if r.operation is distinct from op or r.created_by is distinct from app_auth.current_user_id() or r.result->>'request_hash' is distinct from encode(digest(payload::text,'sha256'),'hex') then raise exception 'commission_request_conflict';end if;return r.result->'item';end if;return null;
end $$;
create function public.commission_finish(key text,op text,payload jsonb,item jsonb) returns jsonb language plpgsql security definer set search_path=public,app_auth,extensions as $$begin
 insert into public.mutation_receipts(workspace_id,request_key,operation,result,created_by) values(public.current_workspace_id(),key,op,jsonb_build_object('request_hash',encode(digest(payload::text,'sha256'),'hex'),'item',item),app_auth.current_user_id());return item;
end $$;
revoke all on function public.lock_commission_workspace(uuid),public.commission_receipt(text,text,jsonb),public.commission_finish(text,text,jsonb,jsonb) from public,crm_app,crm_system;

create function public.save_channel_agreement(target_agreement uuid,target_version uuid,expected_revision integer,data jsonb,p_request_key text) returns jsonb
language plpgsql security definer set search_path=public,app_auth,extensions as $$
declare ws uuid:=public.current_workspace_id();a public.channel_agreements;v public.channel_agreement_versions;r jsonb;result jsonb;payload jsonb;
begin
 if target_agreement is null or target_version is null or jsonb_typeof(data) is distinct from 'object' or
 exists(select 1 from jsonb_object_keys(data) k where k not in ('organization_id','agreement_code','name_zh','name_en','effective_from','effective_to','signed_on','reference_number','notes','rules')) then raise exception 'commission_input_invalid';end if;
 if not public.channel_commercial_access((data->>'organization_id')::uuid,true) then raise exception 'commission_forbidden';end if;
 perform public.lock_commission_workspace(ws);payload:=jsonb_build_object('agreement',target_agreement,'version',target_version,'revision',expected_revision,'data',data);
 result:=public.commission_receipt(p_request_key,'CHANNEL_AGREEMENT_SAVE',payload);if result is not null then return result;end if;
 select * into a from public.channel_agreements where workspace_id=ws and id=target_agreement;
 if not found then
 if expected_revision is not null then raise exception 'commission_not_found';end if;
 insert into public.channel_agreements(id,workspace_id,organization_id,agreement_code,name_zh,name_en,created_by)
 values(target_agreement,ws,(data->>'organization_id')::uuid,data->>'agreement_code',coalesce(data->>'name_zh',''),coalesce(data->>'name_en',''),app_auth.current_user_id()) returning * into a;
 else if a.organization_id<>(data->>'organization_id')::uuid or a.agreement_code<>data->>'agreement_code' or a.name_zh<>coalesce(data->>'name_zh','') or a.name_en<>coalesce(data->>'name_en','') then raise exception 'agreement_identity_immutable';end if;end if;
 select * into v from public.channel_agreement_versions where workspace_id=ws and id=target_version for update;
 if found then
 if v.agreement_id<>a.id then raise exception 'agreement_identity_immutable';end if;
 if expected_revision is null or expected_revision<>v.revision then raise exception 'commission_version_conflict';end if;
 if v.status<>'DRAFT' then raise exception 'agreement_version_immutable';end if;
 update public.channel_agreement_versions set effective_from=(data->>'effective_from')::date,effective_to=nullif(data->>'effective_to','')::date,signed_on=nullif(data->>'signed_on','')::date,
 reference_number=nullif(data->>'reference_number',''),notes=coalesce(data->>'notes',''),revision=revision+1,updated_at=clock_timestamp() where id=v.id returning * into v;
 delete from public.channel_commission_rules where workspace_id=ws and agreement_version_id=v.id;
 else
 if expected_revision is not null then raise exception 'commission_not_found';end if;
 insert into public.channel_agreement_versions(id,workspace_id,agreement_id,version,effective_from,effective_to,signed_on,reference_number,notes,created_by)
 values(target_version,ws,a.id,coalesce((select max(version)+1 from public.channel_agreement_versions where agreement_id=a.id),1),(data->>'effective_from')::date,nullif(data->>'effective_to','')::date,
 nullif(data->>'signed_on','')::date,nullif(data->>'reference_number',''),coalesce(data->>'notes',''),app_auth.current_user_id()) returning * into v;
 end if;
 if jsonb_typeof(data->'rules') is distinct from 'array' or jsonb_array_length(data->'rules')>50 then raise exception 'commission_input_invalid';end if;
 for r in select value from jsonb_array_elements(data->'rules') loop
 if exists(select 1 from jsonb_object_keys(r) k where k not in ('scope_type','product_id','cohort_id','attribution_type','basis_type','fixed_amount','fixed_currency','rate_bps','earning_event')) or
 (r->>'fixed_amount' is not null and scale((r->>'fixed_amount')::numeric)>2) then raise exception 'commission_input_invalid';end if;
 if r->>'product_id' is not null and not exists(select 1 from public.products p where p.workspace_id=ws and p.id=(r->>'product_id')::uuid) then raise exception 'commission_forbidden';end if;
 insert into public.channel_commission_rules(workspace_id,agreement_version_id,scope_type,product_id,cohort_id,attribution_type,basis_type,fixed_amount,fixed_currency,rate_bps,earning_event)
 values(ws,v.id,r->>'scope_type',nullif(r->>'product_id','')::uuid,nullif(r->>'cohort_id','')::uuid,r->>'attribution_type',r->>'basis_type',nullif(r->>'fixed_amount','')::numeric,nullif(r->>'fixed_currency',''),nullif(r->>'rate_bps','')::integer,nullif(r->>'earning_event',''));
 end loop;
 if exists(select 1 from public.channel_commission_rules r1 join public.channel_commission_rules r2 on r2.agreement_version_id=r1.agreement_version_id and r1.id<r2.id
 where r1.agreement_version_id=v.id and r1.attribution_type=r2.attribution_type and r1.basis_type=r2.basis_type and r1.earning_event is not distinct from r2.earning_event
 and (r1.scope_type='ALL_PRODUCTS' or r2.scope_type='ALL_PRODUCTS' or r1.product_id=r2.product_id and (r1.scope_type='PRODUCT' or r2.scope_type='PRODUCT' or r1.cohort_id=r2.cohort_id))) then raise exception 'commission_rule_overlap';end if;
 insert into public.audit_events(workspace_id,actor_id,action,entity_type,entity_id,after_data) values(ws,app_auth.current_user_id(),'CHANNEL_AGREEMENT_SAVED','CHANNEL_AGREEMENT_VERSION',v.id,jsonb_build_object('agreementId',a.id,'version',v.version,'revision',v.revision));
 return public.commission_finish(p_request_key,'CHANNEL_AGREEMENT_SAVE',payload,to_jsonb(v));
end $$;

create function public.change_channel_agreement_status(target_version uuid,expected_revision integer,next_status text,reason text,p_request_key text) returns jsonb
language plpgsql security definer set search_path=public,app_auth,extensions as $$
declare ws uuid:=public.current_workspace_id();v public.channel_agreement_versions;a public.channel_agreements;payload jsonb;result jsonb;
begin
 perform public.lock_commission_workspace(ws);select * into v from public.channel_agreement_versions where workspace_id=ws and id=target_version for update;
 select * into a from public.channel_agreements where id=v.agreement_id and workspace_id=ws;
 if not public.channel_commercial_access(a.organization_id,true) then raise exception 'commission_forbidden';end if;
 payload:=jsonb_build_object('id',target_version,'revision',expected_revision,'status',next_status,'reason',reason);result:=public.commission_receipt(p_request_key,'CHANNEL_AGREEMENT_STATUS',payload);if result is not null then return result;end if;
 if expected_revision is null or expected_revision<>v.revision then raise exception 'commission_version_conflict';end if;
 if next_status is null or not ((v.status='DRAFT' and next_status='ACTIVE') or (v.status='ACTIVE' and next_status in ('SUPERSEDED','TERMINATED','EXPIRED'))) or length(trim(coalesce(reason,''))) not between 1 and 1000 then raise exception 'commission_transition_invalid';end if;
 if next_status='ACTIVE' then
 if not exists(select 1 from public.channel_commission_rules where agreement_version_id=v.id) then raise exception 'commission_rules_required';end if;
 if exists(select 1 from public.channel_agreement_versions other where other.agreement_id=v.agreement_id and other.id<>v.id and other.status in ('ACTIVE','SUPERSEDED') and
 daterange(other.effective_from,other.effective_to,'[]')&&daterange(v.effective_from,v.effective_to,'[]')) then raise exception 'agreement_period_overlap';end if;
 end if;
 update public.channel_agreement_versions set status=next_status,revision=revision+1,updated_at=clock_timestamp() where id=v.id returning * into v;
 insert into public.audit_events(workspace_id,actor_id,action,entity_type,entity_id,after_data) values(ws,app_auth.current_user_id(),'CHANNEL_AGREEMENT_'||next_status,'CHANNEL_AGREEMENT_VERSION',v.id,jsonb_build_object('revision',v.revision,'agreementId',v.agreement_id));
 return public.commission_finish(p_request_key,'CHANNEL_AGREEMENT_STATUS',payload,to_jsonb(v));
end $$;

create function public.get_channel_agreements(target_organization uuid) returns jsonb language plpgsql stable security definer set search_path=public,app_auth as $$
declare ws uuid:=public.current_workspace_id();visible boolean;
begin
 if app_auth.current_user_id() is null or not public.is_workspace_member(ws) or not public.customer_subject_access('ORGANIZATION',target_organization,false) then raise exception 'commission_forbidden';end if;
 visible:=public.channel_commercial_access(target_organization,false);
 return jsonb_build_object('canManage',public.channel_commercial_access(target_organization,true),'canFinance',visible,'items',coalesce((select jsonb_agg(to_jsonb(a)||jsonb_build_object('versions',
 coalesce((select jsonb_agg(jsonb_build_object('id',v.id,'version',v.version,'status',v.status,'effective_from',v.effective_from,'effective_to',v.effective_to,'signed_on',v.signed_on,'reference_number',v.reference_number,'notes',case when visible then v.notes else null end,'revision',v.revision,
 'expiredByDate',v.effective_to<public.current_business_date()::date,'rules',coalesce((select jsonb_agg(to_jsonb(r)||jsonb_build_object('fixed_amount',case when visible then r.fixed_amount::text else null end,'rate_bps',case when visible then r.rate_bps else null end,'financialTermsVisible',visible)) from public.channel_commission_rules r where r.agreement_version_id=v.id),'[]'::jsonb)) order by v.version desc) from public.channel_agreement_versions v where v.agreement_id=a.id),'[]'::jsonb))) from public.channel_agreements a where a.workspace_id=ws and a.organization_id=target_organization),'[]'::jsonb));
end $$;

create function public.commission_candidate(target_rule uuid,target_enrollment uuid,receipt uuid default null) returns jsonb language plpgsql stable security definer set search_path=public,app_auth,extensions as $$
declare ws uuid:=public.current_workspace_id();r public.channel_commission_rules;v public.channel_agreement_versions;a public.channel_agreements;e public.student_enrollments;t public.enrollment_attributions;
 c public.product_cohorts;p public.payments;h public.student_enrollment_status_history;event_at timestamptz;day date;cur text;basis numeric;ledger_basis numeric;status text:='ELIGIBLE';kind text;sid uuid;
begin
 select * into r from public.channel_commission_rules where id=target_rule and workspace_id=ws;
 select * into v from public.channel_agreement_versions where id=r.agreement_version_id and workspace_id=ws;select * into a from public.channel_agreements where id=v.agreement_id and workspace_id=ws;
 select * into e from public.student_enrollments where id=target_enrollment and workspace_id=ws;select * into c from public.product_cohorts where id=e.cohort_id and workspace_id=ws;
 if r.id is null or e.id is null then return jsonb_build_object('eligibilityStatus','ATTRIBUTION_NOT_ELIGIBLE');end if;
 select * into t from public.enrollment_attributions where workspace_id=ws and enrollment_id=e.id and source_organization_id=a.organization_id and attribution_type=r.attribution_type order by created_at,id limit 1;
 if t.id is null then status:='ATTRIBUTION_NOT_ELIGIBLE';
 elsif r.scope_type='PRODUCT' and r.product_id<>c.product_id or r.scope_type='COHORT' and r.cohort_id<>c.id then status:='PRODUCT_NOT_ELIGIBLE';end if;
 if r.basis_type='FIXED_PER_ENROLLMENT' then
 kind:=r.earning_event;select * into h from public.student_enrollment_status_history where workspace_id=ws and enrollment_id=e.id and to_status=case r.earning_event when 'ENROLLMENT_ACTIVE' then 'ACTIVE' else 'COMPLETED' end order by changed_at,id limit 1;
 event_at:=h.changed_at;sid:=e.id;basis:=r.fixed_amount;ledger_basis:=r.fixed_amount;cur:=r.fixed_currency;if h.id is null and status='ELIGIBLE' then status:='EVENT_NOT_REACHED';end if;
 else
 kind:='PAYMENT';select * into p from public.payments where id=receipt and workspace_id=ws;sid:=p.id;cur:=p.currency;event_at:=p.paid_at;basis:=p.amount-p.refunded_amount;ledger_basis:=p.amount;
 if p.id is null or p.status not in ('CONFIRMED','REFUNDED') or event_at is null then if status='ELIGIBLE' then status:='NO_FINANCIAL_BASE';end if;
 elsif not exists(select 1 from public.contract_enrollment_links l where l.workspace_id=ws and l.contract_id=p.contract_id and l.enrollment_id=e.id and l.status='ACTIVE') then status:='NO_FINANCIAL_BASE';
 elsif (select count(*) from public.contract_enrollment_links links where links.workspace_id=ws and links.contract_id=p.contract_id and links.status='ACTIVE')<>1 then status:='SHARED_CONTRACT_UNALLOCATED';end if;
 end if;
 select (event_at at time zone business_timezone)::date into day from public.workspaces where id=ws;
 if status='ELIGIBLE' and (v.status not in ('ACTIVE','SUPERSEDED') or day<v.effective_from or day>v.effective_to) then status:='NOT_EFFECTIVE';end if;
 return jsonb_build_object('organizationId',a.organization_id,'agreementId',a.id,'agreementVersionId',v.id,'ruleId',r.id,'enrollmentId',e.id,'attributionId',t.id,'attributionType',r.attribution_type,
 'productId',c.product_id,'cohortId',c.id,'basisType',r.basis_type,'sourceType',kind,'sourceId',sid,'contractId',p.contract_id,'currency',cur,'eligibleBasis',case when status='ELIGIBLE' then basis::text else null end,
 'commissionPreview',case when status='ELIGIBLE' then (case when r.basis_type='FIXED_PER_ENROLLMENT' then basis else round(basis*r.rate_bps/10000,2) end)::text else null end,
 'ledgerBasis',ledger_basis::text,'rateBps',r.rate_bps,'accruedAt',event_at,'eligibilityStatus',status);
end $$;
revoke all on function public.commission_candidate(uuid,uuid,uuid) from public,crm_app,crm_system;

create function public.commission_eligibility(target_organization uuid,target_enrollment uuid default null) returns jsonb language plpgsql stable security definer set search_path=public,app_auth as $$
declare ws uuid:=public.current_workspace_id();row record;pay record;item jsonb;items jsonb:='[]';
begin
 if app_auth.current_user_id() is null or not public.customer_subject_access('ORGANIZATION',target_organization,false) then raise exception 'commission_forbidden';end if;
 if not public.channel_commercial_access(target_organization,false) then return jsonb_build_object('available',false,'items',jsonb_build_array(jsonb_build_object('eligibilityStatus','FINANCE_NOT_VISIBLE')));end if;
 for row in select distinct r.id,e.id enrollment_id,r.basis_type from public.channel_agreements a join public.channel_agreement_versions v on v.agreement_id=a.id join public.channel_commission_rules r on r.agreement_version_id=v.id
 join public.enrollment_attributions t on t.source_organization_id=a.organization_id and t.attribution_type=r.attribution_type and t.workspace_id=ws join public.student_enrollments e on e.id=t.enrollment_id and e.workspace_id=ws
 where a.workspace_id=ws and a.organization_id=target_organization and (target_enrollment is null or e.id=target_enrollment) and public.student_enrollment_access(to_jsonb(e),false)
 loop
 if row.basis_type='FIXED_PER_ENROLLMENT' then item:=public.commission_candidate(row.id,row.enrollment_id);items:=items||(item-'ledgerBasis');
 else
 for pay in select p.id,p.contract_id,c.owner_id from public.contract_enrollment_links l join public.contracts c on c.id=l.contract_id and c.workspace_id=ws left join public.payments p on p.contract_id=c.id and p.workspace_id=ws and p.status in ('CONFIRMED','REFUNDED')
 where l.workspace_id=ws and l.enrollment_id=row.enrollment_id and l.status='ACTIVE' loop
 if not public.can_access_owned_record(ws,'CONTRACT',pay.contract_id,pay.owner_id,false) then item:=jsonb_build_object('ruleId',row.id,'enrollmentId',row.enrollment_id,'eligibilityStatus','FINANCE_NOT_VISIBLE');
 else item:=public.commission_candidate(row.id,row.enrollment_id,pay.id)-'ledgerBasis';end if;
 items:=items||item;end loop;
 if not exists(select 1 from public.contract_enrollment_links where workspace_id=ws and enrollment_id=row.enrollment_id and status='ACTIVE') then items:=items||jsonb_build_object('ruleId',row.id,'enrollmentId',row.enrollment_id,'eligibilityStatus','NO_FINANCIAL_BASE');end if;
 end if;end loop;
 return jsonb_build_object('available',true,'items',items);
end $$;
revoke all on function public.save_channel_agreement(uuid,uuid,integer,jsonb,text),public.change_channel_agreement_status(uuid,integer,text,text,text),public.get_channel_agreements(uuid),public.commission_eligibility(uuid,uuid) from public,crm_system;
grant execute on function public.save_channel_agreement(uuid,uuid,integer,jsonb,text),public.change_channel_agreement_status(uuid,integer,text,text,text),public.get_channel_agreements(uuid),public.commission_eligibility(uuid,uuid) to crm_app;

create function public.commission_record_refund(target_refund uuid) returns void language plpgsql security definer set search_path=public,app_auth,extensions as $$
declare ws uuid:=public.current_workspace_id();f public.refunds;earned public.commission_accruals;previous numeric;value numeric;key text;
begin
 select * into f from public.refunds where workspace_id=ws and id=target_refund and status='PAID';if not found then return;end if;
 for earned in select * from public.commission_accruals where workspace_id=ws and source_type='PAYMENT' and source_id=f.payment_id and entry_type='EARNED' loop
 if not exists(select 1 from public.channel_agreement_versions v join public.workspaces w on w.id=v.workspace_id where v.id=earned.agreement_version_id and (f.refunded_at at time zone w.business_timezone)::date>=v.effective_from and (v.effective_to is null or (f.refunded_at at time zone w.business_timezone)::date<=v.effective_to)) then continue;end if;
 key:=encode(digest(earned.rule_id::text||':REFUND:'||f.id::text,'sha256'),'hex');if exists(select 1 from public.commission_accruals where workspace_id=ws and source_key=key) then continue;end if;
 select coalesce(-sum(basis_amount),0) into previous from public.commission_accruals where workspace_id=ws and reverses_accrual_id=earned.id;
 if previous+f.amount>earned.basis_amount then raise exception 'commission_refund_exceeds_source';end if;
 value:=least(earned.commission_amount,round((previous+f.amount)*earned.rate_bps/10000,2))-least(earned.commission_amount,round(previous*earned.rate_bps/10000,2));
 insert into public.commission_accruals(workspace_id,organization_id,agreement_version_id,rule_id,attribution_id,enrollment_id,contract_id,source_type,source_id,source_key,currency,basis_amount,rate_bps,commission_amount,entry_type,accrued_at,reverses_accrual_id,created_by)
 values(ws,earned.organization_id,earned.agreement_version_id,earned.rule_id,earned.attribution_id,earned.enrollment_id,earned.contract_id,'REFUND',f.id,key,earned.currency,-f.amount,earned.rate_bps,-value,'REVERSAL',f.refunded_at,earned.id,app_auth.current_user_id());
 end loop;
end $$;
create function public.commission_accrue(target_rule uuid,target_enrollment uuid,receipt uuid default null) returns public.commission_accruals language plpgsql security definer set search_path=public,app_auth,extensions as $$
declare ws uuid:=public.current_workspace_id();item jsonb;key text;result public.commission_accruals;refund record;
begin
 perform public.lock_commercial_relations(ws);perform public.lock_commission_workspace(ws);item:=public.commission_candidate(target_rule,target_enrollment,receipt);
 if item->>'eligibilityStatus'<>'ELIGIBLE' then raise exception 'commission_source_ineligible';end if;
 key:=encode(digest(target_rule::text||':'||(item->>'sourceType')||':'||case when item->>'sourceType'='PAYMENT' then item->>'sourceId' else target_enrollment::text end,'sha256'),'hex');
 select * into result from public.commission_accruals where workspace_id=ws and source_key=key;
 if not found then
 insert into public.commission_accruals(workspace_id,organization_id,agreement_version_id,rule_id,attribution_id,enrollment_id,contract_id,source_type,source_id,source_key,currency,basis_amount,rate_bps,commission_amount,entry_type,accrued_at,created_by)
 values(ws,(item->>'organizationId')::uuid,(item->>'agreementVersionId')::uuid,target_rule,(item->>'attributionId')::uuid,target_enrollment,(item->>'contractId')::uuid,item->>'sourceType',(item->>'sourceId')::uuid,key,item->>'currency',(item->>'ledgerBasis')::numeric,
 (item->>'rateBps')::integer,case when item->>'basisType'='FIXED_PER_ENROLLMENT' then (item->>'ledgerBasis')::numeric else round((item->>'ledgerBasis')::numeric*(item->>'rateBps')::integer/10000,2) end,'EARNED',(item->>'accruedAt')::timestamptz,app_auth.current_user_id()) returning * into result;
 end if;
 if result.source_type='PAYMENT' then for refund in select id from public.refunds where workspace_id=ws and payment_id=result.source_id and status='PAID' order by refunded_at,id loop perform public.commission_record_refund(refund.id);end loop;end if;
 return result;
end $$;
revoke all on function public.commission_record_refund(uuid),public.commission_accrue(uuid,uuid,uuid) from public,crm_app,crm_system;

create function public.generate_commission_accrual(target_rule uuid,target_enrollment uuid,target_payment uuid,p_request_key text) returns jsonb language plpgsql security definer set search_path=public,app_auth,extensions as $$
declare ws uuid:=public.current_workspace_id();org uuid;e public.student_enrollments;p public.payments;c public.contracts;payload jsonb;item jsonb;result public.commission_accruals;
begin
 select a.organization_id into org from public.channel_commission_rules r join public.channel_agreement_versions v on v.id=r.agreement_version_id join public.channel_agreements a on a.id=v.agreement_id where r.workspace_id=ws and r.id=target_rule;
 select * into e from public.student_enrollments where workspace_id=ws and id=target_enrollment;
 if not public.channel_commercial_access(org,true) or not public.student_enrollment_access(to_jsonb(e),false) then raise exception 'commission_forbidden';end if;
 if target_payment is not null then select * into p from public.payments where workspace_id=ws and id=target_payment;select * into c from public.contracts where workspace_id=ws and id=p.contract_id;
 if c.id is null or not public.can_access_owned_record(ws,'CONTRACT',c.id,c.owner_id,false) then raise exception 'commission_forbidden';end if;end if;
 perform public.lock_commercial_relations(ws);perform public.lock_commission_workspace(ws);payload:=jsonb_build_object('rule',target_rule,'enrollment',target_enrollment,'payment',target_payment);
 item:=public.commission_receipt(p_request_key,'COMMISSION_GENERATE',payload);if item is not null then return item;end if;
 result:=public.commission_accrue(target_rule,target_enrollment,target_payment);return public.commission_finish(p_request_key,'COMMISSION_GENERATE',payload,to_jsonb(result));
end $$;
revoke all on function public.generate_commission_accrual(uuid,uuid,uuid,text) from public,crm_system;grant execute on function public.generate_commission_accrual(uuid,uuid,uuid,text) to crm_app;

-- Domain consequences, not user-configurable Automation monetary actions.
create function public.commission_source_event() returns trigger language plpgsql security definer set search_path=public,app_auth,extensions as $$
declare ws uuid:=new.workspace_id;candidate record;item jsonb;
begin
 if not exists(select 1 from public.channel_agreements where workspace_id=ws) then return new;end if;
 if ws is distinct from public.current_workspace_id() then raise exception 'commission_workspace_invalid';end if;
 perform public.lock_commercial_relations(ws);perform public.lock_commission_workspace(ws);
 if tg_table_name='refunds' then
 if new.status='PAID' and (tg_op='INSERT' or old.status is distinct from new.status) then perform public.commission_record_refund(new.id);end if;
 elsif tg_table_name='payments' then
 if new.status not in ('CONFIRMED','REFUNDED') or tg_op='UPDATE' and old.status in ('CONFIRMED','REFUNDED') then return new;end if;
 for candidate in select distinct r.id,e.id enrollment_id from public.contract_enrollment_links l join public.student_enrollments e on e.id=l.enrollment_id and e.workspace_id=ws
 join public.enrollment_attributions t on t.enrollment_id=e.id and t.workspace_id=ws and t.source_organization_id is not null
 join public.channel_agreements a on a.organization_id=t.source_organization_id and a.workspace_id=ws join public.channel_agreement_versions v on v.agreement_id=a.id
 join public.channel_commission_rules r on r.agreement_version_id=v.id and r.attribution_type=t.attribution_type and r.basis_type='PERCENT_OF_NET_COLLECTED' where l.workspace_id=ws and l.contract_id=new.contract_id and l.status='ACTIVE'
 loop item:=public.commission_candidate(candidate.id,candidate.enrollment_id,new.id);if item->>'eligibilityStatus'='ELIGIBLE' then perform public.commission_accrue(candidate.id,candidate.enrollment_id,new.id);end if;end loop;
 else
 if new.to_status not in ('ACTIVE','COMPLETED') then return new;end if;
 for candidate in select distinct r.id from public.enrollment_attributions t join public.channel_agreements a on a.organization_id=t.source_organization_id and a.workspace_id=ws
 join public.channel_agreement_versions v on v.agreement_id=a.id join public.channel_commission_rules r on r.agreement_version_id=v.id and r.attribution_type=t.attribution_type and r.basis_type='FIXED_PER_ENROLLMENT'
 where t.workspace_id=ws and t.enrollment_id=new.enrollment_id loop item:=public.commission_candidate(candidate.id,new.enrollment_id);if item->>'eligibilityStatus'='ELIGIBLE' then perform public.commission_accrue(candidate.id,new.enrollment_id);end if;end loop;
 end if;return new;
end $$;
revoke all on function public.commission_source_event() from public,crm_app,crm_system;
create trigger commission_enrollment_event after insert on public.student_enrollment_status_history for each row execute function public.commission_source_event();
create trigger commission_payment_event after insert or update of status on public.payments for each row execute function public.commission_source_event();
create trigger commission_refund_event after insert or update of status on public.refunds for each row execute function public.commission_source_event();

create function public.protect_commission_accrual() returns trigger language plpgsql set search_path=public as $$begin
 if tg_op='DELETE' then raise exception 'commission_ledger_immutable';end if;
 if pg_trigger_depth()<2 or (to_jsonb(new)-array['enrollment_id','attribution_id','source_id'])<>(to_jsonb(old)-array['enrollment_id','attribution_id','source_id']) or
 (new.enrollment_id is not null and new.enrollment_id is distinct from old.enrollment_id) or (new.attribution_id is not null and new.attribution_id is distinct from old.attribution_id) or
 (new.source_id is distinct from old.source_id and (new.source_id is not null or old.source_type not in ('ENROLLMENT_ACTIVE','ENROLLMENT_COMPLETED'))) then raise exception 'commission_ledger_immutable';end if;return new;
end $$;
create trigger commission_ledger_immutable before update or delete on public.commission_accruals for each row execute function public.protect_commission_accrual();
create function public.commission_privacy_cleanup() returns trigger language plpgsql security definer set search_path=public as $$begin
 update public.commission_accruals set enrollment_id=null,attribution_id=null,source_id=case when source_type in ('ENROLLMENT_ACTIVE','ENROLLMENT_COMPLETED') then null else source_id end where workspace_id=old.workspace_id and enrollment_id=old.id;
 delete from public.mutation_receipts where workspace_id=old.workspace_id and operation='COMMISSION_GENERATE' and result->'item'->>'enrollment_id'=old.id::text;return old;
end $$;
revoke all on function public.protect_commission_accrual(),public.commission_privacy_cleanup() from public,crm_app,crm_system;
create trigger commission_enrollment_privacy before delete on public.student_enrollments for each row execute function public.commission_privacy_cleanup();

create function public.save_commission_settlement(target_id uuid,expected_revision integer,data jsonb,p_request_key text) returns jsonb language plpgsql security definer set search_path=public,app_auth,extensions as $$
declare ws uuid:=public.current_workspace_id();s public.commission_settlements;item jsonb;payload jsonb;entry public.commission_accruals;selected uuid;
begin
 if public.current_crm_role() not in ('SUPER_ADMIN','ADMIN') or not public.channel_commercial_access((data->>'organization_id')::uuid,false) then raise exception 'commission_forbidden';end if;
 if jsonb_typeof(data) is distinct from 'object' or exists(select 1 from jsonb_object_keys(data) k where k not in ('organization_id','currency','period_start','period_end','reference_number','notes','accrual_ids')) or
 jsonb_typeof(data->'accrual_ids') is distinct from 'array' or jsonb_array_length(data->'accrual_ids')>100 then raise exception 'commission_input_invalid';end if;
 perform public.lock_commission_workspace(ws);payload:=jsonb_build_object('id',target_id,'revision',expected_revision,'data',data);item:=public.commission_receipt(p_request_key,'COMMISSION_SETTLEMENT_SAVE',payload);if item is not null then return item;end if;
 select * into s from public.commission_settlements where id=target_id and workspace_id=ws for update;
 if found then
 if s.status<>'DRAFT' then raise exception 'commission_settlement_immutable';end if;
 if expected_revision is null or expected_revision<>s.revision then raise exception 'commission_version_conflict';end if;
 if s.organization_id<>(data->>'organization_id')::uuid or s.currency<>data->>'currency' then raise exception 'commission_identity_immutable';end if;
 update public.commission_settlements set period_start=nullif(data->>'period_start','')::date,period_end=nullif(data->>'period_end','')::date,reference_number=nullif(data->>'reference_number',''),notes=coalesce(data->>'notes',''),revision=revision+1,updated_at=clock_timestamp() where id=s.id returning * into s;
 delete from public.commission_settlement_lines where workspace_id=ws and settlement_id=s.id;
 else if expected_revision is not null then raise exception 'commission_not_found';end if;
 insert into public.commission_settlements(id,workspace_id,organization_id,currency,period_start,period_end,reference_number,notes,created_by) values(target_id,ws,(data->>'organization_id')::uuid,data->>'currency',nullif(data->>'period_start','')::date,nullif(data->>'period_end','')::date,nullif(data->>'reference_number',''),coalesce(data->>'notes',''),app_auth.current_user_id()) returning * into s;
 end if;
 for selected in select value::text::uuid from jsonb_array_elements_text(data->'accrual_ids') loop
 select * into entry from public.commission_accruals where workspace_id=ws and id=selected;
 if not found or entry.organization_id<>s.organization_id or entry.currency<>s.currency then raise exception 'commission_line_invalid';end if;
 insert into public.commission_settlement_lines(workspace_id,settlement_id,accrual_id) values(ws,s.id,entry.id);
 end loop;
 insert into public.audit_events(workspace_id,actor_id,action,entity_type,entity_id,after_data) values(ws,app_auth.current_user_id(),'COMMISSION_SETTLEMENT_SAVED','COMMISSION_SETTLEMENT',s.id,jsonb_build_object('revision',s.revision));return public.commission_finish(p_request_key,'COMMISSION_SETTLEMENT_SAVE',payload,to_jsonb(s));
end $$;

create function public.change_commission_settlement_status(target_id uuid,expected_revision integer,next_status text,reference text,reason text,p_request_key text) returns jsonb language plpgsql security definer set search_path=public,app_auth,extensions as $$
declare ws uuid:=public.current_workspace_id();s public.commission_settlements;item jsonb;payload jsonb;total numeric;
begin
 perform public.lock_commission_workspace(ws);select * into s from public.commission_settlements where workspace_id=ws and id=target_id for update;
 if public.current_crm_role() not in ('SUPER_ADMIN','ADMIN') or not public.channel_commercial_access(s.organization_id,false) then raise exception 'commission_forbidden';end if;
 payload:=jsonb_build_object('id',target_id,'revision',expected_revision,'status',next_status,'reference',reference,'reason',reason);item:=public.commission_receipt(p_request_key,'COMMISSION_SETTLEMENT_STATUS',payload);if item is not null then return item;end if;
 if expected_revision is null or expected_revision<>s.revision then raise exception 'commission_version_conflict';end if;
 if next_status is null or not ((s.status='DRAFT' and next_status in ('APPROVED','CANCELLED')) or (s.status='APPROVED' and next_status in ('PAID','CANCELLED'))) then raise exception 'commission_transition_invalid';end if;
 select sum(a.commission_amount) into total from public.commission_settlement_lines l join public.commission_accruals a on a.id=l.accrual_id and a.workspace_id=ws where l.settlement_id=s.id and l.workspace_id=ws and l.reserved;
 if next_status in ('APPROVED','PAID') and coalesce(total,0)<=0 then raise exception 'commission_positive_total_required';end if;
 if next_status='PAID' and length(trim(coalesce(reference,''))) not between 1 and 160 or next_status='CANCELLED' and length(trim(coalesce(reason,''))) not between 1 and 1000 then raise exception 'commission_input_invalid';end if;
 update public.commission_settlements set status=next_status,revision=revision+1,updated_at=clock_timestamp(),approved_at=case when next_status='APPROVED' then clock_timestamp() else approved_at end,
 approved_by=case when next_status='APPROVED' then app_auth.current_user_id() else approved_by end,paid_at=case when next_status='PAID' then clock_timestamp() else paid_at end,
 paid_by=case when next_status='PAID' then app_auth.current_user_id() else paid_by end,payment_reference=case when next_status='PAID' then trim(reference) else payment_reference end,cancel_reason=case when next_status='CANCELLED' then trim(reason) else cancel_reason end where id=s.id returning * into s;
 if next_status='CANCELLED' then update public.commission_settlement_lines set reserved=false where workspace_id=ws and settlement_id=s.id;end if;
 insert into public.audit_events(workspace_id,actor_id,action,entity_type,entity_id,after_data) values(ws,app_auth.current_user_id(),'COMMISSION_SETTLEMENT_'||next_status,'COMMISSION_SETTLEMENT',s.id,jsonb_build_object('revision',s.revision));
 if next_status in ('APPROVED','PAID') then perform public.dispatch_automation_event(ws,'COMMISSION_SETTLEMENT_'||next_status,'commission-settlement:'||s.id::text||':'||s.revision::text,jsonb_build_object('workspaceId',ws,'organizationId',s.organization_id,'settlementId',s.id,'status',next_status),app_auth.current_user_id());end if;
 return public.commission_finish(p_request_key,'COMMISSION_SETTLEMENT_STATUS',payload,to_jsonb(s));
end $$;
create view public.commission_settlement_summary with(security_invoker=true) as select s.*,coalesce(sum(a.commission_amount),0)::text net_amount,count(l.id) line_count from public.commission_settlements s left join public.commission_settlement_lines l on l.settlement_id=s.id and l.workspace_id=s.workspace_id left join public.commission_accruals a on a.id=l.accrual_id and a.workspace_id=s.workspace_id group by s.id;
create view public.commission_accrual_listing with(security_invoker=true) as select a.*,a.basis_amount::text basis_text,a.commission_amount::text commission_text,l.settlement_id,s.status settlement_status from public.commission_accruals a left join public.commission_settlement_lines l on l.accrual_id=a.id and l.workspace_id=a.workspace_id and l.reserved left join public.commission_settlements s on s.id=l.settlement_id and s.workspace_id=a.workspace_id;
grant select on public.commission_settlement_summary,public.commission_accrual_listing to crm_app;
revoke all on function public.save_commission_settlement(uuid,integer,jsonb,text),public.change_commission_settlement_status(uuid,integer,text,text,text,text) from public,crm_system;
grant execute on function public.save_commission_settlement(uuid,integer,jsonb,text),public.change_commission_settlement_status(uuid,integer,text,text,text,text) to crm_app;

create function public.protect_channel_terms() returns trigger language plpgsql set search_path=public as $$
declare used boolean;
begin
 if tg_table_name='channel_commission_rules' then select status<>'DRAFT' into used from public.channel_agreement_versions where id=coalesce(new.agreement_version_id,old.agreement_version_id);
 if tg_op='UPDATE' and old.agreement_version_id<>new.agreement_version_id then raise exception 'agreement_identity_immutable';end if;
 if used then raise exception 'agreement_version_immutable';end if;
 elsif tg_table_name='channel_agreement_versions' then
 if tg_op='DELETE' or old.status<>'DRAFT' and (to_jsonb(new)-array['status','revision','updated_at'])<>(to_jsonb(old)-array['status','revision','updated_at']) then raise exception 'agreement_version_immutable';end if;
 end if;if tg_op='DELETE' then return old;end if;return new;
end $$;
create trigger channel_version_terms before update or delete on public.channel_agreement_versions for each row execute function public.protect_channel_terms();
create trigger channel_rule_terms before insert or update or delete on public.channel_commission_rules for each row execute function public.protect_channel_terms();
create function public.protect_commission_line() returns trigger language plpgsql set search_path=public as $$
declare s public.commission_settlements;a public.commission_accruals;
begin
 select * into s from public.commission_settlements where workspace_id=coalesce(new.workspace_id,old.workspace_id) and id=coalesce(new.settlement_id,old.settlement_id);
 if tg_op='UPDATE' and s.status='CANCELLED' and old.reserved and not new.reserved and (to_jsonb(old)-'reserved')=(to_jsonb(new)-'reserved') then return new;end if;
 if s.status is distinct from 'DRAFT' then raise exception 'commission_settlement_immutable';end if;
 if tg_op='DELETE' then return old;end if;
 select * into a from public.commission_accruals where workspace_id=new.workspace_id and id=new.accrual_id;
 if a.id is null or a.organization_id<>s.organization_id or a.currency<>s.currency or not new.reserved then raise exception 'commission_line_invalid';end if;return new;
end $$;
create trigger commission_line_integrity before insert or update or delete on public.commission_settlement_lines for each row execute function public.protect_commission_line();
create function public.protect_commission_settlement() returns trigger language plpgsql set search_path=public as $$begin
 if tg_op='DELETE' or old.status in ('PAID','CANCELLED') or new.organization_id<>old.organization_id or new.currency<>old.currency or
 (old.status='APPROVED' and (to_jsonb(new)-array['status','paid_at','paid_by','payment_reference','cancel_reason','revision','updated_at'])<>(to_jsonb(old)-array['status','paid_at','paid_by','payment_reference','cancel_reason','revision','updated_at'])) then raise exception 'commission_settlement_immutable';end if;return new;
end $$;
create trigger commission_settlement_freeze before update or delete on public.commission_settlements for each row execute function public.protect_commission_settlement();
revoke all on function public.protect_channel_terms(),public.protect_commission_line(),public.protect_commission_settlement() from public,crm_app,crm_system;

create function public.commission_ledger_event() returns trigger language plpgsql security definer set search_path=public,app_auth,extensions as $$begin
 insert into public.audit_events(workspace_id,actor_id,action,entity_type,entity_id,after_data) values(new.workspace_id,app_auth.current_user_id(),case when new.entry_type='REVERSAL' then 'COMMISSION_ACCRUAL_REVERSED' else 'COMMISSION_ACCRUAL_CREATED' end,'COMMISSION_ACCRUAL',new.id,jsonb_build_object('ruleId',new.rule_id,'organizationId',new.organization_id,'entryType',new.entry_type));
 perform public.dispatch_automation_event(new.workspace_id,'COMMISSION_ACCRUAL_CREATED','commission-accrual:'||new.id::text,jsonb_build_object('workspaceId',new.workspace_id,'organizationId',new.organization_id,'accrualId',new.id,'entryType',new.entry_type),coalesce(app_auth.current_user_id(),new.created_by));return new;
end $$;
revoke all on function public.commission_ledger_event() from public,crm_app,crm_system;
create trigger commission_ledger_event after insert on public.commission_accruals for each row execute function public.commission_ledger_event();

alter table public.automation_rules drop constraint automation_rules_trigger_key_check;
alter table public.automation_rules add constraint automation_rules_trigger_key_check check(trigger_key in ('LEAD_CREATED','LEAD_STATUS_CHANGED','OPPORTUNITY_STAGE_CHANGED','CONTRACT_RENEWAL_DUE','MANUAL','ENROLLMENT_CREATED','ENROLLMENT_STATUS_CHANGED','COHORT_APPLICATION_DEADLINE_APPROACHING','APPLICATION_CREATED','APPLICATION_STATUS_CHANGED','MILESTONE_STATUS_CHANGED','MILESTONE_DUE_APPROACHING','WORKFLOW_STARTED','WORKFLOW_STEP_READY','WORKFLOW_COMPLETED','LEAD_CLAIMED','LEAD_RELEASED','CHANNEL_STAGE_CHANGED','COMMISSION_ACCRUAL_CREATED','COMMISSION_SETTLEMENT_APPROVED','COMMISSION_SETTLEMENT_PAID'));
create or replace function public.dispatch_automation_event(
  target_workspace uuid,target_trigger text,target_event_key text,target_payload jsonb,target_actor uuid
) returns jsonb
language plpgsql security definer set search_path=public,app_auth,extensions
as $$
declare event_row public.automation_events;rule_row public.automation_rules;task_id uuid;notification_id uuid;
  succeeded integer:=0;failed integer:=0;duplicate boolean:=false;due_hours integer;
begin
  if target_workspace is null or target_trigger not in ('LEAD_CREATED','LEAD_STATUS_CHANGED','OPPORTUNITY_STAGE_CHANGED','CONTRACT_RENEWAL_DUE','MANUAL','ENROLLMENT_CREATED','ENROLLMENT_STATUS_CHANGED','COHORT_APPLICATION_DEADLINE_APPROACHING','APPLICATION_CREATED','APPLICATION_STATUS_CHANGED','MILESTONE_STATUS_CHANGED','MILESTONE_DUE_APPROACHING','WORKFLOW_STARTED','WORKFLOW_STEP_READY','WORKFLOW_COMPLETED','LEAD_CLAIMED','LEAD_RELEASED','CHANNEL_STAGE_CHANGED','COMMISSION_ACCRUAL_CREATED','COMMISSION_SETTLEMENT_APPROVED','COMMISSION_SETTLEMENT_PAID')
    or nullif(trim(target_event_key),'') is null or jsonb_typeof(coalesce(target_payload,'{}'::jsonb))<>'object' then
    raise exception 'automation_event_invalid';
  end if;
  insert into public.automation_events(workspace_id,trigger_key,event_key,payload,actor_id)
  values(target_workspace,target_trigger,left(target_event_key,240),coalesce(target_payload,'{}'::jsonb),target_actor)
  on conflict(workspace_id,event_key) do nothing returning * into event_row;
  if event_row.id is null then
    duplicate:=true;
    select * into event_row from public.automation_events where workspace_id=target_workspace and event_key=left(target_event_key,240);
    return jsonb_build_object('eventId',event_row.id,'duplicate',true,'succeeded',0,'failed',0);
  end if;
  for rule_row in select * from public.automation_rules
    where workspace_id=target_workspace and active and trigger_key=target_trigger
      and (conditions='{}'::jsonb or coalesce(target_payload,'{}'::jsonb) @> conditions)
    order by created_at,id
  loop
    begin
      if rule_row.action_type='TASK' then
        due_hours:=case when coalesce(rule_row.action_config->>'dueHours','')~'^\d{1,4}$'
          then greatest(1,least(2160,(rule_row.action_config->>'dueHours')::integer)) else 24 end;
        insert into public.crm_tasks(workspace_id,title_zh,title_en,related_type,related_id,related_label,status,priority,owner_id,due_at,created_by)
        values(target_workspace,
          coalesce(nullif(trim(rule_row.action_config->>'titleZh'),''),rule_row.name_zh),
          coalesce(nullif(trim(rule_row.action_config->>'titleEn'),''),rule_row.name_en),
          coalesce(nullif(trim(target_payload->>'relatedType'),''),'GENERAL'),
          case when coalesce(target_payload->>'relatedId','')~'^[0-9a-fA-F-]{36}$' then (target_payload->>'relatedId')::uuid else null end,
          left(coalesce(target_payload->>'relatedLabel',''),160),'TODO',
          case when upper(coalesce(rule_row.action_config->>'priority','NORMAL')) in ('LOW','NORMAL','HIGH','URGENT') then upper(rule_row.action_config->>'priority') else 'NORMAL' end,
          target_actor,now()+make_interval(hours=>due_hours),target_actor)
        returning id into task_id;
        insert into public.automation_runs(workspace_id,rule_id,event_id,status,result_type,result_id)
        values(target_workspace,rule_row.id,event_row.id,'SUCCEEDED','TASK',task_id);
      else
        insert into public.user_notifications(workspace_id,user_id,kind,title_key,body_key,values,source_type,source_id)
        values(target_workspace,target_actor,'AUTOMATION','automation.notification.title','automation.notification.body',
          jsonb_build_object('ruleZh',rule_row.name_zh,'ruleEn',rule_row.name_en,'event',target_trigger),
          'AUTOMATION_RULE',rule_row.id) returning id into notification_id;
        insert into public.automation_runs(workspace_id,rule_id,event_id,status,result_type,result_id)
        values(target_workspace,rule_row.id,event_row.id,'SUCCEEDED','NOTIFICATION',notification_id);
      end if;
      succeeded:=succeeded+1;
    exception when others then
      failed:=failed+1;
      insert into public.automation_runs(workspace_id,rule_id,event_id,status,error_code)
      values(target_workspace,rule_row.id,event_row.id,'FAILED',left(sqlstate||':'||sqlerrm,500))
      on conflict(rule_id,event_id) do nothing;
    end;
  end loop;
  return jsonb_build_object('eventId',event_row.id,'duplicate',duplicate,'succeeded',succeeded,'failed',failed);
end;
$$;

-- Commission contextual quality rules.
insert into public.data_quality_rule_configs(workspace_id,rule_key,severity,enabled) select w.id,k,'MEDIUM',true from public.workspaces w cross join unnest(array['ACTIVE_CHANNEL_WITHOUT_AGREEMENT','ACTIVE_AGREEMENT_WITHOUT_RULE','COMMISSION_SHARED_CONTRACT_UNALLOCATED','COMMISSION_MULTIPLE_ELIGIBLE_CHANNELS','APPROVED_SETTLEMENT_NOT_PAID']) k on conflict do nothing;
create or replace function public.run_data_quality_rules()
returns integer language plpgsql security definer set search_path=public,app_auth,extensions as $$
declare marker timestamptz:=clock_timestamp();affected integer;ws uuid:=public.current_workspace_id();
begin
  if public.current_crm_role() not in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER') then raise exception 'quality_not_authorized'; end if;

  insert into public.data_quality_issues(workspace_id,rule_key,entity_type,entity_id,severity,title_key,details,last_seen_at)
  select c.workspace_id,config.rule_key,'CONTACT',c.id,config.severity,'quality.rule.contactMethod',jsonb_build_object('nameZh',c.name_zh,'nameEn',c.name_en),marker
  from public.contacts c join public.data_quality_rule_configs config on config.workspace_id=c.workspace_id and config.rule_key='CONTACT_METHOD_MISSING' and config.enabled
  where c.workspace_id=ws and c.email is null and coalesce(c.phone,'')=''
  on conflict(workspace_id,rule_key,entity_type,entity_id) do update set severity=excluded.severity,status=case when data_quality_issues.status='RESOLVED' then 'OPEN' else data_quality_issues.status end,details=excluded.details,last_seen_at=marker;

  insert into public.data_quality_issues(workspace_id,rule_key,entity_type,entity_id,severity,title_key,details,last_seen_at)
  select o.workspace_id,config.rule_key,'OPPORTUNITY',o.id,config.severity,'quality.rule.nextAction',jsonb_build_object('titleZh',o.title_zh,'titleEn',o.title_en),marker
  from public.opportunities o join public.data_quality_rule_configs config on config.workspace_id=o.workspace_id and config.rule_key='OPPORTUNITY_NEXT_ACTION_MISSING' and config.enabled
  where o.workspace_id=ws and o.stage not in ('WON','LOST') and o.next_action_zh='' and o.next_action_en=''
  on conflict(workspace_id,rule_key,entity_type,entity_id) do update set severity=excluded.severity,status=case when data_quality_issues.status='RESOLVED' then 'OPEN' else data_quality_issues.status end,details=excluded.details,last_seen_at=marker;

  insert into public.data_quality_issues(workspace_id,rule_key,entity_type,entity_id,severity,title_key,details,last_seen_at)
  select organization.workspace_id,config.rule_key,'ORGANIZATION',organization.id,config.severity,'quality.rule.owner',jsonb_build_object('nameZh',organization.name_zh,'nameEn',organization.name_en),marker
  from public.organizations organization join public.data_quality_rule_configs config on config.workspace_id=organization.workspace_id and config.rule_key='ORGANIZATION_OWNER_MISSING' and config.enabled
  where organization.workspace_id=ws and organization.owner_id is null
  on conflict(workspace_id,rule_key,entity_type,entity_id) do update set severity=excluded.severity,status=case when data_quality_issues.status='RESOLVED' then 'OPEN' else data_quality_issues.status end,details=excluded.details,last_seen_at=marker;

  insert into public.data_quality_issues(workspace_id,rule_key,entity_type,entity_id,severity,title_key,details,last_seen_at)
  select student.workspace_id,config.rule_key,'STUDENT',student.id,config.severity,'quality.rule.guardianMissing',jsonb_build_object('studentId',student.student_number),marker
  from public.students student join public.data_quality_rule_configs config on config.workspace_id=student.workspace_id and config.rule_key='STUDENT_GUARDIAN_MISSING' and config.enabled
  where student.workspace_id=ws and student.status='ACTIVE' and not exists(select 1 from public.student_guardian_relationships relation where relation.student_id=student.id)
  on conflict(workspace_id,rule_key,entity_type,entity_id) do update set severity=excluded.severity,status=case when data_quality_issues.status='RESOLVED' then 'OPEN' else data_quality_issues.status end,details=excluded.details,last_seen_at=marker;

  insert into public.data_quality_issues(workspace_id,rule_key,entity_type,entity_id,severity,title_key,details,last_seen_at)
  select distinct on(consent.contact_id) consent.workspace_id,config.rule_key,'CONTACT',consent.contact_id,config.severity,'quality.rule.consentExpired',jsonb_build_object('channel',consent.channel,'purpose',consent.purpose,'retentionUntil',consent.retention_until),marker
  from public.contact_consents consent join public.data_quality_rule_configs config on config.workspace_id=consent.workspace_id and config.rule_key='CONSENT_EXPIRED' and config.enabled
  where consent.workspace_id=ws and consent.status='GRANTED' and consent.retention_until<current_date order by consent.contact_id,consent.retention_until
  on conflict(workspace_id,rule_key,entity_type,entity_id) do update set severity=excluded.severity,status=case when data_quality_issues.status='RESOLVED' then 'OPEN' else data_quality_issues.status end,details=excluded.details,last_seen_at=marker;

  insert into public.data_quality_issues(workspace_id,rule_key,entity_type,entity_id,severity,title_key,details,last_seen_at)
  select opportunity.workspace_id,config.rule_key,'OPPORTUNITY',opportunity.id,config.severity,'quality.rule.exchangeRateMissing',jsonb_build_object('currency',opportunity.currency,'amount',opportunity.amount),marker
  from public.opportunities opportunity join public.workspaces workspace on workspace.id=opportunity.workspace_id
  join public.data_quality_rule_configs config on config.workspace_id=opportunity.workspace_id and config.rule_key='OPPORTUNITY_EXCHANGE_RATE_MISSING' and config.enabled
  where opportunity.workspace_id=ws and opportunity.stage not in ('WON','LOST') and opportunity.currency<>workspace.default_currency
    and not exists(select 1 from public.exchange_rate_snapshots rate where rate.workspace_id=opportunity.workspace_id and rate.base_currency=workspace.default_currency and rate.quote_currency=opportunity.currency and rate.effective_at<=now())
  on conflict(workspace_id,rule_key,entity_type,entity_id) do update set severity=excluded.severity,status=case when data_quality_issues.status='RESOLVED' then 'OPEN' else data_quality_issues.status end,details=excluded.details,last_seen_at=marker;

  insert into public.data_quality_issues(workspace_id,rule_key,entity_type,entity_id,severity,title_key,details,last_seen_at)
  select lead.workspace_id,config.rule_key,'LEAD',lead.id,config.severity,'quality.rule.attributionMissing',jsonb_build_object('nameZh',lead.name_zh,'nameEn',lead.name_en,'source',lead.source),marker
  from public.leads lead join public.data_quality_rule_configs config on config.workspace_id=lead.workspace_id and config.rule_key='LEAD_ATTRIBUTION_MISSING' and config.enabled
  where lead.workspace_id=ws and lead.status not in ('CONVERTED','LOST') and not exists(select 1 from public.lead_attribution_touches touch where touch.lead_id=lead.id)
  on conflict(workspace_id,rule_key,entity_type,entity_id) do update set severity=excluded.severity,status=case when data_quality_issues.status='RESOLVED' then 'OPEN' else data_quality_issues.status end,details=excluded.details,last_seen_at=marker;

  insert into public.data_quality_issues(workspace_id,rule_key,entity_type,entity_id,severity,title_key,details,last_seen_at)
  select duplicate.workspace_id,config.rule_key,'CONTACT',duplicate.id,config.severity,'quality.rule.duplicateContact',jsonb_build_object('duplicateKey',duplicate.duplicate_key,'canonicalId',duplicate.canonical_id),marker
  from (
    select ranked.*,first_value(ranked.id) over(partition by ranked.workspace_id,ranked.duplicate_key order by ranked.created_at,ranked.id) canonical_id
    from (
      select c.*,coalesce(nullif(lower(c.email::text),''),nullif(regexp_replace(c.phone,'\D','','g'),'')) duplicate_key,
        count(*) over(partition by c.workspace_id,coalesce(nullif(lower(c.email::text),''),nullif(regexp_replace(c.phone,'\D','','g'),''))) duplicate_count
      from public.contacts c where c.workspace_id=ws
    ) ranked where ranked.duplicate_key is not null and ranked.duplicate_count>1
  ) duplicate join public.data_quality_rule_configs config on config.workspace_id=duplicate.workspace_id and config.rule_key='CONTACT_DUPLICATE' and config.enabled
  where duplicate.id<>duplicate.canonical_id
  on conflict(workspace_id,rule_key,entity_type,entity_id) do update set severity=excluded.severity,status=case when data_quality_issues.status='RESOLVED' then 'OPEN' else data_quality_issues.status end,details=excluded.details,last_seen_at=marker;

  insert into public.data_quality_issues(workspace_id,rule_key,entity_type,entity_id,severity,title_key,details,last_seen_at)
 select c.workspace_id,config.rule_key,'COHORT',c.id,config.severity,'quality.rule.COHORT_MISSING_APPLICATION_DEADLINE',jsonb_build_object('reference',c.id),marker
 from public.product_cohorts c join public.data_quality_rule_configs config on config.workspace_id=c.workspace_id and config.rule_key='COHORT_MISSING_APPLICATION_DEADLINE' and config.enabled
 where c.workspace_id=ws and (c.status in ('DRAFT','RECRUITING') and c.application_deadline is null)
 on conflict(workspace_id,rule_key,entity_type,entity_id) do update set severity=excluded.severity,status=case when data_quality_issues.status='RESOLVED' then 'OPEN' else data_quality_issues.status end,details=excluded.details,last_seen_at=marker;
  insert into public.data_quality_issues(workspace_id,rule_key,entity_type,entity_id,severity,title_key,details,last_seen_at)
 select c.workspace_id,config.rule_key,'COHORT',c.id,config.severity,'quality.rule.COHORT_MISSING_OWNER',jsonb_build_object('reference',c.id),marker
 from public.product_cohorts c join public.data_quality_rule_configs config on config.workspace_id=c.workspace_id and config.rule_key='COHORT_MISSING_OWNER' and config.enabled
 where c.workspace_id=ws and (c.status in ('DRAFT','RECRUITING','ACTIVE') and c.owner_id is null)
 on conflict(workspace_id,rule_key,entity_type,entity_id) do update set severity=excluded.severity,status=case when data_quality_issues.status='RESOLVED' then 'OPEN' else data_quality_issues.status end,details=excluded.details,last_seen_at=marker;
  insert into public.data_quality_issues(workspace_id,rule_key,entity_type,entity_id,severity,title_key,details,last_seen_at)
 select c.workspace_id,config.rule_key,'COHORT',c.id,config.severity,'quality.rule.COHORT_RECRUITING_AFTER_DEADLINE',jsonb_build_object('reference',c.id),marker
 from public.product_cohorts c join public.data_quality_rule_configs config on config.workspace_id=c.workspace_id and config.rule_key='COHORT_RECRUITING_AFTER_DEADLINE' and config.enabled
 where c.workspace_id=ws and (c.status='RECRUITING' and c.application_deadline<public.current_business_date()::date)
 on conflict(workspace_id,rule_key,entity_type,entity_id) do update set severity=excluded.severity,status=case when data_quality_issues.status='RESOLVED' then 'OPEN' else data_quality_issues.status end,details=excluded.details,last_seen_at=marker;
  insert into public.data_quality_issues(workspace_id,rule_key,entity_type,entity_id,severity,title_key,details,last_seen_at)
 select c.workspace_id,config.rule_key,'COHORT',c.id,config.severity,'quality.rule.COHORT_ACTIVE_WITHOUT_START_DATE',jsonb_build_object('reference',c.id),marker
 from public.product_cohorts c join public.data_quality_rule_configs config on config.workspace_id=c.workspace_id and config.rule_key='COHORT_ACTIVE_WITHOUT_START_DATE' and config.enabled
 where c.workspace_id=ws and (c.status='ACTIVE' and c.start_on is null)
 on conflict(workspace_id,rule_key,entity_type,entity_id) do update set severity=excluded.severity,status=case when data_quality_issues.status='RESOLVED' then 'OPEN' else data_quality_issues.status end,details=excluded.details,last_seen_at=marker;
  insert into public.data_quality_issues(workspace_id,rule_key,entity_type,entity_id,severity,title_key,details,last_seen_at)
 select c.workspace_id,config.rule_key,'COHORT',c.id,config.severity,'quality.rule.COHORT_COMPLETED_WITHOUT_END_DATE',jsonb_build_object('reference',c.id),marker
 from public.product_cohorts c join public.data_quality_rule_configs config on config.workspace_id=c.workspace_id and config.rule_key='COHORT_COMPLETED_WITHOUT_END_DATE' and config.enabled
 where c.workspace_id=ws and (c.status='COMPLETED' and c.end_on is null)
 on conflict(workspace_id,rule_key,entity_type,entity_id) do update set severity=excluded.severity,status=case when data_quality_issues.status='RESOLVED' then 'OPEN' else data_quality_issues.status end,details=excluded.details,last_seen_at=marker;
  insert into public.data_quality_issues(workspace_id,rule_key,entity_type,entity_id,severity,title_key,details,last_seen_at)
 select c.workspace_id,config.rule_key,'ENROLLMENT',c.id,config.severity,'quality.rule.ENROLLMENT_MISSING_HOUSEHOLD',jsonb_build_object('reference',c.id),marker
 from public.student_enrollments c join public.data_quality_rule_configs config on config.workspace_id=c.workspace_id and config.rule_key='ENROLLMENT_MISSING_HOUSEHOLD' and config.enabled
 where c.workspace_id=ws and (c.status in ('REGISTERING','ACTIVE') and c.household_id is null) and public.student_enrollment_access(to_jsonb(c),false)
 on conflict(workspace_id,rule_key,entity_type,entity_id) do update set severity=excluded.severity,status=case when data_quality_issues.status='RESOLVED' then 'OPEN' else data_quality_issues.status end,details=excluded.details,last_seen_at=marker;
  insert into public.data_quality_issues(workspace_id,rule_key,entity_type,entity_id,severity,title_key,details,last_seen_at)
 select c.workspace_id,config.rule_key,'ENROLLMENT',c.id,config.severity,'quality.rule.ENROLLMENT_WITHOUT_PRIMARY_ATTRIBUTION',jsonb_build_object('reference',c.id),marker
 from public.student_enrollments c join public.data_quality_rule_configs config on config.workspace_id=c.workspace_id and config.rule_key='ENROLLMENT_WITHOUT_PRIMARY_ATTRIBUTION' and config.enabled
 where c.workspace_id=ws and (c.status in ('INTERESTED','REGISTERING','ACTIVE') and not exists(select 1 from public.enrollment_attributions a where a.enrollment_id=c.id and a.workspace_id=c.workspace_id and a.attribution_type='PRIMARY')) and public.student_enrollment_access(to_jsonb(c),false)
 on conflict(workspace_id,rule_key,entity_type,entity_id) do update set severity=excluded.severity,status=case when data_quality_issues.status='RESOLVED' then 'OPEN' else data_quality_issues.status end,details=excluded.details,last_seen_at=marker;
  insert into public.data_quality_issues(workspace_id,rule_key,entity_type,entity_id,severity,title_key,details,last_seen_at)
 select c.workspace_id,config.rule_key,'ENROLLMENT',c.id,config.severity,'quality.rule.ENROLLMENT_ACTIVE_WITHOUT_CONTRACT',jsonb_build_object('reference',c.id),marker
 from public.student_enrollments c join public.data_quality_rule_configs config on config.workspace_id=c.workspace_id and config.rule_key='ENROLLMENT_ACTIVE_WITHOUT_CONTRACT' and config.enabled
 where c.workspace_id=ws and (c.status='ACTIVE' and not exists(select 1 from public.contract_enrollment_links l where l.enrollment_id=c.id and l.workspace_id=c.workspace_id and l.status='ACTIVE')) and public.student_enrollment_access(to_jsonb(c),false)
 on conflict(workspace_id,rule_key,entity_type,entity_id) do update set severity=excluded.severity,status=case when data_quality_issues.status='RESOLVED' then 'OPEN' else data_quality_issues.status end,details=excluded.details,last_seen_at=marker;
  insert into public.data_quality_issues(workspace_id,rule_key,entity_type,entity_id,severity,title_key,details,last_seen_at)
  select a.workspace_id,config.rule_key,'APPLICATION',a.id,config.severity,'quality.rule.APPLICATION_PAST_DEADLINE_NOT_SUBMITTED',jsonb_build_object('reference',a.id),marker
  from public.student_applications a join public.data_quality_rule_configs config on config.workspace_id=a.workspace_id and config.rule_key='APPLICATION_PAST_DEADLINE_NOT_SUBMITTED' and config.enabled
  where a.workspace_id=ws and a.status in ('DRAFT','PREPARING') and a.deadline_on<public.current_business_date()::date and public.student_application_access(to_jsonb(a),false)
  on conflict(workspace_id,rule_key,entity_type,entity_id) do update set severity=excluded.severity,status=case when data_quality_issues.status='RESOLVED' then 'OPEN' else data_quality_issues.status end,details=excluded.details,last_seen_at=marker;
  insert into public.data_quality_issues(workspace_id,rule_key,entity_type,entity_id,severity,title_key,details,last_seen_at)
  select m.workspace_id,config.rule_key,'ADMISSION_MILESTONE',m.id,config.severity,'quality.rule.MILESTONE_OVERDUE',jsonb_build_object('reference',m.id,'enrollmentId',m.enrollment_id),marker
  from public.admission_milestones m join public.data_quality_rule_configs config on config.workspace_id=m.workspace_id and config.rule_key='MILESTONE_OVERDUE' and config.enabled
  where m.workspace_id=ws and (m.due_at<now() and m.status not in ('COMPLETED','WAIVED','CANCELLED')) and public.admission_milestone_access(to_jsonb(m),false)
  on conflict(workspace_id,rule_key,entity_type,entity_id) do update set severity=excluded.severity,status=case when data_quality_issues.status='RESOLVED' then 'OPEN' else data_quality_issues.status end,details=excluded.details,last_seen_at=marker;
  insert into public.data_quality_issues(workspace_id,rule_key,entity_type,entity_id,severity,title_key,details,last_seen_at)
  select m.workspace_id,config.rule_key,'ADMISSION_MILESTONE',m.id,config.severity,'quality.rule.MILESTONE_BLOCKED',jsonb_build_object('reference',m.id,'enrollmentId',m.enrollment_id),marker
  from public.admission_milestones m join public.data_quality_rule_configs config on config.workspace_id=m.workspace_id and config.rule_key='MILESTONE_BLOCKED' and config.enabled
  where m.workspace_id=ws and (m.status='BLOCKED') and public.admission_milestone_access(to_jsonb(m),false)
  on conflict(workspace_id,rule_key,entity_type,entity_id) do update set severity=excluded.severity,status=case when data_quality_issues.status='RESOLVED' then 'OPEN' else data_quality_issues.status end,details=excluded.details,last_seen_at=marker;
  insert into public.data_quality_issues(workspace_id,rule_key,entity_type,entity_id,severity,title_key,details,last_seen_at)
  select m.workspace_id,config.rule_key,'ADMISSION_MILESTONE',m.id,config.severity,'quality.rule.VISA_RESULT_MISSING_OUTCOME',jsonb_build_object('reference',m.id,'enrollmentId',m.enrollment_id),marker
  from public.admission_milestones m join public.data_quality_rule_configs config on config.workspace_id=m.workspace_id and config.rule_key='VISA_RESULT_MISSING_OUTCOME' and config.enabled
  where m.workspace_id=ws and (m.milestone_type='VISA_RESULT' and m.status='COMPLETED' and m.outcome is null and not m.metadata ? 'result') and public.admission_milestone_access(to_jsonb(m),false)
  on conflict(workspace_id,rule_key,entity_type,entity_id) do update set severity=excluded.severity,status=case when data_quality_issues.status='RESOLVED' then 'OPEN' else data_quality_issues.status end,details=excluded.details,last_seen_at=marker;

 insert into public.data_quality_issues(workspace_id,rule_key,entity_type,entity_id,severity,title_key,details,last_seen_at)
 select w.workspace_id,c.rule_key,'WORKFLOW',w.id,c.severity,'quality.rule.'||c.rule_key,jsonb_build_object('enrollmentId',w.enrollment_id),marker
 from public.workflow_instances w join public.data_quality_rule_configs c on c.workspace_id=w.workspace_id and c.enabled
 where w.workspace_id=ws and public.workflow_instance_access(to_jsonb(w),false) and w.cancelled_at is null and
 ((c.rule_key='WORKFLOW_INSTANCE_BLOCKED' and public.workflow_projection(w.id)->>'status'='BLOCKED')
 or (c.rule_key='WORKFLOW_STEP_OVERDUE' and exists(select 1 from public.workflow_states(w.id) x where x.due_at<now() and x.status not in ('COMPLETED','WAIVED','CANCELLED')))
 or (c.rule_key='WORKFLOW_MISSING_CONTEXT' and exists(select 1 from public.workflow_states(w.id) x where x.context_warning is not null)))
 on conflict(workspace_id,rule_key,entity_type,entity_id) do update set last_seen_at=excluded.last_seen_at,status=case when data_quality_issues.status='DISMISSED' then 'DISMISSED' else 'OPEN' end;

 insert into public.data_quality_issues(workspace_id,rule_key,entity_type,entity_id,severity,title_key,details,last_seen_at)
 select ws,config.rule_key,'ORGANIZATION',o.id,config.severity,'quality.rule.STRATEGIC_ACCOUNT_WITHOUT_KEY_CONTACT',jsonb_build_object('reference',o.id),marker
 from public.organizations o join public.organization_business_profiles b on b.workspace_id=o.workspace_id and b.id=o.id
 join public.data_quality_rule_configs config on config.workspace_id=ws and config.rule_key='STRATEGIC_ACCOUNT_WITHOUT_KEY_CONTACT' and config.enabled
 where o.workspace_id=ws and public.customer_subject_access('ORGANIZATION',o.id,false) and (b.commercial_tier='S' and not exists(select 1 from public.organization_contact_intelligence i where i.organization_id=o.id and i.workspace_id=ws and i.key_contact_status='KEY'))
 on conflict(workspace_id,rule_key,entity_type,entity_id) do update set severity=excluded.severity,status=case when data_quality_issues.status='RESOLVED' then 'OPEN' else data_quality_issues.status end,details=excluded.details,last_seen_at=marker;

 insert into public.data_quality_issues(workspace_id,rule_key,entity_type,entity_id,severity,title_key,details,last_seen_at)
 select ws,config.rule_key,'ORGANIZATION',o.id,config.severity,'quality.rule.HIGH_TIER_ACCOUNT_WITHOUT_NEXT_ACTION',jsonb_build_object('reference',o.id),marker
 from public.organizations o join public.organization_business_profiles b on b.workspace_id=o.workspace_id and b.id=o.id
 join public.data_quality_rule_configs config on config.workspace_id=ws and config.rule_key='HIGH_TIER_ACCOUNT_WITHOUT_NEXT_ACTION' and config.enabled
 where o.workspace_id=ws and public.customer_subject_access('ORGANIZATION',o.id,false) and (b.commercial_tier in ('S','A') and trim(coalesce(b.next_action,''))='')
 on conflict(workspace_id,rule_key,entity_type,entity_id) do update set severity=excluded.severity,status=case when data_quality_issues.status='RESOLVED' then 'OPEN' else data_quality_issues.status end,details=excluded.details,last_seen_at=marker;

 insert into public.data_quality_issues(workspace_id,rule_key,entity_type,entity_id,severity,title_key,details,last_seen_at)
 select ws,config.rule_key,'ORGANIZATION',o.id,config.severity,'quality.rule.CHANNEL_ACCOUNT_WITHOUT_OWNER',jsonb_build_object('reference',o.id),marker
 from public.organizations o join public.organization_business_profiles b on b.workspace_id=o.workspace_id and b.id=o.id
 join public.data_quality_rule_configs config on config.workspace_id=ws and config.rule_key='CHANNEL_ACCOUNT_WITHOUT_OWNER' and config.enabled
 where o.workspace_id=ws and public.customer_subject_access('ORGANIZATION',o.id,false) and (o.owner_id is null and b.organization_type in ('SCHOOL','PARTNER'))
 on conflict(workspace_id,rule_key,entity_type,entity_id) do update set severity=excluded.severity,status=case when data_quality_issues.status='RESOLVED' then 'OPEN' else data_quality_issues.status end,details=excluded.details,last_seen_at=marker;

 insert into public.data_quality_issues(workspace_id,rule_key,entity_type,entity_id,severity,title_key,details,last_seen_at)
 select ws,config.rule_key,'CONTACT',c.id,config.severity,'quality.rule.KEY_CONTACT_WITHOUT_DECISION_ROLE',jsonb_build_object('reference',c.id),marker
 from public.organization_contact_intelligence i join public.contacts c on c.workspace_id=i.workspace_id and c.id=i.contact_id
 join public.data_quality_rule_configs config on config.workspace_id=ws and config.rule_key='KEY_CONTACT_WITHOUT_DECISION_ROLE' and config.enabled
 where i.workspace_id=ws and i.key_contact_status='KEY' and public.channel_intelligence_access('intelligence',to_jsonb(i),false) and (c.decision_role='UNKNOWN')
 on conflict(workspace_id,rule_key,entity_type,entity_id) do update set severity=excluded.severity,status=case when data_quality_issues.status='RESOLVED' then 'OPEN' else data_quality_issues.status end,details=excluded.details,last_seen_at=marker;

 insert into public.data_quality_issues(workspace_id,rule_key,entity_type,entity_id,severity,title_key,details,last_seen_at)
 select ws,config.rule_key,'CONTACT',c.id,config.severity,'quality.rule.KEY_CONTACT_WITHOUT_DECISION_POWER',jsonb_build_object('reference',c.id),marker
 from public.organization_contact_intelligence i join public.contacts c on c.workspace_id=i.workspace_id and c.id=i.contact_id
 join public.data_quality_rule_configs config on config.workspace_id=ws and config.rule_key='KEY_CONTACT_WITHOUT_DECISION_POWER' and config.enabled
 where i.workspace_id=ws and i.key_contact_status='KEY' and public.channel_intelligence_access('intelligence',to_jsonb(i),false) and (i.decision_power_score is null)
 on conflict(workspace_id,rule_key,entity_type,entity_id) do update set severity=excluded.severity,status=case when data_quality_issues.status='RESOLVED' then 'OPEN' else data_quality_issues.status end,details=excluded.details,last_seen_at=marker;
insert into public.data_quality_issues(workspace_id,rule_key,entity_type,entity_id,severity,title_key,details,last_seen_at)
 select ws,c.rule_key,'LEAD',l.id,c.severity,'quality.rule.'||c.rule_key,jsonb_build_object('reference',l.id),marker
 from public.leads l join public.organizations o on o.id=l.organization_id
 join public.data_quality_rule_configs c on c.workspace_id=ws and c.rule_key='CLAIMED_LEAD_WITHOUT_NEXT_ACTION' and c.enabled
 where o.workspace_id=ws and public.customer_subject_access('ORGANIZATION',o.id,false) and l.subject_type='SCHOOL' and public.lead_record_access(to_jsonb(l),false) and (l.owner_id is not null and l.status in ('NEW','QUALIFYING','QUALIFIED') and trim(l.next_action)='')
 on conflict(workspace_id,rule_key,entity_type,entity_id) do update set severity=excluded.severity,status=case when data_quality_issues.status='RESOLVED' then 'OPEN' else data_quality_issues.status end,details=excluded.details,last_seen_at=marker;

insert into public.data_quality_issues(workspace_id,rule_key,entity_type,entity_id,severity,title_key,details,last_seen_at)
 select ws,c.rule_key,'LEAD',l.id,c.severity,'quality.rule.'||c.rule_key,jsonb_build_object('reference',l.id),marker
 from public.leads l join public.organizations o on o.id=l.organization_id
 join public.data_quality_rule_configs c on c.workspace_id=ws and c.rule_key='QUALIFYING_SCHOOL_LEAD_WITHOUT_KEY_CONTACT' and c.enabled
 where o.workspace_id=ws and public.customer_subject_access('ORGANIZATION',o.id,false) and l.subject_type='SCHOOL' and public.lead_record_access(to_jsonb(l),false) and (l.status='QUALIFYING' and not exists(select 1 from public.organization_contact_intelligence i where i.organization_id=l.organization_id and i.key_contact_status='KEY'))
 on conflict(workspace_id,rule_key,entity_type,entity_id) do update set severity=excluded.severity,status=case when data_quality_issues.status='RESOLVED' then 'OPEN' else data_quality_issues.status end,details=excluded.details,last_seen_at=marker;

insert into public.data_quality_issues(workspace_id,rule_key,entity_type,entity_id,severity,title_key,details,last_seen_at)
 select ws,c.rule_key,'LEAD',l.id,c.severity,'quality.rule.'||c.rule_key,jsonb_build_object('reference',l.id),marker
 from public.leads l join public.organizations o on o.id=l.organization_id
 join public.data_quality_rule_configs c on c.workspace_id=ws and c.rule_key='QUALIFIED_SCHOOL_LEAD_WITHOUT_ORGANIZATION_OWNER' and c.enabled
 where o.workspace_id=ws and public.customer_subject_access('ORGANIZATION',o.id,false) and l.subject_type='SCHOOL' and public.lead_record_access(to_jsonb(l),false) and (l.status='QUALIFIED' and o.owner_id is null)
 on conflict(workspace_id,rule_key,entity_type,entity_id) do update set severity=excluded.severity,status=case when data_quality_issues.status='RESOLVED' then 'OPEN' else data_quality_issues.status end,details=excluded.details,last_seen_at=marker;

insert into public.data_quality_issues(workspace_id,rule_key,entity_type,entity_id,severity,title_key,details,last_seen_at)
 select ws,c.rule_key,'ORGANIZATION',o.id,c.severity,'quality.rule.'||c.rule_key,jsonb_build_object('reference',o.id),marker
 from public.organizations o join public.organization_business_profiles b on b.id=o.id
 join public.data_quality_rule_configs c on c.workspace_id=ws and c.rule_key='RECRUITMENT_ACTIVATED_WITHOUT_KEY_CONTACT' and c.enabled
 where o.workspace_id=ws and public.customer_subject_access('ORGANIZATION',o.id,false)  and (b.partnership_stage='RECRUITMENT_ACTIVATED' and not exists(select 1 from public.organization_contact_intelligence i where i.organization_id=o.id and i.key_contact_status='KEY'))
 on conflict(workspace_id,rule_key,entity_type,entity_id) do update set severity=excluded.severity,status=case when data_quality_issues.status='RESOLVED' then 'OPEN' else data_quality_issues.status end,details=excluded.details,last_seen_at=marker;

insert into public.data_quality_issues(workspace_id,rule_key,entity_type,entity_id,severity,title_key,details,last_seen_at)
 select ws,c.rule_key,'ORGANIZATION',o.id,c.severity,'quality.rule.'||c.rule_key,jsonb_build_object('reference',o.id),marker
 from public.organizations o join public.organization_business_profiles b on b.id=o.id
 join public.data_quality_rule_configs c on c.workspace_id=ws and c.rule_key='SOLUTION_PROPOSED_WITHOUT_OPPORTUNITY' and c.enabled
 where o.workspace_id=ws and public.customer_subject_access('ORGANIZATION',o.id,false)  and (b.partnership_stage='SOLUTION_PROPOSED' and not exists(select 1 from public.opportunities p where p.organization_id=o.id and p.stage not in ('WON','LOST')))
 on conflict(workspace_id,rule_key,entity_type,entity_id) do update set severity=excluded.severity,status=case when data_quality_issues.status='RESOLVED' then 'OPEN' else data_quality_issues.status end,details=excluded.details,last_seen_at=marker;

insert into public.data_quality_issues(workspace_id,rule_key,entity_type,entity_id,severity,title_key,details,last_seen_at)
 select ws,c.rule_key,'ORGANIZATION',o.id,c.severity,'quality.rule.'||c.rule_key,jsonb_build_object('reference',o.id),marker
 from public.organizations o join public.data_quality_rule_configs c on c.workspace_id=ws and c.rule_key='ACTIVE_CHANNEL_WITHOUT_AGREEMENT' and c.enabled
 where o.workspace_id=ws and public.channel_commercial_access(o.id,false) and (exists(select 1 from public.organization_business_profiles b where b.id=o.id and b.partnership_stage in ('ACTIVE','RECRUITMENT_ACTIVATED','ONGOING_ENABLEMENT')) and not exists(select 1 from public.channel_agreements a join public.channel_agreement_versions v on v.agreement_id=a.id where a.organization_id=o.id and v.status='ACTIVE' and v.effective_from<=public.current_business_date()::date and (v.effective_to is null or v.effective_to>=public.current_business_date()::date)))
 on conflict(workspace_id,rule_key,entity_type,entity_id) do update set severity=excluded.severity,status=case when data_quality_issues.status='RESOLVED' then 'OPEN' else data_quality_issues.status end,details=excluded.details,last_seen_at=marker;

insert into public.data_quality_issues(workspace_id,rule_key,entity_type,entity_id,severity,title_key,details,last_seen_at)
 select ws,c.rule_key,'ORGANIZATION',o.id,c.severity,'quality.rule.'||c.rule_key,jsonb_build_object('reference',o.id),marker
 from public.organizations o join public.data_quality_rule_configs c on c.workspace_id=ws and c.rule_key='ACTIVE_AGREEMENT_WITHOUT_RULE' and c.enabled
 where o.workspace_id=ws and public.channel_commercial_access(o.id,false) and (exists(select 1 from public.channel_agreements a join public.channel_agreement_versions v on v.agreement_id=a.id where a.organization_id=o.id and v.status='ACTIVE' and not exists(select 1 from public.channel_commission_rules r where r.agreement_version_id=v.id)))
 on conflict(workspace_id,rule_key,entity_type,entity_id) do update set severity=excluded.severity,status=case when data_quality_issues.status='RESOLVED' then 'OPEN' else data_quality_issues.status end,details=excluded.details,last_seen_at=marker;

insert into public.data_quality_issues(workspace_id,rule_key,entity_type,entity_id,severity,title_key,details,last_seen_at)
 select ws,c.rule_key,'ORGANIZATION',o.id,c.severity,'quality.rule.'||c.rule_key,jsonb_build_object('reference',o.id),marker
 from public.organizations o join public.data_quality_rule_configs c on c.workspace_id=ws and c.rule_key='COMMISSION_SHARED_CONTRACT_UNALLOCATED' and c.enabled
 where o.workspace_id=ws and public.channel_commercial_access(o.id,false) and (exists(select 1 from jsonb_array_elements(public.commission_eligibility(o.id)->'items') item join public.channel_agreement_versions v on v.id=(item->>'agreementVersionId')::uuid where v.status in ('ACTIVE','SUPERSEDED') and item->>'eligibilityStatus'='SHARED_CONTRACT_UNALLOCATED'))
 on conflict(workspace_id,rule_key,entity_type,entity_id) do update set severity=excluded.severity,status=case when data_quality_issues.status='RESOLVED' then 'OPEN' else data_quality_issues.status end,details=excluded.details,last_seen_at=marker;

insert into public.data_quality_issues(workspace_id,rule_key,entity_type,entity_id,severity,title_key,details,last_seen_at)
 select ws,c.rule_key,'ORGANIZATION',o.id,c.severity,'quality.rule.'||c.rule_key,jsonb_build_object('reference',o.id),marker
 from public.organizations o join public.data_quality_rule_configs c on c.workspace_id=ws and c.rule_key='COMMISSION_MULTIPLE_ELIGIBLE_CHANNELS' and c.enabled
 where o.workspace_id=ws and public.channel_commercial_access(o.id,false) and (exists(select 1 from jsonb_array_elements(public.commission_eligibility(o.id)->'items') mine where mine->>'eligibilityStatus'='ELIGIBLE' and exists(select 1 from public.channel_agreements other join public.organizations channel on channel.id=other.organization_id and public.channel_commercial_access(channel.id,false) cross join lateral jsonb_array_elements(public.commission_eligibility(channel.id,(mine->>'enrollmentId')::uuid)->'items') eligible where other.workspace_id=ws and other.organization_id<>o.id and eligible->>'eligibilityStatus'='ELIGIBLE')))
 on conflict(workspace_id,rule_key,entity_type,entity_id) do update set severity=excluded.severity,status=case when data_quality_issues.status='RESOLVED' then 'OPEN' else data_quality_issues.status end,details=excluded.details,last_seen_at=marker;

insert into public.data_quality_issues(workspace_id,rule_key,entity_type,entity_id,severity,title_key,details,last_seen_at)
 select ws,c.rule_key,'ORGANIZATION',o.id,c.severity,'quality.rule.'||c.rule_key,jsonb_build_object('reference',o.id),marker
 from public.organizations o join public.data_quality_rule_configs c on c.workspace_id=ws and c.rule_key='APPROVED_SETTLEMENT_NOT_PAID' and c.enabled
 where o.workspace_id=ws and public.channel_commercial_access(o.id,false) and (exists(select 1 from public.commission_settlements s where s.organization_id=o.id and s.workspace_id=ws and s.status='APPROVED'))
 on conflict(workspace_id,rule_key,entity_type,entity_id) do update set severity=excluded.severity,status=case when data_quality_issues.status='RESOLVED' then 'OPEN' else data_quality_issues.status end,details=excluded.details,last_seen_at=marker;

update public.data_quality_issues issue set status='RESOLVED',resolution_note='AUTO_RESOLVED',resolved_at=now(),resolved_by=app_auth.current_user_id()
  where issue.workspace_id=ws and issue.status in ('OPEN','ASSIGNED') and issue.last_seen_at<marker
    and issue.rule_key in (select rule_key from public.data_quality_rule_configs where workspace_id=ws);
  select count(*) into affected from public.data_quality_issues where workspace_id=ws and status in ('OPEN','ASSIGNED');
  return affected;
end;
$$;
create function public.seed_commission_quality_rules() returns trigger language plpgsql security definer set search_path=public as $$begin
 insert into public.data_quality_rule_configs(workspace_id,rule_key,severity,enabled) select new.id,k,'MEDIUM',true from unnest(array['ACTIVE_CHANNEL_WITHOUT_AGREEMENT','ACTIVE_AGREEMENT_WITHOUT_RULE','COMMISSION_SHARED_CONTRACT_UNALLOCATED','COMMISSION_MULTIPLE_ELIGIBLE_CHANNELS','APPROVED_SETTLEMENT_NOT_PAID']) k on conflict do nothing;return new;
end $$;
revoke all on function public.seed_commission_quality_rules() from public,crm_app,crm_system;
create trigger seed_commission_quality after insert on public.workspaces for each row execute function public.seed_commission_quality_rules();
-- Only the established privacy worker can export retained entries scoped by personal reference.
grant select on public.commission_accruals to crm_worker;
