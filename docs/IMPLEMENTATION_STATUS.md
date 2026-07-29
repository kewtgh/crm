# Implementation status — v3.6.0 release candidate

Status date: 2026-07-30

## Outcome

The repository migration from the former managed platform to a standard, self-managed PostgreSQL
architecture is complete. Web/API, authentication, repositories, object storage, Workers,
readiness, migrations, deployment and backup/restore no longer require the former platform SDK,
HTTP APIs, Auth, Storage, service-role key or CLI.

The target is one Linux VPS with Caddy, Web/API, systemd Workers and PostgreSQL 18. PostgreSQL
listens only on loopback. `crm_app`, `crm_system`, `crm_worker`, `crm_migrator` and `crm_backup`
have distinct credentials and responsibilities. Only the read-only backup role may bypass RLS so
that logical backups include all workspace rows.

Authentication is application-owned: Argon2id credentials, opaque hashed sessions, HttpOnly
cookies, session rotation and revocation, CSRF plus Origin checks, encrypted TOTP secrets,
recovery codes, email/device verification, password reset, trusted devices, OIDC and SCIM.
Files use a local-persistent or S3-compatible object-store abstraction outside release directories.

The previous database contained only test data, so the transition deliberately uses a clean rebuild.
There is no dual-write, CDC or credential migration path to maintain.

v3.1.0 additionally makes 10,000-row imports terminal-state aware, uses versioned avatar objects,
updates profile tables atomically, keeps detailed readiness on loopback, reports calendar capacity
and user-timezone boundaries, completes mobile-navigation modal semantics, and validates the
one-command deployment against the v3 database-role and Local/S3 storage boundaries.

v3.2.0 makes calendar and communication mutations failure-safe. Malformed calendar action JSON no
longer defaults to completion; appointment creation stores a per-user request key plus normalized
SHA-256 payload fingerprint so uncertain retries return the original record instead of duplicating
appointments, attendees or deliveries. Communication drafts reuse their request key across unchanged
retries, use a synchronous operation lock, send a stable provider idempotency header and keep the
provider timeout below the browser budget. The inbox now reports total/truncated metadata and the UI
surfaces the 100-thread display cap without the former duplicate search icon.

v3.3.0 removes that fixed-snapshot boundary. Communication thread creation now has a per-user
request key and normalized SHA-256 payload fingerprint. Message enqueue returns bounded delivery
ownership, so successful, failed and active short-window replays do not call the provider again.
The inbox loads a real page of thread summaries and the selected thread loads an independent page of
messages, with accessible pagination for both. Write-side refreshes preserve the current search,
page size and selected thread.

v3.4.0 closes the background-delivery time-budget gap. Notification and calendar Webhooks now send
stable `Idempotency-Key` headers and have explicit timeouts. Independent Worker categories start in
parallel; each external category uses ordered, limited concurrency; and runtime preflight rejects
batch/concurrency combinations whose external wait bound exceeds 210 seconds. Loading and fatal
error states now provide complete bilingual feedback, and staff creation cannot be dismissed while
its result is uncertain.

v3.5.0 makes the workspace business date an explicit architecture primitive. User and
workspace-scoped Worker transactions apply the constrained workspace timezone locally; date-only
RPC values use a stable `YYYY-MM-DD` JSON contract; and contract countdowns use the same business
date. Administrators have an AAL2-protected, audited organization settings page for the timezone and
the CAPTCHA provider. Turnstile remains enabled by default; when disabled for constrained networks,
login, SSO and password recovery enforce self-hosted ALTCHA. Pending mutation drawers now protect
all close surfaces, older timestamps use personal preferences, and task summary truncation is
explicit. Mobile organization summaries and generic switch pointer/focus behavior were also fixed.

v3.6.0 makes disk capacity and project isolation part of the persistent production deployment.
Before Git pull, a fixed root-owned unit validates root, the Docker daemon's exact data root and the
release filesystem against byte and percentage floors, then verifies an independently marked
`lumina-crm-buildkit` builder with bounded GC. After all Web/Worker and public health checks pass,
the runner persists application acceptance and cleans only old Lumina releases, fully labelled
Lumina image IDs and that builder's cache. Current/rollback releases, volumes, backups, uploads and
other Compose projects are never candidates; cleanup failure is non-fatal and fully reported.

## Repository completion

| Area | Result |
| --- | --- |
| Platform dependency exit | Complete; historical source retained only under `archive/supabase` |
| PostgreSQL schema | 73 ordered, checksummed migrations; advisory lock and idempotent rerun |
| Database integrity | Valid foreign keys and indexes; duplicate identities and orphan relations checked |
| Data access | `pg`/Kysely pools and transaction authorization context for app/system/Worker |
| Authentication and authorization | Application-owned Auth plus existing workspace, role, capability and AAL2 semantics |
| Storage | Local-persistent and S3-compatible implementations with safe keys and short-lived access |
| Workers | Six processors use `crm_worker`; categories run in parallel with ordered limited concurrency, workspace business timezone, lease tokens, heartbeat and queue state |
| Operations | Caddy, systemd, loopback PostgreSQL, disk monitor, daily backup, monthly restore test and isolated BuildKit GC |
| Deployment | Root/Docker/release capacity gate; project-only post-health cleanup; forward-only migration, atomic switch and application rollback |
| Documentation | v3.6.0 storage audit, executed plan, deployment/storage/recovery runbook and final re-audit |

## Verification record

| Gate | Result |
| --- | --- |
| Migration chain / forward apply | Pass; 73 checksummed migrations, with 068 applied locally |
| Integrity validation | Pass; no invalid constraints/indexes, duplicate identities or orphan relations |
| Business schema contracts | Pass for phase 2, v0.9 and v1.1 |
| Worker safety | Pass; bounded-concurrency, delivery timeout/idempotency and 210-second configuration-budget contracts |
| Backup encryption | Pass; AES-256-GCM encrypt/decrypt hash round trip |
| Restore drill | Pass in an isolated temporary database; migration/auth/table counts verified and database dropped |
| Database integration | Pass for the scoped v3.5 probe; user and Worker transactions both returned `2026-07-30` for `Asia/Taipei`; the earlier full v3.4 database record remains valid for its 69-migration baseline |
| TypeScript / ESLint | Pass for v3.6.0 final source |
| Production build | Pass; v3.6.0 final source produced all application/API routes |
| Node contracts | Pass; 41/41 core/version and 6/6 CAPTCHA contracts |
| Deployment contracts | Pass; 23/23 disk gate, project isolation, release/rollback, readiness and cleanup-failure contracts |
| Deployment asset dry-run | Pass; fixed root entrypoint, systemd/sudoers boundary, BuildKit limits and command allowlist |
| Dependency audit | Pass; 0 known npm vulnerabilities |
| Affected Chromium flow | Pass; v3.5.0 fixed Chromium 1228 checked admin/tasks/contracts, then the final organization desktop/mobile and Turnstile→ALTCHA→restore interaction; 0 final errors/warnings, identity 1/1 cleaned |

The v3.6.0 change is limited to deployment/storage code and documentation, so no browser phase was
run. The unchanged v3.5.0 application interaction evidence remains recorded in its re-audit.

## External production gates

Repository completion does not pretend that external systems were changed. Before activation, the
environment owner must:

1. install PostgreSQL/Caddy/systemd definitions, the root-owned Lumina storage maintenance program
   and BuildKit configuration on the actual VPS, then supply unique production credentials and keys;
2. configure real DNS/TLS, independent S3 storage/lifecycle, mail, IdP/SCIM and notification
   endpoints as applicable;
3. run the deployment dry-run, hosted liveness/readiness, login/write/Worker/object checks and an
   off-host backup plus restore test;
4. measure the PRD P95 targets with representative 100,000-person/200,000-activity data; no local
   test fixture is presented as production capacity evidence;
5. place the former test project in read-only mode for the chosen observation period, then have the
   project owner close it.

The organization-wide business date decision is now implemented through transaction-local
PostgreSQL timezone context. Personal timezone settings remain display-only. Production still needs
an AAL2 administrator to confirm the intended business timezone and Turnstile policy after migration
068; disabling Turnstile requires a valid `ALTCHA_HMAC_SECRET` and never disables CAPTCHA.

The executable procedure is in [DEPLOYMENT.md](DEPLOYMENT.md). The detailed implementation evidence
and historical-plan comparison are in
[POSTGRESQL_MIGRATION_COMPLETION_AND_GAP_REVIEW_2026-07-29.md](POSTGRESQL_MIGRATION_COMPLETION_AND_GAP_REVIEW_2026-07-29.md).
