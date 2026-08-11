import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source=(path)=>readFile(new URL(`../${path}`,import.meta.url),"utf8");

test("makes product editing discoverable and exposes Markdown details with purchasers",async()=>{
  const[migration,repository,route,page]=await Promise.all([source("db/migrations/202608110076_product_contact_and_multi_team_profiles.sql"),source("lib/product-repository.ts"),source("app/api/products/route.ts"),source("components/products-page.tsx")]);
  assert.match(migration,/description_zh_markdown text not null/);
  assert.match(migration,/'purchasers',coalesce\(purchaser_rows\.items/);
  assert.match(repository,/export type ProductPurchaser/);
  assert.match(route,/descriptionZhMarkdown:z\.string\(\)\.max\(20000\)/);
  assert.match(page,/className="product-row-actions"/);
  assert.match(page,/setEditProduct\(product\)/);
  assert.match(page,/setDetailProduct\(product\)/);
  assert.match(page,/products\.purchasers/);
  assert.match(page,/data-markdown="true"/);
});

test("shows structured contact family, notes, contact status, and four communication levels",async()=>{
  const[migration,repository,editor,detail,route]=await Promise.all([source("db/migrations/202608110076_product_contact_and_multi_team_profiles.sql"),source("lib/crm-repository.ts"),source("components/crm-record-editor.tsx"),source("components/contact-consent-page.tsx"),source("app/api/crm/[resource]/[id]/route.ts")]);
  assert.match(migration,/contact_status text not null default 'NEW'/);
  assert.match(migration,/communication_level smallint not null default 1/);
  assert.match(migration,/max\(relationship_level\)::smallint/);
  assert.match(migration,/notes_markdown text not null/);
  assert.match(repository,/household_members\?select=/);
  assert.match(editor,/name="communicationLevel"/);
  assert.match(editor,/name="notesMarkdown"/);
  assert.match(detail,/contact\.households/);
  assert.match(detail,/MarkdownContent value=\{data\.notesMarkdown\}/);
  assert.match(route,/contactStatus:z\.enum/);
});

test("keeps team dialogs reopenable and models multi-team staff, leads, and requests",async()=>{
  const[migration,repository,dialog,adminRoute,selfRoute,directory]=await Promise.all([source("db/migrations/202608110076_product_contact_and_multi_team_profiles.sql"),source("lib/team-repository.ts"),source("components/staff-users-page.tsx"),source("app/api/admin/team-memberships/route.ts"),source("app/api/team-memberships/route.ts"),source("lib/admin-users-repository.ts")]);
  assert.match(migration,/create table if not exists public\.sales_team_memberships/);
  assert.match(migration,/membership_role in \('MEMBER','LEAD'\)/);
  assert.match(migration,/status in \('PENDING','ACTIVE','REJECTED'\)/);
  assert.match(repository,/leadUserIds:string\[\]/);
  assert.match(repository,/requestTeamMembership/);
  assert.match(repository,/setUserTeamMemberships/);
  assert.match(dialog,/<dialog className="staff-dialog" ref=\{dialogRef\} onClose=\{closeDialog\}/);
  assert.match(dialog,/form\.getAll\("leadUserIds"\)/);
  assert.match(dialog,/TeamMembershipDialog/);
  assert.match(adminRoute,/setUserTeamMemberships/);
  assert.match(selfRoute,/requestTeamMembership/);
  assert.match(directory,/team_membership\.status in \('ACTIVE','PENDING'\)/);
});

test("exposes complete team management and a discoverable staff assignment action",async()=>{
  const[migration,repository,accounts,directory,bootstrap,page,css]=await Promise.all([source("db/migrations/202608110079_all_staff_team_membership.sql"),source("lib/team-repository.ts"),source("lib/auth/accounts.ts"),source("lib/admin-users-repository.ts"),source("scripts/bootstrap-admin.mjs"),source("components/staff-users-page.tsx"),source("app/globals.css")]);
  assert.match(migration,/check\(role in \('SUPER_ADMIN','ADMIN','SALES_DIRECTOR'/);
  assert.match(migration,/insert into public\.sales_team_members/);
  assert.match(migration,/from public\.workspace_memberships membership/);
  assert.match(repository,/members:TeamMemberSummary\[\]/);
  assert.match(repository,/membership\.status in \('ACTIVE','PENDING'\)/);
  assert.doesNotMatch(repository,/member\.role in \('SALES_DIRECTOR','SALES_MANAGER'\)/);
  assert.doesNotMatch(accounts,/if \(role\.startsWith\("SALES_"\)\) \{/);
  assert.match(directory,/set role = \$3,[\s\S]+active = \(\$4 = 'ACTIVE'\)/);
  assert.match(bootstrap,/role='SUPER_ADMIN',active=true/);
  assert.match(bootstrap,/insert into public\.sales_team_members/);
  assert.match(page,/className="surface team-management-panel"/);
  assert.match(page,/setTeamDetail\(team\)/);
  assert.match(page,/setTeamEditor\(\{mode:"edit",team\}\)/);
  assert.match(page,/className="secondary-button compact staff-team-button"/);
  assert.doesNotMatch(page,/item\.role\.startsWith\("SALES_"\)&&<button className="secondary-button compact staff-team-button"/);
  assert.match(page,/onTeam=\{\(\)=>setTeamTarget\(item\)\}/);
  assert.match(page,/role="menuitem" onClick=\{\(\)=>\{setOpen\(null\);onTeam\(\);\}\}/);
  assert.match(page,/teamDetail\.members\.map/);
  assert.match(css,/\.team-management-grid\{display:grid/);
});

test("supports draft, active, and paused product lifecycles with usable list actions",async()=>{
  const[migration,repository,route,page,css]=await Promise.all([source("db/migrations/202608110078_product_lifecycle_and_contact_operating_profile.sql"),source("lib/product-repository.ts"),source("app/api/products/route.ts"),source("components/products-page.tsx"),source("app/globals.css")]);
  assert.match(migration,/lifecycle_status in \('DRAFT','ACTIVE','PAUSED'\)/);
  assert.match(migration,/active=normalized_status='ACTIVE'/);
  assert.match(migration,/idempotent_set_product_lifecycle/);
  assert.match(repository,/ProductLifecycleStatus="DRAFT"\|"ACTIVE"\|"PAUSED"/);
  assert.match(route,/operation:z\.literal\("lifecycle"\)/);
  assert.match(page,/ProductLifecycleField/);
  assert.match(page,/className="product-action-button edit"/);
  assert.match(page,/statusFilter/);
  assert.match(css,/grid-template-columns:minmax\(240px,1\.8fr\)/);
  assert.match(css,/\.product-row-actions \{ justify-self:end/);
});

test("adds the operating fields a usable customer profile needs",async()=>{
  const[migration,repository,editor,detail,createRoute]=await Promise.all([source("db/migrations/202608110078_product_lifecycle_and_contact_operating_profile.sql"),source("lib/crm-repository.ts"),source("components/crm-record-editor.tsx"),source("components/contact-consent-page.tsx"),source("app/api/crm/[resource]/route.ts")]);
  for(const field of ["preferred_contact_method","preferred_language","acquisition_source","decision_role","tags","next_follow_up_at"])assert.match(migration,new RegExp(field));
  assert.match(migration,/next_owner_id uuid/);
  assert.match(repository,/preferredContactMethod/);
  assert.match(editor,/name="nextFollowUpAt"/);
  assert.match(editor,/name="decisionRole"/);
  assert.match(detail,/data\.ownerName/);
  assert.match(detail,/className="contact-tags"/);
  assert.match(createRoute,/preferredContactMethod:z\.enum/);
});
