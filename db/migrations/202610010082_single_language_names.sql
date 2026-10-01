-- Forward-only compatibility for single-language names normalized by the API.
-- Both stored display fields remain non-empty; never truncate a supplied name.
set search_path=public,app_auth,extensions;

alter table public.automation_rules drop constraint automation_rules_name_zh_check;
alter table public.automation_rules drop constraint automation_rules_name_en_check;
alter table public.automation_rules add constraint automation_rules_name_zh_check check(length(trim(name_zh)) between 1 and 160);
alter table public.automation_rules add constraint automation_rules_name_en_check check(length(trim(name_en)) between 1 and 160);

create or replace function public.create_product_bundle(
  bundle_code text,bundle_name_zh text,bundle_name_en text,bundle_items jsonb
)
returns public.product_bundles
language plpgsql
security definer
set search_path=public,app_auth,extensions
as $$
declare
  ws uuid:=public.current_workspace_id();
  result public.product_bundles;
  previous public.product_bundles;
  item jsonb;
  product public.products;
  quantity_value numeric;
  ceiling_value numeric;
  next_version integer;
begin
  if app_auth.current_user_id() is null
    or public.current_crm_role() not in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR')
    or ws is null or upper(trim(bundle_code))!~'^[A-Z0-9-]{2,40}$'
    or char_length(trim(bundle_name_zh)) not between 1 and 120
    or char_length(trim(bundle_name_en)) not between 1 and 120
    or jsonb_typeof(bundle_items)<>'array'
    or jsonb_array_length(bundle_items) not between 1 and 50 then
    raise exception 'product_bundle_invalid';
  end if;
  select * into previous from public.product_bundles
    where workspace_id=ws and code=upper(trim(bundle_code)) and effective_to is null for update;
  select coalesce(max(version),0)+1 into next_version from public.product_bundles
    where workspace_id=ws and code=upper(trim(bundle_code));
  if previous.id is not null then
    update public.product_bundles set
      active=false,effective_to=now(),updated_at=now() where id=previous.id;
  end if;
  insert into public.product_bundles(
    workspace_id,code,name_zh,name_en,version,effective_from,supersedes_id,created_by
  ) values(
    ws,upper(trim(bundle_code)),trim(bundle_name_zh),trim(bundle_name_en),
    next_version,now(),previous.id,app_auth.current_user_id()
  ) returning * into result;
  for item in select value from jsonb_array_elements(bundle_items) loop
    quantity_value:=(item->>'quantity')::numeric;
    ceiling_value:=(item->>'discountCeiling')::numeric;
    select * into product from public.products
      where id=(item->>'productId')::uuid and workspace_id=ws and active=true;
    if not found or quantity_value<=0 or quantity_value>1000
      or ceiling_value<0 or ceiling_value>100
      or jsonb_typeof(item->'optional')<>'boolean' then
      raise exception 'product_bundle_item_invalid';
    end if;
    insert into public.product_bundle_items(
      bundle_id,product_id,quantity,optional,discount_ceiling
    ) values(
      result.id,product.id,quantity_value,(item->>'optional')::boolean,ceiling_value
    );
  end loop;
  return result;
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception 'product_bundle_item_invalid';
end;
$$;
