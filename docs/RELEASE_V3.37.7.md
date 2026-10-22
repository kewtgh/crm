# v3.37.7 — Deployment recovery safety

Candidate only. No production deployment, service change, secret rotation, or database migration is included.

Bootstrap now records sanitized Git failure categories, bounded transient fetch attempts, and the original request's attempt history. Only proven pre-controller failures can reuse a request. Interrupted application operations require reconciliation, rather than elapsed-time-based replay.

Application restoration requires an exact match between the authoritative database migration manifest and the previous immutable image. Migration uncertainty blocks automatic rollback. Worker schema checks remain strict. An internally healthy, schema-compatible target remains running when public acceptance fails and rollback is unsafe; public acceptance stays pending and `last-success.json` stays unchanged.

Public acceptance has a 30-second readiness budget, at most seven attempts, per-attempt timeouts, exponential backoff and jitter. Only HTTP 200 containing `status: ok` and the exact target version is accepted. `accept` validates the original candidate without rebuilding or repeating migration. `reconcile` repairs terminal filesystem finalization without replaying the application workflow.

Node 24 LTS compatibility is checked at CLI, bootstrap, target-controller and container entrypoints. Read-only Tunnel diagnostics identify the service process and its owned metrics sockets rather than assuming a permanent metrics port.

See [repair plan](DEPLOYMENT_RELIABILITY_PLAN.md), [operator guidance](DEPLOYMENT_RELIABILITY_OPERATIONS.md), and the local verification report under ignored `work/` for command output. This patch does not establish a Cloudflare infrastructure root cause.
