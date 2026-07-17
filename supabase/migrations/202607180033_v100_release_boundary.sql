-- v1.0.0 release boundary: prevent cross-workspace quote relationships,
-- require provider-side connection confirmation, and remove implicit
-- production-workspace defaults from readiness.

create or replace function public.create_quote_v100(
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
  ws uuid:=public.current_workspace_id();
begin
  if ws is null or auth.uid() is null then raise exception 'quote_not_authorized'; end if;
  if (target_product is null)=(target_bundle is null) then
    raise exception 'quote_product_or_bundle_required';
  end if;
  if target_product is not null and not exists(
    select 1 from public.products
    where id=target_product and workspace_id=ws and active=true
  ) then raise exception 'quote_product_invalid'; end if;
  if target_bundle is not null and not exists(
    select 1 from public.product_bundles
    where id=target_bundle and workspace_id=ws and active=true and effective_to is null
  ) then raise exception 'quote_bundle_invalid'; end if;
  if target_opportunity is not null and not exists(
    select 1 from public.opportunities
    where id=target_opportunity and workspace_id=ws
      and organization_id=target_organization
  ) then raise exception 'quote_opportunity_invalid'; end if;
  return public.create_quote_v091(
    quote_no,target_organization,target_opportunity,target_product,
    target_bundle,target_exchange_rate,quote_currency,quote_subtotal,
    quote_discount,valid_through,terms_zh,terms_en
  );
end;
$$;

revoke all on function public.create_quote_v091(
  text,uuid,uuid,uuid,uuid,uuid,text,numeric,numeric,date,text,text
) from public,anon,authenticated;
revoke all on function public.create_quote_v100(
  text,uuid,uuid,uuid,uuid,uuid,text,numeric,numeric,date,text,text
) from public,anon;
grant execute on function public.create_quote_v100(
  text,uuid,uuid,uuid,uuid,uuid,text,numeric,numeric,date,text,text
) to authenticated;

create or replace function public.configure_integration(
  target_provider text,next_status text,next_direction text,account_label text
)
returns public.integration_connections
language plpgsql security definer set search_path=public
as $$
declare
  result public.integration_connections;
  current_connection public.integration_connections;
  ws uuid:=public.current_workspace_id();
  normalized_status text:=upper(next_status);
begin
  if public.current_crm_role() not in ('SUPER_ADMIN','ADMIN')
    or upper(target_provider) not in ('MICROSOFT_365','GOOGLE_CALENDAR','EMAIL','E_SIGNATURE','ACCOUNTING')
    or normalized_status not in ('DISCONNECTED','CONNECTING','CONNECTED','DEGRADED','ACTION_REQUIRED')
    or upper(next_direction) not in ('NONE','IMPORT_ONLY','EXPORT_ONLY','BIDIRECTIONAL')
  then raise exception 'integration_configuration_invalid'; end if;
  select * into current_connection from public.integration_connections
    where workspace_id=ws and provider=upper(target_provider) for update;
  if not found then raise exception 'integration_not_found'; end if;
  if normalized_status in ('CONNECTED','DEGRADED')
    and current_connection.status not in ('CONNECTED','DEGRADED') then
    raise exception 'integration_connection_confirmation_required';
  end if;
  update public.integration_connections set
    status=normalized_status,sync_direction=upper(next_direction),
    external_account_label=trim(coalesce(account_label,'')),configured_by=auth.uid(),
    last_error=null,updated_at=now()
  where id=current_connection.id returning * into result;
  return result;
end;
$$;

create or replace function public.confirm_integration_connection(
  target_workspace uuid,target_provider text,account_label text,next_direction text
)
returns public.integration_connections
language plpgsql security definer set search_path=public
as $$
declare result public.integration_connections;
begin
  if upper(target_provider) not in ('MICROSOFT_365','GOOGLE_CALENDAR','EMAIL','E_SIGNATURE','ACCOUNTING')
    or upper(next_direction) not in ('IMPORT_ONLY','EXPORT_ONLY','BIDIRECTIONAL')
    or nullif(trim(account_label),'') is null then
    raise exception 'integration_confirmation_invalid';
  end if;
  update public.integration_connections set
    status='CONNECTED',sync_direction=upper(next_direction),
    external_account_label=trim(account_label),last_error=null,updated_at=now()
  where workspace_id=target_workspace and provider=upper(target_provider)
  returning * into result;
  if not found then raise exception 'integration_not_found'; end if;
  return result;
end;
$$;

revoke all on function public.confirm_integration_connection(uuid,text,text,text)
  from public,anon,authenticated;
grant execute on function public.confirm_integration_connection(uuid,text,text,text)
  to service_role;

drop function public.service_readiness_snapshot(uuid);
create function public.service_readiness_snapshot(target_workspace uuid)
returns jsonb
language plpgsql stable security definer set search_path=public
as $$
declare base jsonb;integration_failed integer;integration_stuck integer;missing integer;
begin
  if target_workspace is null then raise exception 'workspace_required'; end if;
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

revoke all on function public.service_readiness_snapshot(uuid)
  from public,anon,authenticated;
grant execute on function public.service_readiness_snapshot(uuid) to service_role;
