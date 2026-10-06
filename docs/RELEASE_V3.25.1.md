# v3.25.1 — Runtime Packaging and CI Contract Repair

The production application image failure reported against v3.24.1 commit
`eee07f1866a314129f2ae1923ab45d87ac93ec6f` is repaired on main, based on v3.25.0
commit `6bb05cf410cbd130e431274ae08791f8e78f2c4d`. Final version metadata is 3.25.1.
The isolated v3.24.1 worktree is retained as reproduction evidence, not a separate published release.

## Application runtime packaging

`process-generated-jobs.mjs` imports nine privacy-export helpers that existed in source but
were absent from the application-stage explicit COPY allowlist. The gate first reported the
milestone helper; the complete pre-fix COPY fixture reported all nine.

The existing `COPY --chown=lumina:lumina` list now additionally contains:

```diff
+    scripts/lib/commission-privacy-export.mjs \
+    scripts/lib/student-success-privacy-export.mjs \
+    scripts/lib/lead-pool-privacy-export.mjs \
+    scripts/lib/contact-intelligence-privacy-export.mjs \
+    scripts/lib/contract-enrollment-privacy-export.mjs \
+    scripts/lib/enrollment-privacy-export.mjs \
+    scripts/lib/application-privacy-export.mjs \
+    scripts/lib/workflow-privacy-export.mjs \
+    scripts/lib/milestone-privacy-export.mjs \
```

No blanket library/source copy, privacy import removal or worker behavior change is introduced.
`RUN node scripts/verify-application-runtime-closure.mjs` remains mandatory after `USER 10001:10001`.
The recursive verifier now reports all missing local modules and checks ownership of every
reachable module, retaining the runtime-user and invitation-module checks. It follows static
relative imports/re-exports, literal dynamic imports and literal `.mjs` module URLs used by threads.

Regressions construct a root from the actual final-stage Docker COPY directives, then verify every
production runtime entrypoint. They derive the nine privacy dependencies from recursive import
edges, reject each individual omission and all nine together, and reject a missing extraction thread.
The v3.24.1 reproduction closure covers 20 entrypoints and 48 modules, with no additional missing
local modules after the allowlist repair. A fixture/source result is distinct from final image proof.

The operations image also exposed a separate native-runtime gap: copying `/usr/local` from Node into
the PostgreSQL base omitted `libatomic.so.1`, so Node failed before any JavaScript could run. It now
copies only the versioned `libatomic.so.1.*` library from the application image into `/usr/local/lib`,
runs `ldconfig` to register its SONAME link, and runs the same closure gate as uid/gid 10001.
The architecture wildcard selects the platform's Debian library directory, without copying all system
libraries or installing additional packages. A deployment regression requires the copy, registration,
owned `/app` inheritance and final non-root gate.

## Actions Build and test

[CI run 37474094303](https://github.com/kewtgh/crm/actions/runs/37474094303) failed its
Build and test step on the v3.25.0 commit: 291 tests passed and one source-contract test failed.
`tests/v383-behavior.test.mjs` expected legacy-only field selection, while the activated Imports
workspace correctly selects strict v2 headers or legacy fields according to template version.
The obsolete assertion now checks both branches. No import execution behavior or CI gate is removed.

The exact failure was reproduced locally before correction. The affected five-test suite passes.
Two older source-inspection fixtures now normalize CRLF to LF before finding source sections;
their business/deployment assertions are unchanged. Final main-branch local checks on
Node 26.10.0 / npm 12.2.0 are:

| Check | Result |
| --- | --- |
| `npm run typecheck:raw` | PASS |
| `npm run lint:raw` | PASS |
| `npm run test:contracts:raw` | PASS — 229 + 8 tests |
| `npm run test:deploy:raw` | PASS — 123 tests |
| Exact CI `npm test`, including 3.25.1 production build | PASS — 292 + 8 tests |
| Version metadata / lockfile root alignment | PASS — 3.25.1 |
| Migration verification | PASS — latest 112, no migration edits |
| Fresh remote CI run | NOT RUN — no push or workflow dispatch |
| Browser/database mutation checks | NOT RUN — no UI or domain mutation change |

## Local Docker operations boundary

The missing local `lumina-crm-buildkit` was registered with the repository's docker-container
driver, pinned `moby/buildkit:v0.33.1`, host networking and unchanged `deploy/buildkitd.toml`.
The credential-free local proxy was supplied through the existing canonical four proxy build arguments
and builder environment options. No BuildKit repository configuration or Docker daemon settings changed.
Initial image transport and a cold-build timeout were diagnosed before resuming from verified cached
layers; successful final target results are recorded separately from these failed attempts.

| Image/check | Result |
| --- | --- |
| Exact production Dockerfile `application` target, dedicated builder/config | PASS |
| Exact production Dockerfile `operations` target, PostgreSQL 18.6-trixie base | PASS |
| Mandatory final-stage closure gates | PASS — `APPLICATION_RUNTIME_CLOSURE_OK modules=48 ownedModules=48` |
| Isolated final application image audit, no checkout mount | PASS — 20 entrypoints, 48 modules |
| Isolated final operations image audit, no checkout mount | PASS — 20 entrypoints, 48 modules |
| Each image's `/app` file and symlink ownership | PASS — 32,566 files, uid/gid 10001:10001 |
| Reachable module SHA256 comparison with candidate source | PASS — all 48 in each image |
| Bare production-package import resolution in both images | PASS — all eight imported package paths |
| Dedicated builder driver/image/network/config contract | PASS |
| Production switch / database mutation / worker queue execution | NOT RUN |

The audited package paths are `@aws-sdk/client-s3`, `@pdf-lib/fontkit`, `argon2`, `pdf-lib`,
`pdfjs-dist/legacy/build/pdf.mjs`, `pg`, `vinext/server/prod-server` and `write-excel-file/node`.
These tests run in the final loaded images as their default non-root user with networking disabled.
No required local module is supplied by a build/verification-stage mount. Runtime module fingerprints
match the candidate checkout, and `/app` identity is shared by both images.
Local candidate tags are `lumina-crm:v3.25.1-runtime-closure-application-local` and
`lumina-crm:v3.25.1-runtime-closure-operations-local`. Their revision label records the starting
commit `6bb05cf410cbd130e431274ae08791f8e78f2c4d`; these are verification images, not deployed release
artifacts. A later production build must label its immutable images with the final repair commit.

This machine uses Docker Desktop. Local image verification does not certify the production
Ubuntu rootless daemon, server-local builder ownership marker, secret paths or runtime switching.
No production daemon, secret, migration/database state, Compose runtime or worker queue was accessed.

User-authorized CRM-only cleanup removed the ownership-verified unreferenced
`lumina-crm:v3.11.1-context-qa` image and orphan
`buildx_buildkit_lumina-crm-test-build-a7f31d2c0_state` cache volume. Database/storage volumes,
database containers, other projects and shared/default builder caches are preserved. No global prune.

Evidence remains under Git-ignored `work/v3241-runtime-closure/`. Unrelated Revenue decision
documents/spec tests remain outside this patch. Push and deployment are not performed.
