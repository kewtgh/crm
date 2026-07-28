import { runSchemaContract } from "./lib/schema-contract.mjs";

await runSchemaContract("v09", {
  tables: [
    "worker_heartbeats",
    "webhook_inbox",
    "staff_identity_changes",
    "staff_identity_repair_jobs",
    "login_throttle_buckets",
    "generated_jobs",
    "notification_outbox",
  ],
  functions: [
    "record_worker_heartbeat",
    "service_readiness_snapshot_for_workers",
    "claim_webhook_events_leased",
    "claim_generated_jobs_leased",
    "claim_notification_outbox_leased",
    "operational_snapshot",
  ],
  columns: {
    worker_heartbeats: ["last_seen_at", "last_success_at", "consecutive_failures"],
    webhook_inbox: ["status", "lease_token", "lease_expires_at", "attempts"],
    generated_jobs: ["artifact_sha256", "expected_row_count", "exported_row_count"],
  },
});
