set search_path=public,app_auth,extensions;

-- Technical allocator only: no customer, financial or Revenue facts are stored here.
-- Global prefix counters also satisfy the legacy globally-unique approval number.
create table public.business_number_counters(prefix text primary key,last_value bigint not null check(last_value>0));
revoke all on public.business_number_counters from public,crm_app,crm_system,crm_worker;
alter table public.business_number_counters enable row level security;

create function public.business_initials(label text,fallback text) returns text
language sql immutable set search_path=public as $$
 select coalesce(nullif(left(string_agg(upper(left(word,1)),'' order by position),8),''),fallback)
 from regexp_split_to_table(regexp_replace(coalesce(label,''),'[^A-Za-z0-9 ]',' ','g'),' +') with ordinality words(word,position) where word<>'';
$$;

create function public.assign_business_number() returns trigger
language plpgsql security definer set search_path=public,app_auth,extensions as $$
declare r jsonb:=to_jsonb(new);field text:=tg_argv[0];kind text:=tg_argv[1];product uuid;organization uuid;contract uuid;
 product_name text;organization_name text;prefix text;sequence_value bigint;timezone text;number text;
begin
 -- Explicit imported/reference codes remain compatible. Native create surfaces use AUTO.
 -- Refund and approval numbers are always generated internally, never external references.
 if nullif(r->>field,'') is not null and r->>field<>'AUTO' and kind not in ('REFUND','APPROVAL') then return new;end if;
 product:=nullif(r->>'product_id','')::uuid;organization:=nullif(r->>'organization_id','')::uuid;contract:=nullif(r->>'contract_id','')::uuid;
 if contract is null and r->>'payment_id' is not null then select contract_id into contract from public.payments where id=(r->>'payment_id')::uuid and workspace_id=(r->>'workspace_id')::uuid;end if;
 if contract is not null then select coalesce(product,c.product_id),coalesce(organization,c.organization_id) into product,organization from public.contracts c where c.id=contract and c.workspace_id=(r->>'workspace_id')::uuid;end if;
 if product is not null then select name_en into product_name from public.products where id=product and workspace_id=(r->>'workspace_id')::uuid;end if;
 if kind='PRODUCT' then product_name:=r->>'name_en';end if;
 if organization is not null then select name_en into organization_name from public.organizations where id=organization and workspace_id=(r->>'workspace_id')::uuid;end if;
 prefix:=public.business_initials(product_name,kind)||'-'||public.business_initials(organization_name,kind);
 insert into public.business_number_counters values(prefix,1) on conflict on constraint business_number_counters_pkey do update set last_value=business_number_counters.last_value+1 returning last_value into sequence_value;
 select business_timezone into timezone from public.workspaces where id=(r->>'workspace_id')::uuid;
 number:=prefix||'-'||lpad(sequence_value::text,greatest(4,length(sequence_value::text)),'0')||'-'||to_char(clock_timestamp() at time zone coalesce(timezone,'UTC'),'YYYYMMDD');
 new:=jsonb_populate_record(new,jsonb_build_object(field,number));
 return new;
end $$;
revoke all on function public.assign_business_number() from public,crm_app,crm_system,crm_worker;
revoke all on function public.business_initials(text,text) from public,crm_app,crm_system,crm_worker;
create trigger assign_business_number before insert on public.products for each row execute function public.assign_business_number('code','PRODUCT');
create trigger assign_business_number before insert on public.product_bundles for each row execute function public.assign_business_number('code','BUNDLE');
create trigger assign_business_number before insert on public.product_cohorts for each row execute function public.assign_business_number('code','COHORT');
create trigger assign_business_number before insert on public.contracts for each row execute function public.assign_business_number('contract_number','CONTRACT');
create trigger assign_business_number before insert on public.quotes for each row execute function public.assign_business_number('quote_number','QUOTE');
create trigger assign_business_number before insert on public.students for each row execute function public.assign_business_number('student_number','STUDENT');
create trigger assign_business_number before insert on public.channel_agreements for each row execute function public.assign_business_number('agreement_code','AGREEMENT');
create trigger assign_business_number before insert on public.growth_campaigns for each row execute function public.assign_business_number('code','CAMPAIGN');
create trigger assign_business_number before insert on public.refunds for each row execute function public.assign_business_number('refund_number','REFUND');
create trigger assign_business_number before insert on public.approval_requests for each row execute function public.assign_business_number('request_number','APPROVAL');

-- Existing student creation inserts then enriches in one transaction. Preserve the
-- server-generated number when the enrichment does not supply a legacy import code.
create function public.preserve_generated_student_number() returns trigger language plpgsql set search_path=public as $$
begin
 if (nullif(new.student_number,'') is null or new.student_number='AUTO') and old.student_number ~ '^STUDENT-STUDENT-[0-9]+-[0-9]{8}$' then new.student_number:=old.student_number;end if;
 return new;
end $$;
create trigger preserve_generated_student_number before update on public.students for each row execute function public.preserve_generated_student_number();
revoke all on function public.preserve_generated_student_number() from public;
do $renewal_number$
declare definition text;
begin
 definition:=pg_get_functiondef('public.create_contract_renewal(uuid)'::regprocedure);
 definition:=replace(definition,'next_number:=source.contract_number||''-R''||extract(year from next_start)::integer;','next_number:=''AUTO'';');
 execute definition;
end $renewal_number$;
notify pgrst,'reload schema';
