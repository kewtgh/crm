# v3.34 implementation audit

Opening baseline: v3.33.0, checkpoint `0af04c7`, logical migration 123, 128 SQL files. Opening raw evidence and fingerprints are private under ignored `work/v334/`. No production access. Historical Revenue artifacts remain protected.

## Contact access: repository evidence

1. **Who reads Contacts?** The SELECT policy in migration 007 calls `can_access_owned_record`. Active workspace members qualify through ownership, a direct reporting relationship, an explicit `record_collaborators` grant, or the ADMIN/SUPER_ADMIN/SALES_DIRECTOR role bypass. Application capabilities are an additional route boundary; they do not replace database predicates.
2. **Does owner affect visibility?** Yes: `contacts.owner_id` participates in the database predicate. Owner is not a communication consent field.
3. **Management hierarchy?** Yes: `sales_team_members.manager_member_id` is an authoritative self-reference, introduced in 007. Current access checks only a direct report, not the complete upward chain. Team membership in 075/076 is a different relationship and must not be interpreted as management.
4. **Administrative bypass?** Yes, the existing common predicate explicitly admits ADMIN/SUPER_ADMIN/SALES_DIRECTOR. This is broader than the requested Contact policy. Contact-specific enforcement must remove this accidental override without changing other domains' access semantics.
5. **Organization-linked Contacts workspace-visible?** Not inherently through the Contact SELECT policy: organization linkage is not one of its alternatives. However, security-definer organization projections require a separate review because they can bypass Contact RLS. Organization access must not become Contact access.
6. **Consent purpose?** `contact_consents` is a communication permission/current-state projection, not a record-sharing owner. It is unique per workspace/contact/channel/purpose. `save_contact_consent` currently upserts that projection; a consent-history view cannot truthfully call these rows an append-only history. Global DND is on Contact. Consent read policy delegates to Contact access.
7. **Potential leak paths?** Changing React alone leaves Contact table/search/counts, `organization_contact_directory`, `customer_subject_access`, `customer_timeline`, customer operations projections, household member joins, student identity joins, lead key-contact projections, imports/duplicate matching, exports and communication helpers unchanged. Security-definer readers must explicitly apply the new Contact predicate; invoker queries need restrictive RLS across link tables as well as Contacts. The current `contact_channel_allowed` checks workspace/DND/consent but does not itself require record visibility. Real outbound runtimes call this helper (migrations 064, 070, 071 and 084), so this is not merely a display concern.
8. **Parent facts on Household?** Yes. `primary_parent_occupation` and `secondary_parent_occupation` are exposed by `HouseholdsWorkspace` and the import contract. They cannot be safely assigned to particular people by a guessed backfill. New entry must store each parent's occupation on that person; legacy unattributed values must remain explicitly legacy until reviewed. Membership and guardian authorization remain separate.
9. **UI-only changes?** Organization timeline, Lead arrangement, bounded Revenue empty states, Agreement navigation, selected-step template editing, Contact commercial/follow-up density, and Outcomes hierarchy can retain existing commands and domain values. Task-title inheritance can be normalized before existing template validation; it does not change runtime task ownership.
10. **Migration needs?** Contact hierarchy/read/edit/share enforcement and secure consent history require database changes. Atomic multi-person Household creation with receipt protection and person-specific occupation storage also requires a bounded runtime/schema extension. No financial migration or owner is justified by layout work.

## UX and reliability findings

- `app/operations-usability.css` colors entire timeline cards, weakening hierarchy. `customer-360-page.tsx` already supplies event types, dates and navigation; use these rather than inventing events.
- `lead-pool-workspace.tsx` has actual qualification counts and actions. Preserve those semantics while compacting the shared record layout.
- `revenue-workspace.tsx` renders non-ready states as a bare paragraph. Presentation can explain controlled provisioning without adding a financial command.
- `channel-agreements-panel.tsx` nests version rules and document controls. Separate overview, rules, evidence and history; retain existing approval/version commands.
- `workflow-template-editor.tsx` renders every step's complete form. Its exact retry payload and accepted-save refresh-only state must survive a navigator/editor redesign. Existing presets are blueprints, never completed tasks.
- `contact-workspace.tsx` and `customer-operations-panel.tsx` have canonical business and follow-up data; compact read views and collapsible editors can reuse it.
- `ContactConsentPage` currently displays current consent records as history and lacks the newer receipt pattern. Both terminology and mutation reliability need correction.
- Household creation is currently a separate request from member creation. Composing browser requests is insufficient for atomic multi-parent creation.
- `SuccessOutcomesPanel` always renders paging controls, including an empty first page.

## Implementation constraints

No role-name-derived hierarchy, automatic admin Contact access, consent-derived sharing, financial semantic changes, migration rewrites, production access or release promotion before verification. Schema changes must be tested against disposable PostgreSQL, including indirect name/count leakage. Browser fixtures and database verification must be reported separately.

## Subsequent user clarification

After this opening audit, the user explicitly retained administrator hierarchy: ADMIN above employees, SUPER_ADMIN with full permissions. The implementation plan now records that governance instead of removing all administrator access. Opening findings above describe v3.33 repository behavior, not the amended target policy. Workspace isolation and communication-consent independence remain unchanged.

## Added scope: staff role adjustment

The user additionally authorizes staff role adjustment. Existing `PATCH /api/admin/users/[id]` accepts role updates, but the staff list exposes only team/status controls. `updateStaffUser` checks a previously read actor/target then writes through a system connection; it has no request receipt or expected-role concurrency guard. The legacy identity preparation RPC is system-only and does not represent the active native authentication path. Therefore a UI selector alone would leave a stale-authority race.

Implement a purpose-specific, AAL2-protected database command that locks current memberships, rechecks actor and target roles, preserves audit/receipt atomicity and revokes target sessions. ADMIN can change employee roles only; only SUPER_ADMIN can assign ADMIN/SUPER_ADMIN or change a privileged target. Keep at least one active SUPER_ADMIN in the workspace. Role changes do not create business authority assignments or reporting relationships. Existing status operations retain their separate semantics.
