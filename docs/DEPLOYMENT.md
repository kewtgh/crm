# Lumina CRM v3.2 — PostgreSQL deployment and recovery runbook

This runbook targets one Linux VPS with 8 GB RAM. Caddy, the CRM Web process, Workers and PostgreSQL
share the host. PostgreSQL must never listen on a public interface. Backups must leave the VPS.

## 1. Host layout

```text
/opt/lumina-crm/source       reviewed Git checkout
/opt/lumina-crm/releases     immutable application releases
/opt/lumina-crm/current      symlink to the active release
/var/lib/lumina-crm          deploy state, cache, local objects and short-lived backups
/var/lib/postgresql          PostgreSQL data
/etc/lumina-crm              production.env and deploy.env
/etc/postgresql              PostgreSQL configuration
/etc/caddy                   HTTPS reverse-proxy configuration
```

Use a dedicated `lumina-crm` Unix account. Keep the database data directory and persistent object
directory outside source and release paths.

## 2. PostgreSQL

Install the current supported PostgreSQL 18 packages and client tools (`psql`, `pg_dump`,
`pg_restore`). Copy the reviewed baselines from:

- `deploy/postgresql/postgresql.conf`;
- `deploy/postgresql/pg_hba.conf`.

The baseline listens on `127.0.0.1` and `::1`, uses SCRAM authentication, enables the slow-query log,
rotates logs, enables `pg_stat_statements`, and sets conservative 8 GB host memory defaults.
Confirm the effective listener before continuing:

```bash
sudo ss -ltnp | grep 5432
sudo -u postgres psql -Atqc "show listen_addresses"
```

No firewall rule may expose port 5432. Run `VACUUM` and `ANALYZE` through PostgreSQL autovacuum;
review table bloat and slow queries periodically instead of scheduling blanket `VACUUM FULL`.
PgBouncer is optional and should be introduced only when measured connection pressure requires it.

## 3. Database roles and clean initialization

The repository defines:

| Role | Purpose |
| --- | --- |
| `crm_app` | request-scoped application access with RLS |
| `crm_system` | trusted server authentication/admin workflows |
| `crm_worker` | queue claims, completion and heartbeats |
| `crm_migrator` | Schema ownership and forward migrations |
| `crm_backup` | read-only logical backup; `BYPASSRLS` only so every tenant row is included |

Because the pre-v3 database contains test data only, initialize a new empty `lumina_crm` database.
Do not copy the retired authentication tables.

Prepare `/etc/lumina-crm/deploy.env` from `deploy/deploy.env.example`, then run from the reviewed
release:

```bash
set -a
. /etc/lumina-crm/deploy.env
set +a
npm run db:bootstrap
npm run db:migrations:verify
npm run db:migrate
```

`db:bootstrap` creates or rotates only the named database roles. `db:migrate` takes a PostgreSQL
advisory lock, stores SHA-256 checksums in `app_meta.schema_migrations`, rejects modified applied
migrations and commits one migration at a time.

Create the first administrator with a strong one-time password supplied through the protected
environment:

```bash
npm run auth:bootstrap-admin
```

The administrator must replace the temporary password, enroll TOTP and retain recovery codes.

## 4. Runtime configuration

Install `/etc/lumina-crm/production.env` as `root:lumina-crm` mode `0640`. Start with
`deploy/production.env.example`; `.env.example` also contains bootstrap and deployment-only
settings and must not be copied into the runtime environment.
At minimum configure:

- canonical HTTPS `APP_URL` and CAPTCHA keys;
- independent `DATABASE_URL`, `SYSTEM_DATABASE_URL`, and `WORKER_DATABASE_URL`;
- workspace UUID and independent throttle/device/TOTP/storage secrets;
- local persistent or S3-compatible object storage;
- delivery endpoint used for verification, reset and device codes.

The deployment preflight enforces the dedicated `crm_app`, `crm_system`, `crm_worker`, and
`crm_migrator` URL usernames. The application role must not receive system, migration or backup
credentials. Bootstrap administrator settings and the migration, administration, backup, and host
monitoring settings belong outside `production.env`; deployment and backup settings belong in
`/etc/lumina-crm/deploy.env`.

`crm_backup` is the sole non-superuser RLS bypass exception. It receives read-only grants and cannot
write, create databases, create roles or replicate. Never use it in Web, API, Worker or reporting
runtime code.

For the reviewed local-storage profile, use `/var/lib/lumina-crm/objects` and include it in
off-host backup. The deployment runner creates and verifies this real sandbox directory for both
providers (it remains empty in S3 mode); the Web and Worker systemd sandboxes grant write access
only to this persistent root. During initial host provisioning, create it before the first Web start:

```bash
sudo install -d -o lumina-crm -g lumina-crm -m 0750 /var/lib/lumina-crm/objects
```

For S3-compatible storage, configure every `S3_*` field shown in the runtime template and give the
runtime a bucket prefix scoped to CRM objects; use a separate account and bucket for database
backups.

## 5. Caddy and systemd

Install `deploy/caddy/Caddyfile` as the Caddy site configuration and provide `CRM_DOMAIN` and
`ACME_EMAIL` through Caddy's environment. It terminates HTTPS and proxies only to
`127.0.0.1:3200`.

Install the reviewed units under `/etc/systemd/system`:

- `lumina-crm.service`;
- `lumina-crm-workers.service` and `.timer`;
- `lumina-crm-backup.service` and `.timer`;
- `lumina-crm-restore-test.service` and `.timer`;
- `lumina-crm-disk-monitor.service` and `.timer`;
- `lumina-crm-deploy.service`.

Then:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now caddy lumina-crm.service
sudo systemctl enable --now lumina-crm-workers.timer
sudo systemctl enable --now lumina-crm-backup.timer
sudo systemctl enable --now lumina-crm-restore-test.timer
sudo systemctl enable --now lumina-crm-disk-monitor.timer
```

All CRM units clear inherited proxy variables. Review the least-privilege sudo policy in
`deploy/sudoers/lumina-crm-deploy`; it authorizes only the CRM application units used by the
deployment runner.

## 6. Backup and recovery

The daily backup service:

1. runs `pg_dump --format=custom` through `crm_backup`;
2. encrypts with AES-256-GCM before persistence;
3. uploads to an independent S3-compatible provider;
4. keeps only a small local window;
5. sends success or failure notification.

Configure the object-store lifecycle to retain encrypted objects for 30 days (minimum 14). The
application cannot enforce a remote provider lifecycle by itself.

Run the first backup and inspect its journal:

```bash
sudo systemctl start lumina-crm-backup.service
sudo journalctl -u lumina-crm-backup.service -n 100 --no-pager
```

Restore verification selects the newest local encrypted backup by default, decrypts into a private
temporary directory, creates only a `lumina_restore_<timestamp>_<pid>` database, restores with
`--exit-on-error`, verifies authentication/CRM/migration structures and drops the temporary database.
It never restores over `lumina_crm`.

```bash
sudo systemctl start lumina-crm-restore-test.service
sudo journalctl -u lumina-crm-restore-test.service -n 100 --no-pager
```

For a downloaded off-host backup:

```bash
npm run db:restore:test -- /absolute/path/lumina-crm-YYYYMMDDTHHMMSSZ.dump.enc
```

Record the observed duration. Recovery time is not an estimate until a real restore has completed.
VPS snapshots are supplementary and do not replace logical backup.

## 7. Capacity and monitoring

`lumina-crm-disk-monitor.timer` checks PostgreSQL and application state files every 15 minutes. It
fails and sends a webhook when available capacity falls below `DISK_FREE_PERCENT_THRESHOLD` (15%
by default). Monitor Caddy errors, PostgreSQL slow queries, backup/restore unit failures, Web
readiness and Worker heartbeats in the same alerting system.

## 8. Release deployment

After one-time host, systemd, environment, database-role, and Caddy provisioning, the release
controller performs repeatable one-command deployments. Before the first real run, use its
non-mutating configuration check:

```bash
npm run deploy:production:dry-run
npm run deploy:production
npm run deploy:production:status
npm run deploy:production:logs
```

The dry run checks the v3 runtime-role split, migration role, Local/S3 storage configuration,
runtime/deployment secret boundary, persistent object-store sandbox permissions, lock location,
loopback listener, reviewed install scripts, and stable controller commands.

The persistent runner:

```text
exclusive lock
-> git pull --ff-only
-> exact commit and clean-tree validation
-> dependency install
-> type/lint/contract checks
-> production build
-> migration verification and locked migration
-> immutable release manifest
-> atomic current symlink switch
-> Web restart and Worker run
-> loopback liveness/readiness
-> public HTTPS health
```

Only the single Git pull may use the configured loopback proxy. No build, migration, runtime,
Worker, backup or health process inherits it.

If failure occurs before cutover, the active release is unchanged. If application validation fails
after cutover, the runner restores and verifies the previous application release. A forward
database migration is not automatically reversed; every migration must remain compatible with the
previous application until the release is accepted.

## 9. Clean cutover from the test system

No business-data migration is required. Use this sequence:

1. deploy the new empty PostgreSQL database and v3 application in pre-production;
2. run migration, authentication, Worker and object-storage smoke checks;
3. complete one encrypted backup and one real restore verification;
4. stop writes to the old test deployment;
5. create the production administrator and required staff accounts;
6. switch the domain to Caddy on the new deployment;
7. verify login, TOTP, CRUD, imports, exports, Worker heartbeats and backup notification;
8. keep the old project read-only only as a short rollback reference, then delete it through its
   provider console after the retention decision.

Do not copy test sessions, password hashes, TOTP secrets, tokens or storage URLs into production.

## 10. Incident checks

```bash
curl -fsS http://127.0.0.1:3200/api/health
curl -fsS http://127.0.0.1:3200/api/health?mode=ready
sudo systemctl status postgresql lumina-crm.service lumina-crm-workers.timer
sudo journalctl -u postgresql -u lumina-crm.service -u lumina-crm-workers.service -n 200 --no-pager
```

Readiness returns separate environment, authentication, database, Worker and queue reason codes.
It is intentionally available only through loopback; public monitoring must use the minimal
`/api/health` liveness response. Correct the reported component; do not hide a database failure
behind a generic Web 200.
