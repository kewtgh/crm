// Policy contract for future authenticated template administration. No mutation endpoint.
import { hasCapability } from "../../lib/capabilities.ts";
import { APP_ROLES } from "../../lib/roles.ts";

export function canGovernContractTemplates(actor, action) {
  if (typeof actor?.workspaceId !== "string" || !actor.workspaceId.trim()
    || actor.activeMembership !== true || !APP_ROLES.includes(actor.role)) return false;
  if (action === "READ") return hasCapability(actor.role, "contracts.view");
  if (!["EDIT_DRAFT", "APPROVE", "RETIRE"].includes(action) || actor.aal !== "aal2") return false;
  const manages = hasCapability(actor.role, "catalog.manage") && hasCapability(actor.role, "contracts.manage");
  return manages && (action === "EDIT_DRAFT" || hasCapability(actor.role, "approvals.decide"));
}
