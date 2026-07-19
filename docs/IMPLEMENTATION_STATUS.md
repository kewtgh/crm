# Implementation status — v1.2.0

Status date: 2026-07-19

## Repository outcome

The repository-scoped audit and remediation plan is implemented. No known actionable P0, P1, or P2 source defect remains open.

- Core CRM records support edit, archive, optimistic conflict handling, history, data-quality correction, and approved export.
- Team tasks support safe delegation, SLA, reminders, team capacity, individual and bulk completion.
- Password recovery has durable hashed throttling, Turnstile, anti-enumeration responses, 429, and `Retry-After`.
- Dangerous mutations expose only transactionally idempotent public RPC boundaries.
- Growing lists use a shared 10/20/50 pagination contract; remote data loads cancel stale requests.
- Personal and RLS-protected team views use versioned schemas.
- CSV parsing, duplicate review, global search, loading/error boundaries, metadata, bilingual UI, mobile behavior, and keyboard focus handling were remediated.
- All six queue processors have a unified cycle command; the release gate works on Windows and Unix-style environments.

## Final verification

| Gate | Result |
| --- | --- |
| TypeScript | Pass |
| ESLint | Pass |
| Production build | Pass |
| Node source contracts | 22/22 pass |
| pgTAP | 177/177 pass |
| PostgreSQL schema lint | 0 errors |
| Database reset from empty | Pass through migration `202607190039` |
| Base HTTP smoke | Pass, version 1.2.0 |
| Webhook HTTP security smoke | Pass |
| Phase-two business smoke | Pass |
| v0.9 compatibility smoke | Pass |
| v1.1 remediation smoke | Pass |
| Unified release gate | Pass |
| Real browser connector | Environment-blocked; no false pass recorded |

## External production gates

Repository completion cannot manufacture production credentials or third-party state. Before a public rollout, the environment owner must:

1. Configure production Supabase, Turnstile, mail, integration, webhook, backup, and alerting values.
2. Schedule the unified worker cycle and observe six fresh successful heartbeats.
3. Confirm production readiness returns 200 without test data or forged heartbeats.
4. Complete the browser matrix in `BROWSER_QA_2026-07-19_V1.2.0.md` on an available browser runtime.

Optional AI configuration only reports provider availability. v1.2.0 remains rules-first and sends no customer data to an AI provider.
