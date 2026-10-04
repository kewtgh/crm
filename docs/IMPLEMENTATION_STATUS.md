# Implementation status — v3.22.0 release candidate

## v3.22 Student Success

**V322_RELEASE_READY — COMMIT READY**. All bounded release gates pass.

Enrollment-scoped Cases, Goals and real CRM Task relationships support independent delivery
operations. Actual Check-ins, append-only human Health Assessments, confirmed Risk Signals,
independent Interventions and explicit Outcomes retain separate canonical meanings. Read-only
Analytics uses visible Cases, current snapshots and business-date period activity with
Product/Cohort comparison and the explicit Goal attainment denominator. No automatic Health,
Risk or Outcome inference, whole-student Success Rate or numeric scoring is introduced.

Bounded Phase 4 release validation and candidate reconciliation are recorded in
[release closure](V322_RELEASE_CLOSURE.md). See [release notes](RELEASE_V3.22.0.md) and
[Student Success architecture](STUDENT_SUCCESS_ARCHITECTURE.md). Current release metadata
is 3.22.0; historical phase-development versions below remain unchanged. The candidate is
unstaged and uncommitted; no push, deploy or Production access.

## v3.21 Channel Commercial Management

**V321_RELEASE_READY**. All bounded release gates pass. The user authorized the local
v3.21.0 Git checkpoint after correcting the requested version. No Production access.

Phase 1–4 form a candidate combining Channel Intelligence/Decision Map, explicit Public
Lead assignment and activation, versioned agreements and immutable commission/settlement
records, plus read-only Channel Analytics. Current snapshots and period metrics remain
distinct. Tenant/subject/money permissions and privacy retention are preserved. No Revenue
Attribution, Channel Revenue/ROI or FX is inferred. The release checkpoint includes the
validated Phase 1–4 candidate; no push, deploy or Production access. Final gates are recorded in
[release closure](V321_RELEASE_CLOSURE.md), [release notes](RELEASE_V3.21.0.md) and
[Channel architecture](CHANNEL_COMMERCIAL_ARCHITECTURE.md).

Historical phase development evidence follows.

## v3.22 Phase 1 — Student Success development

Explicit Enrollment-scoped Success Cases, human-confirmed delivery status, outcome Goals,
existing CRM Task links and Case status history extend delivery operations. Academic
Records, Progression, Admissions, Finance and Channel Commission remain canonical and
independent. See [Student Success architecture](STUDENT_SUCCESS_ARCHITECTURE.md) and
[Phase 1 verification](V322_PHASE1_VERIFICATION.md). Current product version remains
3.21.0. Phase 1 remains the foundation for ongoing support.

## v3.22 Phase 2 — Student Success operations development

Occurred Check-ins, explicit append-only Health Assessments, manually confirmed Risk Signals
and independent Interventions extend Cases. Risk and Intervention lifecycle histories and
same-Case real CRM Task relationships preserve canonical facts. Health, Risk and support
states never synchronize implicitly. Permission-filtered projections, privacy cleanup and
five contextual quality rules extend the existing boundaries. See
[Phase 2 verification](V322_PHASE2_VERIFICATION.md) and
[Student Success architecture](STUDENT_SUCCESS_ARCHITECTURE.md). Version remains 3.21.0;
Outcomes, Success Analytics, automated workflows and AI remain deferred.

## v3.22 Phase 3 — Outcomes and Student Success Analytics development

Explicit retrospective Outcomes extend Enrollment-scoped Cases, optionally linked to a
same-Case Goal. Revision, retry, authorized voiding, privacy cleanup and minimal audit
preserve personal facts without duplicating academic or admissions records. Read-only
Analytics separates current snapshot and actual business-date activity, retains UNKNOWN
Health, and defines Goal attainment as Achieved / (Achieved + Not achieved). Hidden Cases
never contribute counts. No automatic Outcome, whole-student Success Rate or numeric score.
See [Phase 3 verification](V322_PHASE3_VERIFICATION.md) and
[Student Success architecture](STUDENT_SUCCESS_ARCHITECTURE.md). Version remains 3.21.0;
v3.22 release promotion remains a separate Phase 4 task.

## v3.21 Phase 3 development checkpoint

Versioned Channel Agreements and explicit fixed/net-collected Rules extend Organization
commercial operations. Eligibility reads canonical Enrollment Attribution and Finance;
shared contracts remain unallocated. Immutable commission earnings/refund reversals and
separate whole-entry, single-currency settlements preserve source history. Configuration,
money visibility and settlement permissions reuse existing capabilities. Privacy retains
financial records while clearing personal references. No customer Finance facts are copied
or rewritten. Version stays 3.20.0; no commit, push, deploy or Production access.
See [commission contract](V321_PHASE3_COMMISSION_CONTRACT.md),
[Channel architecture](CHANNEL_COMMERCIAL_ARCHITECTURE.md) and
[Phase 3 verification](V321_PHASE3_VERIFICATION.md).

## v3.21 Phase 2 development checkpoint

Public SCHOOL Lead Pool, atomic claim/release/reassign with assignment history,
reason-bearing partnership stage changes/history, and a permission-filtered Channel
Activation projection extend existing Lead/Organization/Education domains. Claim does
not qualify; Events and attributed Enrollments never implicitly advance partnership.
Automation reuses TASK/NOTIFICATION and contextual data-quality warnings reuse the
existing quality engine. Version remains 3.20.0; Phase 1 and Phase 2 remain separately
recoverable local deltas. See [Phase 2 funnel mapping](V321_PHASE2_FUNNEL_MAPPING.md),
[Channel architecture](CHANNEL_COMMERCIAL_ARCHITECTURE.md) and
[bounded verification](V321_PHASE2_VERIFICATION.md).
Channel Agreements, Commission, Revenue/ROI, Sales Targets, AI and automated research
remain deferred.

## v3.21 Phase 1 development checkpoint

Channel Account Intelligence & Decision Map is implemented on the committed v3.20.0 baseline.
Version remains 3.20.0. Organization commercial tiers/potential/strategy, school profile gaps,
school-level admissions outcomes, Contact intelligence and same-Organization relationships
reuse current master identities and access. Unknown values remain distinct from zero/D.
See [Channel architecture](CHANNEL_COMMERCIAL_ARCHITECTURE.md) and
[bounded Phase 1 verification](V321_PHASE1_VERIFICATION.md).
Phase 2 extends this foundation with Lead Pool and Channel Activation. Pipeline redesign,
Commission, channel revenue/ROI and AI remain future scope.

## v3.20.0 scope

Formal Enrollment 1:N Applications keep lifecycle status independent of decisions;
Application-linked Tasks preserve legacy generic checklist behavior. Enrollment-level
Milestones optionally bind a consistent Application and preserve operational history.
Versioned, human-configured sequential Workflows explicitly select Template + Version
and context. Real Tasks/Milestones remain canonical; finite checkpoints evaluate domain
facts. The timeline identifies APPLICATION, MILESTONE and WORKFLOW sources.

Existing Automation, Data Quality and Privacy domains support Admissions. Workspace,
owner/team, Enrollment and optional Application access remain enforced. Used template
versions are immutable; missing Application context fails atomically. No duplicate
Finance system, automatic Enrollment workflow start or Production workflow seed exists.
Legacy admission_journeys remains unchanged compatibility data without automatic sync.

See [v3.20 release notes](RELEASE_V3.20.0.md),
[release closure](V320_RELEASE_CLOSURE.md) and [Admissions architecture](ADMISSIONS_ARCHITECTURE.md).
Release verification passed on Node 26.10.0 / npm 12.2.0: clean npm ci, frozen
migrations 091–097, 66 domain tests plus 2 metadata tests, eight bounded local PostgreSQL
groups, typecheck, 67-file scoped lint, one production build and 22 affected Chromium
1243 groups (zh-CN/en, 1440/375). Browser components use mocked business APIs;
PostgreSQL separately verifies real RLS and transactions. Source is COMMIT READY.
Local evidence remains Git-ignored under work/v320-release and the affected-browser path.
No production access, push or deploy. Documents, Commission, Student Success, P&L,
Management Intelligence, AI, complex BPMN, Cohort default workflows and Finance checkpoints
remain deferred. Formal business template configuration requires business confirmation.

## Previous v3.19.0 scope

Phases 1–4 implement Product → Cohort → Enrollment, PRIMARY/ASSIST attribution, canonical
operational status history, Opportunity/Event/Quote cohort context and historical Contract links.
Operational support extends the existing Finance, Import, Data Quality and Automation domains.
Financial values are derived, grouped by currency; shared contracts remain unallocated and are
excluded from attributed Enrollment totals. No duplicate Finance system was created.

Release closure reconciled all four phase manifests and froze forward-only migrations 091–094.
Actual portable Node 26.10.0 / npm 12.2.0 passed clean npm ci without dependency changes,
72 targeted tests, five disposable PostgreSQL groups, typecheck, scoped lint, production build
and four affected Chromium 1243 phases (1440/375, Chinese/English). Browser tests use actual
components/production CSS with business API fixtures; database security/atomicity is tested
separately. Evidence remains ignored under work/v319-release and the affected-browser directory.
See [release notes](RELEASE_V3.19.0.md), [closure](V319_RELEASE_CLOSURE.md) and
[architecture](COHORT_ENROLLMENT_ARCHITECTURE.md). No production access, push or deploy.

Applications, Milestones, Visa/I-20 workflow, Workflow Templates, Commission, Student Success,
Product P&L, Management Intelligence and AI are deferred. They are not v3.19 features.

## Previous v3.18.2 scope

Worker heartbeat badges occupy the right column, centered against the adjacent text block.
Queue and Worker icon selectors exclude status badges, whose rounded backgrounds grow with
their text and retain horizontal padding. Template/bulk email is organized into numbered blue,
teal and amber sections for template/language, recipient selection, and preview/confirmation.
Recipient search, filters, selected-customer chips and pagination are grouped; template content
has a collapsible preview and the editor separates settings and Chinese/English content.
The draft lock and immutable batch/retry behavior remain in place.

Typecheck, scoped lint, 35 communication/UI regression tests and the final production build passed.
Chromium 1243 passed six Worker/queue checks (Chinese/English at 1440, 375 and 320 px) and four
email-layout checks (Chinese/English at 1440 and 375 px). The latter covers section colors, template
content/language, recipient filtering, bilingual editor cards, personalized previews, locked drafts,
immutable retries and new-batch reset. Screenshots were visually reviewed. Queue/worker metrics
and email API responses are fixtures; no emails were sent or database identities created.
Evidence remains Git-ignored under `work/browser-qa-chromium-1243/ui-v3182-workers/` and
`work/browser-qa-chromium-1243/ui-v3182-email/`, with v3.18.2 and the pre-commit worktree recorded.
The temporary QA server was stopped; no full browser matrix or database suite was run.

## Previous v3.18.1 scope

All three npm manifests and lockfiles, Node/npm pins, PostgreSQL/Node base images, GitHub Actions,
the Dockerfile frontend and the new BuildKit builder image are refreshed to stable releases as of
2026-10-03. Host-managed Docker/Caddy/cloudflared versions are documented in DEPLOYMENT.md; no
host packages or deployed services are changed by this repository update. Prisma remains at stable
7.10.0, with deepmerge-ts 8.0.2 and mysql2 3.24.5 overrides for its vulnerable indirect dependencies.

The local MIT-licensed braces fork bounds parsing and AST recursion to prevent CVE-2026-93687 stack
exhaustion, retaining normal glob/range behavior. Local file dependencies are packed with their child
dependencies and copied into both Docker dependency stages before installation. The now-unused
image-size shim is removed. CI's moderate audit gate remains enabled without advisory suppression.

TypeScript 7.0.2 supplies `tsc`; Microsoft's `@typescript/typescript6` 6.0.2 compatibility package
supplies the API required by typescript-eslint. The official ESLint compatibility wrapper restores
RuleContext APIs for the React/import/a11y plugins included by the current Next config.

Verification on portable Node 26.10.0 / npm 12.2.0: clean `npm ci`, TypeScript 7 typecheck,
ESLint 10 lint, one production build, 87 dependency/deployment/runtime tests, 185 Worker tests,
and 38 affected feature/rendering tests passed. All three npm audit reports contain zero
vulnerabilities; CI now audits all three lockfiles with its existing moderate threshold.
The fixed BuildKit image also passes focused deployment checks and missing/old/unpinned images
are rejected. No deployment or host-package installation was performed.

Production asset validation passed for 26 CSS/JS resources and five PNG assets. The QA fixture
scripts now discover CSS in nested static directories used by vinext 1.0. Chromium 1243 passed
desktop/mobile quality-rule and bulk-history checks on production CSS with mocked history data,
without sending emails or creating database identities. Evidence is Git-ignored under
`work/browser-qa-chromium-1243/dependency-upgrade/phases/ux-refinements/`; it records v3.18.1
and the pre-commit dirty worktree. The temporary QA server was stopped. Full database/browser
matrices and Docker image builds were not run; they remain optional deployment checks.

## Previous v3.18.0 scope

Customer communications adds a dedicated Bulk email tab, using existing durable per-recipient
message identities to show historical records and actual delivery states. Keyword search covers
subject, body, customer names and email; purpose and delivery-status filters combine with server-side
pagination. Each record links to its original conversation. Forward migration 090 adds a read-only
security-invoker query with workspace/member checks and existing table RLS; deployment must apply it.
Quality-rule cards use compact severity controls with blue/amber/red styling and an enabled/severity
row on desktop and mobile. Disabled rules use a muted card background.

Feature verification before the version bump: typecheck, scoped lint, 32 targeted Node tests,
production build and rollback-only PostgreSQL query checks passed. The database checks cover historical
bulk identity, literal keyword/body/email search, combined filters, pagination and explicit workspace/
authentication boundaries using the local migration role; they do not execute as crm_app. Chromium 1243
passed desktop/mobile component checks against production CSS, with the history API mocked and no
emails sent. Evidence remains Git-ignored under
`work/browser-qa-chromium-1243/quality-and-bulk-email/phases/ux-refinements/` and records the pre-bump
application version 3.17.0. No full browser matrix, database suite or production migration was run.

Focused regression commands: `npm run test:customer-email-history` and
`npm run test:customer-email-history:postgres` (local database, temporary transaction rolled back).
The temporary QA server and local database container were restored to their stopped states.

## Previous v3.17.0 scope

Family buyers now flow through quotes, contracts, renewal and financial reports.
Migrations 088–089 add typed purchasing constraints, invoker-scoped contract summaries,
family activity participation with serialized capacity checks, and student application checklists.
See FIRST_PRINCIPLES_AUDIT_2026-10-03.md and FIRST_PRINCIPLES_PLAN_2026-10-03.md for evidence and rollout boundaries.

## Previous v3.16.0 scope

v3.16.0 adds five structured education-business record types, a bilingual paged workspace,
customer/student contextual entry points, explicit organization classification and evidence-based
data-gap/deadline advice. Migration 087 preserves existing customer identities and adds composite
workspace references, RLS, atomic revision/idempotency guards, attribution consistency and privacy
export/deletion support. Unknown legacy values remain unfilled. No production migration, deployment,
external messaging or inferred admissions changes. [Audit](FIRST_PRINCIPLES_AUDIT_2026-10-02.md)
and [implementation/verification](FIRST_PRINCIPLES_PLAN_2026-10-02.md).


v3.15.0 replaces searchable recipient facets with a shared three-column structured selector.
Portal invitations add two bilingual presets, personal/public custom template storage, recipient
filtering from household membership and guardian relationships, record filters and copyable localized
invitation messages. Migration 086 isolates EMAIL/PORTAL template categories while retaining prior
ownership/public-administrator RLS and revision semantics. Original invitation creation/revocation
permissions, verified household email and token-digest boundaries remain unchanged. No automatic
sending or deployment. [Plan and verification](PORTAL_TEMPLATE_PLAN_2026-10-02.md).

v3.14.1 adds latest-result guards and draft locks to communications, immutable batch attempts and
safe retries after unknown queue responses. Preview eligibility reuses authoritative consent and
privacy rules. Forward migration 085 adds template revisions, idempotent saves and soft archive;
personal templates stay owner-private, and only ADMIN/SUPER_ADMIN maintain workspace public templates.
Other send-capable members can use public templates or copy them personally. Existing templates remain
personal. No automated deployment or external sending. [Audit and plan](AUDIT_PLAN_2026-10-02_ROUND2.md).

v3.14.0 improves severity control sizing, worker status layout, select affordances and the schedule
page's double-month calendar. Avatar uploads are decoded, resized and stored as privately served WebP
thumbnails; the shell displays and updates the avatar without blocking navigation. Each of four import
resources has a complete supported-field blank/example template and a bilingual field guide.
Bulk email adds region/tag/type filters, bounded page selection, six bilingual presets, independent
message language and multiple personal custom templates with an editing dialog. Migration 084 creates
workspace/user-scoped template storage and an invoker-security recipient query. Existing origin checks,
consent/suppression, preview integrity and durable queue semantics remain unchanged. No external send
or automatic deployment. [UX plan and verification](UX_FIX_PLAN_2026-10-02.md).

v3.13.1 fixes customer goal date filtering, explicit customer API response minimization, archived
family-member handling and permission-aware follow-up editing. Follow-up drafts survive tab changes,
saves are guarded, and goals show remaining contacts and deadlines. Bulk-email retries keep preview
language and request identity. Automation confirms trigger-wide execution and accepts one action-title
language. Record edits refresh their matching customer panel; opportunity focus links use existing RLS.
No migration, provider integration or deployment behavior change. [Audit and plan](AUDIT_PLAN_2026-10-02.md).

v3.13.0 upgrades common UI styling to calm teal/slate, subject-specific customer details and
keyboard-accessible tabs. Schools show institution contacts, not family sections. Product deletion
is tucked inside More actions with confirmation; details show prices per currency. Suggestions and
automation share the final Operations entry with permission-filtered tabs and execution guidance.
No new schema or deployment changes. [UI audit and plan](UI_AUDIT_PLAN_2026-10-01.md).


v3.12.0 adds organization, customer and household follow-up goals/entries with rule-based advice;
existing relationship milestones remain authoritative. Customer/family panels, school aliases and
explicit contract links use forward migration 083 and existing workspace authorization. Family,
communication, performance, data-governance and report workspaces have capability-filtered tabs.
Template/bulk mail supports preview integrity, isolated recipients, per-recipient errors and durable
queue idempotency. The Worker offers optional authenticated HTTPS SMTP-relay adaptation; no
external accounts, relay service, OAuth or bidirectional mailbox sync are automatically configured.
Details: [customer operations audit and plan](AUDIT_CUSTOMER_OPERATIONS_2026-10-01.md) and
[email provider boundaries](CUSTOMER_EMAIL_PROVIDERS.md).

v3.11.1 repairs Docker verification input completeness by allowing only DEPLOYMENT.md and
IMPLEMENTATION_STATUS.md through the documentation exclusion. The release-metadata test still
reads real repository files and checks the current release. The CI workflow allowlist and Docker
runtime copies remain unchanged; regression assertions enforce both documentation boundaries.

v3.11.0 unifies centered editing dialogs, structured money/currency/date/tag controls and visual
receivable installments. Either Chinese or English names are accepted across editing APIs, with
display fallback and forward migration 082 for legacy database name constraints. CRM and education
version tokens accept PostgreSQL time offsets. Required markers and dynamic import repairs follow
the shared controls; CI now checks release metadata and lockfile alignment before installation.
Scoped verification is recorded in
[the form editor audit and plan](AUDIT_FORM_EDITORS_2026-10-01.md).

v3.10.1 repairs product editing with PostgreSQL offset timestamps and exact version precision,
separates successful writes from failed list refreshes, and supplies actionable mutation errors.
Administrators can move products into the recycle bin; super administrators can restore them.
Forward migration 081 preserves historical references, blocks stale product mutations and new
quotes using deleted products, and extends eligible recycle-bin cleanup. Product regressions,
isolated PostgreSQL 18.4 execution, typecheck, targeted lint, and application build passed.
Remote deployment and browser acceptance are pending. Details and verification evidence are in
[the product repair record](PRODUCT_MUTATION_REPAIR_2026-10-01.md).

Previous release implementation history follows.

v3.8.30 persists the remember-login choice on the server and aligns database expiry, refresh, and
Cookie lifetime with the 15-day administrator / 30-day staff absolute boundary. A compatibility
migration restores unrevoked remembered sessions that remain inside that boundary. The release
also updates fixed vulnerable dependency versions and replaces Vinext's vulnerable metadata-image
parser with a bounded common-format implementation that rejects ICNS/JXL/HEIF while preserving the
moderate-severity CI audit gate.
v3.8.29 moves management submenu links onto a same-tab document navigation boundary so cold route
loads do not depend on the client RSC transition that could leave the first click apparently inert.
A pinned Chromium regression verifies a new document, the exact target URL, and no additional tab.
v3.8.28 separates Docker Worker liveness, operational readiness, and production release acceptance.
Container health now fails only for process/runtime, schema, database, or required-heartbeat faults;
failed and stuck jobs remain visible as normal readiness and Operations degradation. The target
controller captures a sanitized pre-switch baseline and permits only a non-increasing failed-job
count, while always rejecting stuck work, missing/stale Workers, failed core checks, wrong images,
or target-version/commit drift. Recover uses the infrastructure contract without allowing an old
business failure to deadlock runtime reconciliation.
v3.8.27 separates internal staff-invitation delivery metadata from the external Email Delivery
Worker protocol. The Notification Outbox retains invitation reconciliation state and encrypted
credentials locally, decrypts only at delivery time, and emits exactly the seven fields accepted by
the strict `staff-account-created` template. A shared producer/consumer contract prevents schema
drift, while bounded allow-listed remote 4xx diagnostics avoid persisting arbitrary response text.
v3.8.26 replaces the self-mutating deployment runner with a stable bootstrap plus freshly spawned
target controller, adds target-commit TOCTOU evidence, and performs bounded Lumina-only BuildKit,
paired-image, deployment-history, and stale-env cleanup after application acceptance. It also fixes
the staff directory's 375px overflow, adds database-paginated lifecycle and role filters, completes
keyboard focus behavior for staff action menus, and enforces README release-version parity. v3.8.25
atomically archives terminal deployment requests before publishing the final controller
state, and reports archival faults as control-plane finalization failures without relabeling an
accepted application release. v3.8.24 makes the target runtime environment preflight self-contained in a dependency-free
authoritative core, with no host `tsx` or `node_modules` requirement and stable validator failure
classification. v3.8.23 restores the Notification Outbox runtime dependency in the minimal application image,
adds an in-image runtime-closure gate, and preserves safe Worker module-load diagnostics. v3.8.22
replaces the staff action `details/summary` control with a controlled menu and requires an
explicit confirmation dialog before any account status mutation. v3.8.21 added the missing
crm_system SELECT/INSERT/UPDATE RLS policies for durable staff invitation
deliveries without granting DELETE or direct crm_worker writes. v3.8.20 added target-checkout
runtime preflight, atomic Web/Worker release switching, automatic
two-service rollback and idempotent last-success recovery while retaining durable staff invitations,
safe invitation resend, role-specific session retention, and a non-destructive staff action menu.
It retains the production shared-host isolation, persistent first-install flow, complete email
Worker strict deployment configuration, and canonical rootless Docker/Buildx client namespace. It
switches communication email from synchronous Web-owned provider I/O to the dedicated leased
`COMMUNICATION_DELIVERY` processor over `communication_messages`. Web now only accepts durable
queue/requeue transitions; the Worker owns attempt-start, external delivery, fenced completion and
governed failure. Windows is
development-only and holds no production Worker
configuration or Cloudflare credentials; Ubuntu alone stores the server Env, performs the in-place
deployment, and verifies health. Public source does not identify the production Worker, Custom
Domain, CRM hostname, sender domain, webhook URL, route, or Cloudflare account.

The target remains the fixed `lumina-crm` Compose project on a server shared with HunterAI and
Temporal, but every Lumina Docker client now connects exclusively to a rootless daemon owned by
the `lumina-crm` host user. Cloudflare Tunnel is user-facing and reaches Caddy only at
`127.0.0.1:3211`; Caddy proxies accepted requests to Web at `127.0.0.1:3200`.

## Implemented repository assets

- version-controlled rootless Docker daemon configuration with a Lumina-only data root;
- exact rootless socket, security option, systemd cgroup, and data-root deployment gates;
- Docker-using systemd units that neither require the rootful daemon nor hide `/run/user`;
- non-root storage preparation/cleanup through the fixed root-owned maintenance program;
- bounded fixed-builder cache cleanup after acceptance, rootless and non-fatal, without global
  prune or accepted-image deletion;
- a built-ins-only stable deployment bootstrap that alone fetches/fast-forwards source, then starts
  a distinct target-controller PID with full-SHA handoff and pre-side-effect TOCTOU revalidation;
- target-controller post-acceptance cleanup that protects running/current/rollback/target/recent
  images, retains at least three complete app/operations pairs, applies history age-plus-count
  retention, and never prunes volumes, networks, containers, global images, or other projects;
- one owner-checked, non-symlink Docker configuration root shared by deploy, prepare, and cleanup,
  with fail-closed handling for the obsolete maintenance-local configuration path;
- a credential-free HTTP(S) Docker build proxy allowlist, fixed rootless BuildKit `network=host`,
  four exact driver environment options, value-free predefined build arguments, buildx-only
  subprocess environment, redaction, and marker network/proxy fingerprint drift detection;
- a minimal verification build context that keeps the documentation tree excluded while restoring
  the deployment contract consumed by containerized production-deploy tests;
- a target-checkout runtime-schema preflight plus metadata validation for fixed Compose secret sources, with host directory
  traversal restricted by `root:lumina-crm`/`0750` and container-readable regular files fixed at
  `root:lumina-crm`/`0644` for runtime UID/GID `10001:10001`;
- a Node-built-in-only target runtime contract shared by Web, Worker, and the pre-build deploy
  preflight, including feature groups, external-work budgets, and invitation-key independence;
- corrected Compose/rootless disk monitoring with strict threshold configuration;
- strict remote/local backup retention and paired encrypted database/object verification;
- CSRF-aware secure sign-out with pending, error, fallback redirect, and Chromium coverage;
- separate strict pre-authentication Origin and authenticated Session CSRF boundaries, resilient to
  stale Session Cookies without weakening cross-site rejection or authenticated mutations;
- explicit unavailable CAPTCHA configuration state instead of treating configuration failures as an
  administrator-disabled Turnstile policy;
- immediate stale-search clearing and finite, consistently clamped progress semantics;
- current Compose-only deployment core and contracts, without obsolete v3.6 release logic;
- minimal application image script/module set, excluding deploy, QA, and smoke controllers, with an
  in-image non-root runtime-closure gate;
- Tunnel/Caddy Host, public-readiness, forwarding-header, liveness, and rollback contracts;
- explicit `initialize` request mode with accepted-state gates, repeat-safe recovery, bootstrap
  credential boundaries, forward-only failure state, and first-release null rollback images;
- zero-runtime-dependency email adapter with fixed-time token verification, bounded JSON input,
  nine explicit escaped HTML/text templates, Resend idempotency, stable provider errors, and safe
  logs;
- a generic tracked Wrangler contract with `workers.dev` disabled, no route/name/production vars,
  Preview URLs disabled, two declared required secret binding names, and explicit full-sampling
  persisted invocation logs with traces disabled;
- a Linux-only Node production controller using the fixed root-owned Ubuntu Env contract, strict
  deployment from a complete mode-0600 temporary JSON, a mode-0700 owner-checked runtime directory,
  read-only Custom Domain ownership/set preflight, bounded sanitized Wrangler failure detail, and
  generic health acceptance;
- explicit separation between CRM application initialization and email Worker deployment;
- a containerized release-version contract that keeps package metadata, runtime `APP_VERSION`,
  health responses, and strict deployment acceptance aligned;
- distinct Worker-container and release-health contracts: queue failures never determine Docker
  liveness, normal readiness remains operationally strict, and release acceptance compares only
  sanitized aggregate counts against the immediately pre-switch baseline;
- Worker-only active consumption of CRM email delivery credentials, with Web template values
  retained solely for one-release rollback compatibility and no provider readiness probe;
- a dedicated communication delivery category with durable queue acceptance, distinct provider
  attempts, fenced leases/completion, bounded retry/time budget, conservative uncertainty handling,
  independent heartbeat/readiness and audited retry;
- synchronized application package, lockfile, runtime, README, and documentation version 3.8.30;
  the independently deployed Cloudflare Worker code, template allow-list, and metadata are unchanged;
- an explicit seven-field staff-account-created delivery projection that keeps invitation IDs,
  encrypted credentials, and future internal metadata inside CRM, plus a cross-package contract
  against the Email Worker template definition and bounded stable remote-error mapping;
- durable staff-account creation with transactional base audit, non-destructive ambiguous invitation
  handling, immediate pending-directory visibility, dialog closure, and explicit bilingual status.
- database-paginated staff lifecycle/role filters, a contained mobile staff-card layout, and complete
  keyboard focus behavior for staff action menus;
- correct nested-relation cardinality when a foreign-key column participates in a composite unique
  index, retaining arrays for one-to-many relations such as household members;

## Local verification recorded

| Check | Result |
| --- | --- |
| v3.8.30 remembered-session targeted contracts | Pass: 10/10, including server-owned persistence, 15/30-day role bounds, refresh continuity, and migration backfill guards |
| v3.8.30 dependency security contracts and online audit | Pass: 3/3; common metadata formats preserved, ICNS/JXL/HEIF rejected, `npm audit --audit-level=moderate` reports 0 vulnerabilities |
| v3.8.29 management submenu cold-navigation regression | Pass: same-tab document navigation, exact admin target, no additional tab; Chromium 149.0.7827.55 from revision 1228 |
| v3.8.28 Worker/release-health targeted contracts | Pass: 11/11, including Docker liveness separation, failed-job baseline matrix, recovery, rollback triggering, Operations visibility, evidence minimization, and cycle timing |
| v3.8.27 staff invitation delivery protocol contracts | Pass: 6/6, including exact CRM/Email Worker field-set parity, local metadata retention, bounded diagnostics, and log redaction |
| v3.8.26 staff directory targeted contracts | Pass: 9/9 |
| v3.8.26 deployment bootstrap/cleanup targeted contracts | Pass: 16/16, including real fresh-process 3.8.24→3.8.25 generation fixture and HunterAI isolation |
| Final `npm run typecheck:raw` | Pass |
| Final `npm run lint:raw` | Pass |
| Final `npm run test:contracts:raw` | Pass: 74 application contracts + 8 CAPTCHA contracts |
| `npm run db:migrations:verify` | Pass: 78 ordered checksum-managed migrations |
| Earlier v3.8.26 `npm run test:deploy` | Pass: 82/82 before the two-stage controller addition |
| Final production `npm run build` | Pass: 85 application/API routes |
| Final `ms-playwright/chromium-1228` staged matrix | Pass: 80 page/viewports, 10/10 stages, 0 errors, 0 warnings, QA identities 9/9 cleaned; Chromium 149.0.7827.55 from revision 1228 |
| Root `npm ci` (earlier v3.8.26 verification) | Pass: 566 packages installed; the current container build's registry audit summary differs and is recorded below |
| Communication delivery Phase 2 application contracts | Pass: 9/9, including queue-only Web ownership, attempt-start ordering, durable idempotency, fenced completion, provider classification, uncertainty, time budget, heartbeat/readiness, Operations and UI |
| Communication delivery Phase 1 migration | Pass: clean standard migration 76/76 through the Phase 2 switch; parent-069 representative QUEUED, FAILED, SENT, RECEIVED, and DELIVERED rows unchanged |
| Communication delivery Phase 1 SQL behavior | Pass: concurrent claim isolation, `SKIP LOCKED`, fencing, safe/uncertain lease recovery, provider receipts, bounded backoff/attempts, consent, recipient, grants, audited retry, and synchronous Web compatibility |
| Communication delivery Phase 2 SQL behavior | Pass: durable queue identity, duplicate idempotency, Worker claim/start/completion, independent heartbeat/readiness metrics, Operations queue exposure, and retained rollback grants |
| Verification image `docker build --target verification --output type=cacheonly .` | Pass: containerized build, contracts, and deploy tests completed with `docs/DEPLOYMENT.md` present |
| Final application image runtime smoke | Pass: final image runs as `10001:10001`; 29 local runtime modules resolved; invitation credential crypto module owner/read/import verified after the minimal application copy |
| Target runtime preflight without host dependencies | Pass: temporary target checkout contains no `node_modules` or `tsx`; complete Web/Worker contract validates from tracked Node-built-in-only modules |
| Isolated production Compose runtime | Pass: 76 migrations, Web/Worker health, communication heartbeat-aware readiness, stale-worker failure, PostgreSQL recovery, forward-schema rollback, volume preservation and cleanup |
| Email delivery Worker `npm ci` | Pass: install completed and 35 packages audited; npm reported 0 vulnerabilities |
| Email delivery Worker `npm test` | Pass: 61/61 |
| Email delivery Worker `npm run test:deployment` | Pass: 54/54, including Wrangler 4.102.0 no-upload strict dry-run, complete generated config parity, Custom Domain preflight, 0700/0600 owner/symlink contracts, cleanup, and bounded full-value output redaction |
| Email delivery Worker `npm run lint` | Pass |
| Windows production deployment rejection | Pass: `PRODUCTION_DEPLOY_REQUIRES_LINUX` before Env access or Wrangler |
| Initialize/first-install targeted deploy contracts | Pass: 26/26 |
| `npm run tunnel:test` | Pass: 9/9 Tunnel/Caddy contracts |
| Final `npm run test:deploy:raw` | Pass: 109/109 application-runtime/target-runtime/version/rootless Compose/two-stage deploy/release-health/cleanup/secret-source/finalization/BuildKit/Tunnel contracts |
| `npm run test:application-image:smoke` | Pass: application image loaded as `10001:10001`, Lumina ownership labels exact, runtime closure 29 modules |
| `npm run typecheck:raw` | Pass |
| `npm run lint:raw` | Pass |
| `npm run test:contracts:raw` | Pass: 68 application contracts + 8 CAPTCHA contracts |
| Tracked-tree production identifier / retired Env / deployment-command scans | Pass |
| `git diff --check` | Pass before release commit |

## Not performed / external release gates

No production SSH/deployment, Cloudflare Worker deployment, DNS, Cloudflare Tunnel, Caddy, systemd,
firewall, rootless daemon, or real production Docker resource changed. The full ten-phase local
Chromium matrix passed; no complete database suite, production image publication, real Resend
delivery, encrypted S3 lifecycle, Tunnel route, server reboot, or production recovery drill was run
in this scoped implementation.

The application image build completed, but its registry audit summary reported 4 high-severity
production-dependency findings and 6 high-severity full-development-tree findings. No automatic
`npm audit fix` or dependency mutation was attempted in this deployment-control task. A dedicated,
reviewed dependency remediation remains an external release gate.

The registry-backed `npm audit --omit=dev` was not run because approval policy rejected sending the
lockfile dependency tree to the external npm registry without separate explicit authorization.

Before production deployment, operators must provision non-overlapping subordinate UID/GID ranges,
the lingering rootless user service, cgroup v2 delegation, exact file ownership, real secrets,
independent object-store lifecycle, the Tunnel credential and DNS route, loopback Caddy
environment, and a real recovery exercise.
Any rootful Docker result is a release blocker; there is no fallback.
