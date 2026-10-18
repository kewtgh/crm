# Email brand and authentication delivery follow-up

## Changes

- Built-in subjects, copy, footer and sender display name use `Ewaya CRM`.
  Existing lowercase Ewaya configuration remains accepted and is normalized.
  Infrastructure identifiers and secret names remain compatible.
- Every template uses the shared white-background logo at the configured
  application origin's `/icon-512x512.png`. Explicit image dimensions and a text
  brand label preserve the layout when an email client blocks remote images.
  The web application must serve the asset introduced in v3.37.2.
- The default provider timeout is eight seconds, below the Web caller's
  ten-second timeout. Previously the provider could wait fifteen seconds while
  the caller had already invalidated the token. This addresses that timeout
  mismatch; it does not accelerate delivery after provider acceptance.
- Provider outcomes include `providerDurationMs`, without recipient addresses,
  message bodies, credentials or token links. Authentication emails still make
  one immediate provider request; no automatic retry or scheduling is added.

## Delay investigation boundary

New-device verification uses `lib/auth/email-tokens.ts` and sends directly to
the delivery webhook. It does not use the periodically polled notification
outbox. A successful Web response follows a successful delivery-service response
with a provider receipt. This establishes provider acceptance, not inbox arrival.

If the Web response is fast but the inbox receives the email later, compare the
provider's sent and delivered timestamps and any delayed events. If delivery to
the recipient server was fast, examine the recipient's mail processing. These
checks require operational evidence and cannot be established by fixture tests.
See [Resend's email events timeline](https://resend.com/changelog/email-events-timeline).

If a matching `Delivered` event precedes inbox visibility, open its **See Details**
view in Resend and use the receiving server's message ID for a recipient-side
trace. Check the mailbox web interface independently of desktop/mobile clients,
all folders and conversation threads, quarantine, rules and forwarding. Retain
message IDs and operational delivery logs only as private evidence.
See [Resend's delivery details](https://www.resend.com/changelog/improved-bounced-and-delivery-details).

This application does not enable tracking in its send payload. Resend tracking is
configured separately at the domain level. Check that setting rather than assuming
the application's payload proves tracking is disabled. Resend recommends disabling
open tracking for transactional mail to improve inbox placement; a configuration
change still needs validation and is not proof of a specific delay's cause.
See [Resend's tracking documentation](https://resend.com/docs/dashboard/domains/tracking).

The current source already lacked the old brand in built-in body copy before
this follow-up. Old-brand emails therefore also require checking that the
configured webhook targets the current deployed email worker. Deploying the web
application alone does not update that separate worker.

## Verification

- 124 email-worker tests passed, including both locales for every template,
  logo markup, legacy configuration compatibility, immediate dispatch and timeout.
- Six authentication contract tests passed, including new-device login,
  mandatory MFA and asynchronous business-communication separation.
- Six Chromium revision 1248 email-layout checks passed for the device
  verification template: two locales at 390, 768 and 1280 pixels, plus dark-mode
  checks. The logo was served from a local fixture; no email was sent.
- Targeted ESLint passed with zero warnings.

Browser evidence is private under the ignored
`work/browser-qa-chromium-1248/email-brand-fix/` directory. These checks do not
verify Gmail/Outlook rendering, a production deployment or real inbox latency.
No live inbox delay was reproduced or verified by these checks. A receiving
provider may filter mail after accepting it; changing application timeouts does
not bypass such filtering. Production event details and mailbox evidence must
remain private.
