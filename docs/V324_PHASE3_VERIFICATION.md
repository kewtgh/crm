# v3.24 Phase 3 — Uploaded Contract Evidence Extraction & Human Confirmation

Verdict: **V324_PHASE3_UPLOAD_EXTRACTION_COMPLETE**

Completion covers deterministic extraction, document-only human review and canonical conflict reporting.
It grants **zero canonical CRM updates**. An uploaded file or a confirmed document value never creates a
signature, approval, Contract Version, Payment, Refund, Commission Rule or accrual.

## Baseline / independent candidate

| Item | Result |
| --- | --- |
| Branch | `main` |
| Starting / final HEAD | `b0b1992cb65a2e29dae1d7656bf03ff94cd477d8` |
| Starting / final version | `3.23.0` |
| Runtime | Node `26.10.0`, npm `12.2.0` |
| Opening worktree | 47 combined Roadmap / Phase 1–2 candidate files, no staged changes |
| Baseline | `work/v324-phase3-baseline/`: complete patch, raw snapshots, manifest, source fingerprints, 114 migration hashes, verification references, architecture/catalog snapshots and opening status |
| Final worktree | 69 combined candidate files; 33 files differ from the Phase 3 opening baseline |
| Checkpoint | Existing v3.23 Git checkpoint plus independently reversible Phase 1–2 and Phase 3 evidence; no saved patch reapplied |
| Git actions | Staging EMPTY; commit NOT RUN; push NOT RUN; deploy NOT RUN; Production access NONE |

Final reconciliation and machine-readable gates are under Git-ignored `work/v324-phase3/`.
The complete candidate and independent `phase3-delta.patch` both pass reverse-check without applying a patch.

## Schema / infrastructure reuse

The existing customer-only `contract_documents` and Phase 2 generated-document lineage cannot represent
immutable external originals, separate extraction runs and append-only human decisions. Migration **110**
adds `uploaded_contract_documents`, payload-bound upload receipts, `contract_extraction_runs` and
`contract_extraction_reviews`. Original identity/hash/storage key and completed raw extraction cannot be
overwritten. Review decisions are separate immutable records; an edited value never replaces raw evidence.

The existing `generated_jobs` queue gains a workspace-constrained uploaded-document origin and
`CONTRACT_DOCUMENT_EXTRACTION`. Existing worker leasing, retry/backoff, private local/S3 storage, source
authorization, AAL2, audit and privacy infrastructure are reused. There is no second queue, arbitrary
source-kind framework, fake customer Contract parent or new permission system.

STORING is an internal, non-downloadable reservation. Storage must finish before UPLOADED and extraction
enqueue complete atomically. Same-source/SHA duplicates return the same evidence identity; retries are
payload-bound and concurrent duplicate requests serialize. Different parents retain separate lineage.
Create-only local storage uses temporary bytes plus atomic linking; S3 uses conditional upload.
Errors never delete a concurrently completed original. Hash and byte length are verified before parse/download.

| Migration | SHA256 / status |
| --- | --- |
| 106 | `3b58df3169aeb191a601611bf7eb92dc8af863efda409a6265087d5ba13539ac` — unchanged |
| 107 | `21d18fcfd20c10d8d1d49e03d427dd70866502a77fd2392757eb0cf4ef12cd83` — unchanged |
| 108 | `7385bc29a1d5f8a20249c714ecd802b098bd081a5ff44087fcc88f76de842fc2` — unchanged |
| 109 | `177aed462485a4f58d3b6e0ede87c1a338cb2051637d367f8cfd7a4397748288` — unchanged |
| 110 | `4e08159af98970cee8d403100a50568d47ecc14b54b614c80e3e20ca469cd010` — new, verified |

All **114 opening historical migration files** retain their raw-byte hashes. No 111 exists.

## Format / extraction contract

| Format / capability | Support |
| --- | --- |
| Text DOCX | SUPPORTED: paragraphs, tables, headers, footers and split runs |
| Text-based PDF | SUPPORTED: actual page/block text evidence |
| No-text / scanned PDF | NOT SUPPORTED: `OCR_REQUIRED_NOT_SUPPORTED`; no fallback |
| Password-protected PDF | NOT SUPPORTED: `PDF_PASSWORD_UNSUPPORTED`; passwords not accepted |
| DOCM / image upload | NOT SUPPORTED |
| OCR / AI / semantic identity resolution | NOT SUPPORTED |

Files: 8,000,000 bytes; multipart: 8,200,000 bytes. PDF: 100 pages; extracted text: 300,000 characters;
chunks: 5,000. DOCX inherits 32 MB expanded ZIP / 1,000 entries, CRC/path safeguards and adds macro,
external relationship, XML entity and malformed-XML checks. Extension/MIME/magic must agree.
External relationships are never fetched. The parser has a 12-second deadline, bounded Node thread
memory and no credential environment or network fetch.

`pdfjs-dist` is pinned at **6.4.299**, Apache-2.0, production Node compatible. It parses text without
Office, Python, OCR, AI or an external service. Existing dependency versions were not upgraded.
Uploaded-PDF parsing does not imply production PDF contract generation.

Extractor **LABELS_V1** uses exact known labels, structured adjacent table cells and deterministic
normalization. It does not understand arbitrary legal prose: unlabeled or continued clauses may remain
missing/incomplete. Staff can inspect excerpts and explicitly edit document-only values.
DOCX locations are real part/paragraph/table/row/cell coordinates, with no invented page number.
PDF locations are real page/block coordinates. Missing candidates have no fabricated excerpt/location.

Raw and normalized candidates stay separate. Amounts use decimal strings and validated grouping;
RMB/人民币 normalizes to CNY. Year-first unambiguous dates normalize to ISO; `01/02/2026` stays AMBIGUOUS.
Names are never used to match identities. EXACT is an exact extraction rule match, not a probability or truth.
Multiple distinct matches are AMBIGUOUS. Runs record extractor version, job, timestamps and immutable results.
Explicit re-extraction creates a new run; failed-run retry keeps its existing logical run.

## Review / canonical mutation boundary

The complete per-field target table below is computed from the existing
[Phase 1 field catalog](../templates/contracts/catalog.json); types, sources and required rules remain in
[the architecture contract](CONTRACT_TEMPLATE_ARCHITECTURE.md). No field supports Apply to CRM.

| Field | Channel target | Student target |
| --- | --- | --- |
| `template.review_notice` | READ ONLY | READ ONLY |
| `company.legal_name` | READ ONLY | READ ONLY |
| `company.address` | READ ONLY | READ ONLY |
| `company.signatory` | READ ONLY | READ ONLY |
| `company.phone` | READ ONLY | READ ONLY |
| `company.email` | READ ONLY | READ ONLY |
| `program.name` | READ ONLY | READ ONLY |
| `program.institution_name` | DOCUMENT ONLY | DOCUMENT ONLY |
| `cohort.name` | READ ONLY | READ ONLY |
| `bank.beneficiary` | DOCUMENT ONLY | READ ONLY |
| `bank.institution` | DOCUMENT ONLY | READ ONLY |
| `bank.account` | DOCUMENT ONLY | READ ONLY |
| `company.registration_identifier` | READ ONLY | READ ONLY |
| `agreement.reference` | READ ONLY | — |
| `channel.organization_name` | READ ONLY | — |
| `channel.legal_name` | DOCUMENT ONLY | — |
| `channel.address` | DOCUMENT ONLY | — |
| `channel.representative` | DOCUMENT ONLY | — |
| `channel.signatory` | DOCUMENT ONLY | — |
| `channel.phone` | DOCUMENT ONLY | — |
| `channel.email` | DOCUMENT ONLY | — |
| `agreement.signing_date` | READ ONLY | — |
| `agreement.signing_place` | DOCUMENT ONLY | — |
| `agreement.effective_from` | READ ONLY | — |
| `agreement.effective_to` | READ ONLY | — |
| `company.background_clause` | READ ONLY | — |
| `program.description` | DOCUMENT ONLY | — |
| `agreement.review_clause` | DOCUMENT ONLY | — |
| `commission.amount` | READ ONLY | — |
| `commission.currency` | READ ONLY | — |
| `commission.eligibility_clause` | UNSUPPORTED | — |
| `commission.settlement_condition` | UNSUPPORTED | — |
| `commission.payment_terms` | DOCUMENT ONLY | — |
| `channel.coordinator` | DOCUMENT ONLY | — |
| `company.invoice_details` | READ ONLY | — |
| `contract.reference` | — | READ ONLY |
| `buyer.household_name` | — | READ ONLY |
| `buyer.signing_name` | — | DOCUMENT ONLY |
| `participant.name` | — | READ ONLY |
| `guardian.required` | — | DOCUMENT ONLY |
| `guardian.name` | — | DOCUMENT ONLY |
| `guardian.capacity` | — | DOCUMENT ONLY |
| `program.start_on` | — | READ ONLY |
| `program.end_on` | — | READ ONLY |
| `contract.amount` | — | READ ONLY |
| `contract.currency` | — | READ ONLY |
| `contract.amount_words` | — | READ ONLY |
| `contract.signing_date` | — | DOCUMENT ONLY |
| `service.accommodation` | — | DOCUMENT ONLY |
| `service.program_component` | — | DOCUMENT ONLY |
| `service.logistics_component` | — | DOCUMENT ONLY |
| `payment.terms` | — | DOCUMENT ONLY |
| `payment.method` | — | DOCUMENT ONLY |
| `buyer.notice_contact` | — | DOCUMENT ONLY |
| `program.itinerary` | — | DOCUMENT ONLY |
| `review.party_capacity` | — | UNSUPPORTED |

CANONICAL_READ_ONLY and UNSUPPORTED permit reject/defer only. DOCUMENT_ONLY permits confirmed exact valid
unambiguous values, explicitly typed edits, reject or defer. Edits can resolve an ambiguous date or fill a
missing document-only value. Unsupported commission conditions and party-capacity clauses remain legal/
business review blockers; extraction review cannot approve them.

Each decision records run/candidate identity, confirmed value separately, actor/time, source revision,
document revision, reason and payload-bound request. Stale reviewers or changed source revisions conflict.
Existing uploaded evidence remains after a parent revision changes; comparisons read today's canonical
values in the explicitly selected context. Without a selection no first Enrollment or Rule is guessed.
Unresolved static/derived values are not falsely presented as authoritative comparisons.
REVIEWED means candidates have decisions, never legal approval or signature.

There is no canonical mutation API. Any future Apply must independently call the owning domain's
authorized mutation with its audit, transaction, revision and receipt contract.

## API / UI

Existing Customer Contract and Channel Agreement Documents sections distinguish generated artifacts
from uploaded evidence. Upload requires an explicit current parent; optional Enrollment/rule context
must belong to it. UI supports original download, extraction state/retry/new run, raw/normalized/current
comparison, conflict/missing/ambiguous states, source locations/excerpts, explicitly labeled extracted text,
document-only decisions and immutable review history. No bulk financial overwrite or SIGNED action exists.
All new labels/errors cover zh-CN/en; desktop and mobile candidate cards retain readable controls.

Routes follow current conventions under `/api/contract-document-uploads`: source-scoped GET/POST,
detail GET, original download GET, extract POST and review POST. Existing API authentication, capability,
CSRF and no-store patterns apply. No `/api/v324` route is introduced.

## Security / privacy

Every upload/list/detail/extract/review/download reauthorizes current workspace, source parent and selected
context. Channel requires Organization visibility and existing commercial money permissions. Source,
job, run and review relationships are workspace-constrained. Raw tables have RLS and no direct app/worker
grants; worker RPCs require the current unexpired matching lease. Source IDs and object keys are not access.

Sensitive and ambiguous/invalid raw candidates are masked by default; excerpts are withheld and chunks
omitted. Sensitive canonical identity fields are omitted. Reveal/review requires existing manage access
and AAL2. Lists never return full extraction JSON. Downloads reauthorize and verify original bytes; signed
storage URLs cannot bypass source access. Audit contains IDs/hash/status/count/decision, never text,
Guardian/bank values, source excerpts or confirmed-value dumps.

Uploaded files are unsigned operational evidence, including claimed signed copies. Subject export uses
verified leased lineage only, not originals or another party's bank/Guardian data. Known parent Household,
Student/Guardian and Organization Contact associations are tracked conservatively for erasure; external
names are not matched and require privacy staff review.
Student/Contact physical cleanup immediately revokes download and clears text/candidates/reviews/receipts,
then the existing worker deletes originals. A delayed second sweep handles late in-flight storage writes.
Contracts, Finance, Agreements, Commission rules/ledgers retain their existing facts. Signed legal-archive
retention requires a separate policy and is not claimed here.

## Verification

| Gate | Result | Evidence / boundary |
| --- | --- | --- |
| Phase 1–2 baseline isolation | PASS | 47-file opening manifest, raw snapshots and complete patch |
| Declared runtime / unchanged version | PASS | Node 26.10.0, npm 12.2.0, metadata 3.23.0 |
| Extraction / worker unit tests | PASS | 17 tests; DOCX/PDF real bytes, table/header/footer/split runs, safety, decimal/date ambiguity, limits, protected PDF, failures and worker SHA/lease behavior |
| Local storage / multipart tests | PASS | 2 tests; concurrent same-byte create, changed-byte rejection, private namespace and actual multipart |
| Existing targeted dependencies | PASS | 58 tests across document engine/worker, template governance/dependencies, Enrollment, Commission, operational readiness and application runtime |
| Phase 1 template lint / tests | PASS | Two masters, 24 Python tests; offline QA only |
| Immutable originals / candidates / reviews | PASS | Actual DB constraints, hash verification, raw-value preservation and append-only decisions |
| PostgreSQL extraction golden scenarios | PASS | Both source kinds, real DOCX package and text PDF, actual existing worker CLI / local storage |
| Upload retry / duplicate / concurrency / rollback | PASS | Payload reuse rejection, concurrent duplicate, source revision conflict and audit-failure transaction rollback |
| Review retry / concurrency / source change | PASS | Exact confirmation, ambiguous date edit, raw preservation, stale reviewer/source and review receipt |
| RLS / source / workspace / money / AAL2 | PASS | Foreign/hidden parent, wrong Enrollment/context, channel money denial, direct worker read denied and invalid lease |
| No domain / SIGNED / Payment / Refund / Commission mutation | PASS | Golden scenarios assert canonical financial/status facts unchanged |
| Privacy export / Student and Contact physical cleanup | PASS | Lineage-only export; revocation, evidence clearing, original deletion and tested late-write sweep |
| Finance / Agreement / Commission retention | PASS | Canonical rows retained after actual subject cleanup |
| Phase 2 PostgreSQL generation regression | PASS | Generation/job/storage/approval/revision/idempotency/privacy paths after migration 110 |
| Commission PostgreSQL regression | PASS | Existing real ledger, payment/refund/reversal/settlement and retention scenarios |
| Historical migration bytes / verifier | PASS | All 114 opening hashes match; `npm run db:migrations:verify` |
| Original references / DRAFT masters | PASS | Original SHA256 and master checksums unchanged; no business approval |
| Typecheck | PASS | `npm run typecheck` |
| Scoped lint | PASS | 27 changed JS/TS/test/QA files, zero warnings |
| Production build | PASS | Three builds; repeats followed observed UI layout correction and XML entity safety correction |
| Affected Chromium upload/review | PASS | Two source kinds × zh-CN/en × 1440/375 = 8 scenarios on final build |
| Phase 2 Chromium generation regression | PASS | 8 generation scenarios on final build |
| Final screenshot review | PASS | Readable cards, conflicts, sensitive masks and actions; no horizontal body overflow |
| Complete / Phase 3 delta reverse-check | PASS | Git-ignored patches checked without applying |
| Whitespace | PASS | `git diff --check` plus complete/delta raw snapshot checks |
| QA server shutdown | PASS | Formal `qa:server:stop`; final status STOPPED |
| Cloud S3 integration / Production access | NOT RUN | Local provider integration; no Production credentials/bucket accessed |
| Authenticated browser-to-real-DB E2E | NOT RUN | Browser business APIs mocked; DB/worker/parser tested separately |
| PostgreSQL 18.6 exact-image regression | NOT RUN | Image not locally available; disposable local postgres:18.4-bookworm used without image pull |

PostgreSQL evidence: `work/v324-phase3/postgres/verification.json` and `postgres-final.txt`.
Generation regression: `work/v324-phase2/postgres/verification.json`; existing visual fixtures retain their hashes.
Browser evidence: `work/browser-qa-chromium-1243/v324-phase3-final-verified/` and
`work/browser-qa-chromium-1243/v324-phase3-generation-final/`.

Browser boundary: **actual shared React UI/components, production CSS, mocked business APIs**.
This is not authenticated browser-to-real-database E2E. Real RLS, storage, parser, worker, receipts,
review concurrency, rollback, privacy and canonical no-mutation behavior were verified separately with
disposable PostgreSQL and real files. Chromium is pinned **1243**, executable
`%LOCALAPPDATA%/ms-playwright/chromium-1243/chrome-win64/chrome.exe`, version **153.0.8010.12**.

Initial browser failures exposed a native-input selector ambiguity, mock Channel context mismatch and
incorrect dedicated-scope fall-through. These QA defects were corrected and scoped runs passed.
One final command used QA_SCOPE instead of the runner's QA_PHASE and entered generic QA; it stopped
after a refused local test-DB connection. Evidence is retained; correct dedicated final runs supersede it.
An initial Commission test lacked its default local image; the documented existing local image passed.
No failed run was counted as a passing gate or silently waived.

## Template governance / non-scope

Both real v1 templates remain **DRAFT**. Reader QA and technical extraction/generation completion are not
business/legal approval. Master SHA256 remains channel `5c2dc2fc84faa9d71eedc620b41aa2b81a4eda58e55cfc376f9cd4dbb93143db`
and student `21905febf608d07ae2564d134ae024067dca8582881a638bc077d189322313fa`.
Original references remain Channel `3fd472fbc5dbf73b4fb4f96255d9b9fc92698d20a4b7eb8b9652156f18cc957e`
and student `b7750ecd0f91075a45a408063e71f2c39c759f4e18afa87a13d3d5e9c20f4712`.

No OCR, image/AI/LLM extraction, semantic entity resolution, automatic parent creation, automatic
Payment/Refund/Commission, SIGNED/ACTIVE, e-signature, Revenue Recognition/Attribution, Data Import Upgrade,
Targets, Forecast or Management AI. No canonical Apply is implemented. No version promotion, commit,
push, deploy or Production access occurred. Data Import Operations remains a future roadmap item.
