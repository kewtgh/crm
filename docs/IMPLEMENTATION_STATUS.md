# Lumina Education CRM implementation status (v0.5.0)

v0.5.0 turns the earlier interaction prototype into a production-oriented CRM foundation. It keeps the restrained Vinext/Next + Supabase architecture and adds a real workspace data boundary instead of introducing a microservice or monorepo rewrite.

## Persisted and enforced

- Isolated Supabase project, workspace and membership model, row-level security, audit events, and server-owned role checks.
- Separate login and parent registration, field-local errors, Turnstile reset, refresh-token flow, and one-shot administrator bootstrap that removes `ADMIN_PASSWORD` after initialization.
- Unique usernames, immutable UUIDs, and independent Chinese/English name fields. Personal names remain the only intentional simultaneous bilingual display.
- Server-side search, sort, page limits, exact counts, CSV export, and duplicate revalidation for the school, contact, and task vertical slice.
- Product catalog with the five defaults, custom products, versioned effective prices, currencies, and deactivation history.
- Contract records, renewal dates, relationship level, owner, server pagination/search, and idempotent 90/60/30/14/7-day reminder generation.
- Two-month calendar backed by appointments; create/complete actions persist and generate reminders.
- In-app reminder processing with `pg_cron` where available, plus an external-runner fallback. Email work is written to an outbox and is not marked sent by this application.
- Confirmed-payment monthly/quarterly/annual aggregation, product mix, customer segments, and customer ranking.
- Contract-sign, contract-export, performance-summary, and performance-allocation approval requests with maker/checker protection and audit actions.
- Versioned manager targets and allocations to sales specialists and the separate sales-support branch, with allocation caps and duplicate-contributor constraints.
- Profile, honorific, bio, language, time zone, date format, notifications and quiet hours; private avatar storage; password update; other-session revocation; Supabase TOTP MFA enrollment and verification.
- Shared internationalization catalogs, language switch, searchable select, pagination, status, inline message, progress, and feedback components.

## Intentionally still bounded

The repository is not presented as a finished enterprise CRM. Students, households, leads, opportunity pipeline, imports, merge review, data-quality rules, AI workbench, the executive dashboard, and parts of administrator user management still use acceptance fixtures. The sales analysis page has complete target/forecast/playbook UX, but some team figures and relationship-coverage edits remain local presentation data; the persisted target/allocation workflow is under `/sales/allocation`.

Production rollout also needs an email outbox sender, organization-specific retention/legal review, backup and recovery exercises, monitoring, formal permission-matrix UAT for every role, and load/accessibility testing with anonymized high-volume data.

## Local environment

The CRM stack uses ports 56321–56324 and must not reuse another application's containers or database. Run:

```bash
npx supabase start
npm run env:configure-local
npm run auth:bootstrap-admin
```

`auth:bootstrap-admin` creates or synchronizes the actual Supabase Auth user, saves the initial local credential only under the Git-ignored `work/` directory, and removes `ADMIN_PASSWORD` from `.env.local`. Environment variables alone never create an account. Never enable `CRM_DEMO_MODE` or Turnstile test keys in production.
