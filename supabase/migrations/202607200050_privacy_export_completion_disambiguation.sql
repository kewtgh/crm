-- Keep the public RPC signature stable while disambiguating the expiry argument
-- from privacy_executions.artifact_expires_at. PostgreSQL's schema linter treats
-- the original unqualified assignment as a runtime error.
create or replace function public.complete_privacy_export_execution(
  target_request uuid,target_job uuid,object_path text,artifact_expires_at timestamptz,
  exported_rows integer,artifact_sha256 text
)
returns void
language plpgsql security definer set search_path=public
as $$
declare execution public.privacy_executions;
begin
  if auth.role()<>'service_role' or exported_rows<1 or artifact_sha256!~'^[a-f0-9]{64}$' then
    raise exception 'privacy_export_completion_invalid';
  end if;
  select * into execution from public.privacy_executions
    where request_id=target_request and generated_job_id=target_job and status in ('QUEUED','PROCESSING') for update;
  if not found or not exists(
    select 1 from public.generated_jobs
    where id=target_job and privacy_request_id=target_request and status='READY'
  ) then
    raise exception 'privacy_export_execution_not_found';
  end if;
  update public.privacy_executions set
    status='COMPLETED',artifact_path=object_path,artifact_expires_at=$4,
    exported_row_count=exported_rows,receipt_sha256=artifact_sha256,
    result_summary=jsonb_build_object('artifactReady',true,'exportedRows',exported_rows,'format','XLSX'),
    completed_at=now(),updated_at=now()
  where id=execution.id;
  update public.privacy_requests set status='FULFILLED',fulfilled_at=now(),updated_at=now()
    where id=target_request and status='EXECUTING';
end;
$$;

revoke all on function public.complete_privacy_export_execution(uuid,uuid,text,timestamptz,integer,text)
  from public,anon,authenticated;
grant execute on function public.complete_privacy_export_execution(uuid,uuid,text,timestamptz,integer,text)
  to service_role;

notify pgrst,'reload schema';
