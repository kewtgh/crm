# Implementation status — v3.8.4 release candidate

## Scope

v3.8.4 retains the production shared-host isolation and persistent first-install flow, and makes
the repository adapter the canonical Lumina route source for the existing
`mail-api.ewaya.com` Cloudflare Worker. It does not change database schema semantics, add a CRM Web
mail route, create a second Worker, or create another Custom Domain.

The target remains the fixed `lumina-crm` Compose project on a server shared with HunterAI and
Temporal, but every Lumina Docker client now connects exclusively to a rootless daemon owned by
the `lumina-crm` host user. Cloudflare Tunnel is user-facing and reaches Caddy only at
`127.0.0.1:3211`; Caddy proxies accepted requests to Web at `127.0.0.1:3200`.

## Implemented repository assets

- version-controlled rootless Docker daemon configuration with a Lumina-only data root;
- exact rootless socket, security option, systemd cgroup, and data-root deployment gates;
- Docker-using systemd units that neither require the rootful daemon nor hide `/run/user`;
- non-root storage preparation/cleanup through the fixed root-owned maintenance program;
- corrected Compose/rootless disk monitoring with strict threshold configuration;
- strict remote/local backup retention and paired encrypted database/object verification;
- CSRF-aware secure sign-out with pending, error, fallback redirect, and Chromium coverage;
- immediate stale-search clearing and finite, consistently clamped progress semantics;
- current Compose-only deployment core and contracts, without obsolete v3.6 release logic;
- minimal application image script set, excluding deploy, QA, and smoke controllers;
- Tunnel/Caddy Host, public-readiness, forwarding-header, liveness, and rollback contracts;
- explicit `initialize` request mode with accepted-state gates, repeat-safe recovery, bootstrap
  credential boundaries, forward-only failure state, and first-release null rollback images;
- zero-runtime-dependency email adapter with fixed-time token verification, bounded JSON input,
  nine explicit escaped HTML/text templates, Resend idempotency, stable provider errors, and safe
  logs;
- reuse of the existing `mail-api.ewaya.com/lumina-crm/delivery` production entrypoint with
  `workers.dev` disabled, an explicit existing-Worker deployment name, and secrets excluded from
  Git/Wrangler variables;
- synchronized application, Worker subproject, package, lockfile, and documentation version 3.8.4.

## Local verification recorded

| Check | Result |
| --- | --- |
| Email delivery Worker `npm ci` | Pass: 0 installed dependency vulnerabilities |
| Email delivery Worker `npm test` | Pass: 44/44 |
| Email delivery Worker `npm run lint` | Pass |
| Initialize/first-install targeted deploy contracts | Pass: 26/26 |
| `npm run tunnel:test` | Pass: 9/9 Tunnel/Caddy contracts |
| `npm run test:deploy:raw` | Pass: 35/35 rootless Compose/deploy contracts |
| `npm run typecheck:raw` | Pass |
| `npm run lint:raw` | Pass |
| `npm run test:contracts:raw` | Pass: 44 application contracts + 6 CAPTCHA contracts |
| `git diff --check` | Pass before release commit |

## Not performed / external release gates

No production SSH/deployment, Cloudflare Worker deployment, DNS, Cloudflare Tunnel, Caddy, systemd,
firewall, rootless daemon, or real production Docker resource changed. No full ten-phase Chromium
matrix, complete database suite, runtime Compose integration, Docker image build, real Resend
delivery, encrypted S3 lifecycle, Tunnel route, server reboot, or production recovery drill was run
in this scoped implementation.

Before production deployment, operators must provision non-overlapping subordinate UID/GID ranges,
the lingering rootless user service, cgroup v2 delegation, exact file ownership, real secrets,
independent object-store lifecycle, the Tunnel credential and DNS route, loopback Caddy
environment, and a real recovery exercise.
Any rootful Docker result is a release blocker; there is no fallback.
