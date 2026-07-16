# Lumina Education CRM implementation status (v0.2.0)

This repository now contains a runnable modern CRM application baseline built from the supplied planning package.

## Implemented vertical slice

- Separate bilingual sign-in and guardian registration routes.
- Inline form errors and automatic Turnstile reset on verification failure.
- Supabase Auth REST integration boundary, refresh route and a one-shot administrator bootstrap script.
- Protected CRM route group, server-enforced administrator routes, responsive main menu and nested administration menu.
- Operations dashboard, schools, people, students, households, leads, opportunities, tasks, progression, imports, duplicate review, data quality, reports, AI review, products and message surfaces.
- Shared search, pagination, status, progress, searchable select, toast and inline-message components.
- User-settings interfaces for avatar, bilingual name, honorific, email, password, language, notifications, privacy, sessions and MFA. These controls remain prototype-only until the production profile/security services are connected.
- Administrator portal with reminders, security events, progress, guardian verification and registered mentor account management.

## Production gates that require external infrastructure

The original planning package describes a multi-quarter product, not a completed application. The current UI and staff authentication boundary are runnable, but business records are still fixture data and most mutations are interaction prototypes. Production completion requires a real Supabase project, application tables and workspace-aware RLS, server-side search/pagination, persisted settings, object storage, real MFA/session management, Temporal workers, AI provider configuration, legal review, recovery drills and UAT with anonymized business data.

## Local environment status

The CRM can reuse the running `little-spark` local Supabase stack. `npm run env:configure-local` extracts its local development keys without printing them, configures official Cloudflare Turnstile testing keys, and disables demo authentication. `npm run auth:bootstrap-admin` creates or synchronizes `admin@lumina.local`, stores its initial credential in the Git-ignored `work/` directory, and removes `ADMIN_PASSWORD` from `.env.local` after success.

Do not enable `CRM_DEMO_MODE` in production. Run `npm run auth:bootstrap-admin` with one-shot secrets against the deployed Supabase project, confirm the Auth user exists, then remove `ADMIN_PASSWORD` from every environment.
