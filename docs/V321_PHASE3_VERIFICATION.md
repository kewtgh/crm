# v3.21 Phase 3 — Channel Agreements & Commission

Verdict: `V321_PHASE3_CHANNEL_COMMISSION_COMPLETE`.

## Baseline

- Branch: `main`.
- Starting / final HEAD: `afd0e2b1c5e54f3618e3f8382de6a50060afcc3f`.
- Version: `3.20.0`, unchanged.
- Formal runtime: Node `26.10.0`, npm `12.2.0`.
- Worktree: `.`.
- Phase 1–2: 68 changed/new product files preserved, unstaged/uncommitted.
- Baseline: `work/v321-phase3-baseline/` contains raw snapshots, manifest, combined
  checkpoint patch and Phase 1/2 verification references. Patches were not applied.
- No staging, commit, push, deploy or Production access.

## Implementation

Migration `202610040100_channel_agreements_commission.sql` adds logical Agreements,
versioned commercial terms, explicit Rules, immutable EARNED/REVERSAL accruals,
single-currency Settlement headers and whole-entry lines. Composite workspace/product/
cohort FKs, append-only/version freeze guards, strict revisions, actor/payload-bound
mutation receipts and unique active settlement reservations protect integrity.

Fixed Rules use canonical Enrollment history. Percentage Rules use canonical confirmed
Payments and completed PAID Refunds with decimal snapshots and cumulative rounding.
Shared contracts cannot produce percentage accruals, while fixed obligations remain
independent. Eligibility reads source facts; no client amount is trusted. Existing
Finance facts and customer payment mutations remain unchanged.

Repositories and APIs cover agreement save/lifecycle, eligibility, accrual generation,
settlement drafts and transitions. Organization Commercial shows Agreements; Finance
links to the commission workspace. UI supports draft rules, activation, new versions,
termination, eligibility/blockers, refund reversals, draft selection, approval and paid
confirmation. Both languages label lifecycle/basis/attribution/source; mobile has no
horizontal overflow. The V1 ledger/settlement lists explicitly show the latest 100
Organization records; older records remain retained.

Existing catalog.manage controls agreement/rule/generation writes. Money reads require
SUPER_ADMIN / ADMIN / SALES_DIRECTOR / SALES_MANAGER and Organization access. Ordinary
Sales receive redacted metadata and FINANCE_NOT_VISIBLE eligibility. Settlement writes
use existing finance.payment.record roles SUPER_ADMIN / ADMIN. Eligibility additionally
requires Enrollment/Contract access. No Student PII is saved in ledger or audit snapshots.

Privacy export uses the existing worker and explicit Enrollment references. Student
cleanup nullifies personal references/receipts and retains Agreements, Rules, Accruals,
Settlements and customer financial facts. Audit records governance references. Three
commission triggers extend existing Automation TASK/NOTIFICATION actions without seeded
rules. Five contextual warnings extend the existing quality engine and auto-resolve when
corrected. No amount is copied to data-quality findings.

## Verification

| Check | Result | Evidence |
|---|---|---|
| Declared Node / npm | PASS | 26.10.0 / 12.2.0 |
| Migration verification | PASS | `npm run db:migrations:verify`, 105 migration files |
| Historical raw bytes | PASS | All 104 baseline migrations unchanged, including 091–099 |
| Migration 100 SHA256 | PASS | `f69ede86e4d04566b924b532e0a28136be975340c5be838d35dcd3b5e57229fa` |
| Targeted unit/domain regression | PASS | 61 tests across commissions, operational readiness, commercial links, lead pool, channel intelligence and education business |
| Commission PostgreSQL | PASS | `scripts/test-commission-postgres.mjs`, disposable local PostgreSQL 18.4-bookworm |
| Finance PostgreSQL regression | PASS | `scripts/test-operational-readiness-postgres.mjs` |
| Contract/Quote/Attribution PostgreSQL | PASS | `scripts/test-commercial-links-postgres.mjs` |
| Lead/Channel PostgreSQL regression | PASS | `scripts/test-lead-pool-postgres.mjs` |
| Shared-contract no-double-count | PASS | Two ACTIVE links, no percentage accrual; exclusive source remains eligible |
| Refund / paid-settlement immutability | PASS | +100,000 basis / +10,000 earned; PAID settlement retained; -20,000 / -2,000 reversal |
| Multi-currency | PASS | CNY/USD separate; cross-currency settlement rejected |
| Settlement concurrency | PASS | Two real connections reserve one entry; exactly one succeeds |
| Security / RLS | PASS | Foreign workspace inaccessible; ordinary Sales cannot view amounts/edit terms/mark paid |
| Privacy retention | PASS | Personal references cleared; ledger, Agreement/Rules and PAID settlement retained |
| Atomic audit/history rollback | PASS | Injected audit failure rolls back Enrollment transition, history and accrual |
| Automation | PASS | Real source events, disabled rule no run, retry deduplication, TASK and NOTIFICATION |
| Data quality | PASS | Shared allocation warning; approval warning appears and resolves after paid |
| Typecheck | PASS | `npm run typecheck` in declared runtime |
| Scoped lint | PASS | 28 Phase 3 source/API/test/script files, zero warnings/errors |
| Production build | PASS | Final build after bilingual display correction; no unchanged-source repeat |
| Affected Chromium QA | PASS | Two 55-second phases; 1440/375 × zh-CN/en; 10 evidence groups |
| Whitespace | PASS | `git diff --check` |
| Architecture / status docs | PASS | Channel architecture and implementation status updated |
| Independent / combined reverse-check | PASS | `work/v321-phase3/phase3-delta.patch`, `combined-checkpoint.patch` |
| Full repository audit/regression | NOT RUN | Outside this scoped Phase |
| Commit / push / deploy | NOT RUN | Not authorized for this Phase |

Chromium is the installed `ms-playwright/chromium-1243` executable at
`%LOCALAPPDATA%/ms-playwright/chromium-1243/chrome-win64/chrome.exe`,
reported version `153.0.8010.12`. Browser evidence is under
`work/browser-qa-chromium-1243/v321-phase3/phases/commission-agreements/` and
`commission-ledger/`. It uses actual components and production CSS with mocked business
APIs, **not authenticated browser-to-real-database E2E**. PostgreSQL tests prove actual
calculation, RLS, concurrency, privacy and transaction semantics. Expected injected 503
responses are recorded separately; final reports contain no unexpected errors.
The local QA server is stopped.

## Frozen boundaries and deferred work

Channel Agreement ≠ Customer Contract; Rule ≠ Channel Profile; Enrollment Attribution ≠
Revenue Attribution; Commissionable Base ≠ Channel Revenue; Accrual ≠ Settlement;
Settlement ≠ Customer Payment / Receivable; Shared Contract ≠ Allocated Revenue;
Audit ≠ Commission Ledger. Refund eligibility follows the declared agreement period;
out-of-period refund commercial policy needs a separate business decision.

Not implemented: Revenue Attribution, Channel Revenue/ROI, Contract Allocation / line
items, FX, Partial Settlement, Bank Payout, Accounting / tax / invoice generation,
Sales Targets, Management Intelligence, Documents or AI. No external messages,
bank payments, automatic agreement parsing or Production workflow/configuration seeds.
