# First-principles audit — v3.33

## Scope and method

Audit the current working tree after the v3.32 checkpoint and the operational usability repairs. Review the prior sixteen requirements, then trace identity, commercial records, reporting, mutation recovery, authorization, imports, numbering and shared UI behavior from component to repository/database boundary. This is an evidence-based engineering review, not a claim that every route or security property has been exhaustively audited. No Production data or application database access is required.

Principles: each fact has one canonical owner; new people should be created in their business context; a receipt retry must repeat the same intention; saved writes and failed reads are different outcomes; reports must preserve scope/currency; errors should enable safe recovery without exposing data; presets must be reversible drafts; historical identifiers must remain stable.

## Prior requirement reconciliation

The sixteen-item matrix in `OPERATIONS_USABILITY_VERIFICATION.md` records the completed presentation and runtime changes. Remaining gaps are the unconfirmed management overview failure, lack of a supplied external Demo reference, and resilience gaps found below. Chinese/English imports preserve canonical keys intentionally. Automatic numbering covers native business-number fields, not internal UUIDs or externally supplied references. Imported explicit identifiers remain compatible.

## Findings

| ID | Severity | Evidence and consequence | Decision |
| --- | --- | --- | --- |
| A1 | High | `components/v200-workspaces.tsx` retains a receipt key but reconstructs an editable payload after failure. The server rejects changed payload reuse, but the UI offers no clear same-request recovery. | Freeze uncertain student/member requests, prevent duplicate submit, expose explicit retry and distinguish accepted write from refresh failure. |
| A2 | High | `components/workflow-template-editor.tsx` awaits `onSaved()` outside its write error boundary. An accepted save with a rejected refresh can leave the editor busy or ambiguous. | Preserve the accepted result and offer refresh-only recovery; never repeat the save. |
| A3 | Medium | `hooks/use-scope-query.ts` discards `ApiClientError.code/requestId`; the overview renders every non-403 problem as the same generic failure. | Add safe bilingual failure classification, request reference and recovery guidance. Preserve strict response validation and financial facts. |
| A4 | High | Migration 122's counter starts independently of imported explicit codes. An existing matching generated code can repeatedly collide because the failed transaction rolls back the counter. | Append a collision-safe allocator migration and exercise explicit-code collision plus concurrent creation. Do not edit opening migrations. |
| A5 | Medium | `lib/db/gateway.ts` recognizes only lowercase P0001 domain messages, while new canonical functions raise uppercase codes. Domain conflicts can become generic infrastructure errors. | Normalize bounded symbolic codes in either case, preserve private/raw message suppression, test status mapping. |
| A6 | Medium | A selected workflow preset cannot be returned to the visible Blank draft option. | Make preset selection reversible; use independent IDs and retain no automatic activation. |
| A7 | Medium | Prior tests verify the main UI surfaces but not the new uncertain identity creation and report diagnostic states. | Extend the bounded synthetic browser phase and regression entry point. Keep fixture browser and disposable DB evidence distinct. |
| A8 | High | The expanded disposable test reproduces overview validation failure for an empty authorized channel set: SQL grouped aggregates omit count keys, and the projection passes undefined values into required metrics. | Normalize these count keys to zero only when both total and visibleAccounts confirm an empty set; retain rejection of malformed nonempty results. |

## Architecture conclusions

Keep Contact as canonical person identity with separate institution/student/family entry points. Do not introduce a second student-person master. Keep financial read values owned by Contract/Receivable/Payment/Refund/Commission and immutable Revenue facts. No new accounting owner or monetary formula is justified by this audit.

Keep database scope checks and RLS authoritative; navigation capabilities are only presentation. The new Pipeline read policy and aggregate resolve a demonstrated archived-subject inconsistency. Continue testing cross-workspace identity references and retry conflicts.

The global business-prefix counter accommodates existing globally unique business numbers. It is a technical allocator, not a business ledger. Explicit imported codes require collision protection. A gap-free or reset-per-day legal numbering regime is not claimed.

## New capability recommendations included in this release

1. Safe report diagnostics: distinguish session, permission, invalid scope, migration/read timeout and response-shape failures, with an opaque support reference where available.
2. Explicit same-request recovery for direct student/family-person creation.
3. Refresh-only recovery after accepted workflow-template saves.
4. Reversible draft presets and a repeatable current usability regression entry point.

These are small operational capabilities supported by existing owners and receipt infrastructure. Additional AI decisions, general ledger, forecasting, automatic recognition or new party masters are not recommended as part of this release.

## Uncertainty

The originally reported overview loading failure was not reproduced by the earlier disposable database and normal browser fixture. Diagnostic improvements do not establish its original root cause. Broaden verification across empty, restricted and filtered report data; report any remaining uncertainty explicitly. An unavailable external Demo cannot be treated as visually matched.

Audit follow-up: A8 reproduces a concrete overview-load failure after expanding the role/empty-workspace matrix. It supersedes the initial lack of reproduction above; equivalence to a particular remote incident is not claimed without its trace.
