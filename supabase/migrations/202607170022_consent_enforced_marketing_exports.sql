-- Consent-enforced marketing export and approval support for phase-two workflows.

alter table public.approval_requests drop constraint if exists approval_requests_request_type_check;
alter table public.approval_requests add constraint approval_requests_request_type_check check (request_type in ('CONTRACT_SIGN','CONTRACT_EXPORT','PERFORMANCE_SUMMARY','PERFORMANCE_ALLOCATION','QUOTE_DISCOUNT','REFUND','MARKETING_CONTACT_EXPORT'));
alter table public.generated_jobs drop constraint if exists generated_jobs_job_type_check;
alter table public.generated_jobs add constraint generated_jobs_job_type_check check (job_type in ('CONTRACT_EXPORT','PERFORMANCE_SUMMARY','MARKETING_CONTACT_EXPORT'));

create or replace function public.set_approval_required_role()
returns trigger language plpgsql set search_path=public
as $$ begin new.required_role:=case when new.request_type in ('CONTRACT_EXPORT','MARKETING_CONTACT_EXPORT') then 'SUPER_ADMIN' else 'ADMIN' end;return new;end; $$;

create or replace function public.create_approval(request_kind text, object_type text, object_id text, business_reason text)
returns public.approval_requests language plpgsql security definer set search_path=public
as $$
declare created public.approval_requests;next_number text;object_uuid uuid;ws uuid:=public.current_workspace_id();
begin
  if auth.uid() is null or ws is null or nullif(trim(business_reason),'') is null then raise exception 'approval_not_authorized'; end if;
  if request_kind in ('CONTRACT_SIGN','CONTRACT_EXPORT') then
    if object_type<>'CONTRACT' then raise exception 'approval_invalid_object'; end if;begin object_uuid:=object_id::uuid;exception when invalid_text_representation then raise exception 'approval_invalid_object';end;if not exists(select 1 from public.contracts where id=object_uuid and workspace_id=ws) then raise exception 'approval_object_not_found';end if;
  elsif request_kind='PERFORMANCE_ALLOCATION' then
    if object_type<>'PERFORMANCE_TARGET' then raise exception 'approval_invalid_object';end if;begin object_uuid:=object_id::uuid;exception when invalid_text_representation then raise exception 'approval_invalid_object';end;if not exists(select 1 from public.performance_targets where id=object_uuid and workspace_id=ws) then raise exception 'approval_object_not_found';end if;
  elsif request_kind='PERFORMANCE_SUMMARY' then if object_type<>'PERFORMANCE_SUMMARY' or object_id!~'^[a-zA-Z0-9_-]{3,80}$' then raise exception 'approval_invalid_object';end if;
  elsif request_kind='QUOTE_DISCOUNT' then if object_type<>'QUOTE' then raise exception 'approval_invalid_object';end if;begin object_uuid:=object_id::uuid;exception when invalid_text_representation then raise exception 'approval_invalid_object';end;if not exists(select 1 from public.quotes where id=object_uuid and workspace_id=ws and status='DRAFT') then raise exception 'approval_object_not_found';end if;
  elsif request_kind='REFUND' then if object_type<>'REFUND' then raise exception 'approval_invalid_object';end if;begin object_uuid:=object_id::uuid;exception when invalid_text_representation then raise exception 'approval_invalid_object';end;if not exists(select 1 from public.refunds where id=object_uuid and workspace_id=ws and status='PENDING_APPROVAL') then raise exception 'approval_object_not_found';end if;
  elsif request_kind='MARKETING_CONTACT_EXPORT' then if object_type<>'MARKETING_CONTACT_EXPORT' or object_id!~'^[A-Z]+:[A-Z]+:[a-f0-9-]{36}$' then raise exception 'approval_invalid_object';end if;
  else raise exception 'approval_invalid_type';end if;
  next_number:='APR-'||to_char(clock_timestamp(),'YYMMDD')||'-'||lpad(nextval('public.approval_actions_id_seq')::text,6,'0');
  insert into public.approval_requests(workspace_id,request_number,request_type,business_object_type,business_object_id,requester_id,reason,expires_at) values(ws,next_number,request_kind,object_type,object_id,auth.uid(),trim(business_reason),now()+interval '7 days') returning * into created;
  if request_kind='CONTRACT_SIGN' then update public.contracts set status='PENDING_APPROVAL',updated_at=now() where id=object_uuid and status in ('DRAFT','NEGOTIATING','RISK');end if;
  insert into public.approval_actions(approval_request_id,actor_id,action,comment) values(created.id,auth.uid(),'SUBMITTED',trim(business_reason));return created;
exception when unique_violation then raise exception 'approval_already_pending';end;$$;

create or replace function public.request_marketing_contact_export(export_channel text, business_reason text)
returns public.approval_requests language plpgsql security definer set search_path=public
as $$
declare object_id text;eligible integer;
begin
  if upper(export_channel) not in ('EMAIL','SMS','PHONE','WECHAT','WHATSAPP') then raise exception 'marketing_channel_invalid';end if;
  select count(*) into eligible from public.contacts c where c.workspace_id=public.current_workspace_id() and public.contact_channel_allowed(c.id,upper(export_channel),'MARKETING');
  if eligible=0 then raise exception 'marketing_no_eligible_contacts';end if;
  object_id:=upper(export_channel)||':MARKETING:'||gen_random_uuid();return public.create_approval('MARKETING_CONTACT_EXPORT','MARKETING_CONTACT_EXPORT',object_id,business_reason);
end;$$;

create or replace function public.marketing_export_rows(target_workspace uuid, export_channel text)
returns table(contact_id uuid,name_zh text,name_en text,email text,phone text,channel text,consent_source text,obtained_at timestamptz,retention_until date)
language sql stable security definer set search_path=public
as $$ select c.id,c.name_zh,c.name_en,c.email::text,c.phone,cc.channel,cc.source,cc.obtained_at,cc.retention_until from public.contacts c join public.contact_consents cc on cc.contact_id=c.id and cc.workspace_id=c.workspace_id where c.workspace_id=target_workspace and not c.do_not_contact and cc.channel=upper(export_channel) and cc.purpose='MARKETING' and cc.status='GRANTED' and (cc.retention_until is null or cc.retention_until>=current_date) order by c.name_en,c.id; $$;

create or replace function public.phase2_approval_side_effect()
returns trigger language plpgsql security definer set search_path=public
as $$
begin
  if old.status='PENDING' and new.status in ('APPROVED','REJECTED') and new.request_type='QUOTE_DISCOUNT' then update public.quotes set status=case when new.status='APPROVED' then 'APPROVED' else 'DRAFT' end,updated_at=now() where id=new.business_object_id::uuid and discount_approval_id=new.id;
  elsif old.status='PENDING' and new.status in ('APPROVED','REJECTED') and new.request_type='REFUND' then update public.refunds set status=case when new.status='APPROVED' then 'APPROVED' else 'REJECTED' end,approved_by=case when new.status='APPROVED' then new.decided_by end,updated_at=now() where id=new.business_object_id::uuid and approval_request_id=new.id;
  elsif old.status='PENDING' and new.status='APPROVED' and new.request_type='MARKETING_CONTACT_EXPORT' then insert into public.generated_jobs(workspace_id,approval_request_id,job_type,parameters,created_by) values(new.workspace_id,new.id,new.request_type,jsonb_build_object('channel',split_part(new.business_object_id,':',1),'purpose','MARKETING'),new.requester_id) on conflict(approval_request_id) do nothing;
  end if;return new;
end;$$;

revoke all on function public.request_marketing_contact_export(text,text),public.marketing_export_rows(uuid,text) from public,anon;
grant execute on function public.request_marketing_contact_export(text,text) to authenticated;
grant execute on function public.marketing_export_rows(uuid,text) to service_role;
