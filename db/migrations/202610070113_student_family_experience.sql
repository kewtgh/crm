-- Student-centered family search and authorized annual progression.
-- Existing historical migrations remain unchanged.
alter table public.progression_batches alter column created_by drop not null;
alter table public.progression_batches add column execution_source text not null default 'MANUAL' check(execution_source in ('MANUAL','ANNUAL'));
alter table public.student_academic_records alter column created_by drop not null;
alter table public.student_academic_records add column progression_batch_id uuid references public.progression_batches(id);
create or replace function public.preview_student_progression_internal( target_workspace uuid,
  from_year text,to_year text,p_idempotency_key text
) returns public.progression_batches
language plpgsql security definer set search_path=public,app_auth,extensions
as $$
declare result public.progression_batches; ws uuid:=target_workspace;
begin
  if nullif(trim(from_year),'') is null or nullif(trim(to_year),'') is null
    or nullif(trim(p_idempotency_key),'') is null or trim(from_year)=trim(to_year) then
    raise exception 'progression_invalid';
  end if;
  insert into public.progression_batches(
    workspace_id,from_academic_year,to_academic_year,status,idempotency_key,previewed_at
  ) values(
    ws,trim(from_year),trim(to_year),'PREVIEWED',trim(p_idempotency_key),now()
  )
  on conflict(workspace_id,idempotency_key) do update
    set previewed_at=public.progression_batches.previewed_at
  returning * into result;

  insert into public.progression_batch_items(
    workspace_id,batch_id,student_id,from_grade,to_grade,action,selected,
    status,error_code,reason,student_updated_at
  )
  select
    ws,result.id,student.id,student.current_grade,
    coalesce(rule.to_grade,student.current_grade),
    coalesce(rule.action,'HOLD'),
    rule.id is not null,
    'PENDING',
    case when rule.id is null then 'GRADE_MAPPING_REQUIRED' end,
    case when rule.id is null then 'No active grade progression rule' else '' end,
    student.updated_at
  from public.students student
  left join public.grade_progression_rules rule
    on rule.workspace_id=student.workspace_id and rule.active
    and lower(trim(rule.from_grade))=lower(trim(student.current_grade))
  where student.workspace_id=ws and student.status='ACTIVE'
    and student.academic_year=trim(from_year)
  on conflict(batch_id,student_id) do nothing;
  return result;
end;
$$;
create or replace function public.apply_student_progression_internal(target_workspace uuid,target_batch uuid,p_idempotency_key text)
returns public.progression_batches language plpgsql security definer set search_path=public,app_auth,extensions
as $$
declare
  result public.progression_batches;
  item public.progression_batch_items;
  academic public.student_academic_records;
  has_academic boolean;
  failed_count integer:=0;
begin
  if nullif(trim(p_idempotency_key),'') is null then raise exception 'progression_idempotency_required'; end if;
  select * into result from public.progression_batches
    where id=target_batch and workspace_id=target_workspace for update;
  if not found then raise exception 'progression_not_found'; end if;
  if result.status in ('APPLIED','PARTIAL_FAILED') then return result; end if;
  if result.status<>'PREVIEWED' then raise exception 'progression_not_ready'; end if;
  if result.apply_idempotency_key is not null and result.apply_idempotency_key<>trim(p_idempotency_key) then
    raise exception 'progression_apply_in_progress';
  end if;
  update public.progression_batches set apply_idempotency_key=trim(p_idempotency_key)
  where id=result.id;

  for item in
    select * from public.progression_batch_items
    where batch_id=result.id and selected order by id for update
  loop
    if item.action='HOLD' then
      update public.progression_batch_items set status='SKIPPED',error_code='MANUAL_HOLD'
      where id=item.id;
      continue;
    end if;
    perform 1 from public.students where id=item.student_id and workspace_id=result.workspace_id for update;
    if not exists(
      select 1 from public.students
      where id=item.student_id and workspace_id=result.workspace_id
        and academic_year=result.from_academic_year
        and updated_at=item.student_updated_at and status='ACTIVE'
    ) then
      failed_count:=failed_count+1;
      update public.progression_batch_items
      set status='FAILED',error_code='STUDENT_VERSION_CONFLICT'
      where id=item.id;
      continue;
    end if;

    select * into academic from public.student_academic_records
    where workspace_id=result.workspace_id and student_id=item.student_id
    order by (status='CURRENT') desc,valid_from desc,created_at desc limit 1;
    has_academic:=found;
    update public.student_academic_records
    set status='COMPLETED',valid_to=greatest(valid_from,current_date)
    where workspace_id=result.workspace_id and student_id=item.student_id and status='CURRENT';

    insert into public.student_academic_records(
      workspace_id,student_id,school_id,curriculum,grade,academic_year,
      valid_from,valid_to,status,created_by,progression_batch_id
    ) values(
      result.workspace_id,item.student_id,
      case when has_academic then academic.school_id else null end,
      case when has_academic then academic.curriculum else 'UNSPECIFIED' end,
      case when item.action='GRADUATE' then item.from_grade else item.to_grade end,
      result.to_academic_year,current_date,
      case when item.action='GRADUATE' then current_date else null end,
      case when item.action='GRADUATE' then 'COMPLETED' else 'CURRENT' end,
      app_auth.current_user_id(),result.id
    );
    update public.students set
      current_grade=case when item.action='GRADUATE' then current_grade else item.to_grade end,
      academic_year=result.to_academic_year,
      status=case when item.action='GRADUATE' then 'ALUMNI' else status end,
      updated_at=now()
    where id=item.student_id and workspace_id=result.workspace_id;
    update public.progression_batch_items set status='APPLIED',error_code=null
    where id=item.id;
  end loop;

  update public.progression_batch_items set status=case when error_code='GRADE_MAPPING_REQUIRED' then 'FAILED' else 'SKIPPED' end
  where batch_id=result.id and status='PENDING';
  select count(*) into failed_count from public.progression_batch_items where batch_id=result.id and status='FAILED';
  update public.progression_batches set
    status=case when failed_count>0 then 'PARTIAL_FAILED' else 'APPLIED' end,
    applied_at=now()
  where id=result.id returning * into result;
  return result;
end;
$$;

revoke all on function public.preview_student_progression_internal(uuid,text,text,text) from public,crm_app,crm_worker;
revoke all on function public.apply_student_progression_internal(uuid,uuid,text) from public,crm_app,crm_worker;
create or replace function public.preview_student_progression(from_year text,to_year text,p_idempotency_key text)
returns public.progression_batches language plpgsql security definer set search_path=public,app_auth,extensions as $$
begin
 if public.current_workspace_id() is null or coalesce(public.current_crm_role(),'') not in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER') then raise exception 'progression_forbidden';end if;
 if p_idempotency_key like 'annual:%' then raise exception 'progression_invalid';end if;
 return public.preview_student_progression_internal(public.current_workspace_id(),from_year,to_year,p_idempotency_key);
end;$$;
create or replace function public.apply_student_progression(target_batch uuid,p_idempotency_key text)
returns public.progression_batches language plpgsql security definer set search_path=public,app_auth,extensions as $$
begin
 if public.current_workspace_id() is null or coalesce(public.current_crm_role(),'') not in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER') then raise exception 'progression_forbidden';end if;
 return public.apply_student_progression_internal(public.current_workspace_id(),target_batch,p_idempotency_key);
end;$$;
create function public.academic_progression_year(at_time timestamptz,zone_name text) returns integer
language sql stable set search_path=public,app_auth,extensions as $$
 select extract(year from at_time at time zone zone_name)::integer-case when extract(month from at_time at time zone zone_name)<9 then 1 else 0 end;
$$;
revoke all on function public.academic_progression_year(timestamptz,text) from public,crm_app,crm_worker;
create or replace function public.process_annual_student_progression()
returns integer language plpgsql security definer set search_path=public,app_auth,extensions as $$
declare w record;y integer;b public.progression_batches;processed integer:=0;old_tz text:=current_setting('TimeZone');
begin
 if not pg_try_advisory_xact_lock(hashtextextended('annual-student-progression',0)) then return 0;end if;
 for w in select id,business_timezone from public.workspaces order by id loop
  y:=public.academic_progression_year(current_timestamp,w.business_timezone);
  if exists(select 1 from public.progression_batches where workspace_id=w.id and idempotency_key='annual:'||y) then continue;end if;
  if not exists(select 1 from public.students where workspace_id=w.id and status='ACTIVE' and academic_year=(y-1)::text||'-'||y::text) then continue;end if;
  perform set_config('TimeZone',w.business_timezone,true);
  b:=public.preview_student_progression_internal(w.id,(y-1)::text||'-'||y::text,y::text||'-'||(y+1)::text,'annual:'||y);
  update public.progression_batches set execution_source='ANNUAL' where id=b.id;
  b:=public.apply_student_progression_internal(w.id,b.id,'annual-apply:'||y);
  processed:=processed+1;
  exit when processed>=10;
 end loop;
 perform set_config('TimeZone',old_tz,true);
 return processed;
end;$$;
revoke all on function public.process_annual_student_progression() from public,crm_app;
grant execute on function public.process_annual_student_progression() to crm_worker;

-- One row per visible student; related contacts are read through their own RLS.
create function public.list_student_family_page(search_query text,page_number integer,page_size integer,status_filter text)
returns table(id uuid,person_id uuid,student_number text,current_grade text,academic_year text,status text,updated_at timestamptz,name_zh text,name_en text,household_name_zh text,household_name_en text,total_count bigint,family_members jsonb)
language sql stable security invoker set search_path=public,app_auth,extensions as $$
 with visible as (
 select s.*,c.name_zh,c.name_en,h.name_zh household_name_zh,h.name_en household_name_en,
 coalesce((select jsonb_agg(jsonb_build_object('contactId',f.contact_id,'relationship',f.relationship,'nameZh',p.name_zh,'nameEn',p.name_en) order by f.contact_id)
 from (
 select g.guardian_contact_id contact_id,g.relationship_type relationship from public.student_guardian_relationships g where g.student_id=s.id and g.workspace_id=s.workspace_id
 union all
 select m.contact_id,m.member_role from public.household_members m where m.household_id=s.household_id and m.workspace_id=s.workspace_id and m.contact_id<>s.person_id
 and not exists(select 1 from public.student_guardian_relationships g where g.student_id=s.id and g.workspace_id=s.workspace_id and g.guardian_contact_id=m.contact_id)
 ) f join public.contacts p on p.id=f.contact_id and p.workspace_id=s.workspace_id),'[]'::jsonb) family_members
 from public.students s join public.contacts c on c.id=s.person_id and c.workspace_id=s.workspace_id
 left join public.households h on h.id=s.household_id and h.workspace_id=s.workspace_id
 where s.workspace_id=public.current_workspace_id() and (coalesce(status_filter,'all')='all' or s.status=status_filter)
 ),matched as (select * from visible v where nullif(trim(search_query),'') is null
 or strpos(lower(v.name_zh),lower(trim(search_query)))>0 or strpos(lower(v.name_en),lower(trim(search_query)))>0
 or strpos(lower(coalesce(v.student_number,'')),lower(trim(search_query)))>0
 or exists(select 1 from jsonb_array_elements(v.family_members) f where strpos(lower(f->>'nameZh'),lower(trim(search_query)))>0 or strpos(lower(f->>'nameEn'),lower(trim(search_query)))>0))
 select m.id,m.person_id,m.student_number,m.current_grade,m.academic_year,m.status,m.updated_at,m.name_zh,m.name_en,m.household_name_zh,m.household_name_en,count(*) over(),m.family_members
 from matched m order by m.updated_at desc,m.id limit least(greatest(page_size,1),50) offset (greatest(page_number,1)-1)*least(greatest(page_size,1),50);
$$;
revoke all on function public.list_student_family_page(text,integer,integer,text) from public,crm_worker;
grant execute on function public.list_student_family_page(text,integer,integer,text) to crm_app;

create function public.contact_directory_metrics(search_query text,status_filter text,org_filter uuid,owner_filter uuid,type_filter text)
returns jsonb language sql stable security invoker set search_path=public,app_auth,extensions as $$
 select jsonb_build_object('total',count(*),'needsAttention',count(*) filter(where contact_status in ('NEW','ATTEMPTING','FOLLOW_UP')),'averageCompleteness',coalesce(round(avg(completeness)),0))
 from public.contacts where workspace_id=public.current_workspace_id() and archived_at is null
 and (status_filter='all' or contact_status=status_filter) and (org_filter is null or organization_id=org_filter)
 and (owner_filter is null or owner_id=owner_filter) and (type_filter is null or contact_type=type_filter)
 and (coalesce(search_query,'')='' or name_zh ilike '%'||search_query||'%' or name_en ilike '%'||search_query||'%' or email ilike '%'||search_query||'%' or phone ilike '%'||search_query||'%');
$$;
revoke all on function public.contact_directory_metrics(text,text,uuid,uuid,text) from public,crm_worker;
grant execute on function public.contact_directory_metrics(text,text,uuid,uuid,text) to crm_app;

-- Editing a draft never changes a signed/active contract or its finance facts.
create function public.update_buyer_contract_draft(target_contract uuid,expected_updated_at timestamptz,contract_no text,target_product uuid,period_start date,period_end date,contract_currency text,contract_amount numeric)
returns public.contracts language plpgsql security invoker set search_path=public,app_auth,extensions as $$
declare c public.contracts;
begin
 if coalesce(public.current_crm_role(),'') not in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER','SALES_SPECIALIST') then raise exception 'contract_not_authorized';end if;
 select * into c from public.contracts where id=target_contract and workspace_id=public.current_workspace_id() for update;
 if not found then raise exception 'contract_not_found';end if;
 if c.status<>'DRAFT' then raise exception 'contract_draft_required';end if;
 if expected_updated_at is null or c.updated_at<>expected_updated_at then raise exception 'contract_version_conflict';end if;
 if exists(select 1 from public.receivable_schedules where contract_id=c.id) or exists(select 1 from public.payments where contract_id=c.id) then raise exception 'contract_finance_locked';end if;
 if contract_no is null or length(trim(contract_no)) not between 2 and 80 or period_start is null or period_end is null or period_end<period_start or contract_amount is null or contract_amount<0 or contract_amount<>round(contract_amount,2) or contract_currency is null or contract_currency!~'^[A-Z]{3}$' then raise exception 'contract_invalid';end if;
 if target_product is not null and not exists(select 1 from public.products where id=target_product and workspace_id=c.workspace_id and active and archived_at is null) then raise exception 'contract_product_not_found';end if;
 update public.contracts set contract_number=trim(contract_no),product_id=target_product,start_date=period_start,end_date=period_end,currency=contract_currency,contract_value=contract_amount,updated_at=clock_timestamp() where id=c.id returning * into c;
 return c;
end;$$;
revoke all on function public.update_buyer_contract_draft(uuid,timestamptz,text,uuid,date,date,text,numeric) from public,crm_worker;
grant execute on function public.update_buyer_contract_draft(uuid,timestamptz,text,uuid,date,date,text,numeric) to crm_app;

-- JSON serialization preserves the full PostgreSQL timestamp concurrency token.
create function public.get_contract_draft_detail(target_contract uuid) returns jsonb
language sql stable security invoker set search_path=public,app_auth,extensions as $$
 select jsonb_build_object('id',id,'contract_number',contract_number,'product_id',product_id,'start_date',start_date,'end_date',end_date,'currency',currency,'contract_value',contract_value::text,'status',status,'updated_at',updated_at)
 from public.contracts where id=target_contract and workspace_id=public.current_workspace_id();
$$;
revoke all on function public.get_contract_draft_detail(uuid) from public,crm_worker;
grant execute on function public.get_contract_draft_detail(uuid) to crm_app;
