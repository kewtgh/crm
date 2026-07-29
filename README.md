# Lumina Education CRM

Current release candidate: **v3.4.0**

Lumina is a bilingual, staff-only education relationship and sales CRM. Schools, contacts, parents,
students and household members are CRM business records; staff identities are stored in the
application-owned authentication schema.

Version 3.4 keeps the self-managed PostgreSQL architecture introduced in v3.0 and makes background
delivery bounded at both the task and service levels. Notification and calendar requests now send
stable provider idempotency headers; every delivery has an explicit timeout; independent Worker
categories run concurrently while each category uses limited, ordered job concurrency; and runtime
configuration rejects batch/concurrency combinations that cannot fit the reviewed systemd budget.
Critical loading and fatal-error states also provide complete bilingual feedback.
The runtime remains designed for one VPS:

```text
Caddy :443
  -> Web / API :3200
     -> application services and database gateway
        -> PostgreSQL 127.0.0.1:5432
  -> systemd Worker timer
  -> encrypted backup and restore-test timers
```

The application has no managed-platform SDK or API dependency. It uses separate application,
system, Worker, migration and backup database roles. Authentication uses Argon2id passwords,
opaque server-side sessions, HttpOnly cookies, CSRF protection, encrypted TOTP secrets, replay
prevention, recovery codes, email verification, password reset, trusted devices, OIDC SSO and SCIM.
Database Row Level Security remains enabled as defense in depth, with the user and workspace context
set by the application.

Files are stored through a local-persistent/S3-compatible abstraction. PostgreSQL migrations are
ordered, checksummed, protected by an advisory lock and kept under `db/migrations`. Production
PostgreSQL listens only on loopback. Daily encrypted backups go to an independent object store;
monthly restore verification creates and destroys only a uniquely named temporary database.

## Local development

Requirements:

- Node.js 24.x (`24.18.0` is pinned in `.nvmrc`);
- npm 12.x (`12.0.1` is pinned in `package.json`);
- Docker Desktop.

```bash
npm install
npm run env:configure-local
npm run dev
```

`env:configure-local` starts PostgreSQL 18 on `127.0.0.1:55432`, creates the least-privilege roles,
applies all migrations and bootstraps the local administrator. It preserves unrelated local
integration values, removes retired platform keys and never prints generated secrets.

Useful database commands:

```bash
npm run db:migrations:verify
npm run db:migrate
npm run db:smoke
npm run smoke:phase2
npm run smoke:v09
npm run smoke:v11
```

Run the enabled queue processors once:

```bash
npm run workers:process
```

Independent Worker categories run in parallel. `WORKER_JOB_CONCURRENCY` limits work inside each
category to 1–8 jobs (default 4); the runtime also validates each batch/concurrency combination
against a 210-second external-I/O budget. `WORKER_DATABASE_POOL_MAX` is a per-process ceiling, so
capacity planning must account for all enabled categories. Mail providers must honor the stable
`Idempotency-Key` header before production delivery is enabled.

## Verification and deployment

For a bounded repository check:

```bash
npm run typecheck
npm run lint
npm run test:contracts
npm run test:deploy
npm run build
```

The repository also includes the pinned `ms-playwright/chromium-1228` browser workflow. Run only the
phase relevant to a scoped change, or the staged matrix when preparing an authorized release.

On an initialized Linux VPS, the persistent deployment runner performs:

```text
git pull --ff-only
-> npm install
-> checks
-> build
-> checksummed PostgreSQL migration
-> atomic release switch
-> Web/Worker restart
-> liveness/readiness/public health
-> application rollback on failure
```

Only the Git pull may receive the configured loopback proxy. Database, build, Web, Worker, backup
and health processes use direct connections. The database migration is forward-only; application
rollback never claims to reverse an already applied Schema migration.

```bash
npm run deploy:production:dry-run
npm run deploy:production
npm run deploy:production:status
npm run deploy:production:logs
npm run deploy:production:rollback
```

See the [deployment and recovery runbook](docs/DEPLOYMENT.md), the
[v3.4 audit](docs/AUDIT_2026-07-29_V3.4.0.md), its
[executed remediation plan](docs/REMEDIATION_AND_PRODUCT_PLAN_2026-07-29_V3.4.0.md), and the
[final re-audit](docs/FINAL_REAUDIT_2026-07-29_V3.4.0.md). The PostgreSQL transition history remains
in the [migration audit](docs/SUPABASE_EXIT_AUDIT_AND_TARGET_ARCHITECTURE_2026-07-29.md) and
[completion and gap review](docs/POSTGRESQL_MIGRATION_COMPLETION_AND_GAP_REVIEW_2026-07-29.md).
The concise current state is in [implementation status](docs/IMPLEMENTATION_STATUS.md).

## Health

- `GET /api/health` checks Web process liveness and release version.
- `GET /api/health?mode=ready` is loopback-only and reports environment, authentication schema,
  database, Worker and queue status independently with stable reason codes for local deployment
  probes. Public requests receive only the minimal liveness endpoint.

External providers remain disabled until genuine credentials and data-processing approval are
supplied. The UI does not present a simulated provider connection, delivery, Worker heartbeat,
backup or security state as real.
