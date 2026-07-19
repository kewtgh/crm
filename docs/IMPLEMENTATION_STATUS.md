# Implementation status — v2.1.0

Status date: 2026-07-20

## Repository outcome

The Chromium-backed audit, remediation plan, expansion scope and final omission review
are implemented. No known actionable P0, P1 or P2 repository defect remains open.

- Education domain: students, households, guardians, academic timelines and progression.
- Growth domain: leads, qualification, dual pipelines and audited opportunity conversion.
- Data operations: CSV/XLSX 10,000-row imports, mappings, row repair and private CSV/XLSX/PDF exports.
- Privacy: identity-reviewed request state machine with sensitive-operation dual review.
- Intelligence: rules-first evidence and confidence, expiry and mandatory human decision.
- Architecture: client/server saved-view split, shared capabilities, UUID parsing, exact aggregates,
  exact growing-list pagination, unified error presentation and separated v2/WCAG styles.
- Operations: six-worker cycle, Node 24 workflow, executable readiness remediation and release gate.
- Identity: administrator-only mandatory MFA, optional staff MFA, username/email login, email OTP,
  HMAC-backed trusted devices, user revocation and Turnstile on every password sign-in.
- Workflow closure: configurable progression, editable education relationships, household
  opportunities, v2 global discovery, dashboard signals and suggestion history/deduplication.

## Final verification

| Gate | Result |
| --- | --- |
| TypeScript | Pass |
| ESLint | Pass |
| Production build | Pass |
| Node contracts | 25/25 pass |
| pgTAP | 275/275 pass |
| PostgreSQL schema lint | 0 findings |
| Database reset from empty | Pass through `202607200042` |
| Business/HTTP/auth smoke suites | Pass |
| Export artifact smoke | Pass (CSV/XLSX/PDF) |
| npm dependency audit | 0 vulnerabilities |
| Production static assets/MIME | Pass |
| Chromium 1228 UI matrix | 27/27 pass |
| QA identity cleanup | 2/2 pass |

The browser record is `work/browser-qa-chromium-1228/report.json`; it identifies the
exact executable and Chromium `149.0.7827.55`. It validates 1440/1024/375 layouts,
Chinese/English switching, optional AAL2 manager and support-role boundaries, headings, labels,
contrast, 12px floor, overflow, mobile navigation and drawer focus behavior.

## External production gates

Repository completion cannot manufacture production credentials or third-party state.
Before deployment, the environment owner must:

1. Back up and migrate an isolated/production Supabase project through `202607200042`.
2. Configure Sites runtime secrets for Supabase, Turnstile, throttle/trusted-device HMAC,
   mail and enabled integrations.
3. Configure the hosted Supabase OTP email template to render the six-digit `{{ .Token }}`.
4. Schedule the unified worker cycle and observe six fresh successful heartbeats.
5. Verify private storage policies, alerts, backup restore and production readiness 200.
6. Save and privately deploy the exact tested Sites version, then repeat liveness/readiness and core smoke.

External AI remains disabled: the rules engine runs locally and no CRM data is sent to a
provider without an implemented adapter, explicit feature enablement, credentials and
data-processing authorization.
