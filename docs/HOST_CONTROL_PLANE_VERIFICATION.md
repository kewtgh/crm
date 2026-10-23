# Host control-plane verification

Date: 2026-10-23. Baseline: `796cc43e63784eb8891ca6420572cd563cb2ac80`.
Application metadata remains 3.40.0. The host contract is schema 1, revision `host-2026-10-23.1`.
All execution used the repository-pinned Node 24.22.1/npm 12.2.1 except the explicit old-Node
diagnostic check. Private command output remains under ignored `work/host-control-plane/`.

## Required checks

| Command | Result |
| --- | --- |
| `npm run test:deploy` | 189 tests: 188 passed, zero failed, one pre-existing opt-in database test skipped |
| `npm run typecheck` | Passed |
| `npm run lint` | Passed; final changed-file lint also passed after the final guard changes |
| `node scripts/check-host-runtime-contract.mjs` | Passed |
| `npm run release:check` | Passed, application remains 3.40.0 |

The skipped existing schema-evidence integration requires `DEPLOYMENT_TEST_DATABASE_URL` pointing
to a specifically named, empty disposable loopback database. None was supplied. The tests never
substitute `DATABASE_URL`, access production, or start a Docker database. No SQL/migration was changed.

The new deterministic tests cover runtime ranges and recommendations, builder image/network/
proxy/endpoint/owner/fingerprint boundaries, isolated Docker configuration, root-owned installed
maintenance bytes, loaded systemd units, kernel-lock ownership parsing, operator approval, concurrent
operations, replacement failure/resume without repeated removal, atomic maintenance activation
recovery, inherited Bootstrap executable, static Git reads before merge, pinned target continuity,
preflight failure without deployment-state writes, positive/negative entry receipts, controlled
archival, archive failure/resume and blocking fresh admission after incomplete archival.

All existing deployment/schema/rollback/public-acceptance/finalization tests are retained. Existing
Git fixtures now explicitly validate the target before merge; their previous behavioral assertions
remain. Application COPY closure tests now include the shared contract module and JSON data and
reject an image fixture missing the contract. No test is deleted and no forced-exit flag is used.

## Old runtime and side-effect boundaries

The diagnostic command was also executed with the existing local Node 24.22.0. It returned schema-1
structured diagnostics, reported the incompatible Node, and exited 1. It did not fail at module
loading or require the newer runtime to explain the incompatibility. This was a Windows local
diagnostic, not a production host acceptance result. Docker commands were not issued to any daemon.

Host discovery, Linux filesystem metadata, systemd responses, Docker inspection and kernel lock
evidence use deterministic adapters in tests. Installation/replacement failure tests use in-memory
state and temporary files. No installed root-owned helper, real systemd unit, host package, Docker
builder/image/container/volume, production request or application database was changed.

## Publication and limits

Public privacy/artifact checks: 14 passed, zero failures/skips. Whitespace/staged review is performed
before the local commit.
The repair is not a production deployment or authorization to push a branch. Host package installation
remains an explicitly approved operator procedure; there is no automatic system upgrade command.

Actual Linux systemd/flock behavior, package provisioning, rootless BuildKit replacement/bootstrap,
root-owned installation on the production filesystem and application image build are not live-tested
in this Windows workspace. COPY closure and process/phase boundaries are tested independently.
The operator must validate these on the approved host/change window before deploying.

Old controllers cannot retroactively produce trusted entry receipts. Legacy failed requests with
incomplete evidence remain blocked; this tool does not manufacture evidence, edit `latest.json`,
delete `request.json`, bypass locks or replay migration/switch work. A separate, operator-reviewed
control-plane adoption is needed before the older host can enforce the new protocol. Source without
a versioned static contract is rejected instead of executed to discover requirements.

Builder state is retained using the fixed builder's `rm --keep-state`, but reuse of its cache across
BuildKit versions is not guaranteed. Unexpected ownership/nonce/configuration and ambiguous removal
require investigation; safe automatic deletion/rollback of an unknown replacement is intentionally
unavailable. Normal schema/image rollback and finalization/reconcile protections remain authoritative.
