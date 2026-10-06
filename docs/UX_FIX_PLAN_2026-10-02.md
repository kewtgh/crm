# Scoped UX improvements — 2026-10-02

Baseline: v3.13.1. The follow-up request authorizes updating to v3.14.0 and creating a local commit. No push or deployment is authorized.

## Findings and execution plan

- Quality rule cards allow the right-hand severity control to shrink. Give controls stable sizing and wrap below the title on narrow cards; do not truncate option text.
- Worker heartbeat badges compete with metadata. Separate readable metadata and non-shrinking status, with a narrow-card layout.
- Avatar upload stores up to 5 MB unchanged; the shell displays initials only. Normalize uploads to a bounded WebP thumbnail, preserve authenticated access/private caching, and update shell images after upload without delaying navigation. Existing stored images remain supported.
- Four import resources have separate supported field lists but downloads contain headers only. Use the shared field registry, offer blank/example/field-guide downloads per resource, and document formatting/required relationships rather than advertise unsupported import fields.
- Email recipients lack filtering/batch selection. Add an authorized, paginated contact selector with region, tag and customer-type filters, bounded batch selection (50), and visible exclusions.
- Email templates are fixed. Add two Chinese/English presets for each of the three categories (six bilingual presets), a central editing dialog and multiple durable workspace/user-scoped templates, bounded plain-text content and allowlisted personalization placeholders. Preserve preview hashing, original-language retries, purpose/consent checks and queue idempotency. Add forward migration 084 only; do not send external mail.
- Two months have little visual separation. Add independently bordered month panels and distinct headings without relying on color alone.
- Some structured selects have no visible affordance. Strengthen the shared searchable trigger and native select arrow/hover/focus styling, preserving keyboard interaction.

## Verification boundaries

Run targeted regression tests, typecheck, lint, one production build and the directly affected Chromium 1243 phase. New template storage requires focused PostgreSQL checks. Do not run the entire browser/database matrix. Record outcomes here and disclose mocks versus real database tests.

## Results

All scoped implementation items are complete and prepared for v3.14.0.

- Avatars: uploads are decoded and normalized to WebP, maximum dimension 256 px / stored size 128 KiB; input remains limited to 5 MiB with a 25-million-pixel decoder bound. EXIF orientation is applied and metadata removed. Existing stored avatars remain readable; there is no destructive backfill. Header/profile use authenticated versioned URLs, private caching and immediate update events with initials as a failure fallback. Navigation does not wait for image loading. The existing pinned sharp 0.35.4 was promoted from an optional transitive dependency to a direct dependency without upgrading it. Implementation uses documented [resize options](https://sharp.pixelplumbing.com/api-resize/) and [WebP output](https://sharp.pixelplumbing.com/api-output/).
- Rule controls have stable minimum width, visible arrows and separated labels; Worker badges have their own row. Workers with recorded consecutive failures now show a failure label rather than incorrectly saying healthy.
- Calendar changes target the schedule page's `.double-calendar`, not the date input plugin. Distinct full-month cards/headings, borders and spacing work at desktop/mobile widths.
- Each supported import resource has blank/example/guide downloads based on the same field registry as mapping. Examples include quoted token lists, money/date formats and explicit student contact-UUID placeholders. Guides are not import data; no unsupported fields are advertised.
- Email: six bilingual presets (two per category, twelve language variants), independent sending language, region/tag/type AND filters, paginated checkbox selection and select/clear-page controls with the existing 50-recipient limit. Region explicitly means associated institution city; inaccessible organizations do not leak location. Archived contacts are excluded and do-not-contact/missing-email rows cannot be selected.
- Custom templates are personal to the user/current workspace, support multiple saved records and save-as-new, and are edited in the central accessible dialog. One complete subject/body language pair is sufficient; unknown placeholders and subject newlines are rejected. Personalization uses only `{{name}}` and `{{owner}}`, never recursive expansion. Rendered content exceeding queue limits is blocked in preview rather than failing later. Original preview language, content and request key are retained for retries. Existing consent checks/Worker queueing remain authoritative; no actual emails were sent.
- Forward migration `202610020084_customer_email_templates.sql` is required for template persistence and recipient filtering. It passed the existing canonical migration discovery/verifier contract and isolated real PostgreSQL execution. No historical migration was edited.

### Verification

- Typecheck PASS; full lint PASS, with final modified picker/QA fixture/script additionally linted after the last small changes.
- Contracts PASS: 149 main + 8 captcha = 157. New tests cover avatar encoding/dimensions/rejection, all presets, custom language pairs/variables, immutable retry content, personalized-content overflow and every import resource's actual examples/guides. The historical import test now follows the route into the shared registry/builder, retaining its field assertions.
- `npm run test:customer-operations:postgres` PASS (55-second limit): real PostgreSQL 18.4 in a temporary isolated container; multiple template create/update, owner/workspace isolation, combined filters/facets/paging, suppression/archived contacts and contact row policies. Temporary container removed; no business database accessed.
- Final `npm run build` PASS at v3.14.0. Builds were refreshed only after application source/version changes; no Docker build or deployment was performed.
- `QA_PHASE=ux-refinements npm run qa:chromium-1243` PASS on final production build: 1440 and 375 px; severity control width, readable Worker status, actual double-month calendar distinction, four-resource downloads, combination/repeated-value filters, batch selection, six presets, multiple-template save-as-new, personalized preview, avatar update and no document overflow. Initial QA script failures were corrected to use the actual preview label and mobile Operations queue tab; final report has no errors.
- Exact browser: `%LOCALAPPDATA%/ms-playwright/chromium-1243/chrome-win64/chrome.exe`, browser 153.0.8010.12 / Playwright 1.63.0. Evidence retained under ignored `work/browser-qa-chromium-1243/phases/ux-refinements/` with version, source fingerprint and final build hash. Screenshots visually inspected. QA server stopped.
- Browser uses actual components and production CSS with mocked business APIs, not live production users/provider delivery. Database persistence/authorization and image processing are separately tested. No complete browser matrix or full database regression campaign was run.
- `npm run release:check` PASS at v3.14.0. Local commit requested; no automatic push or deployment.
