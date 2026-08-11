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
