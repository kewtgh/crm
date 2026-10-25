# Implementation plan for v3.44

Baseline: v3.43.0 at `f12cbba`. Implements all adopted A1–A6 findings in
[the audit](FIRST_PRINCIPLES_AUDIT_V344.md).

- [x] P1 — Add shared query/type/decision/result contracts and forward migration 141. Preserve
  existing RLS, terminal administrator rules, custody lock order and specialized revenue review.
  Bind atomic decision receipts to the exact reviewed snapshot; minimize read/audit payloads.
- [x] P2 — Extract the approval workspace from the performance component. Implement current-read
  gates, immediate write locking, explicit exact-request confirmation, accepted/execution-failed/
  refresh-failed states, and protected review context.
- [x] P3 — Add bilingual responsive URL/history views, mine/reviewable/execution focus, correct
  type/status/deadline/history labels, actual page correction and recoverable initial loading.
  Align pending counters across approval discovery surfaces.
- [x] P4 — Verify contract/API boundaries and regressions, a fresh disposable PostgreSQL migration
  chain with replay/concurrency/rollback/access/expiry/custody tests, and one targeted Chromium
  1248 phase across Chinese/English desktop/mobile and failure recovery.
- [x] P5 — Update version metadata to v3.44.0 and save release/verification documents. Run required
  typecheck, lint, build, relevant application tests and staged privacy gates, review the final diff
  and commit locally.

Keep optional checks within 55 seconds and report results between categories. Reuse a successful
build unless production source changes. Use the existing pinned Node/npm/Chromium runtime. Keep raw
evidence in ignored `work/`; use fictional fixtures and a new disposable loopback database without
loading application environment files or touching existing databases/volumes. Do not push, deploy,
alter historical migrations or contact an external recipient.

All adopted work is implemented and verified. See [verification](V344_VERIFICATION.md) for
acceptance evidence and [release notes](RELEASE_V3.44.0.md) for behavior and migration ordering.
