# Lumina CRM email delivery Worker

This directory is the canonical source for Lumina's route on the existing production Cloudflare
Worker at `mail-api.ewaya.com`. It accepts Lumina's internal email-delivery protocol only at
`https://mail-api.ewaya.com/lumina-crm/delivery`, renders an allow-listed brand template, and calls
the Resend Send Email API with the same idempotency key. It is not a CRM Web route and has no
root-application runtime dependency.

## Configuration

`wrangler.toml` disables `workers.dev`, keeps existing plaintext variables, and references the
already-bound Custom Domain `mail-api.ewaya.com`. It deliberately omits the Worker `name`. Before
deploying, open Cloudflare Dashboard, confirm the exact Worker currently bound to that hostname,
and use that existing name as the explicit `--name` deployment input.

Do not invent a Worker name, create a second Worker, create another Custom Domain, or change the
existing DNS binding. Do not add a Cloudflare account ID to the repository.

The existing non-secret variables are:

- `EMAIL_FROM=Lumina CRM <notifications@notify.ewaya.com>`;
- `EMAIL_REPLY_TO`: optional;
- `CRM_APP_URL=https://crm.ewaya.com`;
- `LUMINA_BRAND_NAME=Lumina Education CRM`.

The existing secret bindings are `LUMINA_WEBHOOK_TOKEN` and `RESEND_API_KEY`. Retain the current
webhook token when possible. Do not regenerate, replace, upload, print, or otherwise modify the
Resend API key as part of this code deployment. Never place either value in Git, `wrangler.toml`,
build arguments, shell history, or CRM logs.

Install and verify locally:

```sh
cd infrastructure/email-delivery-worker
npm ci
npm test
npm run lint
```

After confirming the existing Worker name and reviewing the current Dashboard bindings, the
operator deployment command is:

```sh
npx wrangler deploy --name <EXISTING_MAIL_API_WORKER_NAME> --keep-vars
```

The placeholder must be replaced with the exact existing Worker name. Do not run `wrangler secret
put` for this release.

`LUMINA_WEBHOOK_TOKEN` must exactly match `EMAIL_DELIVERY_WEBHOOK_TOKEN` in the production CRM
`worker.env`. Set:

```text
EMAIL_DELIVERY_WEBHOOK_URL=https://mail-api.ewaya.com/lumina-crm/delivery
```

No secret is shared with Resend except `RESEND_API_KEY`, which remains bound only to this Worker.

## Post-deployment checks

Confirm the public health response without sending or exposing any secret:

```sh
curl --fail --silent --show-error https://mail-api.ewaya.com/health
```

For a controlled delivery check, read the already-matching webhook token locally without printing
it, and keep both it and the operator-supplied test recipient only in shell variables. The example
contains no production secret or checked-in recipient:

```sh
read -s LUMINA_TEST_TOKEN
read -r TEST_RECIPIENT
TEST_ID="delivery-smoke-$(date +%s)"
curl --fail --silent --show-error \
  -X POST https://mail-api.ewaya.com/lumina-crm/delivery \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer ${LUMINA_TEST_TOKEN}" \
  -H "Idempotency-Key: ${TEST_ID}" \
  --data "{\"id\":\"${TEST_ID}\",\"to\":\"${TEST_RECIPIENT}\",\"template\":\"device-verification\",\"payload\":{\"code\":\"123456\",\"expiresInSeconds\":600}}"
unset LUMINA_TEST_TOKEN TEST_RECIPIENT TEST_ID
```

The CRM host's root-owned `EMAIL_DELIVERY_WEBHOOK_TOKEN` must already contain that same token. A
later retry must reuse the same idempotency key.

## Supported templates

The allow-list is derived mechanically from the current migrations and every direct
`EMAIL_DELIVERY_WEBHOOK_URL` caller:

- `reminder`
- `password-reset`
- `device-verification`
- `email-verification`
- `staff-account-created`
- `communication-message`
- `calendar-invite`
- `calendar-update`
- `calendar-cancel`

The database's actual calendar delivery types are `INVITE`, `UPDATE`, and `CANCEL`; the CRM maps
them to the final three keys above. Unknown templates and missing variables return HTTP 422.

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

Calendar `appointment` requires the exact fields selected by the CRM Worker:
`title_zh`, `title_en`, `starts_at`, `ends_at`, `channel`, `related_label`, and `status`.
