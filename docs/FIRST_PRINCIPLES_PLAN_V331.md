# First-principles repair and enhancement plan — v3.31

This plan implements R01–R11 from [the audit](FIRST_PRINCIPLES_AUDIT_V331.md).
The user authorizes implementation, version promotion and one local commit. No push, deployment,
Production access or shutdown is part of this new task. Revenue candidates remain excluded.

## Execution order and acceptance

1. **Mutation outcomes — R01/R02.** Introduce a shared client failure/outcome helper, consumed by
   Lead, commercial, activation, commission and deletion operations. Status 0, transport errors
   and server failures preserve the exact attempt; definite rejection permits reviewed correction.
   An accepted write is never retried because refresh failed. Preserve endpoints, payloads,
   request keys, revisions, capability/AAL2 checks and receipts. Verify double-submit and payload
   identity, accepted-write/failed-refresh and forbidden/conflict paths.
2. **Deletion recovery — R03.** Add explicit canonical snapshot reload after conflict and initial
   read failure; a new confirmation is required. After accepted deletion, expose only refresh/close,
   not another mutation. Verify focus, keyboard and mobile recovery with synthetic failures.
3. **Directory context — R04/R05/R06/R11.** Extend the existing paging hook as the single state/URL owner
   for supported Organization/Contact filters. Preserve Back, unrelated query keys and paging.
   Hide previous-scope rows during loading/error, validate required envelope, and distinguish
   filtered no-match from no records. Restore defaults clears advanced scope too. Preserve the mobile saved-view entry exposed by browser testing. Saved-view v1
   remains unchanged and its scope is explicitly described.
4. **Shared interactions — R07/R08/R09.** Keep editable-input Home/End native, make relation lookup
   pending/failure visible while preserving selected identity, and close More on keyboard focus
   exit/link activation. Reuse existing overlay/focus machinery and bilingual labels.
5. **Regression integration — R10.** Connect current workspace and new reliability contracts to
   regular test scripts. Add a bounded Chromium 1243 phase for real components plus production CSS,
   with exact expected failure injection and request assertions at 1920/1440/375.
6. **Closure.** Run affected contracts, typecheck, lint, one final production build, scoped browser
   QA, public privacy, migration and metadata checks. Stop QA server. Compare opening migration
   and Revenue bytes, review exact commit set, promote to 3.31.0 and create one local checkpoint.

## Scope and reporting

No new API, RPC, schema, permission or business policy is needed for these fixes. Migration head
remains 114. No dependency update or full database campaign is planned. Broader policy-dependent
roadmap items in the audit are recorded with prerequisites rather than implemented on assumptions.

Record final implementation, evidence counts, limitations and release boundaries in
`V331_VERIFICATION.md`. Do not mark an item complete on a source-text test alone when browser
interaction or request behavior is its acceptance criterion.
