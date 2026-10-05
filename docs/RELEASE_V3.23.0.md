# v3.23 — Management Intelligence

Management Intelligence is a permission-filtered read model over existing canonical domains.
It owns no business facts, writes no source records and introduces no independent lifecycle.
The workspace lives in Reports; existing domain repositories, lists and authorizations remain
authoritative. The [architecture and metric contract](MANAGEMENT_INTELLIGENCE_ARCHITECTURE.md)
defines every metric, time boundary, filter, permission and known limitation.

## Executive Overview

Commercial, Delivery, Finance, Channel, Admissions and Student Success are presented together,
with current Attention and Data Quality context. Current snapshots are explicitly separated
from activity during the selected period. Hidden source records are excluded before counting.
Restricted and unknown values remain distinct from an observed zero.

Opportunity/Pipeline Value and Contracted Amount retain their domain meanings. Finance reuses
the canonical scheduled receivable and confirmed receipt definitions: Collected is already net
of refunds. Shared Contracts count once, without allocation across Enrollments. Money is returned
as decimal strings with currency; CNY and USD are never added together. Channel contributions
are explicit PRIMARY/ASSIST Enrollment attribution; Commission comes from the immutable ledger
and settlements, including each reversal once. Student Success reuses its existing analytics,
including independent UNKNOWN Health and Goal attainment with a precisely defined denominator.

## Operating Trends and comparison

Registered period metrics use their canonical business dates, including Lead creation/conversion,
current won/lost Opportunity close dates, Enrollment lifecycle history, Payment/Refund business
dates, Commission activity, Admissions lifecycle dates and Student Success operational dates.
Opportunity and Lead data do not reconstruct a complete historical conversion funnel.

Buckets are calculated on the server in workspace business timezone using half-open timestamp
boundaries. DAY is allowed through 45 days, WEEK through 180 days, otherwise MONTH; coarser
granularity is permitted and the maximum selected interval is 730 inclusive calendar days.
The previous comparable period immediately precedes the current interval and has the same
calendar-day length. September 1–30 compares with August 2–31, not automatically MoM.
Previous zero produces NULL percent change. Comparison stays neutral and currency-specific.
Snapshots, Goal attainment and current Attention have no invented historical comparison.

Product/Cohort filtering applies only through actual domain context. Leads have no invented
Product scope; Contract filtering does not allocate shared amounts. The API declares applicability.

## Canonical drill-down

Typed report filters reuse existing Leads, Opportunities, Enrollments, Finance and Student Success
lists and their repositories. Supported exact drill-downs share row/count predicates and source
permissions. Payment amounts reconcile within the chosen currency. Unsupported exact destinations
are labelled workspace navigation. Changing a URL cannot grant access.

Reconciliation applies to the same actor, filters and live read context. These are fresh reads,
not historical frozen snapshots; intervening source edits can change a subsequent list result.

## Attention and decision context

Overview shows the first 30 items and the full visible total. The complete queue supports server
pagination, stable PRIORITY/OLDEST/NEWEST order, domain/reason/presentation-severity filters and
applicable Product/Cohort scope. Six canonical reasons are supported: overdue receivable, overdue
milestone, blocked Workflow, high open Success Risk, stale Success Check-in and high Data Quality
finding. Overview and full queue read the same source projection.

Items carry stable source/reason identity and finite, reason-specific context: authorized scheduled
amount and currency, due date, lifecycle state, current source severity, last actual Check-in or
active support count. No Student PII or operational narrative is returned. Presentation severity
and sort order are display conventions, not a business impact or Risk score. A Case can legitimately
have ON_TRACK Health and a HIGH open Risk. Stale Check-in is not a Risk inference.

Open source navigates to the canonical Contract, Admissions, Success or Data Quality context.
There are no Management mutation buttons. An item exits naturally when its source no longer
matches; there is no separate resolution, acknowledgement, assignment or snooze operation.
Trends and comparisons never generate Attention, Tasks, Automation events or notifications.

## Migration and verification boundary

Forward migrations 106–108 contain read projections/functions and their grants; no new business
table, trigger, permission framework or speculative index. Their raw bytes are frozen. No 109
migration is introduced. Release verification and exact hashes are recorded in
[release closure](V323_RELEASE_CLOSURE.md).

Browser verification uses actual React components and production CSS with mocked business APIs.
It is not authenticated browser-to-real-database E2E. Real RLS, calculations, timezone/DST,
comparison, currency, pagination, reconciliation, privacy and pure-read behavior are tested
separately in disposable PostgreSQL. No Production access is required.

## Explicit non-scope

No Revenue Attribution or Recognition; Channel Revenue or ROI; Sales Targets, Quota or Budget;
Forecast; P&L, Gross Margin or Product Profitability; persisted Management Alert; acknowledgement,
assignment or snooze lifecycle; historical Attention/snapshot warehouse; owner-wide Management
filter; Management AI, Executive AI summary, recommendation or prediction; whole-student Success
Rate; Success, Risk, Business or Executive score; user-configurable KPI builder.

Goal attainment remains ACHIEVED / (ACHIEVED + NOT_ACHIEVED), with NULL for zero denominator.
Case COMPLETED is an operational state, not a successful Student or an inferred Outcome.
Observed counts and changes do not establish causal effects.
