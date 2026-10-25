# Implementation plan for v3.43

Baseline: v3.42.0 at `5d190b1`. Implements every adopted finding C1–C6 in
[the audit](FIRST_PRINCIPLES_AUDIT_V343.md).

## Execution and acceptance

- [x] P1 — Define validated inbox views, operation/response contracts and bounded error mappings.
  Add forward migration 140 for filtered authorized reads and atomic receipts. Bind redelivery to
  the reviewed failure token; reject uncertain provider outcomes; verify current access before replay.
- [x] P2 — Extract independent inbox/detail reads and exact-request mutation recovery. Cancel stale
  reads before writes, lock uncertain operations and distinguish accepted writes from failed refreshes.
- [x] P3 — Integrate role-aware controls, URL/history filters, off-page deep links, real page
  correction, manual refresh, per-thread memory drafts and bilingual responsive recovery feedback.
- [x] P4 — Add meaningful contract/API regressions, disposable PostgreSQL checks and one targeted
  Chromium 1248 phase. Cover concurrency/replay/rollback/access, closed and uncertain delivery states,
  transport loss, stale reads, drafts, read-only roles and Chinese/English desktop/mobile layouts.
- [x] P5 — Update release metadata to v3.43.0, save release/verification evidence, run typecheck,
  lint, one required production build and the relevant regression set, review the public diff and
  privacy gate, then commit locally.

## Execution boundaries

Use pinned Node/npm and the installed Chromium revision 1248. Bound each optional command to
55 seconds. PostgreSQL verification uses a new disposable loopback container without loading
application environment files, external deliveries or existing databases/volumes. Keep raw QA
evidence under ignored `work/`. Do not change old migration contents, accounting/approval semantics,
consent policy, runtime pins or deployment state. Do not push or deploy.

The release is complete when all five items pass with saved evidence and a clean committed worktree.
Report any unperformed production/remote acceptance separately from local verification.

All adopted changes are implemented. Acceptance evidence is saved in
[verification](V343_VERIFICATION.md); release behavior and migration ordering are in
[release notes](RELEASE_V3.43.0.md).
