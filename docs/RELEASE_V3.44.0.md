# Release v3.44.0

Approvals bind the reviewed request snapshot to an atomic decision receipt. A lost response retains
the exact request for explicit confirmation, while current assignment, MFA and custody authority
remain mandatory. Accepted decisions, failed business actions and failed display refreshes have
separate outcomes and recovery controls. No automatic approval or business execution retry is added.

The review workspace supports shareable search, type, lifecycle, personal/reviewable scope, execution
state and pagination. Expired and withdrawn requests remain visible as history. All existing revenue
types have correct labels and route to specialized review. Unexpired pending counts use the same
RLS boundary across the dashboard, action center and administrative discovery.

Apply forward migration `202610250141_approval_review_recovery.sql` before serving the new
application. Existing terminal administrator rules, revenue decision RPCs, consent, export worker
ownership and accounting behavior remain unchanged. Approval snapshot digests normalize timestamps
without revision triggers on immutable revenue records.

See [audit](FIRST_PRINCIPLES_AUDIT_V344.md), [plan](FIRST_PRINCIPLES_PLAN_V344.md)
and [verification](V344_VERIFICATION.md).
