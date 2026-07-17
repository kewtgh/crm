# Lumina Education CRM 1.0.0

Release date: 2026-07-18

## Outcome

Version 1.0.0 completes the repository-scoped audit and remediation plan. Security boundaries now terminate in the database or server, asynchronous work is recoverable and observable, and the proposed renewal, bundle, currency, integration, recommendation, and business-insight capabilities participate in executable workflows.

## Final closure items

- Auth provisioning supports GoTrue's initial two-step metadata write while preserving explicit suspension.
- Legacy quote writers without product/bundle and currency-lock context are no longer callable by authenticated clients.
- Provider Webhook duplicates are acknowledged atomically without relying on HTTP preference behavior.
- Behavioral database tests are isolated from prior smoke data and can run repeatedly in any supported order.

## Evidence

| Gate | Result |
| --- | --- |
| Version | `1.0.0` |
| Production build | Pass |
| Node tests | 17/17 pass |
| pgTAP | 132/132 pass |
| Database lint | 0 warnings |
| Dependency audit | 0 vulnerabilities |
| HTTP security smoke | Pass |
| Business compatibility smoke | Pass |
| Phase-two business smoke | Pass |
| Browser visual acceptance | Pending: no browser instance exposed |
| Sites production deployment | Pending: production runtime and pushed commit absent |

## Release boundary

The code is release-complete, but production deployment is not declared complete until real credentials, six scheduled workers, readiness 200, browser acceptance, and a pushed exact commit are available. Sites remains unchanged and undeployed rather than publishing a known degraded environment.
