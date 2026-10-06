# v3.25 — Data Import Operations Upgrade

Version: **3.25.0**. This release extends the existing Imports workspace and batch engine with typed
field contracts, categorized templates, strict preflight, canonical execution and bounded relationship
orchestration. It introduces no new CRM business fields or identity model.

## Categorized templates and field contract

Organization, Household and Contact have separate v2 XLSX/CSV blank and example templates. XLSX
includes Data, Guide, Enums and hidden resource/version Metadata. Guide describes create/update,
sensitivity, references and nullable clear rules; enum codes remain authoritative on the server.
Unknown, duplicate, missing or cross-resource columns and incompatible metadata are rejected.
CSV requires explicit resource/version selection. Filenames and Excel dropdowns are not authority.

The typed registry traces executable fields to canonical storage and owning mutations. Organization
has 35 business fields, Household 20 and Contact 19; optional columns remain optional. Core Organization
type and business-profile type are separate fields. Household income is not education budget.
Existing LEGACY_UNVERSIONED templates and historical batch semantics remain separate; old mapping
profiles are not automatically reinterpreted as v2. Student identity remains owned by Contact;
Cohort and Enrollment retain their existing canonical lifecycle mutations and status history.

## Strict preflight and canonical execution

Preflight and execution share normalization, authorized reference resolution and canonical mutation
preparation. Domain-validation probes roll back their subtransactions: no business record, audit,
receipt or lifecycle history survives preflight. Execution reauthorizes and rechecks target revisions,
duplicates, references and domain constraints. Core plus profile/communication changes commit in one
row transaction. Profile UPDATE requires an existing profile; it does not silently create one.

UPDATE blank/omitted/null cells preserve current values. `__CLEAR__` works only for allowlisted nullable
entity fields. False and zero remain explicit values. Decimal money stays exact through PostgreSQL
numeric; currency is separate and no FX conversion occurs. Contact full-input mutations preserve
untouched fields, and WeChat uses its owning communication mutation.

Selected-reference tokens are actor/workspace/resource bound, hashed at rest, expire after 24 hours
and require fresh authorization at use. Hidden, missing, foreign and expired references share safe
errors. Names, email and phone provide duplicate/search candidates, never automatic identity selection.
Duplicate review requires an explicit decision. Ordinary MERGE is not a versioned import operation.

Payload-bound accepted receipts prevent repeated mutations. Repair requires a fresh revision and
preflight. Stale execution fails rather than overwriting current data. Guarded rollback checks current
revision and dependencies and preserves subsequent business edits; it is not a destructive delete tool.

## Relationship imports and Import Sets

Five independent SET_V1 relationship templates cover Organization–Contact association, Household
Member, Student Guardian, Organization Contact Intelligence and Organization Contact Relationship.
They use their canonical owning mutations with explicit CREATE/UPDATE/SKIP, revision and receipts.

Association permits only standalone Contact → explicit Organization. Non-null reassignment remains
blocked. Household membership identity is Household + Contact, independent of member role. Guardian
identity is Student + guardian Contact; legal authority requires explicit input and is never inferred
from membership or MOTHER/FATHER/GUARDIAN labels. Intelligence requires current Organization membership.
Directed relationships preserve direction; symmetric PEER/WORKS_WITH pairs canonicalize endpoints,
and self relationships are rejected.

Set-aware entity templates add typed aliases without changing standalone v2 headers. Aliases are
Set-local, resolve only to successful or explicitly selected canonical records, and cannot be
redirected after resolution. They are not permanent business identifiers and never fall back to
name/email/phone matching.

Import Sets orchestrate existing batches through a dependency DAG, limited to **20 files, 2000 rows
per Set and 1000 rows per file**. Each execute/rollback call attempts at most 100 rows. They are not
cross-file ACID transactions. Cycles and missing/failed parents block dependencies. Repair runs fresh
preflight; resume excludes APPLIED rows. Progress exposes review, failure and blocked states.
Rollback runs in reverse dependency order and can yield explicit PARTIAL_ROLLBACK with blocked reasons.
Conservative revision guards can block reversal of earlier created entities after dependent mutations.

## Privacy, retention and deployment

New CANONICAL_V2/SET_V1 evidence is private and retained for at most 30 days. Contact, Household and
Student physical cleanup clears related row data, errors, duplicate/reference evidence, rollback
snapshots and scoped receipts; affected Set aliases/dependencies are invalidated. Subject export
contains safe subject-specific import lineage, not another party's complete row. Audit excludes
income, notes, family background and relation narratives. Cleanup preserves Finance, Commission and
Enrollment lifecycle records under their canonical retention policies.

Historical pre-CANONICAL_V2 legacy evidence has not been destructively purged. No permanent original
XLSX/CSV archive or error-file export service is introduced.

Forward migrations **111 and 112** are required and frozen. Deployment discovers them from the
existing migration chain; the existing worker performs evidence expiry cleanup. Template generation
uses existing XLSX dependencies. There is no new service, port, production secret or external provider.
Deployment dry-run is distinct from an actual deployment.

## Deferred

No mass identity merge, automatic name/email/phone identity matching, arbitrary Organization
reassignment, relationship delete imports, global ACID or unlimited orchestration, permanent external
IDs, generic new CRM fields, original source-file archive, AI mapping/identity resolution or OCR.
Revenue/Revenue Attribution, Targets, Forecast and Management AI remain outside this release.

See [Import Operations architecture](IMPORT_OPERATIONS_ARCHITECTURE.md),
[Phase 1 verification](V325_PHASE1_VERIFICATION.md), [Phase 2 verification](V325_PHASE2_VERIFICATION.md),
[Phase 3 verification](V325_PHASE3_VERIFICATION.md) and [release closure](V325_RELEASE_CLOSURE.md).
