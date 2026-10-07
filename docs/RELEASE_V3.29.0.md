# v3.29.0 — Operational deletion and compact workspaces

## Removal and conflict reliability

Recoverable cleanup covers 44 business resource kinds. Daily workflows gain contextual removal
actions, and Record cleanup provides a searchable, paged entry for less frequent records.
Existing workspace and record permissions, revisions, AAL2, audit and request receipts apply.
Organization timestamp tokens preserve PostgreSQL microseconds, avoiding false stale conflicts.
Real stale tokens still fail. Unused channel agreement drafts can be removed and restored;
protected financial evidence retains its formal correction workflows.

## Daily workspaces

Organization and Contact filters align through the shared FilterBar. Organizations add server
city, curriculum and classification filters. Students add grade/year selectors; Families
expose status. Enrollment, Application and Student Support advanced conditions use draft,
Apply/Cancel/Reset semantics rather than a large always-open form. Expansive desktop controls
use compact columns; mobile keeps primary context and progressively discloses the rest.
Shared selector spacing and record action layouts are corrected across consumers. Restrained
section and card tints distinguish work, context, analysis, finance and governance while
status and warning colors retain their existing meaning.

Academic Progression adds direct searchable Student correction using the existing update
contract. September 1 workspace-timezone automation remains unchanged. Account privacy and
completeness become compact secondary controls. Lead rows use wider scanning regions and
authorized deletion remains separate from Opportunity creation.

## Analysis, communications and imports

Commission accruals and settlements support server currency/status/date filtering before the
bounded row limit; settlement creation retains an independent candidate query. Channel
analysis uses compact applied scope and a filter drawer, with secondary distributions
disclosed on demand. Management snapshot/period semantics and separate currencies remain.
The Household portal sits under Self-service communications. Imports simplify navigation and
disclose optional mapping detail without changing preflight/apply/rollback contracts.

## Data boundary and verification

Additive migration 114 supplies recoverable storage, deleted-record guards and server filters.
All 118 prior SQL files remain byte-identical. Migration application was exercised only on an
isolated disposable local database. No Production access, deployment, Revenue implementation,
new financial interpretation or credential operation is included.

See [audit](UX_OPERATIONS_AUDIT.md), [repair plan](UX_OPERATIONS_REPAIR_PLAN.md) and
[verification](V329_OPERATIONS_VERIFICATION.md). Browser evidence uses actual components,
production CSS and fictional mocked APIs; database tests separately verify the deletion
authority and persistence behavior.
