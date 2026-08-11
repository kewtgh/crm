import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("keeps created products fully editable with optimistic persistence", async () => {
  const [migration, repository, route, page] = await Promise.all([
    source("db/migrations/202608110075_structured_profiles_teams_and_terminal_approvals.sql"),
    source("lib/product-repository.ts"),
    source("app/api/products/route.ts"),
    source("components/products-page.tsx"),
  ]);
  assert.match(migration, /function public\.update_product_record/);
  assert.match(repository, /export async function updateProduct/);
  assert.match(route, /operation:z\.literal\("update"\)/);
  assert.match(page, /products\.editBase/);
  assert.match(page, /expectedUpdatedAt:editProduct\.updatedAt/);
});

test("models teams as records with editable leads and scoped approval authority", async () => {
  const [migration, teams, route, staff, capabilities] = await Promise.all([
    source("db/migrations/202608110075_structured_profiles_teams_and_terminal_approvals.sql"),
    source("lib/team-repository.ts"),
    source("app/api/admin/teams/route.ts"),
    source("components/staff-users-page.tsx"),
    source("lib/capabilities.ts"),
  ]);
  assert.match(migration, /create table if not exists public\.sales_teams/);
  assert.match(migration, /lead_member_id uuid/);
  assert.match(migration, /required_role='TEAM_LEAD'/);
  assert.match(migration, /request_type in \('CONTRACT_SIGN','CONTRACT_EXPORT'/);
  assert.match(teams, /export async function saveTeam/);
  assert.match(route, /requireApiRole\("SUPER_ADMIN","ADMIN"\)/);
  assert.match(staff, /admin\.teams\.edit/);
  assert.match(staff, /name="teamId" required/);
  assert.match(capabilities, /"approvals\.decide"/);
});

test("lets administrators execute terminal decisions without super-admin approval", async () => {
  const [migration, approvalRoute, finance, exports] = await Promise.all([
    source("db/migrations/202608110075_structured_profiles_teams_and_terminal_approvals.sql"),
    source("app/api/approvals/route.ts"),
    source("app/api/finance/route.ts"),
    source("app/api/marketing-exports/route.ts"),
  ]);
  assert.match(migration, /current_crm_role\(\) not in \('SUPER_ADMIN','ADMIN'\)/);
  assert.match(migration, /ADMIN_TERMINAL_EXECUTION/);
  assert.match(approvalRoute, /\["SUPER_ADMIN","ADMIN"\]\.includes\(user\.role\)/);
  assert.match(finance, /\["SUPER_ADMIN","ADMIN"\]\.includes\(user\.role\)/);
  assert.match(exports, /\["SUPER_ADMIN","ADMIN"\]\.includes\(user\.role\)/);
});

test("stores rich structured education profiles and supports Markdown narratives", async () => {
  const [migration, educationRoute, crmRoute, educationUi, schoolUi] = await Promise.all([
    source("db/migrations/202608110075_structured_profiles_teams_and_terminal_approvals.sql"),
    source("app/api/education/route.ts"),
    source("app/api/crm/[resource]/route.ts"),
    source("components/v200-workspaces.tsx"),
    source("components/module-page.tsx"),
  ]);
  assert.match(migration, /annual_income_amount numeric/);
  assert.match(migration, /interests text\[\]/);
  assert.match(migration, /course_categories text\[\]/);
  assert.match(educationRoute, /personalityMarkdown/);
  assert.match(crmRoute, /organizationOverviewMarkdown/);
  assert.match(educationUi, /data-markdown="true"/);
  assert.match(schoolUi, /education\.structureOverview/);
});

test("provides rich templates plus repair and rollback for every import resource", async () => {
  const [migration, template, imports, repository] = await Promise.all([
    source("db/migrations/202608110075_structured_profiles_teams_and_terminal_approvals.sql"),
    source("app/api/imports/template/route.ts"),
    source("components/imports-page.tsx"),
    source("lib/phase2-repository.ts"),
  ]);
  assert.match(template, /HOUSEHOLDS:\["nameZh"/);
  assert.match(template, /STUDENTS:\["nameZh"/);
  assert.match(imports, /ORGANIZATIONS:\["nameZh"[\s\S]*organizationOverviewMarkdown/);
  assert.match(migration, /function public\.repair_import_row/);
  assert.match(migration, /function public\.rollback_import_batch/);
  assert.match(repository, /"HOUSEHOLDS"\|"STUDENTS"/);
});
