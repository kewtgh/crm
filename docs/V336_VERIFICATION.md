# v3.36 verification

## Opening and scope

Opening main: `ba9fcc70cd5c173ddd833119e1c3c3b997a37585`, version 3.35.3,
migration 127 / 132 SQL, clean worktree, empty staging. Audit and implementation
plan were saved before implementation. All data used for verification is fictional.
Private logs, HTML and screenshots stay in ignored `work/`.

This change covers email presentation, unused staff identity cleanup, bounded access
roles, business functions and explicit sales-reporting qualification. It introduces
no Revenue, Commission, Refund or Cash Application economic change.

## Email

All nine Worker templates use shared presentation-table components: header, title,
paragraph, details, code, action, security notice and footer. The centered 600px shell
uses inline styles, system fonts, wrapping, responsive rules and dark-mode treatment.
Dynamic content remains escaped and authentication actions retain same-origin HTTPS
validation. Customer-authored subject/body and SERVICE/MARKETING purposes are preserved.
Customer and portal messages reach this shell through their existing communication
delivery path; no second sending engine was added.

The renderer supports optional `en` / `zh-CN` locale with English fallback. Producers
that do not supply locale continue to use that fallback; this release does not infer
every recipient's language. Worker configuration and operator preflight require
`EMAIL_BRAND_NAME` equal to `ewaya` or `ewaya CRM`, and a matching branded sender
display name. Operators must validate those non-secret settings before Worker rollout.
No provider credential or production configuration was read or changed.

Web continues synchronous device verification, password reset and email verification.
Worker continues asynchronous staff invitations, notifications, reminders, calendar
and communication delivery. Shared webhook validation and credential isolation remain
unchanged. Account acceptance is not reversed by a later provider failure.

## Staff lifecycle

Removal follows suspend → clear/reassign current business links → recheck → remove.
An active account returns DEACTIVATION_REQUIRED. Previous business activity is not a
permanent ban. Removal eligibility is server-authoritative and revalidated under the staff identity
advisory lock, membership/account/profile/member locks and ordered outbox row locks.
Catalog inspection checks UUID references, with explicit exceptions only for personal
identity scaffolding. Remaining business references fail closed. A forward FK protects new
uploaded-receipt actor references without rewriting legacy rows.

Self-removal, the last active super administrator, privileged targets for an ordinary
administrator, multiple workspaces and external-directory identities are protected.
A claimed SENDING invitation blocks deletion. Unclaimed invitation rows are removed
atomically with identity scaffolding, credentials, sessions, MFA and trusted devices.
Creation/resend share the same staff lock. Actual administrator membership is rechecked
inside transactions; stale caller roles cannot create or resend privileged invitations.

An unused identity's own preference edits are personal scaffolding. Their data is
removed and their audit is minimized with the deleted actor reference cleared; this
does not exempt audit records of real business operations. A real preference write
and subsequent cleanup are covered by the PostgreSQL regression.

If current links are cleared and only business-audit actor references remain, removal
keeps a de-identified DISABLED UUID with a purge marker, without membership/profile,
password, sessions, email tokens, MFA or trusted devices. Original business audit rows
remain unchanged. This is account removal, not an account that can be reactivated.
New/changed account foreign-key references lock and reject a purged identity, including
concurrent ownership assignment; unchanged retained history may still be read/maintained.
No-reference identities are physically removed. Mandatory remaining business/financial
references still require controlled resolution; this command does not erase them.

Removal requires AAL2, confirmation, an exact request receipt and retained minimal
audit. Audit failure rolls everything back. Same-key replay returns the accepted
result after the target is gone; changed payload conflicts. Generic business deletion
or financial cascade is never offered. Existing owner/task reassignment paths clear
current links before a fresh deletion check. There is no new bulk offboarding engine.

## Roles and reporting policy

System role, primary/additional business functions, and sales qualification are separate.
Six new profiles are available through local staff administration:

| Profile | Bounded access |
|---|---|
| Finance Manager | Financial reads and governed trade-payment recording |
| Finance Specialist | Financial reads |
| Operations Manager / Specialist | Education operations, tasks and calendar |
| Academic Specialist | Education / student support, tasks and calendar |
| Customer Success Specialist | Education reads, tasks, calendar and message reads |

These profiles do not grant administrator access, sales performance management,
Commission mutation or Revenue business designations. Existing Contact predicates and
narrower command-specific approver/owner checks remain in force. New role support is
not a promise that every legacy administrative or delete command is available to them.
External SCIM role provisioning retains its existing bounded contract; the new profiles
are locally provisioned. Workflow default-owner vocabulary accepts all supported roles
without turning the template into runtime authorization.

Eight primary/additional business functions are supported. Current sales qualification
requires an explicit dated approval, Sales function and active account, membership and
team relationship. No `active=true` or administrator status automatically qualifies a
person. Super administrators can configure themselves; administrators can configure
themselves and ordinary employees in their workspace, but cannot change another
administrator or super administrator. These commands cannot change system roles.

Effective dates are today or future, not retrospective. Existing ACTIVE/CLOSED approved
allocation scopes are retained as historical authorization. Future approved allocations
capture their period scope. Historical contributions are never deleted: actuals use the
approved period scope or the qualification effective on the business date; current roster,
forecast and funnel require current qualification. Excluded/unscoped contributions are
shown separately to authorized managers rather than reassigned. Approved/closed scopes
survive subsequent exclusion. Reports and exports use the same predicates. Management
company-level Contracted/Collected metrics remain canonical company totals, independent
of personal eligibility; the sales-performance breakdown uses the qualified report.

## Migrations and integrity

Three new forward-only migrations:

- `202610080128_staff_account_lifecycle.sql`: controlled cleanup RPCs, purge marker/reference guards and receipt actor FK.
- `202610080129_staff_business_roles.sql`: role vocabulary, restrictive policies and bounded commands.
- `202610080130_staff_reporting_eligibility.sql`: workforce metadata, immutable dated/scope history and report/export predicates.

Final schema is 130 / 135 SQL. All opening 132 SQL SHA256 values are byte-identical.
Historical Revenue research remains ignored and locally retained; no historical Revenue
document/test or migration was rewritten. The staff-role regression fixture only adds
the now-required valid sales team before its existing role transition assertions.

Production rollout requires these migrations, but no rollout was performed. No secret
rotation is required. Branding settings may require operator correction; values are not
included here.

## Verification matrix

| Check | Result |
|---|---|
| Worker renderer, delivery protocol and operator controller | 205 passed |
| Email-specific rendering/security tests | 20 passed, included in the 205 |
| Email HTML browser preview | 54 passed: nine templates, two languages, three widths; dark-mode samples |
| Staff lifecycle PostgreSQL | PASS: suspend-first, blocked/current-link-cleared removal, retained audit identity, credentials/session/MFA cleanup, receipts, audit rollback, directory/workspace/admin protection |
| Staff races | PASS: concurrent exact deletion, Worker claim versus removal, invitation resend versus removal, new ownership versus removal |
| Business roles / performance PostgreSQL | PASS: non-sales creation/login, own education writes, finance boundaries, self qualification, scope/history, report/export parity, unchanged company facts |
| v3.35.3 staff creation / invitation RLS | PASS: atomic eight-owner creation, encrypted-only invitation, no partial failure records, async delivery |
| Existing staff-role PostgreSQL | PASS: governance, AAL2, revocation, stale roles, races, sessions, audit and last-super protection |
| Contact access PostgreSQL | PASS: management chain, peers, shares/revocation, consent independence and family records |
| Management / Finance / Channel Commission PostgreSQL | PASS through existing regression fixtures, including currencies, refunds, settlement race and immutable lineage |
| Revenue current-schema PostgreSQL | All eight entries passed, including upgrade, real API integration and Commission |
| Deployment / target runtime / auth runtime | 126 passed |
| Contracts, including auth/MFA, staff and delivery | 335 passed; separate captcha suite 8 passed |
| Staff Chromium QA | 12 page/viewport checks passed |
| Typecheck / lint / production build | PASS |
| Public privacy | 13 passed |
| Migration verification / historical hashes / diff whitespace | PASS |

Disposable PostgreSQL used the locally available `postgres:18.4-bookworm`: random
container/database/passwords, tmpfs storage, loopback random port and finally cleanup.
No application or production database/environment was used. Tests call real account
repository/authentication code and real RLS/RPC/report functions. Company facts remain
unchanged when qualification is changed; the synthetic qualified/unscoped contributions
and approved targets remain distinct from company cash and contracts.

Browser QA used pinned `ms-playwright/chromium-1243`, browser 153.0.8010.12. Staff checks
use actual components/production CSS with fictional intercepted API responses, separately
from the real PostgreSQL security tests. They cover role/function/eligibility editing,
blocked deletion, suspend-first and retained-audit notices, confirmation, English/Chinese, desktop/tablet/mobile, keyboard/focus,
same-body uncertain retry and accepted-write refresh-only recovery. Screenshots were
reviewed, including compact confirmation and narrow forms. Email QA renders the final
Worker output without sending mail or accessing providers. Chromium previews do not
certify Outlook/Gmail/Apple Mail behavior; real-client validation remains an operator QA
limitation, not a claim made by this report.

## Release checkpoint

After the functional, database, email and UI gates passed, canonical metadata was
promoted to 3.36.0. Post-promotion release metadata, 335 contracts plus 8 captcha tests,
typecheck, zero-error lint, production build, 13 privacy checks, migration verification
and whitespace checks passed. The affected staff browser phase also passed all 12
checks against the final 3.36.0 build. Final inventory review added the bounded
own-preference cleanup, and the user's final clarification added suspend-first removal
and audit-identity retention after current links clear. The affected lifecycle/roles/
reporting suite, current-schema Revenue/Commission, build, typecheck, affected lint,
staff browser checks, contracts, migration manifest and privacy were rechecked.

The reviewed checkpoint inventory contains 57 source/test/documentation files. It
excludes work/, screenshots, logs, environment files, database artifacts and historical
Revenue research. The user separately authorized the local checkpoint commit after
completion; its final SHA is recorded in Git and the delivery response. Push: NOT RUN.
Deploy: NOT RUN. Production: NONE. No credential rotation or history rewrite was run.

EWAYA_EMAIL_DESIGN_SYSTEM_COMPLETE

STAFF_LIFECYCLE_MANAGEMENT_READY

ROLE_BASED_PERFORMANCE_SCOPE_READY

LUMINA_CRM_V3_36_0_RELEASE_CANDIDATE
