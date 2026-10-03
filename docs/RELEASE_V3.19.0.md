# v3.19.0 — Cohort and Enrollment operating foundation

Lumina now connects the existing education sales, student and finance domains through
**Product → Cohort → Enrollment**. Products and Students retain their existing identities;
one Student can participate in multiple Cohorts without creating duplicate Students.

- **Product Cohorts (091):** intake and delivery dates, capacity definitions, bilingual
  product entry, workspace integrity, catalog authorization, revision checks and retry receipts.
- **Student Enrollments (092):** immutable Student × Cohort identity, historical household
  context, lifecycle validation, PRIMARY/ASSIST attribution and append-only operational status
  history. Audit events remain separate governance evidence.
- **Commercial links (093):** Opportunity → Cohort; Event → Campaign / Product / Cohort;
  Quote → Cohort; Contract ↔ Enrollment. Product/workspace consistency and access to both
  sides are enforced. Unlink/relink retains history; Quote conversion retains its original context.
- **Operational readiness (094):** read-only Enrollment finance projection, existing Finance
  filters, Cohort/Enrollment import preview/repair/rollback, contextual quality findings,
  Task/Notification automation and derived Cohort/channel counts.

**No duplicate Finance system was created.** Contract, receivable, payment and refund facts
remain authoritative. Exactly one ACTIVE Enrollment link makes a contract exclusive; shared
contract amounts remain `SHARED_UNALLOCATED` and are excluded from attributed Enrollment
totals. A CNY 100,000 contract covering two Enrollments does not become CNY 200,000 revenue.
Totals remain grouped by currency; no implicit FX conversion occurs. Financial changes are
reflected by queries, without synchronizing financial state into Enrollment.

Imports resolve Product code, Cohort code and Student Number deterministically. They do not
match Students by names or create missing Products/Students. Privacy cleanup removes personal
Enrollment/history/attribution/import context while retaining existing financial/legal records.
Enrollment access does not automatically grant access to contract amounts.

## Verification and checkpoint

Release closure uses actual portable **Node 26.10.0 / npm 12.2.0**, unchanged dependencies and
clean `npm ci`. Migration checksums, 72 targeted tests, five disposable PostgreSQL integration
groups, typecheck, scoped lint, build and four affected Chromium 1243 phases passed. Browser
checks cover Chinese/English at 1440/375 using actual affected components and production CSS
with isolated business API fixtures; real database authorization and transactions are tested
separately. An older browser fixture required compatibility updates for the final contract/
finance read endpoints; no product behavior was changed during closure.

See [architecture](COHORT_ENROLLMENT_ARCHITECTURE.md) and
[release closure](V319_RELEASE_CLOSURE.md). Local patches, manifests, logs and screenshots
remain Git-ignored under `work/`; they are not product sources. No production access, push or
deployment is part of this checkpoint.

## Deferred to v3.20+

Student Applications, Admission Milestones, Visa / I-20 workflow, Workflow Templates,
Commission, Student Success, Product P&L, Management Intelligence and AI are not included.
Explicit contract items or Enrollment allocations are future work; shared revenue is not guessed.
