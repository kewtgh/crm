-- v0.9.0: keep every import execution and rollback lookup explicitly bound to
-- the batch workspace, even after duplicate-target preflight validation.

create or replace function public.process_import_batch(
  target_batch uuid,batch_size integer default 50
)
returns public.import_batches
language plpgsql
security definer
set search_path=public
as $$
declare
  batch public.import_batches;
  item public.import_rows;
  entity_id uuid;
  before_row jsonb;
  after_row jsonb;
begin
  select * into batch from public.import_batches
    where id=target_batch and workspace_id=public.current_workspace_id()
      and created_by=auth.uid() for update;
  if not found or batch.status not in ('READY','PROCESSING','PARTIAL_FAILED')
    or exists(
      select 1 from public.import_rows
      where batch_id=batch.id and workspace_id=batch.workspace_id and status='DUPLICATE'
    ) then
    raise exception 'import_not_ready';
  end if;
  update public.import_batches set status='PROCESSING',updated_at=now()
    where id=batch.id and workspace_id=batch.workspace_id;

  for item in
    select * from public.import_rows
    where batch_id=batch.id and workspace_id=batch.workspace_id
      and status in ('VALID','DECIDED')
    order by row_number for update skip locked
    limit greatest(1,least(batch_size,100))
  loop
    begin
      entity_id:=null;
      before_row:=null;
      if coalesce(item.decision,'CREATE')='CREATE' and batch.resource_type='CONTACTS' then
        insert into public.contacts(
          workspace_id,name_zh,name_en,email,phone,title,status,owner_id,created_by
        ) values(
          batch.workspace_id,item.normalized_data->>'nameZh',item.normalized_data->>'nameEn',
          nullif(item.normalized_data->>'email','')::citext,
          nullif(item.normalized_data->>'phone',''),item.normalized_data->>'title',
          'UNVERIFIED',auth.uid(),auth.uid()
        ) returning id into entity_id;
      elsif coalesce(item.decision,'CREATE')='CREATE' then
        insert into public.organizations(
          workspace_id,name_zh,name_en,city,status,owner_id,created_by
        ) values(
          batch.workspace_id,item.normalized_data->>'nameZh',item.normalized_data->>'nameEn',
          item.normalized_data->>'city','UNVERIFIED',auth.uid(),auth.uid()
        ) returning id into entity_id;
      elsif item.decision in ('UPDATE','MERGE') and batch.resource_type='CONTACTS' then
        select to_jsonb(c) into before_row from public.contacts c
          where id=item.duplicate_entity_id and workspace_id=batch.workspace_id for update;
        if not found then raise exception 'import_duplicate_scope_invalid'; end if;
        update public.contacts set
          name_zh=item.normalized_data->>'nameZh',
          name_en=item.normalized_data->>'nameEn',
          email=coalesce(nullif(item.normalized_data->>'email','')::citext,email),
          phone=coalesce(nullif(item.normalized_data->>'phone',''),phone),
          title=coalesce(nullif(item.normalized_data->>'title',''),title),
          updated_at=now()
        where id=item.duplicate_entity_id and workspace_id=batch.workspace_id
        returning id into entity_id;
      elsif item.decision in ('UPDATE','MERGE') then
        select to_jsonb(o) into before_row from public.organizations o
          where id=item.duplicate_entity_id and workspace_id=batch.workspace_id for update;
        if not found then raise exception 'import_duplicate_scope_invalid'; end if;
        update public.organizations set
          name_zh=item.normalized_data->>'nameZh',
          name_en=item.normalized_data->>'nameEn',
          city=coalesce(nullif(item.normalized_data->>'city',''),city),
          updated_at=now()
        where id=item.duplicate_entity_id and workspace_id=batch.workspace_id
        returning id into entity_id;
      end if;
      if batch.resource_type='CONTACTS' then
        select to_jsonb(c) into after_row from public.contacts c
          where id=entity_id and workspace_id=batch.workspace_id;
      else
        select to_jsonb(o) into after_row from public.organizations o
          where id=entity_id and workspace_id=batch.workspace_id;
      end if;
      update public.import_rows set
        status='APPLIED',applied_entity_id=entity_id,before_snapshot=before_row,
        after_snapshot=after_row,applied_at=now(),last_error=null
      where id=item.id and workspace_id=batch.workspace_id;
    exception when others then
      update public.import_rows set status='FAILED',last_error=left(sqlerrm,500)
        where id=item.id and workspace_id=batch.workspace_id;
    end;
  end loop;

  update public.import_batches b set
    applied_rows=(
      select count(*) from public.import_rows
      where batch_id=b.id and workspace_id=b.workspace_id and status='APPLIED'
    ),
    failed_rows=(
      select count(*) from public.import_rows
      where batch_id=b.id and workspace_id=b.workspace_id and status='FAILED'
    ),
    status=case
      when exists(
        select 1 from public.import_rows
        where batch_id=b.id and workspace_id=b.workspace_id and status in ('VALID','DECIDED')
      ) then 'PROCESSING'
      when exists(
        select 1 from public.import_rows
        where batch_id=b.id and workspace_id=b.workspace_id and status in ('INVALID','FAILED')
      ) then 'PARTIAL_FAILED'
      else 'COMPLETED' end,
    completed_at=case when not exists(
      select 1 from public.import_rows
      where batch_id=b.id and workspace_id=b.workspace_id and status in ('VALID','DECIDED')
    ) then now() end,
    updated_at=now()
  where b.id=batch.id and b.workspace_id=batch.workspace_id
  returning * into batch;
  return batch;
end;
$$;

create or replace function public.rollback_import_batch(target_batch uuid)
returns public.import_batches
language plpgsql
security definer
set search_path=public
as $$
declare
  batch public.import_batches;
  item public.import_rows;
  current_row jsonb;
begin
  select * into batch from public.import_batches
    where id=target_batch and workspace_id=public.current_workspace_id()
      and created_by=auth.uid() and status in ('COMPLETED','PARTIAL_FAILED') for update;
  if not found then raise exception 'import_not_rollbackable'; end if;

  for item in
    select * from public.import_rows
    where batch_id=batch.id and workspace_id=batch.workspace_id and status='APPLIED'
    order by row_number desc for update
  loop
    if batch.resource_type='CONTACTS' then
      select to_jsonb(c) into current_row from public.contacts c
        where id=item.applied_entity_id and workspace_id=batch.workspace_id for update;
    else
      select to_jsonb(o) into current_row from public.organizations o
        where id=item.applied_entity_id and workspace_id=batch.workspace_id for update;
    end if;
    if not found then raise exception 'import_rollback_target_missing'; end if;
    if (current_row->>'updated_at') is distinct from (item.after_snapshot->>'updated_at') then
      raise exception 'import_rollback_conflict_row_%',item.row_number;
    end if;
    if item.before_snapshot is null then
      if batch.resource_type='CONTACTS' then
        delete from public.contacts
          where id=item.applied_entity_id and workspace_id=batch.workspace_id;
      else
        delete from public.organizations
          where id=item.applied_entity_id and workspace_id=batch.workspace_id;
      end if;
    elsif batch.resource_type='CONTACTS' then
      update public.contacts set
        name_zh=item.before_snapshot->>'name_zh',
        name_en=item.before_snapshot->>'name_en',
        email=nullif(item.before_snapshot->>'email','')::citext,
        phone=item.before_snapshot->>'phone',
        title=coalesce(item.before_snapshot->>'title',''),
        status=item.before_snapshot->>'status',
        updated_at=(item.before_snapshot->>'updated_at')::timestamptz
      where id=item.applied_entity_id and workspace_id=batch.workspace_id;
    else
      update public.organizations set
        name_zh=item.before_snapshot->>'name_zh',
        name_en=item.before_snapshot->>'name_en',
        city=coalesce(item.before_snapshot->>'city',''),
        curriculum=coalesce(item.before_snapshot->>'curriculum',''),
        status=item.before_snapshot->>'status',
        updated_at=(item.before_snapshot->>'updated_at')::timestamptz
      where id=item.applied_entity_id and workspace_id=batch.workspace_id;
    end if;
    update public.import_rows set status='ROLLED_BACK'
      where id=item.id and workspace_id=batch.workspace_id;
  end loop;
  update public.import_batches set status='ROLLED_BACK',rolled_back_at=now(),updated_at=now()
    where id=batch.id and workspace_id=batch.workspace_id returning * into batch;
  return batch;
end;
$$;
