# First-principles audit — v3.36 work

Opening baseline: main, ba9fcc70cd5c173ddd833119e1c3c3b997a37585, version 3.35.3,
migration 127 / 132 SQL, clean worktree and empty staging. Private opening hashes are
retained under ignored work/. No Production environment or data was accessed.

## Email

The Email Delivery Worker owns the final renderer for nine supported templates.
templates.js escapes dynamic values and validates same-origin HTTPS auth links, but
the outer layout uses div/main/footer; it is predominantly English. EMAIL_BRAND_NAME
and EMAIL_FROM are independently supplied runtime values: source branding alone does
not prevent an old display label. config.js and operator preflight currently accept
arbitrary labels. Customer and portal template modules produce subject/body text;
their SERVICE/MARKETING and variable semantics must survive the final email shell.
The notification protocol removes persistence-only invitation fields and decrypts a
temporary credential only for delivery. Auth email remains synchronous Web-owned;
business/staff/calendar communication remains asynchronous Worker-owned.

Required changes: shared presentation-table layout, bilingual system copy with
fallback, safe long-value wrapping, runtime/operator brand validation and local
non-sending rendering/preview tests. This is renderer/configuration work, not a DB
or provider credential change. Branding must not rewrite customer-authored prose.

## Staff lifecycle

Staff creation is one system-pool transaction including the encrypted invitation.
Current status changes revoke sessions, preserve membership/staff records and audit.
Role updates use the governed change_staff_role RPC, AAL2, receipts and a workspace
staff-identity lock. There is no controlled account-deletion eligibility operation.
app_auth credentials/sessions/MFA cascade with account deletion; business foreign
keys have mixed cascade, nulling and restrictive behavior. notification_outbox
recipient is retained by FK; staff invitations include requested_by and user_id.
enterprise_directory_users has an external-directory link that cannot be silently
discarded. SSO uses the enterprise identity path; multi-workspace membership is real.

A safe cleanup cannot rely on a short hand-maintained business-table list or DELETE
success. It needs fail-closed FK/reference discovery, explicit identity-scaffold
exceptions, business/audit checks, locked revalidation, a receipt that survives target
deletion and minimal retained deletion audit. SENDING invitation jobs must block
physical cleanup; cancellation of unclaimed queued jobs must be atomic with deletion.
Creation/resend/deletion need compatible staff-identity and outbox locking.
These are authorization, reliability and schema/RPC changes. No financial fact or
business audit may be cascade-deleted for UI convenience.

## Roles and sales statistics

AppRole has six access roles. TypeScript capabilities and many DB functions/RLS
contain explicit role lists; adding labels only would leave UI and DB inconsistent.
SALES roles require an active team. All staff, including administrators, are represented
in sales_team_members after migration 079. That table is an existing staff/hierarchy
owner, not proof of sales eligibility. current_crm_role derives from membership; roles
do not imply Revenue designations. Contact manager visibility uses explicit team/
manager relationships, not title rank.

sales_performance_report_v220 and performance_export_rows_v220 currently select
active staff. Actuals use explicit performance_contributions, targets use approved
allocations, and forecasts use opportunities. Company finance and recognized Revenue
have separate canonical projections. Current active/role edits can affect historical
rosters without an explicit eligibility-period rule. Management and exports need the
same eligibility policy; changing just the React roster would be inconsistent.

Required changes: bounded non-sales permission profiles, separate business-function
metadata and governed effective-dated sales qualification. New qualification must be
explicit; legacy approved attribution remains visible as historical/unscoped context,
not guessed administrator sales eligibility. Closed/historical approved targets and
contributions must not be rewritten. Eligibility changes must never mutate Payment,
Contract, Refund, Commission, Cash Application or Revenue facts.

## Classification

UI: email shell/preview, staff detail sections and lifecycle/qualification forms.
Read model: eligibility explanations, deletion blockers, unscoped contribution context.
Authorization: new role profiles, all corresponding server/DB guards, AAL2 admin commands.
Schema/RLS: forward-only lifecycle/function/eligibility metadata and governed RPCs;
role constraints and current report/export functions require new migration(s).
Reliability: exact request receipts, accepted-write refresh-only recovery, lifecycle
and invitation concurrency, no stale-role authority bypass.

Historical migrations 1–127 and ignored Revenue research stay untouched. Any unresolved
cross-domain integrity or privilege inconsistency blocks its module and version promotion.
