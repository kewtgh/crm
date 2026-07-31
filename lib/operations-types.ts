export const OPERATION_QUEUE_KEYS = [
  "APPROVALS",
  "REFUNDS",
  "IMPORTS",
  "REMINDERS",
  "NOTIFICATION_OUTBOX",
  "CALENDAR_DELIVERIES",
  "COMMUNICATION_DELIVERY",
  "GENERATED_JOBS",
  "WEBHOOK_INBOX",
  "INTEGRATION_SYNC",
  "DATA_QUALITY",
  "IDENTITY_REPAIR",
] as const;

export type OperationQueueKey = (typeof OPERATION_QUEUE_KEYS)[number];

export const RETRYABLE_JOB_TYPES = [
  "NOTIFICATION_OUTBOX",
  "CALENDAR_DELIVERIES",
  "GENERATED_JOBS",
  "REMINDERS",
  "WEBHOOK_INBOX",
  "INTEGRATION_SYNC",
  "IDENTITY_REPAIR",
] as const;

export type RetryableJobType = (typeof RETRYABLE_JOB_TYPES)[number];

export const INTEGRATION_PROVIDERS = [
  "MICROSOFT_365",
  "GOOGLE_CALENDAR",
  "EMAIL",
  "E_SIGNATURE",
  "ACCOUNTING",
  "PAYMENT",
] as const;

export type IntegrationProvider = (typeof INTEGRATION_PROVIDERS)[number];

export const INTEGRATION_STATUSES = [
  "DISCONNECTED",
  "CONNECTING",
  "CONNECTED",
  "DEGRADED",
  "ACTION_REQUIRED",
] as const;

export type IntegrationStatus = (typeof INTEGRATION_STATUSES)[number];

export const INTEGRATION_SYNC_DIRECTIONS = [
  "NONE",
  "IMPORT_ONLY",
  "EXPORT_ONLY",
  "BIDIRECTIONAL",
] as const;

export type IntegrationSyncDirection = (typeof INTEGRATION_SYNC_DIRECTIONS)[number];
