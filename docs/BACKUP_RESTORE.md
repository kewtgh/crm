# Backup and restore-test runbook

This runbook applies to v3.7 Compose. `backup` receives only the read-only `crm_backup` URL.
`restore-test` has a separate administrator secret and never receives runtime or migration
credentials.

Run an on-demand encrypted backup:

```sh
sudo systemctl start lumina-crm-backup.service
sudo systemctl status lumina-crm-backup.service
```

Success means encrypted local persistence and off-host upload both completed. Upload failure returns
non-zero and sends a failure notification; it is never reported as complete success. Database dumps
use custom format. Local-object mode also encrypts an archive from the external objects volume.
Plain dump/tar bytes exist only in container temporary storage and are removed in `finally`.

Run restore verification:

```sh
sudo systemctl start lumina-crm-restore-test.service
sudo systemctl status lumina-crm-restore-test.service
```

It decrypts into temporary storage, creates only `lumina_restore_<timestamp>_<pid>`, runs
`pg_restore --exit-on-error`, verifies auth/CRM/migration tables, terminates test connections, drops
the temporary database, and removes decrypted files. Cleanup is attempted after success or failure.
It never targets or overwrites `lumina_crm`.

Remote lifecycle/retention belongs to the object provider. Keep the backup bucket/account/prefix
independent from runtime S3 storage. Never log encryption keys, access keys, or complete database
URLs.
