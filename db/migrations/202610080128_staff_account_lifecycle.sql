-- Controlled removal after suspension and clearing current business links. History is never
-- cascaded by this command. Catalog inspection fails closed for new references.
set search_path=public,app_auth,extensions;
alter table app_auth.accounts add column purged_at timestamptz;
-- The only legacy actor UUID lacking an FK: enforce new references without
-- guessing or rewriting existing receipt history. Account row locks then protect
-- the deletion race just as for all other account/member foreign keys.
alter table public.uploaded_contract_receipts add constraint uploaded_receipt_actor_account_fk foreign key(actor_id) references app_auth.accounts(id) on delete restrict not valid;
-- A retained audit UUID is not a reusable employee. Check new/changed FK values
-- under an account lock so a concurrent writer cannot attach it after removal.
create function public.guard_removed_staff_reference() returns trigger
language plpgsql security definer set search_path=public,app_auth as $$
declare column_name text; linked uuid; removed_at timestamptz;
begin
 foreach column_name in array tg_argv loop
  if tg_op='UPDATE' and (to_jsonb(new)->column_name) is not distinct from (to_jsonb(old)->column_name) then continue;end if;
  linked:=(to_jsonb(new)->>column_name)::uuid;
  if linked is null then continue;end if;
  select purged_at into removed_at from app_auth.accounts where id=linked for key share;
  if removed_at is not null then raise exception 'STAFF_IDENTITY_REMOVED';end if;
 end loop;
 return new;
end $$;
do $$declare relation record;arguments text;begin
 for relation in select n.nspname,c.relname,array_agg(distinct a.attname order by a.attname) columns
 from pg_constraint fk join pg_class c on c.oid=fk.conrelid join pg_namespace n on n.oid=c.relnamespace
 join pg_attribute a on a.attrelid=c.oid and a.attnum=any(fk.conkey)
 where fk.contype='f' and fk.confrelid='app_auth.accounts'::regclass and n.nspname in('public','app_auth') group by n.nspname,c.relname loop
  select string_agg(quote_literal(name),',') into arguments from unnest(relation.columns) name;
  execute format('create trigger guard_removed_staff_reference before insert or update on %I.%I for each row execute function public.guard_removed_staff_reference(%s)',relation.nspname,relation.relname,arguments);
 end loop;
end $$;
create function public.staff_lifecycle_eligibility(target_user uuid) returns jsonb
language plpgsql security definer set search_path=public,app_auth,extensions as $$
declare ws uuid:=public.current_workspace_id(); actor uuid:=app_auth.current_user_id();
 actor_role text; target_role text; identities uuid[]; reference record; present boolean; retain_audit_identity boolean:=false;
begin
 if current_setting('app.aal',true) is distinct from 'aal2' then raise exception 'MFA_REQUIRED';end if;
 if actor is null or not public.is_workspace_member(ws) then raise exception 'ROLE_ASSIGNMENT_FORBIDDEN';end if;
 perform pg_advisory_xact_lock(hashtextextended(ws::text||':staff-identity',0));
 perform 1 from public.workspace_memberships where workspace_id=ws and user_id in(actor,target_user) order by user_id for update;
 select role into actor_role from public.workspace_memberships where workspace_id=ws and user_id=actor and status='ACTIVE';
 if actor_role is null or actor_role not in ('ADMIN','SUPER_ADMIN') then raise exception 'ROLE_ASSIGNMENT_FORBIDDEN';end if;
 select role into target_role from public.workspace_memberships where workspace_id=ws and user_id=target_user;
 if not found then raise exception 'STAFF_USER_NOT_FOUND';end if;
 if target_user=actor or (actor_role='ADMIN' and target_role in('ADMIN','SUPER_ADMIN')) then return jsonb_build_object('status','PROTECTED_ACCOUNT');end if;
 if target_role='SUPER_ADMIN' and not exists(select 1 from public.workspace_memberships m join app_auth.accounts a on a.id=m.user_id where m.workspace_id=ws and m.user_id<>target_user and m.role='SUPER_ADMIN' and m.status='ACTIVE' and a.status='ACTIVE') then return jsonb_build_object('status','PROTECTED_ACCOUNT');end if;
 perform 1 from app_auth.accounts where id=target_user for update;
 if exists(select 1 from app_auth.accounts where id=target_user and status<>'SUSPENDED') or exists(select 1 from public.workspace_memberships where workspace_id=ws and user_id=target_user and status<>'SUSPENDED') then return jsonb_build_object('status','DEACTIVATION_REQUIRED');end if;
 perform 1 from public.user_profiles where user_id=target_user for update;
 perform 1 from public.sales_team_members where auth_user_id=target_user order by id for update;
 if (select count(*) from public.workspace_memberships where user_id=target_user)>1 then return jsonb_build_object('status','MULTI_WORKSPACE_ACCOUNT');end if;
 if exists(select 1 from public.enterprise_directory_users where auth_user_id=target_user) then return jsonb_build_object('status','EXTERNALLY_MANAGED_ACCOUNT');end if;
 perform 1 from public.notification_outbox where recipient_id=target_user order by id for update;
 if exists(select 1 from public.notification_outbox where recipient_id=target_user and status='SENDING') then return jsonb_build_object('status','INVITATION_IN_FLIGHT');end if;
 select array_agg(id) into identities from (select target_user id union select id from public.sales_team_members where auth_user_id=target_user) ids;
 -- Retained staff creation audits are scaffolding; other entity references block.
 if exists(select 1 from public.audit_events where entity_id::text=any(array(select x::text from unnest(identities) x)) and not ((entity_type='staff_user' and action in('CREATE','INVITATION_QUEUED','ROLE_CHANGE','STATUS_CHANGE','STAFF_PROFILE_CHANGE','UPDATE')) or (entity_type='user_preferences' and action in('INSERT','UPDATE','DELETE')))) then return jsonb_build_object('status','BUSINESS_REFERENCES_EXIST');end if;
 -- Inspect all UUID columns, including legacy ownership columns without FKs.
 -- Only explicit personal scaffolding is disposable. Unknown references block.
 for reference in select n.nspname schema_name,c.relname table_name,a.attname column_name
  from pg_class c join pg_namespace n on n.oid=c.relnamespace join pg_attribute a on a.attrelid=c.oid
  where n.nspname in('public','app_auth') and c.relkind in('r','p') and a.attnum>0 and not a.attisdropped and a.atttypid='uuid'::regtype
  order by n.nspname,c.relname,a.attname loop
  if reference.schema_name='app_auth' and reference.table_name in('accounts','password_credentials','sessions','email_tokens','totp_factors','login_events','trusted_devices') then continue;end if;
  if (reference.table_name,reference.column_name) in (('user_profiles','user_id'),('workspace_memberships','user_id'),('sales_team_members','id'),('sales_team_members','auth_user_id'),('sales_team_memberships','member_id'),('staff_invitation_deliveries','user_id'),('user_preferences','user_id'),('user_notifications','user_id'),('trusted_login_devices','user_id'),('staff_business_profiles','member_id')) then continue;end if;
  if reference.table_name='notification_outbox' and reference.column_name='recipient_id' then
   select exists(select 1 from public.notification_outbox where recipient_id=target_user and template_key<>'staff-account-created') into present;
  elsif reference.table_name='audit_events' and reference.column_name='entity_id' then
   select exists(select 1 from public.audit_events where entity_id=any(identities) and not ((entity_type='staff_user' and action in('CREATE','INVITATION_QUEUED','ROLE_CHANGE','STATUS_CHANGE','STAFF_PROFILE_CHANGE','UPDATE')) or (entity_type='user_preferences' and action in('INSERT','UPDATE','DELETE')))) into present;
  elsif reference.table_name='audit_events' and reference.column_name='actor_id' then
   -- Self-owned preference edits are identity scaffolding, not business activity.
   select exists(select 1 from public.audit_events where actor_id=target_user and not(entity_type='user_preferences' and entity_id=target_user::text and action in('INSERT','UPDATE','DELETE'))) into retain_audit_identity;
   present:=false;
  elsif reference.table_name='sales_team_memberships' and reference.column_name in('requested_by','reviewed_by') then
   execute format('select exists(select 1 from public.sales_team_memberships where %I=$1 and not(member_id=any($2)))',reference.column_name) into present using target_user,identities;
  else
   execute format('select exists(select 1 from %I.%I where %I=any($1))',reference.schema_name,reference.table_name,reference.column_name) into present using identities;
  end if;
  if present then return jsonb_build_object('status','BUSINESS_REFERENCES_EXIST');end if;
 end loop;
 return jsonb_build_object('status','DELETE_ELIGIBLE','retentionMode',case when retain_audit_identity then 'AUDIT_IDENTITY' else 'NONE' end);
end $$;

create function public.remove_unused_staff_account(target_user uuid,p_request_key text) returns jsonb
language plpgsql security definer set search_path=public,app_auth,extensions as $$
declare ws uuid:=public.current_workspace_id();actor uuid:=app_auth.current_user_id(); eligibility jsonb;
 receipt public.mutation_receipts; fingerprint text;result jsonb;auth_relation text;
begin
 if current_setting('app.aal',true) is distinct from 'aal2' then raise exception 'MFA_REQUIRED';end if;
 if actor is null or not public.is_workspace_member(ws) or public.crm_role() not in('SUPER_ADMIN','ADMIN') then raise exception 'ROLE_ASSIGNMENT_FORBIDDEN';end if;
 if length(coalesce(p_request_key,'')) not between 8 and 160 then raise exception 'INVALID_INPUT';end if;
 perform pg_advisory_xact_lock(hashtextextended(ws::text||':staff-identity',0));
 fingerprint:=encode(digest(jsonb_build_array(target_user)::text,'sha256'),'hex');
 select * into receipt from public.mutation_receipts where workspace_id=ws and request_key=p_request_key;
 if found then
  if receipt.created_by<>actor or receipt.operation<>'STAFF_ACCOUNT_REMOVE' or receipt.result->>'request_hash'<>fingerprint then raise exception 'PAYLOAD_REUSE';end if;
  return receipt.result->'item';
 end if;
 eligibility:=public.staff_lifecycle_eligibility(target_user);
 if eligibility->>'status'<>'DELETE_ELIGIBLE' then raise exception '%',eligibility->>'status';end if;
 -- Eligibility holds account/profile/member and outbox locks until commit.
 -- A Worker that already claimed delivery is SENDING and blocks removal.
 delete from public.notification_outbox where recipient_id=target_user and template_key='staff-account-created';
 delete from public.staff_invitation_deliveries where user_id=target_user;
 delete from public.sales_team_memberships where member_id in(select id from public.sales_team_members where auth_user_id=target_user);
 if to_regclass('public.staff_business_profiles') is not null then execute 'delete from public.staff_business_profiles where member_id in(select id from public.sales_team_members where auth_user_id=$1)' using target_user;end if;
 delete from public.sales_team_members where auth_user_id=target_user;
 update public.audit_events set before_data=before_data::jsonb-'username'-'email'-'displayNameZh'-'displayNameEn',after_data=after_data::jsonb-'username'-'email'-'displayNameZh'-'displayNameEn' where entity_type='staff_user' and entity_id=target_user::text;
 delete from public.workspace_memberships where user_id=target_user;
 delete from public.user_profiles where user_id=target_user;
 -- Delete preferences explicitly so their DELETE audit is minimized as well.
 delete from public.user_preferences where user_id=target_user;
 update public.audit_events set actor_id=case when actor_id=target_user then null else actor_id end,before_data=null,after_data=jsonb_build_object('status','IDENTITY_REMOVED') where entity_type='user_preferences' and entity_id=target_user::text and action in('INSERT','UPDATE','DELETE');
 -- All current business references have been cleared. Retained audit may still
 -- require the UUID: keep only a disabled, de-identified identity, with no staff
 -- membership/profile, credentials or sessions. Never rewrite business audit.
 if eligibility->>'retentionMode'='AUDIT_IDENTITY' then
  foreach auth_relation in array array['app_auth.password_credentials','app_auth.sessions','app_auth.email_tokens','app_auth.totp_factors','app_auth.trusted_devices','public.trusted_login_devices','public.user_notifications'] loop
   if to_regclass(auth_relation) is not null then execute format('delete from %s where user_id=$1',auth_relation) using target_user;end if;
  end loop;
  update app_auth.login_events set user_id=null where user_id=target_user;
  update app_auth.accounts set status='DISABLED',disabled_at=now(),purged_at=now(),email=('removed-'||target_user::text||'@example.invalid')::extensions.citext,username=('removed_'||replace(target_user::text,'-',''))::extensions.citext,email_confirmed_at=null,last_sign_in_at=null,must_change_password=true,password_version=password_version+1,updated_at=now() where id=target_user;
 else
  delete from app_auth.accounts where id=target_user;
 end if;
 result:=jsonb_build_object('id',target_user,'status','REMOVED');
 insert into public.audit_events(workspace_id,actor_id,entity_type,entity_id,action,after_data) values(ws,actor,'staff_user',target_user,'REMOVE_UNUSED_ACCOUNT',jsonb_build_object('status','REMOVED','reason','NO_BUSINESS_REFERENCES'));
 insert into public.mutation_receipts(workspace_id,request_key,operation,result,created_by) values(ws,p_request_key,'STAFF_ACCOUNT_REMOVE',jsonb_build_object('request_hash',fingerprint,'item',result),actor);
 return result;
end $$;
revoke all on function public.staff_lifecycle_eligibility(uuid),public.remove_unused_staff_account(uuid,text) from public,crm_system,crm_worker;
grant execute on function public.staff_lifecycle_eligibility(uuid),public.remove_unused_staff_account(uuid,text) to crm_app;
