# Lumina CRM

Current release candidate: **v3.9.2**

Lumina is a bilingual, staff-only education relationship and sales CRM. Schools, contacts, parents,
students and household members are CRM business records; staff identities are stored in the
application-owned authentication schema.

Version 3.8 closes the shared-host isolation gap by moving every Lumina controller, Compose task,
builder and maintenance command to a dedicated rootless Docker user service. Deployment gates
verify the exact user socket, rootless security mode, systemd cgroups and a Lumina-only data root.
It also verifies each encrypted database backup with its matching encrypted local-object archive,
replaces the public Worker gateway with Cloudflare Tunnel to a loopback-only Caddy listener, fixes
the Compose disk monitor and secure sign-out flow, removes stale deployment code, and trims the
runtime image to required scripts.

Version 3.8.30 makes remembered login a server-owned session property: administrators retain a
session for at most 15 days and other staff for at most 30 days, while non-persistent sessions keep
the 12-hour boundary. It also resolves the CI dependency gate with patched transitive pins and a
bounded metadata-image compatibility layer that rejects vulnerable ICNS/JXL/HEIF parsing without
weakening `npm audit`.

Version 3.8.29 makes the management submenu use a same-tab document navigation boundary. This
avoids the unreliable cold client-RSC transition that could make a first submenu click appear inert
until the route had been opened in another tab, while preserving standard modified-click behavior.

Version 3.8.28 separates Worker container liveness from operational queue degradation and release
acceptance. Docker health still requires current schema, database access, and complete fresh Worker
heartbeats, while retryable/stuck job counts remain visible through degraded loopback readiness and
Operations. Deployment captures a sanitized pre-switch queue baseline and rejects only newly
increased failed jobs or unsafe infrastructure/stuck-work conditions; accepted pre-existing failures
produce a stable warning without rollback. Recovery uses the same infrastructure contract.

Version 3.8.27 fixes the staff-invitation delivery protocol boundary. Invitation delivery IDs and
encrypted credentials remain local to the CRM Worker, while the external Email Delivery Worker
receives an explicit seven-field template payload with the temporary credential decrypted only at
delivery time. Producer/consumer contract tests prevent template-schema drift, and bounded
allow-listed remote error codes improve diagnostics without retaining provider response text.

Version 3.8.26 introduces a stable production bootstrap that updates the source and starts a fresh
target-controller Node process before any release work. It also performs bounded, Lumina-labeled
post-acceptance BuildKit, paired-image, deployment-history, and stale-env cleanup without touching
volumes or other Docker projects. The same release makes staff-account governance usable on mobile,
adds server-side lifecycle and role filters, completes action-menu keyboard focus, and brings the
README into the enforced release-version contract. Versions 3.8.20–3.8.25 hardened target-runtime
preflight, application image closure, staff-account confirmations, invitation RLS, atomic Web/Worker
release switching, and deployment-request finalization.

Version 3.8.19 preserves successful asynchronous staff-account creation, adds durable invitation resend delivery, role-specific session retention, and safe staff action menus. Version 3.8.18 separated strict pre-authentication origin checks from authenticated Session CSRF,
so stale browser Session Cookies cannot block CAPTCHA verification, sign-in, SSO, device verification,
or password recovery. It also distinguishes unavailable CAPTCHA configuration from an administrator
disabling Turnstile and aligns authentication Cookie deletion attributes with issuance.

Version 3.8.17 adds bounded automatic cleanup of the fixed Lumina BuildKit cache after every image
build sequence, including failed builds. It preserves the configured retention, maximum, reserved,
and minimum-free-space limits without invoking global Docker prune or deleting accepted images.

Version 3.8.16 preserves the Phase 2 communication-delivery ownership switch and fixes staff-account
creation so a committed account is never deleted or reported as a form failure merely because the
invitation email response is ambiguous. The create dialog closes after acceptance, the account appears
immediately as awaiting email confirmation/first sign-in, and an unconfirmed delivery receives a
specific non-destructive notice.

Version 3.8.15 made the dedicated `COMMUNICATION_DELIVERY` Worker the sole owner of external
communication email delivery. Web requests now return durable queued state without recipient lookup
or provider I/O; fenced Worker attempts use bounded concurrency, stable provider idempotency,
conservative uncertainty recovery, independent heartbeat/readiness, and asynchronous UI status.
The v3.8.14 database expansion and legacy Web credentials/RPCs remain for one rollback release.

Version 3.7 moved production to the fixed `lumina-crm` Docker Compose project. PostgreSQL, Web,
Worker, migrations, encrypted backup/restore, commit-tagged image release, application-only
rollback, and Lumina-only cleanup have explicit container and credential boundaries. HunterAI and
Temporal resources are never shared or managed by Lumina.

Version 3.5 closed the organization-wide business-date architecture gate. Each workspace now has a
constrained, audited business timezone that administrators can change only with AAL2; user and
workspace-scoped Worker transactions apply it locally so existing PostgreSQL date rules agree.
Contract countdowns use the same business date. Pending mutation drawers cannot be dismissed through
Escape, overlay, close or cancel controls; legacy timestamps use personal display preferences; and
the task priority queue reports when its 12-item summary is truncated and links to the full list.
Administrators can also switch Cloudflare Turnstile off for constrained networks; sign-in, SSO and
password recovery then enforce the self-hosted ALTCHA verifier instead of bypassing CAPTCHA.
The production runtime remains designed for one shared VPS:

```text
configured public hostname
  -> Cloudflare Tunnel
     -> Caddy 127.0.0.1:3211
        -> Web 127.0.0.1:3200
           -> Compose Web / Worker / private PostgreSQL
```

The application has no managed-platform SDK or API dependency. It uses separate application,
system, Worker, migration and backup database roles. Authentication uses Argon2id passwords,
opaque server-side sessions, HttpOnly cookies, CSRF protection, encrypted TOTP secrets, replay
prevention, recovery codes, email verification, password reset, trusted devices, OIDC SSO and SCIM.
Database Row Level Security remains enabled as defense in depth, with the user and workspace context
set by the application.

Files are stored through a local-persistent/S3-compatible abstraction. PostgreSQL migrations are
ordered, checksummed, protected by an advisory lock and kept under `db/migrations`. Production
PostgreSQL publishes no host port and joins only the internal Lumina backend. Daily encrypted
backups go to an independent object store;
monthly restore verification creates and destroys only a uniquely named temporary database.

## Local development

Requirements:

- Node.js 24.x (`24.18.0` is pinned in `.nvmrc`);
- npm 12.x (`12.0.1` is pinned in `package.json`);
- Docker Desktop.

```bash
npm install
npm run env:configure-local
npm run dev
```

`env:configure-local` starts PostgreSQL 18 on `127.0.0.1:55432`, creates the least-privilege roles,
applies all migrations and bootstraps the local administrator. It preserves unrelated local
integration values, removes retired platform keys and never prints generated secrets.

Useful database commands:

```bash
npm run db:migrations:verify
npm run db:migrate
npm run db:smoke
npm run smoke:phase2
npm run smoke:v09
npm run smoke:v11
```

Run the enabled queue processors once:

```bash
npm run workers:process
```

Independent Worker categories run in parallel. `WORKER_JOB_CONCURRENCY` limits work inside each
category to 1–8 jobs (default 4); the runtime also validates each batch/concurrency combination
against a 210-second external-I/O budget. `WORKER_DATABASE_POOL_MAX` is a per-process ceiling, so
capacity planning must account for all enabled categories. Mail providers must honor the stable
`Idempotency-Key` header before production delivery is enabled.

Production email delivery is isolated in
[`infrastructure/email-delivery-worker`](infrastructure/email-delivery-worker/README.md). The
generic Cloudflare Worker is developed and tested on Windows, but Windows never stores its real
name, domain, URL, sender, Cloudflare account ID/API token, or any production Env and never performs
a production Wrangler deployment. Ubuntu alone stores production deployment configuration at
`/etc/lumina-crm/secrets/email-worker-deploy.env`, pulls the audited commit, runs the explicit
dry-run, deploys the existing Worker in place, and checks only its health endpoint. The tracked
Wrangler configuration contains no Worker name, domain, route, account ID, sender, or production
URL. Both workers.dev and Preview URLs are disabled. Routine strict deployment derives its sole
Custom Domain from the Ubuntu server-local Env, verifies through the read-only Domains API that it
already belongs exclusively to the target Worker, and renders the complete name/route/vars/
Observability contract into a mode-0600 temporary JSON under a mode-0700 runtime directory.
Dashboard remains available for initial domain creation, inspection, and emergency rollback. The
existing `LUMINA_WEBHOOK_TOKEN` and `RESEND_API_KEY` values remain remote-only and are never read or
changed. Sanitized Wrangler failures retain a bounded diagnostic tail while all server-supplied
deployment values remain redacted. CRM application initialization and email Worker deployment are
separate stages.

## Verification and deployment

For a bounded repository check:

```bash
npm run typecheck
npm run lint
npm run test:contracts
npm run test:deploy
npm run build
```

The repository also includes the pinned `ms-playwright/chromium-1228` browser workflow. Run only the
phase relevant to a scoped change, or the staged matrix when preparing an authorized release.

On a new Linux VPS, first run the explicit persistent initialization mode. It adds repeat-safe
database role/extension and initial-admin bootstrap around the forward-only migration, then records
the first accepted release with no rollback image. Ordinary deploy refuses to run before this
accepted state exists and never invokes either bootstrap step.

Production deployment is a two-stage control plane. A long-lived-protocol bootstrap performs the
single source fast-forward and then starts a fresh Node process from the target commit. A controller
never deploys a release after mutating its own source tree.

```text
stable bootstrap: lock -> validate request/source -> fetch -> exact target SHA -> ff-only update
fresh target controller: source/commit TOCTOU verification -> release workflow
```

The target controller performs:

```text
target-controller re-exec and exact commit evidence
-> rootless Docker/state capacity gate
-> isolated Lumina BuildKit verification
-> metadata-only Compose secret-source permission gate
-> containerized checks and commit-tagged app/ops images
-> migration verification and locked forward migration
-> sanitized pre-switch queue-health baseline
-> Compose Web/Worker image switch
-> independent PostgreSQL/Web/Worker health
-> loopback release-health acceptance and Cloudflare Tunnel public liveness
-> persist accepted/rollback images
-> bounded Lumina-only BuildKit, paired-image, history, and stale-env cleanup
post-switch failure -> application-image rollback; database stays forward
```

Storage prepare, post-build cache cleanup, post-acceptance storage cleanup, and the deployment runner share
`/var/lib/lumina-crm/docker-config` as their only Docker client configuration root and
`/var/lib/lumina-crm/docker-config/buildx` as their only Buildx configuration root. The separate
`/var/lib/lumina-crm/storage-maintenance` tree retains only the builder ownership marker, reports,
and maintenance state. An obsolete configuration directory at that location is never adopted,
copied, or deleted automatically; its presence requires operator review. After a source
fast-forward, the audited maintenance program must be installed separately as the fixed root-owned
`/usr/local/libexec/lumina-crm-storage-maintenance.mjs` before first initialization or deployment.

Every accepted release triggers bounded cleanup of only the fixed `lumina-crm-buildkit`, exactly
labeled `kewtgh/crm` image pairs, and expired deployment history. Current, rollback, running, target,
and recent accepted images remain protected, with at least three complete releases retained.
Volumes are never automatically pruned. Generic Docker system/image/container/volume/network prune
commands are prohibited. Cleanup failure is warning-only and never changes application acceptance
or triggers rollback.

The configured Git proxy, when present, is used for the first and only fetch; otherwise that single
fetch is direct. It is never persisted as Git, Docker, or systemd configuration. Containers clear
proxy variables. Database migration is forward-only; application rollback never claims to reverse
an applied schema migration.

Hosts that require a separate proxy for image construction can set the optional server-local
`LUMINA_DOCKER_PROXY`. It is validated as a credential-free HTTP(S) URL and is exposed only to the
isolated BuildKit container and the three `buildx build` processes. The fixed builder uses
`network=host` inside Lumina's rootless Docker/RootlessKit network namespace so it can reach the
same host-loopback proxy entry as the rootless daemon; this is not the physical host/rootful Docker
network and never connects to HunterAI resources. Git continues to use only
`LUMINA_GIT_PROXY`; Compose services, migrations, health probes, and runtime containers remain
proxy-free. Logs and deployment state redact the configured Docker proxy, while the builder marker
stores only its enabled state, SHA-256 fingerprint, and non-sensitive `host` network contract.

```bash
npm run deploy:production:dry-run
npm run deploy:production:initialize
npm run deploy:production
npm run deploy:production:status
npm run deploy:production:logs
npm run deploy:production:rollback
```

See the current [deployment runbook](docs/DEPLOYMENT.md),
[backup/restore runbook](docs/BACKUP_RESTORE.md), [rollback runbook](docs/ROLLBACK.md), and
[implementation status](docs/IMPLEMENTATION_STATUS.md). Versioned v3.6 and earlier deployment audits
are historical/obsolete for production provisioning. The PostgreSQL transition history remains
in the [migration audit](docs/SUPABASE_EXIT_AUDIT_AND_TARGET_ARCHITECTURE_2026-07-29.md) and
[completion and gap review](docs/POSTGRESQL_MIGRATION_COMPLETION_AND_GAP_REVIEW_2026-07-29.md).

## Health

- `GET /api/health` checks Web process liveness and release version.
- `GET /api/health?mode=ready` is loopback-only and reports environment, authentication schema,
  database, Worker and queue status independently with stable reason codes for local deployment
  probes. Failed or stuck jobs keep this endpoint degraded even when Docker Worker health is healthy.
  Public requests receive only the minimal liveness endpoint.

External providers remain disabled until genuine credentials and data-processing approval are
supplied. The UI does not present a simulated provider connection, delivery, Worker heartbeat,
backup or security state as real.
