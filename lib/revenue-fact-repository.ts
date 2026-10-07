import { databaseJson } from "./db/gateway";

export function postRevenueCandidate(input: {
  entity: string; candidateId: string; expectedRevision: number; postingReference: string; requestKey: string;
}, adapter = databaseJson) {
  return adapter<Record<string, unknown>>("/db/rpc/revenue_post_candidate", {
    method: "POST", body: JSON.stringify({ entity: input.entity, target: input.candidateId,
      expected_revision: input.expectedRevision, posting_reference: input.postingReference, request_key: input.requestKey }),
  });
}

export function evaluateRevenueCorrection(input: {
  entity: string; originalFactId: string; revisedCandidateId: string;
  kind: "ADJUSTMENT" | "REVERSAL" | "REPLACEMENT"; correctionIntentKey: string;
  reasonReference: string; refundId?: string; requestKey: string;
}, adapter = databaseJson) {
  return adapter<Record<string, unknown>>("/db/rpc/revenue_evaluate_correction", {
    method: "POST", body: JSON.stringify({ entity: input.entity, data: {
      original_fact_id: input.originalFactId, revised_candidate_id: input.revisedCandidateId,
      candidate_kind: input.kind, correction_intent_key: input.correctionIntentKey,
      reason_reference: input.reasonReference, refund_id: input.refundId,
    }, request_key: input.requestKey }),
  });
}

export function configureRevenueCorrectionRule(input: {
  entity: string; policyId: string; expectedRevision: number;
  method: "BLOCKED" | "REVISED_ENTITLEMENT"; allowPriorPeriod: boolean; reference: string; requestKey: string;
}, adapter = databaseJson) {
  return adapter<Record<string, unknown>>("/db/rpc/revenue_set_correction_rule", {
    method: "POST", body: JSON.stringify({ entity: input.entity, target: input.policyId,
      expected_revision: input.expectedRevision, rule: { method: input.method,
        allow_prior_period: input.allowPriorPeriod, reference: input.reference }, request_key: input.requestKey }),
  });
}

export function getRecognizedRevenueLineage(input: {
  entity: string; contractId: string; stableServiceKey: string; recognitionUnitKey: string;
}, adapter = databaseJson) {
  return adapter<Record<string, unknown>>("/db/rpc/revenue_recognized_lineage", {
    method: "POST", body: JSON.stringify({ entity: input.entity, contract: input.contractId,
      service_key: input.stableServiceKey, unit_key: input.recognitionUnitKey }),
  });
}
