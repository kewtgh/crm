import assert from "node:assert/strict";
import test from "node:test";
import {
  staffAccountErrorMessageKey,
  staffCreationMessageKey,
  submitStaffAccount,
} from "../components/staff-users-page.tsx";
import { persistentSessionMaxAgeForRole } from "../lib/auth/session-store.ts";
import {
  decryptInvitationCredential,
  encryptInvitationCredential,
} from "../lib/invitation-credential-crypto.mjs";
import { readFile } from "node:fs/promises";

const item = {
  id:"00000000-0000-4000-8000-000000000099",
  username:"new.staff",
  displayNameZh:"新员工",
  displayNameEn:"New Staff",
  email:"new.staff@example.test",
  role:"SALES_SPECIALIST",
  status:"ACTIVE",
  lastSignInAt:null,
  mfaEnabled:false,
  onboardingStatus:"AWAITING_EMAIL_CONFIRMATION",
  invitationDeliveryStatus:"QUEUED",
  teams:[],
};

test("staff action trigger only opens a controlled menu and status changes require confirmation", async () => {
  const source = await readFile(new URL("../components/staff-users-page.tsx", import.meta.url), "utf8");
  const trigger = source.match(/<button[^>]+className="icon-button staff-action-trigger"[\s\S]+?<MoreHorizontal size=\{18\}\/\><\/button>/)?.[0] ?? "";
  assert.match(trigger, /setOpen/);
  assert.doesNotMatch(trigger, /updateStatus|apiFetch|PATCH|setStatusTarget/);
  assert.match(source, /onStatus=\{\(\)=>setStatusTarget\(item\)\}/);
  assert.match(source, /<ConfirmDialog[\s\S]+onConfirm=\{\(\) => void updateStatus\(statusTarget\)\}/);
  assert.doesNotMatch(source, /<details className="staff-action-menu"|<summary/);
});

test("staff directory filters before pagination and rejects unknown filter values", async () => {
  const [route, repository, component] = await Promise.all([
    readFile(new URL("../app/api/admin/users/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/admin-users-repository.ts", import.meta.url), "utf8"),
    readFile(new URL("../components/staff-users-page.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(route, /directoryStatusSchema = z\.enum\(\["ALL", "ACTIVE", "PENDING", "SUSPENDED"\]\)/);
  assert.match(route, /directoryRoleSchema = z\.enum\(\["ALL", \.\.\.APP_ROLES\]\)/);
  assert.match(route, /INVALID_STAFF_DIRECTORY_FILTER/);
  assert.match(repository, /\$3 = 'PENDING'[\s\S]+membership\.must_change_password/);
  assert.match(repository, /\$4 = 'ALL' or membership\.role = \$4/);
  assert.match(repository, /offset \$5 limit \$6/);
  assert.match(component, /status:statusFilter,role:roleFilter/);
  assert.match(component, /setStatusFilter\("ALL"\);setRoleFilter\("ALL"\)/);
});

test("CRM system can read and manage the team relations used by the staff directory", async () => {
  const migration = await readFile(
    new URL("../db/migrations/202608110077_crm_system_team_membership_permissions.sql", import.meta.url),
    "utf8",
  );
  assert.match(migration, /grant select, insert, update on public\.sales_team_memberships to crm_system/);
  assert.match(migration, /on public\.sales_teams for select to crm_system[\s\S]+using \(true\)/);
  assert.match(migration, /on public\.sales_team_memberships for select to crm_system[\s\S]+using \(true\)/);
  assert.match(migration, /on public\.sales_team_memberships for insert to crm_system[\s\S]+with check \(true\)/);
  assert.match(migration, /on public\.sales_team_memberships for update to crm_system[\s\S]+using \(true\)[\s\S]+with check \(true\)/);
  assert.doesNotMatch(migration, /to crm_worker|bypassrls/i);
});

test("staff directory has responsive cards and a complete keyboard menu", async () => {
  const [component, css] = await Promise.all([
    readFile(new URL("../components/staff-users-page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);
  for (const key of ["ArrowDown", "ArrowUp", "Home", "End", "Escape"]) {
    assert.match(component, new RegExp(`\\"${key}\\"`));
  }
  assert.match(component, /triggerRef\.current\?\.focus\(\);setOpen\(null\)/);
  assert.match(component, /data-label=\{t\("admin\.users\.account"\)\}/);
  assert.match(css, /@media\(max-width:680px\)\{\.staff-directory-filters/);
  assert.match(css, /\.staff-user-head\{display:none\}/);
  assert.match(css, /\.staff-user-row\{position:relative;min-width:0;min-height:0/);
});

test("persistent sessions last 15 days for administrators and 30 days for staff", () => {
  assert.equal(persistentSessionMaxAgeForRole("SUPER_ADMIN"), 15 * 24 * 60 * 60);
  assert.equal(persistentSessionMaxAgeForRole("ADMIN"), 15 * 24 * 60 * 60);
  assert.equal(persistentSessionMaxAgeForRole("SALES_SPECIALIST"), 30 * 24 * 60 * 60);
});

test("remembered-session retention is enforced by the server and survives refresh", async () => {
  const [sessionStore, refreshRoute, migration] = await Promise.all([
    readFile(new URL("../lib/auth/session-store.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/auth/refresh/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/migrations/202608100074_persistent_session_retention.sql", import.meta.url), "utf8"),
  ]);

  assert.match(sessionStore, /session\.persistent as session_persistent/);
  assert.match(sessionStore, /source_hash, user_agent_hash, persistent, idle_expires_at/);
  assert.match(sessionStore, /when persistent then absolute_expires_at/g);
  assert.match(sessionStore, /persistent: row\.session_persistent/);
  assert.match(refreshRoute, /persistent: session\.persistent/);
  assert.match(refreshRoute, /maxAge: session\.maxAge/);
  assert.doesNotMatch(refreshRoute, /crm_session_persistent/);

  assert.match(migration, /add column if not exists persistent boolean not null default false/);
  assert.match(migration, /absolute_expires_at - created_at > interval '12 hours'/);
  assert.match(migration, /set idle_expires_at = absolute_expires_at/);
  assert.match(migration, /revoked_at is null/);
  assert.match(migration, /absolute_expires_at > now\(\)/);
});

test("202 creation resets the stable form and calls onCreated without UNKNOWN", async () => {
  let resolveRequest;
  const request = new Promise((resolve) => { resolveRequest = resolve; });
  let resets = 0;
  let created = null;
  const pending = submitStaffAccount({
    form:{ reset(){ resets += 1; } },
    payload:{ username:"new.staff" },
    request:() => request,
    onCreated:(createdItem, deliveryStatus) => { created = { createdItem, deliveryStatus }; },
  });
  await Promise.resolve();
  resolveRequest({ item,emailDeliveryStatus:"UNCONFIRMED" });
  const outcome = await pending;
  assert.equal(outcome.ok, true);
  assert.equal(resets, 1);
  assert.deepEqual(created, { createdItem:item,deliveryStatus:"UNCONFIRMED" });
  assert.equal(staffCreationMessageKey("UNCONFIRMED"), "admin.users.createdDeliveryUnconfirmed");
  assert.notEqual(staffCreationMessageKey("UNCONFIRMED"), "admin.users.error.UNKNOWN");
});

test("201, 202, and 409 map to sent, unconfirmed, and identity-conflict results", async () => {
  assert.equal(staffCreationMessageKey("SENT"), "admin.users.created");
  assert.equal(staffCreationMessageKey("UNCONFIRMED"), "admin.users.createdDeliveryUnconfirmed");
  assert.equal(staffAccountErrorMessageKey("STAFF_IDENTITY_TAKEN"), "admin.users.error.IDENTITY_TAKEN");
  assert.equal(staffAccountErrorMessageKey("UNRECOGNIZED"), "admin.users.error.UNKNOWN");
});

test("success callbacks are not converted into server failures", async () => {
  await assert.rejects(
    submitStaffAccount({
      form:{ reset(){ throw new Error("RESET_FAILED"); } },
      payload:{},
      request:async() => ({ item,emailDeliveryStatus:"SENT" }),
      onCreated:() => assert.fail("onCreated must run only after reset"),
    }),
    /RESET_FAILED/,
  );
});

test("invitation credentials are encrypted at rest and only decrypted by the delivery worker", () => {
  const environment = { INVITATION_CREDENTIAL_ENCRYPTION_KEY:"ab".repeat(32) };
  const password = "Strong-Temporary-Password-42!";
  const encrypted = encryptInvitationCredential(password, environment);
  assert.equal(JSON.stringify(encrypted).includes(password), false);
  assert.equal(decryptInvitationCredential(encrypted, environment), password);
});

test("resend invitation remains AAL2-only, rotates credentials, revokes sessions, and queues delivery", async () => {
  const [route, repository, worker, migration, rlsMigration, observability] = await Promise.all([
    readFile(new URL("../app/api/admin/users/[id]/resend-invitation/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/admin-users-repository.ts", import.meta.url), "utf8"),
    readFile(new URL("../scripts/process-notification-outbox.mjs", import.meta.url), "utf8"),
    readFile(new URL("../db/migrations/202608020072_staff_invitation_delivery.sql", import.meta.url), "utf8"),
    readFile(new URL("../db/migrations/202608020073_staff_invitation_system_rls.sql", import.meta.url), "utf8"),
    readFile(new URL("../lib/observability.ts", import.meta.url), "utf8"),
  ]);
  assert.match(route, /requireApiRole\("SUPER_ADMIN", "ADMIN"\)/);
  assert.match(route, /requireApiAal2\(\)/);
  assert.match(repository, /password_version=password_version\+1/);
  assert.match(repository, /INVITATION_REISSUED/);
  assert.match(repository, /staff-account-created/);
  assert.doesNotMatch(route, /temporaryPassword/);
  assert.match(worker, /decryptInvitationCredential/);
  assert.match(worker, /DELIVERY_NETWORK_ERROR/);
  assert.match(migration, /'QUEUED','SENT','FAILED','UNCERTAIN'/);
  assert.match(rlsMigration, /for select to crm_system[\s\S]+using \(true\)/);
  assert.match(rlsMigration, /for insert to crm_system[\s\S]+with check \(true\)/);
  assert.match(rlsMigration, /for update to crm_system[\s\S]+using \(true\)[\s\S]+with check \(true\)/);
  assert.doesNotMatch(rlsMigration, /for delete|to crm_worker|audit_events|notification_outbox/i);
  assert.match(route, /DATABASE_POLICY_DENIED/);
  assert.match(observability, /admin\.staff_invitation\.resend/);
  assert.doesNotMatch(route, /error\.message|JSON\.stringify\(error\)/);
});
