create or replace function public.operational_retryable_jobs_page(
  page_number integer default 1,
  page_size integer default 10
)
returns jsonb
language plpgsql stable security definer set search_path=public
as $$
declare
  ws uuid:=public.current_workspace_id();
  result jsonb;
begin
  if public.current_crm_role() not in ('SUPER_ADMIN','ADMIN') or ws is null then
    raise exception 'operations_not_authorized';
  end if;
  if page_number < 1 or page_size not in (10,20,50) then
    raise exception 'invalid_pagination';
  end if;

  with jobs as materialized (
    select id::text id,'NOTIFICATION_OUTBOX'::text type,template_key::text label,status::text status,
      coalesce(last_error,'')::text error,updated_at "updatedAt"
    from public.notification_outbox where workspace_id=ws and status in ('FAILED','DEAD')
    union all
    select id::text,'CALENDAR_DELIVERIES',delivery_type::text,status::text,coalesce(last_error,'')::text,updated_at
    from public.calendar_deliveries where workspace_id=ws and status in ('FAILED','DEAD')
    union all
    select id::text,'GENERATED_JOBS',job_type::text,status::text,coalesce(error_message,'')::text,updated_at
    from public.generated_jobs where workspace_id=ws and status in ('FAILED','DEAD')
    union all
    select id::text,'REMINDERS',reminder_type::text,status::text,coalesce(last_error,'')::text,created_at
    from public.reminders where workspace_id=ws and status='FAILED'
    union all
    select id::text,'WEBHOOK_INBOX',(provider||' / '||event_type)::text,status::text,coalesce(last_error,'')::text,updated_at
    from public.webhook_inbox where workspace_id=ws and status in ('FAILED','DEAD')
    union all
    select id::text,'IDENTITY_REPAIR',target_user_id::text,status::text,coalesce(last_error,'')::text,updated_at
    from public.staff_identity_repair_jobs
    where workspace_id=ws and status in ('PENDING','FAILED','DEAD')
  ),
  page_rows as (
    select * from jobs
    order by "updatedAt" desc,id
    offset (page_number-1)*page_size
    limit page_size
  )
  select jsonb_build_object(
    'items',coalesce(
      (select jsonb_agg(to_jsonb(page_rows) order by "updatedAt" desc,id) from page_rows),
      '[]'::jsonb
    ),
    'total',(select count(*) from jobs),
    'page',page_number,
    'pageSize',page_size
  ) into result;

  return result;
end;
$$;

revoke all on function public.operational_retryable_jobs_page(integer,integer) from public,anon;
grant execute on function public.operational_retryable_jobs_page(integer,integer) to authenticated;
