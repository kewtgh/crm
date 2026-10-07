# v3.28.0 — Product UX architecture and workflow experience

This uncommitted release candidate organizes Lumina around user tasks and business context.
The existing visual language and canonical domain owners remain. Git checkpoint, deployment and
Production validation are separate decisions. Final gate results are recorded in
[release closure](V328_RELEASE_CLOSURE.md).

## Global navigation and shared UX

Seven stable product spaces cover Work, Relationships, Student Services, Commercial, Management,
Operations & Governance, and Administration. Student and Family destinations use query-aware
matching; existing URLs, including the bare Household route, retain their semantics. Navigation
visibility continues using existing capabilities and role restrictions; it does not authorize access.

Shared headers and identities prioritize the current locale and show an alternate name secondarily.
Filters use the existing drawer machinery with draft/apply/cancel behavior. Wide desktop (1920),
standard desktop (1440) and mobile (375) use available workspace width and progressive disclosure.
Missing translations have a human-safe fallback; unknown status, missing, unset and unavailable
remain distinct. Timeline source status/kind labels and recorded contact context are presented
according to the canonical source rather than treated as missing translation keys.

## Management experience

Executive Overview places scope, Attention, period changes and key KPIs before bounded domain
summaries and drilldown. Full distributions and historical series remain available on demand.
Student Support Analytics prioritizes Health/Risk, Goals/Interventions, Outcomes and period activity;
Product/Cohort comparison and trends are secondary disclosures.

These views consume the existing management and support APIs. SNAPSHOT is not PERIOD: comparisons
come only from eligible canonical period series. Null comparison is not zero. Currencies remain
separate, and restricted, unavailable and valid zero remain distinguishable. No client-side business
aggregation, fabricated historical snapshot or predictive interpretation is introduced.

## Student and family experience

Students have a first-class directory and focused Record Workspace with Profile, Family, Journey
and Academic sections. Family context shows actual members and explicit guardian facts, with a
link to the lightweight Household workspace. Membership does not imply legal guardianship or a
father/mother relationship.

Journey composes canonical Enrollment, Application and Student Support facts and links to their
owning workspaces. Household participation is explicitly labeled as Household context. There is
no universal Student lifecycle object or automatic cross-domain transition. Existing Contact
identity, academic progression policy and manual corrections are retained.

## Organization account experience

Organization records use one primary identity header and six local sections: Overview, People,
Opportunities, Contracts & Products, Channels & Outreach, and Activity. Completeness is secondary
data-quality context. Contextual actions reuse existing APIs, editors, mutations, revision controls,
permissions and receipts, with no Account-specific backend.

Organization, Contact and Student creation expose the canonical minimum first and place enrichment
behind a disclosure. Duplicate checking remains. Full-input editing preserves untouched values.
Accepted save and failed refresh remain separate outcomes. The four-field bilingual Activity API
is unchanged; relaxation is deferred.

## Lead and dashboard workflows

Lead handling is a work queue with primary search/scope/status controls and advanced filters in a
drawer. Each item emphasizes one state-aware permitted action; governance actions use More.
Ownership, qualification, conversion, revisions and uncertain retry keep their original meanings.

Daily Dashboard orders My Today, bounded operational Attention, Business Snapshot and Quick
Navigation. Management mode is a compact snapshot and Executive link. Mode preference is
account-scoped browser state and grants no access. Task facts, Action Center signals, Dashboard
snapshots and Executive management interpretation retain separate meanings; overlapping counts
are not added into a unique-work total.

## Contracts and cross-product closure

Contracts distinguish the selected row, retain compact selected-record context and provide
same-record Enrollment/Documents navigation. Existing relation and document owners remain.
Products gain responsive locale identity alignment; Catalog, Bundles and Exchange Rates stay in
one workspace with separate canonical ownership and currency context.

Imports and Data Quality prioritize human explanations and repair direction, with safe identifier
diagnostics in keyboard-accessible disclosure. Strict import workflows and quality rules are
unchanged. Shared keyboard, focus, navigation, drawer, long-name and responsive regressions cover
the affected core views. Existing stylesheets and their loading order remain; this is not a full
CSS rewrite.

## Data and domain boundaries

No new migration. Latest migration remains **113**. All historical migrations remain unchanged.
No new business field, permission, task engine, management engine or duplicate domain store is added.
Student/Household, Enrollment/Application/Support, Product/Cohort, Contract/Enrollment/Payment,
Receivable/Payment and Channel Agreement/Commission Accrual remain independent.

Revenue remains outside this release. No Revenue policy approval, recognition, ledger, posting,
attribution, ROI, profit or P&L is introduced. Confirmed payment, Contract value, Receivable and
Commission are not renamed Revenue. The six separate Revenue specifications are excluded.

## Verification

The final review reruns bounded Phase 1–5 contracts, release metadata checks, typecheck, lint,
production build, dependency audit, privacy and migration verification, plus pinned Chromium core
checks at 1920/1440/375. See [closure](V328_RELEASE_CLOSURE.md) for actual results and exclusions.
Browser evidence uses actual React components, production CSS and independently fictional mocked
business APIs. It proves presentation and interaction, not RLS, real database mutation or Production
acceptance. Raw screenshots and logs remain Git ignored; no public evidence upload is included.
