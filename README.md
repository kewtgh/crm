# Lumina Education CRM

Current release: **v1.2.0**

Lumina is a bilingual, staff-only relationship and sales CRM for an education-product operating company. Customers, contacts, parents, and students are business records—not CRM accounts.

v1.2.0 closes the comprehensive CRM, architecture, UI/UX, accessibility, security, and operations audit:

- editable and archivable schools, people, and tasks with optimistic concurrency and auditable history;
- database-final task delegation, team capacity, SLA, bulk completion, reminders, and a “My Work” queue;
- durable password-recovery throttling plus Turnstile and preserved `Retry-After`;
- transactionally idempotent duplicate merge, import rollback, quote acceptance, and product activation;
- approval-backed CRM exports with private, expiring generated files;
- shared URL-aware pagination, request cancellation, last-request-wins remote search, and versioned personal/team views;
- RFC 4180-style CSV parsing, searchable duplicate selectors, impact previews, and explicit data-quality verification;
- federated permission-aware search across organizations, contacts, opportunities, tasks, contracts, quotes, and products;
- consistent loading/error/404 boundaries, bilingual metadata, mobile layouts, focus management, keyboard menus, and skip navigation;
- explainable human-confirmed recommendations and truthful optional-provider configuration;
- one six-worker cycle command and one repeatable release gate.

External providers remain explicitly **not connected** until real production credentials and schedulers are supplied. The application never presents a simulated connection, delivery, worker heartbeat, AI result, or security state as real.

## Local development

Requirements: Node.js 22.13+ and Docker Desktop.

```bash
npm install
npx supabase start
npm run env:configure-local
npm run auth:bootstrap-admin
npm run dev
```

The CRM uses `http://localhost:3200`; local Supabase uses ports 56321–56324. Public signup is disabled. The bootstrap command creates a real staff super administrator, forces first-login password replacement, removes `ADMIN_PASSWORD` from `.env.local`, and writes the one-time credential only to the Git-ignored work directory.

## Operations

Run every queue once:

```bash
npm run workers:process
```

In production, schedule this command at the required business SLA. Each of the six workers records success or failure heartbeats; readiness remains degraded while a required worker is stale, a queue is blocked, or a required dependency is unavailable.

Run the complete local release gate:

```bash
npm run release:gate
```

It executes typecheck, lint, production build, 22 Node source contracts, schema lint, 177 pgTAP assertions, five business/HTTP smoke suites, and a production-server liveness check.

## Health

- `GET /api/health`: process liveness and release version.
- `GET /api/health?mode=ready`: Auth, database, queue SLA, environment, and all six worker heartbeats.

See the [v1.2 audit](docs/AUDIT_2026-07-19_V1.2.0.md), [implementation plan](docs/IMPLEMENTATION_PLAN_V1.2.0.md), [final re-audit](docs/FINAL_REAUDIT_2026-07-19_V1.2.0.md), [browser QA record](docs/BROWSER_QA_2026-07-19_V1.2.0.md), [release record](docs/RELEASE_V1.2.0.md), [implementation status](docs/IMPLEMENTATION_STATUS.md), and [deployment guide](docs/DEPLOYMENT.md).
