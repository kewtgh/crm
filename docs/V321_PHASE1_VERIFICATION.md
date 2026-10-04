# v3.21 Phase 1 — Channel Account Intelligence & Decision Map

Verdict: **V321_PHASE1_CHANNEL_INTELLIGENCE_COMPLETE**.

Baseline: `main`, starting/final HEAD `afd0e2b1c5e54f3618e3f8382de6a50060afcc3f`.
The committed v3.20 checkpoint is `feat: add admissions application milestone and workflow foundation`.
Phase 1 stays at **3.20.0**, uses Node **26.10.0** / npm **12.2.0**, and remains an
unstaged, uncommitted delta. No production access, push or deploy occurred.

## Implementation

- Forward migration **098** extends the existing Organization business profile with
  nullable S/A/B/C/D tier, integer 10–100 potential, separate BD/competitor narratives,
  school subtype, grade bounds and currency-backed tuition. Address belongs to Organization;
  WeChat ID belongs to Contact. Existing curriculum, counts, website, status and decision role
  remain authoritative.
- `organization_admission_outcomes`, `organization_contact_intelligence` and
  `organization_contact_relationships` use workspace composite identities and existing
  customer/education access. Active symmetric edges are deduplicated; direct reporting
  cycles and self/cross-organization edges are rejected; INACTIVE preserves relation history.
- The existing Education mutation preserves omitted commercial fields for old callers.
  Three small domain saves provide strict revision, serialized receipt retry and atomic audit.
  Audit contains references/changed field names, without narrative copies.
- Scoped repositories/APIs and existing Organization/Contact detail Commercial areas provide
  bilingual profiles, intelligence, structured Decision Map lists, outcomes add/edit, current
  Opportunity/Product/Cohort context and filters on the existing Schools list. Related names
  are read through their own RLS. No second Organization or Contact identity exists.
- Education operational write roles remain SUPER_ADMIN, ADMIN, SALES_DIRECTOR,
  SALES_MANAGER, SALES_SPECIALIST, SALES_SUPPORT, subject to existing Organization/Contact
  edit ownership/team access. Relationship writes require Organization edit plus both Contact
  reads. WeChat follows existing Contact write roles (same list excluding SALES_SUPPORT).
  No new capability or portal exposure was introduced.
- Contact export includes intelligence and relationships once. Privacy marker/physical
  cleanup removes personal extensions, edges, WeChat and their receipts, retaining Organization,
  school-level outcomes and existing finance. Five contextual MEDIUM quality rules distinguish
  missing assessment from legitimate low scores; no automatic tier/score changes occur.

## Bounded verification

| Check | Result | Evidence / boundary |
|---|---|---|
| Declared Node/npm | PASS | 26.10.0 / 12.2.0; version stays 3.20.0 |
| Migration verification | PASS | Official verifier; 103 migrations; 102 frozen raw-byte hashes unchanged |
| Channel domain + relevant regressions | PASS | 57 tests: channel, Education, Customer Operations, structured inputs |
| Channel PostgreSQL | PASS | Disposable PostgreSQL 18.4-bookworm; nullable tier/scores, unknown/zero, FK, hidden endpoints, revision/race/retry, audit rollback, quality resolution, privacy retention |
| Education PostgreSQL | PASS | Existing typed mutation, legacy payload/retry, ownership, family purchasing, Quote→Contract, privacy/lifecycle |
| Customer Operations PostgreSQL | PASS | Existing contact/template/ownership/privacy and customer workflows; installed image override |
| Security | PASS | Cross-workspace/cross-organization denied; invisible contact edges omitted; ordinary direct business writes denied |
| Privacy | PASS | Export helper tenant checks; cleanup retains real Contract/Receivable/Payment/Refund fixtures and school outcomes |
| Typecheck | PASS | Declared runtime |
| Scoped lint | PASS | All changed/new source, test and QA files; report under local evidence |
| Build | PASS | One build under declared runtime |
| Affected Chromium | PASS | Pinned 1243 / 153.0.8010.12; 5 groups, zh-CN/en × 1440/375; detail/cards/map/outcome add/edit, WeChat, filters, revision conflict and exact uncertain retry |
| Architecture / independent patch | PASS | Channel architecture; baseline, manifest, checkpoint patch and reverse-check under ignored work path |
| Full repository regression / browser matrix | NOT RUN | Out of Phase 1 scope |
| Authenticated browser-to-real-DB E2E | NOT RUN | Browser uses actual components + build CSS + mocked APIs; real DB/RLS/atomicity tested separately |
| Commit / Push / Deploy | NOT RUN | No Phase 1 commit authorized; no production operation |

Initial fixture failures were corrected: existing unique Organization names, actual default status,
actual Receivable table, wrapped-select test labels and explicit injected 503/409 expectations.
Final checks passed. Expected injected failures remain identified in browser warnings, not hidden.
No build-affecting source changed after the successful build. Local QA server was stopped.

Local recovery/verification evidence: `work/v321-phase1/` and
`work/browser-qa-chromium-1243/v321-phase1/`. These are ignored and are not product commit contents.
See [Channel architecture](CHANNEL_COMMERCIAL_ARCHITECTURE.md).

## Explicit non-scope

Lead Pool, Channel Pipeline redesign, Channel Agreements, Commission, Channel Revenue,
Channel ROI, Sales Targets, Management Intelligence and AI. Deep reporting-cycle detection
is deferred; this phase enforces direct two-node cycles. No new Finance, Admissions,
Student Success or graph engine was built.
