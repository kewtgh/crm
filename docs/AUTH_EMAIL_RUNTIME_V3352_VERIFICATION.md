# Authentication-email runtime repair — v3.35.2

Baseline: main, 2caa9d877f85ba19a09a193b758807fe7fb7fd73, v3.35.1, migration 126 / 131 SQL.

## Root cause and ownership

The asynchronous communication switch removed Web's email startup/readiness requirement and
introduced a conflicting deployment assumption. Authentication token delivery remained synchronous
in `lib/auth/email-tokens.ts`. This allowed deployment acceptance even though non-admin
untrusted-device login, password reset and email verification could not deliver their email.

Web owns DEVICE_VERIFICATION, PASSWORD_RESET and EMAIL_VERIFICATION. Worker owns notification
outbox, reminders, calendar and communication delivery. Both receive only
EMAIL_DELIVERY_WEBHOOK_URL and EMAIL_DELIVERY_WEBHOOK_TOKEN, which must be valid and exactly equal.
RESEND_API_KEY and LUMINA_WEBHOOK_TOKEN remain exclusively Cloudflare Email Worker secrets.
No authentication role, trusted-device, MFA, session or token-expiry behavior was changed.

Web readiness validates configuration without external fetches. The email boundary is
`web-and-worker`; Web's configuration boolean is not proof of Worker or provider health.
External health remains unknown. Worker heartbeats and queues retain their existing checks.

## Regression coverage

- Actual container entrypoints reject each missing delivery variable for Web and Worker.
- File-backed target validator/preflight rejects missing, invalid and unequal configuration.
  Error/state serialization contains stable codes and variable names, never either value.
- Actual login route, token module, validation, role/MFA logic and trusted-device helpers run
  against mocked persistence/captcha/account identities and a simulated email endpoint.
- Untrusted SALES_SPECIALIST login emits one six-digit device code with 600-second expiry,
  correct recipient and idempotency header; no authenticated session is created at that step.
- ADMIN/SUPER_ADMIN require MFA setup/challenge and emit no device-verification email.
- Password recovery uses password-reset (1800 seconds); email verification uses
  email-verification (86400 seconds). Token storage hashes and response privacy are preserved.
- Actual communication send route queues a message and performs no provider fetch.
- Actual readiness handler returns 503 for missing email configuration without provider I/O.
- Existing asynchronous Worker lease, consent, provider retry and privacy tests remain passing.
- Website localization, active metadata/social image and email-template copy use ewaya.
  Existing cookie/event/environment/deployment identifiers are intentionally retained.

## Verification

| Check | Result |
|---|---|
| Focused runtime/auth tests | 24 PASS |
| Deployment suite | 126 PASS |
| Auth/device/security/communication tests | 37 PASS |
| Email Worker + local deployment tests | 185 PASS |
| Standard contracts, including captcha | 319 + 8 PASS |
| Final production-deploy documentation guard | 61 PASS |
| Typecheck | PASS |
| Lint | PASS, no errors |
| Production build | PASS |
| Chromium 1243 public authentication phase | 6 page/viewports PASS; browser 153.0.8010.12 |
| Migration verification | PASS; all opening 131 SQL raw-byte hashes identical |
| Public privacy | 13 PASS |
| Release metadata and git diff integrity | PASS |

Browser QA used the local production build for login, forgot-password and reset-password at
desktop/mobile widths, plus locale switching. Authentication delivery behavioral tests used
fictional addresses and intercepted I/O; they did not send mail or access Production.
Private QA evidence remains under ignored work/. No full database or full browser campaign ran.

The Email Worker deployment test contained a stale hard-coded Wrangler version. Its assertion
now follows the exact pinned package dependency; the installed version and strict no-upload
Wrangler dry-run pass. Neither the dependency nor deployment infrastructure changed.

## Operator boundary

No migration is required and no production secret values were read. No secret rotation is
required if Web and Worker already have matching valid values. Otherwise an operator must
restore matching webhook configuration in the existing runtime files. This task did not inspect
those files. A separately managed EMAIL_BRAND_NAME/EMAIL_FROM setting may retain an older display
label; updating such non-secret production presentation settings is an operator action, not
part of this repository-only repair.

Version: 3.35.2. No push, deploy or Production access. Commit is authorized by the user.
Public privacy, release metadata and git diff integrity are checked before staging this inventory.

## Exact changed files

- `README.md`
- `app/api/health/route.ts`
- `app/api/settings/mfa/route.ts`
- `app/global-error.tsx`
- `app/layout.tsx`
- `app/portal/invite/[token]/page.tsx`
- `deploy/production.env.example`
- `deploy/worker.env.example`
- `docs/AUTH_EMAIL_RUNTIME_V3352_VERIFICATION.md`
- `docs/DEPLOYMENT.md`
- `docs/IMPLEMENTATION_STATUS.md`
- `docs/RELEASE_V3.35.2.md`
- `infrastructure/email-delivery-worker/src/templates.js`
- `infrastructure/email-delivery-worker/test/deploy-production.test.js`
- `infrastructure/email-delivery-worker/test/worker.test.js`
- `lib/auth/totp.ts`
- `lib/i18n/locales/en.ts`
- `lib/i18n/locales/v120.ts`
- `lib/i18n/locales/workspace-pages.ts`
- `lib/i18n/locales/zh-CN.ts`
- `lib/runtime-environment-core.mjs`
- `lib/runtime-environment.ts`
- `lib/version.ts`
- `package-lock.json`
- `package.json`
- `public/brand/ewaya-social.png`
- `public/brand/ewaya-social.svg`
- `scripts/container-entrypoint.mjs`
- `scripts/lib/target-runtime-contract.mjs`
- `tests/auth-email-delivery.test.mjs`
- `tests/notification-delivery-protocol.test.mjs`
- `tests/production-deploy.test.mjs`
- `tests/sitewide-visuals.test.mjs`
- `tests/target-runtime-preflight.test.mjs`
- `tests/v290-behavior.test.mjs`
- `tests/v340-behavior.test.mjs`
