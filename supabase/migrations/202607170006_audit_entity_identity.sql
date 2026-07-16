create or replace function public.audit_row_change()
returns trigger language plpgsql security definer set search_path=public
as $$
declare ws uuid; entity text; before_row jsonb; after_row jsonb;
begin
  before_row:=case when tg_op='INSERT' then null else to_jsonb(old) end;
  after_row:=case when tg_op='DELETE' then null else to_jsonb(new) end;
  ws:=coalesce((after_row->>'workspace_id')::uuid,(before_row->>'workspace_id')::uuid,public.current_workspace_id());
  entity:=coalesce(after_row->>'id',before_row->>'id',after_row->>'user_id',before_row->>'user_id');
  if entity is null then raise exception 'audit_entity_identity_missing for %',tg_table_name; end if;
  insert into public.audit_events(workspace_id,actor_id,entity_type,entity_id,action,before_data,after_data)
  values(ws,auth.uid(),tg_table_name,entity,tg_op,before_row,after_row);
  return coalesce(new,old);
end; $$;
