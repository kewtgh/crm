set search_path=public,app_auth,extensions;

-- People remain one canonical identity; their operational entry points are distinct.
alter table public.contacts drop constraint contacts_contact_type_check;
alter table public.contacts add constraint contacts_contact_type_check
 check(contact_type in ('CONTACT','PARENT','STUDENT','SCHOOL_STAFF','INSTITUTION_HEAD','PAYER'));

do $contact_type$
declare definition text; target regprocedure;
begin
 for target in select oid::regprocedure from pg_proc where pronamespace='public'::regnamespace and proname='update_contact_profile' loop
  definition:=pg_get_functiondef(target);
  definition:=replace(definition,'''CONTACT'',''PARENT'',''STUDENT'',''SCHOOL_STAFF'',''PAYER''','''CONTACT'',''PARENT'',''STUDENT'',''SCHOOL_STAFF'',''INSTITUTION_HEAD'',''PAYER''');
  execute definition;
 end loop;
end $contact_type$;

create function public.create_education_identity(kind text,data jsonb,p_request_key text) returns jsonb
language plpgsql security definer set search_path=public,app_auth,extensions as $$
declare ws uuid:=public.current_workspace_id();actor uuid:=app_auth.current_user_id();person uuid;result jsonb;
 receipt public.mutation_receipts;fingerprint text;zh text;en text;family uuid;
begin
 if actor is null or not public.is_workspace_member(ws) or coalesce(public.current_crm_role(),'') not in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER','SALES_SPECIALIST','SALES_SUPPORT') then raise exception 'PERMISSION_DENIED';end if;
 if kind not in ('STUDENT','FAMILY_MEMBER') or jsonb_typeof(data) is distinct from 'object' or length(coalesce(p_request_key,'')) not between 8 and 160 then raise exception 'INVALID_EDUCATION_INPUT';end if;
 fingerprint:=encode(digest(jsonb_build_object('kind',kind,'data',data)::text,'sha256'),'hex');
 perform pg_advisory_xact_lock(hashtextextended(ws::text||':education:'||p_request_key,0));
 select * into receipt from public.mutation_receipts where workspace_id=ws and request_key=p_request_key;
 if found then
  if receipt.created_by<>actor or receipt.operation<>'EDUCATION_IDENTITY' or receipt.result->>'request_hash'<>fingerprint then raise exception 'PAYLOAD_REUSE';end if;
  return receipt.result->'item';
 end if;
 family:=nullif(data->>'householdId','')::uuid;
 if family is not null and not public.import_reference_access('HOUSEHOLD',family,true) then raise exception 'INVALID_REFERENCE';end if;
 if kind='FAMILY_MEMBER' and family is null then raise exception 'INVALID_REFERENCE';end if;
 person:=nullif(data->>'personId','')::uuid;
 if person is not null then
  if not public.import_reference_access('CONTACT',person,false) then raise exception 'INVALID_REFERENCE';end if;
 else
  zh:=nullif(trim(data->>'nameZh'),'');en:=nullif(trim(data->>'nameEn'),'');
  if coalesce(zh,en) is null or length(coalesce(zh,''))>160 or length(coalesce(en,''))>160 then raise exception 'INVALID_EDUCATION_INPUT';end if;
  insert into public.contacts(workspace_id,name_zh,name_en,contact_type,owner_id,created_by,email,phone)
  values(ws,coalesce(zh,en),coalesce(en,zh),case kind when 'STUDENT' then 'STUDENT' else 'PARENT' end,actor,actor,nullif(data->>'email','')::citext,nullif(data->>'phone','')) returning id into person;
 end if;
 if kind='STUDENT' then
  result:=public.save_customer_record('STUDENTS',gen_random_uuid(),null,data||jsonb_build_object('personId',person,'currentGrade',data->>'grade','status','ACTIVE'));
 else
  result:=to_jsonb(public.save_household_member(family,person,coalesce(data->>'role','PARENT'),coalesce((data->>'primary')::boolean,false)));
 end if;
 insert into public.mutation_receipts(workspace_id,request_key,operation,result,created_by)
 values(ws,p_request_key,'EDUCATION_IDENTITY',jsonb_build_object('request_hash',fingerprint,'item',result),actor);
 return result;
end $$;
revoke all on function public.create_education_identity(text,jsonb,text) from public,crm_system,crm_worker;
grant execute on function public.create_education_identity(text,jsonb,text) to crm_app;

create view public.organization_contact_directory with(security_invoker=true) as
 select * from public.contacts where organization_id is not null or contact_type in ('CONTACT','SCHOOL_STAFF','INSTITUTION_HEAD');
grant select on public.organization_contact_directory to crm_app;

create or replace function public.contact_directory_metrics(search_query text,status_filter text,org_filter uuid,owner_filter uuid,type_filter text)
returns jsonb language sql stable security invoker set search_path=public,app_auth,extensions as $$
 select jsonb_build_object('total',count(*),'needsAttention',count(*) filter(where contact_status in ('NEW','ATTEMPTING','FOLLOW_UP')),'averageCompleteness',coalesce(round(avg(completeness)),0))
 from public.contacts where workspace_id=public.current_workspace_id() and archived_at is null
 and (organization_id is not null or contact_type in ('CONTACT','SCHOOL_STAFF','INSTITUTION_HEAD'))
 and (status_filter='all' or contact_status=status_filter) and (org_filter is null or organization_id=org_filter)
 and (owner_filter is null or owner_id=owner_filter) and (type_filter is null or contact_type=type_filter)
 and (coalesce(search_query,'')='' or name_zh ilike '%'||search_query||'%' or name_en ilike '%'||search_query||'%' or email ilike '%'||search_query||'%' or phone ilike '%'||search_query||'%');
$$;

-- Read under the same RLS and archived-subject visibility as the opportunity list.
create policy opportunity_visible_subject on public.opportunities as restrictive for select to crm_app
using (
 (organization_id is not null and exists(select 1 from public.organizations o where o.id=opportunities.organization_id and o.workspace_id=opportunities.workspace_id and o.archived_at is null))
 or (household_id is not null and exists(select 1 from public.households h where h.id=opportunities.household_id and h.workspace_id=opportunities.workspace_id and h.archived_at is null))
);
create function public.opportunity_pipeline_summary(currency_filter text default null) returns jsonb
language plpgsql stable security invoker set search_path=public,app_auth as $$
declare ws uuid:=public.current_workspace_id();ccy text;result jsonb;
begin
 if app_auth.current_user_id() is null or not public.is_workspace_member(ws) then raise exception 'PERMISSION_DENIED';end if;
 ccy:=coalesce(nullif(currency_filter,''),(select default_currency from public.workspaces where id=ws),'CNY');
 if ccy!~'^[A-Z]{3}$' then raise exception 'INVALID_CURRENCY';end if;
 with visible as materialized(select * from public.opportunities where workspace_id=ws and archived_at is null),
 stages as(select stage,count(*) count,sum(amount) amount,sum(amount*probability/100.0) weighted from visible where currency=ccy group by stage)
 select jsonb_build_object('currency',ccy,'currencies',coalesce((select jsonb_agg(currency order by currency) from (select distinct currency from visible union select ccy)c),'[]'),
 'funnel',coalesce((select jsonb_agg(to_jsonb(s) order by stage) from stages s),'[]')) into result;
 return result;
end $$;
revoke all on function public.opportunity_pipeline_summary(text) from public,crm_system,crm_worker;
grant execute on function public.opportunity_pipeline_summary(text) to crm_app;

notify pgrst,'reload schema';
