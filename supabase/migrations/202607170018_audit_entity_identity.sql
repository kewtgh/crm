-- Migration 007 added redaction but accidentally regressed the composite-key
-- identity fallback introduced in 006. Staff creation inserts user_preferences,
-- whose primary key is user_id rather than id.
create or replace function public.audit_row_change()
returns trigger language plpgsql security definer set search_path=public
as $$
declare ws uuid; entity text; before_row jsonb; after_row jsonb;
begin
  before_row:=case when tg_op='INSERT' then null else to_jsonb(old) end;
  after_row:=case when tg_op='DELETE' then null else to_jsonb(new) end;
  if tg_table_name='contacts' then before_row:=before_row-'email'-'phone'; after_row:=after_row-'email'-'phone'; end if;
  if tg_table_name='payments' then before_row:=before_row-'reference'; after_row:=after_row-'reference'; end if;
  ws:=coalesce((after_row->>'workspace_id')::uuid,(before_row->>'workspace_id')::uuid,public.current_workspace_id());
  entity:=coalesce(after_row->>'id',before_row->>'id',after_row->>'user_id',before_row->>'user_id');
  if entity is null then raise exception 'audit_entity_identity_missing for %',tg_table_name; end if;
  insert into public.audit_events(workspace_id,actor_id,entity_type,entity_id,action,before_data,after_data,request_id)
  values(ws,auth.uid(),tg_table_name,entity,tg_op,before_row,after_row,txid_current()::text);
  return coalesce(new,old);
end; $$;
