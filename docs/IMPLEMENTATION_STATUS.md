# Implementation status — v2.8.4 release candidate

Status date: 2026-07-28

## Outcome

The repository-complete v2.8.4 remediation is implemented and verified. Every successful password,
device-verification, MFA and SSO sign-in now retains a refresh session for 30 days; “remember this
device” controls only device trust. The login page explains that policy and links the requested
`support@ewaya.comm` address.

Lumina Web, Worker, readiness, build/test/smoke processes and the persistent deployment runner now
default to direct external connections. Web, Worker and deploy systemd units clear inherited proxy
variables and have no v2rayA dependency. The only allowed proxy path is temporary
`core.sshCommand` configuration attached to the single
`git pull --ff-only origin main`; it preserves the SSH deploy key and never writes Git config.

Readiness independently bounds and reports environment, Supabase Auth, database, Worker and queue
state. Database failure blocks downstream Worker/queue interpretation instead of fabricating their
failure. Migration `202607280056_v284_readiness_diagnostics` keeps missing and stale Worker counts
distinct. The UI text floor is 12px and the fixed Chromium matrix found no responsive,
accessibility, authentication or business-workflow regression.

No production deployment was executed. No v2rayA, HunterAI or unrelated server service was
modified, stopped or restarted.

## Verification record

| Gate | Result |
| --- | --- |
| Full release gate | Pass in 382 seconds with proxy-free stage environments |
| TypeScript | Pass |
| ESLint | Pass |
| Production build | Pass; v2.8.4 route and production bundles generated without a proxy warning |
| Node contracts | 60/60: 39 source/component contracts, 19 production-deploy tests and 2 root/login HTTP contracts |
| Dependency audit | Pass; 0 vulnerabilities |
| Supabase schema lint | Pass; 0 findings |
| Full pgTAP suite | 468/468 across 12 files |
| Local migration application | Pass through `202607280056_v284_readiness_diagnostics` |
| Business and HTTP smoke | Pass: phase two, v0.9, v1.0 security, v1.1, export and real device-auth |
| Session smoke | Pass; untrusted-device login and refresh rotation retain 30-day refresh/marker cookies |
| Production assets/MIME | Pass; 26 CSS/JS assets, 5 exact PNG assets, metadata and legacy redirect |
| Pinned Chromium | Pass; 10 stages, 80 page/viewports, 0 errors, 0 warnings, 9/9 identities cleaned |

The Git-ignored merged browser report is
`work/browser-qa-chromium-1228/report.json`. It records:

- runtime `ms-playwright/chromium-1228`;
- Chromium `149.0.7827.55`;
- executable
  `C:/Users/Horolf/AppData/Local/ms-playwright/chromium-1228/chrome-win64/chrome.exe`;
- `playwright-core` `1.61.1`;
- application `2.8.4`;
- migration head `202607280056_v284_readiness_diagnostics`;
- base URL `http://localhost:3200`;
- build hash, source fingerprint, Git state and status digest.

The local evidence intentionally records a dirty worktree because it was generated before the
requested release commit. It proves the exact deployable-source fingerprint under review; CI or
the pre-production gate must still rerun against the clean committed SHA before production
activation.

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
2. Install the reviewed v2.8.4 Lumina unit templates and remove only Lumina-owned legacy proxy
   drop-ins/dependencies; do not alter v2rayA or HunterAI.
3. Verify production Auth refresh policy permits at least 30 days, real email/Turnstile secrets,
   scheduler heartbeats and every explicitly enabled integration.
4. Run the clean-commit release gate, execute the deploy dry-run, then require hosted liveness and
   structured readiness before any separately authorized production deployment.

The audit, executed plan and final omission review are recorded in
[AUDIT_2026-07-28_V2.8.4.md](AUDIT_2026-07-28_V2.8.4.md),
[REMEDIATION_AND_PRODUCT_PLAN_2026-07-28_V2.8.4.md](REMEDIATION_AND_PRODUCT_PLAN_2026-07-28_V2.8.4.md)
and [FINAL_REAUDIT_2026-07-28_V2.8.4.md](FINAL_REAUDIT_2026-07-28_V2.8.4.md).
