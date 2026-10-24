# Lumina CRM v3.40 production deployment and host control plane

The host workflow is **Host Preflight → Operator-approved Host Upgrade → Production Deploy**.
The versioned [host contract](../deploy/libexec/host-runtime-contract.json) is authoritative.
See [implementation/verification](HOST_CONTROL_PLANE_PLAN.md) and the
[Chinese production runbook](LUMINA_PRODUCTION_DEPLOYMENT_RUNBOOK.md).

> v3.37.7 deployment recovery update: [current operator commands and safety rules](DEPLOYMENT_RELIABILITY_OPERATIONS.md)
> supersede historical unconditional rollback/retry guidance below. [Release notes](RELEASE_V3.37.7.md).
> Forward migrations require proven image/schema compatibility; public-edge failure can leave a healthy candidate pending acceptance.

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
`cloudflared`, Git, and Node 24.22.1 LTS for the deployment controller. Do not install/run PostgreSQL
or CRM Web/Worker with host systemd. Rootless mode requires cgroup v2 + systemd so Compose
memory/CPU/PID limits are actually enforced, plus at least 65,536 subordinate UIDs and GIDs for
`lumina-crm`.

Dependency baseline refreshed on 2026-10-23, including Node LTS and the retained browser revision:

| Component | Stable version | Source |
| --- | --- | --- |
| Node.js / npm | 24.22.1 LTS / 12.2.1 | `.nvmrc`, package manifests, CI and Dockerfile |
| PostgreSQL | 18.6, Debian trixie | Both Compose files and Dockerfile |
| Docker Engine | 29.9.2 | [Official releases](https://github.com/moby/moby/releases) |
| Docker Compose | 5.6.1 | [Official releases](https://github.com/docker/compose/releases) |
| Docker Buildx | 0.38.1 | [Official releases](https://github.com/docker/buildx/releases) |
| BuildKit | 0.34.1 recommended; audited 0.33.1 supported | Versioned compatibility catalog |
| Dockerfile frontend | 1.28.0 | Dockerfile syntax directive |
| Caddy | 2.11.7 | [Official releases](https://github.com/caddyserver/caddy/releases) |
| cloudflared | 2026.10.3 | [Official releases](https://github.com/cloudflare/cloudflared/releases) |

Upgrade host-managed packages through the host provisioning process before deployment; editing
this repository does not install them on an existing host. Newly created Lumina builders use
`moby/buildkit:v0.34.1`; an existing builder retains its current container until its operator
upgrades it. Both prepare and deployment reject an unknown image, ownership or configuration;
an audited existing image is retained when its installed maintenance program also supports it.
PostgreSQL remains on major version 18, so the existing 18 data directory layout
is unchanged. Prisma in the planning reference stays on stable 7.10.1 rather than the registry's
8.0 release candidate. Browser QA now uses Playwright Core 1.64.1 and Chromium revision 1248.

Type checking uses the stable TypeScript 7 compiler. ESLint uses the official
[`@typescript/typescript6` API compatibility package](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/#running-side-by-side-with-typescript-6.0)
and [`@eslint/compat` rule wrappers](https://eslint.org/blog/2024/05/eslint-compatibility-utilities/)
until the Next-config plugins support the current compiler/rule APIs directly.

```text
/opt/lumina-crm/source                    checked-out kewtgh/crm main
/etc/lumina-crm/deploy.env                non-secret deployment settings
/etc/lumina-crm/caddy.env                 Caddy public Host allowlist
/etc/cloudflared/config.yml               Tunnel ingress configuration
/etc/cloudflared/<tunnel-id>.json         Tunnel credential managed outside Git
/etc/lumina-crm/secrets/                  root-owned Compose secret sources
/var/lib/lumina-crm/deployments/          accepted image/deployment state
/var/lib/lumina-crm/docker/               Lumina rootless Docker data root
/var/lib/lumina-crm/docker-config/        shared deploy/prepare/cleanup Docker + Buildx client configuration
/var/lib/lumina-crm/storage-maintenance/  builder marker, reports, and maintenance state only
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

A Git update never installs root-owned maintenance. Use the separately approved atomic installer
below. Copying only the maintenance .mjs file is unsupported: its reviewed contract and helper
modules belong to one content-addressed bundle.

## Host preflight and operator upgrade

Run as the lumina-crm account, with the host CLI using the same executable as systemd:

```sh
/usr/bin/node --version
npm run deploy:production:host-check
npm run deploy:production:host-upgrade-plan
# Optional: inspect a locally fetched full SHA without merging or executing its code.
npm run deploy:production:host-check -- --target=FULL_REVIEWED_SHA
```

Both diagnostic commands work on Node 24.22.0. Host-check exits nonzero when blocked and emits
JSON rows with component/current/required/status/blocking/remediation. It does not create a
request, change deployment journals, start Docker, bootstrap a builder, install packages or prune
anything. An older target without a versioned contract is unsupported, not executable discovery.

Node >=24.22.1 <25 and npm >=12.2.1 <13 match the application manifests. Their recommended pins
are 24.22.1 and 12.2.1. Explicit supported lines are Docker `>=29.1.3 <29.2 || >=29.8.2 <30`,
Compose `>=2.40.3 <3 || >=5.6.0 <6`, Buildx `>=0.30.1 <0.31 || >=0.37.2 <0.39`.
Ubuntu package suffixes such as `2.40.3+ds1-0ubuntu1` and `0.30.1-0ubuntu1` are parsed;
prereleases and unaudited lines remain blocked. Recommendations 29.9.2 / 5.6.1 / 0.38.1 are optional.
Version support also requires the actual read-only capability probes below. Missing versions report
NOT_CHECKED or DEPENDENCY_BLOCKED, never a fabricated version incompatibility.
Builder ownership, private endpoint, image allowlist, network/proxy and config hash stay mandatory.
Known installed maintenance revisions and units can report LEGACY_SUPPORTED independently of the
application source hash; unknown code, loaded drop-ins and incomplete installation stay blocked.
The installed maintenance program must support the actual Builder image. Docker CE migration and
replacement of Ubuntu containerd/runc/rootlesskit are not deployment prerequisites.

Only an operator may approve system Node/npm/Docker/Compose/Buildx upgrades. The plan command
never installs them. Record package sources, signed-package/checksum verification, current and
proposed versions, executable paths and effects on other host services before approval. Select
vendor-supported packages for the actual OS, verify Node as both operator and lumina-crm and
verify /usr/bin/node used by systemd. Do not issue an unattended full-system upgrade, restart a
shared Docker daemon or change another account's runtime/daemon. Supported Docker patches may
remain installed while recommendations are scheduled independently.
Execute approved package changes in a separate maintenance window with the same admission,
deployment and maintenance locks held exclusively and the CRM deploy service inactive. The
deployment CLI never acquires root privileges or runs a package manager for host upgrades.

The checked-in unit uses /usr/bin/node. Bootstrap now hands off process.execPath, so a CLI-only
nvm/PATH change cannot repair an old systemd executable. Host-check compares resolved executable
identity as well as both versions. Existing reviewed unit files must match the loaded units with
no unreviewed drop-ins; operator installation/daemon-reload is separate from deployment.

Provision locks once as an operator, without replacing existing lock inodes. First ensure the
fixed paths are regular files, owned by lumina-crm, with no symlink and no group/world write.
Create only missing files with exclusive creation and mode 0640; never truncate or replace an
existing lock. The paths are /var/lib/lumina-crm/request-admission.lock, deploy.lock and
maintenance.lock. Upgrade/install lock order is admission → deployment → maintenance. Other
maintenance takes maintenance.lock; systemd keeps deploy.lock throughout deployment. Kernel
/proc/locks ownership is checked; an environment variable cannot substitute for a held lock.

### Atomic maintenance installation

Use an independently reviewed, root-owned, non-writable staging copy of this control-plane
package for privileged installation. Retain its full commit and reviewed hashes. Do not execute
an installer with root privileges directly from a deployment-writable working tree. Required
files are scripts/install-host-maintenance.mjs and all five MAINTENANCE_ASSETS declared in
[the contract module](../deploy/libexec/lumina-host-contract.mjs), preserving relative paths.
The operator must independently approve this control-plane code before using it to inspect a
future application target; fetching application code never authorizes executing it.

```sh
# As operator; ROOT_REVIEWED_PACKAGE is a reviewed root-owned staging directory.
/usr/bin/node ROOT_REVIEWED_PACKAGE/scripts/install-host-maintenance.mjs
# Review previous launcher hash, all source hashes and approvalSha256, then explicitly approve:
sudo /usr/bin/node ROOT_REVIEWED_PACKAGE/scripts/install-host-maintenance.mjs --approve=PLAN_SHA256
# On interrupted installation, use the ORIGINAL plan approval and recorded operation ID:
sudo /usr/bin/node ROOT_REVIEWED_PACKAGE/scripts/install-host-maintenance.mjs --approve=PLAN_SHA256 --resume=OPERATION_UUID
```

The installer acquires all three locks, rejects stale source/previous-launcher identities,
installs immutable bundle files below /usr/local/libexec/lumina-crm-host/ and atomically renames
a regular root-owned launcher at /usr/local/libexec/lumina-crm-storage-maintenance.mjs.
It retains the previous launcher and phase journal under /var/log/lumina-crm-host-install/.
A separate root-owned installed.json receipt must match the launcher and complete bundle.
Incomplete activation/final receipt fails host preflight; resume verifies the active target
instead of blindly restoring a previous launcher. Normal Git/deploy processes cannot install it.

### Approved CRM builder replacement

Load only reviewed host settings from /etc/lumina-crm/deploy.env as the lumina-crm account.
Set DOCKER_HOST to that account's exact unix:///run/user/UID/docker.sock, DOCKER_CONFIG to
/var/lib/lumina-crm/docker-config and BUILDX_CONFIG to its buildx subdirectory. Their private
ownership and the daemon's /var/lib/lumina-crm/docker data root must pass diagnostics.

```sh
npm run deploy:production:builder-plan
# Review the plan, builder-owner.json/config hashes and cache-loss warning before approval.
npm run deploy:production:builder-replace -- --approve=PLAN_SHA256 --acknowledge-cache-loss
# Interrupted operation: same original approval and recorded operation ID.
npm run deploy:production:builder-replace -- --approve=PLAN_SHA256 --acknowledge-cache-loss --resume=OPERATION_UUID
npm run deploy:production:host-check
```

Only the marked lumina-crm-buildkit docker-container builder can be replaced. Its prior image,
root-owned buildkitd.toml hash, private endpoint, marker owner, network=host and proxy hashes
must match the approved plan. Removal uses [buildx rm --keep-state](https://docs.docker.com/reference/cli/docker/buildx/rm/)
to retain builder state; cache reuse across an engine change is not guaranteed. No volume,
PostgreSQL, application image, unrelated builder or other Docker instance is a deletion target.
No global prune or fallback Docker context is used.

The replacement carries a unique operation nonce in driver options. Its configuration and actual
daemon image/network are verified before the ownership marker is completed. Every stage intent
is durable before removal/create/marker updates; phase history and failure notes are retained
under /var/lib/lumina-crm/storage-maintenance/. A failed create/verify can resume the same operation.
A still-present builder after an uncertain removal, foreign nonce, unexpected endpoint, changed
configuration or missing journal requires manual investigation. Never delete a replacement to
retry an old removal. An incomplete upgrade blocks deployment even after its locks are released.

### Early rejection and normal deployment

The CLI runs host checks before request creation. After fetch, the current trusted controller
uses bounded git show of fixed data/source paths to validate target requirements and maintenance
hashes before fast-forward. It never imports or executes the fetched target to discover them.
The verified full SHA is pinned in the request and rechecked by Bootstrap before source update.

The target entry gate writes an exclusive receipt bound to request ID, launch, bootstrap attempt,
nonce, target SHA and controller PID before any business operation. A REJECTED receipt proves
no business work began in that invocation; ADMITTED receipts prohibit early replay. Bootstrap
also records the child's observed exit/PID in its independent journal. State remains conservative
when imports crash or receipt persistence/identity is incomplete.

```sh
npm run deploy:production:status
# Only for an inactive, positively proven early failure; first command is a plan.
npm run deploy:production:archive-early -- --request=REQUEST_UUID
npm run deploy:production:archive-early -- --request=REQUEST_UUID --approve=EVIDENCE_PLAN_SHA256
# After all mandatory host checks are READY (SUPPORTED recommendations may remain):
npm run deploy:production:host-check
npm run deploy:production
```

Archival uses admission/deployment locks, checks independent bootstrap/entry/history evidence,
preserves the original request through a named archive and a phase ledger, and leaves latest.json
unchanged. A crash after rename is resumed by the same archive command/approval; incomplete
archival blocks new admission. A new request gets a new ID and does not reuse an archived intent.
No archive is allowed for migration/switch/acceptance, an admitted controller, inconsistent PID,
missing evidence or control-plane finalization failure. Keep the original accept/recover/reconcile
procedures for those cases; do not edit latest.json or remove request.json.

For initial adoption use the reviewed repair CLI below. It does not require upgrading a supported
Ubuntu Docker toolchain or reinstalling compatible maintenance. Application version 3.40.0 remains
unchanged; the last accepted application is 3.40.0 at 796cc43. This procedure never rolls back a database.

### Audited capabilities and handoff transition

The `crm-compose-buildx-v1` profile checks help for project/env/file/profile selection, up isolation
and wait options, disposable run options, Buildx targets/build args/provenance/load/output/tag and
bounded cache-filter flags. It also runs `compose config` against a fictional stdin-only model,
verifying UID, init, read-only rootfs, dropped capabilities, no-new-privileges, PID/memory/CPU limits,
tmpfs protection, internal networking and loopback binding. No up/build/prune/bootstrap executes.
Rootless daemon inspection separately requires the CRM data root and systemd cgroup v2.
Tagged [Compose 2.40.3 source](https://github.com/docker/compose/blob/v2.40.3/cmd/compose/up.go)
and [Buildx 0.30.1 source](https://github.com/docker/buildx/blob/v0.30.1/commands/prune.go)
contain the required flags; the latter requires BuildKit >=0.17 for its space filters. Both audited
BuildKit versions exceed that requirement. This establishes required capabilities, not a claim that
all older or future versions are safe. Actual Engine build/health acceptance still runs on the host.

New requests use handoff protocol 2 (attempt ID, nonce and entry receipt); c164ff1 protocol 1 remains
supported. Protocol 0 accepts only the pinned 796cc43 Bootstrap source hash, exact four launch args,
actual UID/parent executable/ancestry, active systemd invocation, approved loaded unit without drop-ins,
kernel deployment lock, matching original request and independent durable bootstrap intent, clean
target SHA and a reflog fast-forward from the approved old SHA within the process lifetime.
Missing modern fields never constitute sufficient authority. Protocol-2 requests cannot downgrade.
Its newly observed legacy entry receipt has a separate filename; it does not manufacture evidence
for an earlier failed process. Future protocol changes must retain audited transition readers and a
cross-commit test for the first upgrade, rather than requiring both components to update beforehand.

### Legacy transition failure: independently approved recovery

This special CLI recognizes only the catalogued old-Bootstrap/new-entry rejection, not arbitrary
started failures. Stage the complete reviewed repair checkout in `ROOT_REVIEWED_PACKAGE`, with root
ownership and no deployment-account write access. Do not run root code from the ordinary checkout.
Keep all invocation logs; do not reset the failed unit or restart deployment before collecting them.
Set the following placeholders from the original state and trusted journal, not from a guessed date:

Historical failure is established by the specified invocation's unique trusted manager exit event:
PID1, UID0, the exact CRM UNIT/INVOCATION_ID, EXIT_CODE=exited and EXIT_STATUS=1. Its cursor and
integer microsecond timestamp must be complete, with the original attempt and service/error output
bound to that exit. Conflicting exits are rejected. Current systemctl observations prove only that
the service is inactive/failed. Current success, cleared InvocationID or a different inactive
invocation does not replace or invalidate the historical event; running/unknown states still block.

```sh
REQUEST=ORIGINAL_REQUEST_UUID
INVOCATION=FAILED_SYSTEMD_INVOCATION_32_HEX
REPAIR=ROOT_REVIEWED_PACKAGE
TARGET=FULL_REVIEWED_REPAIR_SHA

# Root/operator: inspect plan, then explicitly capture both full invocation streams.
/usr/bin/node "$REPAIR/scripts/deploy-legacy-transition.mjs" journal --invocation="$INVOCATION"
sudo /usr/bin/node "$REPAIR/scripts/deploy-legacy-transition.mjs" journal --invocation="$INVOCATION" --capture
sudo chgrp lumina-crm "/etc/lumina-crm/transition-evidence/$INVOCATION.json"
sudo chmod 0640 "/etc/lumina-crm/transition-evidence/$INVOCATION.json"

# As lumina-crm: verify historicalExit ID/status/microsecond timestamp/cursor, then approve.
/usr/bin/node "$REPAIR/scripts/deploy-legacy-transition.mjs" archive --request="$REQUEST" --invocation="$INVOCATION"
/usr/bin/node "$REPAIR/scripts/deploy-legacy-transition.mjs" archive --request="$REQUEST" --invocation="$INVOCATION" --approve=ARCHIVE_PLAN_SHA256

# Fetch data only. Adoption reads target contract before source-only fast-forward.
git -C /opt/lumina-crm/source fetch origin main
/usr/bin/node "$REPAIR/scripts/deploy-legacy-transition.mjs" adopt --target="$TARGET"
/usr/bin/node "$REPAIR/scripts/deploy-legacy-transition.mjs" adopt --target="$TARGET" --approve=ADOPTION_PLAN_SHA256 --operation=NEW_OPERATION_UUID
cd /opt/lumina-crm/source
npm run deploy:production:host-check
npm run deploy:production
```

Run each step only after the previous step succeeds and its output is reviewed. Capture is exclusive:
an existing evidence file must not be overwritten or have its producer toolSha256 edited. This repair
changes the tool hash. An operator must hash and preserve the old root-owned file under a separate
audited name before capturing with the same reviewed new tool copy. Stop for any incomplete archival
ledger; do not discard evidence or replace its approval to force a resume. Missing/contradictory
manager proof, invalid timestamps, changed evidence/source/tool identity, active/unknown service,
busy locks, business effects, missing accepted-image proof, unknown adoption source or failed host
preflight all stop the workflow. Never delete request.json, manufacture receipts or upgrade shared
Docker to bypass these conditions. The archive plan exposes historicalExit for operator review.

For an existing capture only: after confirming there is no incomplete archive and independently
approving preservation, the operator can retain it under a new name before fresh capture. Verify
identical SHA-256 and retained ownership/permissions, record the action, and stop on an existing backup:

```sh
EVIDENCE="/etc/lumina-crm/transition-evidence/$INVOCATION.json"
BACKUP="$EVIDENCE.before-$TARGET"
sudo sha256sum -- "$EVIDENCE"
sudo test ! -e "$BACKUP"
sudo mv --no-clobber -- "$EVIDENCE" "$BACKUP"
sudo sha256sum -- "$BACKUP"
# After reviewing preservation, repeat journal --capture with the reviewed repair copy.
```

The journal capture is root-owned, exclusive, bounded and invocation-scoped. It includes trusted
systemd-manager exit fields as well as service output. Credential interpretation follows
[systemd journal fields](https://www.freedesktop.org/software/systemd/man/latest/systemd.journal-fields.html):
inherited stdout may carry parent credentials, so a stack trace PID alone is insufficient.
Approval requires the exact uncaught entry error/stack and child PID, compatible Node diagnostics,
known source execution order, matching request/latest/bootstrap history, no deployment journal/log
or admitted entry, service exit 1, and healthy CRM Web/Worker still using the last accepted image,
revision and immutable image ID, with container creation predating the failed attempt. Absence of a
journal alone proves nothing. Any migration, switch, acceptance, conflicting attempt, incomplete
capture, unknown code, newer container or finalization failure blocks archival with missing/failed
evidence keys. Preserve the complete evidence for independent operator review; use the original
schema-aware accept/recover/reconcile process for actual business effects, never synthesize receipts.

Approval holds admission/deployment/maintenance locks and records APPROVED → SNAPSHOTS_SAVED →
ARCHIVE_INTENT → ARCHIVED under `legacy-transition-REQUEST_UUID/`. Original request/latest bytes,
full private evidence and the renamed request remain there. latest.json is unchanged, including
BOOTSTRAP_FAILED, controllerStarted=true and recoverySafe=false. Repeat the same approved command
after interruption; incomplete ledgers or missing archives block new admission. Do not remove them.
Source adoption has its own intent/completion journal and explicit operation UUID; resume it using
the same hash and UUID. It neither starts deployment nor changes last-success. The next normal
deployment creates a fresh request ID. Repository tests do not prove this production request safe;
the host evidence assessment must pass first.

The controller writes one exclusive `request.json` with mode `initialize`, `deploy`, `rollback`, or
`recover`. Production deployment is always two-stage: the stable bootstrap reads the request while
the systemd `flock` owns the deployment lock, validates/fetches/fast-forwards the exact production
branch, and spawns a fresh target-controller Node process. The target controller reloads its complete
ES module graph from the target commit, repeats branch/origin/HEAD/clean/version checks, and only then
may run preflight, build, migration, service switching, acceptance, cleanup, and finalization. A
controller never deploys a release after mutating its own source tree.

The journal and deployment log expose non-secret evidence as `BOOTSTRAP_SOURCE_COMMIT`,
`TARGET_SOURCE_COMMIT`, `TARGET_CONTROLLER_PID`, `TARGET_CONTROLLER_COMMIT`,
`TARGET_APPLICATION_VERSION`, and `TARGET_CONTROLLER_REEXEC_OK`. The target SHA is always a full
40-character lowercase commit. A mismatch fails before build with
`TARGET_CONTROLLER_SOURCE_CHANGED`.

### One-time pre-3.8.26 controller-unit transition

A host whose installed `lumina-crm-deploy.service` still points directly at
`deploy-production-runner.mjs` cannot acquire the new boundary by starting that old unit: systemd
would load the old runner before its source update. Before the first 3.8.26 deployment, use the
project's existing reviewed systemd-asset installation procedure to install the tracked 3.8.26
`lumina-crm-deploy.service`, verify its `ExecStart` names `deploy-production-bootstrap.mjs`, and run
`systemctl daemon-reload`. Do not start a deployment until that one-time control-plane asset upgrade
is verified. The bootstrap stays in the source tree as the deliberately small, backward-compatible
protocol layer; it is not copied to `/etc` or `/usr/local`.

The target controller records the mode in its log, per-deployment state, and `latest.json`.
`last-success.json` remains the accepted release contract used by later deploy and rollback
requests. An interrupted, non-terminal request remains in place: rerun the same mode to recover its
existing request ID. Do not delete or edit these files to bypass a deployment gate.

Ensure the pinned PostgreSQL 18.4 image is present, then create the three explicit external volumes:

```sh
sudo -u lumina-crm env DOCKER_HOST="$DOCKER_HOST" docker pull postgres:18.6-trixie
sudo -u lumina-crm env DOCKER_HOST="$DOCKER_HOST" \
  /opt/lumina-crm/source/deploy/scripts/provision-volumes.sh
```

The script verifies exact labels before adopting an existing volume and refuses foreign volumes.
It uses that pinned image with `--network none`, no secrets, and only `CHOWN` capability to make
the objects and encrypted-backup volume roots writable by runtime UID/GID 10001. It never mounts
or changes the PostgreSQL volume in that helper. Never replace the PostgreSQL volume during update
or rollback.

Keep both `/etc/lumina-crm` and `/etc/lumina-crm/secrets` owned by `root:lumina-crm` with exact
mode `0750`. Install each application/ops `deploy/*.env.example` secret template as its basename
without `.example` under `/etc/lumina-crm/secrets`, owned by `root:lumina-crm` with exact mode
`0644`. Install the PostgreSQL password with the same ownership and mode at:

```text
/etc/lumina-crm/secrets/postgres-superuser-password.txt
```

Compose implements these `file:` secrets as bind mounts and cannot remap their uid/gid/mode.
Mode `0644` therefore allows the fixed container UID/GID `10001:10001` to read the mounted file,
while the non-world-traversable `0750` host directories retain the host access boundary. Before
building images or starting PostgreSQL, the deployment runner checks both directories and all eight
required source files using metadata only: it rejects symlinks, wrong realpaths, ownership, type,
or mode without reading or printing secret contents. The entrypoint exports only the selected file
to its child process. Secret values are not placed in Compose YAML or image build arguments.

Run the storage prepare unit once. The fixed root-owned program executes as non-root
`lumina-crm`; it verifies the rootless socket/security/cgroup/data-root contract, capacity, and
only the marked `lumina-crm-buildkit` builder:

```sh
sudo systemctl start lumina-crm-storage-prepare.service
sudo systemctl status lumina-crm-storage-prepare.service
```

The deploy runner and all storage units use the same exact `DOCKER_CONFIG` root
`/var/lib/lumina-crm/docker-config` and `BUILDX_CONFIG` root
`/var/lib/lumina-crm/docker-config/buildx`. Storage prepare creates or verifies the builder there,
so the subsequent runner inspection sees the same builder namespace. The maintenance state tree
keeps `builder-owner.json`, `latest.json`, and reports only; it is not a Docker client configuration
root. If an obsolete Docker configuration directory exists below that state tree, prepare fails
with `LEGACY_BUILDX_CONFIG_REQUIRES_REVIEW` and neither adopts, copies, nor removes it.

Install `lumina-crm-build-cache-cleanup.service` with the prepare and compatibility storage-cleanup
unit, and install the matching sudoers update. The target controller's normal successful-release
path performs its own bounded BuildKit cleanup after acceptance. The separately installed
cache-cleanup unit remains available for an operator-reviewed Lumina-builder-only capacity action;
it validates the owned `lumina-crm-buildkit` builder and never enumerates images or invokes a global
Docker prune. Neither path changes the authoritative application result when cache cleanup fails.

## Credential boundaries

| File / consumer | Database identity and other secrets |
| --- | --- |
| `production.env` / Web | `crm_app`, `crm_system`, auth/object-signing secrets, plus transitional CRM email webhook URL/token retained only for rollback to v3.8.14 |
| `worker.env` / Worker | `crm_worker`, object-store/integration credentials, and the CRM email webhook URL/token for notification, reminder, calendar, and communication delivery |
| `email-worker-deploy.env` / Cloudflare deployment controller | Worker deployment metadata plus Cloudflare account/API deployment credential; no CRM runtime email URL/token and no provider runtime secrets |
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

Web owns synchronous authentication-email delivery: device verification, password reset,
and email verification. Worker owns notification outbox, reminders, calendar delivery,
communication delivery, and other asynchronous business email. Moving communication delivery
to Worker does not remove Web's authentication-email configuration requirement.

Both `production.env` and `worker.env` must contain valid, exactly identical
`EMAIL_DELIVERY_WEBHOOK_URL` and `EMAIL_DELIVERY_WEBHOOK_TOKEN` values. Container startup requires
both keys. Web readiness validates their URL/secret format without provider I/O; deployment
preflight validates both boundaries and equality before build or switch. Failures expose only
stable codes and variable names, never configured values.

```text
production.env.EMAIL_DELIVERY_WEBHOOK_TOKEN
worker.env.EMAIL_DELIVERY_WEBHOOK_TOKEN
=
Cloudflare Email Worker secret LUMINA_WEBHOOK_TOKEN
```

CRM receives the webhook URL and `EMAIL_DELIVERY_WEBHOOK_TOKEN` only. `LUMINA_WEBHOOK_TOKEN`
is a Cloudflare Email Worker secret, never a CRM Web/Worker environment variable.

`RESEND_API_KEY` exists only as a Cloudflare Email Worker secret. It must never enter
`production.env`, `worker.env`, `email-worker-deploy.env`, Compose YAML, or application deployment
state. Loopback readiness validates the independent `COMMUNICATION_DELIVERY` heartbeat and governed
queue metrics; it neither probes the endpoint nor sends a test email. Basic `/api/health` liveness
remains independent of email configuration and provider availability.

All containers clear uppercase/lowercase proxy variables and set `NO_PROXY` for `postgres` and
local services. Set `LUMINA_GIT_PROXY=http://127.0.0.1:20271` in
`/etc/lumina-crm/deploy.env` when the production host requires the controlled Git proxy. The
deploy runner injects that value as `HTTP_PROXY` and `HTTPS_PROXY` only into its first and only
Git fetch subprocess. When it is unset or empty, the runner makes one direct fetch. It performs no
fallback retry, never writes Git proxy configuration, redacts the configured value from deployment
logs and errors, and never places it in Compose or container environments.

If the host requires a proxy for BuildKit image pulls or Dockerfile `RUN` network access, set
`LUMINA_DOCKER_PROXY` in the server-local `/etc/lumina-crm/deploy.env`. Leave it empty for direct
build networking. The value must be an absolute `http://` or `https://` URL without credentials,
query, or fragment. Do not reuse this variable as the Git proxy and do not commit the production
value.

Storage prepare always creates the fixed `docker-container` builder with the exact driver option
`network=host`. In rootless Docker this means the Lumina daemon's RootlessKit network namespace,
whose host-loopback entry is reachable by both the daemon and builder; it does not mean the
physical host/rootful Docker namespace and does not join or modify any HunterAI daemon, container,
network, or proxy relay. When the proxy is enabled, builder creation also uses four exact
`env.HTTP_PROXY`/`env.HTTPS_PROXY` driver options in uppercase and lowercase. The deploy runner
sets the same four variables only for its three `buildx build` subprocesses and supplies the
predefined proxy build arguments by name without placing their values on the command line. The
proxy never reaches `docker compose`, migration, health, backup, or application runtime
environments. Logs, errors, and state redact its value. `builder-owner.json` records only whether
the proxy is enabled, its SHA-256 fingerprint, and `builderNetworkMode: "host"`; it never stores
the URL.

Storage prepare and the deploy runner both require the inspected driver to be `docker-container`,
the inspected Driver Options to contain exactly `network="host"` plus the four proxy options when
enabled, and the marker proxy fingerprint to agree with server-local `deploy.env`. A missing or
different marker/inspect network fails with `LUMINA_BUILDKIT_NETWORK_CONFIGURATION_MISMATCH`;
changing the proxy setting or value causes `LUMINA_BUILDKIT_PROXY_CONFIGURATION_MISMATCH`. The
maintenance program never silently adopts, reconfigures, removes, or recreates that builder. Stop
deployment and perform an operator-reviewed audit of the exact Lumina builder and ownership marker
before any explicit replacement; never touch another project, the rootful daemon, or HunterAI
resources.

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

The stable bootstrap performs the single proxied-or-direct ff-only Git update. The newly loaded
initialize target controller performs capacity/builder/rootless checks, all three image builds, and
candidate Compose environment creation before it starts PostgreSQL. Database work is then strictly:

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
  -ApplicationImage lumina-crm-validation:3.8.13 `
  -OperationsImage lumina-crm-ops-validation:3.8.13
```

They are local integration tests, not production deployment commands.

## Worker operation and health

The Compose-managed Worker loop verifies `service_schema_version()` before each cycle, acquires the
session advisory lock `lumina-crm-worker-cycle`, and runs enabled categories in parallel. Existing
lease tokens, per-category bounded concurrency, heartbeat/queue state, idempotency, retry/backoff,
four-minute cycle limit, and 210-second external budget remain unchanged. Another cycle cannot
overlap while the advisory lock is held.

Docker Worker health queries the real schema version, database readiness, and required heartbeat
presence/freshness. A live Node process alone is not healthy, but retryable failed jobs and stuck-job
telemetry are operational degradation rather than container liveness predicates. Those counts remain
in detailed readiness and Operations and can still make normal readiness return HTTP 503.

The default `WORKER_LOOP_INTERVAL_SECONDS=300` is the delay after a cycle, not a startup delay: a
new Worker performs its schema check and first bounded cycle immediately. The deploy controller's
240-second Worker-health window therefore does not need to wait for a 300-second recurrence. Docker
also has a three-minute start period, and health no longer waits for business-job success. The
interval and timeout remain unchanged and bounded.

## Env-driven email delivery Worker

The independently deployed source under `infrastructure/email-delivery-worker/` is the canonical
generic Resend adapter. It is not a CRM Web route, is not built into the application image, and is
not deployed by the application `deploy:production` controller.

No production Worker name, Custom Domain, sender, route, application hostname, account ID, API
token, or public URL belongs in tracked source or on the Windows development machine. Windows is
limited to source development, tests, and lint/typecheck. The deployment test runs Wrangler against
a completely fictitious generated JSON with `--dry-run`; the production controller itself rejects
Windows before Env access. Windows must not modify Cloudflare Dashboard, Worker configuration,
Custom Domain routing, or secrets.

Ubuntu is the production environment. After pulling an audited commit, install the empty tracked
template `deploy/email-worker-deploy.env.example` as
`/etc/lumina-crm/secrets/email-worker-deploy.env`, then fill real values only on that server. The
directory `/etc/lumina-crm/secrets` must be `root:lumina-crm` mode `0750`; the file must be
`root:lumina-crm` mode `0640`, must not be world-readable, and must never be tracked. It contains
the Worker name/base URL, CRM URL, sender/reply-to/brand, delivery and health paths, Cloudflare
account ID, and Cloudflare API token. The account ID is server-only even though it is not a
password; the API token is a production deployment secret. Values must never be printed.

Provision the transient production-config root once and run the controller as `lumina-crm`:

```sh
sudo install -d -o lumina-crm -g lumina-crm -m 0700 \
  /var/lib/lumina-crm/email-worker-deployments
```

Each invocation creates an unpredictable direct child at mode `0700`, writes the generated JSON at
mode `0600`, verifies `lumina-crm` ownership and rejects symlinks. The child also holds dry-run
output and is removed in `finally` on success and every failure path.

The committed Wrangler configuration has no `name`, `routes`, `route`, or production `vars`.
It explicitly sets `workers_dev=false`, `preview_urls=false`, `keep_vars=true`, and the accepted
Observability contract. Before deployment, the controller performs read-only Workers Domains API
queries by hostname and Worker name. The configured hostname must already belong to the configured
Worker, and that Worker must have no second Custom Domain. Missing, foreign, additional, or malformed
domain state fails closed; the controller never takes over another Worker's domain.

Dashboard remains the operator surface for initial Custom Domain creation, inspection, and emergency
rollback. For routine strict deployments, the source of truth is the hostname derived from the
Ubuntu server-local `WORKER_PUBLIC_BASE_URL`. The controller renders it, the API-confirmed zone name,
the Worker name, disabled Preview URLs, complete plaintext vars, Observability, and required secret
names into the temporary JSON. It then runs only `wrangler deploy --config <temporary-file>
--strict`; dry-run adds only its no-upload/output arguments. No name, var, route, or secret CLI
override remains. A Wrangler failure reports at most 8 KB of already-sanitized diagnostic tail;
the Worker name, Custom Domain, URLs, mailboxes, paths, brand, account ID, and API token remain
redacted in literal and URL-encoded forms.

The Worker requires the existing `LUMINA_WEBHOOK_TOKEN` and `RESEND_API_KEY` secret binding names.
Neither belongs in `email-worker-deploy.env`: both remain only in Cloudflare Worker secret bindings,
and the controller does not read, upload, replace, or delete them. The controller also never reads
the CRM server's `production.env` or `worker.env`. Operators place the same CRM-side URL/token in
both root-owned runtime files; both tracked templates keep their values empty:

```dotenv
EMAIL_DELIVERY_WEBHOOK_URL=
EMAIL_DELIVERY_WEBHOOK_TOKEN=
```

Never copy a real token, sender, Worker name, hostname, or webhook URL into Git, documentation,
build output, logs, status files, or Compose YAML.

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
the corresponding `calendar-*` keys above. See the subproject README for Env validation, tests,
the Custom Domain boundary, deployment, and generic health acceptance. Production and production
dry-run are Linux-only and always read `/etc/lumina-crm/secrets/email-worker-deploy.env`. Dry-run
never uploads or checks the health endpoint and always removes its generated JSON and bundle:

```sh
cd infrastructure/email-delivery-worker
npm run deploy:production:dry-run
npm run deploy:production
```

The first command is the Ubuntu real-configuration dry-run; the second performs the in-place
deployment and checks only `WORKER_PUBLIC_BASE_URL + HEALTH_PATH`. It sends no test email. Windows
tests use only fictitious generated input. CRM application initialization and email Worker
deployment remain independent stages.

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
LUMINA_PUBLIC_HOSTNAME=crm.example.invalid \
LUMINA_CADDYFILE=/etc/caddy/Caddyfile \
LUMINA_TUNNEL_CONFIG_FILE=/etc/cloudflared/config.yml \
npm run tunnel:config:verify
npm run tunnel:test
```

Replace the reserved example hostname with the production hostname only in local/server
configuration. Tunnel creation/credentials, DNS routing,
Caddy installation, and application deployment are separate production actions.

## Image deployment and rollback

```sh
npm run deploy:production:initialize
npm run deploy:production
npm run deploy:production:status
npm run deploy:production:logs
npm run deploy:production:rollback
npm run deploy:production:recover
npm run deploy:production:dry-run
```

For initialization, the two-stage controller performs:

```text
exclusive Lumina lock
-> reject if accepted state already exists
-> stable bootstrap exact clean main/origin verification, one fetch and ff-only update
-> fresh target-controller PID and exact target-commit TOCTOU verification
-> target-checkout Web/Worker runtime contract and Secret metadata preflight
-> isolated rootless builder verification
-> containerized type/lint/contracts plus commit-tagged app/ops builds
-> PostgreSQL health
-> repeat-safe database role/extension bootstrap
-> migration manifest verification and locked forward migration
-> repeat-safe initial administrator bootstrap
-> capture sanitized failed/stuck/missing/stale Worker baseline
-> force-recreate Web/Worker together (never down) so replaced Secret files are remounted
-> independent PostgreSQL/Web/Worker health
-> loopback release-health acceptance against the pre-switch baseline
-> Cloudflare Tunnel public liveness at https://<LUMINA_PUBLIC_HOSTNAME>/api/health
-> atomically persist compose.env and accepted state with null rollback images
-> bounded Lumina BuildKit, paired-image, deployment-history and stale-env cleanup (non-fatal)
```

Ordinary deploy first requires accepted state, then uses the same bootstrap, prepare, build, PostgreSQL,
migration, switch, acceptance, persistence, and cleanup path. It never invokes `db-bootstrap` or
`bootstrap-admin`.

Target runtime validation is executed from the target checkout before image build, migration,
Compose persistence, or container replacement. It validates both runtime schemas, the exact
32-byte invitation encryption key encoding, Web/Worker equality, and secret independence without
logging values. Pre-switch failure leaves Web/Worker, compose.env and last-success unchanged.
Post-switch failure may recreate both Web and Worker at last-success only after exact schema compatibility proof; a first
initialization has no prior image and records rollback as unavailable. Neither path reverses a
migration, and application rollback reports: “Application rolled back; database remains on the
forward schema.” Compatibility is never inferred from migration ordering. An incompatible old image is not restored;
a healthy forward candidate with public failure remains pending explicit acceptance. Release health requires PostgreSQL and exact target Web/Worker images, healthy containers,
the exact target version/commit, valid environment/auth/database/Worker checks, zero missing/stale
Workers, and zero stuck jobs. Failed jobs must not increase: `0 -> 1` and `1 -> 2` fail and trigger
compatible rollback or guarded manual recovery; `0 -> 0` is healthy; `1 -> 0` is healthy; `1 -> 1` and `2 -> 1` are accepted with only
`PREEXISTING_QUEUE_DEGRADATION`. The persisted `releaseHealth` evidence contains aggregate counts and
stable warnings only—never queue rows, errors, recipients, payloads, URLs, or credentials. Normal
loopback readiness remains HTTP 503 while any failed/stuck job exists. Only after release health and
public liveness succeed may the controller atomically write `compose.env` and `last-success.json`.
`deploy:production:recover` performs no build or migration: it idempotently reconciles
both services and compose.env to a complete last-success release. It accepts pre-existing failed
business jobs but still fails closed for incomplete last-success state, image mismatch, container,
schema/database/auth/environment faults, missing/stale Workers, or stuck jobs. Cleanup starts only
after acceptance and accepted-state persistence; its failure is a
non-fatal warning and cannot trigger rollback or change `applicationResult`.

### Post-deployment storage cleanup

The target controller—not the bootstrap—runs cleanup with `SAFE`, `BOUNDED`, `LUMINA-ONLY`,
`NON-FATAL`, and `AUDITABLE` semantics. It always uses the named `lumina-crm-buildkit` builder.
Images are eligible only when both `com.lumina.crm.managed=true` and
`com.lumina.crm.repository=kewtgh/crm` match, their full commit label is valid, application and
operations images form a complete release pair, no running container references either image, and
the release is outside every protection and retention set.

The permanent protection set includes active Web/Worker image IDs, last-success current/operations
and rollback pairs, recent accepted images, this deployment's target pair, and any running-container
image. At least `LUMINA_IMAGE_RELEASES_TO_KEEP=3` complete release pairs are retained (allowed range
3–10), which means current + rollback + at least one additional release. Unknown ownership, missing
labels, malformed commits, incomplete pairs, or Docker inspect failure all fail closed.

BuildKit defaults are maximum `12GB`, reserved `2GB`, and maximum age `24h`, configurable through
`LUMINA_BUILDKIT_MAX_USED_SPACE`, `LUMINA_BUILDKIT_RESERVED_SPACE`, and
`LUMINA_BUILDKIT_CACHE_MAX_AGE`. Only `docker buildx --builder lumina-crm-buildkit prune ...` is
allowed. Generic Docker prune commands and every volume/network/container prune are prohibited;
volumes are never automatically pruned.

The checked-in defaults are `LUMINA_BUILDKIT_CACHE_RETENTION_HOURS=24` and
`LUMINA_BUILDKIT_CACHE_MAX_AGE=24h`. The hourly setting also controls storage-maintenance
and generated BuildKit retention. For post-deployment cleanup, an explicit MAX_AGE takes
precedence over the hourly compatibility setting. Existing operator environment overrides
must be updated through the normal deployment configuration process; changing repository
examples does not modify a running host.

Deployment records, archived requests, and deployment logs require both age beyond
`LUMINA_DEPLOYMENT_HISTORY_RETENTION_DAYS=30` and position beyond the newest
`LUMINA_DEPLOYMENT_HISTORY_MIN_KEEP=20`. `latest.json`, `last-success.json`, `compose.env`, the current
request/deployment, and accepted/rollback-related records remain protected. Candidate, recovery, and
rollback env artifacts are removed normally; an orphan is eligible only after its deployment is
terminal and its mtime exceeds 24 hours. Their contents are never printed.

Cleanup state uses `COMPLETED`, `PARTIAL`, `SKIPPED`, or `FAILED_NON_FATAL` and stable warning codes.
Low post-cleanup space emits `STORAGE_PRESSURE_REMAINS`; it never broadens deletion to databases,
object storage, backups, Caddy, Cloudflare Tunnel, HunterAI, other Compose projects, global Docker
resources, `/etc/lumina-crm`, or Git history.

v3.8.15 is the first asynchronous communication-delivery release. Forward application switching
replaces and health-checks Web before replacing Worker, so the old synchronous Web is gone before a
`COMMUNICATION_DELIVERY` process can start. Before rolling back to v3.8.14, stop the Worker first,
restore and health-check the prior Web image, and only then restore the prior Worker image. Never run
the old synchronous Web sender and the new communication Worker concurrently. Do not
down-migrate: the 070/071 schema remains forward-compatible, legacy `crm_system` completion/failure
grants and the transitional Web email values remain until Phase 3.

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
heartbeats, and queues. A live Web with failed database or failed/stuck jobs is not generally ready.
The deployment controller evaluates the same sanitized document through its stricter release-health
baseline contract rather than requiring general readiness HTTP 200. Public acceptance traverses the
Cloudflare Tunnel, checks minimal liveness and exact target application version, and remains a
mandatory release condition without treating queue degradation as a transport failure.

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
df -B1 / /var/lib/lumina-crm/docker /var/lib/lumina-crm/deployments
sudo -u lumina-crm env DOCKER_HOST="$DOCKER_HOST" \
  docker buildx --builder lumina-crm-buildkit du
sudo -u lumina-crm env DOCKER_HOST="$DOCKER_HOST" docker system df -v
```

These are diagnostic commands, not a routine manual cleanup procedure. Review the automatic cleanup
fields and stable warning codes first. Do not respond to storage pressure with a generic prune.

Do not print secret files, use `docker inspect` to read secrets, or paste full database URLs into
logs/tickets. Report variable names, component status, image commit, and redacted error codes.

Email brand configuration: `EMAIL_BRAND_NAME` must be `ewaya` or `ewaya CRM`.
`EMAIL_FROM` must use the matching ewaya display name, for example
`ewaya CRM <sender@example.test>` (replace the reserved example address with an
operator-approved sender). Worker runtime and operator preflight reject legacy
brand values. This requires configuration review, not secret rotation. Web still
delivers authentication email synchronously; business email stays asynchronous.
