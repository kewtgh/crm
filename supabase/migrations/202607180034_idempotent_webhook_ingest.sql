-- v1.0.0: make webhook ingestion explicitly idempotent in PostgreSQL instead
-- of relying on transport-specific PostgREST preference handling.

create or replace function public.ingest_webhook_event(
  target_workspace uuid,target_provider text,target_event_id text,
  target_event_type text,event_payload jsonb,signature_hash text,
  envelope_hash text,event_signed_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare inserted_id uuid;existing_id uuid;
begin
  if not exists(select 1 from public.workspaces where id=target_workspace)
    or upper(target_provider) not in (
      'MICROSOFT_365','GOOGLE_CALENDAR','EMAIL','E_SIGNATURE','ACCOUNTING'
    )
    or nullif(trim(target_event_id),'') is null
    or char_length(target_event_id)>200
    or nullif(trim(target_event_type),'') is null
    or char_length(target_event_type)>200
    or jsonb_typeof(event_payload)<>'object'
    or signature_hash!~'^[a-f0-9]{64}$'
    or envelope_hash!~'^[a-f0-9]{64}$'
    or event_signed_at is null then
    raise exception 'webhook_event_invalid';
  end if;
  insert into public.webhook_inbox(
    workspace_id,provider,event_id,event_type,payload,signature_digest,
    canonical_digest,signed_at
  ) values(
    target_workspace,upper(target_provider),trim(target_event_id),
    trim(target_event_type),event_payload,signature_hash,envelope_hash,event_signed_at
  )
  on conflict(workspace_id,provider,event_id) do nothing
  returning id into inserted_id;
  if inserted_id is not null then
    return jsonb_build_object('id',inserted_id,'duplicate',false);
  end if;
  select id into existing_id from public.webhook_inbox
    where workspace_id=target_workspace and provider=upper(target_provider)
      and event_id=trim(target_event_id);
  return jsonb_build_object('id',existing_id,'duplicate',true);
end;
$$;

revoke all on function public.ingest_webhook_event(
  uuid,text,text,text,jsonb,text,text,timestamptz
) from public,anon,authenticated;
grant execute on function public.ingest_webhook_event(
  uuid,text,text,text,jsonb,text,text,timestamptz
) to service_role;
