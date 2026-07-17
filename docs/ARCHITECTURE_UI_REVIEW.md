# Architecture and UI/UX review — v0.7.0

The final architecture remains a focused Vinext/Next application with Supabase Auth, Postgres/RLS, Storage, RPC state transitions, and small background workers. A microservice rewrite is neither required nor justified.

## Architecture decisions

- Authentication source of truth: Supabase Auth; application metadata is validated against active workspace membership. There is no self-registration surface.
- Account lifecycle: administrator-created random temporary password, synchronous delivery confirmation, forced first-login replacement, then role-based MFA onboarding.
- Login protection: Turnstile is verified server-side before the password exchange; tokens are not trusted or reused by the application.
- Privileged sessions: super administrators and administrators require TOTP/AAL2. Page routing, administrator APIs and database role helpers independently reject AAL1 access.
- Authorization source of truth: database RLS and controlled RPCs, not hidden buttons.
- Identity: immutable UUID, distinct username, and bilingual person names.
- Workflow: approval rows bind to workspace/object/version and execute idempotent business transitions.
- Reporting: database aggregation; currencies remain separate unless a sourced FX model is introduced.
- Delivery: reminders, email, and exports use claimable background queues; approved files stay private and expire.
- Failure policy: no silent fixture fallback and no fake success.

## UI/UX decisions

- One navigation/design system for search, pagination, selects, forms, feedback, color, icons, cards, and responsive layout.
- Current locale controls all UI/business labels. Human names are the single bilingual-display exception.
- Errors remain inside the affected form or list surface.
- Turnstile, first-password and MFA errors remain adjacent to their own controls; failed Turnstile verification refreshes the widget.
- Long tables use server pagination; long selectors use search; mobile layouts become cards rather than oversized desktop tables.
- Account settings cover profile, identity, language/timezone, notifications, password, MFA, privacy, and session revocation.

## Remaining release check

The source, database, build, and authenticated HTTP checks pass. Visual and interaction acceptance still requires an environment that exposes `ms-playwright/chromium-1228`; verify 1440px, 1024px, and 375px widths, keyboard focus order, Escape/focus restoration, and absence of document-level horizontal overflow.
