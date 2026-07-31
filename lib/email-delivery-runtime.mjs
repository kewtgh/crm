export const EMAIL_DELIVERY_RUNTIME_KEYS = Object.freeze([
  "EMAIL_DELIVERY_WEBHOOK_URL",
  "EMAIL_DELIVERY_WEBHOOK_TOKEN",
]);

export const EMAIL_DELIVERY_NOT_CONFIGURED = "EMAIL_DELIVERY_NOT_CONFIGURED";

export function emailDeliveryConfiguration(environment = process.env) {
  const endpoint = environment.EMAIL_DELIVERY_WEBHOOK_URL?.trim();
  const bearerToken = environment.EMAIL_DELIVERY_WEBHOOK_TOKEN?.trim();
  return endpoint && bearerToken ? { endpoint, bearerToken } : null;
}
