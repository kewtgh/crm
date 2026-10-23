# Implementation plan for v3.40

Source: [audit](FIRST_PRINCIPLES_AUDIT_V340.md). All Q1–Q6 and S1 are included. Authorization covers
implementation, local release commit and safe project cleanup. No push or production deployment.

| Step | Acceptance | Status |
| --- | --- | --- |
| 1 | Save the audit and complete execution/cleanup plan before source changes. | Complete |
| 2 | Q4: forward migration adds finding/rule revisions and authorized receipt-bound commands. Replays, stale versions, source-not-fixed rejection and rollback are tested on disposable PostgreSQL. | Complete |
| 3 | Q1/Q5/Q6: validated triage query contract, active default/history, severity/assignment filters before paging, stable ordering, shared workspace loader and optional-source availability. | Complete |
| 4 | Q2/Q3/Q6: URL/history-consistent UI, visible loading/recovery, page correction, exact mutation retry and accepted-save refresh-only state; closed findings stay read-only. | Complete |
| 5 | Bounded behavioral/adapter tests, typecheck, changed-file lint and one required production build. | Complete |
| 6 | Chromium 1248 affected component fixtures in Chinese/English at desktop/mobile; inspect screenshots and run the public phase. | Complete |
| 6a | User supplement: before cleanup, verify current stable/LTS upstream versions, upgrade all three dependency manifests/lockfiles and aligned runtime/CI/Docker pins; resolve compatibility and verify the upgraded application. Exclude prereleases and retain Chromium revision 1248. | Complete |
| 7 | Inventory local/Docker storage privately, classify exact removal candidates and preserve evidence/data. After QA, stop owned services and remove approved-by-scope disposable artifacts; verify bytes and protected inventories. | Complete |
| 8 | Update canonical version to 3.40.0, save release/verification/cleanup results, run privacy/release checks, inspect staged diff and commit. | Complete |

Each optional QA command is limited to 55 seconds or less; the normal production build uses its
existing timeout. Fresh migration-chain setup is allowed only on a disposable loopback PostgreSQL
container using an installed image with `--pull=never`. No full database suite or browser matrix.
The application database is never a substitute. Any build repeated after browser QA requires an
actual source correction. Private evidence remains under ignored `work/`.

Cleanup may remove final local build output after acceptance, development caches and compiled QA
harness files that are reproducible from tracked sources. Preserve raw source documents, backups,
SQL dumps, reports, screenshots, recorded fixtures and historical evidence. Docker volumes and
unrelated project resources are excluded. Record exact deletion targets before removal; reject
paths outside the repository or with reparse points. Do not promise VHDX host-space reclamation
from logical Docker pruning alone. Final report must distinguish measured local bytes from any
Docker logical reclamation.

Execution evidence: [release notes](RELEASE_V3.40.0.md), [dependency refresh](DEPENDENCY_REFRESH_V340.md) and [verification including measured cleanup](V340_VERIFICATION.md). All adopted findings Q1–Q6 and S1 are implemented.
