# v3.34.0 workspace follow-up verification

## Scope and baseline

This checkpoint addresses six reported usability gaps after the v3.34.0 checkpoint. Opening HEAD: `7997527cbe991db3fd43104aab38e9393ee825c3`, branch `main`, version `3.34.0`, migration 124, 129 SQL files. Version remains `3.34.0`.

## Changes

1. Lead actions align at the right of the desktop record and reorganize on narrow screens.
2. Revenue has an administrator configuration drawer, including reporting entity setup, independent configuration review, and accounting-period creation.
3. Agreement overview, rules, documents, settlement and history now have distinct content. Document generation and evidence upload use compact disclosures instead of dominating the default view.
4. Contact commercial information places messaging identity alongside working communication style; cooperation and potential notes remain expanded.
5. Family creation uses structured preferred language and per-member Father/Mother/Guardian/Other relationships. Separate people have visually distinct sections, and relationships remain independently editable.
6. The global Student Outcomes workspace now has a prominent heading, compact empty state and no pagination for an empty first page. The earlier embedded-panel change had not covered this global route.

## Runtime boundary

Migration `202610080125_revenue_admin_configuration_family_relationship.sql` is the only added migration. Head is 125, count is 130. All 129 opening SQL files remain byte-identical. All 26 protected historical Revenue artifacts remain byte-identical and are excluded from this checkpoint.

Administrator configuration is an explicit, requested extension of the previous controlled-provisioning boundary. `revenue_admin_configuration_read` and `revenue_admin_configuration_command` enforce workspace membership and ADMIN/SUPER_ADMIN roles in the database. Mutations require AAL2, lock active membership and the workspace Revenue scope, use mutation receipts and write audit in the same transaction. Profile submission/approval delegates to existing exact-basis governance; initial owner and independent approver must be two active administrators. Configuration does not grant posting authority or create candidates/facts. Ordinary financial approval/posting designation requirements remain unchanged.

The new `household_members.family_relationship` records family relationship independently of member role, primary-contact selection and legal guardian authorization. Historical memberships default to UNSPECIFIED without guessing. Preferred-language creation choices are Simplified Chinese, Traditional Chinese and English, with an optional unset value. Existing household/person creation receipts and person edit concurrency checks remain in use.

No Revenue calculation, posting, correction, cash application or Commission accounting semantics changed. Accepted writes retain refresh-only recovery; uncertain writes retain their original receipt identity.

## Verification

| Check | Result |
|---|---|
| New follow-up disposable PostgreSQL suite | PASS: administrator/SUPER_ADMIN configuration, ordinary-user denial, AAL1 denial, independent activation, self-review denial, receipt retry/conflict, period overlap, cross-workspace rejection, no automatic Revenue, three independent family relationships and editing |
| Existing Contact access PostgreSQL suite | PASS unchanged: management-chain access, peer denial, administrator governance, consent independence, household/person creation and edit retries |
| Shared Finance/Commission regression included by those harnesses | PASS, including settlement concurrency and privacy boundaries |
| Targeted static/release metadata tests | 7 PASS |
| Typecheck | PASS |
| Lint | PASS; changed QA/test scripts checked again after final edits |
| Build | PASS |
| Targeted Chromium browser checks | 13 PASS |
| Migration verification and opening hashes | PASS: 125 / 130; opening 129 SQL unchanged |
| Public privacy and whitespace checks | PASS |

PostgreSQL verification used isolated disposable `postgres:18.4-bookworm`, with random credentials/container, tmpfs, loopback port and cleanup; no application database or Production access. Browser verification used pinned Chromium revision 1243, actual version `153.0.8010.12`, against the validated local build. It exercised real components with fictional API fixtures, separately from real PostgreSQL tests; it is not a browser-to-database E2E claim.

The 13 browser checks cover desktop/right-aligned leads, tablet/mobile leads, global outcomes with/without records and English labels, distinct agreement sections, Contact communication/notes layout, structured family inputs on desktop/mobile, and administrator/SUPER_ADMIN configuration entry with employee exclusion. Screenshots and raw logs remain ignored under `work/`.

## Operational limits and checkpoint

Initial configuration requires two distinct administrator accounts for owner/checker separation. Financial business designations still govern policy review, evidence verification and posting. The new drawer supports initial profile setup/review and period creation; it is not arbitrary editing of approved accounting configuration or business-authority self-assignment. Existing tenants require migration 125 before using the new configuration and family relationship fields.

No broad release audit or complete browser/Revenue matrix was rerun for this bounded follow-up. The user authorized a local commit after verification. Only this follow-up's implementation, tests and report belong in that commit; protected historical Revenue files and private QA evidence are excluded. Push, deployment and Production access are not performed.
