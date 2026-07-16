# Lumina Education CRM

Current baseline: **v0.4.1**

Lumina is an internationalized relationship CRM baseline for international education teams. Chinese and English UI copy use matched locale catalogs; personal names are the explicit exception and display Chinese and English together.

v0.4.1 keeps the v0.4 governance model and fixes the client/server authentication boundary, user-context ownership, pre-hydration form safety, production login affordances, localized metadata, and mobile allocation progress display found during Chromium 1228 regression testing.

The original product plan is preserved under `planning-source/education-intelligent-crm-planning-v1/`. It describes a multi-phase production program; this repository implements the runnable MVP vertical slice and the production authentication boundary.

## Local preview

Requirements: Node.js 22.13 or newer.

```bash
npm install
npm run dev
```

Start the repository's isolated `lumina-crm` Supabase project, then configure and initialize its Auth environment:

```bash
npx supabase start
npm run env:configure-local
npm run auth:bootstrap-admin
```

The local stack uses ports 56321–56324 and must not reuse another application's Supabase containers or database.

The generated administrator password is removed from `.env.local` after initialization and stored only in the Git-ignored `work/local-admin-credentials.txt` file. Change it after the first interactive sign-in.

Alternatively, copy `.env.example` to `.env.local` and set `CRM_DEMO_MODE=true` only for UI-only local acceptance. The demo account is:

- Email: `admin@lumina-edu.com`
- Password: `Demo123!`

Never enable demo mode or Cloudflare testing keys in a deployed environment.

## Supabase authentication

The deployed app expects one Supabase project and uses that project as the authentication source of truth. Environment variables are configuration only; they do not create an Auth user.

1. Set the Supabase URL, anon key and one-shot service role key.
2. Provide a temporary `ADMIN_EMAIL` and strong `ADMIN_PASSWORD`.
3. Run `npm run auth:bootstrap-admin` against the same Supabase project used by the deployment.
4. Confirm the user exists in Supabase Auth.
5. Remove `ADMIN_PASSWORD` from local files, CI variables and hosted secrets immediately.

Existing administrator passwords are not rotated unless `ADMIN_ROTATE_PASSWORD=true` is explicitly set.

## Quality checks

```bash
npx tsc --noEmit
npm run lint
npm test
```

See [`docs/ARCHITECTURE_UI_REVIEW.md`](docs/ARCHITECTURE_UI_REVIEW.md) for the latest architecture/UI review, [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) for the deployment runbook, and [`docs/IMPLEMENTATION_STATUS.md`](docs/IMPLEMENTATION_STATUS.md) for the implementation boundary.
