set search_path = public, extensions;

-- Teams are an organizational structure for every employee. Administrative
-- responsibility must not exclude an account from team membership or leadership.
alter table public.sales_team_members drop constraint if exists sales_team_members_role_check;
alter table public.sales_team_members add constraint sales_team_members_role_check
  check(role in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER','SALES_SPECIALIST','SALES_SUPPORT'));

insert into public.sales_team_members(
  workspace_id,auth_user_id,name_zh,name_en,role,team,active
)
select membership.workspace_id,membership.user_id,profile.display_name_zh,profile.display_name_en,
  membership.role,'',membership.status='ACTIVE'
from public.workspace_memberships membership
join public.user_profiles profile on profile.user_id=membership.user_id
where membership.role in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER','SALES_SPECIALIST','SALES_SUPPORT')
  and not exists(
    select 1 from public.sales_team_members member
    where member.workspace_id=membership.workspace_id and member.auth_user_id=membership.user_id
  );

update public.sales_team_members member
set role=membership.role,
    name_zh=profile.display_name_zh,
    name_en=profile.display_name_en,
    active=membership.status='ACTIVE'
from public.workspace_memberships membership
join public.user_profiles profile on profile.user_id=membership.user_id
where member.workspace_id=membership.workspace_id
  and member.auth_user_id=membership.user_id;
