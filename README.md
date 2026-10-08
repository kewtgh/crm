# Lumina CRM

Current release candidate: **v3.35.1**

## v3.35.1 — Follow-up input and workspace refinements

Next-action fields offer bilingual suggestions alongside editable text, preserving existing
content and canonical storage. Revenue headings avoid duplicate icons; communication tabs
match the workspace icon. Student placement correction uses a compact responsive layout.
No database, authorization or financial-semantic changes.

See [release notes](docs/RELEASE_V3.35.1.md).

## v3.35.0 — Unified workspaces and purchaser clarity

Every authenticated navigation destination has a semantic icon. Workspace headings,
section markers, tabs and summaries share a responsive, domain-colored visual system.
Student support adds accessible trend/distribution charts; finance separates personal
purchasers from institutions and their representatives, with per-currency settlement charts.
Personal purchases use quote-to-contract conversion; student filters remain student-only.
Financial recognition and commission accounting semantics are unchanged.

See [release notes](docs/RELEASE_V3.35.0.md).

## v3.34.0 — Workspace density, workflows and Contact access

Compact activity timelines, Lead rows, Revenue empty states and agreement sections reduce
scrolling. Workflow templates use an ordered navigator with one selected step editor.
Contact visibility follows ownership, explicit sharing and the same-department reporting chain;
communication consent remains independent. Families create independent parent/guardian people
atomically. Staff role changes use guarded, audited commands with exact-request recovery.
Revenue and Commission accounting semantics remain unchanged.
See [release notes](docs/RELEASE_V3.34.0.md), [audit](docs/FIRST_PRINCIPLES_AUDIT_V334.md),
[plan](docs/FIRST_PRINCIPLES_PLAN_V334.md) and [verification](docs/V334_VERIFICATION.md).

## v3.33.0 — Operational identity, usability and recovery

Students and family members can be created in their own workspaces. New native business numbers
are allocated atomically, while historical and explicit imported identifiers remain compatible.
Bilingual import headers, two editable admissions presets and product draft copying reduce setup.
Archived institutions no longer inflate the actionable opportunity Pipeline. Management charts and
empty-channel overview handling, shared navigation/pagination and clearer operational sections
improve daily work. Exact-request recovery and safe report diagnostics clarify failure recovery.
No Revenue accounting rules or automatic posting behavior change.
See [release notes](docs/RELEASE_V3.33.0.md), [audit](docs/FIRST_PRINCIPLES_AUDIT_V333.md),
[plan](docs/FIRST_PRINCIPLES_PLAN_V333.md) and [verification](docs/V333_VERIFICATION.md).

## v3.32.0 — Revenue Foundation

Revenue policies and accepted service bindings connect reviewed fulfillment evidence to deterministic
candidates, independent review and manual posting. Immutable Revenue facts retain append-only
corrections. Cash custody/application remains separate from earned Revenue. The Finance Revenue
workspace and Contract tab expose governed actions and historical lineage with per-currency amounts.
Initial entity/authority provisioning remains controlled; no historical transactions are recognized
automatically. General ledger, tax, accounting FX, provider AP and attribution remain out of scope.
See [release notes](docs/RELEASE_V3.32.0.md) and
[integrated verification](docs/REVENUE_R5G_INTEGRATED_CLOSURE.md).

## v3.31.0 — Reliable operation recovery and directory context

Shared mutation recovery retains exact requests after response loss and distinguishes accepted saves
from failed refreshes. Deletion conflicts offer explicit reload/review. Organization and Contact
advanced filters survive URL navigation and browser history; loading, invalid data and filtered-empty
results remain distinct. Relation lookup and More keyboard interactions improve across consumers.
Current workspace/reliability tests join regular CI. No migration, new permission or Revenue work.
See [release notes](docs/RELEASE_V3.31.0.md), [audit](docs/FIRST_PRINCIPLES_AUDIT_V331.md) and
[verification](docs/V331_VERIFICATION.md).

## v3.30.0 — Core workspace presentation and interaction cleanup

Organization and Contact records use a single identity, compact business sections and a context rail.
Student Overview presents canonical participation, application and support records in compact tables
and summaries, with family context and recent follow-ups. Shared semantic icons and action hierarchy
improve record workspaces; customer communications is a primary destination with the family portal
kept inside it. Products reuse the shared More menu; academic correction previews current placement;
Imports use one keyboard-accessible workspace selector. No migration, new domain ownership or Revenue
implementation is introduced. See [release notes](docs/RELEASE_V3.30.0.md) and
[UI verification](docs/UI_WORKSPACE_REDESIGN.md).

## v3.29.0 — Operational deletion and compact workspaces

Recoverable cleanup now covers 44 business resource types, including unused channel drafts, with existing record permissions, precise conflict tokens and mutation receipts. Directory and operational filters use aligned compact desktop controls and mobile disclosure. Student academic correction is searchable; commission filtering runs before server paging; channel analysis and imports disclose secondary detail. Historical financial facts retain their formal cancellation/reversal workflows. Additive migration 114 leaves all previous migration bytes unchanged. See [release notes](docs/RELEASE_V3.29.0.md) and [verification](docs/V329_OPERATIONS_VERIFICATION.md).

Lumina is a bilingual, staff-only education relationship and sales CRM. Schools, contacts, parents,
students and household members are CRM business records; staff identities are stored in the
application-owned authentication schema.

Version 3.28.1 aligns the workspace-settings regression test with the shared navigation contract
and verifies its administrator-only visibility. Application behavior and security gates remain
unchanged. See [patch notes](docs/RELEASE_V3.28.1.md).

Version 3.28.0 organizes Lumina around user tasks and business context. Students, families,
enrollments, applications and support have explicit product locations. Organization records share
one Account Workspace; Lead handling uses a state-aware work queue. Executive and support analytics
prioritize attention, changes and key facts, while Dashboard puts today's work first. Shared patterns
improve wide desktop, standard desktop and mobile use. No new domain ownership, Revenue semantics
or migration is introduced. See [release notes](docs/RELEASE_V3.28.0.md) and
[release closure](docs/V328_RELEASE_CLOSURE.md).

Version 3.27.0 adds task-oriented navigation and contextual enrollment, protects unsaved edits,
fixes nested dialogs and isolates optional dashboard failures. Misleading campaign ROI has been
removed. See [release notes](docs/RELEASE_V3.27.0.md).

Version 3.26.0 improves business workflows and the interface: contextual organization editing,
student-centered family navigation, compact filters and automatic September academic progression.
Revenue remains outside this release. See [release notes](docs/RELEASE_V3.26.0.md).

Version 3.25.3 sanitizes public repository examples and reports, replaces private template-residue
literals with non-echoing digest guards, and publishes only an allowlisted CI result summary.
Contract bodies have owner publication authorization; production template approval and historical
privacy remediation remain separate. See [patch notes](docs/RELEASE_V3.25.3.md).

Version 3.25.2 pins the email worker's transitive sharp dependency to the patched version and verifies
its independent lockfile, preserving all three CI dependency audit gates. See [patch notes](docs/RELEASE_V3.25.2.md).

Version 3.25.1 repairs generated-job privacy helper packaging, the operations image's Node shared
library, and the import field-selection CI contract for v2 and legacy templates. See [patch notes](docs/RELEASE_V3.25.1.md).

Version 3.25.0 upgrades Data Import Operations with categorized XLSX/CSV templates, strict preflight,
canonical domain execution, authorized references, five relationship resources and bounded Import Sets.
Typed aliases, revision/receipt guards, exact decimals, blank/clear semantics and subject-aware private
evidence support repair/resume and guarded partial rollback. No automatic identity matching or arbitrary
Organization reassignment is introduced. See [release notes](docs/RELEASE_V3.25.0.md),
[release closure](docs/V325_RELEASE_CLOSURE.md) and [Import architecture](docs/IMPORT_OPERATIONS_ARCHITECTURE.md).

Version 3.24.1 restores the shared bilingual-name hint and combined name validation in the Channel
agreement editor, fixing the CI failure affecting the v3.23.0 and v3.24.0 commits. The agreement QA
fixture also mocks the embedded document workspace reads. See [patch notes](docs/RELEASE_V3.24.1.md).

Version 3.24.0 adds Contract Operations: typed DOCX template governance, APPROVED-only deterministic
generation, source-aware immutable lineage, private authorized downloads, external uploads, text DOCX/PDF
extraction and document-only human review. Canonical conflicts never permit CRM overrides. The real v1
templates remain DRAFT pending business/legal approval; no OCR, AI, e-signature or automatic SIGNED/financial
mutation is introduced. See [v3.24 release notes](docs/RELEASE_V3.24.0.md),
[release closure](docs/V324_RELEASE_CLOSURE.md) and [Contract Operations architecture](docs/CONTRACT_TEMPLATE_ARCHITECTURE.md).

Version 3.23.0 adds Management Intelligence in Reports: a permission-filtered Executive Overview
across six canonical domains, business-date trends, equal-length previous-period comparison,
Product/Cohort filters, canonical drill-down and a complete source-derived Attention queue.
Snapshot and period activity remain separate; money is isolated by currency and restricted values
remain distinct from zero. Management owns no business facts or mutations and provides source
context and navigation without scores, forecasts, Targets, persisted Alerts or AI.
See [v3.23 release notes](docs/RELEASE_V3.23.0.md),
[release closure](docs/V323_RELEASE_CLOSURE.md) and [Management architecture](docs/MANAGEMENT_INTELLIGENCE_ARCHITECTURE.md).

Version 3.21.0 adds Channel Intelligence and Decision Map, atomic Public Lead Pool assignment,
explicit Channel Activation, versioned Channel Agreements, immutable commission earnings/refund
reversals, separate settlements and permission-filtered Channel Analytics. Enrollment contribution
is not Revenue Attribution; commission exposure is not Channel Revenue. Shared contracts remain
unallocated and currencies separate. No Production business rules are seeded.
See [v3.21 release notes](docs/RELEASE_V3.21.0.md),
[release closure](docs/V321_RELEASE_CLOSURE.md) and [Channel architecture](docs/CHANNEL_COMMERCIAL_ARCHITECTURE.md).

Version 3.20.0 adds formal Enrollment 1:N Applications, independent status/decision,
Application-linked preparation Tasks, Admission Milestones and versioned sequential
Admissions Workflows. Tasks, Milestones and finite domain checkpoints remain canonical;
the timeline labels their sources. Existing Automation, Privacy and Data Quality support
these operations. No duplicate Finance system or Production workflow seed was created.
See [v3.20 release notes](docs/RELEASE_V3.20.0.md),
[release closure](docs/V320_RELEASE_CLOSURE.md) and
[Admissions architecture](docs/ADMISSIONS_ARCHITECTURE.md).

Version 3.19.0 connects Product → Cohort → Enrollment with attribution and lifecycle history,
commercial links, derived Finance, deterministic imports, quality findings, Task/Notification
automation and operational snapshots. Shared contract amounts are not duplicated or automatically
allocated; currencies remain separate. No duplicate Finance system was created. See
[v3.19 release notes](docs/RELEASE_V3.19.0.md) and [release closure](docs/V319_RELEASE_CLOSURE.md).

Version 3.18.2 aligns Worker heartbeat status pills to the right of their text and preserves
content-sized rounded backgrounds in both Worker and queue cards. Template/bulk email uses
three numbered, colored sections for template/language, recipients, and preview/confirmation,
with grouped recipient filters, selected-customer chips and bilingual template editor cards.

Version 3.18.1 refreshes application, Worker and planning-reference dependencies, Node/npm,
container images, BuildKit and GitHub Actions to current stable releases. The bounded local braces
fork addresses CVE-2026-93687; Prisma's vulnerable indirect dependencies use patched stable versions.
TypeScript 7 uses Microsoft's parallel TS 6 API compatibility package for lint tooling, and
ESLint 10 uses the official compatibility utilities. See [deployment versions](docs/DEPLOYMENT.md).

Version 3.18.0 adds a dedicated Bulk email tab in Customer communications with paginated historical
records, subject/content/customer/email search, combined purpose and delivery-status filters, and
links to the original conversations. Forward migration 090 identifies existing per-recipient bulk
message keys and preserves workspace/RLS read boundaries. Quality-rule cards use compact semantic
severity colors and place enabled/severity controls on one row. See [implementation status](docs/IMPLEMENTATION_STATUS.md).

Version 3.16.0 adds structured organization roles, family education needs, student foundation/bridge
pathways, school seminars/campus visits/study tours and school/partner family referrals. The new
Education business workspace links existing customer identities and provides actionable data-gap
and deadline advice. Forward migration 087 adds workspace-safe relationships, permission checks,
versioned idempotent saves and privacy lifecycle support. School/partner creation records classification
and no longer requires a curriculum. See [first-principles audit](docs/FIRST_PRINCIPLES_AUDIT_2026-10-02.md)
and [implementation plan](docs/FIRST_PRINCIPLES_PLAN_2026-10-02.md). Local implementation does not
backfill unknown business data or deploy to production.

Version 3.15.0 aligns region/tag/customer-type filters as fixed structured selections backed by
existing customer data. Family portal invitations gain bilingual presets, personal/admin-public
custom templates, recipient and record filters, expiry defaults and personalized copyable messages.
Secure links are substituted only in page memory; no automatic email sending. Apply forward
migration 086. See [implementation and verification](docs/PORTAL_TEMPLATE_PLAN_2026-10-02.md).

Version 3.14.1 guards out-of-order inbox reads and in-flight drafts, freezes bulk-email attempts
through unknown responses, and previews authoritative consent/privacy eligibility. Personal templates
remain private; administrators publish workspace public templates, which others can copy personally.
Template saves are versioned and idempotent, and confirmed archival preserves stored data. Apply
forward migration 085. See [audit, plan and verification](docs/AUDIT_PLAN_2026-10-02_ROUND2.md).

Version 3.14.0 adds recipient region/tag/type filtering and page-level bulk selection, six bilingual
email presets, multiple saved custom templates and an independent sending-language choice. Avatars
are normalized to bounded WebP thumbnails and displayed in the header. Rule controls, worker status
and the schedule page's double-month calendar are clearer; four import resources have complete
blank/example templates and field guides. Apply forward migration 084 for template storage and the
RLS-preserving recipient selector. See [UX plan and verification](docs/UX_FIX_PLAN_2026-10-02.md).

Version 3.13.1 repairs customer goal date filters, minimizes customer API responses, preserves
follow-up drafts and adds remaining-contact/deadline metrics. Bulk-email retries retain the original
preview language and request key; automation confirms event-wide execution and supports single-language
titles. Matching customer panels refresh after edits, and opportunity deep links respect record access.
No new migration or deployment change is required. See [audit and plan](docs/AUDIT_PLAN_2026-10-02.md).

Version 3.13.0 refreshes the UI with calm teal/slate styling, subject-specific customer details,
keyboard-accessible detail tabs, safer product actions and currency-separated price details. Suggestions
and automation share one final Operations entry with capability-filtered tabs and explicit guidance.
No new migration is required beyond the existing migration 083. See [UI audit and plan](docs/UI_AUDIT_PLAN_2026-10-01.md).

Version 3.12.0 adds customer-level follow-up goals, evidence-based relationship recommendations,
school/institution aliases, unified family and communication tabs, personalized template/bulk mail
with per-recipient consent and idempotency, and an authenticated HTTPS mail-relay adapter. Forward
migration 083 fixes contact creation/owner assignment and adds explicit family/customer contract
links. Mailbox OAuth and bidirectional sync still require a separate integration, not just credentials.

Version 3.11.1 restores the real implementation-status document to Docker verification inputs
through an exact allowlist, preserving strict release-metadata contracts and the minimal runtime
image. The CI workflow allowlist and production deployment behavior are unchanged.

Version 3.11.0 centers and widens all shared editors, formats monetary inputs without changing
submitted numeric values, provides currency/calendar choices, tag editors and visual receivable
installments, and accepts either a Chinese or English name. Forward migration 082 aligns legacy
bundle/automation name constraints. Required fields are visibly marked, dynamic import repairs use
the same controls, and CI checks release/lockfile alignment before dependency installation.
See the [form audit and implementation plan](docs/AUDIT_FORM_EDITORS_2026-10-01.md).

Version 3.10.1 fixes product-save timestamp validation without losing PostgreSQL microsecond
precision, distinguishes committed writes from failed catalog refreshes, and adds administrator
product deletion with super-administrator recycle-bin recovery. A forward migration hides deleted
products from the catalog and new sales while retaining historical references. Product unit and
isolated PostgreSQL 18.4 regressions, typecheck, targeted lint, and the application build passed;
remote deployment and browser acceptance remain pending. See the
[product repair and deployment notes](docs/PRODUCT_MUTATION_REPAIR_2026-10-01.md).

Version 3.10 adds a dedicated notification center with same-page synchronization, manual refresh,
and task-detail links, plus priority-task filters and row-specific import diagnostics. It hardens
notification mutations, asynchronous forms, user-isolated saved views, CSV/XLSX validation,
historical import repair, pagination failure handling, and API cancellation/session-refresh behavior.
QA now pins Playwright Core 1.63.0 and Chromium 1243; CI uses the repository PostgreSQL workflow,
and a forward migration validates the nine communication-delivery constraints. The two audit
reports and implementation records are in [round one](docs/AUDIT_2026-09-26.md) and
[round two](docs/AUDIT_2026-09-26_ROUND2.md). Their local QA evidence predates this version-only bump;
production deployment and the complete release matrix have not been run for this release.

Version 3.8 closes the shared-host isolation gap by moving every Lumina controller, Compose task,
builder and maintenance command to a dedicated rootless Docker user service. Deployment gates
verify the exact user socket, rootless security mode, systemd cgroups and a Lumina-only data root.
It also verifies each encrypted database backup with its matching encrypted local-object archive,
replaces the public Worker gateway with Cloudflare Tunnel to a loopback-only Caddy listener, fixes
the Compose disk monitor and secure sign-out flow, removes stale deployment code, and trims the
runtime image to required scripts.

Version 3.8.30 makes remembered login a server-owned session property: administrators retain a
session for at most 15 days and other staff for at most 30 days, while non-persistent sessions keep
the 12-hour boundary. It also resolves the CI dependency gate with patched transitive pins and a
bounded metadata-image compatibility layer that rejects vulnerable ICNS/JXL/HEIF parsing without
weakening `npm audit`.

Version 3.8.29 makes the management submenu use a same-tab document navigation boundary. This
avoids the unreliable cold client-RSC transition that could make a first submenu click appear inert
until the route had been opened in another tab, while preserving standard modified-click behavior.

Version 3.8.28 separates Worker container liveness from operational queue degradation and release
acceptance. Docker health still requires current schema, database access, and complete fresh Worker
heartbeats, while retryable/stuck job counts remain visible through degraded loopback readiness and
Operations. Deployment captures a sanitized pre-switch queue baseline and rejects only newly
increased failed jobs or unsafe infrastructure/stuck-work conditions; accepted pre-existing failures
produce a stable warning without rollback. Recovery uses the same infrastructure contract.

Version 3.8.27 fixes the staff-invitation delivery protocol boundary. Invitation delivery IDs and
encrypted credentials remain local to the CRM Worker, while the external Email Delivery Worker
receives an explicit seven-field template payload with the temporary credential decrypted only at
delivery time. Producer/consumer contract tests prevent template-schema drift, and bounded
allow-listed remote error codes improve diagnostics without retaining provider response text.

Version 3.8.26 introduces a stable production bootstrap that updates the source and starts a fresh
target-controller Node process before any release work. It also performs bounded, Lumina-labeled
post-acceptance BuildKit, paired-image, deployment-history, and stale-env cleanup without touching
volumes or other Docker projects. The same release makes staff-account governance usable on mobile,
adds server-side lifecycle and role filters, completes action-menu keyboard focus, and brings the
README into the enforced release-version contract. Versions 3.8.20–3.8.25 hardened target-runtime
preflight, application image closure, staff-account confirmations, invitation RLS, atomic Web/Worker
release switching, and deployment-request finalization.

Version 3.8.19 preserves successful asynchronous staff-account creation, adds durable invitation resend delivery, role-specific session retention, and safe staff action menus. Version 3.8.18 separated strict pre-authentication origin checks from authenticated Session CSRF,
so stale browser Session Cookies cannot block CAPTCHA verification, sign-in, SSO, device verification,
or password recovery. It also distinguishes unavailable CAPTCHA configuration from an administrator
disabling Turnstile and aligns authentication Cookie deletion attributes with issuance.

Version 3.8.17 adds bounded automatic cleanup of the fixed Lumina BuildKit cache after every image
build sequence, including failed builds. It preserves the configured retention, maximum, reserved,
and minimum-free-space limits without invoking global Docker prune or deleting accepted images.

Version 3.8.16 preserves the Phase 2 communication-delivery ownership switch and fixes staff-account
creation so a committed account is never deleted or reported as a form failure merely because the
invitation email response is ambiguous. The create dialog closes after acceptance, the account appears
immediately as awaiting email confirmation/first sign-in, and an unconfirmed delivery receives a
specific non-destructive notice.

Version 3.8.15 made the dedicated `COMMUNICATION_DELIVERY` Worker the sole owner of external
communication email delivery. Web requests now return durable queued state without recipient lookup
or provider I/O; fenced Worker attempts use bounded concurrency, stable provider idempotency,
conservative uncertainty recovery, independent heartbeat/readiness, and asynchronous UI status.
The v3.8.14 database expansion and legacy Web credentials/RPCs remain for one rollback release.

Version 3.7 moved production to the fixed `lumina-crm` Docker Compose project. PostgreSQL, Web,
Worker, migrations, encrypted backup/restore, commit-tagged image release, application-only
rollback, and Lumina-only cleanup have explicit container and credential boundaries. HunterAI and
Temporal resources are never shared or managed by Lumina.

Version 3.5 closed the organization-wide business-date architecture gate. Each workspace now has a
constrained, audited business timezone that administrators can change only with AAL2; user and
workspace-scoped Worker transactions apply it locally so existing PostgreSQL date rules agree.
Contract countdowns use the same business date. Pending mutation drawers cannot be dismissed through
Escape, overlay, close or cancel controls; legacy timestamps use personal display preferences; and
the task priority queue reports when its 12-item summary is truncated and links to the full list.
Administrators can also switch Cloudflare Turnstile off for constrained networks; sign-in, SSO and
password recovery then enforce the self-hosted ALTCHA verifier instead of bypassing CAPTCHA.
The production runtime remains designed for one shared VPS:

```text
configured public hostname
  -> Cloudflare Tunnel
     -> Caddy 127.0.0.1:3211
        -> Web 127.0.0.1:3200
           -> Compose Web / Worker / private PostgreSQL
```

The application has no managed-platform SDK or API dependency. It uses separate application,
system, Worker, migration and backup database roles. Authentication uses Argon2id passwords,
opaque server-side sessions, HttpOnly cookies, CSRF protection, encrypted TOTP secrets, replay
prevention, recovery codes, email verification, password reset, trusted devices, OIDC SSO and SCIM.
Database Row Level Security remains enabled as defense in depth, with the user and workspace context
set by the application.

Files are stored through a local-persistent/S3-compatible abstraction. PostgreSQL migrations are
ordered, checksummed, protected by an advisory lock and kept under `db/migrations`. Production
PostgreSQL publishes no host port and joins only the internal Lumina backend. Daily encrypted
backups go to an independent object store;
monthly restore verification creates and destroys only a uniquely named temporary database.

## Local development

Requirements:

- Node.js 26.x (`26.10.0` is pinned in `.nvmrc`);
- npm 12.x (`12.2.0` is pinned in `package.json`);
- Docker Desktop.

```bash
npm install
npm run env:configure-local
npm run dev
```

`env:configure-local` starts PostgreSQL 18 on `127.0.0.1:55432`, creates the least-privilege roles,
applies all migrations and bootstraps the local administrator. It preserves unrelated local
integration values, removes retired platform keys and never prints generated secrets.

Useful database commands:

```bash
npm run db:migrations:verify
npm run db:migrate
npm run db:smoke
npm run smoke:phase2
npm run smoke:v09
npm run smoke:v11
```

Run the enabled queue processors once:

```bash
npm run workers:process
```

Independent Worker categories run in parallel. `WORKER_JOB_CONCURRENCY` limits work inside each
category to 1–8 jobs (default 4); the runtime also validates each batch/concurrency combination
against a 210-second external-I/O budget. `WORKER_DATABASE_POOL_MAX` is a per-process ceiling, so
capacity planning must account for all enabled categories. Mail providers must honor the stable
`Idempotency-Key` header before production delivery is enabled.

Production email delivery is isolated in
[`infrastructure/email-delivery-worker`](infrastructure/email-delivery-worker/README.md). The
generic Cloudflare Worker is developed and tested on Windows, but Windows never stores its real
name, domain, URL, sender, Cloudflare account ID/API token, or any production Env and never performs
a production Wrangler deployment. Ubuntu alone stores production deployment configuration at
`/etc/lumina-crm/secrets/email-worker-deploy.env`, pulls the audited commit, runs the explicit
dry-run, deploys the existing Worker in place, and checks only its health endpoint. The tracked
Wrangler configuration contains no Worker name, domain, route, account ID, sender, or production
URL. Both workers.dev and Preview URLs are disabled. Routine strict deployment derives its sole
Custom Domain from the Ubuntu server-local Env, verifies through the read-only Domains API that it
already belongs exclusively to the target Worker, and renders the complete name/route/vars/
Observability contract into a mode-0600 temporary JSON under a mode-0700 runtime directory.
Dashboard remains available for initial domain creation, inspection, and emergency rollback. The
existing `LUMINA_WEBHOOK_TOKEN` and `RESEND_API_KEY` values remain remote-only and are never read or
changed. Sanitized Wrangler failures retain a bounded diagnostic tail while all server-supplied
deployment values remain redacted. CRM application initialization and email Worker deployment are
separate stages.

## Verification and deployment

For a bounded repository check:

```bash
npm run typecheck
npm run lint
npm run test:contracts
npm run test:deploy
npm run build
```

The repository also includes the pinned `ms-playwright/chromium-1243` browser workflow. Run only the
phase relevant to a scoped change, or the staged matrix when preparing an authorized release.

On a new Linux VPS, first run the explicit persistent initialization mode. It adds repeat-safe
database role/extension and initial-admin bootstrap around the forward-only migration, then records
the first accepted release with no rollback image. Ordinary deploy refuses to run before this
accepted state exists and never invokes either bootstrap step.

Production deployment is a two-stage control plane. A long-lived-protocol bootstrap performs the
single source fast-forward and then starts a fresh Node process from the target commit. A controller
never deploys a release after mutating its own source tree.

```text
stable bootstrap: lock -> validate request/source -> fetch -> exact target SHA -> ff-only update
fresh target controller: source/commit TOCTOU verification -> release workflow
```

The target controller performs:

```text
target-controller re-exec and exact commit evidence
-> rootless Docker/state capacity gate
-> isolated Lumina BuildKit verification
-> metadata-only Compose secret-source permission gate
-> containerized checks and commit-tagged app/ops images
-> migration verification and locked forward migration
-> sanitized pre-switch queue-health baseline
-> Compose Web/Worker image switch
-> independent PostgreSQL/Web/Worker health
-> loopback release-health acceptance and Cloudflare Tunnel public liveness
-> persist accepted/rollback images
-> bounded Lumina-only BuildKit, paired-image, history, and stale-env cleanup
post-switch failure -> application-image rollback; database stays forward
```

Storage prepare, post-build cache cleanup, post-acceptance storage cleanup, and the deployment runner share
`/var/lib/lumina-crm/docker-config` as their only Docker client configuration root and
`/var/lib/lumina-crm/docker-config/buildx` as their only Buildx configuration root. The separate
`/var/lib/lumina-crm/storage-maintenance` tree retains only the builder ownership marker, reports,
and maintenance state. An obsolete configuration directory at that location is never adopted,
copied, or deleted automatically; its presence requires operator review. After a source
fast-forward, the audited maintenance program must be installed separately as the fixed root-owned
`/usr/local/libexec/lumina-crm-storage-maintenance.mjs` before first initialization or deployment.

Every accepted release triggers bounded cleanup of only the fixed `lumina-crm-buildkit`, exactly
labeled `kewtgh/crm` image pairs, and expired deployment history. Current, rollback, running, target,
and recent accepted images remain protected, with at least three complete releases retained.
Volumes are never automatically pruned. Generic Docker system/image/container/volume/network prune
commands are prohibited. Cleanup failure is warning-only and never changes application acceptance
or triggers rollback.

The configured Git proxy, when present, is used for the first and only fetch; otherwise that single
fetch is direct. It is never persisted as Git, Docker, or systemd configuration. Containers clear
proxy variables. Database migration is forward-only; application rollback never claims to reverse
an applied schema migration.

Hosts that require a separate proxy for image construction can set the optional server-local
`LUMINA_DOCKER_PROXY`. It is validated as a credential-free HTTP(S) URL and is exposed only to the
isolated BuildKit container and the three `buildx build` processes. The fixed builder uses
`network=host` inside Lumina's rootless Docker/RootlessKit network namespace so it can reach the
same host-loopback proxy entry as the rootless daemon; this is not the physical host/rootful Docker
network and never connects to HunterAI resources. Git continues to use only
`LUMINA_GIT_PROXY`; Compose services, migrations, health probes, and runtime containers remain
proxy-free. Logs and deployment state redact the configured Docker proxy, while the builder marker
stores only its enabled state, SHA-256 fingerprint, and non-sensitive `host` network contract.

```bash
npm run deploy:production:dry-run
npm run deploy:production:initialize
npm run deploy:production
npm run deploy:production:status
npm run deploy:production:logs
npm run deploy:production:rollback
```

See the current [deployment runbook](docs/DEPLOYMENT.md),
[backup/restore runbook](docs/BACKUP_RESTORE.md), [rollback runbook](docs/ROLLBACK.md), and
[implementation status](docs/IMPLEMENTATION_STATUS.md). Versioned v3.6 and earlier deployment audits
are historical/obsolete for production provisioning. The PostgreSQL transition history remains
in the [migration audit](docs/SUPABASE_EXIT_AUDIT_AND_TARGET_ARCHITECTURE_2026-07-29.md) and
[completion and gap review](docs/POSTGRESQL_MIGRATION_COMPLETION_AND_GAP_REVIEW_2026-07-29.md).

## Health

- `GET /api/health` checks Web process liveness and release version.
- `GET /api/health?mode=ready` is loopback-only and reports environment, authentication schema,
  database, Worker and queue status independently with stable reason codes for local deployment
  probes. Failed or stuck jobs keep this endpoint degraded even when Docker Worker health is healthy.
  Public requests receive only the minimal liveness endpoint.

External providers remain disabled until genuine credentials and data-processing approval are
supplied. The UI does not present a simulated provider connection, delivery, Worker heartbeat,
backup or security state as real.
