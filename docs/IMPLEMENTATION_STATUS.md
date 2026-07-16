# Lumina Education CRM implementation status (v0.4.0)

This repository now contains a runnable modern CRM application baseline built from the supplied planning package.

## Implemented vertical slice

- Separate sign-in and guardian registration routes with a persistent Chinese/English switch and matched locale catalogs.
- Inline form errors and automatic Turnstile reset on verification failure.
- Supabase Auth REST integration boundary, refresh route and a one-shot administrator bootstrap script.
- Protected CRM route group, server-enforced administrator routes, responsive main menu and nested administration menu.
- Operations dashboard, schools, people, students, households, leads, opportunities, tasks, progression, imports, duplicate review, data quality, reports, AI review, products and message surfaces.
- Shared search, pagination, status, progress, searchable select, toast and inline-message components.
- User-settings interfaces for avatar, bilingual name, honorific, email, password, language, notifications, privacy, sessions and MFA. These controls remain prototype-only until the production profile/security services are connected.
- Administrator portal with reminders, security events, progress, guardian verification, approval queues, and CRM account management across two administrator tiers and four sales roles.
- Responsive two-month calendar with meeting, consultation, follow-up and deadline views; local appointment creation and reminder handling are available for interaction acceptance.
- Sales performance center with target/actual/forecast KPIs, team attainment, period comparison, conversion funnel and actionable analysis; target edits remain session-local until the data service is connected.
- Four progressive customer-relationship goals, a four-stage relationship playbook, and a four-stage ethical payment/closing playbook with four actions per stage.
- Contract lifecycle and renewal alerts, customizable sales products with five defaults (summer camp, admissions, competition programs, summer school, and foundation), plus monthly/quarterly/annual customer-consumption dashboards.
- Immutable user IDs, independent unique usernames, bilingual names, field-local username availability checks, and Supabase uniqueness enforcement.
- Contract-signing, contract-export, performance-summary, and performance-allocation approval models with audit actions and role-aware RLS.
- Manager performance allocation across sales specialists and the separate sales-support branch, including total-allocation enforcement and explicit non-duplication rules.

## Production gates that require external infrastructure

The original planning package describes a multi-quarter product, not a completed application. The current UI and staff authentication boundary are runnable, but business records are still fixture data and most mutations are interaction prototypes. Production completion requires application tables and workspace-aware RLS, server-side search/pagination, persisted settings, calendar synchronization and notification delivery, versioned/approved targets and playbooks, contract reminder workers, product price versions, consumption queries, object storage, real MFA/session management, AI provider configuration, legal review, recovery drills and UAT with anonymized business data.

## Local environment status

The CRM must use its own `lumina-crm` Supabase project and must never reuse another application's database. `npm run env:configure-local` reads keys only from the exact `supabase_studio_lumina-crm` container, configures official Cloudflare Turnstile testing keys, and disables demo authentication. `npm run auth:bootstrap-admin` creates or synchronizes `admin@lumina.local`, stores its initial credential in the Git-ignored `work/` directory, and removes `ADMIN_PASSWORD` from `.env.local` after success.

Do not enable `CRM_DEMO_MODE` in production. Run `npm run auth:bootstrap-admin` with one-shot secrets against the deployed Supabase project, confirm the Auth user exists, then remove `ADMIN_PASSWORD` from every environment.
