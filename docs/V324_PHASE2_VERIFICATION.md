# v3.24 Phase 2 — Deterministic Contract Generation & Download

Verdict: **V324_PHASE2_DETERMINISTIC_GENERATION_COMPLETE**

This is technical infrastructure completion, not approval of either real legal template.
Both real v1 templates remain **DRAFT**. Production generation requires a separately approved,
active compatible version and approved workspace document configuration.

## Baseline

| Item | Result |
| --- | --- |
| Branch | `main` |
| Starting / final HEAD | `b0b1992cb65a2e29dae1d7656bf03ff94cd477d8` |
| Starting / final version | `3.23.0` |
| Runtime | Node `26.10.0`, npm `12.2.0` |
| Opening worktree | 14 untracked Phase 1 / Roadmap candidate files; no staged changes |
| Phase 1 baseline | `work/v324-phase2-baseline/`: raw snapshots, manifest, complete Phase 1 patch, 113 historical migration hashes, verification and visual evidence references |
| Final candidate | 47 combined candidate files, including this report; staging EMPTY |
| Git actions | Commit NOT RUN; push NOT RUN; deploy NOT RUN; Production access NONE |

No saved patch was reapplied. The Phase 2 delta is independently reversible against the opening
Phase 1 state. Evidence is Git ignored under `work/v324-phase2/` and the existing browser evidence path.

## Schema / reuse decision

The existing `contract_documents` requires a customer `contract_id` and cannot safely parent a Channel
Agreement document. Contract versions, signed uploads and generated artifacts remain distinct.
Migration **109** adds workspace Template Versions, encrypted approved static configuration and
source-aware generated document lineage. It extends the **existing** generated jobs with a document
origin; it does not introduce a second queue, fake customer Contract, signature fact or financial fact.

Approval reuses existing `catalog.manage`, `contracts.manage`, `approvals.decide`, workspace/AAL2 and
maker-checker requirements. Template approval has its own exact governance semantics; it does not
reuse CONTRACT_SIGN or activate an Agreement. Governance is available through the restricted API;
a separate template administration UI is not included in this phase.

Storage reuses the existing local/S3 providers with a protected `contract-documents/` namespace.
Artifacts are retained independently of short-lived tabular export expiry. Download uses a
source-authorized private proxy; bearer local/S3 downloads for this namespace are denied.

| Migration | SHA256 |
| --- | --- |
| 106, unchanged | `3b58df3169aeb191a601611bf7eb92dc8af863efda409a6265087d5ba13539ac` |
| 107, unchanged | `21d18fcfd20c10d8d1d49e03d427dd70866502a77fd2392757eb0cf4ef12cd83` |
| 108, unchanged | `7385bc29a1d5f8a20249c714ecd802b098bd081a5ff44087fcc88f76de842fc2` |
| 109, new | `177aed462485a4f58d3b6e0ede87c1a338cb2051637d367f8cfd7a4397748288` |

All 113 opening historical migration raw-byte hashes match. No dependency, lockfile, engine or version
change was made. The existing deployment image copies the Node helpers and registered templates;
configuration encryption uses an optional, separately provisioned 32-byte document key in web/worker.
No production key, company configuration or business approval was created.

## Generation contract

| Concern | Implemented contract |
| --- | --- |
| Customer source | `CUSTOMER_CONTRACT`; current Contract revision plus explicitly selected active Contract–Enrollment link |
| Channel source | `CHANNEL_AGREEMENT_VERSION`; exact visible version plus explicit same-context Commission Rule and Product/Cohort |
| Commission basis | Current master accepts FIXED_PER_ENROLLMENT only; percentage, wrong-context and unsupported eligibility block |
| Template | APPROVED, active, compatible, registered SHA-matching bytes; no unresolved required unsupported field or review item |
| Canonical inputs | Server-resolved Contract amount/currency, source reference, participant, Household, Product/Cohort; no client override |
| Confirmations | Only declared USER_CONFIRMED fields; actor/time recorded; buyer, Guardian and legal signatory are never inferred |
| Static values | Approved AES-256-GCM workspace company configuration; Student receiving bank only. Channel settlement bank remains explicitly confirmed |
| Validation | Required/conditional values, real ordered dates, decimal amounts, component sum, currency-aware formatting, XML/token safety |
| Evidence | Immutable consumed-field snapshot and source IDs/paths, source revision, template/config references, confirmer/time; no whole-object JSON dump |
| Idempotency | Actor + request key + payload fingerprint; document row is the receipt; concurrent identical requests create one document/version/job |
| Retry | Already accepted receipt reconciles before today's revision/eligibility checks; different payload with the same key conflicts |
| Preview | Authorized DRAFT admin preview or compatible approved preview; clearly PREVIEW-only; no persistent document/job/business mutation |
| Renderer | Production Node; cross-run/table/header/footer replacement; escaped literal values; normalized ZIP order/timestamps; deterministic bytes |

Shared Contract amount is not divided by enrollment count. Multiple links/rules require an explicit
selection. Source revision mismatch creates no document/artifact. Existing source access is checked at
request, work and download; ordinary summaries never expose the raw evidence or sensitive fields.

## Document lifecycle / worker

Explicit new requests create new artifact document versions, independent of Contract versions.
Same-request retries retain the same logical identity. Status is QUEUED → GENERATED or FAILED, with
ERASURE_PENDING → ERASED for privacy. There is no generated SIGNED or Agreement ACTIVE transition.

Request, snapshot, existing job and minimized request audit are atomic. Worker input/reservation/completion
require the current lease. Artifact attempt paths are recorded before storage I/O; partial failures are
cleaned, tracked ambiguous outcomes are reconciled before deletion, and failed jobs use the existing
retry/backoff. GENERATED requires actual artifact metadata. SHA256 and byte length are checked on download.
No Office/Python/LibreOffice production runtime or PDF pipeline was added.

Customer Documents are in the existing Contracts workspace. Channel Documents are beside the appropriate
Agreement version. Both support field review, preview, approved-only generation, history and download.
Unknown results lock inputs and preserve the exact retry request; known revision conflicts ask for refresh.
Canonical fields are read-only and sensitive confirmations are masked. Labels and errors cover zh-CN/en.

## Security / privacy

Workspace, parent visibility and selected Enrollment access apply to preview, generation, summaries,
jobs and download. Channel commission documents additionally require the existing money roles and
Organization access. URL/object-key possession cannot authorize a document download. Paths and filenames
are sanitized; no arbitrary client template path is accepted.

Audit retains IDs, template/version, status and hashes; no bank account, Guardian, full document text
or raw evidence. Worker has no direct document-table SELECT/UPDATE grant: privacy erasure uses the
affected job's current lease and exact origin, and privacy export requires a leased VERIFIED subject request.
Two earlier broad worker-access approaches were rejected by automatic approval review and were not
executed. The implemented lease-scoped RPC alternative passes integration tests.

These generated files are **unsigned operational documents**. Student/associated Contact physical cleanup
revokes download and clears personal snapshot/evidence, then the existing worker deletes recorded artifacts.
Contracts, financial facts, Agreements and Commission ledgers retain their existing policy. Privacy export
includes lineage and only the subject's own mapped identity evidence, not another party's bank/Guardian
values or full DOCX. External parties supplied only as text require privacy staff review; names are not
automatically matched to CRM identities. A future signed archive needs a separately approved retention policy.

## Verification

| Gate | Result | Evidence / boundary |
| --- | --- | --- |
| Phase 1 checkpoint isolation | PASS | Opening manifest + raw snapshots; no commit/apply |
| Declared Node/npm runtime | PASS | 26.10.0 / 12.2.0 |
| Engine / worker targeted tests | PASS | 15 Node tests: approval gates, checksum, fields, currency, deterministic rendering, failure/ambiguity and artifact tamper |
| Phase 1 template regression | PASS | 24 Python tests + two-template lint; Python remains offline QA only |
| Targeted dependencies | PASS | 43 Node tests: template governance/dependencies, storage, Enrollment, Commission, operational readiness and application runtime |
| Deployment key preflight | PASS | 8 tests, including optional valid/matching/separate document key |
| PostgreSQL generation path | PASS | Existing worker CLI + real local object storage; two approved disposable fixture types |
| DRAFT / RETIRED / approved-only | PASS | Real DRAFT versions rejected; retired historical downloads allowed |
| Source concurrency / cross-context | PASS | Stale revision, wrong Enrollment/rule, percentage basis, same-key concurrent clients |
| Idempotency / payload reuse | PASS | One logical document/job; different payload rejected; accepted receipt survives later source revision |
| Atomic rollback | PASS | Injected request audit failure leaves no partial document |
| Renderer / storage failure + retry | PASS | Actual wrong-key render failure and filesystem failure; same job/document retries to GENERATED |
| RLS / hidden source / download | PASS | Cross-workspace and same-workspace hidden parent rejected; no evidence in summaries |
| Worker least privilege | PASS | Direct evidence SELECT/UPDATE denied; wrong-origin lease cannot erase documents |
| Audit minimization / evidence immutability | PASS | Actual audit assertions and immutable snapshot rejection |
| Privacy export / physical artifact cleanup | PASS | Verified subject only; Student and Channel Contact erasure; actual file deletion |
| Contract / Agreement / Commission regression | PASS | No generated signing/activation/payment/accrual; existing Commission PostgreSQL regression |
| Enrollment / Contract links / privacy | PASS | Existing Enrollment PostgreSQL regression |
| Finance / retention / DQ / Automation dependencies | PASS | Existing bounded operational-readiness PostgreSQL regression |
| Word opening + visual rendering | PASS | Two actual worker-generated fixtures; 4 Channel + 7 Student pages inspected |
| Original references / master bytes | PASS | Original SHA checks + both unchanged DRAFT master SHAs |
| Migration verifier / historical raw bytes | PASS | Official verifier + 113 baseline hashes |
| Typecheck | PASS | `npm run typecheck`, final build-affecting source |
| Scoped lint | PASS | 30 changed/candidate JS/TS files, including QA/tests |
| Production build | PASS | `npm run build`; repeated once after observed UI wording/checkbox repair |
| Affected Chromium | PASS | Exact 1243 runtime; 8 Documents scenarios, final production CSS |
| Version metadata | PASS | `npm run release:check`: 3.23.0 |
| Complete candidate reverse-check | PASS | `work/v324-phase2/v324-complete.patch` |
| Independent Phase 2 reverse-check | PASS | `work/v324-phase2/phase2-delta.patch` |
| Whitespace | PASS | Tracked diff and complete candidate comparison |
| QA server | PASS | STOPPED |
| Production PDF output / cloud S3 exercise | NOT RUN | PDF deferred; local storage used, no Production bucket |
| Authenticated browser-to-real-DB E2E | NOT RUN | Component browser QA and real DB integration are separate |

PostgreSQL fixture uses the locally installed `postgres:18.4-bookworm` image with `--pull=never`,
disposable localhost ports and random credentials. This is explicit test-environment evidence, not
an assertion that deployment's declared `18.6-trixie` image was tested or changed. No existing database
or cloud bucket is used. Integration command is bounded to 55 seconds.

## Word / rendering evidence

Reader: **Microsoft Word LTSC 2024, 16.0.17932.21000**. Normal read-only Open, alerts enabled,
no OpenAndRepair, no repair prompt accepted. QA PDF/PNG conversion is local evidence only.

| Actual generated fixture | Pages | Artifact SHA256 |
| --- | --- | --- |
| Channel, disposable approved test version | 4 | `62d7e3da1c61c211303be5f63715ae085369e8fdb0878abdcbc59d997f8bf041` |
| Student, disposable approved test version | 7 | `152c27bd41d0ceae984af56e876c1e7f77d3865469a5ff83cc860c6cff337694` |

All 11 pages were inspected: Chinese/English, long names, tables, multi-line itinerary, signature blocks,
page breaks, CNY 20,000 uppercase, USD without RMB formatting and no unresolved tokens. Channel was
rerendered and reinspected after correcting the settlement-bank party source. Masters were not modified.
Final PostgreSQL fixture bytes match the inspected Word evidence exactly.

## Browser boundary / fixes

Final evidence: `work/browser-qa-chromium-1243/v324-phase2-final/phases/contract-documents/report.json`.
Chromium revision **1243**, executable
`<workspace>`, browser 153.0.8010.12.
Two source types × zh-CN/en × 1440/375 = 8 scenarios; no body overflow. Actual React components and
production CSS, **mocked business APIs**. Real RLS, source revisions, job lease, rendering, storage,
rollback, privacy and calculations are verified separately by PostgreSQL/worker integration.

The initial QA invocation used QA_SCOPE instead of QA_PHASE, ran the public phase, then exited on the
unstarted legacy test database. It is not claimed as a full matrix pass. A dedicated bounded
`QA_PHASE=contract-documents` entry was added; only the affected phase is used for this verdict.
The fixture label locator was corrected. Screenshot inspection then corrected Channel bank wording,
oversized checkbox styling and history download wrapping; the affected build and browser checks were rerun.

## Evidence / governance / non-scope

Architecture: [CONTRACT_TEMPLATE_ARCHITECTURE.md](CONTRACT_TEMPLATE_ARCHITECTURE.md).
Evidence: `work/v324-phase2/verification.json`, `candidate-manifest.json`, source/migration fingerprints,
complete and Phase 2 patches, PostgreSQL verification and `render-qa/final-visual.json`.

Real Phase 1 v1 templates remain DRAFT with the original company, commission eligibility/settlement and
party-capacity business/legal reviews unresolved. Synthetic approved versions exist only inside disposable
test databases; no real approval was fabricated. Production must fail closed until approved content,
static company configuration and protected runtime key are supplied through governance.

Not implemented: upload/PDF extraction, OCR, AI/LLM, automatic field recognition, e-signature, automatic
SIGNED/Agreement ACTIVE, Payment/Refund/Commission Rule creation, Revenue Recognition/Attribution,
Data Import Upgrade, Targets, Forecast and Management AI. Commit/push/deploy remain NOT RUN.
