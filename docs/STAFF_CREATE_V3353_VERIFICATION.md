# Staff-account creation repair — v3.35.3

Baseline: main, `463d8b423c72919ae9359828f25576d84930e2a8`, v3.35.2,
migration 126 / 131 SQL. Opening worktree and staging were empty.

## Root cause and repository qualification

The create form uses noValidate, so the team selector's native required attribute
was not enforced. Empty teamId was removed from the request, and the server's
TEAM_NOT_FOUND response was not translated or mapped to the team field. It degraded
into the generic create error. Explicit client validation now prevents requests for
all SALES roles with a missing/blank team; server enforcement remains intact.
Stale/inactive teams produce the same bilingual field error. ADMIN can remain teamless.

Migration 072 grants crm_system INSERT on notification_outbox but does not define
a dedicated INSERT policy for that producer. A NOBYPASSRLS system connection needs
a permitting policy. Repository inspection and execution found an important
qualification: migration 058 dynamically generated a permissive internal ALL policy
on old tables, including notification_outbox, and granted wider existing system table
privileges. Consequently the complete fresh historical chain already permits this
insert. The reported deployment denial was reproduced by removing that generic policy
only in the disposable fixture. Production policy state was not inspected; it must not
be inferred from the absence of a literal policy declaration in source searches.

The new explicit policy repairs a missing permitting-policy state without depending on
that legacy generic policy. It preserves all existing grants and policies. It does not
claim to narrow the pre-existing generic ALL contract.

## Forward-only migration

`db/migrations/202610080127_staff_invitation_outbox_system_insert.sql`

Policy: `system inserts staff invitation outbox`, INSERT TO crm_system only.
It permits EMAIL / staff-account-created entries only when a QUEUED delivery matches
the outbox ID, recipient and workspace. queueInvitation inserts that lineage earlier
in the same transaction. Creation and resend are the only direct system-pool outbox
producers found; other business producers retain their governed functions.

No grants, UPDATE/DELETE policies, ownership, SUPERUSER or BYPASSRLS are added. No
crm_app, crm_worker or PUBLIC privileges change. Applying the migration twice is safe.
Migration head is 127 / 132 SQL. All opening 131 SQL files remain raw-byte identical.
Production adoption requires this new migration; no secret rotation is required.

## Behavior and sanitization

- Team errors map to teamId, with an accessible field announcement and Chinese/English
  messages. ADMIN requests can proceed without a sales team.
- STAFF_IDENTITY_TAKEN and ROLE_ASSIGNMENT_FORBIDDEN retain their stable responses.
- An unexpected raw SQLSTATE 42501 returns STAFF_USERS_FAILED / 500; observability uses
  DATABASE_POLICY_DENIED. SQL message/detail text and synthetic secrets never appear
  in response or telemetry tests.
- Successful creation stays 202 / emailDeliveryStatus UNCONFIRMED. No synchronous
  provider delivery is introduced. Later invitation delivery failure does not undo
  the committed account or change the already accepted response.
- Web continues synchronous DEVICE_VERIFICATION, PASSWORD_RESET and EMAIL_VERIFICATION.
  Worker retains staff invitations and other asynchronous business email. Web preflight
  delivery requirements and Web/Worker equality checks from v3.35.2 are unchanged.

## Real PostgreSQL verification

`npm run test:admin-users:postgres` uses postgres:18.4-bookworm, the available local
image. It creates a random container/database, independent random credentials, a tmpfs
volume and loopback random port; it never loads an application env file. Cleanup runs
in finally. All identities and addresses are independently fictional.

The actual createStaffUser/createAccount code and system pool execute the transaction.
The suite verifies:

- crm_system is NOBYPASSRLS and not SUPERUSER; outbox RLS is enabled.
- Fresh-schema creation succeeds, and a simulated missing-policy final-insert denial
  rolls back accounts, credentials, profiles, memberships, team member/assignment,
  invitation, outbox and audit. Reapplying the new policy repairs it.
- A valid SALES_SPECIALIST creates accounts, password_credentials, user_profiles,
  workspace_memberships, sales_team_members, sales_team_memberships, a QUEUED
  staff_invitation_delivery and a PENDING staff-account-created EMAIL outbox row.
- The temporary password is encrypted in the payload and matches its Argon2 hash;
  no plaintext is present in any of those persisted records or audit rows.
- Missing, unknown, inactive and cross-workspace teams leave no partial records.
  Duplicate email and username return STAFF_IDENTITY_TAKEN without partial writes.
- SUPER_ADMIN creates a teamless ADMIN; ADMIN creating ADMIN is denied without writes.
- A post-commit Worker FAILED delivery leaves the account and accepted result intact.
- Ordinary/app/worker roles cannot use the new policy to insert arbitrary records.
  An ordinary fixture role given INSERT privilege still fails RLS. In the simulated
  absence of the generic policy, system writes without invitation lineage fail, and
  UPDATE/DELETE affect no rows. Existing grants remain byte-for-byte equal before and
  after application of the new policy; its role and command are exactly crm_system/INSERT.
- The existing staff-invitation RLS suite passes on the same disposable database.
  Its old fixture now uses an onboarded administrator with AAL2, as existing rules require.

Failed attempts in these tests leave no partial accounts. This supports the expected
transactional behavior; no Production account records were queried to establish an
empirical count of historical failures.

## Verification results

| Check | Result |
|---|---|
| Focused admin/client/route tests | 14 PASS |
| Admin, invitation protocol, auth email, target preflight and production-deploy regressions | 98 PASS |
| Disposable staff creation + existing staff invitation RLS | PASS |
| Migration-history and release-metadata tests | 7 PASS |
| Migration verification | PASS; 127 / 132 SQL; first 131 byte-identical |
| Typecheck | PASS |
| Lint | PASS |
| Production build | PASS, v3.35.3 |
| Public privacy | 13 PASS |
| Release metadata alignment | PASS |
| git diff integrity | PASS |

Client and API behavior tests exercise the actual submission helper and route using
mocked persistence/identity/provider boundaries. Database tests exercise the real repository
and transaction. They are not claimed as browser-to-database E2E. No full browser or
unrelated database campaign was run. Private evidence stays under ignored work/.

## Exact changed files

- `README.md`
- `app/api/admin/users/route.ts`
- `components/staff-users-page.tsx`
- `db/migrations/202610080127_staff_invitation_outbox_system_insert.sql`
- `docs/IMPLEMENTATION_STATUS.md`
- `docs/RELEASE_V3.35.3.md`
- `docs/STAFF_CREATE_V3353_VERIFICATION.md`
- `lib/i18n/locales/workspace-pages.ts`
- `lib/version.ts`
- `package-lock.json`
- `package.json`
- `scripts/test-staff-create-postgres.mjs`
- `scripts/test-staff-invitation-rls.mjs`
- `tests/admin-users.test.mjs`
- `tests/staff-create-route.test.mjs`

Version 3.35.3; commit authorized. No push, deploy, Production access, secret inspection,
credential rotation or historical migration rewrite. The operator's production migration
and deployment remain separate actions.
