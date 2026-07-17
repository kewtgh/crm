# Implementation status — v0.8.0

## Production-capable core

- Staff-only Supabase Auth; anonymous signup, public registration, invitation registration, and demo authentication are disabled.
- Administrators create staff accounts with generated temporary passwords and transactional email delivery; administrators can only be created by a super administrator.
- Every sign-in uses Turnstile server validation. First sign-in forces password replacement. Super administrators and administrators must complete TOTP and reach AAL2 before CRM data access.
- Six staff roles, two administrator levels, workspace/team/owner RLS, database-level privileged MFA gating, and auditable maker/checker approvals.
- Real dashboard, notifications, staff administration, customer organizations, contacts, tasks, opportunities, contracts, products, calendar, settings, sales/relationship analytics, and consumption reporting.
- Server-side search/pagination for long operational lists and remote search for related-record selectors.
- Contract signing, performance allocation, secure approved exports, renewal reminders, notification outbox, and export workers.
- Customer 360 projects the authorized organization, contacts, opportunities, tasks, activities, appointments, contracts, payments, relationship evidence, and approvals from their source tables with server pagination; there is no shadow customer table.
- Contact channel/purpose consent, source/evidence, withdrawal, retention, quiet hours, and global do-not-contact are persisted and audited. Marketing contact export is approval-gated and filtered again by the worker.
- Quote versioning, discount approval, quote-to-contract conversion, receivable schedules, partial payments, refund approval/evidence, and reconciliation differences preserve the financial trail.
- CSV field mapping, preflight, duplicate candidates, row decisions, idempotent batches, bounded processing, row errors, conflict-safe rollback, and the data-quality rule center are live.
- Calendar invite/update/cancellation deliveries use a claimable queue with per-recipient status, idempotency, provider acknowledgement, and exponential retry.
- True zh-CN/en locale architecture. UI content follows the chosen language; human names intentionally render Chinese and English together.

## Explicitly disabled

The dedicated student/household lifecycle, progression workflow, standalone lead lifecycle, and AI workspace are outside the current staff-only CRM scope and their application routes were removed. No parent, tutor, supervisor, Little Spark, 小火种, or 小火花 identity or workflow exists in the active product surface.

## Verification

- `npm run typecheck`: pass
- `npm run lint`: pass
- `npm test`: pass (production build + 15 architecture/contract tests)
- pgTAP authorization structure: pass (27 tests)
- Phase-two authenticated business smoke: pass (consent grant/withdrawal, discount approval, marketing export request, import idempotency/process/rollback, calendar delivery queue, and customer 360 projection)
- Local authentication smoke: Turnstile login, first-password replacement, TOTP enrollment/challenge, AAL2 session, admin API gate, staff creation email and temporary-password marker pass
- Local HTTP smoke on dedicated port 3200: health/version, login, Turnstile markup, missing registration route, MFA handoff and AAL1 administrator rejection pass
- Chromium 1228 visual suite: remains a production-release gate when a browser instance is available; source/build/HTTP checks do not replace visual acceptance
