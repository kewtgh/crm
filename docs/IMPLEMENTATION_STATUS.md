# Implementation status — v2.8.0 release candidate

Status date: 2026-07-28

## Outcome

The July 28 account-security, super-administrator execution and UI remediation is implemented,
and the dedicated-server production update path is now a persistent one-command workflow.
TOTP enrollment produces a real QR code and recovery codes, account settings rotate those codes,
super administrators execute terminal actions without approval, and CRM deletion uses a
recoverable 30-day recycle bin. Staff provisioning retains one-time emailed passwords and
first-login replacement while hardening profile/workspace synchronization. The isolated local
database reached migration `202607280055`.

Production activation was not performed. Real SSO IdP metadata, SCIM client token, telemetry
receiver, connector credentials, email delivery, scheduler heartbeats, backup rehearsal and hosted
readiness remain deployment inputs, not simulated product state.

## Implemented scope

- Account security: TOTP setup has a real QR image, manual secret, correctly sized input and ten
  one-time recovery codes. Recovery-code authentication and rotation are available, and password
  updates use the freshly verified session token.
- Super administrator: approval-bound operations execute immediately at the terminal authority
  while retaining audit evidence. Business-record deletion moves into a super-admin-only recycle
  bin with restore and 30-day expiry/purge behavior.
- Staff provisioning: administrator creation keeps the generated temporary-password email flow
  and mandatory first-login change, explicitly synchronizes the profile and workspace membership,
  and returns actionable configuration/service errors.
- Product UI: Weiai purple/navy/orange branding, persistent selected navigation, centered modal
  geometry, a four-column desktop growth summary, localized audit entities and bilingual
  communications purposes are release-tested.
- Runtime: Node 24.18.0 and npm 12.0.1 are pinned across local development, CI and the full release
  gate; non-12 npm installs are rejected by the repository engine policy.
- Production updates: a non-root systemd runner uses a non-blocking system lock, unique deployment
  IDs, immutable commit-addressed releases, separated environment files, bounded quality/migration
  stages, atomic current switching, effective ProxyAgent/loopback checks, persistent logs/status,
  protected retention and verified application rollback. The sudo allowlist names only Lumina units.
- Business time: one shared five-timezone contract is used by settings, calendar rendering,
  repositories and workers. Invalid historical values fall back safely; nonexistent DST wall times
  return `INVALID_LOCAL_TIME`; Postgres enforces the same set.
- Preferences: authenticated language changes persist through `/api/settings`, reload and another
  device while public auth/legal pages retain best-effort local preference behavior.
- Discovery: Ctrl/⌘K combines immediate, localized, capability-filtered page commands with remote
  CRM records and preserves keyboard/mobile listbox behavior.
- Safety and accessibility: a reusable `alertdialog` provides focus placement/trap/restore, Escape,
  scroll lock and inert background. Student/household archive, relationship removal, calendar
  cancellation, invitation revocation and saved-view deletion use it. Navigation exposes
  `aria-current`; 404 is bilingual; dashboard task mutation is per-record idempotent in the UI.
- Release integrity: the bounded-process test is deterministic without relying on sandbox process
  creation. Browser evidence records Git state/status digest, deployable-source fingerprint, build
  hash, version, migration and the exact Chromium executable. Staged reports cannot merge across
  different evidence.
- Assets and supply chain: production QA fetches Logo, Favicons and OG PNGs and verifies HTML
  reference, status, MIME, PNG signature and exact dimensions. React/RSC 19.2.8, PostCSS 8.5.23 and
  secured brace expansion 5.0.8 close current advisories while retaining the compatible
  Next/React ESLint 9 rule set.

## Verification record

| Gate | Result |
| --- | --- |
| TypeScript | Pass |
| ESLint | Pass |
| Production build | Pass; v2.8.0 routes and production bundles generated |
| Node source contracts | 37/37 pass, including DST gaps, bounded runner and dependency API bridge |
| Production deployment unit tests | 16/16 pass; lock, env, paths, atomic cutover, interruption recovery, health, systemd, cleanup and dry-run |
| Dependency audit | Pass; 0 vulnerabilities |
| Phase-two and v0.9 business smoke | Pass |
| PostgreSQL schema lint | Pass, 0 findings |
| Full pgTAP suite | 464/464 pass across 11 files |
| Local migration application | Pass through `202607280055_mfa_recovery_and_super_admin_execution` |
| Production assets/MIME | Pass; 26 CSS/JS plus 5 PNG assets, metadata and legacy redirect |
| HTTP, export and real device-auth smoke | Pass on the final production build |
| Pinned Chromium matrix | Pass; 80/80 page/viewports, 0 errors, 0 warnings |

The merged browser evidence is Git-ignored at
`work/browser-qa-chromium-1228/report.json`. It is authoritative for the final run time, page count,
errors/warnings, identity cleanup, build hash, source fingerprint, Chromium version and exact
executable. Dirty local verification is labeled dirty and is not represented as exact-commit
verification.

Final browser evidence records Chromium 149.0.7827.55, `playwright-core` 1.61.1, migration
`202607280055_mfa_recovery_and_super_admin_execution`, the exact executable, source fingerprint,
build hash and working-tree state in the merged report.

## External production gates

1. Restore-test and back up the target Supabase project, then apply reviewed migrations through
   `055`.
2. Configure real application, Turnstile, email and worker secrets. Enable SSO, SCIM, telemetry or
   connector sync only after each supplier boundary and operational owner is approved.
3. Validate IdP certificates, SCIM deprovisioning, telemetry ingestion, connector sandbox receipts
   and scheduler heartbeats in staging.
4. Deploy the exact commit as an immutable release and require hosted liveness/readiness, core smoke
   and a production-safe browser sample.

The audit, executed plan and final omission review are recorded in
[AUDIT_2026-07-27_V2.6.0.md](AUDIT_2026-07-27_V2.6.0.md),
[REMEDIATION_AND_PRODUCT_PLAN_2026-07-27_V2.6.0.md](REMEDIATION_AND_PRODUCT_PLAN_2026-07-27_V2.6.0.md)
and [FINAL_REAUDIT_2026-07-27_V2.6.0.md](FINAL_REAUDIT_2026-07-27_V2.6.0.md).
