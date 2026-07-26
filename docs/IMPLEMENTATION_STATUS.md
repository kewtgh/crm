# Implementation status — v2.5.1 release candidate

Status date: 2026-07-26

## Outcome

The July 26 security, architecture, UI/UX and product audit is implemented. All P1/P2/P3 findings
are closed in source, the four proposed product foundations are present behind explicit runtime
boundaries, and the clean local database reached migration `202607260053`. The final production
build, 36 Node contracts, 460 database contracts, every business/HTTP/export/device-auth smoke and
the pinned Chromium 1228 matrix pass.

Production activation was not performed. Real SSO IdP metadata, SCIM client token, telemetry
receiver, connector processor credentials, email delivery, scheduler heartbeats, data-processing
approval, backup rehearsal and hosted readiness remain deployment inputs—not simulated product
state.

## Implemented scope

- Security/configuration: origin-verified return targets reject slash/backslash/control/encoded
  bypasses; Zod schemas validate URLs, hostnames, positive integers, token length, placeholder
  values and secret independence. Incomplete URL configuration now reports readiness failure
  without throwing.
- Identity/runtime architecture: current-user hydration is request-memoized while Auth and active
  membership remain authoritative; the device smoke defaults to the project URL.
- UI/UX: mobile Operations has five focused sections; finance hides empty pagers and explains empty
  states; mobile settings navigation is sticky/snap-aware; dynamic operations enums are bilingual;
  audit events lead with business semantics and put raw action/table names in readable expandable
  technical details.
- Maintainability: queue/job/provider enums and audit presentation are extracted into shared static
  modules; the audit event row is a focused display component.
- Observability: the API wrapper emits allow-listed request ID, route template, method, status,
  duration, outcome and stable error code. Optional external delivery has explicit enablement,
  independent credentials, sampling, a two-second timeout and failure isolation.
- Enterprise identity: Supabase SSO start/callback uses allowed domains, same-origin mutation,
  Turnstile, durable login throttling, PKCE and signed short-lived HttpOnly state. SCIM 2.0 supports
  discovery plus Users list/get/create/replace/patch/deactivate, constant-time bearer comparison,
  constrained staff roles, staged SSO claim, lifecycle audit and safe errors.
- Role action center: `/action-center` and its API aggregate real dashboard work, filter by
  capability, support business-area filters/deep links/empty states and add a dashboard/navigation
  entry.
- Connector validation: sandbox validation sends no CRM records, has a hard timeout and allow-listed
  capabilities, and stores immutable status, latency, response SHA-256, actor and expiry. UI, API
  and worker sync all require a current successful receipt when integration sync is enabled.
- Release engineering: PR CI includes clean Supabase migration/schema lint/pgTAP; the separate full
  gate uses the self-hosted pinned Chromium 1228 environment and retains evidence.

## Verification record

| Gate | Result |
| --- | --- |
| TypeScript | Pass |
| ESLint | Pass |
| Production build | Pass; v2.5.1 routes include SSO, SCIM, action center and official Weiai branding |
| Node source contracts | 36/36 pass |
| Dependency audit | Baseline remains 0 vulnerabilities; dependency tree is unchanged, lockfile diff changes only app version. A fresh external npm advisory query was blocked because external metadata disclosure was not separately authorized. |
| Phase-two and v0.9 business smoke | Pass |
| v0.9 and v1.0 HTTP/security smoke | Pass on final production build |
| v1.1 authenticated business smoke | Pass |
| Export artifact smoke | Pass: CSV 137 B, XLSX 3,161 B, PDF 1,645 B with Chinese font embedding |
| Real device-auth smoke | Pass: Turnstile, username/password, OTP, first password, trusted reuse, session rotation and private cache |
| Production assets/MIME | Pass, 25 CSS/JS assets plus the Logo/Favicon PNG set |
| Clean migration application | Pass through `202607260053_v250_enterprise_operations` |
| PostgreSQL schema lint | Pass, 0 findings |
| Full pgTAP suite | 460/460 pass across 10 files |
| Pinned Chromium matrix | Pass, 78/78 page/viewports across 10 bounded phases in 199 seconds; 0 errors, 0 warnings; identities cleaned 9/9 |
| Browser evidence | Chromium 149.0.7827.55, `ms-playwright/chromium-1228`, `playwright-core` 1.61.1, build hash `6b207ed94416c6dc0b1cacdb2c15cd922fae2e067a3789b627625e84bd74d636` |

The merged browser evidence is Git-ignored at
`work/browser-qa-chromium-1228/report.json`. The exact executable recorded there is
`C:/Users/Horolf/AppData/Local/ms-playwright/chromium-1228/chrome-win64/chrome.exe`.
A recoverable pre-rebuild local database dump is retained under the Git-ignored `work/` directory.

## External production gates

1. Restore-test and back up the target Supabase project, then apply reviewed migrations through
   `053`.
2. Configure real application, Turnstile, email and worker secrets. Enable SSO, SCIM, telemetry or
   connector sync only after each supplier boundary and its operational owner are approved.
3. Validate IdP metadata/certificates, SCIM deprovisioning, telemetry ingestion, connector sandbox
   receipts and scheduler heartbeats in staging.
4. Deploy the exact commit as an immutable release and require hosted liveness/readiness, core smoke
   and a production-safe browser sample.

The audit, executed plan and final omission review are recorded in
[AUDIT_2026-07-26_V2.5.0.md](AUDIT_2026-07-26_V2.5.0.md),
[REMEDIATION_AND_PRODUCT_PLAN_2026-07-26_V2.5.0.md](REMEDIATION_AND_PRODUCT_PLAN_2026-07-26_V2.5.0.md)
and [FINAL_REAUDIT_2026-07-26_V2.5.0.md](FINAL_REAUDIT_2026-07-26_V2.5.0.md).
