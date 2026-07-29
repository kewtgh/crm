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
crm.ewaya.com
  -> Cloudflare Worker (public hostname)
  -> configurable, distinct Lumina origin hostname
  -> host Caddy origin gateway + shared-secret verification
  -> 127.0.0.1:3200
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

Provision Ubuntu with Docker Engine, the rootless extras, Compose, Buildx, `uidmap`, Caddy, Git,
and Node 24 only for the deployment controller. Do not install/run PostgreSQL or CRM Web/Worker
with host systemd. Rootless mode requires cgroup v2 + systemd so Compose memory/CPU/PID limits are
actually enforced, plus at least 65,536 subordinate UIDs and GIDs for `lumina-crm`.

```text
/opt/lumina-crm/source                    checked-out kewtgh/crm main
/etc/lumina-crm/deploy.env                non-secret deployment settings
/etc/lumina-crm/origin.env                Caddy origin hostname/secret
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
| `database-bootstrap.env` | PostgreSQL administrator plus five role passwords |
| `migration.env` | `crm_migrator` only |
| `bootstrap-admin.env` | `crm_system` plus one-shot CRM admin input |
| `backup.env` | read-only `crm_backup`, encryption/off-host credentials |
| `restore.env` | restore administrator plus encryption key |
| Cloudflare Worker | `ORIGIN_AUTH_SECRET` only |
| Caddy | matching origin secret and two distinct hostnames |

Web/Worker reject migration, backup, restore, and database-administrator variables. Backup rejects
every write-capable database URL. No normal runtime service receives migration, backup, or
PostgreSQL administrator credentials.

All containers clear uppercase/lowercase proxy variables and set `NO_PROXY` for `postgres` and
local services. The deploy runner tries one direct Git fetch. Only after failure may its single
retry receive `LUMINA_GIT_FALLBACK_PROXY`; it never writes Git proxy configuration.

## First database start

Validate every profile without starting anything:

```sh
docker compose --project-name lumina-crm --profile ops \
  --env-file /var/lib/lumina-crm/deployments/compose.env \
  -f /opt/lumina-crm/source/compose.production.yml config
```

After provisioning the immutable images/state file, start PostgreSQL and run:

```sh
docker compose --project-name lumina-crm \
  --env-file /var/lib/lumina-crm/deployments/compose.env \
  -f /opt/lumina-crm/source/compose.production.yml up -d postgres

docker compose --project-name lumina-crm --profile ops \
  --env-file /var/lib/lumina-crm/deployments/compose.env \
  -f /opt/lumina-crm/source/compose.production.yml run --rm db-bootstrap
docker compose --project-name lumina-crm --profile ops \
  --env-file /var/lib/lumina-crm/deployments/compose.env \
  -f /opt/lumina-crm/source/compose.production.yml run --rm migration-verify
docker compose --project-name lumina-crm --profile ops \
  --env-file /var/lib/lumina-crm/deployments/compose.env \
  -f /opt/lumina-crm/source/compose.production.yml run --rm migrate
docker compose --project-name lumina-crm --profile ops \
  --env-file /var/lib/lumina-crm/deployments/compose.env \
  -f /opt/lumina-crm/source/compose.production.yml run --rm bootstrap-admin
```

`db-bootstrap` is repeat-safe but rotates role passwords to supplied values. It provisions
`pgcrypto`, `citext`, and `pg_stat_statements` in the `extensions` schema; it does not migrate.
`migrate` retains the advisory lock, SHA-256 checksums,
modified-applied-migration rejection, one transaction per migration, lock/statement timeouts, and
forward-only policy. Web/Worker never migrate at startup. Remove the one-shot CRM administrator
password after successful bootstrap.

The repository's Windows validation harnesses create unique `lumina-crm-it-*` /
`lumina-crm-rt-*` projects and remove only their exact resources:

```powershell
.\scripts\test-compose-database-integration.ps1
.\scripts\test-compose-runtime-integration.ps1 `
  -ApplicationImage lumina-crm-validation:3.8.0 `
  -OperationsImage lumina-crm-ops-validation:3.8.0
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

## Cloudflare Worker and origin gateway

See `deploy/cloudflare-worker/README.md` and `deploy/caddy/Caddyfile`. Configure public
`crm.ewaya.com`, a distinct origin URL/hostname, and the same independent origin secret in
Cloudflare secret storage and Caddy's protected environment.

The Worker rejects hostname loops, removes client forwarding/internal-auth headers, injects the
secret, forwards method/query/body/content headers/Cookie/Set-Cookie/status, and forces `no-store`.
Caddy rejects a wrong/missing secret, reconstructs trusted proxy headers, and proxies only to
`127.0.0.1:3200`. Both layers reject detailed readiness; public monitoring uses only `/api/health`.
Cloudflare Access does not replace CRM login, MFA, CAPTCHA, rate limiting, or trusted-device logic.

```sh
LUMINA_ORIGIN_URL=https://distinct-origin.example.com npm run cloudflare:config:verify
npm run cloudflare:test
```

Worker deployment, DNS, Caddy, and production secrets are separate production actions.

## Image deployment and rollback

```sh
npm run deploy:production
npm run deploy:production:status
npm run deploy:production:logs
npm run deploy:production:rollback
npm run deploy:production:dry-run
```

The persistent runner performs:

```text
exclusive Lumina lock
-> capacity gate and isolated builder verification
-> exact clean main/origin verification and one fetch
-> containerized type/lint/contracts plus commit-tagged app/ops builds
-> PostgreSQL health
-> migration manifest verification and locked forward migration
-> save accepted/rollback images
-> Compose up Web/Worker (never down)
-> independent PostgreSQL/Web/Worker health
-> loopback detailed readiness
-> Cloudflare public and authenticated origin liveness
-> persist accepted state
-> Lumina-only cleanup
```

Pre-switch failure leaves Web/Worker unchanged. Post-switch failure restores previous app/ops
images and rechecks locally. It never reverses migration and reports: “Application rolled back;
database remains on the forward schema.” Each migration must remain compatible with the rollback
application until acceptance. Cleanup starts only after acceptance; cleanup failure is a warning.
Accepted state is persisted first so interruption can resume finalization safely.

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
curl -fsS https://crm.ewaya.com/api/health
```

Detailed loopback readiness independently reports Web environment, auth schema, database, Worker
heartbeats, and queues. A live Web with failed database is not ready. Public acceptance traverses
the Cloudflare Worker.

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
