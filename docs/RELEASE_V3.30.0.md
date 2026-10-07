# v3.30.0 — Core workspace presentation and interaction cleanup

## Record workspaces

Organization records use one locale-aware identity header and six local sections. Overview places
current opportunities, linked contracts, organization profile, background and recent follow-ups
alongside recorded business context, visible-record facts and quick navigation. Channels & Outreach
prioritizes cooperation stage, recorded next action, operating counts, current product/cohort context,
school profile and explicit contact/decision evidence. Secondary strategy and operational detail remain
available through disclosures and existing editors.

Contact Overview combines a compact profile, actual Household relationships and recent follow-ups with
communication restrictions and explicit consent records. It does not infer guardian authorization or
invent a universal privacy approval. Edit, follow-up and recoverable deletion retain their existing owners.

Student Overview combines canonical project participation, applications and support cases. Desktop uses
compact related-record tables; mobile presents the same priority fields as rows. Family context, actual
query totals, recorded support needs and recent Contact follow-ups remain identifiable. Journey groups
do not define a new Student lifecycle or infer completion of one domain from another.

## Shared presentation and navigation

Headers place the primary action before secondary actions and More. Destructive actions remain inside
the existing accessible menu and confirmation machinery. A shared Lucide vocabulary supplies consistent
decorative icons for workspace sections, metrics, attention and context; text continues to carry status.
Long bilingual identities retain current-locale primary and alternate-locale secondary presentation.

Customer communications becomes a primary visible destination. The family self-service portal stays
inside the communications workspace, with its existing route and access rules; it has no separate
sidebar or page-command entry.

## Bounded operational cleanup

Product actions reuse More without changing recoverable deletion. Existing Lead Queue action mapping
and filters are preserved. Academic correction previews the selected Student's actual grade and year
before opening the existing editor. Imports use one mounted tab control for record import, existing-record
relationships and Import Sets; download controls are compact, while upload, preflight, repair, execute
and rollback semantics remain unchanged.

## Boundaries and verification

No API, repository, mutation, permission, schema or migration change is introduced. Latest migration
remains 114 and all 119 opening SQL files remain unchanged. Activity still requires its existing bilingual
inputs. Contract/Payment, Product/Cohort, Student/Household and Commission/Revenue ownership stays separate.
Revenue policy analysis and implementation remain outside this release.

See [verification](UI_WORKSPACE_REDESIGN.md) for targeted tests and Chromium 1243 screenshots at 1920,
1440 and 375. Browser evidence uses actual React components, production CSS and fictional mocked APIs;
it does not prove database mutations or RLS. No Production validation or deployment is claimed.
