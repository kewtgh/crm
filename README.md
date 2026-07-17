# Lumina Education CRM

Current release: **v1.0.0**

Lumina is a bilingual, staff-only relationship and sales CRM for an education-product operating company. Customers, contacts, parents, and students are business records—not CRM accounts.

v1.0.0 closes the original and supplemental audits and adds:

- database-final authorization for approvals, refunds, quotes, exports, imports, data quality, appointments, and staff identity changes;
- durable hashed login throttling, transactional identity preparation/compensation, uniform API errors, and liveness/readiness health checks;
- leased, crash-recoverable workers, queue SLA/health, audited retries, and an administrator operations center;
- permission explanations, customer activity capture, automated renewal playbooks, opportunity stage guards, consent-safe duplicate merges, and import dry runs;
- provider-confirmed integrations, signed replay-resistant and atomically idempotent webhooks, versioned product bundles, locked exchange-rate snapshots, and measurable Next Best Actions;
- retention, renewal, forecast-accuracy, queue-SLA, and recommendation-adoption business insights;
- truthful relationship/security status, keyboard-accessible global search, robust settings/table error states, and responsive field labels.

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

The CRM uses `http://localhost:3200`; the isolated local Supabase project uses ports 56321–56324. Public signup is disabled, while email/password login for administrator-created staff remains enabled. Local Turnstile uses Cloudflare test keys. The bootstrap command creates the real Supabase Auth super administrator, forces first-login password replacement, removes `ADMIN_PASSWORD` from `.env.local`, and writes the one-time credential only to the Git-ignored `work/local-admin-credentials.txt`.

## Background workers

```bash
npm run reminders:process
npm run outbox:process
npm run calendar-deliveries:process
npm run exports:process
npm run webhooks:process
npm run integrations:process
```

Schedule all six commands in production. Every worker writes success/failure heartbeats; readiness stays degraded when expected workers are missing or stale. Approved exports are stored privately and expire after 24 hours.

## Health and quality gates

- `GET /api/health` is process liveness and should return 200.
- `GET /api/health?mode=ready` checks Auth, database, queue SLAs, and all six worker heartbeats; it returns 503 while production dependencies are incomplete.

```bash
npm run typecheck
npm run lint
npm test
npm run smoke:http-v09
npm run smoke:http-v10
npm run smoke:phase2
npm run smoke:v09
npx supabase db lint --local --level warning
npx supabase test db --local
```

See the [supplemental audit](docs/AUDIT_2026-07-18_V091.md), [complete remediation plan](docs/REMEDIATION_AND_PRODUCT_PLAN_V0.9.1.md), [v1.0 release record](docs/RELEASE_V1.0.0.md), [implementation status](docs/IMPLEMENTATION_STATUS.md), and [deployment guide](docs/DEPLOYMENT.md).
