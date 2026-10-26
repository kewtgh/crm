# Implementation plan for v3.47

Implements all Q1-Q7 findings and included capabilities in [the audit](FIRST_PRINCIPLES_AUDIT_V347.md).
Baseline `93e217b`; version 3.47.0. Production/V1 and paused V2 remain unchanged.

- [x] P1 — Add strict privacy query/command/result contracts, shared transitions and bilingual labels. Use positive field extraction and no persisted browser draft payloads.
- [x] P2 — Add one forward migration with an RLS read projection, stable complete filtering/pagination, timezone-independent review tokens and atomic command receipts. Recheck current access before replay; retain existing identity/second-review/execution rules and audit atomically.
- [x] P3 — Extract the privacy repository and update the API/SSR entrypoint. Preserve compatibility exports, validate filters before queries, return minimized command results and retain current authentication/CSRF/MFA.
- [x] P4 — Implement the workspace read/command lifecycle and review context, freeze uncertain requests, prevent competing writes and late reads, distinguish accepted work from display failures, and add shareable triage/deadline/mine views with read recovery.
- [x] P5 — Verify contract/API/adjacent regressions and actual PostgreSQL create/replay/stale/concurrent/authorization/rollback behavior using generated records and a disposable instance. Verify Chinese/English desktop/mobile behavior with the pinned browser. Do not run workers or send real mail.
- [x] P5a — Add completed-appointment display controls for five periods, read-only calendar markers and paginated history by completed_at with a scheduled-day jump. Preserve raw history and existing scheduled queries/actions. Verify month-end/timezone boundaries, page totals, completion persistence and no repeat-action controls. No data purge or CRM task-list changes.
- [x] P5b — Add calendar-scoped active-member relations without widening task assignment. Preserve creation/action receipts and external attendee consent; add transactional member invitations/reminders, recipient read access, read-only incoming UI, relation colors/text and notification deep links. Verify current membership, no duplicate notices on replay, update/cancel reminders and ownership boundaries with fictional users.
- [x] P6 — Bump package/lockfile/runtime/README/status to 3.47.0, save release/verification reports, and run full typecheck, lint, contracts, deployment contracts, privacy/dependency checks and real Docker verification. Record actual source/results/skips/image digest; do not reuse earlier release evidence.
- [x] P7 — Inspect final diff and commit locally only after gates pass. No push, production action or replay of any archived deployment request.

Work in visible bounded categories. Optional checks stay within 55 seconds; required production
build/verification retain their existing limits. Stop expanding the audit after adopted behaviors
and their required gates pass. No full browser matrix or historical database campaign is added.
