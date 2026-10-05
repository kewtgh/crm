import assert from "node:assert/strict";
import test from "node:test";
import { canGovernContractTemplates } from "../scripts/lib/contract-template-governance.mjs";

const member = (role) => ({ role, workspaceId: "synthetic-workspace", activeMembership: true, aal: "aal2" });

test("template policy reuses staff Contract/catalog/approval capabilities", () => {
  for (const role of ["SUPER_ADMIN", "ADMIN", "SALES_DIRECTOR"]) {
    for (const action of ["READ", "EDIT_DRAFT", "APPROVE", "RETIRE"]) {
      assert.equal(canGovernContractTemplates(member(role), action), true);
    }
  }
  for (const role of ["SALES_MANAGER", "SALES_SPECIALIST", "SALES_SUPPORT"]) {
    assert.equal(canGovernContractTemplates(member(role), "READ"), true);
    assert.equal(canGovernContractTemplates(member(role), "EDIT_DRAFT"), false);
    assert.equal(canGovernContractTemplates(member(role), "APPROVE"), false);
  }
});

test("unknown/external/inactive users and unauthenticated requests cannot govern templates", () => {
  assert.equal(canGovernContractTemplates(null, "APPROVE"), false);
  for (const patch of [{ role: "CUSTOMER" }, { activeMembership: false }, { workspaceId: null }]) {
    assert.equal(canGovernContractTemplates({ ...member("ADMIN"), ...patch }, "READ"), false);
    assert.equal(canGovernContractTemplates({ ...member("ADMIN"), ...patch }, "APPROVE"), false);
  }
  assert.equal(canGovernContractTemplates({ ...member("ADMIN"), aal: "aal1" }, "READ"), true);
  assert.equal(canGovernContractTemplates({ ...member("ADMIN"), aal: "aal1" }, "APPROVE"), false);
  assert.equal(canGovernContractTemplates(member("ADMIN"), "GENERATE"), false);
});
