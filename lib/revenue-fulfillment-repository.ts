import { databaseJson } from "./db/gateway";

export function commandRevenueAttestation(input: {
  entity: string; command: "CREATE" | "SUBMIT" | "ACCEPT" | "REJECT" | "WITHDRAW";
  target: string; expectedRevision: number | null;
  data: Record<string, unknown>; requestKey: string;
}, adapter = databaseJson) {
  return adapter<Record<string, unknown>>("/db/rpc/revenue_attestation_command", {
    method: "POST", body: JSON.stringify({ entity: input.entity, command: input.command,
      target: input.target, expected_revision: input.expectedRevision, data: input.data,
      request_key: input.requestKey }),
  });
}

export function setRevenueFulfillmentRequirements(input: {
  entity: string; bindingId: string; expectedRevision: number;
  requirements: Record<string, unknown>; requestKey: string;
}, adapter = databaseJson) {
  return adapter<{ id: string; revision: number }>("/db/rpc/revenue_set_fulfillment_requirements", {
    method: "POST", body: JSON.stringify({ entity: input.entity, target: input.bindingId,
      expected_revision: input.expectedRevision, requirements: input.requirements, request_key: input.requestKey }),
  });
}

export function getRevenueAttestationHealth(id: string, adapter = databaseJson) {
  return adapter<"CURRENT" | "SOURCE_CHANGED" | "SOURCE_UNAVAILABLE">("/db/rpc/revenue_attestation_health", {
    method: "POST", body: JSON.stringify({ target: id }),
  });
}
