# Contract Template Review — v3.24 Phase 1

Two new master files exist; both are **DRAFT v1, NOT APPROVED**. Originals are read-only and retain
their Roadmap SHA256. No business/legal approval is implied by this operationalization.
See [architecture](CONTRACT_TEMPLATE_ARCHITECTURE.md) and [verification](V324_PHASE1_VERIFICATION.md).

## Reference / master identity

| Type | Original SHA256 | New master SHA256 |
|---|---|---|
| CHANNEL_RECRUITMENT_AGREEMENT | `3fd472fbc5dbf73b4fb4f96255d9b9fc92698d20a4b7eb8b9652156f18cc957e` | `5c2dc2fc84faa9d71eedc620b41aa2b81a4eda58e55cfc376f9cd4dbb93143db` |
| STUDENT_PROGRAM_SERVICE_AGREEMENT | `b7750ecd0f91075a45a408063e71f2c39c759f4e18afa87a13d3d5e9c20f4712` | `21905febf608d07ae2564d134ae024067dca8582881a638bc077d189322313fa` |

Original A: `<workspace>`.
Original B: `<workspace>`.
New files: [channel v1](../templates/contracts/channel-recruitment-agreement-v1.docx) and
[student v1](../templates/contracts/student-program-agreement-v1.docx).
Exact field definitions and unresolved review items: [catalog](../templates/contracts/catalog.json).

## A — Channel recruitment

| Original issue | Resolution / field key | Source | Review still required? |
|---|---|---|---|
| Filename 2026, fixed 2025-12-17 signing date | Fixed date removed; `agreement.signing_date` | Agreement Version signed_on; missing blocks, no fallback to today | Actual signing/effective dates must be correct |
| Fixed company/address/contact/invoice/bank slots | Parameterized `company.*`, `channel.*`, `bank.*`; personal core metadata cleared | Approved company configuration / explicit confirmations, not .env | YES: legal entity, authority, account and invoice data |
| 甲/乙 names treated as interchangeable | Company legal party vs Channel legal organization; CRM organization display shown separately | Organization reference + confirmed legal names/signatories | YES: contact is not authorized signatory |
| Company AIS authorization/background and UCD GAPP description | `company.background_clause`, `program.description`, explicit `program.name`, institution and Cohort | Confirmed document clauses + Product/Cohort context | YES: no assertion of current company authorization |
| Fixed 2026–2027 cooperation term / one-year implication | `agreement.effective_from/to`, `agreement.review_clause` | Existing Agreement Version dates; separately confirmed annual review | YES: no hard-coded duration claim |
| USD 3,000 per Student | `commission.amount/currency` from explicitly selected FIXED_PER_ENROLLMENT Rule | Existing Rule only; synthetic preview uses USD 3,750 to prove reference does not win | YES: Rule ID/source revision; never creates a Rule |
| Registration + Offer + one-month attendance/no withdrawal | Original eligibility conditions retained and explicit red unsupported review field added | Reference legal conditions, not current engine facts | **UNSUPPORTED_BY_CURRENT_COMMISSION_ENGINE**; blocks formal generation |
| Original registration reporting direction may be inconsistent | Retained for review; no staff-role guess or reversed party rewrite | Reference paragraph 53 | **REQUIRES_BUSINESS_OR_LEGAL_REVIEW** |
| Payment after enrollment / settlement timing | Unsupported settlement condition and confirmed payment terms | Legal clause vs actual ledger/settlement are separate | YES; no automatic accrual/payment |
| Legal-code typographical name | Corrected 民典法 → 民法典 | Mechanical reference correction only | Legal clause review remains pending |

Other liability/confidentiality/refund/dispute clauses retain their source text, except identity/project
slots. They have not been independently legally approved. In particular, tuition collection by a
university/provider does not establish the company's gross Revenue or refund responsibility policy.

## B — Student program service

| Original issue | Resolution / field key | Source | Review still required? |
|---|---|---|---|
| HKU title with Cambridge certificate clause | Cambridge removed; program title and all institutional references use `program.name` / `program.institution_name` consistently | Product name + explicitly confirmed institution | YES: actual certificate/recommendation entitlement, not assumed by this correction |
| 甲方 mixes participant and payer | Separate Buyer/signing name, Household reference, Participant and Guardian captions; `review.party_capacity` blocks approval | Household / Student Contact context + explicit signing/guardian confirmations | **REQUIRES_BUSINESS_OR_LEGAL_REVIEW** for general rights/duties |
| Missing Guardian assumed from Contact | No fallback; explicit guardian.required/name/capacity | Confirmed human legal capacity | Missing required Guardian → MISSING_REQUIRED_FIELD |
| Fixed RMB 15,980 and uppercase amount | `contract.amount/currency/amount_words` | Contract amount; CNY deterministic uppercase; USD remains ISO decimal | Reference amount is not Product price; no canonical override |
| 12,980 + 3,000 service split | Confirmed fee components replace reference amounts and must sum to Contract amount | Document confirmations; original service-inclusion descriptions retained | YES: fee decomposition/actual inclusions; not internal costs |
| Fixed 2026.2.6–2026.2.12 dates | `program.start_on/end_on` | Enrollment → Cohort dates | Known actual Cohort dates required |
| Reference seven-day itinerary | Replaced with one multiline `program.itinerary` slot | Confirmed document content; no permanent Product itinerary | YES: current program arrangements; original read-only reference retained |
| Reference company and actual bank number | Cleared/parameterized, including recurring header company name | Approved company/static configuration or confirmations | YES: bank/signatory authority; no payment operation |
| Receipt + two days / mini-program payment method | Confirmed `payment.terms/method` slots; no promise that this is a Payment due fact | Document terms, not a generated Payment | YES: payment/refund/cancellation commercial terms |
| Signing and program dates conflated | Separate `contract.signing_date` and Cohort service dates | Confirmed document signing date vs canonical Cohort dates | YES: confirmation is not a Contract lifecycle update |

Sensitive general clauses remain reference legal text and require review; they do not authorize
collecting or inferring health/medical facts. No substantial legal conclusion is made here.

## Initial Phase 1 rendering status — historical PARTIAL

At the initial Phase 1 checkpoint, source page/section geometry, styles, table definitions,
numbering and opaque relationships were preserved. A retains its three tables. B's reference itinerary block is an intentional content
replacement, so pagination may change; headers get DRAFT/PREVIEW ONLY, and personal core metadata
is sanitized. These intentional edits do not constitute visual fidelity approval.

ZIP/XML, body/table/header/footer placeholder coverage, checksum, known literal removal and
synthetic replacement tests PASS. **Actual Word/compatible-reader opening and rendered page
inspection are NOT VERIFIED**. The packaged renderer cannot start due to missing pdf2image;
LibreOffice is absent. Word COM opening did not complete, including a non-sandbox attempt;
the task-owned unopened Automation process was stopped. Computer Use native pipe is unavailable.

Layout QA must still verify Chinese glyphs, long names, money/uppercase, table overflow, page
breaks, header/footer and signatures. Neither template is cleared for production or Phase 2 yet.


## Phase 1A reader / visual closure — COMPLETE

The historical failure above is superseded by actual installed **Microsoft Word LTSC 2024**
opening and PDF export, executable **16.0.17932.21000**, COM version 16.0/build 16.0.17932.
Each of the two masters and seven synthetic previews was opened using normal read-only
`Documents.Open`, with all alerts enabled. All opens/repagination/exports completed;
OpenAndRepair was never used, and no repair, corruption or unreadable-content prompt was accepted.
There is no desktop prompt screenshot: Computer Use's native pipe was unavailable. The evidence
is successful normal Word opens with alerts enabled, logs, page counts and actual exported pages.

Final render timestamps: **2026-10-05 11:32:29–11:32:39 UTC**. Word produced PDFs; installed
Windows.Data.Pdf rendered every page to PNG. This is local QA, not a production Office/PDF pipeline.
No new dependency was installed. All **55 pages** were checked against **42 visually inspected
exact-byte PNG identities**; the other 13 pages have identical SHA256 to inspected pages.
All five header contact sheets (22 unique header crops) were also inspected.

### Observed defects and layout-only fixes

- Channel lacked recurring DRAFT identity after page 1: added a DRAFT/PREVIEW header in all sections.
- Student header had excessive spacing and long-company overlap: compact 9pt Arial/宋体 headers
  with zero paragraph spacing; long synthetic company names wrap within the existing margins.
- Inline signatures mixed parties and offered inadequate writing space: two-column, borderless,
  fixed-width, non-splitting forms with separate Company/Channel or Buyer/Company captions,
  36pt writing space, and a separate full-width Guardian row. Original field keys remain unchanged.
- Observed orphaned section/subsection headings: keep-with-next applied to the relevant short
  headings. Legal body text remains unchanged.
- Student standard preview had a header-only blank page before the itinerary annex: removed
  four empty layout paragraphs and moved the explicit page break onto the existing annex heading.
  The standard preview is now 7 pages; the long-text variant is 8, without an unreasonable blank page.

Every affected file was regenerated, opened in Word and rerendered after fixes. The final masters
retain the original section geometry and body styles, with the explicitly listed layout changes.
Channel retains three original tables plus one signature form; Student has one new signature form.
Party mapping, canonical sources, amount/Guardian/Commission semantics and governance did not change;
catalog differences are limited to the two master checksums.

### Final rendering matrix

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

Both masters intentionally contain recognized mapped field tokens; unknown master tokens are zero.
Every synthetic preview has zero unresolved placeholders. Chinese/English text, tables, line wrapping,
page breaks, signatures, headers and DRAFT identity pass. The long-name fixtures exercise Company,
Organization, Buyer/Household, Product/Cohort, multiline itinerary and payment terms.
Student CNY 20,000.00 renders as **人民币贰万元整**. The USD variant has ISO USD amounts without
人民币/¥. Guardian-required displays confirmed name/capacity; not-required displays explicit bilingual
Not applicable; missing-required displays a red bilingual Missing marker. Channel eligibility/settlement
and Student party-capacity review remain visible red blockers, not approved or inferred values.

Evidence: `work/v324-phase1/render-qa/word-render-manifest.json`, `word-batch.log`,
`pages/<document>/document.pdf`, `pages/<document>/page-N.png`, `visual-page-groups.json`,
`header-page-map.json`, `headers-1.png` through `headers-5.png`, `visual-qa.json` and `final-integrity.json`.
Initial/intermediate renders are retained separately for observed-defect comparison.

Final technical verdict: **V324_PHASE1_CONTRACT_TEMPLATE_FOUNDATION_COMPLETE**.
**Both templates remain DRAFT, NOT APPROVED**. Business/legal review items in the tables above remain
unresolved. Phase 2 infrastructure may be designed separately; DRAFT is preview/test only, and formal
customer generation must remain APPROVED-only. Visual QA is not template or contract approval.
