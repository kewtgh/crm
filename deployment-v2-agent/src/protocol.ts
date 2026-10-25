import { randomUUID } from 'node:crypto';
import { assert, fields, record, sha256, UUID } from './common.ts';
export const STATES = ['QUEUED', 'PREPARING', 'RECOVERY_REQUIRED', 'COMPLETED', 'REJECTED'] as const;
export type State = typeof STATES[number];
export type Plan = { protocolVersion: 1; kind: 'FICTIONAL_CHECKPOINT'; siteId: string; expectedSiteRevision: number; ownerEpoch: 1; agentDigest: string; delayMs: number; expiresAt: number; nonce: string };
export type Request = { protocolVersion: 1; idempotencyKey: string; plan: Plan; planDigest: string };
export function validatePlan(value: unknown): asserts value is Plan {
  assert(record(value), 'PLAN_INVALID'); fields(value, ['protocolVersion', 'kind', 'siteId', 'expectedSiteRevision', 'ownerEpoch', 'agentDigest', 'delayMs', 'expiresAt', 'nonce']);
  assert(value.protocolVersion === 1 && value.kind === 'FICTIONAL_CHECKPOINT' && UUID.test(String(value.siteId)) && UUID.test(String(value.nonce)) && value.ownerEpoch === 1 && /^[0-9a-f]{64}$/.test(String(value.agentDigest)), 'PLAN_INVALID');
  assert(Number.isSafeInteger(value.expectedSiteRevision) && Number(value.expectedSiteRevision) >= 0 && Number.isSafeInteger(value.delayMs) && Number(value.delayMs) >= 0 && Number(value.delayMs) <= 5000 && Number.isSafeInteger(value.expiresAt) && Number(value.expiresAt) > 0, 'PLAN_INVALID');
}
export function planDigest(p: Plan) { validatePlan(p); return sha256(JSON.stringify([p.protocolVersion, p.kind, p.siteId, p.expectedSiteRevision, p.ownerEpoch, p.agentDigest, p.delayMs, p.expiresAt, p.nonce])); }
export function makePlan(siteId: string, revision: number, digest: string, delayMs = 10): Plan { const p: Plan = { protocolVersion: 1, kind: 'FICTIONAL_CHECKPOINT', siteId, expectedSiteRevision: revision, ownerEpoch: 1, agentDigest: digest, delayMs, expiresAt: Date.now() + 300_000, nonce: randomUUID() }; validatePlan(p); return p; }
export function validateRequest(value: unknown): asserts value is Request {
  assert(record(value), 'REQUEST_INVALID'); fields(value, ['protocolVersion', 'idempotencyKey', 'plan', 'planDigest']); validatePlan(value.plan);
  assert(value.protocolVersion === 1 && /^[A-Za-z0-9_-]{8,80}$/.test(String(value.idempotencyKey)) && value.planDigest === planDigest(value.plan), 'REQUEST_INVALID');
}
