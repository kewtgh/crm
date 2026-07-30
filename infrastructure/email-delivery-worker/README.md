# Lumina email delivery Worker

This directory contains the generic, independently deployed Cloudflare Worker that adapts Lumina's
internal delivery protocol to Resend. Windows is the development environment: it may edit source,
run tests and lint, including the no-upload Wrangler test with a fictitious generated config. It
must not hold production identifiers or Cloudflare credentials and the production controller fails
before reading Env on Windows.
Ubuntu is the production environment and is the only place that stores deployment configuration,
holds Cloudflare deployment credentials, deploys the existing Worker in place, and checks health.

## Runtime bindings

The Worker requires these plaintext bindings:

- `CRM_APP_URL`: HTTPS application URL used as the only allowed origin for internal links;
- `EMAIL_FROM`: a mailbox or `Display Name <mailbox>` value accepted by Resend;
- `EMAIL_REPLY_TO`: optional mailbox;
- `EMAIL_BRAND_NAME`: display brand, limited to 120 characters;
- `DELIVERY_PATH`: private POST route;
- `HEALTH_PATH`: public GET health route.

It requires these existing Cloudflare secrets:

- `LUMINA_WEBHOOK_TOKEN`;
- `RESEND_API_KEY`.

The two paths must start with `/`, contain no hostname, protocol, query, fragment, empty segment, or
dot segment, be at most 200 characters, and be different. Missing or invalid runtime configuration
fails closed with `SERVICE_NOT_CONFIGURED`.

The committed `wrangler.toml` contains no Worker name, routes, Custom Domain, account ID, or
plaintext production variables. It explicitly disables both `workers.dev` and Preview URLs,
preserves remote plaintext variables, declares the two required secret binding names, and preserves
the accepted Observability behavior: full-sampling persisted invocation logs are enabled while
traces remain disabled.

## Ubuntu production configuration

After Windows development has pushed an audited commit, Ubuntu pulls that exact commit and installs
`deploy/email-worker-deploy.env.example` as:

```text
/etc/lumina-crm/secrets/email-worker-deploy.env
```

Create `/etc/lumina-crm/secrets` as `root:lumina-crm` with mode `0750`. The installed file must be
owned by `root:lumina-crm`, have mode `0640`, never be world-readable, and never be tracked by Git.
All real values are filled only on the Ubuntu production server. `CLOUDFLARE_API_TOKEN` is a
production deployment secret; `CLOUDFLARE_ACCOUNT_ID` is not a password but remains server-only.
The controller never prints Worker names, URLs, mailboxes, paths, account IDs, or tokens.

Provision the isolated transient configuration root once, with no group or world access:

```sh
sudo install -d -o lumina-crm -g lumina-crm -m 0700 \
  /var/lib/lumina-crm/email-worker-deployments
```

The controller must run as `lumina-crm`. It creates an unpredictable direct child directory with
mode `0700`, writes `wrangler.production.json` with mode `0600`, verifies both owners and rejects
symlinks. The entire child directory, including dry-run output, is removed in `finally` after
success, Wrangler failure, spawn failure, or health rejection.

Do not add `LUMINA_WEBHOOK_TOKEN` or `RESEND_API_KEY` to this file. They remain exclusively in the
existing Cloudflare Worker secret bindings. Deployment code does not read, upload, replace, or
delete either runtime secret. It also does not read the CRM server's `worker.env`.

The controller fails closed unless the Env is a regular non-symlink file, owned by root, assigned
to the `lumina-crm` group, no more permissive than `0640`, and located under a parent directory that
is not world-readable. It rejects missing values, placeholders, non-HTTPS URLs, invalid Worker
names or mailboxes, invalid/equal paths, unsupported keys, and invalid Cloudflare authentication.

## Verification and deployment

On Windows, install and verify development source:

```sh
npm ci
npm test
npm run test:deployment
npm run lint
```

`npm run test:deployment` exercises Wrangler 4.102.0 with a completely fictitious generated JSON
and `--dry-run`; it does not invoke the production controller or upload anything.

On Ubuntu, after pulling and reviewing the intended commit, operators may validate the real
server-only configuration without upload:

```sh
npm run deploy:production:dry-run
```

Only Ubuntu may perform the production deployment. The default Env path is fixed, so no argument
is needed:

```sh
npm run deploy:production
```

Non-Linux execution fails with `PRODUCTION_DEPLOY_REQUIRES_LINUX` before Env access. Both modes use
only the fixed root-owned Env; there is no argument or current-directory fallback.

Before Wrangler starts, the controller uses the read-only Workers Domains API twice: the configured
hostname must belong to the configured Worker, and that Worker must have exactly that one Custom
Domain. Missing domains, ownership conflicts, extra domains, API errors, and malformed responses
fail closed. Dashboard remains available for initial creation, inspection, and emergency rollback;
the normal deployment source of truth is the Ubuntu server-local Env hostname rendered into the
temporary Wrangler JSON. No deployment silently takes over another Worker's domain.

The generated JSON contains the Worker name, disabled workers.dev/Preview URLs, the sole Custom
Domain route, complete plaintext vars, Observability, `keep_vars=true`, and required secret names.
Wrangler receives only `deploy --config <temporary-file> --strict`, plus `--dry-run --outdir` for
dry-run; name, vars, routes, and secrets are not sent as CLI overrides. A failed invocation retains
at most 8 KB of its already-sanitized diagnostic tail; literal and URL-encoded server values remain
redacted. A real deployment performs a GET against
`WORKER_PUBLIC_BASE_URL + HEALTH_PATH` and accepts only the generic
`{ "status": "ok", "service": "lumina-email-delivery" }` contract. It does not send mail.

Do not run secret upload/delete commands during a routine code deployment. If a required secret is
missing, the declared Wrangler secret contract fails the deployment; restore it through the
approved Cloudflare operator procedure.

CRM application initialization and email Worker deployment are separate stages. On the CRM host,
construct `EMAIL_DELIVERY_WEBHOOK_URL` from the server-side Worker base URL and delivery path. Its root-owned
`EMAIL_DELIVERY_WEBHOOK_TOKEN` must match the Worker's `LUMINA_WEBHOOK_TOKEN`. Never place either
production value in Git or documentation.

## Supported templates

The explicit allow-list remains:

- `reminder`
- `password-reset`
- `device-verification`
- `email-verification`
- `staff-account-created`
- `communication-message`
- `calendar-invite`
- `calendar-update`
- `calendar-cancel`

| Template | Required payload fields | Optional payload fields |
| --- | --- | --- |
| `reminder` | `reminderId` | `locale`, `timezone` |
| `password-reset` | `url`, `expiresInSeconds` | — |
| `device-verification` | `code`, `expiresInSeconds` | — |
| `email-verification` | `url`, `expiresInSeconds` | — |
| `staff-account-created` | `username`, `temporaryPassword`, `loginUrl`, `displayNameZh`, `displayNameEn`, `mustChangePassword`, `mfaRequired` | — |
| `communication-message` | `subject`, `body` | `recipientName` |
| `calendar-invite` | `eventVersion`, `appointment` | `attendeeName` |
| `calendar-update` | `eventVersion`, `appointment` | `attendeeName` |
| `calendar-cancel` | `eventVersion`, `appointment` | `attendeeName` |

Calendar `appointment` requires `title_zh`, `title_en`, `starts_at`, `ends_at`, `channel`,
`related_label`, and `status`. Every payload value is validated and HTML-escaped; internal URLs
must use HTTPS and match `CRM_APP_URL`.
