# v3.37.5 — Toolchain security and CI dependency audit

The root project's `npm audit --audit-level=moderate` failed for Vite 8.3.2.
Its bundled launch-editor code was covered by three advisories:

- [GHSA-587h-7wmj-h5pm](https://github.com/advisories/GHSA-587h-7wmj-h5pm): Windows path validation bypass, high severity.
- [GHSA-698v-4r3x-3vcv](https://github.com/advisories/GHSA-698v-4r3x-3vcv): Windows command argument escaping, moderate severity.
- [GHSA-r825-w8mm-5pxw](https://github.com/advisories/GHSA-r825-w8mm-5pxw): editor CLI argument interpretation, moderate severity.

Vite is now pinned to 8.3.5, within the patched range. Its Rolldown dependencies
are refreshed by npm, and the PostCSS override advances to 8.5.30 to meet Vite's
declared minimum. Node 24 LTS and npm 12 remain pinned. Dependency policy tests
verify the direct Vite version and all corresponding Vite/PostCSS lock entries.

The email Worker and planning subproject initially audited clean. Their manifests
and lockfiles are unchanged. The CI audit threshold and all three audit commands
remain enforced. Raw local audit reports stay under Git-ignored `work/ci-audit/`.

Verification under Node 24.22.0 and npm 12.2.0 passed: all three audits report
zero vulnerabilities; 10 dependency-security/release tests; typecheck;
zero-warning changed-file lint; one production build; two production startup/
redirect tests; and 14 public repository privacy/artifact checks. The startup
test cleans up its temporary server. No database migration is added.
