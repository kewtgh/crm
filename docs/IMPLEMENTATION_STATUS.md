# Implementation status — v2.3.0 release candidate

Status date: 2026-07-24

## Outcome

The July 20 source audit and the July 23 follow-up remediation are complete. v2.3.0 closes
dependency, session-persistence, private API cache, environment-contract, MFA guidance, password
policy, avatar validation, typography/contrast and browser-QA cleanup findings. Migrations through
`052`, schema lint, all 433 database assertions, business/HTTP/export/asset suites, real device-auth
smoke and the pinned Chromium 1228 matrix pass. The source release candidate is ready for controlled
deployment; production activation still requires real provider credentials, worker heartbeats,
backup/migration procedure and hosted readiness.

The July 24 supplemental pass additionally enforces an always-on security-notification channel,
cleans and rolls back incomplete MFA enrollment, removes stale avatar previews, expands auth/settings/
admin browser coverage, and supplies a bounded atomic `npm run deploy:production` workflow.

Implemented scope:

- Operations: four core workers plus explicitly enabled Webhook/integration workers, correct
  email variable contract, stuck-job readiness, integration retry and actionable remediation.
- Privacy: real ACCESS/EXPORT packages, correction diffs, enforced restriction, deletion
  anonymisation/legal holds, independent review, execution receipts and a step-based staff UI.
- Reporting: complete paged exports, expected/exported row counts, SHA-256/query evidence,
  explicit currency scope and immutable exchange-rate snapshots.
- Authorization: shared capabilities across navigation, actions, pages and APIs for contracts,
  opportunities, calendar, tasks, messages, automation and portal decisions.
- Automation: deterministic triggers/actions, idempotent events, side-effect-free preview,
  rule versions, execution history and failed-run retry.
- Growth: campaign attribution, admissions journeys, per-currency pipeline/won values,
  enrolment/ROI metrics and dashboard links.
- Guardian portal: verified household recipient, digest-only revocable invitation, explicit
  consent before data disclosure, idempotent update requests and receipted approved changes.
- Communications: consent-governed threads, outbound idempotency, manual inbound records,
  delivery receipts, search and failed-delivery retry.
- Data quality/connectors: eight configurable rules, ownership and trends, payment connector,
  replay protection and immutable reconciliation receipts.
- UX/architecture: mobile search drawer, compact empty states, dedicated v2.2 feature styles,
  split privacy/new-domain workspaces and a v2.2 Open Graph asset.
- Security UX: reusable Microsoft Authenticator, Google Authenticator and managed 1Password TOTP
  guidance; protected QR/secret instructions; one 12–128 character password policy; local avatar
  validation; operation-local feedback and a 12px operational typography floor.

## Verification record

| Gate | Result |
| --- | --- |
| TypeScript | Pass |
| ESLint | Pass |
| Production build | Pass |
| Node source contracts | 29/29 pass |
| npm dependency audit | Pass, 0 vulnerabilities |
| Phase-two and v0.9 business smoke | Pass |
| v0.9 and v1.0 HTTP/security smoke | Pass |
| Export artifact smoke | Pass (CSV/XLSX/PDF) |
| Production assets/MIME | Pass, 25 assets |
| Database migration head actually applied | `202607210052` |
| Full pgTAP suite | 433/433 pass across 9 files |
| PostgreSQL schema lint | Pass, 0 findings at `052` |
| Core worker cycle | Pass; 6/6 repaired plus 1/1 freshly queued calendar deliveries reached the local validation sink |
| v1.1 authenticated smoke | Pass |
| Real device-auth smoke | Pass, including session-only refresh rotation and private cache policy |
| Pinned Chromium matrix | Pass, 57/57 page/viewports, 0 errors/warnings, identities cleaned 3/3; targeted admin-security fix 2/2, cleaned 1/1 |
| Browser evidence | Chromium 149.0.7827.55 from `ms-playwright/chromium-1228`; `playwright-core` 1.61.1 |
| Dedicated-server deploy | Bounded atomic script and systemd units ready; actual production activation not performed because credentials and hosted readiness remain external |

## Current blockers

Production deployment remains externally gated on dedicated-server secrets, email/Turnstile and any
enabled connector credentials, systemd timer heartbeats, backup verification and hosted readiness 200.
The obsolete Sites project binding and high-frequency Actions Worker schedule have been removed.

## Production continuation sequence

1. Configure real production secrets and schedulers, restore-test the backup, and apply the reviewed
   migrations to the target Supabase project.
2. Deploy the exact commit to an immutable server release, then require liveness, hosted readiness
   and core production smoke.

External providers remain disabled until real credentials, explicit enablement, data-processing
approval and scheduler heartbeats are supplied. The product does not present simulated provider,
AI, delivery or worker state as real.

The final omission reviews are recorded in
[FINAL_REAUDIT_2026-07-23_V2.3.0.md](FINAL_REAUDIT_2026-07-23_V2.3.0.md) and
[FINAL_SUPPLEMENTAL_REAUDIT_2026-07-24_V2.3.0.md](FINAL_SUPPLEMENTAL_REAUDIT_2026-07-24_V2.3.0.md).
