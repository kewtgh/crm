# v3.37.3 — Staff removal, editor spacing and branded email

## Staff account removal

A pending administrator invitation can be changed to Sales Director and have its
reporting qualification configured before the employee completes onboarding.
Previously, eligibility events from that administrative configuration were treated
as business references, permanently blocking removal even without business records.

Forward migration `202610180132_staff_reporting_identity_removal.sql` distinguishes
those events from current business references. After suspension, removal clears
credentials, sessions, profiles, memberships and invitations. Immutable eligibility
events retain a disabled, de-identified account/member reference. The reference is
excluded from reporting and cannot be reactivated or acquire new member links.
The confirmation dialog explains this retention.

Customer ownership, performance allocations, approved period scopes, financial
contributions and unknown dependencies continue to block removal. Existing MFA,
administrator protection, cross-workspace checks, exact receipt replay and
transaction rollback remain enforced. Removal still requires suspension first.

Changing only the role did not reproduce the failure; adding administrative
reporting configuration did. This establishes a reproducible defect without
claiming to have inspected any production account or its dependencies.

## Layout

The staff business editor overrode shared bordered-card padding with zero left,
right and top padding. Cards now use 20px internal spacing on desktop and 16px on
mobile. The additional-functions fieldset has its own padded border and legend.
Related role/removal dialogs retain shared dialog gutters. Review of the shared
card rules found no other equivalent zero-padding override; this was a scoped
layout review, not a full application visual audit.

## Email

Email Worker v3.8.14 uses `Ewaya CRM` throughout built-in templates and sender
display names, with the white-background logo from the configured web origin.
The provider timeout is eight seconds instead of fifteen, below the Web caller's
ten-second deadline. Privacy-minimized provider timing helps distinguish request
acceptance from later delivery. This timeout change does not fix downstream inbox
filtering. See [email investigation and verification](EMAIL_BRAND_AND_LATENCY_FIX.md).

## Validation and deployment

Targeted disposable-PostgreSQL lifecycle/reporting checks cover the reproduced
failure, unchanged immutable history, removed-identity guards, report/export
parity, actual business-reference protection, concurrency and atomic rollback.
Component browser checks exercise fictional API responses; they do not claim
real production account deletion or real inbox delivery.

Final checks passed under Node.js 24.22.0: 231 targeted tests, the bounded
disposable-PostgreSQL lifecycle/reporting scenario, typecheck, zero-warning
changed-file lint, one production build, migration verification and 14 public
privacy/artifact tests. Chromium revision 1248 passed 12 staff-management
page/viewport checks with zero errors or warnings. Six earlier email-layout
checks cover the unchanged final email renderer. Private staff QA evidence is
under `work/browser-qa-chromium-1248/v3373-final/`.

Apply the forward migration and deploy the CRM application for the removal and
layout changes. Deploy the independent email Worker separately for email branding
and timing changes. A web-only deployment does not update email templates.
