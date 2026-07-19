# Lumina Education CRM

Current release: **v2.1.0**

Lumina is a bilingual, staff-only education relationship and sales CRM. Customers,
contacts, parents, students and household members are business records—not staff
authentication accounts.

v2.1.0 adds and closes:

- editable students, households, guardians and academic timelines, plus configurable, reviewable,
  cancellable and idempotent progression batches;
- school and household leads, qualification, separate pipelines and transactional conversion into
  school or household opportunities;
- CSV/XLSX imports up to 10,000 rows, templates, saved mappings, durable batches and row repair;
- private CSV/XLSX/PDF generated reports, including education, sales and finance datasets;
- data-subject access, export, correction, restriction and deletion requests with identity review,
  dual review for sensitive execution, deadlines and audit;
- evidence-backed, expiring rules-first suggestions with human accept/edit/reject decisions;
- exact database aggregates and currency-separated finance metrics;
- one capability matrix across navigation, actions, pages and APIs, with AAL2 for sensitive roles;
- unified request-aware API errors, UUID validation and executable readiness remediation;
- lazy locale dictionaries, maintainable v2/WCAG styles, mobile fixes and resilient Turnstile states;
- exact server pagination for every growing v2 list.
- username-or-email password sign-in protected by Turnstile and durable throttling;
- mandatory TOTP MFA only for super administrators and administrators, with optional MFA for other staff;
- email OTP on new devices for staff without MFA, 30-day HttpOnly trusted devices, audit and revocation;
- global discovery and dashboard signals for students, households, leads and pending progression.

External providers remain explicitly **not connected** until real production credentials,
data-processing approval and schedulers are supplied. The application never presents a
simulated connection, delivery, worker heartbeat, AI result or security state as real.

## Local development

Requirements: Node.js 22.13+ (Node 24 supported) and Docker Desktop.

```bash
npm install
npx supabase start
npm run env:configure-local
npm run auth:bootstrap-admin
npm run dev
```

The CRM uses `http://localhost:3200`; local Supabase uses ports 56321–56324. Public
signup is disabled. The bootstrap command creates a real staff super administrator,
forces first-login password replacement, removes `ADMIN_PASSWORD` from `.env.local`,
and writes the one-time credential only to the Git-ignored work directory.

## Operations and verification

Run all six queue processors once:

```bash
npm run workers:process
```

Run the complete release gate:

```bash
npm run release:gate
```

The gate runs typecheck, lint, production build, 25 Node contracts, dependency audit,
schema lint, 275 pgTAP assertions, business, HTTP and real device-auth smoke suites, static-asset/MIME
validation, and real UI QA with the installed
`ms-playwright/chromium-1228/chrome-win64/chrome.exe`.

Browser evidence is saved in `work/browser-qa-chromium-1228/report.json`. The current
matrix covers 27 public/authenticated page-and-viewport checks at 1440, 1024 and 375px,
Chinese/English switching, optional manager AAL2, a support-role permission boundary, hydration,
console/page/network errors, headings, labels, contrast, text size, overflow, mobile
navigation, drawer focus restoration, global search, relationship maintenance, progression
application and household lead conversion.

## Health

- `GET /api/health`: process liveness and release version.
- `GET /api/health?mode=ready`: Auth, database, environment, queue SLA, optional
  integrations and all six worker heartbeats, with executable remediation details.

Repository work is complete; a production rollout still requires real Sites runtime
secrets, a backed-up production Supabase migration, hosted email OTP template, scheduler
heartbeats and readiness 200. See the [v2.1 audit](docs/AUDIT_2026-07-20_V2.1.0.md),
[executed remediation plan](docs/REMEDIATION_AND_PRODUCT_PLAN_V2.1.0.md),
[implementation status](docs/IMPLEMENTATION_STATUS.md), and
[deployment guide](docs/DEPLOYMENT.md).
