import type { AppRole } from "./roles";

export const CAPABILITIES = [
  "admin.access",
  "users.manage",
  "catalog.manage",
  "exchangeRates.manage",
  "finance.view",
  "finance.quote.create",
  "finance.payment.record",
  "finance.refund.complete",
  "imports.view",
  "imports.execute",
  "dataQuality.manage",
  "performance.manage",
  "relationshipTargets.manage",
  "duplicates.manage",
  "privacyRequests.manage",
  "education.view",
  "education.manage",
  "progression.manage",
  "leads.view",
  "leads.manage",
  "ai.review",
  "exports.request",
  "workers.run",
] as const;

export type Capability = (typeof CAPABILITIES)[number];

const administrator = new Set<Capability>(CAPABILITIES);
const roleCapabilities: Record<AppRole, ReadonlySet<Capability>> = {
  SUPER_ADMIN: administrator,
  ADMIN: administrator,
  SALES_DIRECTOR: new Set([
    "catalog.manage",
    "finance.view",
    "finance.quote.create",
    "imports.view",
    "imports.execute",
    "dataQuality.manage",
    "performance.manage",
    "relationshipTargets.manage",
    "duplicates.manage",
    "privacyRequests.manage",
    "education.view",
    "education.manage",
    "progression.manage",
    "leads.view",
    "leads.manage",
    "ai.review",
    "exports.request",
  ]),
  SALES_MANAGER: new Set([
    "finance.view",
    "finance.quote.create",
    "imports.view",
    "imports.execute",
    "dataQuality.manage",
    "performance.manage",
    "relationshipTargets.manage",
    "duplicates.manage",
    "education.view",
    "education.manage",
    "progression.manage",
    "leads.view",
    "leads.manage",
    "ai.review",
    "exports.request",
  ]),
  SALES_SPECIALIST: new Set([
    "finance.view",
    "finance.quote.create",
    "education.view",
    "education.manage",
    "leads.view",
    "leads.manage",
    "ai.review",
    "exports.request",
  ]),
  SALES_SUPPORT: new Set([
    "finance.view",
    "education.view",
    "education.manage",
    "leads.view",
    "ai.review",
    "exports.request",
  ]),
};

export const aal2Capabilities = new Set<Capability>([
  "admin.access",
  "users.manage",
  "catalog.manage",
  "exchangeRates.manage",
  "finance.payment.record",
  "finance.refund.complete",
  "imports.execute",
  "dataQuality.manage",
  "performance.manage",
  "relationshipTargets.manage",
  "progression.manage",
  "privacyRequests.manage",
  "workers.run",
]);

export function hasCapability(role: AppRole, capability: Capability) {
  return roleCapabilities[role].has(capability);
}

export function rolesForCapability(capability: Capability) {
  return (Object.keys(roleCapabilities) as AppRole[]).filter((role) => hasCapability(role, capability));
}
