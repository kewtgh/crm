# Lumina Education CRM 1.1.0

Release date: 2026-07-18

## Outcome

Version 1.1.0 closes every repository-actionable finding from the post-release audit. Core sales transitions are executable, CRM and finance metrics are exact, lists no longer hide operational risk, user timezone preferences are enforced across primary workflows, and release readiness is visible without presenting missing external services as healthy.

## Product additions

- Guided opportunity stage transitions with evidence and loss-reason branches.
- A finance risk center backed by exact full-dataset aggregates.
- Resource-specific school, contact, and task workflows.
- Personal saved views and direct data-quality remediation links.
- Payment-overdue Next Best Actions.
- A release-readiness view in the administrator operations center.

## Evidence

| Gate | Result |
| --- | --- |
| Version | `1.1.0` |
| Production build | Pass |
| Node tests | 20/20 pass |
| pgTAP | 132/132 pass |
| Database lint | 0 errors |
| Dependency audit | 0 vulnerabilities |
| Base and Webhook HTTP smoke | Pass |
| Phase-two and v0.9 business smoke | Pass |
| v1.1 remediation smoke | Pass |
| Browser visual acceptance | Pending: controlled runtime exposes no browser |
| Sites production deployment | Gated: production environment and workers are absent |

## Release boundary

The exact repository source is release-complete. A production deployment is intentionally not considered complete until the owner-only Sites runtime contains real production configuration, all six workers are healthy, readiness returns 200, and real-browser acceptance passes. This boundary prevents an empty hosting environment from being represented as a working CRM.
