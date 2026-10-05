# v3.24 — Operational Readiness & Release Closure

Verdict at the release gate: **V324_RELEASE_READY — COMMIT READY**.
The user separately authorized version promotion and a checkpoint commit after completion. The exact
post-commit HEAD and clean-worktree result are recorded in `work/v324-release/verification.json` and the
completion report. Push, deploy and Production access remain outside this task.

## Baseline / release content

| Item | Recorded value |
| --- | --- |
| Branch | `main` |
| Starting HEAD | `b0b1992cb65a2e29dae1d7656bf03ff94cd477d8` |
| Final HEAD | Closure checkpoint `HEAD`; exact SHA in Git-ignored final verification |
| Starting / final version | `3.23.0` → `3.24.0` |
| Runtime | Node `26.10.0`, npm `12.2.0` |
| Opening candidate | 69 combined Roadmap / Phase 1–3 files, staging EMPTY |
| Final candidate | Exact count and file SHA/bytes in `work/v324-release/candidate-manifest.json` |
| Baseline evidence | Opening status/stat/whitespace, raw snapshots, complete Phase 1–3 patch, source fingerprints, 115 migration hashes, phase/render verification references |
| Git boundary | Commit authorized after gates; no push, no deploy, no Production access |

No saved patch was applied. Release Closure adds bounded integration verification and release metadata/docs,
with no new product capability or migration. Phase 4 and closure-only deltas are independently reversible.
The closure-only patch contains release metadata/documentation; the Phase 4 delta also includes the test-only
integrated golden scenario and its hook in the existing bounded PostgreSQL harness.

Contract Operations = Template Governance + Deterministic Generation + Uploaded Evidence Extraction +
Human Review. It does not replace Contract lifecycle. The release includes:

- Template foundation: two typed families, explicit parties and per-field canonical/confirmed/derived/
  unsupported semantics, version/checksum and real Word layout evidence.
- Governance: APPROVED + active + compatible + clean required blockers only; immutable content/config;
  maker-checker and existing management/approval/AAL2 authorization. Real v1 templates remain DRAFT.
- Deterministic generation: explicit source/context, no canonical overrides or shared allocation,
  immutable consumed-field/source/template/config evidence and decimal/currency-aware DOCX formatting.
- Worker/storage/download: existing queue, current lease, payload-bound receipt, private artifact,
  SHA/length integrity, current source authorization, failure/retry and completion reconciliation.
- Uploaded evidence: separate external identity, immutable original, explicit parent, duplicate detection,
  bounded DOCX/text-PDF parsing, immutable versioned extraction runs and raw/normalized/location evidence.
- Candidate comparison / human review: canonical read-only conflicts, explicit document-only decisions,
  immutable raw values, reviewer/source revision checks and zero canonical CRM Apply.
- Privacy/retention: sensitive masking/AAL2 reveal, minimal audit/export, immediate download revocation,
  evidence clearing, physical original erasure and late-write sweep; existing financial/legal ledgers retained.

See [architecture](CONTRACT_TEMPLATE_ARCHITECTURE.md), [template review](CONTRACT_TEMPLATE_REVIEW.md),
[Phase 1](V324_PHASE1_VERIFICATION.md), [Phase 2](V324_PHASE2_VERIFICATION.md),
[Phase 3](V324_PHASE3_VERIFICATION.md) and [release notes](RELEASE_V3.24.0.md).

## Frozen migrations

| Migration | SHA256 |
| --- | --- |
| 106 | `3b58df3169aeb191a601611bf7eb92dc8af863efda409a6265087d5ba13539ac` |
| 107 | `21d18fcfd20c10d8d1d49e03d427dd70866502a77fd2392757eb0cf4ef12cd83` |
| 108 | `7385bc29a1d5f8a20249c714ecd802b098bd081a5ff44087fcc88f76de842fc2` |
| 109 | `177aed462485a4f58d3b6e0ede87c1a338cb2051637d367f8cfd7a4397748288` |
| 110 | `4e08159af98970cee8d403100a50568d47ecc14b54b614c80e3e20ca469cd010` |

All 115 opening migration files retain raw bytes. No 111 exists. Migration 109 adds template/configuration/
generated lineage; 110 adds separate uploaded originals/runs/reviews. Neither creates signature, Revenue,
Payment, Commission or canonical Apply facts. Verifier and SHA evidence are retained under release work.

## Integrated PostgreSQL / real files

The existing generation harness runs both Customer and Channel golden paths in a disposable database,
then downloads and re-uploads the exact produced DOCX, extracts and reviews a document-only signing field.
Generated and uploaded IDs differ despite matching bytes. Raw candidates survive review; named canonical
tables (Contract, Enrollment, Payment, Refund, Agreement/Version/Rule, Accrual/Settlement and Automation
event/run) are compared before/after and unchanged. Unlabeled generation prose can yield a missing field:
the golden review explicitly records a document-only edit, not inferred extraction or a CRM update.
Provenance SHA comparison is verified; an automatic provenance-match UI is not implemented or claimed.

Additional actual assertions cover absent approved config, template/config immutable writes, no implicit
context, DRAFT/RETIRED rejection, fixed versus percentage rule, source revision, accepted receipts after
source change, concurrent requests, audit rollback, lease-only worker access, real renderer/storage failure
and retry, source-authorized download, privacy export and physical cleanup.

The extraction harness uses actual DOCX ZIP/XML packages, text PDF and no-text PDF through the existing
CLI worker and local storage. It checks source/SHA deduplication, payload reuse, cross-context/workspace/
hidden source/money/AAL2 denial, raw/run immutability, edited ambiguous date, source/reviewer conflicts,
hash tamper and retry, minimal audit/export and Student/Contact erasure including a simulated late write.
Protected PDF and other malformed/unsafe formats are tested with actual file bytes in parser unit tests.

Direct dependency regression additionally covers real Finance receipts/refunds/installments, Enrollment
links, Automation TASK/NOTIFICATION/disabled/retry/deduplication, Channel Agreements, refunds after paid
Commission settlements, multi-currency exposure, immutable ledger and retention.
All local database suites use **postgres:18.4-bookworm** with disposable credentials, no image pull and
no existing database/bucket credentials. Deployment declares 18.6-trixie; exact 18.6 image integration is
NOT RUN and is not claimed passing. No repository policy makes this local-image difference a required blocker.

## Reader / visual evidence

Microsoft Word LTSC 2024, executable version **16.0.17932.21000**, COM version 16.0/build 16.0.17932,
normally reopens both final representative DOCX read-only with alerts enabled and no OpenAndRepair.
No prompt is accepted. Channel = **4 pages**, Student = **7 pages**. Final bytes exactly match the
previously visually verified generated artifacts:

| Representative | DOCX SHA256 |
| --- | --- |
| Channel | `62d7e3da1c61c211303be5f63715ae085369e8fdb0878abdcbc59d997f8bf041` |
| Student | `152c27bd41d0ceae984af56e876c1e7f77d3865469a5ff83cc860c6cff337694` |

The 11 Word-rendered pages and PDF SHA are verified against those same final DOCX bytes, copied into
`work/v324-release/render/validated-pages/` and visually reinspected. Chinese/English, amounts, tables,
wrapping, page breaks, signature areas, DRAFT/TEST labels and no placeholder residue remain correct.
Original references, DRAFT masters/catalog and existing Phase 1 render evidence retain their fingerprints.

Computer-use native pipe was unavailable after prescribed recovery. The existing local Word file helper
provided normal reader opening. Optional fresh PDF re-export timed out at ExportAsFixedFormat, and is
recorded as FAIL, not used as passing evidence. Reader-only closure initially exposed a Windows PowerShell
module/COM cleanup fixture issue; corrected local QA helper completed both files. No product/master fix,
repair acceptance or legal approval occurred. Reader reopen is current; page-render evidence is explicitly
reused by exact-byte provenance, not represented as a new PDF export.

## Deployment compatibility

`deploy:production:dry-run`, 74 existing deploy/runtime/preflight tests and runtime closure pass. Migration
discovery copies the full db chain; application image copies the two masters/catalog, generation/extraction
helpers and isolated parser thread. Production dependency declaration/lock contains pdfjs-dist 6.4.299.
The existing production Node worker handles both job kinds; no Office/Python/OCR/AI server runtime is added.
Web/worker environment examples expose the optional independent matching document encryption key and
preflight validates it when enabled. Missing key/configuration blocks generation; the key is not legal content.
Existing Phase 2–3 Docker/environment/preflight changes suffice; no further deployment source change is required.

No deployment, image publication, production key creation or secret write occurred. Cloud S3 and Linux
application-image end-to-end smoke are NOT RUN; local storage and packaging/runtime checks are the stated boundary.

## Verification gates

Each named gate below has its bounded evidence in `work/v324-release/verification.json`.

| Gate | Result |
| --- | --- |
| Opening baseline | PASS |
| Migration verification | PASS |
| Historical migration bytes | PASS |
| 109 frozen | PASS |
| 110 frozen | PASS |
| No 111 | PASS |
| Runtime | PASS |
| Template contract | PASS |
| Template governance | PASS |
| Template checksum | PASS |
| APPROVED-only | PASS |
| Customer generation | PASS |
| Channel generation | PASS |
| Source revision | PASS |
| Explicit context selection | PASS |
| Generation evidence | PASS |
| Idempotency | PASS |
| Worker lease | PASS |
| Storage | PASS |
| Download authorization | PASS |
| Generated != Signed | PASS |
| DOCX upload | PASS |
| Text PDF upload | PASS |
| Immutable original | PASS |
| Extraction run | PASS |
| Candidate evidence | PASS |
| Human review | PASS |
| Review concurrency | PASS |
| Canonical conflict | PASS |
| Zero canonical CRM Apply | PASS |
| Scanned PDF rejected | PASS |
| Password PDF rejected | PASS |
| No OCR | PASS |
| No AI/LLM | PASS |
| Privacy | PASS |
| Physical cleanup | PASS |
| Finance retention | PASS |
| Commission retention | PASS |
| Audit minimization | PASS |
| Contract regression | PASS |
| Enrollment regression | PASS |
| Channel / Commission regression | PASS |
| Finance regression | PASS |
| Automation boundary | PASS |
| Integrated customer golden path | PASS |
| Integrated channel golden path | PASS |
| Word reader QA | PASS |
| PDF extraction fixture | PASS |
| Deployment compatibility | PASS |
| Typecheck | PASS |
| Scoped lint | PASS |
| Production build | PASS |
| Affected Chromium | PASS |
| QA server stopped | PASS |
| Architecture | PASS |
| Release Notes | PASS |
| Implementation Status | PASS |
| Version 3.24.0 | PASS |
| Complete reverse-check | PASS |
| Phase 4 reverse-check | PASS |
| Closure-only reverse-check | PASS |
| Whitespace | PASS |
| Fresh PDF re-export (optional; existing exact-byte render evidence retained) | FAIL |
| Cloud S3 integration | NOT RUN |
| Authenticated browser-to-real-DB E2E | NOT RUN |
| Exact PostgreSQL 18.6 image | NOT RUN |
| Linux application-image smoke / actual deploy | NOT RUN |

Counts: 85 integrated Node tests; 24 template tests and two-template lint; 74 deployment/runtime tests;
50 scoped JS/TS/test/QA lint files; four bounded PostgreSQL harnesses; two integrated source-family golden
paths; 16 browser scenarios. The final 3.24.0 production build ran once. Later test-only negative assertions
do not enter the production image/build; no build-affecting source changed after the build.

Browser boundary: **actual shared React components, production CSS, mocked business APIs**. It is not
authenticated browser-to-real-database E2E. Real RLS, worker, storage, parser, receipts, concurrency,
privacy and no canonical mutation are verified separately in PostgreSQL/integration.
Pinned Chromium **1243**, executable `<workspace>`,
version 153.0.8010.12, covers Customer/Channel generation and uploaded review in zh-CN/en at 1440/375.
Permission, DRAFT rejection, confirmation, missing/conflict/ambiguous, sensitive mask, history, download,
unknown-result retry and revision conflict scenarios pass. Final QA server is STOPPED.

## Git / deferred

The gated candidate has empty staging and independently checked complete / Phase 4 / closure-only patches.
The user subsequently requested the checkpoint commit `feat: add contract document generation and extraction`.
The finalized Git evidence records its exact SHA and clean worktree. Push NOT RUN, deploy NOT RUN,
Production access NONE. Git-ignored work evidence is retained locally and is not included in the commit.

Deferred: OCR, image/AI/LLM extraction, semantic entity resolution, e-signature and verified signature
lifecycle, canonical CRM Apply from extraction, signed legal archive, production legal PDF generation,
Revenue Recognition/Attribution, Channel Revenue/ROI, Data Import Operations Upgrade, Targets, Forecast
and Management AI. Contract/Agreement/Finance/Enrollment/Commission business semantics remain authoritative.
