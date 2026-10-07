# Operational deletion and compact workspace repair

Baseline: main, v3.28.1. This follow-up addresses reported operational failures and UI density,
using canonical domain ownership and independently fictional QA data. Production is outside scope.
Six untracked Revenue specifications remain excluded and byte-identical.

## Work sequence

1. Preserve timestamp microseconds across database reads and optimistic mutation tokens. Reproduce
   recoverable Organization deletion with synthetic fractional timestamps and retain genuine stale
   conflict protection. Refresh editor snapshots before opening a task.
2. Close removal gaps across the full user-created resource inventory, not just Leads: 44 kinds
   use a searchable cleanup entry and daily surfaces use contextual actions. Preserve existing
   ownership/capability semantics, revisions, AAL2, receipts and audit. Keep domains independent.
   Unused channel drafts are removable; executed financial facts retain reversal/cancellation.
   Extend the existing recycle model,
   with a new additive migration if canonical storage requires it; never alter historical SQL.
3. Place the Household self-service portal inside Communications context, preserving deep links
   and portal capability checks without its separate global navigation entry.
4. Standardize aligned labels, 36–40px filter controls and four-column expansive desktop filters.
   Search and common selectors remain visible; advanced controls use the shared accessible drawer.
5. Improve Organization/Contact directory filters using actual server support. Add Student grade/
   academic-year and Household status filters with server-side paging/counts, rather than filtering
   an incomplete page of records on the client.
6. Tighten Enrollment/Application/Student Support filter layout. Organize Support into clear
   operational list, analytics and outcomes surfaces without changing case or outcome ownership.
7. Add a searchable Student selector and explicit correction task to Academic Progression. Keep
   September 1 workspace-timezone automation, formal Student updates and manual hold/skip behavior.
8. Refine Lead rows for scanning and reachable contextual deletion. Consolidate Organization
   privacy/completeness into compact secondary controls, retaining access to both.
9. Add clearly scoped Commission filtering and compact Organization selection. Keep agreement,
   eligibility, accrual and settlement separate, with explicit currencies and permissions.
10. Refine Executive/Channel analysis with compact scope, clear summary hierarchy and disclosed
    detail. Preserve PERIOD/SNAPSHOT, restricted/unavailable/zero and separate currencies.
11. Simplify Import workspace navigation and operation hierarchy, retaining strict preflight,
    repair, apply and rollback contracts. Safe technical diagnostics remain reachable.
12. Use shared low-chroma section tones for work, context, analysis, finance and governance.
    Separate purpose styling from status severity; verify readability and responsive layout.

## Verification and boundary

Use focused domain and rendered contracts, typecheck/lint and one required production build.
Use pinned Chromium 1243, actual components/CSS and synthetic APIs for changed-page 1920, 1440
and 375 samples. Test the database timestamp/deletion behavior on positively isolated disposable
PostgreSQL only. Browser mocks do not prove RLS or DB mutation. Stop local QA services afterward.
Raw evidence stays ignored under work/. No Production, push, deployment or Revenue implementation.

Acceptance: valid removal succeeds, stale removal fails without overwriting, contextual deletion is
permitted only by canonical authority, desktop controls align and use horizontal space, mobile
filters disclose progressively, and every requested area has a recorded verification result.

## Earlier-plan closure

The saved [audit](UX_OPERATIONS_AUDIT.md) distinguishes confirmed implementation gaps from
policy-dependent roadmap recommendations. Progression automation, canonical workspace ownership,
save/refresh semantics and management facts are preserved. Revenue, Activity bilingual relaxation,
identity inference and new external integrations are excluded. The version is promoted to 3.29.0
after implementation, with additive migration 114 and no historical migration edits. Commit uses
an explicit reviewed file set; no push or Production operation is part of this work.
