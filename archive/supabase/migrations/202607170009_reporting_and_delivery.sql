-- Reporting definitions, immutable performance plans, and reliable notification delivery.

alter table public.contracts add column if not exists renewal_of_id uuid references public.contracts(id) on delete set null;
create unique index if not exists contracts_single_renewal_uidx on public.contracts(workspace_id,renewal_of_id) where renewal_of_id is not null;

create or replace function public.ensure_member_preferences()
returns trigger language plpgsql security definer set search_path=public
as $$ begin
  insert into public.user_preferences(user_id,workspace_id) values(new.user_id,new.workspace_id)
  on conflict(user_id) do nothing;
  return new;
end; $$;
drop trigger if exists workspace_member_preferences on public.workspace_memberships;
create trigger workspace_member_preferences after insert on public.workspace_memberships for each row execute procedure public.ensure_member_preferences();

create or replace function public.save_performance_plan(plan_id uuid, manager uuid, period_from date, period_to date, plan_currency text, plan_amount numeric, plan_allocations jsonb)
returns public.performance_targets language plpgsql security definer set search_path=public
as $$
declare target public.performance_targets; item jsonb; member public.sales_team_members; actor_role text:=public.current_crm_role(); actor_member uuid;
begin
  if auth.uid() is null or actor_role not in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER') then raise exception 'performance_not_authorized'; end if;
  select id into actor_member from public.sales_team_members where workspace_id=public.current_workspace_id() and auth_user_id=auth.uid() and active;
  if manager<>auth.uid() and actor_role not in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR') and not exists(
    select 1 from public.sales_team_members report where report.workspace_id=public.current_workspace_id() and report.auth_user_id=manager and report.manager_member_id=actor_member and report.active
  ) then raise exception 'performance_manager_scope'; end if;
  if period_to<period_from or plan_amount<=0 or plan_currency !~ '^[A-Z]{3}$' then raise exception 'performance_invalid_target'; end if;
  if plan_id is null then
    insert into public.performance_targets(workspace_id,manager_id,period_start,period_end,currency,target_amount,status,created_by)
    values(public.current_workspace_id(),manager,period_from,period_to,plan_currency,plan_amount,'DRAFT',auth.uid()) returning * into target;
  else
    select * into target from public.performance_targets where id=plan_id and workspace_id=public.current_workspace_id() for update;
    if not found or target.status<>'DRAFT' then raise exception 'performance_plan_locked'; end if;
    update public.performance_targets set manager_id=manager,period_start=period_from,period_end=period_to,currency=plan_currency,target_amount=plan_amount,version=version+1,updated_at=now() where id=plan_id returning * into target;
    delete from public.performance_allocations where target_id=target.id;
  end if;
  for item in select * from jsonb_array_elements(coalesce(plan_allocations,'[]'::jsonb)) loop
    select * into member from public.sales_team_members where id=(item->>'contributorMemberId')::uuid and workspace_id=target.workspace_id and active;
    if not found or member.role not in ('SALES_SPECIALIST','SALES_SUPPORT') then raise exception 'performance_invalid_contributor'; end if;
    if actor_role='SALES_MANAGER' and member.manager_member_id<>actor_member then raise exception 'performance_contributor_scope'; end if;
    insert into public.performance_allocations(target_id,contributor_member_id,contributor_role,attribution_type,allocated_amount,created_by)
    values(target.id,member.id,member.role,upper(item->>'attributionType'),(item->>'amount')::numeric,auth.uid());
  end loop;
  return target;
end; $$;

create or replace function public.contract_summary()
returns jsonb language sql stable security definer set search_path=public
as $$
  select jsonb_build_object(
    'validCount',count(*) filter(where status not in ('CANCELLED','EXPIRED')),
    'renewalCount',count(*) filter(where status in ('ACTIVE','RENEWAL_PREP','NEGOTIATING','RISK') and end_date between current_date and current_date+90),
    'under30Count',count(*) filter(where status in ('ACTIVE','RENEWAL_PREP','NEGOTIATING','RISK') and end_date between current_date and current_date+30),
    'riskCount',count(*) filter(where status='RISK'),
    'renewalByCurrency',coalesce((select jsonb_object_agg(currency,total) from (
      select currency,sum(contract_value) total from public.contracts
      where workspace_id=public.current_workspace_id() and status in ('ACTIVE','RENEWAL_PREP','NEGOTIATING','RISK') and end_date between current_date and current_date+90 group by currency
    ) totals),'{}'::jsonb)
  ) from public.contracts where workspace_id=public.current_workspace_id() and public.current_crm_role()<>'';
$$;
revoke all on function public.contract_summary() from public;
grant execute on function public.contract_summary() to authenticated;

create or replace function public.consumption_report(report_period text, report_currency text default null)
returns jsonb language plpgsql stable security definer set search_path=public
as $$
declare ws uuid:=public.current_workspace_id(); start_date date; end_date date; previous_start date; selected_currency text; total numeric:=0; previous_total numeric:=0; orders bigint:=0; renewal_rate numeric:=0; result jsonb;
begin
  if ws is null or report_period not in ('month','quarter','year') then raise exception 'analytics_invalid_request'; end if;
  if report_period='month' then start_date:=date_trunc('month',current_date)::date; end_date:=(start_date+interval '1 month')::date; previous_start:=(start_date-interval '1 month')::date;
  elsif report_period='quarter' then start_date:=date_trunc('quarter',current_date)::date; end_date:=(start_date+interval '3 months')::date; previous_start:=(start_date-interval '3 months')::date;
  else start_date:=date_trunc('year',current_date)::date; end_date:=(start_date+interval '1 year')::date; previous_start:=(start_date-interval '1 year')::date; end if;
  select coalesce(upper(report_currency),w.default_currency) into selected_currency from public.workspaces w where w.id=ws;
  if selected_currency !~ '^[A-Z]{3}$' then raise exception 'analytics_invalid_currency'; end if;
  select coalesce(sum(amount),0),count(*) into total,orders from public.payments where workspace_id=ws and status='CONFIRMED' and currency=selected_currency and paid_at>=start_date and paid_at<end_date;
  select coalesce(sum(amount),0) into previous_total from public.payments where workspace_id=ws and status='CONFIRMED' and currency=selected_currency and paid_at>=previous_start and paid_at<start_date;
  select case when count(*)=0 then 0 else round(100.0*count(*) filter(where exists(select 1 from public.contracts child where child.renewal_of_id=base.id and child.status in ('ACTIVE','RENEWAL_PREP','NEGOTIATING')))/count(*),1) end
    into renewal_rate from public.contracts base where base.workspace_id=ws and base.end_date>=start_date and base.end_date<end_date and base.status<>'CANCELLED';
  select jsonb_build_object(
    'period',report_period,'label',start_date::text||' — '||(end_date-1)::text,'currency',selected_currency,
    'availableCurrencies',coalesce((select jsonb_agg(currency order by currency) from (select distinct currency from public.payments where workspace_id=ws and status='CONFIRMED') c),'[]'::jsonb),
    'total',total,'orders',orders,'average',case when orders=0 then 0 else round(total/orders) end,'renewal',renewal_rate,
    'compare',case when previous_total=0 then 0 else round(100*(total-previous_total)/previous_total,1) end,
    'newCustomerTotal',coalesce((select sum(p.amount) from public.payments p join public.contracts c on c.id=p.contract_id where p.workspace_id=ws and p.status='CONFIRMED' and p.currency=selected_currency and p.paid_at>=start_date and p.paid_at<end_date and not exists(
      select 1 from public.payments older join public.contracts older_c on older_c.id=older.contract_id where older.status='CONFIRMED' and older.workspace_id=ws and older_c.organization_id=c.organization_id and older.paid_at<start_date
    )),0),
    'trend',coalesce((select jsonb_agg(jsonb_build_array(label,amount) order by sort_key) from (
      select case when report_period='month' then 'W'||(floor((extract(day from paid_at)::int-1)/7)+1)::int::text when report_period='quarter' then to_char(paid_at,'YYYY-MM') else 'Q'||extract(quarter from paid_at)::int::text end label,
        case when report_period='month' then floor((extract(day from paid_at)::int-1)/7)+1 when report_period='quarter' then extract(month from paid_at) else extract(quarter from paid_at) end sort_key,
        sum(amount) amount from public.payments where workspace_id=ws and status='CONFIRMED' and currency=selected_currency and paid_at>=start_date and paid_at<end_date group by 1,2
    ) trend_rows),'[]'::jsonb),
    'productMix',coalesce((select jsonb_agg(jsonb_build_object('nameZh',name_zh,'nameEn',name_en,'value',amount,'customers',customers) order by amount desc) from (
      select coalesce(pr.name_zh,'其他') name_zh,coalesce(pr.name_en,'Other') name_en,sum(p.amount) amount,count(distinct c.organization_id) customers
      from public.payments p join public.contracts c on c.id=p.contract_id left join public.products pr on pr.id=p.product_id
      where p.workspace_id=ws and p.status='CONFIRMED' and p.currency=selected_currency and p.paid_at>=start_date and p.paid_at<end_date group by pr.id,pr.name_zh,pr.name_en
    ) mix),'[]'::jsonb),
    'topCustomers',coalesce((select jsonb_agg(jsonb_build_object('nameZh',name_zh,'nameEn',name_en,'customerType',lower(organization_type),'productsZh',products_zh,'productsEn',products_en,'amount',amount) order by amount desc) from (
      select o.id,o.name_zh,o.name_en,o.organization_type,sum(p.amount) amount,array_remove(array_agg(distinct pr.name_zh),null) products_zh,array_remove(array_agg(distinct pr.name_en),null) products_en
      from public.payments p join public.contracts c on c.id=p.contract_id join public.organizations o on o.id=c.organization_id left join public.products pr on pr.id=p.product_id
      where p.workspace_id=ws and p.status='CONFIRMED' and p.currency=selected_currency and p.paid_at>=start_date and p.paid_at<end_date group by o.id,o.name_zh,o.name_en,o.organization_type order by amount desc limit 10
    ) customers),'[]'::jsonb)
  ) into result;
  return result;
end; $$;
revoke all on function public.consumption_report(text,text) from public;
grant execute on function public.consumption_report(text,text) to authenticated;

alter table public.notification_outbox add column if not exists attempts integer not null default 0;
alter table public.notification_outbox add column if not exists next_attempt_at timestamptz not null default now();
alter table public.notification_outbox add column if not exists last_error text;
alter table public.notification_outbox add column if not exists delivered_at timestamptz;
alter table public.notification_outbox add column if not exists updated_at timestamptz not null default now();
alter table public.notification_outbox drop constraint if exists notification_outbox_status_check;
alter table public.notification_outbox add constraint notification_outbox_status_check check(status in ('PENDING','SENDING','SENT','FAILED','DEAD'));
create index if not exists notification_outbox_due_idx on public.notification_outbox(status,next_attempt_at);

create or replace function public.process_due_reminders(batch_size integer default 50)
returns integer language plpgsql security definer set search_path=public
as $$
declare processed integer:=0; item public.reminders; preference public.user_preferences; wants_email boolean; wants_in_app boolean; local_time time; quiet boolean;
begin
  for item in select * from public.reminders where status in ('PENDING','FAILED') and scheduled_at<=now() and attempts<5 order by scheduled_at for update skip locked limit greatest(1,least(batch_size,200)) loop
    select * into preference from public.user_preferences where user_id=item.recipient_id;
    local_time:=(now() at time zone coalesce(preference.timezone,'UTC'))::time;
    quiet:=preference.quiet_hours_start is not null and preference.quiet_hours_end is not null and case when preference.quiet_hours_start<=preference.quiet_hours_end then local_time>=preference.quiet_hours_start and local_time<preference.quiet_hours_end else local_time>=preference.quiet_hours_start or local_time<preference.quiet_hours_end end;
    if quiet then update public.reminders set scheduled_at=now()+interval '30 minutes' where id=item.id; continue; end if;
    update public.reminders set status='PROCESSING',attempts=attempts+1 where id=item.id;
    wants_in_app:=coalesce((preference.notifications->'tasks'->>'inApp')::boolean,true);
    wants_email:=coalesce((preference.notifications->'tasks'->>'email')::boolean,false);
    if wants_in_app then insert into public.user_notifications(workspace_id,user_id,kind,title_key,body_key,values,source_type,source_id) values(item.workspace_id,item.recipient_id,'REMINDER','notification.reminder.title','notification.reminder.body',jsonb_build_object('type',item.reminder_type),item.source_type,item.source_id); end if;
    if wants_email then insert into public.notification_outbox(workspace_id,recipient_id,channel,template_key,payload) values(item.workspace_id,item.recipient_id,'EMAIL','reminder',jsonb_build_object('reminderId',item.id,'locale',coalesce(preference.locale,'zh-CN'),'timezone',coalesce(preference.timezone,'UTC'))); end if;
    update public.reminders set status='DELIVERED',delivered_at=now(),last_error=null where id=item.id;
    processed:=processed+1;
  end loop;
  return processed;
end; $$;

create or replace function public.claim_notification_outbox(batch_size integer default 20)
returns setof public.notification_outbox language plpgsql security definer set search_path=public
as $$ begin
  return query update public.notification_outbox o set status='SENDING',attempts=attempts+1,updated_at=now()
  where o.id in (select id from public.notification_outbox where status in ('PENDING','FAILED') and next_attempt_at<=now() and attempts<8 order by created_at for update skip locked limit greatest(1,least(batch_size,100))) returning o.*;
end; $$;
create or replace function public.complete_notification_outbox(job_id uuid)
returns void language sql security definer set search_path=public as $$ update public.notification_outbox set status='SENT',delivered_at=now(),last_error=null,updated_at=now() where id=job_id; $$;
create or replace function public.fail_notification_outbox(job_id uuid, failure text)
returns void language sql security definer set search_path=public as $$ update public.notification_outbox set status=case when attempts>=8 then 'DEAD' else 'FAILED' end,last_error=left(failure,500),next_attempt_at=now()+make_interval(mins=>least(360,power(2,attempts)::int)),updated_at=now() where id=job_id; $$;
revoke all on function public.claim_notification_outbox(integer),public.complete_notification_outbox(uuid),public.fail_notification_outbox(uuid,text) from public,anon,authenticated;
grant execute on function public.claim_notification_outbox(integer),public.complete_notification_outbox(uuid),public.fail_notification_outbox(uuid,text) to service_role;
