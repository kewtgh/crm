# v3.46.0 production-build contract correction

Baseline: `dcf2ec6db8ac0f1585429d8df8fd6ef1bd147e36`. This repairs an unreleased 3.46.0 candidate;
the application version and runtime behavior are unchanged. Production is not accessed, and the
archived failed deployment request is not replayed.

## Cause and minimal change

The old v3.8 contract expected AppShell.changeSearch to call two component-local setters. Since
v3.45, useGlobalSearch owns the outcome, cancellation and response context. The original command
reproduced ERR_ASSERTION solely on that obsolete source expression. The UI finite-progress and
rendered-label assertions are retained unchanged.

The replacement executes the actual hook with controlled hook cells, a virtual debounce clock and
deferred request outcomes. It checks immediate clearing/cancellation, delayed success and failure,
scope-specific response ownership, page-only scope, query clearing and equivalent whitespace.
This unit scheduling adapter is explicitly not a React renderer; the existing Chromium discovery
phase supplies separate real React/browser evidence. No application hook or search protocol is
changed to satisfy the test.

The first complete contract run then exposed a second obsolete assertion in
customer-operations.test.mjs: it required the removed custom date panel's internal setView call.
That test now renders the actual shared DateInput and checks controlled values, one submitted field,
one native picker and one visible trigger. Its customer-search/alias/short-query assertions remain.
The existing browser phase separately verifies controlled native-picker updates and FormData.

## Candidate process correction

The original v3.46 report recorded scoped feature QA, not the complete historical suite. It cannot
serve as production-candidate acceptance. Existing Docker gates were present and correctly rejected
the obsolete assertion. A mandatory candidate checklist and AGENTS rule now require complete
contracts plus the actual Docker verification sequence before handoff. npm run release:verify uses
that existing target, and regular CI adds a separate hosted Docker verification job without removing
any existing job or guard. A small regression checks this wiring. Automatic documentation-path
exclusions and separately administered remote branch-protection settings are documented explicitly.

## Verification evidence

| Gate | Actual result |
| --- | --- |
| Original v380 reproduction | FAIL: obsolete AppShell setter expression; no application change required. |
| Corrected v380 command | PASS: 7 tests, 0 failed, 0 skipped. The original progress assertions remain unchanged. |
| Related v380/customer operations tests | PASS: 36 tests, 0 failed, 0 skipped. |
| npm run typecheck:raw | PASS, full raw command. |
| npm run lint:raw | PASS, full repository; 0 errors/warnings. |
| npm run test:contracts:raw | PASS: 407 historical contracts plus 8 CAPTCHA tests; 415 passed, 0 failed, 0 skipped; 8.22 seconds including launcher. |
| npm run test:deploy:raw | PASS: 218 passed, 0 failed, 1 existing conditional database skip; 4.41 seconds including launcher. |
| Chromium 1248 global-discovery | PASS: 9 page/viewports, 0 errors; real React components with fictional intercepted APIs, version 156.0.8078.4. |
| docker build --progress=plain --target verification . | PASS, exit 0, 277.93 seconds. Actual locked install and production build followed by all four raw verification commands in order. Inside-image contracts: 407 + 8 passed, no skips. Deployment contracts: 218 passed, same 1 conditional skip. |

Local raw commands use pinned Node 24.22.1 and a temporary npm 12.2.1 cache, without changing the
machine's npm installation. The real development daemon is Docker Desktop's local Linux engine
29.9.2. The verification image is linux/amd64, Debian GNU/Linux 13 (trixie), Node 24.22.1 and
npm 12.2.1. Its versions were confirmed in a disposable, disconnected, read-only metadata container.
This is production-Dockerfile validation, not certification of the Ubuntu/Rootless production host.

Image digest:

```text
sha256:ef42c3b2b231d1c69eccb01f7f9d32df2b24cd5bc9136f8e299fe6c3703dd1be
```

Pinned Node base resolved to:

```text
node:24.22.1-trixie-slim@sha256:43b9ba1142b8dcf33fa8f922ca1be85714adc444e0586c7cf7726daaeabc1bea
```

Tests ran against the baseline SHA above plus this commit's worktree changes. The seven changed
image inputs are AGENTS.md, .github/workflows/ci.yml, package.json, the three changed test files and
the hook test helper. Their sorted Git-normalized blob manifest has SHA-256:

```text
7b20c693f8dfd5d586354d35af5b5a15a2803534e8b55e49cc7ce76c8b730ded
```

The manifest, exact logs, timings, browser evidence and initial failure remain under ignored
work/v346-release-fix/ and work/browser-qa-chromium-1248/v346-release-fix/. Subsequent documentation
updates are excluded from the Docker context and do not change these tested image inputs.

## Failures investigated and limits

- First full contracts: 406 passed, 1 failed on the obsolete date-panel assertion. Corrected the
  assertion's observable contract; reran the complete suite including CAPTCHA successfully.
- Initial lint of the new unit adapter rejected a non-Hook function name around a Hook invocation.
  Corrected the naming and reran full lint; no rule was disabled.
- First Docker attempt used the application's watchdog, whose intentional proxy filtering prevented
  public registry authentication before any source build. The same Docker command was rerun with
  the existing operator network environment and a 20-minute timeout. No Dockerfile, daemon, network
  configuration, runtime proxy policy or verification gate was changed to address it.
- The existing optional PostgreSQL schema-evidence test requires DEPLOYMENT_TEST_DATABASE_URL for
  an empty disposable database. It is not configured in either the host or normal verification
  image. This pre-existing skip is reported explicitly; no skip flag or test exclusion was added.
- Remote GitHub Actions is NOT_RUN: this fix has not been pushed. The new CI job's wiring is covered
  locally, and the real Docker command it invokes passed. No remote run is claimed.

## Decision

GO to submit a new 3.46.0 release candidate from the repaired commit: all requested local full gates
and the actual Docker verification target pass. No real search regression was found in the controlled
Hook tests or real browser phase. The two failures were obsolete implementation-specific contracts.

This is not permission to deploy or replay an archived request. Push requires its existing
authorization; remote required-check policy still applies. An administrator must create a new
deployment request for the new SHA through the existing V1 entrypoint. V1/V2 code, production Docker,
systemd and business databases are untouched. No real deployment is run and no production data is
accessed. The local QA server and metadata container are stopped/removed; no persistent service is
added. The application remains version 3.46.0 because the correction changes tests, CI and process
documentation only.
