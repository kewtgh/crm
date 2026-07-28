import { runSchemaContract } from "./lib/schema-contract.mjs";

await runSchemaContract("phase2", {
  tables: [
    "approval_requests",
    "quotes",
    "quote_versions",
    "contact_consents",
    "import_batches",
    "import_rows",
    "appointments",
    "calendar_deliveries",
    "receivable_schedules",
    "refunds",
  ],
  functions: [
    "create_import_batch",
    "process_import_batch",
    "create_appointment_with_delivery",
    "submit_quote",
    "save_contact_consent",
    "confirm_payment",
  ],
  columns: {
    approval_requests: ["status", "execution_status", "requester_id", "decided_by"],
    import_batches: ["status", "field_mapping", "file_hash", "rolled_back_at"],
    calendar_deliveries: ["status", "lease_token", "lease_expires_at"],
  },
});
