# Implementation plan — v3.36 work

Development version remains 3.35.3. All steps use fictional fixtures and disposable
databases. No Production, push or deployment. Final version/commit are authorized only
after full acceptance. Historical migrations and Revenue research stay intact.

1. EMAIL / UI: create reusable presentation-table email components in the existing
   renderer; cover all nine templates, system localization, security notices, long-value
   wrapping and equivalent text. Preserve customer-authored content and consent purposes.
   Enforce ewaya runtime brand/display-name configuration in shared Worker validation and
   operator preflight. Add renderer and independent local HTML/Chromium preview coverage.
2. LIFECYCLE / SCHEMA-RLS / AUTHORIZATION: append a governed eligibility/read/delete
   command using FK/reference discovery, explicit identity-only cleanup exceptions,
   protected/admin/self/multi-workspace/directory checks. Require AAL2, receipt and audit.
   Block SENDING delivery, cancel/delete unclaimed invitation scaffolding under locks,
   retain minimal account-lifecycle audit without private credential data. Share the
   existing staff lock with creation/resend and recheck all dependencies at commit.
   UI shows eligibility and offers deactivation/reassignment when cleanup is blocked.
3. ROLES / AUTHORIZATION / SCHEMA-RLS: add bounded Finance, Operations, Academic and
   Customer Success profiles; audit every affected role parser, constraint, command,
   capability and navigation guard. Non-sales roles require no fake sales team.
   Revenue designation, ADMIN protection, MFA and Contact hierarchy remain independent.
4. PERFORMANCE / READ-MODEL / SCHEMA-RLS: separate primary/additional business functions
   from role; store audited effective-dated sales eligibility with valid team/member
   references. Use the same canonical predicate for roster, target/actual, forecast,
   funnel, rankings, management breakdown and export. Preserve approved historical
   attribution and disclose excluded/unscoped amounts instead of reassigning them.
   Restrict qualification edits to current/future effective dates; do not recast closed
   periods using today's mutable role/active flag. Explain the selected historical rule.
5. RELIABILITY / UI: three staff sections, exact mutation identity on uncertain response,
   confirmed acceptance followed by refresh-only recovery, clear deletion confirmation
   and blockers; responsive layout and keyboard/focus checks in both languages.
6. VERIFY: disposable lifecycle/role/performance races and FK boundaries; existing
   staff creation/invitation/roles, Auth/MFA, Web/Worker, Contact, Sales/Management,
   Finance/Commission and current-schema Revenue regressions. Render/email and affected
   browser QA; contracts, typecheck, lint, build, privacy and migration hashes.
7. CLOSE: document exact scope/results/blockers in V336_VERIFICATION.md. Only if all
   modules pass, promote canonical version metadata to 3.36.0, create release notes,
   recheck affected release gates and make the authorized checkpoint commit.

Expected schema allocation begins at the next repository identifier, currently 128.
Use separate append-only migrations if that improves independently reviewable domain
boundaries. Do not add migrations for email layout alone.

## Implementation decisions

The confirmed clarification is sales-reporting participation. SUPER_ADMIN may configure
their own participation; ADMIN may configure their own and ordinary workspace staff's
participation. Neither operation assigns a system role or Revenue designation. Explicit
Sales function and an active team are still prerequisites for qualification.

Three migrations separate cleanup (128), access profiles (129) and reporting metadata
(130). Existing approved allocation scopes preserve approved/closed period history;
new qualification is today/future only. There is no inferred eligibility backfill.
Company management totals remain independent of the qualified personal sales report.

Catalog audit identified one missing legacy uploaded-receipt actor FK. A forward-only
NOT VALID constraint enforces new references without guessing historical data. Cleanup
uses identity/outbox row locks, not broad table locks. Finite command-specific role
extensions retain Contact/source predicates and narrower approver checks.

Final review also revalidates actual transactional administrator role for create/resend;
an ordinary administrator cannot resend a privileged account's temporary credentials.
These are bounded authorization fixes, with stale-role and resend tests. Final results
and operational limitations are recorded in V336_VERIFICATION.md.

Final cleanup review also distinguishes a user's own preference-edit audit from real
business-operation audit: the former is minimized during unused-account removal and
the latter still blocks removal. A real self-preference write/cleanup regression
verifies that natural identity audit does not permanently prevent test-account cleanup.

The final user clarification requires suspension before removal. Deletion eligibility
is recalculated from current links, never a permanent "had business" flag. Once current
links clear, historical audit alone permits login/profile removal with a disabled
anonymous UUID retained for audit. A purge marker and locked FK-reference guards prevent
reactivation/new assignments. Extend disposable tests and browser notices for this path,
then recheck affected Revenue/Commission, build and release gates before committing.
