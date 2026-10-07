# v3.32.0 — Revenue Foundation

Revenue Foundation connects accepted Contract services to versioned policies, explicit Principal/Agent assessments and reviewed fulfillment evidence. Deterministic recognition candidates are prepared and reviewed before a separate designated actor manually posts immutable Recognized Revenue facts. Corrections append governed lineage without rewriting the original.

Payment, Refund and Receivable remain the canonical owners of cash receipts, refunds and customer obligations. Cash Application is the dedicated append-only lineage for custody declarations, applications and releases, referencing those existing owners. Refund reservations and source/target ceilings prevent double use. Receiving or applying cash does not recognize Revenue.

The Revenue workspace sits in the existing Commercial navigation space, adjacent to Finance and Commissions, with a link from Finance and integration with its financial context. It provides a recognition queue, candidate review and posting confirmation, recognized history, policy/configuration and evidence views, and cash context. Contract Revenue integration explains service → evidence → candidate → fact. Contract value, receivable, collected, custody, applied settlement, candidates and recognized Revenue remain separate; currencies are never combined without conversion.

Designated business authority, AAL2, independent maker/checker and three-actor preparation/review/posting remain mandatory. Ordinary administrator membership cannot replace business designation. Lost-response retries preserve request identity; accepted writes with failed refresh recover by refreshing only.

## Initial operational limits

- Initial reporting profile/authority bootstrap is a controlled provisioning operation. Accepted commercial-version/service onboarding and accounting-period creation use governed repository commands; they are not general administrator self-service.
- Fulfillment sources currently support CRM Activity and Student Enrollment only.
- Posting is manual. Existing tenants are not activated or back-recognized by migration. Actual tenant policy, authority and evidence are required before use.
- Revenue context fails closed when an explicit workspace differs from the canonical legacy membership selection.
- No General Ledger, tax engine, accounting FX/revaluation, provider AP, Revenue Attribution, automated posting or historical automatic recognition.

Migration head: **120**, **125 SQL files**. This is an uncommitted release-ready checkpoint, not a Production deployment or tenant accounting-policy certification. See [integrated verification](REVENUE_R5G_INTEGRATED_CLOSURE.md).
