-- v2.1 workflow closure: safe progression, household pipelines, editable
-- education relationships, capability/RLS alignment, and suggestion deduplication.

-- ---------------------------------------------------------------------------
-- School and household opportunity subjects
-- ---------------------------------------------------------------------------

create unique index if not exists households_workspace_id_uidx
  on public.households(workspace_id,id);
create unique index if not exists students_workspace_id_uidx
  on public.students(workspace_id,id);
create unique index if not exists progression_batches_workspace_id_uidx
  on public.progression_batches(workspace_id,id);
create unique index if not exists leads_workspace_id_uidx
  on public.leads(workspace_id,id);

-- Every education/acquisition relationship must stay inside its workspace.
-- RLS protects the row itself; these composite FKs also protect referenced IDs.
do $$
begin
  if not exists(select 1 from pg_constraint where conname='household_members_workspace_household_fk') then
    alter table public.household_members add constraint household_members_workspace_household_fk
      foreign key(workspace_id,household_id) references public.households(workspace_id,id) not valid;
  end if;
  if not exists(select 1 from pg_constraint where conname='household_members_workspace_contact_fk') then
    alter table public.household_members add constraint household_members_workspace_contact_fk
      foreign key(workspace_id,contact_id) references public.contacts(workspace_id,id) not valid;
  end if;
  if not exists(select 1 from pg_constraint where conname='students_workspace_person_fk') then
    alter table public.students add constraint students_workspace_person_fk
      foreign key(workspace_id,person_id) references public.contacts(workspace_id,id) not valid;
  end if;
  if not exists(select 1 from pg_constraint where conname='students_workspace_household_fk') then
    alter table public.students add constraint students_workspace_household_fk
      foreign key(workspace_id,household_id) references public.households(workspace_id,id) not valid;
  end if;
  if not exists(select 1 from pg_constraint where conname='student_guardians_workspace_student_fk') then
    alter table public.student_guardian_relationships add constraint student_guardians_workspace_student_fk
      foreign key(workspace_id,student_id) references public.students(workspace_id,id) not valid;
  end if;
  if not exists(select 1 from pg_constraint where conname='student_guardians_workspace_contact_fk') then
    alter table public.student_guardian_relationships add constraint student_guardians_workspace_contact_fk
      foreign key(workspace_id,guardian_contact_id) references public.contacts(workspace_id,id) not valid;
  end if;
  if not exists(select 1 from pg_constraint where conname='student_academics_workspace_student_fk') then
    alter table public.student_academic_records add constraint student_academics_workspace_student_fk
      foreign key(workspace_id,student_id) references public.students(workspace_id,id) not valid;
  end if;
  if not exists(select 1 from pg_constraint where conname='student_academics_workspace_school_fk') then
    alter table public.student_academic_records add constraint student_academics_workspace_school_fk
      foreign key(workspace_id,school_id) references public.organizations(workspace_id,id) not valid;
  end if;
  if not exists(select 1 from pg_constraint where conname='progression_items_workspace_batch_fk') then
    alter table public.progression_batch_items add constraint progression_items_workspace_batch_fk
      foreign key(workspace_id,batch_id) references public.progression_batches(workspace_id,id) not valid;
  end if;
  if not exists(select 1 from pg_constraint where conname='progression_items_workspace_student_fk') then
    alter table public.progression_batch_items add constraint progression_items_workspace_student_fk
      foreign key(workspace_id,student_id) references public.students(workspace_id,id) not valid;
  end if;
  if not exists(select 1 from pg_constraint where conname='leads_workspace_organization_fk') then
    alter table public.leads add constraint leads_workspace_organization_fk
      foreign key(workspace_id,organization_id) references public.organizations(workspace_id,id) not valid;
  end if;
  if not exists(select 1 from pg_constraint where conname='leads_workspace_household_fk') then
    alter table public.leads add constraint leads_workspace_household_fk
      foreign key(workspace_id,household_id) references public.households(workspace_id,id) not valid;
  end if;
  if not exists(select 1 from pg_constraint where conname='lead_conversions_workspace_lead_fk') then
    alter table public.lead_conversions add constraint lead_conversions_workspace_lead_fk
      foreign key(workspace_id,lead_id) references public.leads(workspace_id,id) not valid;
  end if;
  if not exists(select 1 from pg_constraint where conname='lead_conversions_workspace_opportunity_fk') then
    alter table public.lead_conversions add constraint lead_conversions_workspace_opportunity_fk
      foreign key(workspace_id,opportunity_id) references public.opportunities(workspace_id,id) not valid;
  end if;
end
$$;

alter table public.household_members validate constraint household_members_workspace_household_fk;
alter table public.household_members validate constraint household_members_workspace_contact_fk;
alter table public.students validate constraint students_workspace_person_fk;
alter table public.students validate constraint students_workspace_household_fk;
alter table public.student_guardian_relationships validate constraint student_guardians_workspace_student_fk;
alter table public.student_guardian_relationships validate constraint student_guardians_workspace_contact_fk;
alter table public.student_academic_records validate constraint student_academics_workspace_student_fk;
alter table public.student_academic_records validate constraint student_academics_workspace_school_fk;
alter table public.progression_batch_items validate constraint progression_items_workspace_batch_fk;
alter table public.progression_batch_items validate constraint progression_items_workspace_student_fk;
alter table public.leads validate constraint leads_workspace_organization_fk;
alter table public.leads validate constraint leads_workspace_household_fk;
alter table public.lead_conversions validate constraint lead_conversions_workspace_lead_fk;
alter table public.lead_conversions validate constraint lead_conversions_workspace_opportunity_fk;

alter table public.opportunities alter column organization_id drop not null;
alter table public.opportunities add column if not exists household_id uuid;
alter table public.opportunities add column if not exists subject_type text;
alter table public.opportunities add column if not exists pipeline_key text;

update public.opportunities
set subject_type='SCHOOL',pipeline_key='SCHOOL_DEFAULT'
where subject_type is null or pipeline_key is null;

alter table public.opportunities alter column subject_type set default 'SCHOOL';
alter table public.opportunities alter column subject_type set not null;
alter table public.opportunities alter column pipeline_key set default 'SCHOOL_DEFAULT';
alter table public.opportunities alter column pipeline_key set not null;

do $$
begin
  if not exists(select 1 from pg_constraint where conname='opportunities_workspace_household_fk') then
    alter table public.opportunities add constraint opportunities_workspace_household_fk
      foreign key(workspace_id,household_id) references public.households(workspace_id,id) not valid;
  end if;
end
$$;

alter table public.opportunities drop constraint if exists opportunities_subject_check;
alter table public.opportunities add constraint opportunities_subject_check check(
  (subject_type='SCHOOL' and organization_id is not null and household_id is null and pipeline_key='SCHOOL_DEFAULT')
  or
  (subject_type='HOUSEHOLD' and household_id is not null and organization_id is null and pipeline_key='HOUSEHOLD_DEFAULT')
) not valid;
alter table public.opportunities validate constraint opportunities_subject_check;

create index if not exists opportunities_workspace_household_idx
  on public.opportunities(workspace_id,household_id,updated_at desc)
  where household_id is not null;

drop policy if exists "sales read leads" on public.leads;
create policy "sales read leads" on public.leads for select to authenticated
  using(public.is_workspace_member(workspace_id));
drop policy if exists "sales read lead conversions" on public.lead_conversions;
create policy "sales read lead conversions" on public.lead_conversions for select to authenticated
  using(public.is_workspace_member(workspace_id));

create or replace function public.convert_lead_to_opportunity(
  target_lead uuid,title_zh text,title_en text,amount numeric,currency text,p_idempotency_key text
) returns public.opportunities
language plpgsql security definer set search_path=public
as $$
declare lead public.leads; result public.opportunities; existing_id uuid;
begin
  if public.current_crm_role() not in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER','SALES_SPECIALIST') then
    raise exception 'lead_forbidden';
  end if;
  if nullif(trim(p_idempotency_key),'') is null then raise exception 'lead_idempotency_required'; end if;
  select lc.opportunity_id into existing_id from public.lead_conversions lc
    where lc.workspace_id=public.current_workspace_id() and lc.idempotency_key=trim(p_idempotency_key);
  if existing_id is not null then
    select * into result from public.opportunities
    where id=existing_id and workspace_id=public.current_workspace_id();
    return result;
  end if;
  select * into lead from public.leads
    where id=target_lead and workspace_id=public.current_workspace_id() for update;
  if not found then raise exception 'lead_not_found'; end if;
  if lead.status<>'QUALIFIED' then raise exception 'lead_not_convertible'; end if;
  insert into public.opportunities(
    workspace_id,organization_id,household_id,subject_type,pipeline_key,
    title_zh,title_en,amount,currency,owner_id,created_by,
    expected_close_date,next_action_zh,next_action_en
  ) values(
    lead.workspace_id,lead.organization_id,lead.household_id,lead.subject_type,lead.pipeline_key,
    trim(title_zh),trim(title_en),amount,upper(currency),lead.owner_id,auth.uid(),
    current_date+30,'联系线索主体确认需求与下一步','Contact the lead subject to confirm needs and next steps'
  ) returning * into result;
  insert into public.lead_conversions(
    workspace_id,lead_id,opportunity_id,evidence,idempotency_key
  ) values(
    lead.workspace_id,lead.id,result.id,
    jsonb_build_object(
      'score',lead.qualification_score,'source',lead.source,
      'subjectType',lead.subject_type,'pipeline',lead.pipeline_key
    ),
    trim(p_idempotency_key)
  );
  update public.leads set status='CONVERTED',converted_at=now(),updated_at=now()
  where id=lead.id;
  return result;
end;
$$;

-- ---------------------------------------------------------------------------
-- Configurable and reviewable student progression
-- ---------------------------------------------------------------------------

create table if not exists public.grade_progression_rules(
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default public.current_workspace_id() references public.workspaces(id),
  from_grade text not null,
  to_grade text not null,
  action text not null default 'ADVANCE' check(action in ('ADVANCE','GRADUATE')),
  active boolean not null default true,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check(nullif(trim(from_grade),'') is not null),
  check(nullif(trim(to_grade),'') is not null)
);
create unique index if not exists grade_progression_rules_active_uidx
  on public.grade_progression_rules(workspace_id,lower(trim(from_grade)))
  where active;
create index if not exists grade_progression_rules_workspace_idx
  on public.grade_progression_rules(workspace_id,active,from_grade);

alter table public.grade_progression_rules enable row level security;
create policy "leaders read progression rules" on public.grade_progression_rules for select to authenticated
  using(public.is_workspace_member(workspace_id) and public.current_crm_role() in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER'));
create policy "leaders manage progression rules" on public.grade_progression_rules for all to authenticated
  using(public.is_workspace_member(workspace_id) and public.current_crm_role() in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER'))
  with check(public.is_workspace_member(workspace_id) and public.current_crm_role() in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER'));

drop trigger if exists grade_progression_rules_audit on public.grade_progression_rules;
create trigger grade_progression_rules_audit
after insert or update or delete on public.grade_progression_rules
for each row execute procedure public.audit_row_change();

create or replace function public.seed_default_progression_rules(target_workspace uuid)
returns void
language plpgsql security definer set search_path=public
as $$
begin
  insert into public.grade_progression_rules(
    workspace_id,from_grade,to_grade,action,active,created_by
  )
  select target_workspace,format('%s',grade),
    case when grade=12 then 'ALUMNI' else format('%s',grade+1) end,
    case when grade=12 then 'GRADUATE' else 'ADVANCE' end,true,null::uuid
  from generate_series(1,12) grade
  union all
  select target_workspace,format('G%s',grade),
    case when grade=12 then 'ALUMNI' else format('G%s',grade+1) end,
    case when grade=12 then 'GRADUATE' else 'ADVANCE' end,true,null::uuid
  from generate_series(1,12) grade
  union all
  select target_workspace,format('Grade %s',grade),
    case when grade=12 then 'ALUMNI' else format('Grade %s',grade+1) end,
    case when grade=12 then 'GRADUATE' else 'ADVANCE' end,true,null::uuid
  from generate_series(1,12) grade
  union all
  select target_workspace,format('Year %s',grade),
    case when grade=13 then 'ALUMNI' else format('Year %s',grade+1) end,
    case when grade=13 then 'GRADUATE' else 'ADVANCE' end,true,null::uuid
  from generate_series(1,13) grade
  on conflict (workspace_id,lower(trim(from_grade))) where active do nothing;
end;
$$;

select public.seed_default_progression_rules(id) from public.workspaces;

create or replace function public.seed_progression_rules_for_workspace()
returns trigger language plpgsql security definer set search_path=public
as $$
begin
  perform public.seed_default_progression_rules(new.id);
  return new;
end;
$$;
drop trigger if exists workspace_seed_progression_rules on public.workspaces;
create trigger workspace_seed_progression_rules
after insert on public.workspaces for each row execute procedure public.seed_progression_rules_for_workspace();

alter table public.progression_batches add column if not exists apply_idempotency_key text;
alter table public.progression_batches add column if not exists cancelled_at timestamptz;
alter table public.progression_batches drop constraint if exists progression_batches_status_check;
alter table public.progression_batches add constraint progression_batches_status_check
  check(status in ('DRAFT','PREVIEWED','APPLIED','PARTIAL_FAILED','CANCELLED'));

alter table public.progression_batch_items add column if not exists student_updated_at timestamptz;
alter table public.progression_batch_items add column if not exists reason text not null default '';
update public.progression_batch_items item
set student_updated_at=student.updated_at
from public.students student
where student.id=item.student_id and item.student_updated_at is null;
alter table public.progression_batch_items alter column student_updated_at set not null;

create or replace function public.save_progression_rule(
  target_rule uuid,source_grade text,destination_grade text,rule_action text,rule_active boolean
) returns public.grade_progression_rules
language plpgsql security definer set search_path=public
as $$
declare result public.grade_progression_rules;
begin
  if public.current_crm_role() not in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER') then
    raise exception 'progression_forbidden';
  end if;
  if nullif(trim(source_grade),'') is null or nullif(trim(destination_grade),'') is null
    or upper(trim(rule_action)) not in ('ADVANCE','GRADUATE') then
    raise exception 'progression_rule_invalid';
  end if;
  if target_rule is null then
    insert into public.grade_progression_rules(
      workspace_id,from_grade,to_grade,action,active,created_by
    ) values(
      public.current_workspace_id(),trim(source_grade),trim(destination_grade),
      upper(trim(rule_action)),rule_active,auth.uid()
    ) returning * into result;
  else
    update public.grade_progression_rules set
      from_grade=trim(source_grade),to_grade=trim(destination_grade),
      action=upper(trim(rule_action)),active=rule_active,updated_at=now()
    where id=target_rule and workspace_id=public.current_workspace_id()
    returning * into result;
    if not found then raise exception 'progression_rule_not_found'; end if;
  end if;
  return result;
end;
$$;

create or replace function public.preview_student_progression(
  from_year text,to_year text,p_idempotency_key text
) returns public.progression_batches
language plpgsql security definer set search_path=public
as $$
declare result public.progression_batches; ws uuid:=public.current_workspace_id(); actor_role text:=public.current_crm_role();
begin
  if ws is null or actor_role not in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER') then
    raise exception 'progression_forbidden';
  end if;
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

create or replace function public.update_progression_batch_item(
  target_item uuid,item_selected boolean,destination_grade text,item_action text,item_reason text
) returns public.progression_batch_items
language plpgsql security definer set search_path=public
as $$
declare result public.progression_batch_items; batch_status text; normalized_action text:=upper(trim(coalesce(item_action,'')));
begin
  if public.current_crm_role() not in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER') then
    raise exception 'progression_forbidden';
  end if;
  if normalized_action not in ('ADVANCE','GRADUATE','HOLD')
    or nullif(trim(destination_grade),'') is null then
    raise exception 'progression_item_invalid';
  end if;
  select batch.status into batch_status
  from public.progression_batch_items item
  join public.progression_batches batch on batch.id=item.batch_id and batch.workspace_id=item.workspace_id
  where item.id=target_item and item.workspace_id=public.current_workspace_id()
  for update of item;
  if not found then raise exception 'progression_item_not_found'; end if;
  if batch_status<>'PREVIEWED' then raise exception 'progression_not_editable'; end if;
  update public.progression_batch_items set
    selected=case when normalized_action='HOLD' then false else item_selected end,
    to_grade=trim(destination_grade),action=normalized_action,
    reason=trim(coalesce(item_reason,'')),
    error_code=case when normalized_action='HOLD' then 'MANUAL_HOLD' else null end
  where id=target_item and workspace_id=public.current_workspace_id()
  returning * into result;
  return result;
end;
$$;

create or replace function public.cancel_student_progression(target_batch uuid)
returns public.progression_batches
language plpgsql security definer set search_path=public
as $$
declare result public.progression_batches;
begin
  if public.current_crm_role() not in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER') then
    raise exception 'progression_forbidden';
  end if;
  select * into result from public.progression_batches
  where id=target_batch and workspace_id=public.current_workspace_id() for update;
  if not found then raise exception 'progression_not_found'; end if;
  if result.status='CANCELLED' then return result; end if;
  if result.status<>'PREVIEWED' then raise exception 'progression_not_cancellable'; end if;
  update public.progression_batches set status='CANCELLED',cancelled_at=now()
  where id=result.id returning * into result;
  update public.progression_batch_items set status='SKIPPED'
  where batch_id=result.id and status='PENDING';
  return result;
end;
$$;

create or replace function public.apply_student_progression(target_batch uuid,p_idempotency_key text)
returns public.progression_batches language plpgsql security definer set search_path=public
as $$
declare
  result public.progression_batches;
  item public.progression_batch_items;
  academic public.student_academic_records;
  has_academic boolean;
  failed_count integer:=0;
begin
  if public.current_crm_role() not in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER') then
    raise exception 'progression_forbidden';
  end if;
  if nullif(trim(p_idempotency_key),'') is null then raise exception 'progression_idempotency_required'; end if;
  select * into result from public.progression_batches
    where id=target_batch and workspace_id=public.current_workspace_id() for update;
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
      valid_from,valid_to,status,created_by
    ) values(
      result.workspace_id,item.student_id,
      case when has_academic then academic.school_id else null end,
      case when has_academic then academic.curriculum else 'UNSPECIFIED' end,
      case when item.action='GRADUATE' then item.from_grade else item.to_grade end,
      result.to_academic_year,current_date,
      case when item.action='GRADUATE' then current_date else null end,
      case when item.action='GRADUATE' then 'COMPLETED' else 'CURRENT' end,
      auth.uid()
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

  update public.progression_batch_items set status='SKIPPED'
  where batch_id=result.id and status='PENDING';
  update public.progression_batches set
    status=case when failed_count>0 then 'PARTIAL_FAILED' else 'APPLIED' end,
    applied_at=now()
  where id=result.id returning * into result;
  return result;
end;
$$;

-- ---------------------------------------------------------------------------
-- Editable household members and student guardians
-- ---------------------------------------------------------------------------

create unique index if not exists household_members_primary_uidx
  on public.household_members(household_id) where primary_contact;
create unique index if not exists student_guardians_primary_uidx
  on public.student_guardian_relationships(student_id) where primary_guardian;

create or replace function public.save_household_member(
  target_household uuid,target_contact uuid,member_role_value text,is_primary boolean
) returns public.household_members
language plpgsql security definer set search_path=public
as $$
declare result public.household_members; ws uuid:=public.current_workspace_id(); normalized_role text:=upper(trim(coalesce(member_role_value,'')));
begin
  if public.current_crm_role() not in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER','SALES_SPECIALIST','SALES_SUPPORT')
    or normalized_role not in ('PARENT','GUARDIAN','STUDENT','PAYER','OTHER') then
    raise exception 'education_relationship_forbidden';
  end if;
  if not exists(select 1 from public.households where id=target_household and workspace_id=ws and archived_at is null)
    or not exists(select 1 from public.contacts where id=target_contact and workspace_id=ws and archived_at is null) then
    raise exception 'education_relationship_subject_not_found';
  end if;
  if is_primary then
    update public.household_members set primary_contact=false
    where workspace_id=ws and household_id=target_household and contact_id<>target_contact and primary_contact;
  end if;
  insert into public.household_members(
    workspace_id,household_id,contact_id,member_role,primary_contact,created_by
  ) values(ws,target_household,target_contact,normalized_role,is_primary,auth.uid())
  on conflict(household_id,contact_id) do update set
    member_role=excluded.member_role,primary_contact=excluded.primary_contact
  returning * into result;
  return result;
end;
$$;

create or replace function public.remove_household_member(target_member uuid)
returns void language plpgsql security definer set search_path=public
as $$
declare is_primary boolean;
begin
  if public.current_crm_role() not in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER','SALES_SPECIALIST','SALES_SUPPORT') then
    raise exception 'education_relationship_forbidden';
  end if;
  select primary_contact into is_primary from public.household_members
  where id=target_member and workspace_id=public.current_workspace_id() for update;
  if not found then raise exception 'education_relationship_not_found'; end if;
  if is_primary then raise exception 'education_primary_replacement_required'; end if;
  delete from public.household_members
  where id=target_member and workspace_id=public.current_workspace_id();
end;
$$;

create or replace function public.save_student_guardian(
  target_student uuid,target_contact uuid,relationship_value text,
  is_primary boolean,is_emergency boolean,has_legal_authority boolean
) returns public.student_guardian_relationships
language plpgsql security definer set search_path=public
as $$
declare result public.student_guardian_relationships; ws uuid:=public.current_workspace_id(); normalized_relationship text:=upper(trim(coalesce(relationship_value,'')));
begin
  if public.current_crm_role() not in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER','SALES_SPECIALIST','SALES_SUPPORT')
    or normalized_relationship not in ('MOTHER','FATHER','GUARDIAN','RELATIVE','OTHER') then
    raise exception 'education_relationship_forbidden';
  end if;
  if not exists(select 1 from public.students where id=target_student and workspace_id=ws and archived_at is null)
    or not exists(select 1 from public.contacts where id=target_contact and workspace_id=ws and archived_at is null) then
    raise exception 'education_relationship_subject_not_found';
  end if;
  if is_primary then
    update public.student_guardian_relationships set primary_guardian=false
    where workspace_id=ws and student_id=target_student
      and guardian_contact_id<>target_contact and primary_guardian;
  end if;
  insert into public.student_guardian_relationships(
    workspace_id,student_id,guardian_contact_id,relationship_type,
    primary_guardian,emergency_contact,legal_authority,created_by
  ) values(
    ws,target_student,target_contact,normalized_relationship,
    is_primary,is_emergency,has_legal_authority,auth.uid()
  )
  on conflict(student_id,guardian_contact_id) do update set
    relationship_type=excluded.relationship_type,
    primary_guardian=excluded.primary_guardian,
    emergency_contact=excluded.emergency_contact,
    legal_authority=excluded.legal_authority
  returning * into result;
  return result;
end;
$$;

create or replace function public.remove_student_guardian(target_relationship uuid)
returns void language plpgsql security definer set search_path=public
as $$
declare is_primary boolean;
begin
  if public.current_crm_role() not in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER','SALES_SPECIALIST','SALES_SUPPORT') then
    raise exception 'education_relationship_forbidden';
  end if;
  select primary_guardian into is_primary from public.student_guardian_relationships
  where id=target_relationship and workspace_id=public.current_workspace_id() for update;
  if not found then raise exception 'education_relationship_not_found'; end if;
  if is_primary then raise exception 'education_primary_replacement_required'; end if;
  delete from public.student_guardian_relationships
  where id=target_relationship and workspace_id=public.current_workspace_id();
end;
$$;

-- ---------------------------------------------------------------------------
-- User-owned, deduplicated suggestion inbox
-- ---------------------------------------------------------------------------

alter table public.ai_suggestions add column if not exists owner_id uuid references auth.users(id);
update public.ai_suggestions suggestion
set owner_id=run.created_by
from public.ai_suggestion_runs run
where run.id=suggestion.run_id and suggestion.owner_id is null;
alter table public.ai_suggestions alter column owner_id set default auth.uid();
alter table public.ai_suggestions alter column owner_id set not null;

with ranked as (
  select id,row_number() over(
    partition by workspace_id,owner_id,subject_type,subject_id
    order by created_at desc,id desc
  ) sequence
  from public.ai_suggestions
  where status='OPEN'
)
update public.ai_suggestions suggestion set status='EXPIRED'
from ranked where ranked.id=suggestion.id
  and (ranked.sequence>1 or suggestion.expires_at<=now());

create unique index if not exists ai_suggestions_owner_open_uidx
  on public.ai_suggestions(workspace_id,owner_id,subject_type,subject_id)
  where status='OPEN';

drop policy if exists "members read suggestions" on public.ai_suggestions;
create policy "members read suggestions" on public.ai_suggestions for select to authenticated
  using(public.is_workspace_member(workspace_id) and owner_id=auth.uid());

create or replace function public.generate_rule_suggestions()
returns setof public.ai_suggestions
language plpgsql security definer set search_path=public
as $$
declare run public.ai_suggestion_runs; ws uuid:=public.current_workspace_id();
begin
  if ws is null then raise exception 'suggestion_forbidden'; end if;
  update public.ai_suggestions set status='EXPIRED'
  where workspace_id=ws and owner_id=auth.uid() and status='OPEN' and expires_at<=now();
  insert into public.ai_suggestion_runs(
    workspace_id,rule_version,input_digest,input_summary,status,external_data_sent,completed_at
  ) values(
    ws,'v2.1.0',
    encode(extensions.digest(ws::text||auth.uid()::text||current_date::text,'sha256'),'hex'),
    jsonb_build_object('evaluatedAt',now(),'sources',jsonb_build_array('contracts')),
    'COMPLETED',false,now()
  ) returning * into run;
  insert into public.ai_suggestions(
    workspace_id,run_id,owner_id,subject_type,subject_id,
    recommendation_zh,recommendation_en,evidence,confidence
  )
  select run.workspace_id,run.id,auth.uid(),'CONTRACT',contract.id,
    '合同将在 45 天内到期，建议确认续约会议与下一步。',
    'This contract expires within 45 days. Confirm a renewal meeting and next step.',
    jsonb_build_array(jsonb_build_object('type','CONTRACT_END_DATE','value',contract.end_date)),0.820
  from public.contracts contract
  where contract.workspace_id=run.workspace_id
    and contract.status in ('ACTIVE','RENEWAL_PREP','RISK')
    and contract.end_date between current_date and current_date+45
    and not exists(
      select 1 from public.ai_suggestions existing
      where existing.workspace_id=run.workspace_id and existing.owner_id=auth.uid()
        and existing.subject_type='CONTRACT' and existing.subject_id=contract.id
        and existing.status='OPEN' and existing.expires_at>now()
    );
  return query select * from public.ai_suggestions
  where run_id=run.id order by confidence desc;
end;
$$;

-- ---------------------------------------------------------------------------
-- Dashboard education and acquisition signals
-- ---------------------------------------------------------------------------

create or replace function public.dashboard_snapshot(reporting_timezone text default null)
returns jsonb
language plpgsql stable security definer set search_path=public
as $$
declare
  ws uuid:=public.current_workspace_id();
  actor_role text:=public.current_crm_role();
  elevated boolean:=actor_role in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR');
  progression_visible boolean:=actor_role in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER');
  tz text;
  local_today date;
  month_start timestamptz;
  result jsonb;
begin
  if ws is null then raise exception 'dashboard_not_authorized'; end if;
  select coalesce(nullif(reporting_timezone,''),preference.timezone,'Asia/Taipei') into tz
  from (select 1) seed
  left join public.user_preferences preference on preference.user_id=auth.uid();
  if not exists(select 1 from pg_timezone_names where name=tz) then tz:='Asia/Taipei'; end if;
  local_today:=(now() at time zone tz)::date;
  month_start:=date_trunc('month',now() at time zone tz) at time zone tz;
  select jsonb_build_object(
    'todayTasks',(select count(*) from public.crm_tasks where workspace_id=ws and owner_id=auth.uid() and status<>'DONE' and (due_at at time zone tz)::date=local_today),
    'overdueTasks',(select count(*) from public.crm_tasks where workspace_id=ws and owner_id=auth.uid() and status<>'DONE' and due_at<now()),
    'pendingApprovals',(select count(*) from public.approval_requests where workspace_id=ws and status='PENDING' and (elevated or requester_id=auth.uid())),
    'renewalsDue',(select count(*) from public.contracts where workspace_id=ws and status in ('ACTIVE','RENEWAL_PREP','NEGOTIATING','RISK') and end_date between local_today and local_today+90 and (elevated or owner_id=auth.uid())),
    'riskContracts',(select count(*) from public.contracts where workspace_id=ws and status='RISK' and (elevated or owner_id=auth.uid())),
    'activeProducts',(select count(*) from public.products where workspace_id=ws and active),
    'unreadNotifications',(select count(*) from public.user_notifications where workspace_id=ws and user_id=auth.uid() and read_at is null),
    'newLeads',(select count(*) from public.leads where workspace_id=ws and (created_at at time zone tz)::date>=local_today-30),
    'activeStudents',(select count(*) from public.students where workspace_id=ws and status='ACTIVE'),
    'pendingProgression',case when progression_visible then
      (select count(*) from public.progression_batches where workspace_id=ws and status='PREVIEWED')
      else 0 end,
    'monthRevenueByCurrency',coalesce((select jsonb_object_agg(currency,total) from (
      select payment.currency,sum(payment.amount) total
      from public.payments payment join public.contracts contract on contract.id=payment.contract_id
      where payment.workspace_id=ws and payment.status='CONFIRMED'
        and payment.paid_at>=month_start and (elevated or contract.owner_id=auth.uid())
      group by payment.currency
    ) revenue),'{}'::jsonb),
    'focusTasks',coalesce((select jsonb_agg(jsonb_build_object(
      'id',id,'titleZh',title_zh,'titleEn',title_en,'related',related_label,
      'status',status,'priority',priority,'dueAt',due_at
    ) order by due_at nulls last) from (
      select id,title_zh,title_en,related_label,status,priority,due_at
      from public.crm_tasks where workspace_id=ws and owner_id=auth.uid() and status<>'DONE'
      order by due_at nulls last limit 6
    ) tasks),'[]'::jsonb)
  ) into result;
  return result;
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------

revoke all on function public.seed_default_progression_rules(uuid),
  public.seed_progression_rules_for_workspace(),
  public.save_progression_rule(uuid,text,text,text,boolean),
  public.update_progression_batch_item(uuid,boolean,text,text,text),
  public.cancel_student_progression(uuid),
  public.save_household_member(uuid,uuid,text,boolean),
  public.remove_household_member(uuid),
  public.save_student_guardian(uuid,uuid,text,boolean,boolean,boolean),
  public.remove_student_guardian(uuid)
from public,anon;

grant execute on function public.save_progression_rule(uuid,text,text,text,boolean),
  public.update_progression_batch_item(uuid,boolean,text,text,text),
  public.cancel_student_progression(uuid),
  public.save_household_member(uuid,uuid,text,boolean),
  public.remove_household_member(uuid),
  public.save_student_guardian(uuid,uuid,text,boolean,boolean,boolean),
  public.remove_student_guardian(uuid)
to authenticated;

grant select,insert,update on public.grade_progression_rules to authenticated;
