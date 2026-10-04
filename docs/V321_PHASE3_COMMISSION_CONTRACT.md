# Phase 3 implementation contract

Baseline: main / afd0e2b1c5e54f3618e3f8382de6a50060afcc3f / 3.20.0.
Phase 1–2 (68 files) are preserved under work/v321-phase3-baseline, including raw
snapshots, combined patch, manifest and verification references. No patch is applied.
Migration 100 is forward-only; all 104 existing migration files are frozen.

Finance inspection: contracts.contract_value, receivable_schedules.amount/paid_amount,
payments.amount/refunded_amount use numeric(14,2). Payment status CONFIRMED or REFUNDED
is an effective receipt. Completed refunds are refunds.status=PAID with refunded_at.
Collected in the existing Enrollment projection is sum(amount-refunded_amount), not
Contract or Receivable value. Workspace business_timezone defines event dates.

Agreement configuration uses existing catalog.manage roles SUPER_ADMIN, ADMIN,
SALES_DIRECTOR. Money reads use these plus SALES_MANAGER, subject to Organization
access. Settlement writes/approval/paid use existing finance.payment.record roles
SUPER_ADMIN/ADMIN. Ordinary BD users receive agreement metadata with redacted terms;
Finance/Enrollment visibility is not inferred from Organization access.

Agreements have immutable Organization/logical identity and separate versions/rules.
Only DRAFT terms are editable. Activation freezes terms, requires rules, and rejects
overlapping active effective periods within a logical agreement. Unknown end is not
infinite business certainty; a later version must resolve an overlap explicitly.
Same-version overlapping rules for the same basis/attribution/event are rejected.
Different products/cohorts, PRIMARY/ASSIST and fixed/percentage obligations are explicit.

Eligibility requires explicit source_organization_id, never an Event/Referral inference.
Fixed earnings use the first canonical ACTIVE/COMPLETED Enrollment history event, once
per Rule/Enrollment/earning event. Percent earnings use confirmed Payment events only
when exactly one ACTIVE Contract Enrollment link exists. Mixed shared/exclusive coverage
is evaluated per contract. No equal split or implicit FX is permitted.

Percentage ledger stores gross receipt earnings and separate PAID-refund reversals;
their net equals the frozen net-collected basis. Refunds reverse previously earned
obligations using the original rate, even after a version terminates or settlement is
paid. They never create a new obligation or rewrite an old entry. Cumulative decimal
rounding prevents reversals exceeding the original rounded commission. Eligibility
preview displays net collection; ledger entries retain event calculation snapshots.

Normal Enrollment-history, Payment-confirmation and Refund-completion events invoke a
private domain consequence in their transaction. Explicit generate/reconcile per source
supports late attribution/configuration; there is no historical daily recalculation.
Source identities and request receipts prevent duplicates. Same Rule/Payment cannot be
charged again to a different Enrollment after link changes. Financial source changes
are rechecked under the existing commercial relation lock and a commission lock.

Ledger entries are append-only EARNED/REVERSAL, with no client-supplied amount. Privacy
clears personal Enrollment/Attribution/fixed-history references and personal receipts,
while retaining opaque source identity, Organization, Rule/version, Contract and monetary
facts. No Student/Household PII snapshot is stored.

Settlements are separate from customer Payments/Receivables. One Organization/currency
per header; server-calculated totals; whole entries only. Draft lines reserve accruals
under a unique active reservation and transaction lock. Approval requires positive net
amount; approval freezes lines. Paid requires external payment reference and is immutable.
Cancellation of Draft/Approved needs reason and releases reservations without deleting
historical lines. Mark Paid records an externally completed payout, never sends money.

Channel Agreement ≠ Customer Contract; Rule ≠ Channel Profile; Enrollment Attribution ≠
Revenue Attribution; Commissionable Base ≠ Channel Revenue; Accrual ≠ Settlement;
Settlement ≠ Customer Payment/Receivable; Shared Contract ≠ Allocated Revenue;
Audit ≠ Commission Ledger.

Non-scope: Revenue Attribution/Channel Revenue/ROI, Contract allocation/line items, FX,
partial settlement, bank payout, accounting/tax/invoice generation, Sales Targets,
Management Intelligence, Documents/AI agreement parsing/recommendation.
