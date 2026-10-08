# ewaya CRM v3.35.3

Sales-account creation validates the required team before making a request. Missing or
stale teams show a bilingual field error instead of a generic account-creation error.
Administrators can still be created without a sales team by a super administrator;
ordinary administrators cannot create administrators.

Migration `202610080127_staff_invitation_outbox_system_insert.sql` adds an explicit
crm_system INSERT policy for staff-account-created emails with matching queued invitation
lineage. It does not change existing grants, role properties or historical migrations.
Migration head is 127, with 132 SQL files.

Accounts and encrypted invitation credentials remain one transaction. Invitations remain
asynchronous: accepted creation returns 202 / UNCONFIRMED, and later delivery failure does
not undo the account. Web authentication email and Worker business-email boundaries from
v3.35.2 remain unchanged. Unexpected database policy errors are sanitized.

Deployments require the new forward-only migration. No secret rotation is required.
The complete historical migration chain already generates a generic system policy for
old tables in migration 058; the explicit policy also repairs installations where that
generic policy is absent. No Production state was inspected or modified.

See [verification](STAFF_CREATE_V3353_VERIFICATION.md).
