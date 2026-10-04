# v3.21 — Channel Commercial Management

v3.21 adds channel operating and commercial capabilities to the existing Organization,
Contact, Lead, Opportunity, Enrollment and Finance domains. It creates no second account,
contact, pipeline or customer Finance system. No production business templates are seeded.

## Channel Intelligence

Human-confirmed S/A/B/C/D commercial tiers and nullable 10–100 partnership potential extend
Organization Business Profiles independently of operational status. Structured school
admission outcomes preserve unknown versus zero. Internal Contact Intelligence and the
Decision Map distinguish decision role, power, contribution, key-person assessment and
same-Organization relationships without inferring identities or business facts.

## Channel Activation

The public SCHOOL Lead Pool is shared inside the authenticated workspace. Atomic
Claim / Release / Reassign, assignment history and explicit partnership stage history
preserve operational evidence. Claim never qualifies a Lead. The activation projection
reads existing Contacts, Opportunities, Outreach Events and explicit Enrollment Attribution.
An Event or Enrollment never implicitly advances the account partnership stage.

## Channel Commercial

Versioned Channel Agreements contain explicit ALL_PRODUCTS / PRODUCT / COHORT rules,
PRIMARY / ASSIST eligibility and fixed-per-Enrollment or percent-of-net-collected terms.
Percentage earnings use confirmed receipts and negative completed-refund reversals in an
immutable ledger. Shared Contracts remain SHARED_CONTRACT_UNALLOCATED: no equal split,
estimated allocation or duplicated percentage base. Fixed Enrollment obligations remain
independent of contract allocation. Used commercial terms require a new Agreement version.

Whole-entry, one-currency settlements support Draft, Approved, Paid and Cancelled states.
Approval freezes lines, Paid freezes the header, and cancelled reservations become open
again. Mark Paid records confirmation of an external channel payout; it creates no customer
Payment or Receivable. Later refunds preserve prior Paid settlements and create new
negative accruals. Permission layers reuse existing commercial and Finance capabilities.
Existing Automation provides internal TASK / NOTIFICATION triggers without default rules.

## Channel Analytics

Reports → Channel Analytics provides visible account coverage, lead ownership/assignment,
partnership stages, opportunity/event activity, distinct Enrollment contributions,
commission exposure and settlement status. Current snapshots and period activity have
separate date semantics using the workspace business timezone. Unknown tier stays unknown.
Commission analytics reads the ledger directly, counting each reversal once. Money stays
server-calculated and grouped by currency; unauthorized amounts and hidden subjects are
excluded. Account Performance links to the report. Analytics is entirely read-only.

## Frozen migrations

Raw SHA256 values (LF/raw bytes protected by `.gitattributes -text`):

| Migration | SHA256 |
| --- | --- |
| 098 Channel Account Intelligence | `f45dd8bb6fe95f92181b496560f3f89422cf18d00e286a7f490356159187031a` |
| 099 Public Lead Pool / Channel Activation | `510a85724d8406d8618cc2b660382653da6168af4e9a94b42fd9ef20c257774d` |
| 100 Channel Agreements / Commission | `f69ede86e4d04566b924b532e0a28136be975340c5be838d35dcd3b5e57229fa` |
| 101 Read-only Channel Analytics | `ed17fbfbe25bc5125f222e5d96af071eae091885e132e7f022d3c441c7d378be` |
| 102 Empty settlement report correction | `e18113b2917f7164f4b90e515326f8a7b8afab5429caaff48653c8d4fc49efbb` |

102 preserves already-frozen 101 and corrects reporting of valid empty Draft/Cancelled
settlement headers. Unfiltered empty batches count with a zero amount; product/cohort
filters still require matching ledger lines. No settlement business facts are changed.

## Deferred

Revenue Attribution, Channel Revenue / ROI, Contract Allocation / line items, FX,
partial settlement, bank payout, Accounting / tax / invoice generation, Sales Targets,
Management Intelligence, AI and automated research / scraping are outside this release.
No Documents system or real production workflow configuration is added.

Future Work also includes cohort-defined conversion rates, claim-to-qualification duration
(reliable Lead status history is absent), CSV export for this projection, optional trends,
paid-settlement correction and explicit commercial policy for out-of-period refunds.
V1 receipt/refund eligibility respects agreement effective periods; out-of-period refunds
do not automatically accrue a reversal. Later contract relinking does not rewrite historical
source-event ledger entries. These boundaries require separate business design.

See [Channel architecture](CHANNEL_COMMERCIAL_ARCHITECTURE.md),
[release closure verification](V321_RELEASE_CLOSURE.md) and the retained Phase 1–3 reports.
