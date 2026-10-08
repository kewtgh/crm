-- Preserve explicit imported identifiers; automatic allocation skips occupied numbers.
set search_path=public,app_auth,extensions;

create or replace function public.assign_business_number() returns trigger
language plpgsql security definer set search_path=public,app_auth,extensions as $$
declare r jsonb:=to_jsonb(new);field text:=tg_argv[0];kind text:=tg_argv[1];product uuid;organization uuid;contract uuid;
 product_name text;organization_name text;prefix text;sequence_value bigint;timezone text;number text;number_exists boolean;
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
 select business_timezone into timezone from public.workspaces where id=(r->>'workspace_id')::uuid;
 loop
  insert into public.business_number_counters values(prefix,1) on conflict on constraint business_number_counters_pkey do update set last_value=business_number_counters.last_value+1 returning last_value into sequence_value;
  number:=prefix||'-'||lpad(sequence_value::text,greatest(4,length(sequence_value::text)),'0')||'-'||to_char(clock_timestamp() at time zone coalesce(timezone,'UTC'),'YYYYMMDD');
  -- Trigger-owned table/column identifiers, never caller-provided lookup names.
  -- Include archived and other workspace rows because legacy uniqueness may be global.
  execute format('select exists(select 1 from %I.%I where %I=$1)',tg_table_schema,tg_table_name,field) into number_exists using number;
  exit when not number_exists;
 end loop;
 new:=jsonb_populate_record(new,jsonb_build_object(field,number));
 return new;
end $$;
revoke all on function public.assign_business_number() from public,crm_app,crm_system,crm_worker;
revoke all on function public.business_initials(text,text) from public,crm_app,crm_system,crm_worker;

notify pgrst,'reload schema';
