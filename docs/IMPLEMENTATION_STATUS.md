# Implementation status — v2.9.0 release candidate

Status date: 2026-07-29

## Outcome

The repository-complete v2.9.0 remediation is implemented and verified. Concurrent 401 responses
share one refresh rotation. Password changes revoke global sessions and trusted devices, clear
every browser security cookie and require a fresh login with an honest partial-revocation receipt.
Canonical configured origins now govern production mutations, public links, redirects, metadata
and exact Supabase CSP sources.

SCIM compensation uses workspace/version compare-and-set and monotonic versions, while failed staff
provisioning cannot silently leave a usable identity. Server-paged list state is reversible through
browser back/forward. Login, SSO, password-change and password-recovery submissions are mutually
exclusive even during same-tick rapid activation.

Lumina Web, Worker, readiness, build/test/smoke processes and the persistent deployment runner now
default to direct external connections. Web, Worker and deploy systemd units clear inherited proxy
variables and have no v2rayA dependency. The only allowed proxy path is temporary
`core.sshCommand` configuration attached to the single
`git pull --ff-only origin main`; it preserves the SSH deploy key and never writes Git config.

The v2.8.4 direct-runtime, readiness, deployment, 30-day session and 12px accessibility controls are
preserved. The fixed Chromium matrix found no responsive, accessibility, authentication,
navigation-history or business-workflow regression.

No production deployment was executed. No v2rayA, HunterAI or unrelated server service was
modified, stopped or restarted.

## Verification record

| Gate | Result |
| --- | --- |
| Full release gate | Not invoked because its online `npm audit` stage was denied by runtime policy; every other stage was executed individually |
| TypeScript | Pass |
| ESLint | Pass |
| Production build | Pass; v2.9.0 route and production bundles generated |
| Node contracts | 66/66: 45 source/behavior contracts, 19 production-deploy tests and 2 root/login HTTP contracts |
| Local dependency tree | Pass: `npm ls --all --omit=optional` |
| Online dependency advisory lookup | Not run; policy denied sending dependency metadata to the external npm service |
| Supabase schema lint | Pass; 0 findings |
| Full pgTAP suite | 468/468 across 12 files |
| Local migration application | Pass through `202607280056_v284_readiness_diagnostics` |
| Business and HTTP smoke | Pass: phase two, v0.9, v1.0 security, v1.1, export and real device-auth |
| Session smoke | Pass; 30-day rotation plus password-change global session/device revocation, cookie clearing, old-token rejection and new-password reauthentication |
| Production assets/MIME | Pass; 26 CSS/JS assets, 5 exact PNG assets, metadata and legacy redirect |
| Pinned Chromium | Pass; 10 stages, 80 page/viewports, 0 errors, 0 warnings, 9/9 identities cleaned |

The Git-ignored merged browser report is
`work/browser-qa-chromium-1228/report.json`. It records:

- runtime `ms-playwright/chromium-1228`;
- Chromium `149.0.7827.55`;
- executable
  `C:/Users/Horolf/AppData/Local/ms-playwright/chromium-1228/chrome-win64/chrome.exe`;
- `playwright-core` `1.61.1`;
- application `2.9.0`;
- migration head `202607280056_v284_readiness_diagnostics`;
- base URL `http://localhost:3200`;
- build hash, source fingerprint, Git state and status digest.

The retained final local evidence is regenerated after the requested release commit and records the
clean committed SHA, deployable-source fingerprint, build hash and exact pinned runtime. Production
activation still requires the separately authorized pre-production gate and hosted checks.
The clean committed SHA before production activation is recorded by the final local evidence.

## Preserved boundaries

- Deployment still uses the non-blocking system lock, unique request/state records, immutable
  commit releases, atomic `current` switch, bounded stages, protected retention, failure cleanup,
  interruption recovery and verified application rollback.
- Source must be on `main`, point at the reviewed origin and be clean before and after pull.
  HEAD and `origin/main` must be the same full SHA. There is no reset, force, rebase, fetch/merge
  sequence or implicit merge.
- npm, checks, audit, build, migration, Supabase CLI, Web, Worker and health never receive the
  GitHub pull proxy. The generic bounded-process layer strips any environment name ending in
  `PROXY` or `PROXY_COMMAND`, plus `NODE_OPTIONS`.
- The deployment sudo allowlist remains limited to Lumina units and cannot manage v2rayA,
  HunterAI, Cloudflare Tunnel, Docker, PostgreSQL or the host.

## External production gates

1. Back up and restore-test the target Supabase project, review and apply migrations through `056`.
2. Install the reviewed v2.9.0 Lumina unit templates and remove only Lumina-owned legacy proxy
   drop-ins/dependencies; do not alter v2rayA or HunterAI.
3. Verify production Auth refresh policy permits at least 30 days, real email/Turnstile secrets,
   scheduler heartbeats and every explicitly enabled integration.
4. Run the clean-commit release gate, execute the deploy dry-run, then require hosted liveness and
   structured readiness before any separately authorized production deployment.

The audit, executed plan and final omission review are recorded in
[AUDIT_2026-07-29_V2.9.0.md](AUDIT_2026-07-29_V2.9.0.md),
[REMEDIATION_AND_PRODUCT_PLAN_2026-07-29_V2.9.0.md](REMEDIATION_AND_PRODUCT_PLAN_2026-07-29_V2.9.0.md)
and [FINAL_REAUDIT_2026-07-29_V2.9.0.md](FINAL_REAUDIT_2026-07-29_V2.9.0.md).
