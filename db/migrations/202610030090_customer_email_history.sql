-- Read existing bulk-message keys, including historical sends. No message is requeued.
create or replace function public.customer_email_history_page(
  search_term text default '', message_purpose text default '', delivery_state text default '',
  page_number integer default 1, requested_page_size integer default 20
)
returns jsonb language sql stable security invoker
set search_path=public,app_auth,extensions
as $$
  with parameters as (
    select trim(left(coalesce(search_term,''),160)) query,
      coalesce(message_purpose,'') purpose, coalesce(delivery_state,'') delivery,
      greatest(1,least(coalesce(page_number,1),100000)) page,
      case when requested_page_size in (10,20,50) then requested_page_size else 20 end page_size
  ), filtered as materialized (
    select m.id, t.id thread_id, c.name_zh contact_zh, c.name_en contact_en,
      coalesce(c.email::text,'') email, t.subject, t.purpose,
      m.delivery_status, m.created_at, m.delivered_at
    from public.communication_messages m
    join public.communication_threads t on t.id=m.thread_id and t.workspace_id=m.workspace_id
    join public.contacts c on c.id=t.contact_id and c.workspace_id=t.workspace_id
    cross join parameters p
    where t.workspace_id=public.current_workspace_id()
      and public.is_workspace_member(t.workspace_id) and app_auth.current_user_id() is not null
      and t.channel='EMAIL' and m.direction='OUTBOUND'
      and starts_with(t.creation_request_key,'customer-email:')
      and m.idempotency_key=t.creation_request_key
      and (p.purpose='' or t.purpose=p.purpose)
      and (p.delivery='' or m.delivery_status=p.delivery)
      and (p.query='' or strpos(lower(concat_ws(' ',t.subject,m.body,c.name_zh,c.name_en,c.email::text)),lower(p.query))>0)
  ), counts as (select count(*) total from filtered), pagination as (
    select least(p.page,greatest(1,ceil(counts.total::numeric/p.page_size)::integer)) page,p.page_size,counts.total
    from parameters p cross join counts
  ), paged as (
    select f.* from filtered f order by f.created_at desc,f.id desc
    limit (select page_size from pagination) offset (select (page-1)*page_size from pagination)
  )
  select jsonb_build_object('items',coalesce((select jsonb_agg(jsonb_build_object(
    'id',id,'threadId',thread_id,'contactZh',contact_zh,'contactEn',contact_en,'email',email,
    'subject',subject,'purpose',purpose,'deliveryStatus',delivery_status,'createdAt',created_at,'deliveredAt',delivered_at
  ) order by created_at desc,id desc) from paged),'[]'::jsonb),'total',total,'page',page,'pageSize',page_size)
  from pagination;
$$;
revoke all on function public.customer_email_history_page(text,text,text,integer,integer) from public,crm_system,crm_worker;
grant execute on function public.customer_email_history_page(text,text,text,integer,integer) to crm_app;
