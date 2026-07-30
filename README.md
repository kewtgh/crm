# Lumina CRM

Current release candidate: **v3.8.2**

Lumina is a bilingual, staff-only education relationship and sales CRM. Schools, contacts, parents,
students and household members are CRM business records; staff identities are stored in the
application-owned authentication schema.

Version 3.8 closes the shared-host isolation gap by moving every Lumina controller, Compose task,
builder and maintenance command to a dedicated rootless Docker user service. Deployment gates
verify the exact user socket, rootless security mode, systemd cgroups and a Lumina-only data root.
It also verifies each encrypted database backup with its matching encrypted local-object archive,
replaces the public Worker gateway with Cloudflare Tunnel to a loopback-only Caddy listener, fixes
the Compose disk monitor and secure sign-out flow, removes stale deployment code, and trims the
runtime image to required scripts.

Version 3.7 moved production to the fixed `lumina-crm` Docker Compose project. PostgreSQL, Web,
Worker, migrations, encrypted backup/restore, commit-tagged image release, application-only
rollback, and Lumina-only cleanup have explicit container and credential boundaries. HunterAI and
Temporal resources are never shared or managed by Lumina.

Version 3.5 closed the organization-wide business-date architecture gate. Each workspace now has a
constrained, audited business timezone that administrators can change only with AAL2; user and
workspace-scoped Worker transactions apply it locally so existing PostgreSQL date rules agree.
Contract countdowns use the same business date. Pending mutation drawers cannot be dismissed through
Escape, overlay, close or cancel controls; legacy timestamps use personal display preferences; and
the task priority queue reports when its 12-item summary is truncated and links to the full list.
Administrators can also switch Cloudflare Turnstile off for constrained networks; sign-in, SSO and
password recovery then enforce the self-hosted ALTCHA verifier instead of bypassing CAPTCHA.
The production runtime remains designed for one shared VPS:

```text
configured public hostname
  -> Cloudflare Tunnel
     -> Caddy 127.0.0.1:3211
        -> Web 127.0.0.1:3200
           -> Compose Web / Worker / private PostgreSQL
```

The application has no managed-platform SDK or API dependency. It uses separate application,
system, Worker, migration and backup database roles. Authentication uses Argon2id passwords,
opaque server-side sessions, HttpOnly cookies, CSRF protection, encrypted TOTP secrets, replay
prevention, recovery codes, email verification, password reset, trusted devices, OIDC SSO and SCIM.
Database Row Level Security remains enabled as defense in depth, with the user and workspace context
set by the application.

Files are stored through a local-persistent/S3-compatible abstraction. PostgreSQL migrations are
ordered, checksummed, protected by an advisory lock and kept under `db/migrations`. Production
PostgreSQL publishes no host port and joins only the internal Lumina backend. Daily encrypted
backups go to an independent object store;
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

On a new Linux VPS, first run the explicit persistent initialization mode. It adds repeat-safe
database role/extension and initial-admin bootstrap around the forward-only migration, then records
the first accepted release with no rollback image. Ordinary deploy refuses to run before this
accepted state exists and never invokes either bootstrap step.

The persistent deployment runner performs:

```text
rootless Docker/state capacity gate
-> isolated Lumina BuildKit verification
-> one exact Git fetch and fast-forward
-> containerized checks and commit-tagged app/ops images
-> migration verification and locked forward migration
-> Compose Web/Worker image switch
-> independent PostgreSQL/Web/Worker health
-> loopback readiness and Cloudflare Tunnel public liveness
-> persist accepted/rollback images
-> Lumina-only image/BuildKit cleanup
post-switch failure -> application-image rollback; database stays forward
```

The configured Git proxy, when present, is used for the first and only fetch; otherwise that single
fetch is direct. It is never persisted as Git, Docker, or systemd configuration. Containers clear
proxy variables. Database migration is forward-only; application rollback never claims to reverse
an applied schema migration.

```bash
npm run deploy:production:dry-run
npm run deploy:production:initialize
npm run deploy:production
npm run deploy:production:status
npm run deploy:production:logs
npm run deploy:production:rollback
```

See the current [deployment runbook](docs/DEPLOYMENT.md),
[backup/restore runbook](docs/BACKUP_RESTORE.md), [rollback runbook](docs/ROLLBACK.md), and
[implementation status](docs/IMPLEMENTATION_STATUS.md). Versioned v3.6 and earlier deployment audits
are historical/obsolete for production provisioning. The PostgreSQL transition history remains
in the [migration audit](docs/SUPABASE_EXIT_AUDIT_AND_TARGET_ARCHITECTURE_2026-07-29.md) and
[completion and gap review](docs/POSTGRESQL_MIGRATION_COMPLETION_AND_GAP_REVIEW_2026-07-29.md).

## Health

- `GET /api/health` checks Web process liveness and release version.
- `GET /api/health?mode=ready` is loopback-only and reports environment, authentication schema,
  database, Worker and queue status independently with stable reason codes for local deployment
  probes. Public requests receive only the minimal liveness endpoint.

External providers remain disabled until genuine credentials and data-processing approval are
supplied. The UI does not present a simulated provider connection, delivery, Worker heartbeat,
backup or security state as real.
