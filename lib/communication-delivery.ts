export const COMMUNICATION_DELIVERY_TIMEOUT_MS = 10_000;

export function communicationDeliveryHeaders(messageId: string, bearerToken?: string) {
  return {
    "content-type": "application/json",
    "idempotency-key": messageId,
    ...(bearerToken ? { authorization: `Bearer ${bearerToken}` } : {}),
  };
}
