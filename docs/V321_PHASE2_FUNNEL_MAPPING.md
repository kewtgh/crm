# Channel funnel mapping — v3.21 Phase 2

This mapping is frozen before migration 099. No second Lead, Opportunity, Account
pipeline or automatic stage inference is introduced.

| Business process | Canonical fact |
|---|---|
| Lead | Existing `leads`, SCHOOL subject references Organization |
| Key person engagement | Contact / intelligence + existing `crm_activities`; knowing a key person does not prove engagement |
| Solution design | Existing Opportunity + Account BD plan |
| Channel partnership | Existing Organization business-profile `partnership_stage` |
| Training / information session | Existing Education outreach event |
| Recruitment activation | Explicit human-confirmed partnership stage; Product/Cohort context stays in Opportunity/Event |
| Student conversion | Explicit PRIMARY/ASSIST Enrollment Attribution |
| Settlement | Future Commission domain, not implemented |
| Ongoing enablement | Explicit partnership stage + relationship/activities |

Current stages PROSPECT, CONTACTING, ACTIVE, PAUSED, ENDED remain valid. Add the
finite operational values KEY_PERSON_ENGAGED, NEEDS_QUALIFIED, SOLUTION_PROPOSED,
PARTNERSHIP_AGREED, RECRUITMENT_ACTIVATED, ONGOING_ENABLEMENT to the same field.
No old row is remapped. History starts only with explicit post-migration saves;
unknown pre-migration stage time remains unknown. Backward stage moves are legal.

Existing Lead lifecycle is NEW / QUALIFYING / QUALIFIED / DISQUALIFIED / CONVERTED.
Existing owner is required and defaults to the creator; 099 allows an unassigned
School pool Lead. Explicit PRIVATE / WORKSPACE_PUBLIC is independent of owner.
Available = public SCHOOL + no owner + nonterminal lifecycle. Claim never qualifies.
PRIVATE is the safe default for all existing records, including Household Leads.

Pool read and Claim reuse leads.view/manage roles and underlying Organization access.
Owner/team boundaries govern private Leads and operations. Manager visibility changes
and reassignment additionally reuse existing can_assign_crm_task scope. A public
Lead's assigned owner cannot be replaced by generic patch. Household behavior and
existing lead_conversions remain canonical; conversion never creates an Organization.

The activation view is read-only and counts independently authorized Lead, Contact,
Opportunity, Event and Enrollment Attribution facts. No notes or hidden contact
names are copied into pool projections. Enrollment counts do not imply revenue.

No deterministic open-Lead identity beyond the existing subject/pipeline contract
exists today. A new open-Lead unique constraint is deferred rather than rejecting
valid historical duplicates. Existing Imports has no LEADS resource; pool bulk
import is deferred, without creating another import system.
