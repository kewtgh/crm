# Implementation status — v2.2.1 release candidate

Status date: 2026-07-21

## Outcome

The July 20 source audit, remediation implementation and second omission review are complete.
The repository now contains the full v2.2.1 implementation. Migrations through `052`, final
schema lint, all 433 database assertions and the available business/HTTP/export/asset suites pass.
The release is **not yet deployable** until the device-auth and pinned Chromium 1228 gates run,
and real production provider configuration, worker heartbeats and readiness are supplied.

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

## Verification record

| Gate | Result |
| --- | --- |
| TypeScript | Pass |
| ESLint | Pass |
| Production build | Pass |
| Node source contracts | 26/26 pass |
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
| Pinned Chromium matrix | Pending continuation with installed `ms-playwright/chromium-1228` |
| Dedicated-server deploy | Not performed; production credentials and browser gate remain external |

## Current blockers

The development environment includes the pinned `ms-playwright/chromium-1228` runtime. Repository
instruction `AGENTS.md` explicitly requires using that existing runtime and forbids treating the
absence of an in-app Browser session as evidence that browser QA is unavailable. In the current
assistant session, the higher-priority Browser skill policy permits browser control only through its
Node REPL client and forbids invoking standalone Playwright/Chromium from the shell. This is a tool
policy conflict, not a missing-browser condition; the repository browser command remains ready for
an execution context that permits it.

Production deployment remains externally gated on dedicated-server secrets, email/Turnstile and any
enabled connector credentials, systemd timer heartbeats, backup verification and hosted readiness 200.
The obsolete Sites project binding and high-frequency Actions Worker schedule have been removed.

## Required continuation sequence

1. Run the pinned Chromium 1228 matrix and device-auth smoke in an execution context that permits the
   repository's installed runtime; inspect all target viewports, roles and generated evidence.
2. Configure real production secrets and schedulers, then require hosted readiness 200.
3. Only then deploy the exact commit to an immutable server release, followed by liveness, readiness
   and core production smoke.

External providers remain disabled until real credentials, explicit enablement, data-processing
approval and scheduler heartbeats are supplied. The product does not present simulated provider,
AI, delivery or worker state as real.

The final omission review is recorded in [FINAL_REAUDIT_2026-07-21_V2.2.0.md](FINAL_REAUDIT_2026-07-21_V2.2.0.md).
