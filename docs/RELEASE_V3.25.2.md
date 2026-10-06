# v3.25.2 — Email Worker Dependency Audit Repair

[CI run 37485127804](https://github.com/kewtgh/crm/actions/runs/37485127804) passed the
application audit, then failed the independent email-worker audit. Its locked dependency chain was
`wrangler@4.147.0 → miniflare@5.20261001.0-alpha → sharp@0.35.4`.
[GHSA-wq5f-xc86-pv6w](https://github.com/advisories/GHSA-wq5f-xc86-pv6w) identifies sharp versions
below 0.35.5 as affected by the librsvg vulnerability; 0.35.5 supplies librsvg 2.63.2.
The application's existing sharp override does not apply to the worker's independent package root.

The worker now pins `overrides.sharp` to `0.35.5`. Its regenerated lockfile updates only 27
`sharp/@img` package entries, including platform binaries and libvips. Wrangler and Miniflare remain
at their original versions. No `npm audit fix --force`, package downgrade, audit suppression,
threshold change or workflow removal is used. The planning project's manifest/lockfile is unchanged.

A regression verifies the worker's independent sharp pin, native dependency lock entries and both
prefixed CI audit commands. Root version metadata is aligned to **3.25.2** in package.json, both
lockfile root versions, APP_VERSION, README and implementation status. Historical releases remain intact.

Verification on Node 26.10.0 / npm 12.2.0:

| Check | Result |
| --- | --- |
| Original independent worker audit failure reproduced | PASS — three high dependency findings |
| `npm audit --audit-level=moderate` | PASS — zero vulnerabilities |
| `npm --prefix infrastructure/email-delivery-worker audit --audit-level=moderate` | PASS — zero vulnerabilities |
| `npm --prefix planning-source/education-intelligent-crm-planning-v1 audit --audit-level=moderate` | PASS — zero vulnerabilities |
| Fixed-npm lock generation and dependency change scope | PASS — sharp/@img only |
| Dependency security / release metadata regression | PASS — 10 tests |
| Email worker business regression | PASS — 102 tests |
| Actual Miniflare / patched sharp loading and SVG-to-PNG operation | PASS — sharp 0.35.5, librsvg 2.63.2 |
| Typecheck / changed-test scoped lint | PASS |
| Production build after 3.25.2 promotion | PASS |
| Version metadata / whitespace / unchanged CI gate | PASS |
| New remote Actions execution | NOT RUN — no push or dispatch |
| Full root test suite / Docker image rebuild / browser / database mutation | NOT RUN — outside this dependency-audit patch |

Additional local boundaries are recorded without weakening tests: a clean worker `npm ci` did not
complete within its 30/60-second bounds, while downloading/extracting the unchanged Windows workerd
package. Patched sharp, its native library and Miniflare were subsequently loaded successfully.
An optional worker controller suite also exposes a pre-existing fixture pinned to Wrangler 4.102.0
despite the manifest already pinning 4.147.0. A temporary diagnostic run using the manifest version
completed dry-run bundling but did not exit within 30 seconds on Windows. That fixture is unchanged
by this patch and is not invoked by the CI dependency audit. These checks are not represented as PASS.

Evidence is retained under Git-ignored `work/v3252-dependency-audit/`. The six unrelated Revenue
policy documents/spec tests are preserved outside the commit. No migration, database state,
production secret, worker behavior, push, deployment or Production access is introduced.
