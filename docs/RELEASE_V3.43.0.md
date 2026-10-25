# Release v3.43.0

Communication requests now have atomic outcome receipts. Response loss retains the original
request for explicit confirmation; competing actions remain locked until its outcome is known.
Redelivery requires the exact reviewed failure timestamp and rejects possibly accepted provider
outcomes. Current contact visibility and role capability remain mandatory before receipt replay.

The inbox adds shareable search, lifecycle, purpose and delivery-attention views with complete
server pagination, browser history and independent list/detail refresh. Explicit conversation
links survive page changes. Drafts remain with their conversation in page memory, with leave
warnings; no message text is saved to browser storage. Read-only roles see viewing controls only.
Accepted operations and failed display refreshes have separate recovery messages.

Apply forward migration `202610250140_communication_workspace_recovery.sql` before serving the
new application. Existing batch email producers, consent evaluation and the leased delivery worker
retain their interfaces and delivery ownership. The old unversioned staff redelivery entrypoint is
revoked. No production migration or external delivery is performed by local release verification.

See [audit](FIRST_PRINCIPLES_AUDIT_V343.md), [implementation plan](FIRST_PRINCIPLES_PLAN_V343.md)
and [verification](V343_VERIFICATION.md).
