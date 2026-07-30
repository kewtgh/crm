# Lumina CRM email delivery Worker

This is an independently deployed Cloudflare Worker. It accepts Lumina's existing internal email
delivery protocol only at `https://crm-mail.ewaya.com/crm-delivery`, renders an allow-listed
brand template, and calls the Resend Send Email API with the same idempotency key. It is not a CRM
Web route and has no root-application runtime dependency.

## Configuration

`wrangler.toml` disables `workers.dev` and attaches the Worker as the Custom Domain
`crm-mail.ewaya.com`. A Custom Domain owns the hostname, so remove any conflicting CNAME or other
DNS record before deployment. Do not add a Cloudflare account ID to the repository.

Set the non-secret variables before deployment:

- `LUMINA_EMAIL_FROM`: a verified Resend sender, replacing the intentionally invalid checked-in
  placeholder;
- `LUMINA_EMAIL_REPLY_TO`: optional, configured as a normal Wrangler variable only when required;
- `LUMINA_APP_URL=https://crm.ewaya.com`;
- `LUMINA_BRAND_NAME=Lumina Education CRM`.

Set secrets interactively. Never place their values in Git, `wrangler.toml`, build arguments, shell
history, or CRM logs:

```sh
cd infrastructure/email-delivery-worker
npm ci
npm test
npm run lint
npx wrangler secret put CRM_DELIVERY_WEBHOOK_TOKEN
npx wrangler secret put RESEND_API_KEY
npx wrangler deploy
```

`CRM_DELIVERY_WEBHOOK_TOKEN` must exactly match `EMAIL_DELIVERY_WEBHOOK_TOKEN` in the production
CRM `worker.env`. Set:

```text
EMAIL_DELIVERY_WEBHOOK_URL=https://crm-mail.ewaya.com/crm-delivery
```

No secret is shared with Resend except `RESEND_API_KEY`, which remains bound only to this Worker.

## Post-deployment checks

Confirm the public health response without sending or exposing any secret:

```sh
curl --fail --silent --show-error https://crm-mail.ewaya.com/health
```

For a controlled delivery check, generate the webhook token locally, pipe it to
`wrangler secret put`, and keep both it and the operator-supplied test recipient only in shell
variables. The example uses no production secret or checked-in email address:

```sh
TEST_TOKEN="$(openssl rand -hex 32)"
printf '%s' "$TEST_TOKEN" | npx wrangler secret put CRM_DELIVERY_WEBHOOK_TOKEN
read -r TEST_RECIPIENT
TEST_ID="delivery-smoke-$(date +%s)"
curl --fail --silent --show-error \
  -X POST https://crm-mail.ewaya.com/crm-delivery \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer ${TEST_TOKEN}" \
  -H "Idempotency-Key: ${TEST_ID}" \
  --data "{\"id\":\"${TEST_ID}\",\"to\":\"${TEST_RECIPIENT}\",\"template\":\"device-verification\",\"payload\":{\"code\":\"123456\",\"expiresInSeconds\":600}}"
unset TEST_TOKEN TEST_RECIPIENT TEST_ID
```

After the check, install the same generated webhook token in the root-owned CRM `worker.env`
without printing it. A later retry must reuse the same idempotency key.

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
