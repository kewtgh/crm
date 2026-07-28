# PostgreSQL migration completion and final gap review

- Date: 2026-07-29
- Release: 3.0.0
- Audit: `SUPABASE_EXIT_AUDIT_AND_TARGET_ARCHITECTURE_2026-07-29.md`
- Executed plan: `POSTGRESQL_SELF_HOSTED_MIGRATION_EXECUTION_PLAN_2026-07-29.md`
- Data decision: the former production database contained test data only; rebuild from empty

## 1. Final conclusion

All repository work in the platform-exit audit and execution plan is complete. The CRM now uses
standard PostgreSQL connections, project-owned migrations and authentication, an object-store
abstraction, direct database Workers, and same-VPS operational assets. No active runtime path
requires the former platform SDK, Auth, REST/RPC/Storage endpoints, service-role key or CLI.

No repository feature recommendation from the latest audit or remediation plans remains as a
documentation-only promise. The remaining gates need the actual VPS, DNS or provider credentials,
or representative production-scale data; they are listed separately and are not reported as local
successes.

## 2. Executed migration matrix

| Work package | Final implementation | Evidence |
| --- | --- | --- |
| Dependency/config exit | Standard DB/Auth/storage variables; retired keys removed; native server dependencies externalized | `.env.example`, `lib/runtime-environment.ts`, `vite.config.ts` |
| PostgreSQL data layer | Separate app/system/Worker pools, Kysely gateway, parameterized queries and transaction authorization context | `lib/db` |
| Schema and migration | 65 ordered migrations, SHA-256 history, advisory lock, business FK validation and role grants | `db/migrations`, `scripts/db-migrate.mjs`, `scripts/db-validate.mjs` |
| Authentication | Argon2id, hashed opaque sessions, CSRF, email tokens, encrypted TOTP, recovery, revocation, OIDC and SCIM | `lib/auth`, `app/api/auth`, `app/api/settings`, `app/api/scim` |
| Authorization | Existing workspace/RLS/capability/AAL2 semantics retained; app/system/Worker roles cannot bypass RLS | migrations and database integration smoke |
| File storage | Local persistent and S3-compatible backends; safe object keys, metadata/hash and short-lived access | `lib/storage/object-store.ts`, `app/api/storage/object/route.ts` |
| Workers/RPC | Six processors use PostgreSQL and scoped Worker grants; atomic functions remain in PostgreSQL | `scripts/process-*.mjs`, `scripts/lib/worker-database.mjs` |
| Readiness | Environment, auth schema, database, Worker and queues report independent stable reasons | `lib/readiness-diagnostics.ts`, `app/api/health/route.ts` |
| Deployment | Standard migration runner, immutable release, atomic switch, systemd Web/Worker and Caddy | `scripts/deploy-production-runner.mjs`, `deploy` |
| Backup/recovery | Daily custom dump, AES-GCM encryption, independent S3, notification, retention and isolated restore test | `scripts/db-backup.mjs`, `scripts/db-restore-test.mjs`, systemd timers |

The historical managed-platform files were moved to `archive/supabase` as transformation evidence.
They are not included in runtime, deployment or package scripts.

## 3. Historical engineering-plan review

The unchecked boxes in `planning-source/.../04_ENGINEERING_TASK_PLAN.md` and
`05_ACCEPTANCE_CRITERIA.md` are the original V1 planning template, not a live status file. They were
compared with current migrations, routes, UI, Workers and the final audits through v2.9.0.

| V1 domain | Current closure evidence |
| --- | --- |
| Identity, teams and permission | Workspaces, memberships, custom/system roles, capability guards, sensitive operations, audit, self-managed Auth |
| Schools and organizations | School/group/campus/department model, classification, detail/list/search and relationship history |
| People and employment | Unified people, multiple contacts, appointments, decision roles, influence and relationship attributes |
| Students and households | Household members, guardians, education history, course systems and relationship editing |
| Leads and opportunities | School/household pipelines, transactional conversion, stage history, products, quotes, contracts and finance |
| Activities and tasks | Shared activity timelines, task ownership/collaboration/SLA/reminders and Worker delivery |
| Import and duplicates | CSV/XLSX, mapping, dry-run, per-row results, resumable batches, duplicate candidates and rollback/conflict semantics |
| Academic progression | Configurable rules, preview/hold/review/apply, idempotency, snapshots, exceptions and compensation |
| Reports and exports | Database-derived dashboards/reports, CSV/XLSX/PDF artifacts, private storage, expiry and audit |
| AI and recommendations | Provider/prompt/run governance, extraction evidence/confidence, human decisions, next actions and safe filter AST |
| Operations and privacy | Approvals, recycle bin, privacy requests, retention, integrations, observability and readiness |

Later remediation plans closed the old V2.2 browser item in the V2.3 release and subsequently added
privacy execution, enterprise identity, integrations, customer 360, finance, growth, contracts,
relationship intelligence, improved readiness and authentication integrity. The v2.9.0 final review
found no repository product item still pending before this migration began.

## 4. Gaps discovered and closed during implementation

The migration itself exposed issues that were absent or incomplete in the original plan:

1. twelve cross-workspace foreign keys had remained `NOT VALID`; they are now validated;
2. the backup role lacked schema visibility and RLS-complete read semantics; explicit read-only
   grants and backup-only `BYPASSRLS` now make full logical backup possible;
3. the role bootstrap did not re-enforce role attributes on repeat runs; it is now idempotent;
4. Caddy, monthly restore testing and disk-space monitoring lacked complete deployable assets;
5. generated administrator credentials could remain in configuration; bootstrap now supports a
   protected one-time receipt and local setup removes plaintext input;
6. the local QA server did not load the self-hosted environment; its managed start/status/stop flow
   now does;
7. native Argon2/PostgreSQL/S3 packages were incompatible with the obsolete edge-oriented build
   plugin; the build is now standard Node SSR and keeps native packages external;
8. the password-change integration fixture exposed an invalid `workspace_memberships.updated_at`
   write; the flow now updates only valid columns;
9. the transitive `tsx` esbuild advisory was resolved with the reviewed `0.28.1` override; the npm
   advisory result is zero.

Each item above was implemented before the final verification record was produced.

## 5. Verification record

| Check | Result |
| --- | --- |
| Migration from empty | 65/65 applied |
| Migration rerun | 0 applied, 65 current |
| Auth/RLS integration | Argon2id, sessions, TOTP replay, workspace context and password revocation passed |
| Database validation | No invalid constraints/indexes, duplicate identities or orphan relations |
| Business contracts | Phase 2, v0.9 and v1.1 passed |
| Worker execution | 4/4 enabled Workers healthy |
| Backup/restore | Real PostgreSQL 18 custom dump, encryption round trip and isolated restore passed |
| Restore cleanup | Temporary database and plaintext dumps removed; only encrypted ignored evidence retained |
| TypeScript / ESLint / production build | Passed |
| Contract tests | Core 17/17, CAPTCHA 5/5, deployment 19/19, root/login HTTP 2/2 |
| Dependency advisory | `npm audit`: 0 vulnerabilities |
| Pinned browser regression | Affected Chromium 1228 Auth/device/session/password flow passed |

The complete ten-stage Chromium matrix was intentionally not repeated: repository instructions
require the smallest browser phase affected by the change. No unexecuted full matrix is used as
evidence.

## 6. Remaining external activation gates

These are not incomplete repository development:

- install and initialize PostgreSQL, Caddy and systemd units on the actual VPS;
- provide unique production database/session/TOTP/backup/S3 credentials and configure real
  DNS/TLS, mail, notification and optional IdP/integration providers;
- enforce the independent object-store lifecycle and verify off-host backup delivery;
- run hosted liveness/readiness plus login, query, write, Worker, file and notification checks;
- run the PRD capacity test with representative 100,000-person/200,000-activity data and record P95
  results; local test data is not production capacity evidence;
- freeze the former test system, observe the new deployment, retain the old project read-only for
  the chosen period, then have the project owner close it.

The exact installation, cutover, recovery and rollback procedure is documented in `DEPLOYMENT.md`.
After production activation, the test-data clean-rebuild exception ends; future destructive schema
changes require expand/contract migrations and a verified recent backup.
