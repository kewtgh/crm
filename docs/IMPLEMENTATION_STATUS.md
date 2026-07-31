# Implementation status — v3.8.16 release candidate

## Scope

v3.8.16 retains the production shared-host isolation, persistent first-install flow, complete email
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
- one owner-checked, non-symlink Docker configuration root shared by deploy, prepare, and cleanup,
  with fail-closed handling for the obsolete maintenance-local configuration path;
- a credential-free HTTP(S) Docker build proxy allowlist, fixed rootless BuildKit `network=host`,
  four exact driver environment options, value-free predefined build arguments, buildx-only
  subprocess environment, redaction, and marker network/proxy fingerprint drift detection;
- a minimal verification build context that keeps the documentation tree excluded while restoring
  the deployment contract consumed by containerized production-deploy tests;
- a metadata-only preflight for the fixed file-backed Compose secret sources, with host directory
  traversal restricted by `root:lumina-crm`/`0750` and container-readable regular files fixed at
  `root:lumina-crm`/`0644` for runtime UID/GID `10001:10001`;
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
- Worker-only active consumption of CRM email delivery credentials, with Web template values
  retained solely for one-release rollback compatibility and no provider readiness probe;
- a dedicated communication delivery category with durable queue acceptance, distinct provider
  attempts, fenced leases/completion, bounded retry/time budget, conservative uncertainty handling,
  independent heartbeat/readiness and audited retry;
- synchronized application package, lockfile, runtime, Compose test fixture, and documentation
  version 3.8.16; the independently deployed Cloudflare Worker code and metadata are unchanged;
- durable staff-account creation with transactional base audit, non-destructive ambiguous invitation
  handling, immediate pending-directory visibility, dialog closure, and explicit bilingual status.

## Local verification recorded

| Check | Result |
| --- | --- |
| Root `npm ci` | Pass: 566 packages installed, 572 audited, 0 vulnerabilities |
| Communication delivery Phase 2 application contracts | Pass: 9/9, including queue-only Web ownership, attempt-start ordering, durable idempotency, fenced completion, provider classification, uncertainty, time budget, heartbeat/readiness, Operations and UI |
| Communication delivery Phase 1 migration | Pass: clean standard migration 76/76 through the Phase 2 switch; parent-069 representative QUEUED, FAILED, SENT, RECEIVED, and DELIVERED rows unchanged |
| Communication delivery Phase 1 SQL behavior | Pass: concurrent claim isolation, `SKIP LOCKED`, fencing, safe/uncertain lease recovery, provider receipts, bounded backoff/attempts, consent, recipient, grants, audited retry, and synchronous Web compatibility |
| Communication delivery Phase 2 SQL behavior | Pass: durable queue identity, duplicate idempotency, Worker claim/start/completion, independent heartbeat/readiness metrics, Operations queue exposure, and retained rollback grants |
| Verification image `docker build --target verification --output type=cacheonly .` | Pass: containerized build, contracts, and deploy tests completed with `docs/DEPLOYMENT.md` present |
| Isolated production Compose runtime | Pass: 76 migrations, Web/Worker health, communication heartbeat-aware readiness, stale-worker failure, PostgreSQL recovery, forward-schema rollback, volume preservation and cleanup |
| Email delivery Worker `npm ci` | Pass: install completed and 35 packages audited; npm reported 0 vulnerabilities |
| Email delivery Worker `npm test` | Pass: 61/61 |
| Email delivery Worker `npm run test:deployment` | Pass: 54/54, including Wrangler 4.102.0 no-upload strict dry-run, complete generated config parity, Custom Domain preflight, 0700/0600 owner/symlink contracts, cleanup, and bounded full-value output redaction |
| Email delivery Worker `npm run lint` | Pass |
| Windows production deployment rejection | Pass: `PRODUCTION_DEPLOY_REQUIRES_LINUX` before Env access or Wrangler |
| Initialize/first-install targeted deploy contracts | Pass: 26/26 |
| `npm run tunnel:test` | Pass: 9/9 Tunnel/Caddy contracts |
| `npm run test:deploy:raw` | Pass: 53/53 email-runtime/version/rootless Compose/deploy/secret-source/verification-context/BuildKit host-network/proxy/Tunnel contracts |
| `npm run typecheck:raw` | Pass |
| `npm run lint:raw` | Pass |
| `npm run test:contracts:raw` | Pass: 58 application contracts + 6 CAPTCHA contracts |
| Tracked-tree production identifier / retired Env / deployment-command scans | Pass |
| `git diff --check` | Pass before release commit |

## Not performed / external release gates

No production SSH/deployment, Cloudflare Worker deployment, DNS, Cloudflare Tunnel, Caddy, systemd,
firewall, rootless daemon, or real production Docker resource changed. No full ten-phase Chromium
matrix, complete database suite, production image publication, real Resend
delivery, encrypted S3 lifecycle, Tunnel route, server reboot, or production recovery drill was run
in this scoped implementation.

Before production deployment, operators must provision non-overlapping subordinate UID/GID ranges,
the lingering rootless user service, cgroup v2 delegation, exact file ownership, real secrets,
independent object-store lifecycle, the Tunnel credential and DNS route, loopback Caddy
environment, and a real recovery exercise.
Any rootful Docker result is a release blocker; there is no fallback.
