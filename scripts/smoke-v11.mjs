import { runSchemaContract } from "./lib/schema-contract.mjs";

await runSchemaContract("v11", {
  tables: [
    "trusted_login_devices",
    "integration_connections",
    "integration_sync_jobs",
    "next_best_actions",
    "product_bundles",
    "exchange_rate_snapshots",
    "privacy_requests",
  ],
  functions: [
    "service_register_trusted_login_device",
    "service_consume_trusted_login_device",
    "service_revoke_user_trusted_login_devices",
    "generate_next_best_actions",
    "claim_integration_sync_jobs",
    "growth_snapshot",
  ],
  columns: {
    trusted_login_devices: ["token_hash", "expires_at", "revoked_at", "last_used_at"],
    integration_sync_jobs: ["lease_token", "cursor_before", "cursor_after"],
    next_best_actions: ["rule_key", "evidence", "confidence", "valid_until"],
  },
});
