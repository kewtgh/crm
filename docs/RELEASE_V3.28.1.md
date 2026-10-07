# v3.28.1 — Shared-navigation CI contract correction

The CI Build and test step failed because an older workspace-settings test expected navigation
labels and permissions to be declared directly in AppShell. v3.28.0 moved those definitions into
the shared navigation contract, while retaining the workspace-settings destination and its gates.

The regression now checks the canonical destination's label, route, administration space,
admin.access capability and ADMIN/SUPER_ADMIN restriction. It checks visibility for all six staff
roles and retains the existing server-role, AAL2 and trusted-origin assertions.

Application behavior and authorization are unchanged. There is no dependency upgrade, database
migration or Revenue implementation. Latest migration remains 113. The six separate Revenue
specification candidates remain excluded from this patch.

## Verification

Using the declared Node 26.10.0 / npm 12.2.0 runtime, the local CI-equivalent `npm test` passes:
production build, 340 primary tests and eight CAPTCHA tests. The affected navigation/timezone
contracts pass 11 focused tests, the changed test passes lint, and all 13 public privacy tests pass.
Release metadata resolves to 3.28.1. The lockfile changes only its two root version fields;
dependency entries and all 118 migration SQL files remain unchanged. Raw CI and verification logs
remain ignored.

This records local verification. Remote Actions will need the patch pushed separately; no push,
deployment or Production access is part of this checkpoint.
