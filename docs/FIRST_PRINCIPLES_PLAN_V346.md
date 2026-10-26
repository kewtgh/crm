# Implementation plan for v3.46

Implements all P1-P6 findings and included features in [the audit](FIRST_PRINCIPLES_AUDIT_V346.md). Baseline v3.45.0 at `6708104`. V2 remains paused; V1 protocols, production infrastructure, existing data and unrelated untracked files are outside this change.

- [x] S1 — Add shared settings/read/outcome contracts; validate actual settings, device and MFA responses. Make security/privacy independent of preference reads in both the server layout and client workspace. Label unavailable formatting, block unconfirmed local-to-UTC conversion, restore preferences after a validated read, and make retry/cancellation explicit.
- [x] S2 — Extract the trusted-device workspace with current/empty/stale/failed states, serialized read/write ownership, accurate account-timezone dates, immediate action guards and accepted-write/display-refresh recovery.
- [x] S3 — Expose both existing session/device revocation outcomes without adding transactions, permissions or state stores. Preserve current-session/current-device exclusions and CSRF/authentication.
- [x] S4 — Implement custom/preset/off quiet hours with existing DateInput, compact HHmm support, paired/distinct validation and overnight/timezone guidance. Preserve security channels and reminder semantics.
- [x] S5 — Separate account preference acceptance, verification-mail delivery and local display updates. Freeze account/notification payloads during submission. Add live timezone/date-format previews. No automatic email retry or real delivery test.
- [x] S6 — Make MFA reads and recovery-count unavailability explicit, provide read retry and gate factor actions on confirmed data. Keep existing password, factor and administrator protocols.
- [x] S7 — Run targeted contract/API/component regressions, typecheck, changed-file lint, privacy and dependency checks. Build once and run the bounded affected Chromium phase in Chinese/English desktop/mobile with failure/retry/partial-outcome cases. Record actual evidence and NOT_RUN limits.
- [x] S8 — Update package/lockfile/runtime/README/status to v3.46.0, save release notes and verification, inspect the diff and commit locally. Do not push or deploy.

Checks run in visible bounded categories; optional commands stay within 55 seconds. The required build retains the existing repository timeout and is repeated only for subsequent build-affecting changes. No full Chromium matrix, historical regression campaign or database suite is needed for this scope. Public documentation contains reviewed conclusions only; raw operational evidence remains ignored.
