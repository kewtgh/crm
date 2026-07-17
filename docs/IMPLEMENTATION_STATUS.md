# Implementation status — v1.1.0

Status date: 2026-07-18

## Repository outcome

The repository-scoped v1.1.0 audit and remediation plan is complete. No actionable P0, P1, or P2 finding remains in source.

- Opportunity creation and every stage transition now share the same server-owned contract and a guided, accessible workflow.
- Finance lists use independent pagination and exact risk aggregates; query failures are explicit.
- Schools, people, and tasks have resource-specific fields, client/server validation, duplicate invalidation, exact metrics, and shared 10/20/50 pagination.
- User timezone and date-format preferences drive the main client workflows and dashboard reporting boundary.
- Internal component requests use the resilient API client except the intentional authentication bootstrap flows.
- Drawers and mobile navigation have keyboard focus management, Escape handling, focus restoration, and background scroll locking.
- CSS custom properties have executable coverage; personal saved views and direct data-quality remediation links are available.
- Payment-overdue automation and the release-readiness console are integrated into the existing operations model.
- Runtime configuration is schema-validated and production login throttling fails closed without an independent secret.
- Local environment generation is merge-safe, and all smoke suites restore their isolated state.

## Final verification

| Gate | Result |
| --- | --- |
| TypeScript | Pass |
| ESLint | Pass |
| Production build | Pass |
| Node tests | 20/20 pass |
| pgTAP | 132/132 pass |
| PostgreSQL schema lint | 0 errors |
| Dependency audit | 0 vulnerabilities |
| Base HTTP smoke | Pass |
| Webhook HTTP security smoke | Pass |
| Phase-two business smoke | Pass |
| v0.9 compatibility smoke | Pass |
| v1.1 remediation smoke | Pass |
| Liveness | 200, version 1.1.0 |
| Readiness | Expected local 503: six workers are intentionally not scheduled |

The final database reset applied migrations through `202607180037`; all business and HTTP smoke suites passed after the reset.

## External production gates

Repository completion does not manufacture external production state. Production remains fail-closed until:

1. Real Supabase, Turnstile, SMTP, integration, Webhook, callback, backup, and alerting configuration is stored in the hosting environment.
2. All six production workers are scheduled and report fresh successful heartbeats.
3. Production `GET /api/health?mode=ready` returns 200.
4. An available real browser completes 1440/1024/375px, bilingual, overflow, keyboard/focus, and assistive-technology acceptance.

The existing Sites project is owner-only. Its production environment has no entries, no custom domain, and therefore must not receive a known-degraded live deployment. Saving the exact source version is safe; deployment remains intentionally gated by the conditions above.
