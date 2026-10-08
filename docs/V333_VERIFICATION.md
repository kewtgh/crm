# v3.33.0 verification

## Outcome and scope

The implementation plan in `FIRST_PRINCIPLES_PLAN_V333.md` is complete. This checkpoint includes the preceding sixteen-item operational usability repair and audit findings A1–A8. The audit and plan were saved before the additional fixes. The release is an engineering checkpoint, not an exhaustive security certification or a Production deployment.

## Finding closure

| Finding | Resolution | Evidence |
| --- | --- | --- |
| A1 — uncertain identity creation | Shared receipt attempt freezes the exact request/key; concurrent submit is rejected locally; definitive rejection clears the attempt; accepted writes are followed by reads only. Family form clears after acceptance. | Receipt unit test, disposable DB receipt/conflict tests, browser aborted-response/retry byte equality. |
| A2 — template refresh after save | Accepted template content freezes; a failed refresh offers refresh-only retry, never a second save. | Unit contract and browser injected refresh failure: one write after retry. |
| A3 — reporting diagnostics | Bilingual classified recovery with bounded opaque request reference; no raw exception, SQL or source payload. | Classification/privacy tests and browser injected HTTP 500 followed by successful read retry. |
| A4 — imported number collision | Migration 123 advances the locked prefix counter past existing explicit numbers. Historical/imported identifiers are preserved. | Disposable PostgreSQL explicit collision and concurrent allocation tests. |
| A5 — domain error codes | Bounded symbolic P0001 codes normalize in either case; raw messages remain excluded. Existing HTTP status mapping is retained. | Domain-code tests and standard request-security tests. |
| A6 — reversible presets | Both generic presets and Blank draft work; copied steps use independent identities. | Schema/unit and browser step-count checks. |
| A7 — regression coverage | New tests join the standard contract suite; new bounded operations and management-projection PostgreSQL commands are available. | `test:contracts`, `test:operations:postgres`, `test:management:projection:postgres`, `QA_PHASE=operations-usability`. |
| A8 — overview empty-set failure | Server projection emits zero missing channel counts only for an explicitly empty authorized set; malformed nonempty results still fail strict validation. | Reproduced failure before fix; disposable role/date/empty-workspace matrix and malformed-data unit regression pass afterward. |

The earlier `OPERATIONS_USABILITY_VERIFICATION.md` correctly recorded the overview issue as unconfirmed at that time. A8 supersedes that diagnostic status: a real empty-set failure is now reproduced and repaired. No claim is made about other remote causes without their trace. Exact comparison to the previously mentioned external Demo remains unavailable.

Final screenshot review also corrected an orphan half-width trends panel during overview failure and made trend-card widths responsive. Financial amounts remain server-derived and separated by currency.

## Verification results

| Gate | Result |
| --- | --- |
| Standard contracts | PASS: 304 tests plus 8 CAPTCHA tests, 312 total, final version 3.33.0. |
| Scoped operations PostgreSQL | PASS: student/parent creation, directory separation, cross-workspace rejection, receipt reuse/conflict, number collision/concurrency, archived organization Pipeline parity. Reused Finance/Commission/management fixture invariants also pass. |
| Management projection PostgreSQL | PASS: manager, restricted seller and empty foreign workspace; default, explicit annual and empty historical date scopes; real SQL through projection and strict response validator. |
| Typecheck | PASS |
| Lint | PASS; final QA helper edits separately checked after the full run. |
| Build | PASS for 3.33.0; rebuilt after the final responsive CSS correction. |
| Browser | PASS: 28 page/viewport checks, pinned Chromium 1243, browser 153.0.8010.12. Desktop 1440, tablet 768, mobile 390; keyboard, English, direct student, presets, product copy, error and retry scenarios. |
| Release metadata | PASS: package, root lockfile, application version, README and implementation status aligned to 3.33.0. |
| Public privacy | PASS |
| Migration inventory / diff whitespace | PASS |

Browser checks use real components and built styles with fictional intercepted APIs. They are not described as browser-to-database E2E. Database checks run independently in disposable PostgreSQL using the existing `postgres:18.4-bookworm` fixture, never the configured application database. No full ten-phase browser or entire database campaign was run.

The standard UI contract initially asserted two separate AI/automation navigation destinations. It was updated to the explicitly requested single destination while retaining independent route/tab capability checks. No historical Revenue phase test was rewritten to conceal a failure.

## Migration and compatibility

- Baseline checkpoint: `150b08ef3d6f9c20f7bb8c828e5c72ee72cf3c6d`, version 3.32.0.
- Release runtime applies migrations **121, 122 and 123**; final logical head **123**, **128 SQL files**.
- All **127 SQL files present at this audit's opening** remain byte-identical, including the prior uncommitted 121/122 repair files.
- All **26 protected historical Revenue artifacts** remain unchanged and excluded from staging/commit.
- Native new business numbers use the shared initial/sequence/date convention. Internal UUIDs and external references are unchanged; explicit imported codes remain compatible. Historical records are not renumbered.
- Canonical Revenue, Payment, Refund, Receivable and Commission semantics are unchanged. No guessed financial backfill or new financial owner.

## Operational boundaries

Apply the new migrations with this application version through the normal deployment workflow. This task does not deploy or apply them to an application/Production database. Initial Revenue provisioning and other previously documented tenant governance constraints remain.

Uncertain request retention applies while the editing component remains mounted; it is not an offline queue or a cross-device transaction recovery service. Raw QA logs/screenshots remain ignored under `work/`; no private artifacts are committed.

The user authorized a local version checkpoint commit. The intended staging set is limited to this release's source, migrations, tests and minimized documentation, excluding protected Revenue candidates. After the commit, staging must be empty. Push: **NOT RUN**. Deploy: **NOT RUN**. Production: **NONE**.
