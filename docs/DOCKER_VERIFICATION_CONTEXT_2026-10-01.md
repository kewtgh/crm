# v3.11.1 Docker verification context repair

## Root cause and minimal fix

The v3.11.0 release-metadata contract intentionally reads the real repository files, including
`docs/IMPLEMENTATION_STATUS.md`. Docker excluded that file via `docs/*`, causing
`ENOENT: /app/docs/IMPLEMENTATION_STATUS.md` during the verification stage.

Exact `.dockerignore` diff:

```diff
 docs/*
 !docs/DEPLOYMENT.md
+!docs/IMPLEMENTATION_STATUS.md
```

No release assertion was removed, no missing-file exception was swallowed, and no repository
document was replaced with a fixture. `tests/release-metadata.test.mjs`, the CI workflow,
Dockerfile, runtime copies and production deployment implementation are unchanged.

The existing deployment regression expected exactly one documentation exception. Its expectation
now requires exactly the two files above; the existing exact CI allowlist assertion is unchanged.
The application-runtime regression also rejects copying project documentation into the runtime.

Version metadata is synchronized to 3.11.1 in package.json, both package-lock root versions,
lib/version.ts, README.md and docs/IMPLEMENTATION_STATUS.md.

## Repository dependency comparison

Scope: the 29 test entrypoints selected by `test:contracts:raw` and `test:deploy:raw`, their
repository imports and filesystem reads. Source inspection covered readFile/readFileSync,
new URL, source/repositoryFile/repositoryPath helpers, dynamic component/migration iteration,
and repository-root path joins.

A diagnostic preload recorded resolved readFile and readdir paths during both suites without
changing read results or catching errors. A scratch COPY-only Docker probe exported the effective
context using the repository `.dockerignore`. All 388 existing repository file/directory
dependencies were present. No additional excluded test dependency was found.

The exported docs directory contains only DEPLOYMENT.md and IMPLEMENTATION_STATUS.md; unrelated
docs remain excluded. The exported .github directory contains only workflows/ci.yml. SHA-256
comparisons confirm the six release-contract files in the context are identical to the real
repository files: package.json, package-lock.json, lib/version.ts, README.md,
docs/IMPLEMENTATION_STATUS.md and .github/workflows/ci.yml.

Evidence is retained in the Git-ignored `work/docker-context-v3110/` directory (the directory name
identifies the original failing release): `context-comparison.json`, `repository-reads.jsonl`,
the effective context export, diagnostic scripts and `verification-build.log`.

## Verification on 2026-10-01

- Requested local commands passed: `npm run typecheck:raw`, `npm run lint:raw`,
  `npm run test:contracts:raw` (123 main + 8 CAPTCHA tests), and `npm run test:deploy:raw`
  (109 tests). The dependency recording reran both test suites after the 3.11.1 version update;
  `npm run release:check` also passed for 3.11.1.
- The unchanged production Dockerfile verification stage passed for 3.11.1. Its RUN executed
  `npm run typecheck:raw && npm run lint:raw && npm run test:contracts:raw && npm run test:deploy:raw`.
  Release-metadata and CI workflow contracts passed; all 240 tests passed, none failed/skipped.
- The application target built successfully, reusing the verified build-stage cache. Its runtime
  closure gate passed with 31 modules; dependency installation reported zero vulnerabilities.
- A one-shot container, with `--read-only --network none --cap-drop ALL --entrypoint node`,
  confirmed package version 3.11.1, UID 10001, and absence of both `/app/docs` and
  `/app/docs/IMPLEMENTATION_STATUS.md`.

Production build-stage commands (local builder substituted for the server's rootless builder):

```text
docker buildx build --builder desktop-linux --progress plain --file Dockerfile --build-arg LUMINA_VCS_REF=01c3c647021c6280b18fcb0ddfb594919642fa3a --provenance=true --target verification --output type=cacheonly .
docker buildx build --builder desktop-linux --progress plain --file Dockerfile --build-arg LUMINA_VCS_REF=01c3c647021c6280b18fcb0ddfb594919642fa3a --provenance=true --target application --tag lumina-crm:v3.11.1-context-qa --load .
```

The VCS argument is the pre-commit base of this local QA build, not a claim of a deployed release.
The first attempt stopped before source verification because the local watchdog stripped the
host proxy and Docker Hub token retrieval timed out. Restoring the existing credential-free host
proxy for the local Docker CLI resolved it; no repository network/deployment behavior changed.

Buildx verification reference: `y9q1hjtqp7938gj3l5doomwxv`.
Application reference: `o8uvpd7ariicx7vucl0n82e20`.
Local QA image ID: `sha256:109d8e962274a461acc914bf3b3df2ec671e60ad5e5f978242645654888caddb`.

No automatic deployment, push, database migration or remote GitHub Actions run was performed.
