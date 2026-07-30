# Implementation status — v3.8.2 release candidate

## Scope

v3.8.2 retains the production shared-host isolation and disaster-recovery evidence completed in
v3.8.0, and adds a fail-closed, persistent first-install mode for the self-hosted PostgreSQL
environment. It does not change database schema semantics or introduce a speculative CRM module.

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
- synchronized application, integration-image, package, lockfile, and documentation version 3.8.2.

## Local verification recorded

| Check | Result |
| --- | --- |
| Initialize/first-install targeted deploy contracts | Pass: 26/26 |
| `npm run tunnel:test` | Pass: 9/9 Tunnel/Caddy contracts |
| `npm run test:deploy:raw` | Pass: 35/35 rootless Compose/deploy contracts |
| `npm run typecheck:raw` | Pass |
| `npm run lint:raw` | Pass |
| `npm run test:contracts:raw` | Pass: 44 application contracts + 6 CAPTCHA contracts |
| `git diff --check` | Pass before release commit |

## Not performed / external release gates

No production SSH/deployment, DNS, Cloudflare Tunnel, Caddy, systemd, firewall, rootless daemon, or real
production Docker resource changed. No full ten-phase Chromium matrix, complete database suite,
runtime Compose integration, Docker image build, real encrypted S3 lifecycle, provider delivery,
Tunnel route, server reboot, or production recovery drill was run in this scoped implementation.

Before production deployment, operators must provision non-overlapping subordinate UID/GID ranges,
the lingering rootless user service, cgroup v2 delegation, exact file ownership, real secrets,
independent object-store lifecycle, the Tunnel credential and DNS route, loopback Caddy
environment, and a real recovery exercise.
Any rootful Docker result is a release blocker; there is no fallback.
