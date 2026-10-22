# Deployment recovery operations

These procedures describe operator actions for a reviewed installation. Repository validation does not authorize executing them on production. Source permissions remain private to `lumina-crm`; do not run npm from an operator's home, change ownership, or run the deployment as root.

## Runtime and commands

First inspect the execution toolchain without changing it:

```bash
/usr/bin/node --version
sudo -u lumina-crm env HOME=/var/lib/lumina-crm /usr/bin/node --version
systemctl cat lumina-crm-deploy.service
```

The CLI, systemd bootstrap, target controller and application image require Node `>=24.22.0 <25`. A host v26 executable is incompatible even if containers have the correct version. Failure reports `HOST_NODE_VERSION`, `REQUIRED_NODE_VERSION`, and `COMPATIBILITY_RESULT` before source update. Install a separately reviewed Lumina-owned Node 24 toolchain if needed; verify its checksum, ownership, executable version and systemd execution permissions, then review the service's explicit executable and CLI together. Do not replace the server-global Node or paste an unverified alternate executable into the unit. The checked-in unit continues to use `/usr/bin/node`; upgrading repository source alone cannot repair an incompatible host executable.

Copyable commands require no `cd` into the source:

```bash
sudo -u lumina-crm env HOME=/var/lib/lumina-crm /usr/bin/node /opt/lumina-crm/source/scripts/deploy-production.mjs status
sudo -u lumina-crm env HOME=/var/lib/lumina-crm /usr/bin/node /opt/lumina-crm/source/scripts/deploy-production.mjs logs
sudo -u lumina-crm env HOME=/var/lib/lumina-crm /usr/bin/node /opt/lumina-crm/source/scripts/deploy-production.mjs logs --follow
sudo -u lumina-crm env HOME=/var/lib/lumina-crm /usr/bin/node /opt/lumina-crm/source/scripts/deploy-production.mjs start --detach
```

CLI admission uses a process-held `flock` on `request-admission.lock`; the established systemd service still holds `deploy.lock` for the entire controller lifetime. The admission lock remains held while the CLI follows the request. A competing CLI receives exit 73; it must inspect status rather than create another request. A CLI disconnect does not release the service's execution lock.

## State and recovery

| State | Allowed action |
| --- | --- |
| `BOOTSTRAP_FAILED`, `recoverySafe: true` | Retry the same operation with `start`, `initialize`, `rollback` or `recover`; original request ID and attempt history remain. Source is fully revalidated. |
| Bootstrap handoff, interrupted migration/switch, incomplete or historical state | No automatic replay. Inspect the original journal and runtime. Time elapsed is never proof of safety. |
| `PUBLIC_EDGE_RECOVERY_REQUIRED` | Keep the target and database. Repair external connectivity independently, then run `accept`. |
| `APPLICATION_RECOVERY_REQUIRED` | Manual application/schema investigation. Do not delete the request or substitute old images. An uncertain migration cannot be replayed by this CLI. |
| Terminal `CONTROL_PLANE_FINALIZATION_FAILED` | Run `reconcile` only after service inactivity and review of original terminal journal/archive identity. No fetch, migration, build, or switch occurs. Conflicts fail closed. |
| Finalized `SUCCESS` | Fully accepted release; next deployment may create a new request. |

```bash
sudo -u lumina-crm env HOME=/var/lib/lumina-crm /usr/bin/node /opt/lumina-crm/source/scripts/deploy-production.mjs accept --detach
sudo -u lumina-crm env HOME=/var/lib/lumina-crm /usr/bin/node /opt/lumina-crm/source/scripts/deploy-production.mjs reconcile
```

`accept` keeps the request's original mode/ID, commit, version, candidate environment and immutable image references. It verifies the clean source at that commit without fetching, checks database and image migration manifests, Web/Worker image identity, internal readiness and public liveness. No build or migration is repeated. A failed internal check cannot accept the candidate. No unrelated `start` can overwrite a pending candidate. Terminal filesystem reconciliation is repeatable after an interrupted archive or final write; archive identity conflicts require investigation. A legacy bootstrap record misclassified as a finalization failure lacks sufficient terminal evidence and is intentionally rejected by `reconcile`; it cannot be blindly replayed.

Migration state is `NOT_STARTED`, `STARTED_OR_UNKNOWN`, or `COMPLETED`. Database evidence is a read-only repeatable-read snapshot of migration names and checksums, summarized by count, head and digest. Image evidence comes from migration files inside the actual immutable application image. Only exact equality proves compatibility; release ordering proves nothing. Explicit `rollback` and `recover` use the same compatibility guard. Explicit rollback reads database evidence using the currently accepted image's tooling, then compares the old image's manifest. If the current tooling image lacks the new schema-evidence command, evidence is unavailable and restoration is refused; use a reviewed compatible instrumented release rather than weakening the check. No reverse migration or ledger rewrite is provided.

For forward-migrated healthy targets with public failure, the journal independently records database schema, runtime, internal health, edge health, and final acceptance. `APPLICATION_HEALTHY_PUBLIC_EDGE_UNAVAILABLE` is not full success. An unsafe rollback is distinct from an attempted `FAILED` rollback. Public failures are bounded and categorized: HTTP 530/502/503/504, DNS, TLS, timeout, reset, other transport, rejected HTTP, wrong version and invalid response. Wrong version/invalid body fail immediately; only transport and listed transient HTTP errors retry. Never use loopback health to claim public availability.

## Read-only Tunnel diagnosis

Use the reviewed public health URL and expected Lumina Tunnel UUID from private operational inventory; do not commit those values:

```bash
sudo -u lumina-crm env HOME=/var/lib/lumina-crm /usr/bin/node /opt/lumina-crm/source/scripts/diagnose-production-tunnel.mjs 'https://<public-host>/api/health' '<lumina-tunnel-uuid>'
systemctl show cloudflared-lumina.service -p ActiveState -p SubState -p NRestarts -p MainPID
```

The diagnostic reads only this service and its MainPID, verifies cloudflared executable/cgroup membership, extracts only the Tunnel UUID and error category from that PID's current-boot journal, and discovers listening sockets from that process's descriptors. It queries only loopback metrics on owned sockets. Metrics ports may change after restart or because another instance already owns a port. A running process with zero `cloudflared_tunnel_ha_connections` is `DISCONNECTED`; `systemctl active` alone is insufficient. Missing process/journal permissions or an identity change reports `UNKNOWN`, never fabricated connectivity. Use the existing service account's read permissions where available; a narrowly authorized operator may collect the same minimized fields. Do not broaden source or credential permissions, read token files, or inspect other Tunnel instances.

The historical documented host unit uses `Type=notify`, unlimited startup timeout and unlimited start rate. These can conceal readiness failure or allow repeated restart storms. They are plausible operational weaknesses, not a proven incident cause. No active Tunnel unit or override is installed by this release.

Optional **review-only** Lumina-specific drop-in, to be adapted to observed readiness timings and installed cloudflared behavior:

```ini
# cloudflared-lumina.service.d/readiness.conf — example only
[Unit]
StartLimitIntervalSec=300
StartLimitBurst=5
[Service]
TimeoutStartSec=120
RestartSec=15
```

Review the full effective unit first. Verify that the installed cloudflared emits systemd `READY=1`, registers connections and stays registered. A finite notify timeout and restart limit may deliberately leave a disconnected service failed; monitoring and an operator recovery procedure are required. Do not install this example without staging verification. Keep protocol, TLS verification, token paths, account routes and DNS unchanged.

After a confirmed proxy/network recovery, check the correct service's current PID, registration count and public response. If only the Lumina Tunnel remains stuck and its dependencies are healthy, an authorized operator can perform a **service-only** restart of `cloudflared-lumina.service` and then repeat these checks. If rate-limited, review the failure before a scoped `reset-failed`. Do not restart other Tunnel/proxy/application/database services. Do not restart while network failures persist just to generate more attempts. An unexpected process identity, bad credential, or route/configuration mismatch requires investigation; repeated restarts cannot repair it. Routine recovery does not require a host reboot.

Check network paths separately: Git's configured proxy; ordinary HTTPS TCP 443; Tunnel TCP/UDP 7844; actual Edge registration; public HTTP response. Successful TCP establishment on 7844 does not prove TLS/QUIC handshake or registration. Do not force HTTP/2 or QUIC based on this incident alone and never disable TLS verification.

References: [Cloudflare metrics and port selection](https://developers.cloudflare.com/tunnel/configuration/), [Cloudflare Tunnel monitoring](https://developers.cloudflare.com/tunnel/monitoring/), [systemd readiness, timeouts and restart behavior](https://www.freedesktop.org/software/systemd/man/latest/systemd.service.html).
