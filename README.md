# Lumina Education CRM

Current release candidate: **v2.6.0**

Lumina is a bilingual, staff-only education relationship and sales CRM. Customers,
contacts, parents, students and household members are business records—not staff
authentication accounts.

v2.6.0 closes the July 27 architecture, business-time and UI/UX audit. It rejects invalid
timezones and nonexistent DST wall times across settings, calendar APIs, workers and Postgres;
persists signed-in language preferences across devices; combines capability-filtered page
commands with CRM record search; and standardizes accessible confirmation for destructive
actions. Release evidence now identifies dirty/clean source state and a deployable-source
fingerprint, while the production asset gate verifies actual Logo/Favicon/OG HTTP, MIME, PNG
signature and dimensions. React/RSC, PostCSS and brace expansion also include the current
security fixes without weakening the Next/React lint rules.

v2.5.1 replaced the application lockup and browser icons with the official transparent
Weiai Education assets, including high-density navigation/auth branding and 16, 32 and
192 pixel PNG favicon metadata with a legacy `/favicon.ico` compatibility redirect.

v2.5.0 closes the July 26 security, enterprise identity, operations and UX audit. It hardens
authentication return targets and production configuration validation, memoizes request-local
staff hydration, adds PII-safe structured observability, bounded Supabase SSO/SCIM foundations,
a capability-filtered role action center, and receipted connector sandbox validation. Mobile
operations, finance empty states, settings navigation, business-readable audit events and CI
database/full-browser gates are included. External SSO, SCIM, telemetry and connectors remain
disabled until real production configuration is explicitly supplied.

v2.4.0 closed the July 24 reliability and full-navigation audit. Every standard quality
entry now has total and no-output deadlines, the release gate reports stage heartbeats and
terminates stuck process trees, and the pinned Chromium suite runs as ten independently bounded
phases. Runtime Supabase/Auth/Storage calls have request deadlines, API errors no longer expose
upstream messages, avatars are signature-validated with old-object cleanup, and the expanded
responsive matrix closes typography, contrast and mobile overflow defects.

v2.3.0 closed the July 23 security audit: it upgrades vulnerable framework and
transitive dependencies, preserves the user's session-only versus 30-day sign-in
choice across token rotation, prevents caching of private API responses, and aligns
the local environment generator with every optional provider boundary. It also adds
reusable MFA authenticator guidance, unifies every password-change path, validates
avatars before upload, and closes the remaining small-text and contrast regressions.

v2.2.1 standardizes development, CI and dedicated-server execution on Node.js 24,
removes the redundant billed Actions worker schedule and moves production worker timing to systemd.

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

Requirements: Node.js 24.x (`24.18.0` is pinned in `.nvmrc`) and Docker Desktop.

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

Deploy an already initialized dedicated production server with one bounded command:

```bash
npm run deploy:production
```

The deployment command performs a fast-forward-only Git pull, builds and validates an immutable
release, applies linked Supabase migrations, atomically switches `/opt/lumina-crm/current`, restarts
systemd services, and checks liveness/readiness. The entire run defaults to a 15-minute hard limit;
every stage has its own shorter timeout, and a failed cutover restores the previous release.

The gate runs typecheck, lint, production build, 37 Node contracts, dependency audit,
schema lint, 464 pgTAP assertions, business, HTTP and real device-auth smoke suites, static-asset/MIME
validation, and real UI QA with the pinned `ms-playwright/chromium-1228` runtime.

When executed, phase evidence is saved below `work/browser-qa-chromium-1228/phases/` and merged
into `work/browser-qa-chromium-1228/report.json`. The ten-stage matrix covers 78
public/authenticated page-and-viewport checks at 1440, 1024 and 375px,
Chinese/English switching, optional manager AAL2, a support-role permission boundary, hydration,
console/page/network errors, headings, labels, contrast, text size, overflow, mobile
navigation, drawer focus restoration, page/record command search, destructive confirmation,
cross-device locale persistence, relationship maintenance, progression application and household
lead conversion.

## Health

- `GET /api/health`: process liveness and release version.
- `GET /api/health?mode=ready`: Auth, database, environment, queue SLA, optional
  integrations and the enabled worker heartbeat set, with executable remediation details.

The v2.6.0 source implementation, remediation, migrations, schema lint, all 464 pgTAP assertions,
real device-auth smoke and 78-page/viewport Chromium 1228 matrix are complete. A production rollout
to the dedicated server still requires real runtime secrets, a backed-up production Supabase
migration, hosted email OTP template, systemd timer heartbeats and hosted readiness 200. See the
[v2.6.0 audit](docs/AUDIT_2026-07-27_V2.6.0.md),
[executed remediation plan](docs/REMEDIATION_AND_PRODUCT_PLAN_2026-07-27_V2.6.0.md),
[final omission review](docs/FINAL_REAUDIT_2026-07-27_V2.6.0.md),
[implementation status](docs/IMPLEMENTATION_STATUS.md), and
[deployment guide](docs/DEPLOYMENT.md).
