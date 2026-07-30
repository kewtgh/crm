# Lumina CRM v3.8 production deployment

This is the only current production runbook. Documents describing host-installed PostgreSQL,
host Node Web/Worker processes, immutable npm release directories, or Caddy as the user-facing
endpoint are historical v3.6-and-earlier records.

Lumina's fixed Compose project is `lumina-crm`; its databases, networks, volumes, images, builder,
logs, backups, and release state must remain separate from HunterAI, Temporal, and every other
project. Lumina uses its own **rootless Docker daemon**. It must never connect to the shared rootful
daemon or `/var/run/docker.sock`.

## Architecture and inventory

```text
configured public hostname
  -> Cloudflare Tunnel
  -> host Caddy on 127.0.0.1:3211
  -> Web on 127.0.0.1:3200
  -> lumina-crm Web container
  -> lumina-crm PostgreSQL on the internal backend network
```

`compose.production.yml` is the unique production Compose entry point.

| Boundary | Production object |
| --- | --- |
| Compose project | `lumina-crm` |
| Long-running services | `postgres`, `web`, `worker` |
| One-shot services | `db-bootstrap`, `migration-verify`, `migrate`, `bootstrap-admin`, `backup`, `restore-test` |
| Backend network | `lumina-crm-backend`, `internal: true` |
| Edge/outbound network | `lumina-crm-edge` |
| Database volume | external `lumina-crm-postgres-data` |
| Local objects volume | external `lumina-crm-objects` |
| Encrypted backup volume | external `lumina-crm-backups` |
| Builder | `lumina-crm-buildkit` only |
| Docker daemon | rootless user service owned by host user `lumina-crm` |
| Docker data root | `/var/lib/lumina-crm/docker` |
| Docker socket | `/run/user/<lumina uid>/docker.sock` |
| Host Caddy listener | `127.0.0.1:3211` |
| Host Web publication | `127.0.0.1:3200:3200` |

PostgreSQL 18.4 joins only backend and publishes no host port. Web and Worker join backend plus edge
and never use host networking. Database URLs use the `postgres` service DNS name.

## HunterAI isolation and prohibited operations

Do not join, reuse, stop, restart, or clean any HunterAI, Temporal, or foreign container, network,
volume, image, database, daemon, or builder. Do not add Lumina to another Compose project.

Compose labels are an operational allowlist, not a security boundary for a shared rootful Docker
socket. Membership in the host `docker` group is root-equivalent. The `lumina-crm` host user must
not belong to that group and must not have permission to read/write the rootful socket. All Lumina
units receive one exact `DOCKER_HOST` pointing to the user's rootless socket.

Never run these for Lumina:

```text
docker system prune
docker system prune -a
docker image prune -a
docker volume prune
docker builder prune
docker compose down -v
```

Release and rollback use `docker compose up -d`, never `down`. Cleanup considers only image IDs
returned by all three exact Lumina labels. Before deletion it rechecks those labels, an exact
`lumina-crm[-ops]:<40-char-commit>` tag, container use, age/retention, and the protected
current/rollback/recent set. Cache GC selects only `lumina-crm-buildkit`. Cleanup never removes a
container, network, or volume.

## Host provisioning

Provision Ubuntu with Docker Engine, the rootless extras, Compose, Buildx, `uidmap`, Caddy,
`cloudflared`, Git, and Node 24 only for the deployment controller. Do not install/run PostgreSQL
or CRM Web/Worker with host systemd. Rootless mode requires cgroup v2 + systemd so Compose
memory/CPU/PID limits are actually enforced, plus at least 65,536 subordinate UIDs and GIDs for
`lumina-crm`.

```text
/opt/lumina-crm/source                    checked-out kewtgh/crm main
/etc/lumina-crm/deploy.env                non-secret deployment settings
/etc/lumina-crm/caddy.env                 Caddy public Host allowlist
/etc/cloudflared/config.yml               Tunnel ingress configuration
/etc/cloudflared/<tunnel-id>.json         Tunnel credential managed outside Git
/etc/lumina-crm/secrets/                  root-owned Compose secret sources
/var/lib/lumina-crm/deployments/          accepted image/deployment state
/var/lib/lumina-crm/docker/               Lumina rootless Docker data root
/var/lib/lumina-crm/docker-config/        Lumina-only Buildx configuration
/var/lib/lumina-crm/storage-maintenance/  builder ownership/cleanup state
/var/log/lumina-crm/                      deployment/maintenance logs
```

Set the `lumina-crm` account home to `/var/lib/lumina-crm`, assign non-overlapping ranges in
`/etc/subuid` and `/etc/subgid`, then install the rootless user service using Docker's supported
`dockerd-rootless-setuptool.sh install --force` flow. Use a real PAM/systemd login or
`machinectl shell lumina-crm@`; `sudo su` does not create the required user manager. Enable linger:

```sh
sudo loginctl enable-linger lumina-crm
sudo gpasswd -d lumina-crm docker 2>/dev/null || true
```

Install `deploy/rootless-docker/daemon.json` as
`/var/lib/lumina-crm/.config/docker/daemon.json`, owned by `lumina-crm`, then restart the user's
Docker service. Set this exact value in `/etc/lumina-crm/deploy.env`, replacing the example UID:

```sh
lumina_uid="$(id -u lumina-crm)"
export DOCKER_HOST="unix:///run/user/${lumina_uid}/docker.sock"
sudo -u lumina-crm env DOCKER_HOST="$DOCKER_HOST" docker info
```

The server section of `docker info` must list `rootless`, cgroup driver `systemd`, and Docker root
dir `/var/lib/lumina-crm/docker`. A rootful result, missing cgroup delegation, wrong data root, or
wrong socket is a deployment blocker. Do not fall back to the rootful daemon. See Docker's official
rootless documentation: <https://docs.docker.com/engine/security/rootless/>.

Install the reviewed systemd, sudoers, Caddy, BuildKit, and maintenance assets from `deploy/`.
`lumina-crm.service` invokes only fixed Compose startup/reload commands. Backup/restore timers invoke
only their fixed Lumina Compose task. The deploy service holds
`/var/lib/lumina-crm/deploy.lock`. Docker-using units keep `/run/user` read-only but visible so the
rootless Unix socket remains reachable; the application unit retries if the lingering user service
has not finished starting at boot.

The controller writes one exclusive `request.json` with mode `initialize`, `deploy`, or `rollback`.
The systemd runner records that mode in its log, per-deployment state, and `latest.json`.
`last-success.json` remains the accepted release contract used by later deploy and rollback
requests. An interrupted, non-terminal request remains in place: rerun the same mode to recover its
existing request ID. Do not delete or edit these files to bypass a deployment gate.

Ensure the pinned PostgreSQL 18.4 image is present, then create the three explicit external volumes:

```sh
sudo -u lumina-crm env DOCKER_HOST="$DOCKER_HOST" docker pull postgres:18.4-bookworm
sudo -u lumina-crm env DOCKER_HOST="$DOCKER_HOST" \
  /opt/lumina-crm/source/deploy/scripts/provision-volumes.sh
```

The script verifies exact labels before adopting an existing volume and refuses foreign volumes.
It uses that pinned image with `--network none`, no secrets, and only `CHOWN` capability to make
the objects and encrypted-backup volume roots writable by runtime UID/GID 10001. It never mounts
or changes the PostgreSQL volume in that helper. Never replace the PostgreSQL volume during update
or rollback.

Install each `deploy/*.env.example` secret template as its basename without `.example` under
`/etc/lumina-crm/secrets`, root-owned and mode `0640`. Install the PostgreSQL password alone at:

```text
/etc/lumina-crm/secrets/postgres-superuser-password.txt
```

Compose mounts the files under `/run/secrets`; the entrypoint exports only the selected file to its
child process. Secret values are not placed in Compose YAML or image build arguments.

Run the storage prepare unit once. The fixed root-owned program executes as non-root
`lumina-crm`; it verifies the rootless socket/security/cgroup/data-root contract, capacity, and
only the marked `lumina-crm-buildkit` builder:

```sh
sudo systemctl start lumina-crm-storage-prepare.service
sudo systemctl status lumina-crm-storage-prepare.service
```

## Credential boundaries

| File / consumer | Database identity and other secrets |
| --- | --- |
| `production.env` / Web | `crm_app`, `crm_system`, auth and object-signing secrets |
| `worker.env` / Worker | `crm_worker`, delivery/integration and object-store credentials |
| Email delivery Cloudflare Worker | CRM webhook token plus Worker-only Resend API key |
| `database-bootstrap.env` | PostgreSQL administrator plus five role passwords |
| `migration.env` | `crm_migrator` only |
| `bootstrap-admin.env` | `crm_system` plus one-shot CRM admin input |
| `backup.env` | read-only `crm_backup`, encryption/off-host credentials |
| `restore.env` | restore administrator plus encryption key |
| Cloudflare Tunnel | tunnel credential file managed by `cloudflared` |
| Caddy | no shared authentication secret; configured public Host only |

Web/Worker reject migration, backup, restore, and database-administrator variables. Backup rejects
every write-capable database URL. No normal runtime service receives migration, backup, or
PostgreSQL administrator credentials.

All containers clear uppercase/lowercase proxy variables and set `NO_PROXY` for `postgres` and
local services. Set `LUMINA_GIT_PROXY=http://127.0.0.1:20271` in
`/etc/lumina-crm/deploy.env` when the production host requires the controlled Git proxy. The
deploy runner injects that value as `HTTP_PROXY` and `HTTPS_PROXY` only into its first and only
Git fetch subprocess. When it is unset or empty, the runner makes one direct fetch. It performs no
fallback retry, never writes Git proxy configuration, redacts the configured value from deployment
logs and errors, and never places it in Compose or container environments.

## First database start

After installing all secret files and provisioning the external volumes, initialize a new
self-hosted PostgreSQL environment with the persistent production controller:

```sh
npm run deploy:production:initialize
```

To return after systemd accepts the request, use:

```sh
npm run deploy:production:initialize:detach
```

Initialization is explicit and is never inferred by `npm run deploy:production`. It is accepted
only while `last-success.json` is absent. Conversely, ordinary deploy fails closed until an
accepted release exists and directs the operator to the initialize command. Once initialization
succeeds, another initialize request fails before image building or database changes. The first
accepted release records every rollback field as `null`.

The initialize runner performs capacity/builder/rootless checks, the single proxied-or-direct
ff-only Git update, all three image builds, and candidate Compose environment creation before it
starts PostgreSQL. Database work is then strictly:

```text
PostgreSQL healthy
-> db-bootstrap
-> migration-verify
-> migrate
-> bootstrap-admin
-> Compose up Web/Worker
-> PostgreSQL/Web/Worker health, loopback readiness, and Tunnel public liveness
-> accepted state and Lumina-only cleanup
```

`db-bootstrap` is repeat-safe but rotates role passwords to supplied values. It provisions
`pgcrypto`, `citext`, and `pg_stat_statements` in the `extensions` schema; it does not migrate.
`migrate` retains the advisory lock, SHA-256 checksums,
modified-applied-migration rejection, one transaction per migration, lock/statement timeouts, and
forward-only policy. `bootstrap-admin` creates the initial account only when absent and does not
rotate an existing password unless `ADMIN_ROTATE_PASSWORD` was explicitly enabled. These
repeat-safe/forward-only properties allow an interrupted initialize request to rerun without reset,
database drop, migration rollback, or a second request ID. Web/Worker never migrate at startup.

`ADMIN_PASSWORD` is a one-shot input. It and all other secret-file values are excluded from Compose
YAML, image build arguments, deployment logs, and request/latest/accepted JSON. After
initialization succeeds, delete or clear `ADMIN_PASSWORD` in the root-owned
`bootstrap-admin.env`; the non-root runner only prints this instruction and never modifies that
file.

The repository's Windows validation harnesses create unique `lumina-crm-it-*` /
`lumina-crm-rt-*` projects and remove only their exact resources:

```powershell
.\scripts\test-compose-database-integration.ps1
.\scripts\test-compose-runtime-integration.ps1 `
  -ApplicationImage lumina-crm-validation:3.8.4 `
  -OperationsImage lumina-crm-ops-validation:3.8.4
```

They are local integration tests, not production deployment commands.

## Worker operation and health

The Compose-managed Worker loop verifies `service_schema_version()` before each cycle, acquires the
session advisory lock `lumina-crm-worker-cycle`, and runs enabled categories in parallel. Existing
lease tokens, per-category bounded concurrency, heartbeat/queue state, idempotency, retry/backoff,
four-minute cycle limit, and 210-second external budget remain unchanged. Another cycle cannot
overlap while the advisory lock is held.

Worker health queries the real schema version, database readiness, required heartbeat freshness,
and failed/stuck queue counts. A live Node process alone is not healthy.

## Existing mail-api email delivery Worker

The independently deployed source under `infrastructure/email-delivery-worker/` is the canonical
implementation of Lumina's route on the existing production mail-api Worker. It is not a CRM Web
route, is not built into the application image, and is not deployed by `deploy:production`. Reuse
the existing Custom Domain and endpoint:

```text
https://mail-api.ewaya.com
https://mail-api.ewaya.com/lumina-crm/delivery
```

Set that endpoint as `EMAIL_DELIVERY_WEBHOOK_URL` in the root-owned production `worker.env`.
`EMAIL_DELIVERY_WEBHOOK_TOKEN` must exactly match the Worker's
`LUMINA_WEBHOOK_TOKEN` secret. The Resend API key exists only as the Worker's
`RESEND_API_KEY` secret and must never be copied to the CRM host. Neither secret belongs in Git,
Wrangler variables, build output, logs, or status files.

Before any Worker deployment, confirm the existing Worker name in Cloudflare Dashboard and pass
that exact value through Wrangler's `--name` option. The committed configuration deliberately has
no Worker `name`; never invent one, create a second Custom Domain, or bind
`mail-api.ewaya.com` to a new Worker. Preserve the existing `LUMINA_WEBHOOK_TOKEN` when possible,
and do not regenerate, replace, or upload `RESEND_API_KEY` as part of a code deployment.

The existing plaintext bindings are `CRM_APP_URL=https://crm.ewaya.com` and
`EMAIL_FROM=Lumina CRM <notifications@notify.ewaya.com>`; `EMAIL_REPLY_TO` is optional. The
committed configuration sets `keep_vars=true` so unrelated existing plaintext bindings are not
removed. Wrangler deployments preserve secrets unless an operator explicitly changes or deletes
them.

The adapter forwards the CRM `Idempotency-Key`, accepts only the mechanically derived template
allow-list, escapes all payload values, creates both HTML and text bodies, and never accepts
client-provided sender/envelope HTML. Supported keys are:

```text
reminder
password-reset
device-verification
email-verification
staff-account-created
communication-message
calendar-invite
calendar-update
calendar-cancel
```

The actual database calendar delivery types are `INVITE`, `UPDATE`, and `CANCEL`; the CRM produces
the corresponding `calendar-*` keys above. See the subproject README for `npm ci`, tests, existing
Worker-name confirmation, health verification, controlled delivery testing, and the explicit
`npx wrangler deploy --name <EXISTING_MAIL_API_WORKER_NAME>` operator command. Repository
validation does not execute that deployment.

## Cloudflare Tunnel and loopback Caddy gateway

Set one production hostname in `/etc/lumina-crm/deploy.env` and
`/etc/lumina-crm/caddy.env`. Configure the same value as both `hostname` and `httpHostHeader` in
`/etc/cloudflared/config.yml`; use `deploy/cloudflare-tunnel/config.yml.example` as the template.
The Tunnel service must target `http://127.0.0.1:3211` and end with an `http_status:404` catch-all.
There is no independent public origin hostname and no shared origin secret.

Install `deploy/caddy/Caddyfile` and load `/etc/lumina-crm/caddy.env` from the Caddy systemd unit.
Caddy listens only on `127.0.0.1:3211`, accepts only the configured Host, returns 404 for public
`/api/health?mode=ready`, and proxies all other accepted requests to `127.0.0.1:3200`. It discards
incoming forwarding headers and rebuilds the client address from Cloudflare's `CF-Connecting-IP`.
Create a Caddy systemd drop-in containing the following, then validate and restart both services:

```ini
[Service]
EnvironmentFile=/etc/lumina-crm/caddy.env
```

```sh
caddy validate --config /etc/caddy/Caddyfile
cloudflared tunnel ingress validate
sudo systemctl daemon-reload
sudo systemctl restart caddy cloudflared
```

Remove any Worker route bound to the production hostname before routing DNS to the Tunnel. Keep
the host firewall closed to inbound Web/Caddy ports; `cloudflared` reaches Caddy over loopback.
Cloudflare Access and Tunnel transport do not replace Lumina CRM login, MFA, CAPTCHA, rate
limiting, trusted-device logic, or the other application-layer controls.

```sh
LUMINA_PUBLIC_HOSTNAME=crm.example.com \
LUMINA_CADDYFILE=/etc/caddy/Caddyfile \
LUMINA_TUNNEL_CONFIG_FILE=/etc/cloudflared/config.yml \
npm run tunnel:config:verify
npm run tunnel:test
```

Replace `crm.example.com` with the production hostname. Tunnel creation/credentials, DNS routing,
Caddy installation, and application deployment are separate production actions.

## Image deployment and rollback

```sh
npm run deploy:production:initialize
npm run deploy:production
npm run deploy:production:status
npm run deploy:production:logs
npm run deploy:production:rollback
npm run deploy:production:dry-run
```

For initialization, the persistent runner performs:

```text
exclusive Lumina lock
-> reject if accepted state already exists
-> capacity gate and isolated builder verification
-> exact clean main/origin verification and one fetch
-> containerized type/lint/contracts plus commit-tagged app/ops builds
-> PostgreSQL health
-> repeat-safe database role/extension bootstrap
-> migration manifest verification and locked forward migration
-> repeat-safe initial administrator bootstrap
-> Compose up Web/Worker (never down)
-> independent PostgreSQL/Web/Worker health
-> loopback detailed readiness
-> Cloudflare Tunnel public liveness at https://<LUMINA_PUBLIC_HOSTNAME>/api/health
-> persist accepted state with null rollback images
-> Lumina-only cleanup
```

Ordinary deploy first requires accepted state, then uses the same prepare, fetch, build, PostgreSQL,
migration, switch, acceptance, persistence, and cleanup path. It never invokes `db-bootstrap` or
`bootstrap-admin`.

Pre-switch failure leaves Web/Worker unchanged and does not attempt application rollback.
Post-switch failure uses the existing image rollback logic and rechecks locally; a first
initialization has no prior image and records rollback as unavailable. Neither path reverses a
migration, and application rollback reports: “Application rolled back; database remains on the
forward schema.” Each migration must remain compatible with the rollback application until
acceptance. Cleanup starts only after acceptance; cleanup failure is a warning. Accepted state is
persisted first so interruption can resume finalization safely.

## Daily status, logs, and health

```sh
docker compose --project-name lumina-crm \
  --env-file /var/lib/lumina-crm/deployments/compose.env \
  -f /opt/lumina-crm/source/compose.production.yml ps
docker compose --project-name lumina-crm \
  --env-file /var/lib/lumina-crm/deployments/compose.env \
  -f /opt/lumina-crm/source/compose.production.yml logs --tail=200 web worker postgres
curl -fsS http://127.0.0.1:3200/api/health
curl -fsS 'http://127.0.0.1:3200/api/health?mode=ready'
curl -fsS "https://${LUMINA_PUBLIC_HOSTNAME}/api/health"
```

Detailed loopback readiness independently reports Web environment, auth schema, database, Worker
heartbeats, and queues. A live Web with failed database is not ready. Public acceptance traverses
the Cloudflare Tunnel and remains a mandatory release condition.

## Backup, object storage, reboot, and diagnosis

See `docs/BACKUP_RESTORE.md`. Backup uses `crm_backup`, custom-format pg_dump, and AES-256-GCM before
local persistence/upload. Local-object mode also encrypts an archive of the external objects
volume. Runtime and backup S3 bucket/account/prefix authorization must be independent. Remote
lifecycle is provider-managed. Images/releases never contain or delete object bytes.

PostgreSQL, Web, and Worker use `restart: unless-stopped`. The linger-enabled rootless Docker user
service restores them after reboot; Web and Worker wait for PostgreSQL health, and Worker refuses
consumption until migrations are current.
External volumes retain data. Backup/restore timers still call fixed Compose tasks. Validate reboot
behavior only with an isolated test project/container recreation, never by rebooting development or
production during repository testing.

Diagnose only exact Lumina resources:

```sh
systemctl status lumina-crm-deploy.service lumina-crm-backup.timer lumina-crm-restore-test.timer
journalctl -u lumina-crm-deploy.service -n 200 --no-pager
```

Do not print secret files, use `docker inspect` to read secrets, or paste full database URLs into
logs/tickets. Report variable names, component status, image commit, and redacted error codes.
