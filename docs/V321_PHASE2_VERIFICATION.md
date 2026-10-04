# v3.21 Phase 2 — Public Lead Pool & Channel Activation

Verdict: **V321_PHASE2_LEAD_POOL_ACTIVATION_COMPLETE**.

## Baseline and checkpoint

- Branch: `main`; starting/final HEAD: `afd0e2b1c5e54f3618e3f8382de6a50060afcc3f`.
- Committed v3.20 checkpoint: `feat: add admissions application milestone and workflow foundation`.
- Version remains **3.20.0**. Formal checks use **Node 26.10.0 / npm 12.2.0**.
- Phase 1 was 43 uncommitted files. Its patch, manifest, verification and complete raw-file
  snapshot were preserved before Phase 2 under `work/v321-phase2-baseline/`; no patch was reapplied.
- Phase 2 remains unstaged/uncommitted with a separate delta, raw-file manifest and reverse-check
  evidence under ignored `work/v321-phase2/`. No commit, push, deploy or production access occurred.
- Final worktree: **68 changed/new files** combining Phase 1 and Phase 2; **38 files** in the
  independently identified Phase 2 delta. Both the delta and combined checkpoint reverse-check PASS.
- Migration 099 SHA256: `510a85724d8406d8618cc2b660382653da6168af4e9a94b42fd9ef20c257774d`.

## Implemented contract

Forward migration **099** extends existing Leads with explicit PRIVATE/WORKSPACE_PUBLIC
visibility, nullable assignment, strict revision and next action. Available Pool requires
public SCHOOL, no owner and open lifecycle; private/unassigned and terminal records are
excluded. Six existing Lead read roles are retained; five Lead write roles exclude
SALES_SUPPORT. Manager visibility/reassignment and owner release use existing role/team
assignment boundaries. Organization access remains necessary; assigning a Lead does not
grant access to another customer. No anonymous or portal listing is provided.

Dedicated claim/release/reassign/visibility mutations use row locks and actor/payload-bound
receipts. Owner assignment is never a qualification update. Reason-bearing release and
reassignment append operational assignment history; current owner stays on Lead. Direct
ordinary application-role Lead writes are revoked so generic owner PATCH cannot bypass
atomic claim. Audit and existing Automation dispatch are transactionally coupled.

Existing partnership_stage retains all legacy values and gains six finite operational values.
No guessed migration/backfill occurs. Human-confirmed stage update uses the existing Education
mutation with strict revision/receipt, a required reason and append-only stage history.
Initial profile creation and real changes are recorded; ordinary edits create no false
transitions. Regressions are legal. Audit is separate from operational history.

The read-only, security-invoker activation projection queries scoped Lead, Contact intelligence,
Activity, Opportunity, Outreach Event and Enrollment Attribution facts. It hides inaccessible
contacts/related activities, labels canonical sources and never derives Channel Revenue or
Commission. Recent recruitment Events mean noncancelled Events in the prior 90 business days.
Primary/assist Enrollment counts are distinct within each attribution category, not money.

Existing Lead conversion still uses lead_conversions and references the existing Organization.
The new UI explicitly selects Product, optional matching Cohort, title and owner; it does not
guess them or create an Organization copy. Defaulted extra RPC parameters preserve legacy
conversion calls. Lead GET keeps legacy camel-case fields alongside pool fields. Household
Lead create/update and privacy remain supported. Its privacy export uses deterministic
Household membership and includes assignment references once. Contact cleanup leaves staff
assignment history and Organization stage history intact; financial retention is unchanged.

Public Pool / My Leads / All Leads, bounded filters and stable NULL-last sorts reuse the Leads
page. Organization Commercial includes Channel Activation, explicit stage editor/history,
Event links and source-labelled counts. Labels, empty states and conflict/uncertain-save
feedback support zh-CN/en. Unknown tier/potential stay NULL, not D/zero.

LEAD_CLAIMED, LEAD_RELEASED and CHANNEL_STAGE_CHANGED extend existing Automation with existing
TASK/NOTIFICATION actions. Disabled rules stay disabled; retries do not duplicate execution.
No default rules are seeded. Five contextual MEDIUM quality rules warn about missing follow-up,
key people/account owner, recruitment context or active Opportunity. Corrections resolve them;
low scores and Lead age do not trigger automatic qualification or stage changes. New workspace
creation receives the same rule configuration.

## Bounded verification

| Check | Result | Evidence / scope |
|---|---|---|
| Declared runtime | PASS | Node 26.10.0 / npm 12.2.0 |
| Official migration verification | PASS | 104 migrations; every one of the 103 baseline migration raw hashes, including 098, unchanged |
| Lead Pool domain and shared targeted regressions | PASS | 78 tests across Lead Pool, Channel Intelligence, Education, Customer Operations, Enrollment, Commercial Links and structured inputs; final 8 Lead Pool tests rerun after API fixes |
| Lead Pool PostgreSQL | PASS | Disposable local PostgreSQL 18.4: two real concurrent claims with one winner; exact retry; release/reassign; immutable subject; strict revision; tenant isolation; direct-DML rejection; atomic audit rollback |
| Channel golden PostgreSQL scenario | PASS | Existing Organization → Lead → claim → Contact → explicit stage → Product/Cohort Opportunity → Event → Enrollment PRIMARY/ASSIST; no copied Organization or implicit qualification/stage advance |
| Projection/security | PASS | Accessible contacts only; hidden Contact intelligence excluded; workspace B cannot read/claim; real canonical facts aggregated without financial attribution |
| Education / Commercial Links / Enrollment PostgreSQL regressions | PASS | Three existing targeted scripts on the new migration chain, disposable local PostgreSQL 18.4 |
| Automation | PASS | Claim/release existing TASK/NOTIFICATION, disabled rule, exact event/execution retry; stage event only on genuine change |
| Data Quality | PASS | Contextual MEDIUM findings appear, then resolve after correction; no low-score downgrade; hidden Contact does not generate a false missing-key warning |
| Privacy | PASS | Deterministic Household export scope and cross-tenant rejection; Contact cleanup retains staff assignment/stage histories; existing targeted privacy regressions preserved |
| Typecheck | PASS | `npm run typecheck` on declared runtime |
| Scoped lint | PASS | All modified/new v3.21 TS/JS sources; no repository-wide cleanup |
| Production build | PASS | One `npm run build` on declared runtime; no build-affecting source changes afterward |
| Affected Chromium 1243 | PASS | 9 checks: 1440/375px × zh-CN/en Lead Pool and Activation, plus behavioral flow; exact installed executable and revision recorded |
| Browser API boundary | PASS | Actual components + production CSS + mocked business APIs; unauthenticated real API endpoints return 401. Real DB/RLS/concurrency/rollback belong to PostgreSQL tests |
| Architecture and independent delta | PASS | Funnel mapping, Channel architecture, raw baseline and Phase 2 reverse-check |
| Whitespace | PASS | `git diff --check`; frozen migrations not reformatted |
| Full repository regression / full Chromium matrix | NOT RUN | Outside Phase 2 scope |
| Authenticated browser-to-real-DB E2E | NOT RUN | Explicit fixture boundary above |
| Commit / Push / Deploy / Production access | NOT RUN | Not authorized for this phase; no production operation |

Initial browser fixture failures were corrected in test locators for nested history rows,
wrapped select labels and native-vs-searchable options. Product behavior did not change after
the successful build. Deliberately injected 409/503 responses remain identified as expected
warnings; the final browser report contains no unexpected errors. The local QA server was
stopped. Reports/screenshots/patches are ignored local evidence, not product commit contents.

## Deferred / explicit non-scope

Channel Agreements, Commission Rules/Accrual/Settlement, Revenue Attribution, Channel Revenue/ROI,
Sales Targets, Management Intelligence, AI ranking/scoring, automated research/scraping/contact
discovery and Channel Pipeline redesign. Lead bulk import is deferred because the existing
Import catalog has no Lead resource. Open-Lead business uniqueness requires explicit policy;
no guessed constraint blocks future legitimate Leads or multiple Product Opportunities.

See [funnel mapping](V321_PHASE2_FUNNEL_MAPPING.md) and
[Channel commercial architecture](CHANNEL_COMMERCIAL_ARCHITECTURE.md).
