import { databaseJson } from "./db/gateway";

export function recordCustodyReceipt(input: {
  entity: string; amount: string; currency: string; paymentReference: string; paidOn: string;
  termsServiceId: string; permittedServiceIds: string[];
  custodyRole: "COLLECTION_CUSTODIAN" | "CONDITIONAL_SETTLEMENT_HOLDER" | "COLLECTION_FOR_BENEFICIARY";
  beneficiaryKind: "REPORTING_ENTITY" | "CONTRACT_BUYER";
  intent: string; reference: string; requestKey: string;
}, adapter = databaseJson) {
  return adapter<Record<string, unknown>>("/db/rpc/record_payment", {
    method: "POST", body: JSON.stringify({ target_contract: null, target_schedule: null,
      payment_amount: input.amount, payment_currency: input.currency, payment_reference: input.paymentReference,
      paid_on: input.paidOn, request_key: input.requestKey, custody: { entity: input.entity,
        terms_service_id: input.termsServiceId, permitted_service_ids: input.permittedServiceIds,
        custody_role: input.custodyRole, beneficiary_kind: input.beneficiaryKind,
        intent: input.intent, reference: input.reference } }),
  });
}

export function applyCustodyCash(input: {
  entity: string; paymentId: string; serviceId: string; receivableId: string;
  amount: string; intent: string; reference: string; requestKey: string;
}, adapter = databaseJson) {
  return adapter<Record<string, unknown>>("/db/rpc/cash_application_command", {
    method: "POST", body: JSON.stringify({ entity: input.entity, command: "APPLY", source: input.paymentId,
      data: { service_id: input.serviceId, receivable_id: input.receivableId, amount: input.amount,
        intent: input.intent, reference: input.reference }, request_key: input.requestKey }),
  });
}

export function reverseCashApplication(input: {
  entity: string; paymentId: string; applicationId: string; amount: string;
  intent: string; reference: string; requestKey: string;
}, adapter = databaseJson) {
  return adapter<Record<string, unknown>>("/db/rpc/cash_application_command", {
    method: "POST", body: JSON.stringify({ entity: input.entity, command: "REVERSE", source: input.paymentId,
      data: { application_id: input.applicationId, amount: input.amount, intent: input.intent,
        reference: input.reference }, request_key: input.requestKey }),
  });
}

export function getCustodyCashStatus(entity: string, paymentId: string, adapter = databaseJson) {
  return adapter<Record<string, unknown>>("/db/rpc/cash_source_status", {
    method: "POST", body: JSON.stringify({ entity, source: paymentId }),
  });
}

export function getCashTargetStatus(entity: string, serviceId: string, receivableId: string, adapter = databaseJson) {
  return adapter<Record<string, unknown>>("/db/rpc/cash_target_status", {
    method: "POST", body: JSON.stringify({ entity, service: serviceId, receivable: receivableId }),
  });
}

export function requestCustodyRefund(input: {
  paymentId: string; amount: string; reason: string; requestKey: string;
}, adapter = databaseJson) {
  return adapter<Record<string, unknown>>("/db/rpc/request_refund", {
    method: "POST", body: JSON.stringify({ target_payment: input.paymentId, refund_amount: input.amount,
      refund_reason: input.reason, request_key: input.requestKey }),
  });
}

export function completeCustodyRefund(input: {
  refundId: string; receiptReference: string; requestKey: string;
}, adapter = databaseJson) {
  return adapter<Record<string, unknown>>("/db/rpc/complete_refund", {
    method: "POST", body: JSON.stringify({ target_refund: input.refundId, receipt: input.receiptReference,
      request_key: input.requestKey }),
  });
}
