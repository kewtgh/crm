# v3.26.0 — Business workflows and interface upgrade

This release brings editing actions into their business context and reorganizes daily CRM work
around organizations, their contacts, students and families.

- Organization details support contextual contact creation/editing, contract draft creation/editing
  and access to the canonical product catalog editor. Commercial information is grouped into
  overview, agreements, contact collaboration and cooperation results.
- Organization contacts replace the generic customer-directory label. Organization, owner and
  contact-type filters are evaluated on the server. Shared responsive search/filter controls keep
  organization, contact, lead and duplicate-review controls compact.
- Students and families share a student-centered entry. Searches include recorded guardians and
  household members; family roles are displayed from stored relationships. Student detail separates
  profile, family, participation and academic records. Cohorts expose their participating students.
- Annual academic progression runs through the existing reminder worker after September 1 in each
  workspace's business timezone. An annual batch runs once; missed worker downtime is caught up for
  the current academic boundary. Only active students in the immediately preceding academic year
  are eligible. Missing mappings and revision conflicts remain visible failures. Manual grade
  corrections remain available; an annual retry does not overwrite them.
- Student Success is presented as Student support & follow-up, with service records, goals and
  outcomes explained in business language. Collection requests tolerate absent route parameters;
  errors preserve safe codes and request references. The reported production load failure was not
  reproduced against the disposable database and needs its request reference if it persists.
- Imports offer the latest applicable template without a version selector. Existing-record links
  are optional and explained in business language. Historical protocol support remains internal;
  no legacy compatibility choice is added to the interface.
- Data-quality rules show localized descriptions instead of internal rule identifiers.

## Data and deployment contract

Migration 113 adds RLS-aware family search, filtered contact metrics, guarded contract-draft
updates and worker-only annual progression. Historical migrations are unchanged. Automatic work
records a system actor with batch lineage, rather than impersonating staff. No new service or port
is needed. Apply the forward migration before starting the updated worker.

Contract draft edits require the exact current revision and cannot modify active/signed contracts
or contracts with receivables/payments. Product editing updates the shared catalog; organizational
product context continues to come from formal contracts. Family membership never implies legal
signing authority. Participation and financial lifecycles retain their existing owners.

No Revenue implementation, Revenue policy approval, production access, deployment or push is part
of this change. Pending Revenue specifications remain uncommitted.

## Verification

See the repair plan for bounded verification results. Browser checks use actual components,
production CSS and synthetic mocked APIs; local disposable PostgreSQL verifies the database
contracts independently. This is not authenticated browser-to-production verification.
