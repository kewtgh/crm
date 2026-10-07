import { databaseJson } from "./db/gateway";

/** R5A server repository only. No posting, UI or cash mutation surface. */
export type RevenueFoundationCommand =
  | "POLICY_CREATE" | "POLICY_SUBMIT" | "POLICY_RETIRE"
  | "CONTRACT_ACCEPT" | "SERVICE_CREATE" | "BINDING_CREATE" | "BINDING_SUBMIT"
  | "PROFILE_SUBMIT" | "PROFILE_RETIRE" | "PERIOD_CREATE" | "PERIOD_CLOSE"
  | "AUTHORITY_ASSIGN" | "AUTHORITY_REVOKE";

export function commandRevenueFoundation(input: {
  entity: string; command: RevenueFoundationCommand; target: string;
  expectedRevision: number | null; data: Record<string, unknown>; requestKey: string;
}, adapter = databaseJson) {
  return adapter<Record<string, unknown>>("/db/rpc/revenue_foundation_command", {
    method: "POST", body: JSON.stringify({
      entity: input.entity, command: input.command, target: input.target,
      expected_revision: input.expectedRevision, data: input.data, request_key: input.requestKey,
    }),
  });
}

export function decideRevenueFoundation(input: {
  approvalId: string; expectedRevision: number; decision: "APPROVED" | "REJECTED";
  reference: string; requestKey: string;
}, adapter = databaseJson) {
  return adapter<Record<string, unknown>>("/db/rpc/decide_revenue_approval", {
    method: "POST", body: JSON.stringify({ request_id: input.approvalId,
      expected_revision: input.expectedRevision, decision: input.decision,
      reference: input.reference, request_key: input.requestKey }),
  });
}
