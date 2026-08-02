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
};

test("persistent sessions last 15 days for administrators and 30 days for staff", () => {
  assert.equal(persistentSessionMaxAgeForRole("SUPER_ADMIN"), 15 * 24 * 60 * 60);
  assert.equal(persistentSessionMaxAgeForRole("ADMIN"), 15 * 24 * 60 * 60);
  assert.equal(persistentSessionMaxAgeForRole("SALES_SPECIALIST"), 30 * 24 * 60 * 60);
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
  const [route, repository, worker, migration] = await Promise.all([
    readFile(new URL("../app/api/admin/users/[id]/resend-invitation/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/admin-users-repository.ts", import.meta.url), "utf8"),
    readFile(new URL("../scripts/process-notification-outbox.mjs", import.meta.url), "utf8"),
    readFile(new URL("../db/migrations/202608020072_staff_invitation_delivery.sql", import.meta.url), "utf8"),
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
});
