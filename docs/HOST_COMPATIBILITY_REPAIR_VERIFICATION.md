# Host compatibility repair verification

Date: 2026-10-24. Application remains 3.40.0. Node 24.22.1 LTS / npm 12.2.1 are unchanged.
Host contract revision: host-2026-10-24.2; current handoff protocol: 2.

## Root causes and repaired boundaries

1. Recommended Docker tool versions became required floors without feature evidence, excluding
   the operator-reported successful Ubuntu baseline. Strict semver also rejected Ubuntu package
   suffixes. Explicit audited ranges now require actual read-only option/security-model probes.
2. Installed maintenance and systemd content were coupled to the latest application source.
   Known, immutable legacy source hashes and fully verified old bundles/units now remain supported.
   Unknown imports/code, modified hashes, unreviewed drop-ins and incomplete installation fail closed.
   The installed maintenance implementation must support the actual Builder image.
3. The old Bootstrap fast-forwarded to an entry that unconditionally required newly introduced
   fields. The identity exception occurred before runtime preflight and business logging, leaving
   controllerStarted=true without a rejection receipt. Pinned-source protocol-0 admission now checks
   process/systemd/lock/source/reflog/request/persisted-intent evidence; modern protocols retain
   attempt/nonce checks. Any request carrying a newer protocol field cannot downgrade to legacy.
4. Ordinary receipt-bound archival correctly rejected that old ambiguous state. A separate
   operator-approved transition-failure CLI now cross-checks root-attested invocation/exit records,
   static source order, original state/history, journal/log inventory and accepted runtime identity.
   It preserves originals and records every archive phase without inventing an entry receipt.
5. The broken old CLI could not install its own compatibility fix. A reviewed staging CLI provides
   separately approved, locked source-only fast-forward after static target preflight. It preserves
   acceptance/application state and has its own resumable operation journal.

## Change map

| Boundary | Files |
| --- | --- |
| Runtime/tool/image/protocol profiles | `deploy/libexec/host-runtime-contract.json`, `deploy/libexec/host-compatibility-catalog.json`, `deploy/libexec/lumina-host-contract.mjs` |
| Read-only feature, rootless and trust validation | `scripts/lib/host-capabilities.mjs`, `scripts/lib/host-trust.mjs`, `scripts/lib/host-preflight.mjs` |
| Bootstrap/Controller authentication | `scripts/deploy-production-bootstrap.mjs`, `scripts/lib/controller-entry.mjs`, `scripts/lib/legacy-handoff.mjs` |
| Independent recovery and source adoption | `scripts/deploy-legacy-transition.mjs`, `scripts/lib/legacy-transition-archive.mjs`, `scripts/lib/legacy-transition-host.mjs`, `scripts/deploy-production.mjs` |
| Existing Builder preservation | `scripts/lib/docker-build-proxy.mjs`, `deploy/libexec/lumina-crm-storage-maintenance.mjs` |
| Approved root-owned installation receipt | `scripts/install-host-maintenance.mjs` |
| Tests and CI | `tests/host-control-plane.test.mjs`, `tests/host-compatibility-regression.test.mjs`, `tests/host-cross-commit.test.mjs`, `scripts/test-deploy.mjs`, `.github/workflows/ci.yml`, `package.json` |
| Runtime data closure and operating instructions | `Dockerfile`, `docs/DEPLOYMENT.md`, `docs/LUMINA_PRODUCTION_DEPLOYMENT_RUNBOOK.md` |

## Required features and source audit

Docker rootless inspection must prove CRM-owned socket/config/data root, systemd cgroup v2 and
rootless security mode. No shared rootful daemon is contacted. Compose must retain project/env/file/
profile selection, isolated up/run and wait/config options. Its parsed model must preserve UID,
init, read-only rootfs, dropped capabilities, no-new-privileges, resource limits, protected tmpfs,
internal network and loopback port binding. Buildx needs named builder, targets, build arguments,
provenance, output/load/tag/file and bounded cache filters. Only help, inspection and local model
normalization execute during Preflight.

Primary source checks:

- [Compose 2.40.3 up command](https://github.com/docker/compose/blob/v2.40.3/cmd/compose/up.go)
  provides the required wait/isolation flags.
- [Buildx 0.30.1 build command](https://github.com/docker/buildx/blob/v0.30.1/commands/build.go)
  provides the required build options.
- [Buildx 0.30.1 prune command](https://github.com/docker/buildx/blob/v0.30.1/commands/prune.go)
  includes reserved/max/min space filters; their BuildKit capability floor is 0.17. Both explicitly
  audited Builder images 0.33.1 and 0.34.1 exceed that feature floor. Ownership, driver, network,
  endpoint, exact proxy options and configuration fingerprint are still independently required.
- [systemd journal fields](https://www.freedesktop.org/software/systemd/man/latest/systemd.journal-fields.html)
  distinguish trusted process fields, service invocation, manager invocation and inherited stdout
  credentials. Archive proof checks the manager's root/PID1 exit record as well as service output.

## Local results

| Check | Result |
| --- | --- |
| `npm run test:deploy` | 206 tests: 205 pass, 1 existing PostgreSQL integration skip, 0 fail |
| `npm run typecheck` | Pass |
| `npm run lint` | Pass, 0 errors, 0 warnings |
| `npm run test:public-privacy` | 14 pass, 0 fail |
| Release and host-contract alignment scripts | Pass: application 3.40.0 / host-2026-10-24.2 |
| Actual Node 24.22.0 diagnostic invocation | Structured JSON, expected exit 1, Docker DEPENDENCY_BLOCKED; no runtime-gate crash |

The cross-commit test extracts the immutable original 796cc43 Bootstrap and dependencies from Git,
checks their source hash, performs a real temporary Git fast-forward, and lets that old Bootstrap
spawn a real child containing the current entry implementation, with no new handoff fields. Target
SHA, actual PID/PPID, argv, environment, bootstrap files and entry receipt are exercised. Linux
systemd/proc ownership facts use an explicit platform adapter on Windows; business operations are
stubbed. Additional negative tests reject source/PID/lock/unit/invocation/intent/protocol forgery.

The file-backed archive test injects completion-write failure after request rename, then resumes
using the same approval. Original request/latest bytes survive, the old result is unchanged, and
incomplete or corrupted archive proof blocks admission. Existing replacement approval, cache-loss,
operation locking, replacement-resume, migration, rollback, acceptance and logging tests remain.

`test:deploy:raw` is the source-only Docker verification suite. `test:deploy` additionally requires
Git and the immutable catalog revisions; CI fetches those exact objects before running it. This
keeps the build context free of `.git` while requiring the cross-commit test in host/CI verification.

## Limits and operator actions

The Ubuntu Engine 29.1.3 / Compose 2.40.3 / Buildx 0.30.1 successful production deployment is an
operator-reported baseline. Local tests validate its explicit profile and failure boundaries using
fixtures and audited sources; they do not constitute a new real Ubuntu Engine build. Downloading
official version-pinned CLI artifacts for supplementary execution failed due to network access.
No production access, engine build, database test, full application build or deployment occurred.

Follow the current runbooks for journal capture, explicit evidence-bound archive, source-only
adoption, host-check and fresh-ID deployment. Actual request archival is intentionally refused if
the original invocation records or accepted runtime proof are incomplete. Legacy failure profiles
are finite and pinned; unrelated old failures require independent operator review, not a broad
nonce bypass. A compatible installed maintenance/Builder pair needs no reinstall or replacement;
unknown code, incompatible pairs, missing locks or unreviewed units require targeted operator work.
There is no default Docker CE, containerd, runc, rootlesskit or shared-service upgrade requirement.

Private verification logs remain under ignored `work/`. Temporary test clones are removed by test
teardown. Final cleanup removes only this task's inspection/download scratch and regenerable
TypeScript build cache; the pinned Node runtime, dependencies, audit documents and evidence remain.

## CI shallow-checkout follow-up

The [CI run for 34e49bd](https://github.com/kewtgh/crm/actions/runs/39989894106/job/120538640660)
passed typecheck, lint, application build/tests and privacy checks, but failed the cross-commit
deployment test with `unable to read tree (796cc43...)`. Dependency audit was subsequently skipped.
The separate database job passed. This was a fixture transport failure, not a runtime-contract
or production handoff rejection.

CI uses a shallow checkout and fetches the pinned historical objects separately. Cloning that
checkout did not carry the unreferenced historical tree into the temporary target repository.
The fixture now initializes an isolated repository and explicitly fetches the exact legacy SHA
from the local source via file transport. No remote production access or history expansion is needed.

The original full-repository handoff case remains. A second case constructs the CI conditions:
depth-one current HEAD, separately fetched legacy commit, and no branch/remote ref containing that
legacy commit. Before the fix it reproduced the same read-tree error locally. After the fix both
cases execute the original Bootstrap, real Git fast-forward and current Controller child successfully.
All source-hash, PID, environment, request and receipt assertions remain intact.

Follow-up verification on Node 24.22.1 / npm 12.2.1: deployment suite 200 pass / 1 existing skip /
0 fail; all 3 cross-commit/trust tests pass; lint of the modified test file passes without warnings.
Full application build, database suite and dependency audit were not rerun for this test-only fix.
Private before/after/deployment/lint logs are retained under ignored `work/host-shallow-ci-*`.
Temporary repositories are removed by test teardown. Remote CI still requires the new commit to
be published and run; local verification is not a remote green result.

## Historical exit versus current systemd state

The transition assessment incorrectly required current Result=exit-code, ExecMainStatus=1 and
InvocationID to match the failed request's historical invocation. A later inactive/success state
or cleared ID therefore rejected valid historical proof. No live server changes were made.

The repaired profile v2 separates these authorities:

- Current observation must prove inactive/failed and serviceActive=false. Current result, exit
  status and invocation remain diagnostic data; another invocation's result cannot prove the old exit.
- The specified historical invocation needs exactly one manager exit candidate with trusted PID1,
  UID0, exact UNIT/INVOCATION_ID, exited/1, a nonempty unique cursor and valid microsecond timestamp.
  A conflicting exit status is not filtered away. Capture rejects absent or invalid exit proof.
- Attempt start, service source/version/PID/error output and the historical exit are checked using
  integer microseconds, retaining the existing one-second start tolerance. Post-exit service output,
  malformed times and incomplete journal records remain blocking.
- Approval plans expose the verified historicalExit and bind it through the full evidence hash.
  Request/source hashes, original state, deployment/log inventory, business-effect exclusions,
  accepted runtime image checks, locks and durable request archival are unchanged.

Regression tests first reproduced the old rejection, then covered inactive/success with both empty
and newer current invocation IDs; forged PID/UID/UNIT/ID/status, missing and contradictory exits,
ambiguous cursors, invalid or unbound times, and running/unknown current states. Missing historical
proof is tested to stop before any archive state write or rename. File-backed interrupted archival
now also runs with current inactive/success and preserves original request/latest bytes.

Verification on Node 24.22.1 / npm 12.2.1: 14 focused tests pass; deployment suite 205 pass / 1 existing
PostgreSQL skip / 0 fail; typecheck and lint pass, lint has no warnings. No application build,
production access, Docker mutation or database operation was performed. Temporary test repositories
are removed by teardown; private logs remain under ignored `work/legacy-historical-exit-*`.
Updated English and Chinese runbooks contain journal → archive → adopt commands and stop conditions.
Existing captures must retain their original bytes/tool identity; recapture using the reviewed new
tool after separately preserving the old file. Incomplete archival ledgers require independent audit.
