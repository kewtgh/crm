import { databaseJson } from "./db/gateway";

export function evaluateRevenueCandidate(input: {
  entity: string; serviceId: string; bindingId: string; recognitionUnitKey: string; requestKey: string;
}, adapter = databaseJson) {
  return adapter<Record<string, unknown>>("/db/rpc/revenue_candidate_command", {
    method: "POST", body: JSON.stringify({ entity: input.entity, command: "EVALUATE", target: null,
      expected_revision: null, data: { specified_service_id: input.serviceId, binding_id: input.bindingId,
        recognition_unit_key: input.recognitionUnitKey }, request_key: input.requestKey }),
  });
}

export function reviewRevenueCandidate(input: {
  entity: string; command: "SUBMIT" | "APPROVE" | "REJECT" | "REVALIDATE";
  candidateId: string; expectedRevision: number; reference?: string; requestKey: string;
}, adapter = databaseJson) {
  return adapter<Record<string, unknown>>("/db/rpc/revenue_candidate_command", {
    method: "POST", body: JSON.stringify({ entity: input.entity, command: input.command,
      target: input.candidateId, expected_revision: input.expectedRevision,
      data: input.reference ? { reference: input.reference } : {}, request_key: input.requestKey }),
  });
}

export function getRevenueCandidateHealth(candidateId: string, adapter = databaseJson) {
  return adapter<"CURRENT" | "STALE" | "BLOCKED">("/db/rpc/revenue_candidate_health", {
    method: "POST", body: JSON.stringify({ target: candidateId }),
  });
}
