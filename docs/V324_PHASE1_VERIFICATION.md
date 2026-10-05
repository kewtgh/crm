# v3.24 Phase 1 — Contract Type & Template Contract verification

Current verdict: **V324_PHASE1_CONTRACT_TEMPLATE_FOUNDATION_COMPLETE** (Phase 1A reader / visual closure).
Both templates remain **DRAFT / NOT APPROVED**. Technical Phase 2 infrastructure entry is cleared;
formal generation remains APPROVED-only. This closure does not implement Phase 2.

## Initial Phase 1 run — historical V324_PHASE1_PARTIAL

The initial report below is retained unchanged as historical evidence. Its reader/render blocker
and negative layout acceptance answer are superseded only by the Phase 1A closure section below.

Verdict: **V324_PHASE1_PARTIAL**

The two new DRAFT masters, type/party/field/version contracts, lint and synthetic previews
exist. **Actual Word/compatible-reader opening and visual layout QA have not completed.**
That required gate cannot be waived by ZIP/XML tests; Phase 2 is not cleared to start.
Business/legal review is also deliberately pending, and neither template is APPROVED.

## Baseline

| Item | Actual state |
|---|---|
| Branch | main |
| Starting / Final HEAD | b0b1992cb65a2e29dae1d7656bf03ff94cd477d8 |
| v3.23 checkpoint | Formal committed checkpoint, unchanged |
| Version | 3.23.0 |
| Node / npm | 26.10.0 / 12.2.0 via saved runtime script |
| Python | Local Python 3.14 standard library, offline authoring/QA only; no new deployed runtime/dependency |
| Opening worktree | Only untracked docs/V324_ROADMAP_DECISION.md |
| Roadmap baseline | work/v324-phase1-baseline/: raw Roadmap, complete new-file patch, opening status, SHA manifest including 113 migrations |
| Isolation | Roadmap bytes unchanged; Phase 1 files separate, no patch reapplied |
| Staging / Commit / Push / Deploy / Production | EMPTY / NOT RUN / NOT RUN / NOT RUN / NONE |

## Implementation / exact reuse

See [architecture](CONTRACT_TEMPLATE_ARCHITECTURE.md) for schema/jobs/storage/approval gaps,
the per-field table and lineage contract; [review](CONTRACT_TEMPLATE_REVIEW.md) records both
original/new checksums, mechanical corrections and unresolved legal/commission semantics.

Template identity/version is repository configuration, with DRAFT/APPROVED/RETIRED contract,
nullable active version and original/master SHA256. Existing Customer Contract history/documents
are not repurposed into templates; existing Contract/Agreement/Commission/job/storage/approval
facts and code are untouched. Future production generation must integrate source-aware lineage
and DOCX format support instead of claiming today's tabular export is a legal template renderer.
**No new migration; latest remains 108.**

| Deliverable | State |
|---|---|
| CHANNEL_RECRUITMENT_AGREEMENT / channel-recruitment v1 | DRAFT; 35 mapped fields; no approval/usage |
| STUDENT_PROGRAM_SERVICE_AGREEMENT / student-program v1 | DRAFT; 34 mapped fields; no approval/usage |
| Party contracts | Company/channel legal parties separate; Buyer/Household/Guardian/Participant separate |
| Canonical vs confirmation | Source/path per field; no canonical override; unsupported values remain blocked |
| Preview / lint | Offline synthetic fixtures; work-only output; real DOCX ZIP/XML replacement, including cross-run and tables/headers/footers |
| Governance policy | Existing Contract/catalog/approval capabilities; active membership/AAL2; no upload/edit/approval API implemented |
| Audit / privacy | Narrative minimization and future inherited access designed; masters sanitized; no new Audit or privacy mutation |

## Verification results

| Gate | Status | Evidence / limitation |
|---|---|---|
| Baseline isolation / reference SHA | PASS | Both originals re-read and match Roadmap; Roadmap raw SHA unchanged |
| npm run db:migrations:verify | PASS | 113 migrations; raw SHA matches opening manifest, including frozen 106–108; no 109 |
| Runtime / release metadata | PASS | Node 26.10.0, npm 12.2.0; npm run release:check → 3.23.0 |
| Template type / fields / canonical sources | PASS | Catalog lint; 35 / 34 fields; complete schema/mapping; distinct party roles |
| Template unit suite | PASS | 24 Python tests: money/dates, missing fields, required Guardian/signatory, no override, unknown/unused placeholders, checksum, cross-run, real DOCX parts, immutability, approved-only eligibility |
| Template governance policy | PASS | 2 Node tests using real existing capability definitions; invalid/inactive/external/AAL1 mutation requests denied |
| Storage / generated-job boundary | PASS | 2 Node tests: object-key/token protection, tabular formats and Customer-document parent preserved |
| Contract / Enrollment links | PASS | 6 existing commercial-links tests, including revision/retry/privacy scope |
| Agreement / Commission | PASS | 9 existing commission tests, including eligibility/schema/decimal/redaction/privacy, no customer payment mutation |
| Finance / operational dependencies | PASS | 18 existing operational-readiness tests, shared Contract/multi-currency/net receipt and existing Automation/Enrollment import boundaries |
| Approval regression | PASS | 2 focused existing v383 approval tests; existing authority unchanged |
| Preview before/after mutation of fixture objects | PASS | Immutable fixture/context comparison; no DB/network access in preview tooling; not a real PostgreSQL pure-read assertion |
| Master reference/PII removal | PASS | All package XML scanned for old company, actual bank number, Cambridge, fixed signing date and literal email; no media; placeholders replace personal slots; core author metadata sanitized |
| DOCX structural integrity | PASS | ZIP readable, all XML/.rels parse; master checksums, mapping coverage and preview placeholder replacement verified |
| Actual reader opening / no repair prompt | **NOT RUN TO COMPLETION** | Word COM opening did not complete; no successful reader-open evidence |
| Rendered pages / layout / Chinese / tables / signatures | **NOT RUN TO COMPLETION** | Required gate remains unmet; no page PNGs available to inspect |
| Company/legal/party/commission business review | NOT RUN | Explicit DRAFT review blockers; no false approval, no new Commission Rule |
| PostgreSQL template persistence/RLS | NOT RUN | No DB template schema or runtime mutation added; policy tests are not real DB authorization tests |
| npm run typecheck | PASS | Exact formal watchdog command passed outside sandbox after initial spawn EPERM |
| Scoped JS lint | PASS | eslint over new governance helper and both new Node test files |
| Python syntax / JSON lint | PASS | AST parsing plus actual template/schema/unit tests |
| Documentation links / whitespace | PASS | Relative links resolve; new text whitespace checked; git diff --check |
| Production build | NOT RUN | No application UI/API/bundled source, dependency or version change; new scripts are offline QA/policy tooling only |
| Chromium | NOT RUN | No template administration UI added, no affected browser flow |

Total completed unit checks: **24 template tests + 39 Node checks**, across the bounded suites
above. The initial tsx/esbuild attempt at the two new Node suites encountered local spawn EPERM;
they passed using declared Node 26 native TypeScript stripping and test-isolation=none.
The unaffected existing regression suites passed with their existing tsx mode. No failed source
assertion is hidden or waived.

## Render blocker — environment

The requested documents skill's render_docx.py fails before conversion with missing `pdf2image`.
LibreOffice/soffice is not installed. Installed Word was attempted read-only with hidden COM
automation, both within and outside the sandbox; initialization/open did not return and produced
no PDF/pages. The task-owned unopened Word Automation process was stopped; original files were
not saved or overwritten. Computer Use initialization returned native pipe unavailable
(os error 2), so it could not inspect a Word window or a repair prompt.

This is a **render/reader environment blocker**, not proof that the new DOCX layout is correct
or broken. No unrequested Office/server dependency was installed and no production renderer
was introduced. Required next verification is to open/render both masters and synthetic previews
in a working Word/compatible-reader environment, inspect every page, then fix any observed
layout defects and rerun the affected structural/checksum tests. No migration is needed to fix
this environment blocker. PDF production output remains deferred independently.

## Final acceptance answers

| Question | Answer |
|---|---|
| Two types use same party mapping? | NO |
| Participant is always Buyer? | NO |
| Primary Contact is automatically Legal Signatory? | NO |
| 15,980 overrides Contract amount? | NO; synthetic Contract 20,000 renders 20,000 |
| USD 3,000 creates Commission Rule? | NO |
| Versions have exact byte checksum? | YES |
| Approved/used version editable in place? | NO; next DRAFT required |
| New editable Student/Product/Cohort identity? | NO |
| Preview mutates Contract/Agreement? | NO; fixture-only tool has no business adapter |
| Missing required fields silently blank? | NO |
| HKU/Cambridge conflict corrected or blocked? | YES; institution parameterized, Cambridge removed; actual certificate entitlement still explicitly blocked for review |
| Fixed 2025-12-17 remains? | NO |
| Upload extraction / OCR / AI implemented? | NO / NO / NO |
| Actual rendered layout verified? | **NO — prevents COMPLETE verdict** |

## Explicit non-scope

No deterministic production generation, customer signing/e-signature provider, uploaded Contract
extraction, PDF text extraction, OCR, AI/LLM extraction, automatic business fact update, Payment,
Refund, Commission Rule creation, Revenue Recognition/Attribution, Targets, Forecast or Management AI.
No commit/push/deploy/Production access. The later categorized data-import plan remains untouched.

## Phase 1A closure run — actual Word / visual rendering

Baseline: main; starting/final HEAD `b0b1992cb65a2e29dae1d7656bf03ff94cd477d8`;
version 3.23.0; Node 26.10.0/npm 12.2.0. Opening and final worktree have 14 untracked candidate
files (13 Phase 1 files plus the unchanged Roadmap); staging empty, no tracked source modification.
Phase 1A changes only two DRAFT DOCX masters, their catalog checksums and three documentation files.
No migration/schema/version/application source or governance implementation changes.

### Reader evidence / boundary

Installed Microsoft Word LTSC 2024: `C:/Program Files/Microsoft Office/root/Office16/WINWORD.EXE`,
executable 16.0.17932.21000; COM version 16.0, build 16.0.17932. Normal read-only Open,
all alerts enabled, repaginate and ExportAsFixedFormat returned successfully for all 9 DOCX files.
No OpenAndRepair or prompt acceptance was used. No blocking corruption, repair, unreadable-content
or missing-content prompt was encountered. No desktop UI screenshot is claimed: Computer Use's
native pipe was unavailable. Word automation exited after closing without saving the originals.
The packaged renderer remains unavailable (pdf2image missing/LibreOffice absent); this was bypassed
by using installed Word, not by installing a production runtime or weakening the gate.

Final pages were exported at 2026-10-05 11:32:29–11:32:39 UTC, then rasterized using installed
Windows.Data.Pdf into 1600px PNGs. All 55 pages reconcile to 42 visually inspected exact-byte PNG
identities; 13 duplicate pages reuse inspection only after exact SHA256 equality. Five header sheets
cover all 22 unique header crops. Every document retains DRAFT/PREVIEW identity.

| Document | DOCX SHA256 | Pages | Reader / visual verdict |
|---|---|---|---|
| channel-master | `5c2dc2fc84faa9d71eedc620b41aa2b81a4eda58e55cfc376f9cd4dbb93143db` | 4 | PASS / PASS |
| student-master | `21905febf608d07ae2564d134ae024067dca8582881a638bc077d189322313fa` | 7 | PASS / PASS |
| channel-base | `b319cc261d7226a101fe80c8463c309a287970b76bf5d185fa112d527de0b34e` | 4 | PASS / PASS |
| student-base | `eef8159a505e70cf7404e41b1afbc650c4ff74e075aef2ec949aa11b2c7b3e3d` | 7 | PASS / PASS |
| channel-long | `3168f72b033dde303906323a9f7665dc5939df21dc62a7879afe71cf421a0820` | 4 | PASS / PASS |
| student-long | `a556a9c9591719dd36b7219df073f2ad5afabc47759a5e9eb30b881c6cec1bd2` | 8 | PASS / PASS |
| student-no-guardian | `498f94e7f1df9552b278536faffbbe09994b32a0b0eea2990ff31ab7aeb8183c` | 7 | PASS / PASS |
| student-missing-guardian | `6a36c5adb08cd5a8def97d1ebb6885f140f556c60e3ec6912b6dcb997d00879d` | 7 | PASS / PASS |
| student-usd | `3b28222e922b13fee1a5d5692c3f61788d466606dc17e22b6abafcd8dee7c8d7` | 7 | PASS / PASS |

Master fields are intentionally visible known tokens; all keys are mapped. The no-unresolved-token
gate applies to rendered previews; all seven have zero remaining tokens. Missing-required preview
markers and unresolved review blockers are intentionally visible, not mistakes hidden by rendering.

### Observed defects / verified fixes

Recurring Channel DRAFT header, compact Student long-company header, separate non-splitting
signature forms, section-heading keep-with-next and Student annex page-break placement fix
observed defects. The initial header-only blank Student page is gone. Initial/intermediate
renders are archived; after every master layout revision previews were regenerated, actually
opened/exported in Word, rasterized and inspected. See [template review](CONTRACT_TEMPLATE_REVIEW.md)
for the precise changes. No party/mapping/Commission/amount/legal semantics changed.

### Closure gates

| Gate | Status | Evidence / boundary |
|---|---|---|
| Reader opens both masters and all previews | PASS | Normal Word Open; 9 successful read-only exports |
| No repair / unreadable-content prompt | PASS | All alerts enabled; no blocking prompt encountered/accepted; no OpenAndRepair |
| Rendered page evidence | PASS | 9 PDFs / 55 PNG pages; per-source SHA, PDF SHA, pages and UTC timestamp |
| Channel visual QA | PASS | Both master/standard/long previews, party/date/Commission/bank/signatures |
| Student visual QA | PASS | Master/standard/long/no-Guardian/missing-Guardian/USD previews |
| Long names / multiline terms / itinerary | PASS | Render-only synthetic QA fixtures; no business fixture changes |
| Tables / sensible page breaks / signature layout | PASS | No clipping, overlapping text, broken table, orphaned signature or unreasonable blank page |
| Chinese / English / header-footer | PASS | All inspected pages and header crops; no observed missing glyph |
| CNY uppercase / USD separation | PASS | 20,000.00 → 人民币贰万元整; USD has no RMB/¥ text |
| Required / not-required Guardian | PASS | Confirmed name/capacity or explicit bilingual Not applicable |
| Missing-field visibility | PASS | Missing Guardian name remains red bilingual Missing in party/signature sections |
| Unsupported blocker visibility | PASS | Channel eligibility/settlement and Student party-capacity review visibly remain blocked |
| No unresolved preview placeholder / unknown master key | PASS | ZIP/XML scan and actual rendered previews; intentional mapped master tokens retained |
| Reference SHA / reference-value scans | PASS | Both originals unchanged; fixed date, Cambridge and known reference PII scans |
| Final master checksum / mapping unchanged | PASS | Catalog SHA matches exact bytes; rest of catalog identical to opening |
| Template lint / complete template suite | PASS | 35/34 mapped fields; 24 tests rerun after final master fixes |
| Node governance/storage/job tests | PASS | 4 targeted tests rerun under Node 26; existing capabilities and formats unchanged |
| Structural DOCX | PASS | All 9 ZIPs readable, all XML/.rels parse, preview replacements complete |
| npm run db:migrations:verify / raw historical bytes | PASS | 113 migrations equal baseline; latest 108, no 109, frozen 106–108 unchanged |
| Runtime / npm run release:check | PASS | Node 26.10.0/npm 12.2.0; all metadata remains 3.23.0 |
| Documentation links / whitespace | PASS | Local relative links; manual candidate text check plus git diff --check |
| Complete Phase 1 candidate / Phase 1A delta reverse-check | PASS | Ignored binary-capable patches; reverse-check only, never applied |
| Business/legal approval | NOT RUN | Both DRAFT, no approval implied; existing unresolved review items remain |
| Broader domain/PostgreSQL regressions | NOT RUN | Prior Phase 1 results above retained; this run changes only layout/checksums/docs |
| Typecheck / scoped lint / production build / Chromium | NOT RUN | No bundled code, JS/TS, UI or dependency changes; prior Phase 1 checks remain historical evidence |

### Evidence / final boundaries

`work/v324-phase1/render-qa/word-render-manifest.json` records exact DOCX/PDF hashes and all page counts.
`word-batch.log`, `pages/<document>/document.pdf`, `pages/<document>/page-N.png`, `visual-qa.json`,
`visual-page-groups.json`, `header-page-map.json`, `headers-1.png` through `headers-5.png`,
`final-integrity.json`, `verification.json`, `phase1-complete-after-closure.patch` and
`phase1a-delta.patch` retain the closure evidence; all are Git ignored.

Git: staging EMPTY; commit/push/deploy NOT RUN; Production access NONE. Word QA process STOPPED;
no application QA server started. Original reference files read-only and unchanged.
No production generation, upload extraction, OCR, AI, e-signature, Revenue, Targets or Forecast.

Final verdict: **V324_PHASE1_CONTRACT_TEMPLATE_FOUNDATION_COMPLETE**.
Both templates remain **DRAFT**. Visual closure is technical readiness, not legal/business approval.
Phase 2 deterministic infrastructure can proceed as a separate task; DRAFT may be preview/test only,
and production-ready generation must require an APPROVED version with explicit review clearance.
