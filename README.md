# Lumina Education CRM

Current release: **v0.7.0**

Lumina is a bilingual relationship and sales CRM for an education-product operating company. Only company staff accounts can sign in: super administrator, administrator, sales director, sales manager, sales specialist, and sales support. Customers, contacts, parents, and students are business records—not CRM accounts.

The release includes administrator-created staff accounts, Turnstile-protected sign-in, generated temporary passwords with forced first-login replacement, mandatory TOTP/AAL2 for administrators, workspace RLS, real dashboards and notifications, searchable paginated CRM lists, duplicate checking, two-level administration, sales hierarchy and allocation, approval state machines, opportunities, four relationship targets, staged relationship/closing guidance, products and versioned prices, contracts and renewals, two-month calendar/reminders, consumption/performance analytics, complete personal settings, and approved private CSV delivery.

## Local development

Requirements: Node.js 22.13+ and Docker Desktop.

```bash
npm install
npx supabase start
npm run env:configure-local
npm run auth:bootstrap-admin
npm run dev
```

The CRM development server uses fixed port **3200** to avoid colliding with unrelated local projects; the isolated local Supabase project uses ports 56321–56324. Anonymous Auth signup is disabled; staff accounts are created only by an administrator, and administrator accounts only by a super administrator. Local configuration uses Cloudflare's official Turnstile test keys. The bootstrap command creates the actual Supabase Auth super administrator, marks the bootstrap password for first-login replacement, removes `ADMIN_PASSWORD` from `.env.local`, and writes the one-time local credential only to the Git-ignored `work/local-admin-credentials.txt`.

## Background workers

```bash
npm run reminders:process
npm run outbox:process
npm run exports:process
```

Schedule these commands in production. Approved exports are generated as CSV files in a private bucket and expire after 24 hours.

## Quality gates

```bash
npm run typecheck
npm run lint
npm test
npx supabase test db --local supabase/tests/authorization_structure.sql
```

See [deployment](docs/DEPLOYMENT.md), [implementation status](docs/IMPLEMENTATION_STATUS.md), [audit](docs/AUDIT_2026-07-17.md), and [remediation plan](docs/REMEDIATION_PLAN.md).
