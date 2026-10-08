# v3.34 implementation plan

Baseline and findings: [audit](FIRST_PRINCIPLES_AUDIT_V334.md). Version remains 3.33.0 until all gates pass. No staging, commit, push or deployment is authorized for this task.

| Work | Classification | Runtime boundary |
|---|---|---|
| Organization activity timeline | UI_ONLY | Existing timeline events and navigation |
| Compact Lead rows | UI_ONLY | Existing access, filters, qualification and actions |
| Revenue states | UI_ONLY | Existing authoritative read state; controlled provisioning |
| Agreement workspace sections | UI_ONLY | Existing Commission commands, no financial changes |
| Selected-step workflow builder | UI_ONLY, RELIABILITY | Normalize inherited task titles into existing save contract; exact retries |
| Contact commercial/follow-up | UI_ONLY | Existing canonical profiles and follow-up commands |
| Contact record access | AUTHORIZATION, SCHEMA/RLS, READ_MODEL, RELIABILITY | Existing manager links and collaborators; authoritative upward read chain, explicit edit grants, explicit administrator governance (see clarification below) |
| Consent change/history | AUTHORIZATION, SCHEMA/RLS, RELIABILITY | Separate current permission from immutable change evidence; outbound access AND consent |
| Multi-parent Household creation | SCHEMA/RLS, RELIABILITY, UI_ONLY | Atomic existing Household/Contact/Member owners; independent person facts |
| Student Outcomes | UI_ONLY | Existing outcome owner and mutations |

## Execution order

1. Preserve opening SQL/artifact hashes; audit completed before application changes.
2. Implement shared compact layout and selected-step builder. Retain accessibility and receipt state machines.
3. Append bounded Contact/family migration only after enumerating current security-definer readers. Reuse authoritative manager and collaborator sources. Manager hierarchy grants read, while edit requires capability and an explicit editing relationship. Apply the explicitly authorized administrator hierarchy below. Do not guess legacy parent identities.
4. Implement server access/read/share and consent/family commands with scoped receipt identities. Guard linked records, searches, counts and exports; preserve worker communication governance. Add independent Contact access and communication sections.
5. Add disposable PostgreSQL tests for hierarchy, revocation/owner changes, all indirect visibility paths, consent separation, multi-parent atomicity and retry behavior. Run the operations regression and only shared-infrastructure financial regressions actually affected.
6. Verify browser scenarios across all requested surfaces, both languages, desktop/tablet/mobile, keyboard, uncertain retry and refresh-only recovery using pinned Chromium 1243. Keep private evidence ignored. Do not label fixture-browser checks full-stack database E2E.
7. Run contracts, typecheck, lint, one required build, privacy, migration integrity and diff checks. Record failures honestly and fix within scope.
8. Write `V334_VERIFICATION.md` with all acceptance answers and exact evidence. Only after full acceptance promote canonical version sources to 3.34.0 and create release notes; verify metadata and affected final gates. Leave staging empty.

## Acceptance blockers

Any Contact name/count leakage, consent/access coupling, arbitrary hierarchy inference, non-atomic family creation, lost-request duplication, financial semantic change, or all-step template form blocks release. UI success alone is insufficient. No version promotion while any required gate remains incomplete.

## Authorized governance clarification

The user clarified during implementation: managers read subordinates; ADMIN is above employees; SUPER_ADMIN has all permissions. This supersedes the earlier no-admin-override target. Implement explicit server rules: ADMIN reads employee-owned Contacts, while SUPER_ADMIN can read/edit/share all Contacts in its active workspace. Ordinary management visibility alone does not grant edit. ADMIN peers and SUPER_ADMIN-owned records are not implicitly employee records. Existing capability checks, workspace isolation, receipts and audit remain mandatory; full authority does not mean unaudited table CRUD. Update adversarial tests and UI explanations accordingly.

## Direct-manager clarification

The subsequent clarification restricts ordinary management read access to the authoritative **direct** manager link only. No recursive ancestor inheritance and no inference from title/seniority. Explicit ADMIN and SUPER_ADMIN governance from the previous clarification remains separate. Add grand-manager and unrelated senior-title denial tests.

## Final management-chain clarification

The user subsequently allows indirect managers when the relationship remains within the same department. This supersedes the direct-only clarification. Use `sales_team_members.manager_member_id` for the real reporting chain and ACTIVE `sales_team_memberships` in an active `sales_teams` record for the existing authoritative department/team boundary. Carry one fixed team identity through the whole chain: overlapping multi-team memberships must not bridge unrelated departments. No title/rank inference. Missing or inactive team/manager links fail closed. ADMIN/SUPER_ADMIN rules remain explicit and separate.

## Added authorized work: staff roles

Classification: AUTHORIZATION + SCHEMA/RLS + RELIABILITY + UI_ONLY. Extend the new, uncommitted migration 124 with a bounded role-change command; do not rewrite historical SQL. Add a focused role editor to the existing staff action menu. Route both the new purpose-specific endpoint and any legacy role mutation through the same guarded command. Require exact request identity, expected current role and AAL2. Test employee/admin/super-admin transitions, protected-role denial, last-active-super-admin safety, cross-workspace targets, stale role, revoked actor, audit/receipt and retry. Add focused browser coverage for allowed options, privileged target controls and accepted-write refresh-only recovery.

## Completion and omission review

Implementation and bounded prior-plan reconciliation are recorded in [V334_VERIFICATION.md](V334_VERIFICATION.md).
The additional closure fixes cover linked audit visibility, new person-field privacy cleanup, partial-family
validation, read-only consent controls, role adjustment and blank/add/remove template browser assertions.
Historical Revenue tests remain unchanged; compatibility is additive. No financial semantic change.

## Build cache retention supplement

The user additionally requested 24-hour automated build-cache retention. The environment example,
post-deployment cleanup fallback, storage-maintenance fallback and checked-in BuildKit GC policy
now agree on `LUMINA_BUILDKIT_CACHE_RETENTION_HOURS=24` and
`LUMINA_BUILDKIT_CACHE_MAX_AGE=24h`. Existing scoped automatic cleanup remains enabled;
no actual Docker cleanup, deployment or remote environment change is performed by this task.
