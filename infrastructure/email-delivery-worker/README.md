# Lumina email delivery Worker

This directory contains the generic, independently deployed Cloudflare Worker that adapts Lumina's
internal delivery protocol to Resend. Public source contains no production Worker name, hostname,
sender, route, account identifier, or deployment URL. All production-specific values come from a
local, ignored Env file and existing Cloudflare bindings.

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
plaintext production variables. It disables `workers.dev`, preserves remote plaintext variables,
and declares only the two required secret binding names. Custom Domain routing remains managed in
Cloudflare Dashboard.

## Local production configuration

Copy the empty tracked template to the ignored local filename:

```sh
cd infrastructure/email-delivery-worker
cp .env.production.example .env.production.local
```

PowerShell equivalent:

```powershell
Set-Location infrastructure/email-delivery-worker
Copy-Item .env.production.example .env.production.local
```

Fill `.env.production.local` locally:

```dotenv
WORKER_NAME=
WORKER_PUBLIC_BASE_URL=
CRM_APP_URL=
EMAIL_FROM=
EMAIL_REPLY_TO=
EMAIL_BRAND_NAME=
DELIVERY_PATH=
HEALTH_PATH=
CLOUDFLARE_ACCOUNT_ID=
CLOUDFLARE_API_TOKEN=
```

The final two Wrangler authentication values are optional. Do not place
`LUMINA_WEBHOOK_TOKEN` or `RESEND_API_KEY` in this file: production secrets remain in Cloudflare
Dashboard and are neither read nor uploaded by the deployment controller.

The controller rejects missing values, placeholder domains, non-HTTPS URLs, invalid mailboxes,
invalid paths, unsupported Env keys, and invalid optional Cloudflare authentication values. It
does not print local emails, URLs, paths, tokens, or account IDs.

## Verification and deployment

Install and verify:

```sh
npm ci
npm test
npm run test:deployment
npm run lint
```

Validate, bundle, and perform a Wrangler dry-run without uploading or changing Dashboard state:

```sh
npm run deploy:production:dry-run
```

After confirming the local Worker name matches the existing Dashboard Worker, deploy with:

```sh
npm run deploy:production
```

The Node controller always passes `--name`, `--keep-vars`, and `--strict`, sends only the six
plaintext Worker bindings through Wrangler, and never passes a route, Custom Domain, or secret. A
real deployment performs a GET against `WORKER_PUBLIC_BASE_URL + HEALTH_PATH` and accepts only the
generic `{ "status": "ok", "service": "lumina-email-delivery" }` contract. It does not send mail.

Do not run secret upload/delete commands during a routine code deployment. If a required secret is
missing, the declared Wrangler secret contract fails the deployment; restore it through the
approved Cloudflare operator procedure.

For the CRM host, construct `EMAIL_DELIVERY_WEBHOOK_URL` from the locally configured
`WORKER_PUBLIC_BASE_URL` and `DELIVERY_PATH`. Its root-owned
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
