# v3.24 — Contract Operations & Document Foundation

Contract Operations now joins template governance, deterministic document generation, immutable uploaded
evidence, deterministic text extraction and human review. Customer Contracts, Channel Agreements,
Enrollments, Finance and Commission retain their existing business authority and lifecycles.

## Template foundation / governance

Two typed families distinguish CHANNEL_RECRUITMENT_AGREEMENT from STUDENT_PROGRAM_SERVICE_AGREEMENT.
Company, Channel, buyer/Household, Guardian, participant and Enrollment have explicit party semantics;
Primary Contact is not a legal signatory and participant is not automatically the buyer.
Stable fields specify canonical sources, confirmation requirements, deterministic derivations and unsupported
semantics. DOCX masters are versioned, checksum-traceable and verified in real Microsoft Word.

The two real v1 templates remain **DRAFT**. Unresolved commission eligibility/settlement and student
party-capacity clauses still need independent business/legal review. Technical readiness does not approve
these legal templates. Production generation requires an active APPROVED compatible version with clean
required fields/blockers; approved content is immutable and changes require a new DRAFT version.

## Deterministic generation / source-aware lineage

Customer documents use an explicitly selected valid Contract–Enrollment context. Channel documents use an
exact Agreement Version and explicitly selected same-context Commission Rule and Product/Cohort.
The current Channel master accepts FIXED_PER_ENROLLMENT only. Shared Contract amounts are not allocated
or divided; Contract amount/currency cannot be overridden in the generation page.

Approved, versioned workspace company configuration is encrypted with a separate document configuration
key. The key is not a source of legal content. Missing key/configuration fails closed.
DOCX rendering uses the existing Node runtime, including split runs, tables, headers/footers and literal XML
escaping. Immutable consumed-field evidence records canonical/confirmed values, confirmer, source revision,
template/configuration references, template bytes and generated artifact SHA/length/MIME.

Generation reuses existing jobs/leases/retries and private local/S3 storage. Accepted payload-bound retries
reuse the same document/version/job; new stale requests conflict. Downloads reauthorize current workspace,
parent and selected context, check privacy state and verify stored bytes. Knowledge of an object key or
storage URL cannot bypass source permissions. Generation/download never signs or activates a source.

## Uploaded evidence / extraction

Uploads require an explicit Customer Contract or Channel Agreement Version parent. External originals have
a separate identity from generated documents and Contract Versions, immutable bytes/hash/storage key and
same-source/SHA duplicate detection. A generated DOCX re-upload retains a separate external-evidence identity.

DOCX paragraphs/tables/headers/footers and text-based PDF pages/blocks produce structured evidence chunks.
LABELS_V1 uses explicit labels, adjacent table cells and deterministic patterns with raw/normalized values,
excerpts and real source locations. DOCX page numbers are not invented. Parsing is size/page/text/memory/time
bounded, credential-free and does not fetch external content. Scanned/no-text PDF returns
OCR_REQUIRED_NOT_SUPPORTED; protected PDF returns PDF_PASSWORD_UNSUPPORTED.

Extraction has separate immutable runs. Review preserves raw candidates and appends confirmed/edited values,
decisions, actor/time and revisions. Canonical facts are comparison-only: a document amount of 15,980 against
a Contract amount of 20,000 reports a conflict and leaves the Contract unchanged. Human-confirmed values are
document evidence, not CRM facts. Missing/ambiguous/unsupported fields remain explicit.
Deterministic extraction is limited to declared labels and patterns; it does not understand arbitrary legal
prose or guarantee complete extraction of long continued clauses.

## Security / privacy / operational readiness

Source/workspace/context authorization, Channel money permissions and AAL2-sensitive reveal/review apply.
Sensitive raw candidates are masked by default; lists never return full extraction JSON. Worker input,
completion and erasure are lease-scoped, with no broad direct document-table access. Audit excludes full
text, excerpts, bank, Guardian and confirmed-value dumps.

These are unsigned operational documents/evidence, including staff-claimed signed copies. Subject export
is minimized; physical Student/Contact cleanup revokes download, clears personal evidence and erases
operational artifacts, including a follow-up sweep for late writes. Finance, Agreement and Commission
ledgers retain their existing facts. Signed legal-archive retention is deferred.

Frozen migrations 109–110 preserve 106–108. Deployment dry-run, runtime/worker helper and template packaging,
PDF parser availability and optional independent matching web/worker encryption key are verified. No production
key or template approval is provisioned by this release. Local PostgreSQL integration uses 18.4-bookworm;
the deployment 18.6-trixie image is not claimed tested when absent locally.

See [architecture](CONTRACT_TEMPLATE_ARCHITECTURE.md), [template review](CONTRACT_TEMPLATE_REVIEW.md) and
[release closure](V324_RELEASE_CLOSURE.md) for contracts, limitations and exact verification boundaries.

## Not implemented

No OCR, image extraction, AI/LLM extraction, semantic identity resolution, e-signature or signature provider.
No verified signature lifecycle, automatic SIGNED/ACTIVE, Payment/Refund/Commission creation or mutation.
No canonical CRM field update from extraction. No Revenue Recognition/Attribution, Channel Revenue/ROI,
Data Import Operations Upgrade, Targets, Forecast or Management AI. Legal PDF generation is not included.
