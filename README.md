# Lumina Education CRM

Current release candidate: **v2.2.0**

Lumina is a bilingual, staff-only education relationship and sales CRM. Customers,
contacts, parents, students and household members are business records—not staff
authentication accounts.

v2.2.0 closes the July 20 full audit: privacy requests execute real correction,
restriction, deletion or verified exports; reports use explicit currency scope and
verifiable row/hash receipts; optional workers no longer block core readiness. It also
adds versioned deterministic automation with preview/retry, campaign/admissions attribution
and ROI, a verified-recipient and consent-first guardian portal, idempotent communications,
configurable data-quality rules and receipted payment/accounting/e-signature boundaries.

v2.1.0 added and closed:

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

Run the four core processors and any explicitly enabled optional processors once:

```bash
npm run workers:process
```

Run the complete release gate:

```bash
npm run release:gate
```

The gate runs typecheck, lint, production build, 26 Node contracts, dependency audit,
schema lint, 433 pgTAP assertions, business, HTTP and real device-auth smoke suites, static-asset/MIME
validation, and real UI QA with the pinned `ms-playwright/chromium-1228` runtime.

When executed, browser evidence is saved in `work/browser-qa-chromium-1228/report.json`. The
staged matrix covers public/authenticated page-and-viewport checks at 1440, 1024 and 375px,
Chinese/English switching, optional manager AAL2, a support-role permission boundary, hydration,
console/page/network errors, headings, labels, contrast, text size, overflow, mobile
navigation, drawer focus restoration, global search, relationship maintenance, progression
application and household lead conversion.

## Health

- `GET /api/health`: process liveness and release version.
- `GET /api/health?mode=ready`: Auth, database, environment, queue SLA, optional
  integrations and the enabled worker heartbeat set, with executable remediation details.

The v2.2 source implementation, second omission review, migrations, schema lint and all 433 pgTAP
assertions are complete. The release remains blocked until authenticated device smoke and the pinned
Chromium 1228 matrix pass. A production rollout to the dedicated server additionally requires real
runtime secrets, a backed-up production Supabase migration, hosted email OTP template, systemd timer
heartbeats and readiness 200. See the [v2.2 source audit](docs/AUDIT_2026-07-20_V2.1.1.md),
[executed remediation plan](docs/REMEDIATION_AND_EXPANSION_PLAN_V2.2.0.md),
[final omission review](docs/FINAL_REAUDIT_2026-07-21_V2.2.0.md),
[implementation status](docs/IMPLEMENTATION_STATUS.md), and
[deployment guide](docs/DEPLOYMENT.md).
