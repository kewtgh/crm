# Implementation status — v2.6.0 release candidate

Status date: 2026-07-27

## Outcome

The July 27 architecture, business-logic, UI/UX and product audit is implemented. All recorded
P1/P2/P3 findings are closed in source, the proposed command search, preference sync, safety layer
and release-evidence features are present, and the isolated local database reached migration
`202607270054`.

Production activation was not performed. Real SSO IdP metadata, SCIM client token, telemetry
receiver, connector credentials, email delivery, scheduler heartbeats, backup rehearsal and hosted
readiness remain deployment inputs, not simulated product state.

## Implemented scope

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
| Production build | Pass; v2.6.0 routes and production bundles generated |
| Node source contracts | 37/37 pass, including DST gaps, bounded runner and dependency API bridge |
| Dependency audit | Pass; 0 vulnerabilities |
| Phase-two and v0.9 business smoke | Pass |
| PostgreSQL schema lint | Pass, 0 findings |
| Full pgTAP suite | 464/464 pass across 11 files |
| Clean migration application | Pass through `202607270054_v260_experience_integrity` |
| Production assets/MIME | Pass; 26 CSS/JS plus 5 PNG assets, metadata and legacy redirect |
| HTTP, export and real device-auth smoke | Pass on the final production build |
| Pinned Chromium matrix | Pass; 78/78 page/viewports, 0 errors, 0 warnings, identities cleaned 9/9 |

The merged browser evidence is Git-ignored at
`work/browser-qa-chromium-1228/report.json`. It is authoritative for the final run time, page count,
errors/warnings, identity cleanup, build hash, source fingerprint, Chromium version and exact
executable. Dirty local verification is labeled dirty and is not represented as exact-commit
verification.

Final browser evidence: Chromium 149.0.7827.55, `playwright-core` 1.61.1, 242 seconds,
source fingerprint `4a91fb67d9a8182344e570d9195a70831207b9cfb0bcf475895671ee5f422f55`,
build hash `159397db16c2c82f8883764210cb93621a842ad1d9ef251bb57312535a30a38c`,
migration `202607270054_v260_experience_integrity`, and Git state `dirty` at HEAD `0214991`.

## External production gates

1. Restore-test and back up the target Supabase project, then apply reviewed migrations through
   `054`.
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
