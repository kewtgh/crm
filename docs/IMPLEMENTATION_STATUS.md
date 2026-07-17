# Implementation status — v0.7.0

## Production-capable core

- Staff-only Supabase Auth; anonymous signup, public registration, invitation registration, and demo authentication are disabled.
- Administrators create staff accounts with generated temporary passwords and transactional email delivery; administrators can only be created by a super administrator.
- Every sign-in uses Turnstile server validation. First sign-in forces password replacement. Super administrators and administrators must complete TOTP and reach AAL2 before CRM data access.
- Six staff roles, two administrator levels, workspace/team/owner RLS, database-level privileged MFA gating, and auditable maker/checker approvals.
- Real dashboard, notifications, staff administration, customer organizations, contacts, tasks, opportunities, contracts, products, calendar, settings, sales/relationship analytics, and consumption reporting.
- Server-side search/pagination for long operational lists and remote search for related-record selectors.
- Contract signing, performance allocation, secure approved exports, renewal reminders, notification outbox, and export workers.
- True zh-CN/en locale architecture. UI content follows the chosen language; human names intentionally render Chinese and English together.

## Explicitly disabled

The standalone lead lifecycle, bulk import, merge review center, data-quality rule center, dedicated student/household lifecycle, progression workflow, and AI workspace do not yet have a complete persistence/permission/rollback/audit chain. Their routes show an unavailable state and cannot return fake success.

## Verification

- `npm run typecheck`: pass
- `npm run lint`: pass
- `npm test`: pass (production build + 14 architecture/contract tests)
- pgTAP authorization structure: pass (15 tests)
- Local authentication smoke: Turnstile login, first-password replacement, TOTP enrollment/challenge, AAL2 session, admin API gate, staff creation email and temporary-password marker pass
- Local HTTP smoke on dedicated port 3200: health/version, login, Turnstile markup, missing registration route, MFA handoff and AAL1 administrator rejection pass
- Chromium 1228 visual suite: not run because the current browser runtime exposed zero browser instances; required before production release
