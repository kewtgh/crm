# Operations usability repair checkpoint

Version remains **3.32.0**. This is an uncommitted implementation checkpoint, not a release promotion. The starting checkpoint is `150b08ef3d6f9c20f7bb8c828e5c72ee72cf3c6d`.

## Requested changes

| Item | Implementation and verification |
| --- | --- |
| 1. Duplicate review alignment | Three matching grid columns with aligned labels; desktop browser geometry assertion passes. Narrow layouts stack. |
| 2. Admissions presets | Two bilingual editable drafts: Institution application (five steps), Course / program enrollment (four steps). Each copy receives fresh step identities. No automatic activation or completion. |
| 3. Navigation duplication | AI suggestions and automation share one capability-aware navigation entry. Independently navigated Imports, Data quality and Duplicates no longer repeat their cross-navigation tabs. |
| 4. Operations sections | Readiness, queues, workers, recovery, integrations, actions and access have distinct section treatments. |
| 5. Management overview | Trends now include accessible charts with expandable exact values; business domains have distinct colors. **The reported overview-load failure remains unconfirmed:** the disposable database projection/validator and normal browser fixture pass. Reproduction context or a safe error reference is still needed. This checkpoint does not claim to fix that failure. |
| 6. Pipeline/list discrepancy | Archived or inaccessible organization/household subjects are excluded at the opportunity RLS boundary. The Pipeline aggregate uses the same visible opportunity source. Disposable PostgreSQL confirms that archiving the fictional institution removes its opportunities from both list and aggregate. |
| 7. Import languages | Public CSV/XLSX downloads use Chinese or English display headers with stable canonical keys. Strict server normalization accepts only known aliases; duplicate aliases and unknown headers remain invalid. Existing canonical-header templates stay compatible. |
| 8. Product template copy | A new product may copy an existing product's descriptions and billing settings. Its state is Draft, number is newly generated, and price must be explicitly entered. Existing product/price history is unchanged. |
| 9. Student/parent entry | Student creation accepts a new person name directly; Family member creation can create a parent directly. Existing-person linking is optional. One canonical person identity remains, with distinct institution/student/family entry points. Creation and mutation receipt are atomic. |
| 10. Institution head | Added the localized institution-head contact classification across form, validation, import and database constraints. |
| 11. Channel agreements | Agreement, version and rule sections have separate visual hierarchy; actions are grouped. Responsive checks pass. |
| 12. New business numbers | Native creation uses the shared database allocator described below. Existing numbers are not rewritten. Concurrent allocation is tested. |
| 13. Lead assessment | Lead cards and expanded qualification signals have a bounded, responsive hierarchy and readable next action. |
| 14. Quick links | Organization/contact quick links have stronger button treatment and visible keyboard focus. |
| 15. Account comparison | Uses the shared pagination component. Adjacent accounts have differentiated card treatment. |
| 16. Organization details | Larger product/service identity, explicit operations buttons, stronger next-action text and differentiated activity cards. Desktop/tablet/mobile fixtures pass. No claim of exact matching to an unavailable external Demo reference. |

## Database and identity boundaries

Two append-only migrations are added:

- `202610080121_operational_identity_and_pipeline.sql`: institution contact classification/directory, atomic education identity creation and Pipeline visibility/aggregation.
- `202610080122_business_record_numbers.sql`: technical atomic number allocator and creation triggers.

Logical migration head is **122**, with **127 SQL files**. All **125 opening SQL files** and **26 protected historical Revenue artifacts** are byte-identical to the opening private manifest. No Revenue accounting semantics are changed.

The native business-number format is `PRODUCT_INITIALS-ORGANIZATION_INITIALS-0001-YYYYMMDD`. English-name initials are bounded to eight characters. Missing context uses the record-kind fallback. The counter grows beyond four digits without truncation; dates use the workspace business timezone. Allocation is atomic and shared by prefix, including across record kinds when their product/organization context matches. It does not renumber historical rows.

Covered business fields are Product, Bundle, Cohort, Contract, Quote, Student, Channel Agreement, Growth Campaign, Refund and Approval numbers. Internal UUIDs and external/bank references are not business numbers and remain unchanged. Explicit imported/legacy API codes remain compatible; native creation surfaces request automatic allocation. Refund and Approval numbers are generated internally. The counter is a technical relation with no app/system/worker writes, not a financial owner.

Student and parent identities remain canonical Contacts internally. They no longer require the user to create an institution contact first. The institution directory retains existing institution-linked contacts and the general/institution staff/institution head categories; it excludes standalone student/parent identities. Existing person linking remains available without duplicating identities.

## Verification

| Check | Result |
| --- | --- |
| Scoped disposable PostgreSQL | PASS: direct student/parent creation, receipt retry/conflict, institution directory separation, cross-workspace denial, concurrent business numbers and archived-subject Pipeline parity. The reused fixture's Finance/Commission/management assertions also passed. |
| Targeted unit/contract tests | PASS: 73 tests across operations usability, import v2/sets/field contract, management experience and record/workspace presentation. |
| Typecheck | PASS |
| Lint | PASS, no errors or warnings reported |
| Production build | PASS |
| Public privacy | PASS: 13 checks |
| Migration inventory | PASS: head 122 / 127 SQL files |
| Browser | PASS: 27 page/viewport checks on pinned Chromium 1243, browser version 153.0.8010.12; desktop 1440, tablet 768, mobile 390; product copy, presets, direct student, English and keyboard interactions. |
| Historical byte protection | PASS: 125 SQL files and 26 protected artifacts unchanged |
| Diff whitespace | PASS |

Browser QA uses real components and built styles with fictional intercepted API responses. It is **not** a browser-to-database E2E claim. The database suite separately uses a disposable PostgreSQL instance. Screenshots and operational evidence remain under ignored `work/`; they are not public release artifacts.

The first browser invocation incorrectly selected the standard wrapper phases because the wrapper expects `QA_PHASE`, not `QA_SCOPE`. It was stopped; the new explicit `operations-usability` phase was then registered and run with a 55-second hard limit. Initial test-locator failures were corrected to match the current student header and its collapsed optional identity selector. Final scoped QA passed. No full ten-phase browser campaign is claimed.

## Remaining limits and Git boundary

The management overview loading failure still needs a reproducible role/filter/error context. Its normal database and browser paths passing does not establish the cause of the reported failure. The external Demo layout was not available for exact visual comparison.

This checkpoint has not applied migrations to an application or Production database. Deployment must apply the two new migrations together with the matching runtime.

Staging: **EMPTY**. Commit: **NOT RUN for this repair checkpoint**. Push: **NOT RUN**. Deploy: **NOT RUN**. Production: **NONE**.
