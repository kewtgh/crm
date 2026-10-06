# Project/application audit and execution plan — 2026-10-02

Baseline: v3.13.0. Working tree was clean. This is an evidence-based static audit of the application/recent changes with focused execution checks, not a claim that every route or production account was exercised.

## Confirmed findings and integrated plan

| Priority | Finding / evidence | Planned repair and useful addition |
| --- | --- | --- |
| High | Customer goal completion query uses `and=(...)`, but gateway `queryParts` only handles `or` specially and treats `and` as a database column. Goals can break subsequent detail loads. | Use repeated timestamp filters supported by the gateway. Test exact date bounds and real repository adapter calls. |
| High | Gateway deliberately uses `select *` and nested hydration ignores requested projections. Customer operations forwards profile and nested records directly. Row authorization remains, but response minimization is not guaranteed. | Introduce an explicit customer-operation DTO sanitizer at this API boundary, including nested business/plan/entry records. Keep the shared gateway unchanged to avoid undocumented repository-wide compatibility changes. |
| High | CONTACT opportunities use organization ID and are presented as that person's business. Archived member contacts are not removed before household relationship aggregation. | Do not imply contact-specific opportunity ownership where there is no explicit relationship. Provide a clearly labelled institution-context link. Filter archived members and their children; normalize nullable names and assigned-owner displays. |
| High | Follow-up forms remain editable while saves are in flight, allowing input changes and idempotency-key reset. A committed write followed by failed refresh is not clearly distinguished. Contract search can overwrite newer suggestions. | Lock fields/tabs during saves, synchronous duplicate-submit guard, preserve stable entry key, differentiate saved/refresh-failed outcomes, latest-only contract search. Show edit controls from actual subject edit access, not only hardcoded roles. |
| High | Bulk-mail queue recomputes hash using current UI locale; language changes between preview and retry can invalidate a partially queued batch. New-batch is enabled during a retry. | Bind queue/retry to the preview locale and request key; disable new-batch while pending, reject duplicate submissions synchronously, reset only intentionally. Add recipient/blocked/queued summary and live feedback. |
| High | Automation row Run dispatches the trigger event, affecting all matching active rules, not just that row. No confirmation communicates this scope. | Keep event semantics, add explicit event-level label and confirmation with matching-trigger active-rule count. No hidden change to backend scheduling. |
| Medium | Automation action titles still require both languages although the rest of the app supports at least one. | Validate optional original titles before bilingual fallback; update UI hint and regression checks. |
| Medium | Detail tab activation unmounts follow-up forms, discarding drafts even without saving. Long keyboard tab lists don't ensure focused tab remains visible. | Keep follow-up form subtree mounted but hidden between tabs; scroll keyboard-selected tabs into view. Prevent changing tabs during an in-flight mutation. |
| Medium | Follow-up goals show progress only; user must calculate remaining contact count and deadline. | Add deterministic completion/remaining/deadline metrics, clarify UTC goal dates, do not auto-upgrade relationship levels or create activity evidence. |
| Medium | Record edits call router refresh but the client operations panel remains mounted with old data. Opportunity links use a focus parameter ignored by the destination. | Refresh only the matching record panel after edits, accept latest response only. Validate opportunity focus IDs, read through existing RLS, use linked currency and describe initial focused-list versus currency-wide metrics. |

## Checklist

- [x] Customer query, minimal DTO, archived-member and relationship-boundary repairs; explicit edit-access result.
- [x] Follow-up transaction UX, persistent drafts, latest-only related search, progress/deadline metrics and permission-aware controls.
- [x] Stable bulk-email preview/retry batches, recipient summary and in-flight guards.
- [x] Explicit automation-event confirmation and single-language title support.
- [x] Matching-record refresh and working, permission-scoped opportunity deep links.
- [x] Targeted tests and integration-level repository simulations; Chromium 1243 customer workflow and affected shared UI phases, production CSS on 1440/768/375 as applicable.
- [x] Typecheck, lint, release consistency, existing contracts and one normal production build; record evidence/outcomes here. No full ten-phase browser matrix/database campaign.

## Architecture decisions and future options

- RLS, trusted-origin checks, queue idempotency and existing delivery workers remain authoritative. No external send, migration or deployment is performed.
- Generic gateway projection and query-language support should be formalized separately with compatibility fixtures for every consumer before changing global semantics. Current plan closes the exposed customer API response boundary now.
- Contact-specific opportunities require an explicit relationship model/product decision; this plan does not invent one from shared institution ownership.
- Full mailbox OAuth/sync, distributed campaign orchestration and automatic goal-to-task scheduling require external accounts or a new workflow/data contract. They are not added to this execution plan. Current additions remain deterministic, permission-scoped and immediately usable without external services.
- No dependency upgrades or vendor API changes are needed. The audit implementation initially preserved release metadata; the subsequent user request authorizes a patch-version update and local commit, not a push or deployment.

## Verification results

- Typecheck PASS against final TypeScript source.
- Full lint PASS; additionally linted the final modified workflow components, route, schemas and QA fixtures/scripts after subsequent edits.
- Release consistency PASS at the unchanged baseline version 3.13.0.
- Existing contracts PASS: 145 main + 8 captcha = 153. Eight customer-operation audit regressions were added; direct repository adapter tests verify both date filters and actual response minimization. The automation bilingual source contract was routed to its extracted schema without deleting its original name-validation constraint.
- Targeted isolated PostgreSQL 18.4 PASS: new effective-contact date-bound test plus existing owner/access/alias/idempotency/contract-link tests. The legacy-activity fixture now has an explicit date, avoiding dependence on the execution date. Temporary database/container removed; no existing business database was used.
- Production build PASS once after all application source changes.
- Chromium 1243 PASS: customer-operations at 1440/375, UI-system at 1440/768/375. Exact executable %LOCALAPPDATA%/ms-playwright/chromium-1243/chrome-win64/chrome.exe; browser 153.0.8010.12, Playwright 1.63.0.
- Browser workflow checks include follow-up save lock, preservation of drafts across tabs, real entry/plan components, original-language email retry using the same durable key, recipient progress, and automation cancellation without a run request / confirmation with exactly one run request.
- Customer browser APIs are mocked; they exercise actual components with production CSS, not real external mail delivery or a live production database. Source assertions cover opportunity deep-link routing; those routes were not exercised against live customer records.
- Screenshot inspection completed (including narrow-screen workflow). Evidence retained in ignored work/browser-qa-chromium-1243/phases/customer-operations/ and phases/ui-system/.
- git diff --check PASS. QA server stopped. No full ten-phase Chromium matrix, full database campaign, Docker rebuild, dependency upgrade, migration, external mail send, deployment, push or commit.
- Existing .dockerignore, Dockerfile, CI workflow and release metadata are unchanged. New tests reuse the already-allowed tests/ directory and import allowed lib/ files; the audit document is not a Docker contract input.

## Completion

All execution checklist items are complete, with the audit and plan saved alongside the implementation. The subsequent release handoff updates the package, lockfile, application version and release documents to v3.13.1 and includes these changes in a local Git commit.

## Release handoff — v3.13.1

The user requested a version update and commit after the audit implementation. Application verification above was performed on the completed source with v3.13.0 metadata. The handoff changes only version metadata and documentation; production build and browser QA are not repeated. No push or deployment is authorized.

- `npm run release:check` PASS: all release metadata aligned at v3.13.1.
- `node --import tsx --test --test-isolation=none tests/release-metadata.test.mjs` PASS: 2 tests, including reads of the real repository metadata and the existing CI preflight-order contract.

Static coverage included customer-operation API/repository/UI, generic gateway relation/filter behavior, email preview/queue flows, automation schema/event dispatch, CRM edit refresh, family/detail tabs, capabilities and opportunity routing. Verification was risk-directed; this report does not claim repository-wide penetration testing, live-data validation of every screen or complete WCAG conformance.
