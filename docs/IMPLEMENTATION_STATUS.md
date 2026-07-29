# Implementation status — v3.7.0 release candidate

## Scope

v3.7.0 changes production deployment/operations only. CRM business behavior, schema semantics,
authentication, RLS, Worker leases/idempotency/retry logic, and pages were not redesigned.

The target is an isolated Docker Compose project on a server shared with HunterAI: PostgreSQL 18.4,
Web, and a controlled Worker loop are Lumina containers. Cloudflare Worker is user-facing; host
Caddy is an authenticated origin gateway only.

## Implemented repository assets

- multi-stage Node 24.18 application and PostgreSQL-18-client operations images;
- fixed `lumina-crm` Compose topology with internal backend and separate edge network;
- external database/object/backup volumes and audited provisioning script;
- Web/Worker/bootstrap/migration/backup/restore secret-file boundaries;
- Worker schema gate, four-minute deadline, advisory lock, and heartbeat/queue health;
- explicit database bootstrap, migration verification/migration, and CRM admin bootstrap tasks;
- encrypted database/local-object backup and isolated restore test;
- image deployment, application-only rollback, accepted-state recovery, and Lumina-only cleanup;
- Cloudflare proxy source/config/tests and authenticated Caddy origin gateway;
- Compose-only startup/backup/restore systemd units and current production runbooks.

## Local verification recorded

| Check | Result |
| --- | --- |
| `docker compose -f compose.production.yml --profile ops config --quiet` | Pass |
| Rendered Compose boundary assertions | Pass: project `lumina-crm`; PostgreSQL has no port and only backend; Web binds loopback; external database volume; all restart policies |
| Dedicated builder | Pass: `lumina-crm-buildkit`, `docker-container` driver |
| Docker `application` target | Pass: deterministic install and vinext production build |
| Docker `operations` target | Pass: PostgreSQL client 18.4 and Node 24.18 |
| Docker `verification` target | Pass after including the read-only migration archive in build context: TypeScript, ESLint, 47 business/contracts, 23 deploy contracts, 5 Cloudflare contracts |
| Migration manifest | Pass: 74 ordered checksum-managed files |
| Empty PostgreSQL 18.4 Compose bootstrap/migration | Pass in unique project; 74/74 applied |
| Backup credential boundary | Pass: `crm_backup` write attempt rejected; custom-format dump succeeded |
| Backup encryption/restore | Pass: AES-256-GCM round trip; `pg_restore --exit-on-error` into `lumina_restore_*`; verification and cleanup passed |
| Runtime Compose integration | Pass in unique project: missing/stale heartbeat rejection, Web liveness, database-aware readiness, Worker health, PostgreSQL stop/recovery |
| Application image rollback drill | Pass: prior image tag restored; readiness passed; PostgreSQL container and external volume unchanged; schema remained forward |
| Cleanup contracts | Pass: exact label/tag/in-use/protected-version decisions and forbidden global command allowlist |
| Cloudflare Worker proxy contracts | Pass: no-cache, header replacement, loop prevention, POST body, Cookie/Set-Cookie and origin status |
| Public health configuration dry-run | Pass: `crm.ewaya.com` and a distinct HTTPS origin; no request sent |
| dependency audit | Pass: 0 known vulnerabilities at execution time |

All Compose integration resources used unique `lumina-crm-it-*` or `lumina-crm-rt-*` names and were
removed by exact name/label after the test. These are local Docker tests, not production validation.

## Not performed

No production SSH/deployment, DNS, Cloudflare, Caddy, systemd, firewall, or real production Docker
resource changed. No development or production host/Docker daemon was rebooted. No real
`crm.ewaya.com` or origin request was sent. Backup S3 upload, notification delivery, provider remote
lifecycle, real TLS/origin routing, and server reboot recovery require provisioned infrastructure.
HunterAI and Temporal were not accessed.
