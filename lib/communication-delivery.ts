import { emailDeliveryConfiguration } from "./email-delivery-runtime.mjs";

export const COMMUNICATION_DELIVERY_TIMEOUT_MS = 10_000;

export function communicationDeliveryHeaders(messageId: string, bearerToken?: string) {
  return {
    "content-type": "application/json",
    "idempotency-key": messageId,
    ...(bearerToken ? { authorization: `Bearer ${bearerToken}` } : {}),
  };
}

export function configuredCommunicationDelivery(environment: NodeJS.ProcessEnv = process.env) {
  return emailDeliveryConfiguration(environment);
}

export async function postCommunicationDelivery({
  endpoint,
  bearerToken,
  messageId,
  payload,
  fetchImplementation = fetch,
}: {
  endpoint: string;
  bearerToken: string;
  messageId: string;
  payload: Record<string, unknown>;
  fetchImplementation?: typeof fetch;
}) {
  return fetchImplementation(endpoint, {
    method: "POST",
    headers: communicationDeliveryHeaders(messageId, bearerToken),
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(COMMUNICATION_DELIVERY_TIMEOUT_MS),
  });
}
