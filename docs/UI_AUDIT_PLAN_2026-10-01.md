# UI audit and implementation plan — v3.13.0

## Findings

- The shared customer panel uses the family label for every subject. School records do not query family students, but still render their heading. This is a presentation/model-boundary defect, not an unexpected family association.
- Personal customers show peer contacts from their organization without identifying the relationship. Organization contacts also omit owner IDs from their projection, making their owner appear unknown.
- Customer details lack a subject-specific identity header, consistent section hierarchy, and useful empty states. Business sections are plain paragraphs and raw status codes; keyboard tab interactions are incomplete.
- Product details omit the full currency price list, mix description and purchaser information, and expose delete alongside everyday actions. Actions can wrap into separate lines.
- Suggestions and automation are separate sidebar destinations with insufficient explanation of human review versus deterministic execution.
- Shared tokens misleadingly name purple colors as forest/green; older CSS contains hard-coded purple backgrounds, borders, gradients and shadows. Focus treatment, tables, card surfaces and mobile layouts need consistent application-wide styling.

## Plan

- [x] Separate organization contacts, family members/children, and a personal customer's organization links. Correct owner projection and provide explicit relationship context.
- [x] Upgrade shared customer details with identity header, metric cards, section cards, meaningful empty states, readable statuses, responsive lists and keyboard-accessible tabs; preserve existing authorization and mutation behavior.
- [x] Upgrade product details into overview/prices/purchasers tabs with currency-separated pricing and accessible actions. Hide deletion in an explicit More actions disclosure with the existing confirmation and admin guard.
- [x] Merge suggestions and automation into one final Operations sidebar entry. Keep old paths and capability restrictions, add in-page tabs and concise purpose/limitations/how-to guidance.
- [x] Replace the purple primary theme with calm teal/slate tokens, migrate legacy purple literals narrowly, and polish common buttons, tabs, fields, cards, tables and mobile detail layouts. Preserve distinct danger/warning/success semantics and existing brand artwork.
- [x] Add focused behavioral/source regression tests and browser fixtures using actual components and production CSS at desktop/tablet/mobile sizes. Record mocked backend boundaries.
- [x] Run release consistency, typecheck, lint, relevant contracts, one production build and bounded Chromium 1243 affected-page checks. Do not run the full browser/database matrix or change deployment.
- [x] Bump all release metadata to 3.13.0, record outcomes here, and commit locally. Do not push or deploy.

## Verification

- Release consistency: PASS, package/lock/runtime/README/status aligned at 3.13.0.
- Typecheck: PASS (final TypeScript source).
- Full lint: PASS; final added/changed UI QA components/scripts additionally targeted lint PASS.
- Contracts: PASS, 137 main + 8 captcha = 145; includes 6 new UI contracts. Existing product-purchaser contract follows the extracted real detail component rather than dropping its assertion.
- Production build: PASS. A source-affecting responsive fix required one updated build; the final Chromium checks use that build.
- Chromium 1243 / Playwright 1.63.0: PASS, browser 153.0.8010.12 at the pinned executable <workspace>
- UI system phase: PASS at 1440, 768, 375 pixels. Checks subject boundaries, roving keyboard focus, tab navigation, same-line actions, hidden deletion, outside/Escape dismissal, cancellation preserving the product, separated currency prices, modal details and no document overflow.
- Forms phase: PASS at 1440, 768, 375 pixels. Covers centered editor, bilingual names, money, required markers, dropdowns and date calendar interactions with production CSS.
- Screenshots visually inspected, including desktop and mobile product dialogs.
- Evidence retained under Git-ignored work/browser-qa-chromium-1243/phases/ui-system/ and phases/forms/. Both phases use real components/production CSS and mocked business API responses, not live end-to-end database operations.
- QA discovered and fixed legacy 1120px minimum widths on the product toolbar and pagination which caused tablet overflow. Initial QA selector issues (counting a hidden disclosure action as a row action, and looking for dialog instead of the existing alertdialog) were corrected, not bypassed.
- Shared palette normal-text contrast tested at >= 4.5:1 for primary buttons, muted text and sidebar headings. This is not a complete WCAG conformance claim.
- QA server stopped. No database/schema changes, migration, Docker rebuild, full ten-phase browser matrix, full database suite, deployment or push. Existing Docker and CI workflow allowlists are untouched.
- Historical audit/status sections remain historical; current release header is 3.13.0.

## Delivery boundaries

This release upgrades the shared UI system across the application and the specifically requested customer/product/assistance interfaces. It does not claim every authenticated route has undergone a live-data visual audit. Existing identity artwork remains unchanged; chart/category tokens keep distinct blue/amber/red/green semantics while legacy purple category colors are now muted slate-blue. The suggestions and automation engine behavior remains unchanged and independent of the combined navigation entry. Existing capability guards still govern each tab/route.
