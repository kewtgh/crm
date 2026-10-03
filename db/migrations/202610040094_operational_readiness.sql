-- Phase 4: derived operational facts; no duplicated Enrollment finance state.
set search_path=public,extensions;

-- Counts deliberately include links outside the caller's Enrollment scope. Only
-- disclose the count after authorizing the contract, never the other identities.
create function public.contract_active_enrollment_count(target_contract uuid)
returns bigint language sql stable security definer set search_path=public,app_auth as $$
  select count(*) from public.contract_enrollment_links l
  join public.contracts c on c.id=l.contract_id and c.workspace_id=l.workspace_id
  where c.id=target_contract and c.workspace_id=public.current_workspace_id() and l.status='ACTIVE'
    and public.can_access_owned_record(c.workspace_id,'CONTRACT',c.id,c.owner_id,false)
$$;
revoke all on function public.contract_active_enrollment_count(uuid) from public,crm_system;
grant execute on function public.contract_active_enrollment_count(uuid) to crm_app;

create function public.enrollment_finance_visibility(target_enrollment uuid)
returns jsonb language plpgsql stable security definer set search_path=public,app_auth as $$
declare e public.student_enrollments; total bigint; visible bigint;
begin
  select * into e from public.student_enrollments where id=target_enrollment;
  if not found or not public.student_enrollment_access(to_jsonb(e),false) then
    raise exception 'enrollment_not_found';
  end if;
  select count(*),count(*) filter(where public.can_access_owned_record(c.workspace_id,'CONTRACT',c.id,c.owner_id,false))
  into total,visible from public.contract_enrollment_links l join public.contracts c on c.id=l.contract_id and c.workspace_id=l.workspace_id
  where l.enrollment_id=e.id and l.workspace_id=e.workspace_id and l.status='ACTIVE';
  return jsonb_build_object('available',total=visible,'partial',visible>0 and visible<total);
end;$$;
revoke all on function public.enrollment_finance_visibility(uuid) from public,crm_system;
grant execute on function public.enrollment_finance_visibility(uuid) to crm_app;

create view public.enrollment_contract_finance with(security_invoker=true) as
select l.workspace_id,l.enrollment_id,c.id contract_id,c.contract_number,c.status contract_status,
  c.organization_id,c.household_id,c.product_id,c.currency,c.contract_value::text contracted,
  public.contract_active_enrollment_count(c.id) active_enrollment_link_count,
  coalesce(r.receivable,0)::text receivable,coalesce(p.collected,0)::text collected,
  coalesce(p.refunded,0)::text refunded,coalesce(r.outstanding,0)::text outstanding,
  coalesce(r.overdue,0)::text overdue,coalesce(r.schedule_count,0)>0 has_schedule
from public.contract_enrollment_links l join public.contracts c on c.id=l.contract_id and c.workspace_id=l.workspace_id
left join lateral (
  select count(*) schedule_count,sum(amount) receivable,sum(amount-paid_amount) outstanding,
    sum(amount-paid_amount) filter(where due_date<public.current_business_date()::date) overdue
  from public.receivable_schedules where workspace_id=c.workspace_id and contract_id=c.id
) r on true
left join lateral (
  -- The existing refresh_receivable/reconciliation contract uses net confirmed
  -- receipts and payment.refunded_amount (only completed refunds affect it).
  select sum(amount-refunded_amount) collected,sum(refunded_amount) refunded
  from public.payments where workspace_id=c.workspace_id and contract_id=c.id and status in ('CONFIRMED','REFUNDED')
) p on true where l.status='ACTIVE';
grant select on public.enrollment_contract_finance to crm_app;

-- One context object per visible active Enrollment. JSON containment matches all
-- requested identities on the SAME Enrollment, without multiplying finance rows.
create view public.finance_enrollment_scope with(security_invoker=true) as
select l.workspace_id,l.contract_id,jsonb_agg(jsonb_build_object('studentId',e.student_id,
 'productId',co.product_id,'cohortId',e.cohort_id,'enrollmentId',e.id)) enrollment_contexts
from public.contract_enrollment_links l join public.student_enrollments e on e.id=l.enrollment_id and e.workspace_id=l.workspace_id
join public.product_cohorts co on co.id=e.cohort_id and co.workspace_id=e.workspace_id
where l.status='ACTIVE' group by l.workspace_id,l.contract_id;
create view public.finance_filtered_contracts with(security_invoker=true) as
select c.*,s.enrollment_contexts from public.contracts c join public.finance_enrollment_scope s on s.contract_id=c.id and s.workspace_id=c.workspace_id;
create view public.finance_filtered_receivables with(security_invoker=true) as
select r.*,s.enrollment_contexts from public.receivable_schedules r join public.finance_enrollment_scope s on s.contract_id=r.contract_id and s.workspace_id=r.workspace_id;
create view public.finance_filtered_payments with(security_invoker=true) as
select p.*,s.enrollment_contexts from public.payments p join public.finance_enrollment_scope s on s.contract_id=p.contract_id and s.workspace_id=p.workspace_id;
create view public.finance_filtered_refunds with(security_invoker=true) as
select r.*,s.enrollment_contexts from public.refunds r join public.payments p on p.id=r.payment_id and p.workspace_id=r.workspace_id
join public.finance_enrollment_scope s on s.contract_id=p.contract_id and s.workspace_id=p.workspace_id;
create view public.finance_filtered_reconciliations with(security_invoker=true) as
select r.*,s.enrollment_contexts from public.reconciliation_items r join public.finance_enrollment_scope s on s.contract_id=r.contract_id and s.workspace_id=r.workspace_id;
grant select on public.finance_enrollment_scope,public.finance_filtered_contracts,public.finance_filtered_receivables,
 public.finance_filtered_payments,public.finance_filtered_refunds,public.finance_filtered_reconciliations to crm_app;

create view public.cohort_enrollment_snapshots with(security_invoker=true) as
select c.workspace_id,c.id cohort_id,c.product_id,c.target_enrollment,c.capacity,
 count(e.id) total_records,count(e.id) filter(where e.status in ('LEAD','INTERESTED','REGISTERING','ACTIVE')) current_open,
 count(e.id) filter(where e.status='LEAD') lead,count(e.id) filter(where e.status='INTERESTED') interested,
 count(e.id) filter(where e.status='REGISTERING') registering,count(e.id) filter(where e.status='ACTIVE') active,
 count(e.id) filter(where e.status='COMPLETED') completed,count(e.id) filter(where e.status='WITHDRAWN') withdrawn,
 count(e.id) filter(where e.status='CANCELLED') cancelled
from public.product_cohorts c left join public.student_enrollments e on e.cohort_id=c.id and e.workspace_id=c.workspace_id
group by c.workspace_id,c.id;
create view public.channel_enrollment_snapshots with(security_invoker=true) as
select o.workspace_id,o.id organization_id,o.name_zh,o.name_en,c.product_id,e.cohort_id,
 count(distinct e.id) filter(where a.attribution_type='PRIMARY') primary_enrollment_count,
 count(distinct e.id) filter(where a.attribution_type='ASSIST') assist_enrollment_count,
 count(distinct e.id) filter(where e.status='ACTIVE') active_enrollment_count
from public.enrollment_attributions a join public.student_enrollments e on e.id=a.enrollment_id and e.workspace_id=a.workspace_id
join public.product_cohorts c on c.id=e.cohort_id and c.workspace_id=e.workspace_id
join public.organizations o on o.id=a.source_organization_id and o.workspace_id=a.workspace_id
group by o.workspace_id,o.id,o.name_zh,o.name_en,c.product_id,e.cohort_id;
grant select on public.cohort_enrollment_snapshots,public.channel_enrollment_snapshots to crm_app;
create index product_cohorts_recruiting_deadline_idx on public.product_cohorts(workspace_id,application_deadline,id)
 where status='RECRUITING' and application_deadline is not null;

-- New resources use the existing batch/row/dry-run/repair/rollback framework.
-- Legacy resources delegate to their unchanged save implementations.
alter table public.import_batches drop constraint import_batches_resource_type_check;
alter table public.import_batches add constraint import_batches_resource_type_check
 check(resource_type in ('CONTACTS','ORGANIZATIONS','HOUSEHOLDS','STUDENTS','COHORTS','ENROLLMENTS'));
alter function public.create_import_batch(text,text,text,text,jsonb,jsonb) rename to create_import_batch_legacy;
alter function public.process_import_batch(uuid,integer) rename to process_import_batch_legacy;
alter function public.repair_import_row(uuid,jsonb) rename to repair_import_row_legacy;
alter function public.rollback_import_batch(uuid) rename to rollback_import_batch_legacy;
revoke all on function public.create_import_batch_legacy(text,text,text,text,jsonb,jsonb),
 public.process_import_batch_legacy(uuid,integer),public.repair_import_row_legacy(uuid,jsonb),public.rollback_import_batch_legacy(uuid)
 from public,crm_app,crm_system;

create function public.resolve_education_import_row(resource text,item jsonb)
returns jsonb language plpgsql security definer set search_path=public,app_auth,extensions as $$
declare ws uuid:=public.current_workspace_id(); product uuid; cohort uuid; student uuid; owner uuid; sales_owner uuid;
 household uuid; opportunity uuid; matches integer; data jsonb; field text:='row'; candidate uuid:=gen_random_uuid(); saved jsonb;
begin
 if public.current_crm_role() not in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER') then raise exception 'import_invalid'; end if;
 if jsonb_typeof(item)<>'object' then raise exception 'import_row_invalid'; end if;
 if resource not in ('COHORTS','ENROLLMENTS') then raise exception 'import_resource_invalid'; end if;
 field:='ownerEmail';
 if nullif(trim(item->>'ownerEmail'),'') is not null then
  select count(*),(array_agg(m.user_id))[1] into matches,owner from public.workspace_memberships m
   join app_auth.accounts a on a.id=m.user_id where m.workspace_id=ws and m.status='ACTIVE' and lower(a.email::text)=lower(trim(item->>'ownerEmail'));
  if matches<>1 then raise exception 'import_owner_not_found'; end if;
 elsif resource='ENROLLMENTS' then raise exception 'import_owner_required'; end if;
 if resource='COHORTS' then
  field:='productCode'; select count(*),(array_agg(id))[1] into matches,product from public.products
   where workspace_id=ws and lower(code::text)=lower(trim(item->>'productCode'));
  if matches<>1 then raise exception 'import_product_identity_invalid'; end if;
  field:='cohortCode';
  if exists(select 1 from public.product_cohorts where workspace_id=ws and code=trim(item->>'cohortCode')::citext) then raise exception 'import_cohort_duplicate'; end if;
  data:=jsonb_build_object('product_id',product,'code',trim(item->>'cohortCode'),
   'name_zh',coalesce(nullif(trim(item->>'nameZh'),''),nullif(trim(item->>'nameEn'),'')),
   'name_en',coalesce(nullif(trim(item->>'nameEn'),''),nullif(trim(item->>'nameZh'),'')),
   'intake_type',upper(coalesce(nullif(item->>'intakeType',''),'CUSTOM')),'academic_year',coalesce(item->>'academicYear',''),
   'status',upper(coalesce(nullif(item->>'status',''),'DRAFT')),'default_currency',upper(coalesce(nullif(item->>'currency',''),'CNY')),'owner_id',owner);
  foreach field in array array['applicationOpenOn','applicationDeadline','startOn','endOn'] loop
   if nullif(item->>field,'') is not null and (item->>field !~ '^\d{4}-\d{2}-\d{2}$' or to_char((item->>field)::date,'YYYY-MM-DD')<>item->>field) then raise exception 'import_date_invalid'; end if;
  end loop;
  data:=data||jsonb_build_object('application_open_on',nullif(item->>'applicationOpenOn',''),'application_deadline',nullif(item->>'applicationDeadline',''),
   'start_on',nullif(item->>'startOn',''),'end_on',nullif(item->>'endOn',''));
  field:='targetEnrollment'; if nullif(item->>'targetEnrollment','') is not null and item->>'targetEnrollment' !~ '^\d+$' then raise exception 'import_capacity_invalid'; end if;
  data:=data||jsonb_build_object('target_enrollment',nullif(item->>'targetEnrollment','')::integer);
  field:='capacity'; if nullif(item->>'capacity','') is not null and item->>'capacity' !~ '^\d+$' then raise exception 'import_capacity_invalid'; end if;
  data:=data||jsonb_build_object('capacity',nullif(item->>'capacity','')::integer);
 else
  field:='studentNumber'; if nullif(trim(item->>'studentNumber'),'') is null then raise exception 'import_student_identity_required'; end if;
  select count(*),(array_agg(s.id))[1] into matches,student from public.students s join public.contacts p on p.id=s.person_id and p.workspace_id=s.workspace_id
   where s.workspace_id=ws and s.student_number=trim(item->>'studentNumber') and coalesce(p.do_not_contact_reason,'') not like 'PRIVACY_DELETION:%';
  if matches<>1 then raise exception 'import_student_identity_invalid'; end if;
  field:='cohortCode'; select id into cohort from public.product_cohorts where workspace_id=ws and code=trim(item->>'cohortCode')::citext;
  if cohort is null then raise exception 'import_cohort_not_found'; end if;
  if exists(select 1 from public.student_enrollments where workspace_id=ws and student_id=student and cohort_id=cohort) then raise exception 'import_enrollment_duplicate'; end if;
  field:='salesOwnerEmail'; if nullif(trim(item->>'salesOwnerEmail'),'') is not null then
   select count(*),(array_agg(m.user_id))[1] into matches,sales_owner from public.workspace_memberships m join app_auth.accounts a on a.id=m.user_id
    where m.workspace_id=ws and m.status='ACTIVE' and lower(a.email::text)=lower(trim(item->>'salesOwnerEmail'));
   if matches<>1 then raise exception 'import_owner_not_found'; end if;
  end if;
  field:='householdReference'; household:=nullif(item->>'householdReference','')::uuid;
  field:='opportunityReference'; opportunity:=nullif(item->>'opportunityReference','')::uuid;
  data:=jsonb_build_object('student_id',student,'cohort_id',cohort,'household_id',household,'opportunity_id',opportunity,
   'owner_id',owner,'sales_owner_id',sales_owner,'status',upper(coalesce(nullif(item->>'status',''),'LEAD')),
   'enrolled_at',nullif(item->>'enrolledAt',''),'completed_at',nullif(item->>'completedAt',''),
   'withdrawn_at',nullif(item->>'withdrawnAt',''),'withdrawal_reason',coalesce(item->>'withdrawalReason',''));
 end if;
 field:='row';
 -- Validate through the authoritative domain RPC in a rolled-back subtransaction.
 -- Receipts, history, audit and automation artifacts never survive this preview.
 begin
  if resource='COHORTS' then saved:=to_jsonb(public.save_product_cohort(candidate,null,data,gen_random_uuid()::text));
  else saved:=to_jsonb(public.save_student_enrollment(candidate,null,data,gen_random_uuid()::text,'')); end if;
  raise exception using errcode='PZ001',message='validation_complete';
 exception when sqlstate 'PZ001' then null;
 end;
 return jsonb_build_object('data',data,'errors','[]'::jsonb,'identity',case when resource='COHORTS' then lower(data->>'code') else (data->>'student_id')||':'||(data->>'cohort_id') end);
exception when others then
 return jsonb_build_object('errors',jsonb_build_array(jsonb_build_object('code','DOMAIN_ROW_INVALID','field',field,'reason',left(sqlerrm,160))));
end;$$;
revoke all on function public.resolve_education_import_row(text,jsonb) from public,crm_app,crm_system;

create function public.refresh_education_import_batch(target_batch uuid)
returns public.import_batches language plpgsql security definer set search_path=public as $$
declare result public.import_batches;
begin
 update public.import_batches b set total_rows=(select count(*) from public.import_rows where batch_id=b.id),
 valid_rows=(select count(*) from public.import_rows where batch_id=b.id and status='VALID'),
 invalid_rows=(select count(*) from public.import_rows where batch_id=b.id and status='INVALID'),
 duplicate_rows=0,applied_rows=(select count(*) from public.import_rows where batch_id=b.id and status='APPLIED'),
 failed_rows=(select count(*) from public.import_rows where batch_id=b.id and status='FAILED'),
 status=case when exists(select 1 from public.import_rows where batch_id=b.id and status in ('INVALID','FAILED')) then 'PARTIAL_FAILED'
  when not exists(select 1 from public.import_rows where batch_id=b.id and status in ('VALID','DECIDED')) then 'COMPLETED' else 'READY' end,
 updated_at=now() where b.id=target_batch returning * into result; return result;
end;$$;
revoke all on function public.refresh_education_import_batch(uuid) from public,crm_app,crm_system;

create function public.create_import_batch(resource text,filename text,content_hash text,request_key text,mapping jsonb,rows jsonb)
returns public.import_batches language plpgsql security definer set search_path=public,app_auth,extensions as $$
declare batch public.import_batches; item jsonb; validated jsonb; row_no integer:=0; identities text[]:='{}'; identity text;
begin
 resource:=upper(trim(resource));
 if resource not in ('COHORTS','ENROLLMENTS') then return public.create_import_batch_legacy(resource,filename,content_hash,request_key,mapping,rows); end if;
 if public.current_crm_role() not in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER') or not public.is_workspace_member(public.current_workspace_id())
  or jsonb_typeof(rows)<>'array' or jsonb_array_length(rows) not between 1 and 10000 or length(request_key) not between 8 and 160 then raise exception 'import_invalid'; end if;
 insert into public.import_batches(workspace_id,resource_type,original_filename,file_hash,idempotency_key,field_mapping,created_by)
 values(public.current_workspace_id(),resource,left(filename,180),content_hash,request_key,mapping,app_auth.current_user_id())
 on conflict(workspace_id,idempotency_key) do update set idempotency_key=excluded.idempotency_key returning * into batch;
 if batch.created_by<>app_auth.current_user_id() or batch.resource_type<>resource or batch.file_hash<>content_hash or batch.field_mapping<>mapping then raise exception 'import_request_conflict'; end if;
 if batch.total_rows>0 then
  if (select jsonb_agg(raw_data order by row_number) from public.import_rows where batch_id=batch.id) is distinct from rows then raise exception 'import_request_conflict'; end if;
  return batch;
 end if;
 for item in select * from jsonb_array_elements(rows) loop
  row_no:=row_no+1; validated:=public.resolve_education_import_row(resource,item); identity:=validated->>'identity';
  if identity=any(identities) then validated:=jsonb_build_object('errors',jsonb_build_array(jsonb_build_object('code','DOMAIN_ROW_INVALID','field','row','reason','import_duplicate_in_batch'))); end if;
  identities:=array_append(identities,identity);
  insert into public.import_rows(workspace_id,batch_id,row_number,raw_data,normalized_data,status,errors)
   values(batch.workspace_id,batch.id,row_no,item,item||jsonb_build_object('_identity',identity),case when jsonb_array_length(validated->'errors')=0 then 'VALID' else 'INVALID' end,validated->'errors');
 end loop;
 return public.refresh_education_import_batch(batch.id);
end;$$;

create function public.process_import_batch(target_batch uuid,batch_size integer default 50)
returns public.import_batches language plpgsql security definer set search_path=public,app_auth,extensions as $$
declare batch public.import_batches; item public.import_rows; validated jsonb; saved jsonb; entity uuid;
begin
 select * into batch from public.import_batches where id=target_batch and workspace_id=public.current_workspace_id() and created_by=app_auth.current_user_id() for update;
 if not found or public.current_crm_role() not in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER') then raise exception 'import_not_processable'; end if;
 if batch.resource_type not in ('COHORTS','ENROLLMENTS') then return public.process_import_batch_legacy(target_batch,batch_size); end if;
 if batch_size is null or batch_size not between 1 and 100 or batch.status not in ('READY','PROCESSING','PARTIAL_FAILED','COMPLETED') then raise exception 'import_not_processable'; end if;
 for item in select * from public.import_rows where batch_id=batch.id and workspace_id=batch.workspace_id and status in ('VALID','DECIDED') order by row_number limit batch_size for update loop
  begin
   if coalesce(item.decision,'CREATE')='SKIP' then update public.import_rows set status='SKIPPED' where id=item.id; continue; end if;
   if coalesce(item.decision,'CREATE')<>'CREATE' then raise exception 'import_create_only'; end if;
   validated:=public.resolve_education_import_row(batch.resource_type,item.normalized_data);
   if jsonb_array_length(validated->'errors')<>0 then raise exception '%',validated->'errors'; end if;
   entity:=gen_random_uuid();
   if batch.resource_type='COHORTS' then saved:=to_jsonb(public.save_product_cohort(entity,null,validated->'data','import:'||item.id));
   else saved:=to_jsonb(public.save_student_enrollment(entity,null,validated->'data','import:'||item.id,'')); end if;
   update public.import_rows set status='APPLIED',applied_entity_id=entity,after_snapshot=saved,applied_at=now(),last_error=null where id=item.id;
  exception when others then update public.import_rows set status='FAILED',last_error=left(sqlerrm,500) where id=item.id; end;
 end loop;
 return public.refresh_education_import_batch(batch.id);
end;$$;

create function public.repair_import_row(target_row uuid,replacement jsonb)
returns public.import_rows language plpgsql security definer set search_path=public,app_auth,extensions as $$
declare item public.import_rows; batch public.import_batches; validated jsonb; normalized jsonb;
begin
 select * into item from public.import_rows where id=target_row and workspace_id=public.current_workspace_id() for update;
 select * into batch from public.import_batches where id=item.batch_id and workspace_id=public.current_workspace_id() and created_by=app_auth.current_user_id() for update;
 if not found or public.current_crm_role() not in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER') then raise exception 'import_repair_invalid'; end if;
 if batch.resource_type not in ('COHORTS','ENROLLMENTS') then return public.repair_import_row_legacy(target_row,replacement); end if;
 if item.status not in ('INVALID','FAILED','VALID','DECIDED') or jsonb_typeof(replacement)<>'object' then raise exception 'import_repair_invalid'; end if;
 normalized:=item.normalized_data||replacement;validated:=public.resolve_education_import_row(batch.resource_type,normalized);
 if exists(select 1 from public.import_rows r where r.batch_id=batch.id and r.id<>item.id and r.status in ('VALID','DECIDED','APPLIED') and r.normalized_data->>'_identity'=validated->>'identity') then
  validated:=jsonb_build_object('errors',jsonb_build_array(jsonb_build_object('code','DOMAIN_ROW_INVALID','field','row','reason','import_duplicate_in_batch')));
 end if;
 update public.import_rows set normalized_data=normalized||jsonb_build_object('_identity',validated->>'identity'),status=case when jsonb_array_length(validated->'errors')=0 then 'VALID' else 'INVALID' end,
 errors=validated->'errors',decision=null,last_error=null where id=item.id returning * into item;
 perform public.refresh_education_import_batch(batch.id);return item;
end;$$;

create function public.rollback_import_batch(target_batch uuid)
returns public.import_batches language plpgsql security definer set search_path=public,app_auth,extensions as $$
declare batch public.import_batches; item public.import_rows; current_row jsonb; data jsonb;
begin
 select * into batch from public.import_batches where id=target_batch and workspace_id=public.current_workspace_id() and created_by=app_auth.current_user_id() for update;
 if not found or public.current_crm_role() not in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER') then raise exception 'import_not_rollbackable'; end if;
 if batch.resource_type not in ('COHORTS','ENROLLMENTS') then return public.rollback_import_batch_legacy(target_batch); end if;
 if batch.status not in ('COMPLETED','PARTIAL_FAILED') then raise exception 'import_not_rollbackable'; end if;
 for item in select * from public.import_rows where batch_id=batch.id and workspace_id=batch.workspace_id and status='APPLIED' order by row_number desc for update loop
  if batch.resource_type='COHORTS' then
   select to_jsonb(c) into current_row from public.product_cohorts c where id=item.applied_entity_id and workspace_id=batch.workspace_id for update;
   if exists(select 1 from public.student_enrollments where cohort_id=item.applied_entity_id and workspace_id=batch.workspace_id)
    or exists(select 1 from public.opportunities where cohort_id=item.applied_entity_id and workspace_id=batch.workspace_id)
    or exists(select 1 from public.quotes where cohort_id=item.applied_entity_id and workspace_id=batch.workspace_id)
    or exists(select 1 from public.education_outreach_events where cohort_id=item.applied_entity_id and workspace_id=batch.workspace_id) then raise exception 'import_rollback_has_dependencies'; end if;
  else
   select to_jsonb(e) into current_row from public.student_enrollments e where id=item.applied_entity_id and workspace_id=batch.workspace_id for update;
   if exists(select 1 from public.contract_enrollment_links where enrollment_id=item.applied_entity_id and workspace_id=batch.workspace_id)
    or exists(select 1 from public.enrollment_attributions where enrollment_id=item.applied_entity_id and workspace_id=batch.workspace_id) then raise exception 'import_rollback_has_dependencies'; end if;
  end if;
  if current_row is null or current_row->>'revision' is distinct from item.after_snapshot->>'revision' then raise exception 'import_rollback_conflict'; end if;
  data:=current_row-'id'-'workspace_id'-'revision'-'created_by'-'created_at'-'updated_at'||jsonb_build_object('status','CANCELLED');
  if batch.resource_type='COHORTS' then perform public.save_product_cohort(item.applied_entity_id,(current_row->>'revision')::integer,data,'rollback:'||item.id);
  else perform public.save_student_enrollment(item.applied_entity_id,(current_row->>'revision')::integer,data,'rollback:'||item.id,'Import rollback'); end if;
  update public.import_rows set status='ROLLED_BACK' where id=item.id;
 end loop;
 update public.import_batches set status='ROLLED_BACK',rolled_back_at=now(),updated_at=now() where id=batch.id returning * into batch;return batch;
end;$$;
revoke all on function public.create_import_batch(text,text,text,text,jsonb,jsonb),public.process_import_batch(uuid,integer),
 public.repair_import_row(uuid,jsonb),public.rollback_import_batch(uuid) from public,crm_system;
grant execute on function public.create_import_batch(text,text,text,text,jsonb,jsonb),public.process_import_batch(uuid,integer),
 public.repair_import_row(uuid,jsonb),public.rollback_import_batch(uuid) to crm_app;

-- Dedicated privacy deletion removes personal import source data, while retaining
-- batch execution evidence. It never removes a contract or other finance record.
create function public.cleanup_enrollment_import_privacy() returns trigger
language plpgsql security definer set search_path=public as $$
declare number text;
begin
 select student_number into number from public.students where id=old.student_id and workspace_id=old.workspace_id;
 update public.import_rows r set raw_data='{}',normalized_data='{}',before_snapshot=null,after_snapshot=null,
   errors='[]',last_error=null,applied_entity_id=null
 from public.import_batches b where b.id=r.batch_id and b.workspace_id=old.workspace_id and b.resource_type='ENROLLMENTS'
  and (r.applied_entity_id=old.id or (number is not null and r.normalized_data->>'studentNumber'=number));
 return old;
end;$$;
revoke all on function public.cleanup_enrollment_import_privacy() from public,crm_app,crm_system;
create trigger enrollment_import_privacy_cleanup before delete on public.student_enrollments
 for each row execute function public.cleanup_enrollment_import_privacy();
create function public.erase_student_enrollment_import_data(target_student uuid,target_workspace uuid)
returns void language sql security definer set search_path=public as $$
 update public.import_rows r set raw_data='{}',normalized_data='{}',before_snapshot=null,after_snapshot=null,
 errors='[]',last_error=null,applied_entity_id=null from public.import_batches b,public.students s
 where b.id=r.batch_id and b.workspace_id=target_workspace and b.resource_type='ENROLLMENTS'
  and s.id=target_student and s.workspace_id=target_workspace and s.student_number is not null
  and (r.normalized_data->>'studentNumber'=s.student_number or r.raw_data->>'studentNumber'=s.student_number)
$$;
revoke all on function public.erase_student_enrollment_import_data(uuid,uuid) from public,crm_app,crm_system;
create function public.student_import_privacy_trigger() returns trigger language plpgsql security definer set search_path=public as $$
declare student record;
begin
 if tg_table_name='students' then perform public.erase_student_enrollment_import_data(old.id,old.workspace_id);return old; end if;
 if new.do_not_contact_reason like 'PRIVACY_DELETION:%' and new.do_not_contact_reason is distinct from old.do_not_contact_reason then
  for student in select id,workspace_id from public.students where person_id=new.id and workspace_id=new.workspace_id loop
   perform public.erase_student_enrollment_import_data(student.id,student.workspace_id);
  end loop;
 end if;return new;
end;$$;
revoke all on function public.student_import_privacy_trigger() from public,crm_app,crm_system;
create trigger student_import_identity_cleanup before delete on public.students for each row execute function public.student_import_privacy_trigger();
create trigger contact_enrollment_import_cleanup before update of do_not_contact_reason on public.contacts for each row execute function public.student_import_privacy_trigger();

-- Extend the existing dispatcher, preserving action, run and retry semantics.
alter table public.automation_rules drop constraint automation_rules_trigger_key_check;
alter table public.automation_rules add constraint automation_rules_trigger_key_check check(trigger_key in ('LEAD_CREATED','LEAD_STATUS_CHANGED','OPPORTUNITY_STAGE_CHANGED','CONTRACT_RENEWAL_DUE','MANUAL','ENROLLMENT_CREATED','ENROLLMENT_STATUS_CHANGED','COHORT_APPLICATION_DEADLINE_APPROACHING'));
create or replace function public.dispatch_automation_event(
  target_workspace uuid,target_trigger text,target_event_key text,target_payload jsonb,target_actor uuid
) returns jsonb
language plpgsql security definer set search_path=public,app_auth,extensions
as $$
declare event_row public.automation_events;rule_row public.automation_rules;task_id uuid;notification_id uuid;
  succeeded integer:=0;failed integer:=0;duplicate boolean:=false;due_hours integer;
begin
  if target_workspace is null or target_trigger not in ('LEAD_CREATED','LEAD_STATUS_CHANGED','OPPORTUNITY_STAGE_CHANGED','CONTRACT_RENEWAL_DUE','MANUAL','ENROLLMENT_CREATED','ENROLLMENT_STATUS_CHANGED','COHORT_APPLICATION_DEADLINE_APPROACHING')
    or nullif(trim(target_event_key),'') is null or jsonb_typeof(coalesce(target_payload,'{}'::jsonb))<>'object' then
    raise exception 'automation_event_invalid';
  end if;
  insert into public.automation_events(workspace_id,trigger_key,event_key,payload,actor_id)
  values(target_workspace,target_trigger,left(target_event_key,240),coalesce(target_payload,'{}'::jsonb),target_actor)
  on conflict(workspace_id,event_key) do nothing returning * into event_row;
  if event_row.id is null then
    duplicate:=true;
    select * into event_row from public.automation_events where workspace_id=target_workspace and event_key=left(target_event_key,240);
    return jsonb_build_object('eventId',event_row.id,'duplicate',true,'succeeded',0,'failed',0);
  end if;
  for rule_row in select * from public.automation_rules
    where workspace_id=target_workspace and active and trigger_key=target_trigger
      and (conditions='{}'::jsonb or coalesce(target_payload,'{}'::jsonb) @> conditions)
    order by created_at,id
  loop
    begin
      if rule_row.action_type='TASK' then
        due_hours:=case when coalesce(rule_row.action_config->>'dueHours','')~'^\d{1,4}$'
          then greatest(1,least(2160,(rule_row.action_config->>'dueHours')::integer)) else 24 end;
        insert into public.crm_tasks(workspace_id,title_zh,title_en,related_type,related_id,related_label,status,priority,owner_id,due_at,created_by)
        values(target_workspace,
          coalesce(nullif(trim(rule_row.action_config->>'titleZh'),''),rule_row.name_zh),
          coalesce(nullif(trim(rule_row.action_config->>'titleEn'),''),rule_row.name_en),
          coalesce(nullif(trim(target_payload->>'relatedType'),''),'GENERAL'),
          case when coalesce(target_payload->>'relatedId','')~'^[0-9a-fA-F-]{36}$' then (target_payload->>'relatedId')::uuid else null end,
          left(coalesce(target_payload->>'relatedLabel',''),160),'TODO',
          case when upper(coalesce(rule_row.action_config->>'priority','NORMAL')) in ('LOW','NORMAL','HIGH','URGENT') then upper(rule_row.action_config->>'priority') else 'NORMAL' end,
          target_actor,now()+make_interval(hours=>due_hours),target_actor)
        returning id into task_id;
        insert into public.automation_runs(workspace_id,rule_id,event_id,status,result_type,result_id)
        values(target_workspace,rule_row.id,event_row.id,'SUCCEEDED','TASK',task_id);
      else
        insert into public.user_notifications(workspace_id,user_id,kind,title_key,body_key,values,source_type,source_id)
        values(target_workspace,target_actor,'AUTOMATION','automation.notification.title','automation.notification.body',
          jsonb_build_object('ruleZh',rule_row.name_zh,'ruleEn',rule_row.name_en,'event',target_trigger),
          'AUTOMATION_RULE',rule_row.id) returning id into notification_id;
        insert into public.automation_runs(workspace_id,rule_id,event_id,status,result_type,result_id)
        values(target_workspace,rule_row.id,event_row.id,'SUCCEEDED','NOTIFICATION',notification_id);
      end if;
      succeeded:=succeeded+1;
    exception when others then
      failed:=failed+1;
      insert into public.automation_runs(workspace_id,rule_id,event_id,status,error_code)
      values(target_workspace,rule_row.id,event_row.id,'FAILED',left(sqlstate||':'||sqlerrm,500))
      on conflict(rule_id,event_id) do nothing;
    end;
  end loop;
  return jsonb_build_object('eventId',event_row.id,'duplicate',duplicate,'succeeded',succeeded,'failed',failed);
end;
$$;
create function public.enrollment_history_automation_trigger() returns trigger
language plpgsql security definer set search_path=public,app_auth as $$
declare e public.student_enrollments; co public.product_cohorts; kind text;
begin
 select * into e from public.student_enrollments where id=new.enrollment_id and workspace_id=new.workspace_id;
 select * into co from public.product_cohorts where id=e.cohort_id and workspace_id=e.workspace_id;
 kind:=case when new.from_status is null then 'ENROLLMENT_CREATED' else 'ENROLLMENT_STATUS_CHANGED' end;
 perform public.dispatch_automation_event(e.workspace_id,kind,'enrollment:'||e.id||':history:'||new.id,
  jsonb_build_object('enrollmentId',e.id,'studentId',e.student_id,'cohortId',e.cohort_id,'ownerId',e.owner_id,
    'status',new.to_status,'fromStatus',new.from_status,'relatedType','STUDENT','relatedId',e.student_id,
    'relatedLabel',co.code,'changedBy',new.changed_by),e.owner_id);
 return new;
end;$$;
revoke all on function public.enrollment_history_automation_trigger() from public,crm_app,crm_system;
create trigger enrollment_history_automation after insert on public.student_enrollment_status_history
 for each row execute function public.enrollment_history_automation_trigger();

create function public.process_cohort_deadline_events(batch_size integer default 100)
returns integer language plpgsql security definer set search_path=public,app_auth as $$
declare item record; payload jsonb; count_processed integer:=0;
begin
 if batch_size is null or batch_size<1 or batch_size>200 then raise exception 'automation_batch_invalid'; end if;
 for item in
  select c.*,c.application_deadline-(now() at time zone w.business_timezone)::date days_left
  from public.product_cohorts c join public.workspaces w on w.id=c.workspace_id
  where c.status='RECRUITING' and c.owner_id is not null
    and exists(select 1 from public.workspace_memberships m where m.workspace_id=c.workspace_id and m.user_id=c.owner_id and m.status='ACTIVE')
    and c.application_deadline>=(now() at time zone w.business_timezone)::date
    and exists(select 1 from public.automation_rules r where r.workspace_id=c.workspace_id and r.active
      and r.trigger_key='COHORT_APPLICATION_DEADLINE_APPROACHING'
      and jsonb_build_object('cohortId',c.id,'productId',c.product_id,'ownerId',c.owner_id,'status',c.status,
        'daysUntilDeadline',c.application_deadline-(now() at time zone w.business_timezone)::date) @> r.conditions)
    and not exists(select 1 from public.automation_events a where a.workspace_id=c.workspace_id
      and a.event_key='cohort:'||c.id||':deadline:'||c.application_deadline||':days:'||(c.application_deadline-(now() at time zone w.business_timezone)::date))
  order by c.application_deadline,c.id limit batch_size for update of c skip locked
 loop
  payload:=jsonb_build_object('cohortId',item.id,'productId',item.product_id,'ownerId',item.owner_id,'status',item.status,
   'daysUntilDeadline',item.days_left,'relatedType','GENERAL','relatedId',null,'relatedLabel',item.code);
  perform public.dispatch_automation_event(item.workspace_id,'COHORT_APPLICATION_DEADLINE_APPROACHING',
    'cohort:'||item.id||':deadline:'||item.application_deadline||':days:'||item.days_left,payload,item.owner_id);
  count_processed:=count_processed+1;
 end loop;
 return count_processed;
end;$$;
revoke all on function public.process_cohort_deadline_events(integer) from public,crm_app,crm_system;
grant execute on function public.process_cohort_deadline_events(integer) to crm_worker;

-- LOW/MEDIUM are operational warnings; database constraints remain authoritative.
create function public.seed_cohort_enrollment_quality_rules() returns trigger language plpgsql security definer set search_path=public as $$ begin
 insert into public.data_quality_rule_configs(workspace_id,rule_key,severity)
 select new.id,x.rule_key,x.severity from (values ('COHORT_MISSING_APPLICATION_DEADLINE','LOW'),('COHORT_MISSING_OWNER','LOW'),('COHORT_RECRUITING_AFTER_DEADLINE','MEDIUM'),('COHORT_ACTIVE_WITHOUT_START_DATE','MEDIUM'),('COHORT_COMPLETED_WITHOUT_END_DATE','LOW'),('ENROLLMENT_MISSING_HOUSEHOLD','LOW'),('ENROLLMENT_WITHOUT_PRIMARY_ATTRIBUTION','LOW'),('ENROLLMENT_ACTIVE_WITHOUT_CONTRACT','MEDIUM')) x(rule_key,severity)
 on conflict(workspace_id,rule_key) do nothing; return new; end;$$;
revoke all on function public.seed_cohort_enrollment_quality_rules() from public,crm_app,crm_system;
create trigger seed_cohort_enrollment_quality after insert on public.workspaces for each row execute function public.seed_cohort_enrollment_quality_rules();
insert into public.data_quality_rule_configs(workspace_id,rule_key,severity)
 select w.id,x.rule_key,x.severity from public.workspaces w cross join (values ('COHORT_MISSING_APPLICATION_DEADLINE','LOW'),('COHORT_MISSING_OWNER','LOW'),('COHORT_RECRUITING_AFTER_DEADLINE','MEDIUM'),('COHORT_ACTIVE_WITHOUT_START_DATE','MEDIUM'),('COHORT_COMPLETED_WITHOUT_END_DATE','LOW'),('ENROLLMENT_MISSING_HOUSEHOLD','LOW'),('ENROLLMENT_WITHOUT_PRIMARY_ATTRIBUTION','LOW'),('ENROLLMENT_ACTIVE_WITHOUT_CONTRACT','MEDIUM')) x(rule_key,severity)
 on conflict(workspace_id,rule_key) do nothing;
create or replace function public.run_data_quality_rules()
returns integer language plpgsql security definer set search_path=public,app_auth,extensions as $$
declare marker timestamptz:=clock_timestamp();affected integer;ws uuid:=public.current_workspace_id();
begin
  if public.current_crm_role() not in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER') then raise exception 'quality_not_authorized'; end if;

  insert into public.data_quality_issues(workspace_id,rule_key,entity_type,entity_id,severity,title_key,details,last_seen_at)
  select c.workspace_id,config.rule_key,'CONTACT',c.id,config.severity,'quality.rule.contactMethod',jsonb_build_object('nameZh',c.name_zh,'nameEn',c.name_en),marker
  from public.contacts c join public.data_quality_rule_configs config on config.workspace_id=c.workspace_id and config.rule_key='CONTACT_METHOD_MISSING' and config.enabled
  where c.workspace_id=ws and c.email is null and coalesce(c.phone,'')=''
  on conflict(workspace_id,rule_key,entity_type,entity_id) do update set severity=excluded.severity,status=case when data_quality_issues.status='RESOLVED' then 'OPEN' else data_quality_issues.status end,details=excluded.details,last_seen_at=marker;

  insert into public.data_quality_issues(workspace_id,rule_key,entity_type,entity_id,severity,title_key,details,last_seen_at)
  select o.workspace_id,config.rule_key,'OPPORTUNITY',o.id,config.severity,'quality.rule.nextAction',jsonb_build_object('titleZh',o.title_zh,'titleEn',o.title_en),marker
  from public.opportunities o join public.data_quality_rule_configs config on config.workspace_id=o.workspace_id and config.rule_key='OPPORTUNITY_NEXT_ACTION_MISSING' and config.enabled
  where o.workspace_id=ws and o.stage not in ('WON','LOST') and o.next_action_zh='' and o.next_action_en=''
  on conflict(workspace_id,rule_key,entity_type,entity_id) do update set severity=excluded.severity,status=case when data_quality_issues.status='RESOLVED' then 'OPEN' else data_quality_issues.status end,details=excluded.details,last_seen_at=marker;

  insert into public.data_quality_issues(workspace_id,rule_key,entity_type,entity_id,severity,title_key,details,last_seen_at)
  select organization.workspace_id,config.rule_key,'ORGANIZATION',organization.id,config.severity,'quality.rule.owner',jsonb_build_object('nameZh',organization.name_zh,'nameEn',organization.name_en),marker
  from public.organizations organization join public.data_quality_rule_configs config on config.workspace_id=organization.workspace_id and config.rule_key='ORGANIZATION_OWNER_MISSING' and config.enabled
  where organization.workspace_id=ws and organization.owner_id is null
  on conflict(workspace_id,rule_key,entity_type,entity_id) do update set severity=excluded.severity,status=case when data_quality_issues.status='RESOLVED' then 'OPEN' else data_quality_issues.status end,details=excluded.details,last_seen_at=marker;

  insert into public.data_quality_issues(workspace_id,rule_key,entity_type,entity_id,severity,title_key,details,last_seen_at)
  select student.workspace_id,config.rule_key,'STUDENT',student.id,config.severity,'quality.rule.guardianMissing',jsonb_build_object('studentId',student.student_number),marker
  from public.students student join public.data_quality_rule_configs config on config.workspace_id=student.workspace_id and config.rule_key='STUDENT_GUARDIAN_MISSING' and config.enabled
  where student.workspace_id=ws and student.status='ACTIVE' and not exists(select 1 from public.student_guardian_relationships relation where relation.student_id=student.id)
  on conflict(workspace_id,rule_key,entity_type,entity_id) do update set severity=excluded.severity,status=case when data_quality_issues.status='RESOLVED' then 'OPEN' else data_quality_issues.status end,details=excluded.details,last_seen_at=marker;

  insert into public.data_quality_issues(workspace_id,rule_key,entity_type,entity_id,severity,title_key,details,last_seen_at)
  select distinct on(consent.contact_id) consent.workspace_id,config.rule_key,'CONTACT',consent.contact_id,config.severity,'quality.rule.consentExpired',jsonb_build_object('channel',consent.channel,'purpose',consent.purpose,'retentionUntil',consent.retention_until),marker
  from public.contact_consents consent join public.data_quality_rule_configs config on config.workspace_id=consent.workspace_id and config.rule_key='CONSENT_EXPIRED' and config.enabled
  where consent.workspace_id=ws and consent.status='GRANTED' and consent.retention_until<current_date order by consent.contact_id,consent.retention_until
  on conflict(workspace_id,rule_key,entity_type,entity_id) do update set severity=excluded.severity,status=case when data_quality_issues.status='RESOLVED' then 'OPEN' else data_quality_issues.status end,details=excluded.details,last_seen_at=marker;

  insert into public.data_quality_issues(workspace_id,rule_key,entity_type,entity_id,severity,title_key,details,last_seen_at)
  select opportunity.workspace_id,config.rule_key,'OPPORTUNITY',opportunity.id,config.severity,'quality.rule.exchangeRateMissing',jsonb_build_object('currency',opportunity.currency,'amount',opportunity.amount),marker
  from public.opportunities opportunity join public.workspaces workspace on workspace.id=opportunity.workspace_id
  join public.data_quality_rule_configs config on config.workspace_id=opportunity.workspace_id and config.rule_key='OPPORTUNITY_EXCHANGE_RATE_MISSING' and config.enabled
  where opportunity.workspace_id=ws and opportunity.stage not in ('WON','LOST') and opportunity.currency<>workspace.default_currency
    and not exists(select 1 from public.exchange_rate_snapshots rate where rate.workspace_id=opportunity.workspace_id and rate.base_currency=workspace.default_currency and rate.quote_currency=opportunity.currency and rate.effective_at<=now())
  on conflict(workspace_id,rule_key,entity_type,entity_id) do update set severity=excluded.severity,status=case when data_quality_issues.status='RESOLVED' then 'OPEN' else data_quality_issues.status end,details=excluded.details,last_seen_at=marker;

  insert into public.data_quality_issues(workspace_id,rule_key,entity_type,entity_id,severity,title_key,details,last_seen_at)
  select lead.workspace_id,config.rule_key,'LEAD',lead.id,config.severity,'quality.rule.attributionMissing',jsonb_build_object('nameZh',lead.name_zh,'nameEn',lead.name_en,'source',lead.source),marker
  from public.leads lead join public.data_quality_rule_configs config on config.workspace_id=lead.workspace_id and config.rule_key='LEAD_ATTRIBUTION_MISSING' and config.enabled
  where lead.workspace_id=ws and lead.status not in ('CONVERTED','LOST') and not exists(select 1 from public.lead_attribution_touches touch where touch.lead_id=lead.id)
  on conflict(workspace_id,rule_key,entity_type,entity_id) do update set severity=excluded.severity,status=case when data_quality_issues.status='RESOLVED' then 'OPEN' else data_quality_issues.status end,details=excluded.details,last_seen_at=marker;

  insert into public.data_quality_issues(workspace_id,rule_key,entity_type,entity_id,severity,title_key,details,last_seen_at)
  select duplicate.workspace_id,config.rule_key,'CONTACT',duplicate.id,config.severity,'quality.rule.duplicateContact',jsonb_build_object('duplicateKey',duplicate.duplicate_key,'canonicalId',duplicate.canonical_id),marker
  from (
    select ranked.*,first_value(ranked.id) over(partition by ranked.workspace_id,ranked.duplicate_key order by ranked.created_at,ranked.id) canonical_id
    from (
      select c.*,coalesce(nullif(lower(c.email::text),''),nullif(regexp_replace(c.phone,'\D','','g'),'')) duplicate_key,
        count(*) over(partition by c.workspace_id,coalesce(nullif(lower(c.email::text),''),nullif(regexp_replace(c.phone,'\D','','g'),''))) duplicate_count
      from public.contacts c where c.workspace_id=ws
    ) ranked where ranked.duplicate_key is not null and ranked.duplicate_count>1
  ) duplicate join public.data_quality_rule_configs config on config.workspace_id=duplicate.workspace_id and config.rule_key='CONTACT_DUPLICATE' and config.enabled
  where duplicate.id<>duplicate.canonical_id
  on conflict(workspace_id,rule_key,entity_type,entity_id) do update set severity=excluded.severity,status=case when data_quality_issues.status='RESOLVED' then 'OPEN' else data_quality_issues.status end,details=excluded.details,last_seen_at=marker;

  insert into public.data_quality_issues(workspace_id,rule_key,entity_type,entity_id,severity,title_key,details,last_seen_at)
 select c.workspace_id,config.rule_key,'COHORT',c.id,config.severity,'quality.rule.COHORT_MISSING_APPLICATION_DEADLINE',jsonb_build_object('reference',c.id),marker
 from public.product_cohorts c join public.data_quality_rule_configs config on config.workspace_id=c.workspace_id and config.rule_key='COHORT_MISSING_APPLICATION_DEADLINE' and config.enabled
 where c.workspace_id=ws and (c.status in ('DRAFT','RECRUITING') and c.application_deadline is null) 
 on conflict(workspace_id,rule_key,entity_type,entity_id) do update set severity=excluded.severity,status=case when data_quality_issues.status='RESOLVED' then 'OPEN' else data_quality_issues.status end,details=excluded.details,last_seen_at=marker;
  insert into public.data_quality_issues(workspace_id,rule_key,entity_type,entity_id,severity,title_key,details,last_seen_at)
 select c.workspace_id,config.rule_key,'COHORT',c.id,config.severity,'quality.rule.COHORT_MISSING_OWNER',jsonb_build_object('reference',c.id),marker
 from public.product_cohorts c join public.data_quality_rule_configs config on config.workspace_id=c.workspace_id and config.rule_key='COHORT_MISSING_OWNER' and config.enabled
 where c.workspace_id=ws and (c.status in ('DRAFT','RECRUITING','ACTIVE') and c.owner_id is null) 
 on conflict(workspace_id,rule_key,entity_type,entity_id) do update set severity=excluded.severity,status=case when data_quality_issues.status='RESOLVED' then 'OPEN' else data_quality_issues.status end,details=excluded.details,last_seen_at=marker;
  insert into public.data_quality_issues(workspace_id,rule_key,entity_type,entity_id,severity,title_key,details,last_seen_at)
 select c.workspace_id,config.rule_key,'COHORT',c.id,config.severity,'quality.rule.COHORT_RECRUITING_AFTER_DEADLINE',jsonb_build_object('reference',c.id),marker
 from public.product_cohorts c join public.data_quality_rule_configs config on config.workspace_id=c.workspace_id and config.rule_key='COHORT_RECRUITING_AFTER_DEADLINE' and config.enabled
 where c.workspace_id=ws and (c.status='RECRUITING' and c.application_deadline<public.current_business_date()::date) 
 on conflict(workspace_id,rule_key,entity_type,entity_id) do update set severity=excluded.severity,status=case when data_quality_issues.status='RESOLVED' then 'OPEN' else data_quality_issues.status end,details=excluded.details,last_seen_at=marker;
  insert into public.data_quality_issues(workspace_id,rule_key,entity_type,entity_id,severity,title_key,details,last_seen_at)
 select c.workspace_id,config.rule_key,'COHORT',c.id,config.severity,'quality.rule.COHORT_ACTIVE_WITHOUT_START_DATE',jsonb_build_object('reference',c.id),marker
 from public.product_cohorts c join public.data_quality_rule_configs config on config.workspace_id=c.workspace_id and config.rule_key='COHORT_ACTIVE_WITHOUT_START_DATE' and config.enabled
 where c.workspace_id=ws and (c.status='ACTIVE' and c.start_on is null) 
 on conflict(workspace_id,rule_key,entity_type,entity_id) do update set severity=excluded.severity,status=case when data_quality_issues.status='RESOLVED' then 'OPEN' else data_quality_issues.status end,details=excluded.details,last_seen_at=marker;
  insert into public.data_quality_issues(workspace_id,rule_key,entity_type,entity_id,severity,title_key,details,last_seen_at)
 select c.workspace_id,config.rule_key,'COHORT',c.id,config.severity,'quality.rule.COHORT_COMPLETED_WITHOUT_END_DATE',jsonb_build_object('reference',c.id),marker
 from public.product_cohorts c join public.data_quality_rule_configs config on config.workspace_id=c.workspace_id and config.rule_key='COHORT_COMPLETED_WITHOUT_END_DATE' and config.enabled
 where c.workspace_id=ws and (c.status='COMPLETED' and c.end_on is null) 
 on conflict(workspace_id,rule_key,entity_type,entity_id) do update set severity=excluded.severity,status=case when data_quality_issues.status='RESOLVED' then 'OPEN' else data_quality_issues.status end,details=excluded.details,last_seen_at=marker;
  insert into public.data_quality_issues(workspace_id,rule_key,entity_type,entity_id,severity,title_key,details,last_seen_at)
 select c.workspace_id,config.rule_key,'ENROLLMENT',c.id,config.severity,'quality.rule.ENROLLMENT_MISSING_HOUSEHOLD',jsonb_build_object('reference',c.id),marker
 from public.student_enrollments c join public.data_quality_rule_configs config on config.workspace_id=c.workspace_id and config.rule_key='ENROLLMENT_MISSING_HOUSEHOLD' and config.enabled
 where c.workspace_id=ws and (c.status in ('REGISTERING','ACTIVE') and c.household_id is null) and public.student_enrollment_access(to_jsonb(c),false)
 on conflict(workspace_id,rule_key,entity_type,entity_id) do update set severity=excluded.severity,status=case when data_quality_issues.status='RESOLVED' then 'OPEN' else data_quality_issues.status end,details=excluded.details,last_seen_at=marker;
  insert into public.data_quality_issues(workspace_id,rule_key,entity_type,entity_id,severity,title_key,details,last_seen_at)
 select c.workspace_id,config.rule_key,'ENROLLMENT',c.id,config.severity,'quality.rule.ENROLLMENT_WITHOUT_PRIMARY_ATTRIBUTION',jsonb_build_object('reference',c.id),marker
 from public.student_enrollments c join public.data_quality_rule_configs config on config.workspace_id=c.workspace_id and config.rule_key='ENROLLMENT_WITHOUT_PRIMARY_ATTRIBUTION' and config.enabled
 where c.workspace_id=ws and (c.status in ('INTERESTED','REGISTERING','ACTIVE') and not exists(select 1 from public.enrollment_attributions a where a.enrollment_id=c.id and a.workspace_id=c.workspace_id and a.attribution_type='PRIMARY')) and public.student_enrollment_access(to_jsonb(c),false)
 on conflict(workspace_id,rule_key,entity_type,entity_id) do update set severity=excluded.severity,status=case when data_quality_issues.status='RESOLVED' then 'OPEN' else data_quality_issues.status end,details=excluded.details,last_seen_at=marker;
  insert into public.data_quality_issues(workspace_id,rule_key,entity_type,entity_id,severity,title_key,details,last_seen_at)
 select c.workspace_id,config.rule_key,'ENROLLMENT',c.id,config.severity,'quality.rule.ENROLLMENT_ACTIVE_WITHOUT_CONTRACT',jsonb_build_object('reference',c.id),marker
 from public.student_enrollments c join public.data_quality_rule_configs config on config.workspace_id=c.workspace_id and config.rule_key='ENROLLMENT_ACTIVE_WITHOUT_CONTRACT' and config.enabled
 where c.workspace_id=ws and (c.status='ACTIVE' and not exists(select 1 from public.contract_enrollment_links l where l.enrollment_id=c.id and l.workspace_id=c.workspace_id and l.status='ACTIVE')) and public.student_enrollment_access(to_jsonb(c),false)
 on conflict(workspace_id,rule_key,entity_type,entity_id) do update set severity=excluded.severity,status=case when data_quality_issues.status='RESOLVED' then 'OPEN' else data_quality_issues.status end,details=excluded.details,last_seen_at=marker;
  update public.data_quality_issues issue set status='RESOLVED',resolution_note='AUTO_RESOLVED',resolved_at=now(),resolved_by=app_auth.current_user_id()
  where issue.workspace_id=ws and issue.status in ('OPEN','ASSIGNED') and issue.last_seen_at<marker
    and issue.rule_key in (select rule_key from public.data_quality_rule_configs where workspace_id=ws);
  select count(*) into affected from public.data_quality_issues where workspace_id=ws and status in ('OPEN','ASSIGNED');
  return affected;
end;
$$;
