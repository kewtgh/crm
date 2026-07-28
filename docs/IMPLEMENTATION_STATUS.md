# Implementation status — v3.0.0 release candidate

Status date: 2026-07-29

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

## Repository completion

| Area | Result |
| --- | --- |
| Platform dependency exit | Complete; historical source retained only under `archive/supabase` |
| PostgreSQL schema | 65 ordered, checksummed migrations; advisory lock and idempotent rerun |
| Database integrity | Valid foreign keys and indexes; duplicate identities and orphan relations checked |
| Data access | `pg`/Kysely pools and transaction authorization context for app/system/Worker |
| Authentication and authorization | Application-owned Auth plus existing workspace, role, capability and AAL2 semantics |
| Storage | Local-persistent and S3-compatible implementations with safe keys and short-lived access |
| Workers | Six processors use `crm_worker`; enabled processors report heartbeat and queue state |
| Operations | Caddy, systemd, loopback PostgreSQL, disk monitor, daily backup and monthly restore test |
| Deployment | Forward-only migration, atomic release switch, precise readiness and application rollback |
| Documentation | Audit, executed plan, deployment/recovery runbook and final gap review updated for v3.0.0 |

## Verification record

| Gate | Result |
| --- | --- |
| Empty database migration | Pass; 65 migrations, then idempotent rerun with 0 applied |
| Database integration | Pass; Argon2id, session, TOTP replay protection, RLS and password-change revocation |
| Integrity validation | Pass; no invalid constraints/indexes, duplicate identities or orphan relations |
| Business schema contracts | Pass for phase 2, v0.9 and v1.1 |
| Worker cycle | Pass; 4/4 enabled processors healthy |
| Backup encryption | Pass; AES-256-GCM encrypt/decrypt hash round trip |
| Restore drill | Pass in an isolated temporary database; migration/auth/table counts verified and database dropped |
| TypeScript / ESLint | Pass |
| Production build | Pass; native PostgreSQL, Argon2 and S3 packages remain server externals |
| Node contracts | Pass; 17/17 core, 5/5 CAPTCHA, 19/19 deployment and 2/2 root/login HTTP |
| Dependency audit | Pass; 0 known npm vulnerabilities |
| Affected Chromium flow | Pass; login, email verification, trusted device, 30-day rotation, CSRF, password change and global revocation |

The full ten-stage Chromium matrix was not repeated because the repository instructions require the
smallest browser phase affected by a scoped change. The affected pinned
`ms-playwright/chromium-1228` authentication flow passed.

## External production gates

Repository completion does not pretend that external systems were changed. Before activation, the
environment owner must:

1. install PostgreSQL/Caddy/systemd definitions on the actual VPS and supply unique production
   credentials and keys;
2. configure real DNS/TLS, independent S3 storage/lifecycle, mail, IdP/SCIM and notification
   endpoints as applicable;
3. run the deployment dry-run, hosted liveness/readiness, login/write/Worker/object checks and an
   off-host backup plus restore test;
4. measure the PRD P95 targets with representative 100,000-person/200,000-activity data; no local
   test fixture is presented as production capacity evidence;
5. place the former test project in read-only mode for the chosen observation period, then have the
   project owner close it.

The executable procedure is in [DEPLOYMENT.md](DEPLOYMENT.md). The detailed implementation evidence
and historical-plan comparison are in
[POSTGRESQL_MIGRATION_COMPLETION_AND_GAP_REVIEW_2026-07-29.md](POSTGRESQL_MIGRATION_COMPLETION_AND_GAP_REVIEW_2026-07-29.md).
