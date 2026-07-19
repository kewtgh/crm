# Lumina Education CRM 1.2.0

Release date: 2026-07-19

## Outcome

Version 1.2.0 closes the comprehensive CRM, security, resilience, architecture, UI/UX, accessibility, import, operations, and product audit.

## Highlights

- Complete editable CRM records with history, archive, concurrency protection, and approved export.
- Safe team task delegation, capacity, SLA, reminders, and bulk workflow.
- Durable password-recovery abuse controls and transactionally idempotent dangerous actions.
- Shared pagination/search request architecture and RLS-protected team views.
- Standards-aware CSV import and user-friendly duplicate/data-quality workflows.
- Federated global search and explainable human-confirmed recommendations.
- Bilingual metadata, explicit failure states, responsive layouts, and keyboard focus models.
- A v1.2.0 social preview that reflects the task queue, team capacity, SLA, approvals, and analytics product.
- Unified six-worker processing and cross-platform release gate.

## Verified release evidence

| Check | Result |
| --- | --- |
| Build | Pass |
| TypeScript / ESLint | Pass / Pass |
| Node source contracts | 22/22 |
| pgTAP | 177/177 |
| Schema lint | 0 errors |
| Business and HTTP smoke suites | 5/5 |
| Empty database migration | Through `202607190039` |
| Liveness version | 1.2.0 |

The exact source is published as a private Sites deployment. Real browser and production-provider acceptance remain explicitly tracked external gates; hosted runtime values are not replaced with local test credentials and no simulated success is included in this release record.
