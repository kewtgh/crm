# Implementation plan for v3.41

Source: [audit](FIRST_PRINCIPLES_AUDIT_V341.md). Implement T1–T4 and N1–N2 completely, then create
one local v3.41.0 release commit. Production deployment and publication are outside this task.

| Step | Deliverable and acceptance | Status |
| --- | --- | --- |
| 1 | Save the audit and this complete plan before implementation. | Complete |
| 2 | T1/T2: forward migration 138, shared validated completion contract, revision-bearing dashboard/queue and receipt-aware APIs. Stale/foreign/archived selections change nothing; exact retries return the accepted result without another audit. | Complete |
| 3 | T2/T3: reusable completion recovery for dashboard and queue, immediate duplicate protection, locked uncertain bulk draft, current-read action gating and accepted-write refresh-only recovery. | Complete |
| 4 | T4: validated URL queue search, priority and page, bilingual controls, browser history, out-of-range URL correction and directory-context preservation. | Complete |
| 5 | N1/N2: permission-aligned notification actions, cancellable reads, write/event serialization and honest refresh recovery in page/popover. | Complete |
| 6 | Bounded targeted behavioral tests, disposable PostgreSQL invariants, fresh typecheck and changed-file lint. Each optional command has at most a 55-second watchdog. | Complete |
| 7 | Update canonical version to 3.41.0; required production build; Chromium 1248 affected task/dashboard/notification fixtures in Chinese/English, desktop/mobile and narrow viewport. Inspect screenshots and retain exact runtime/build evidence. A second build followed the source correction for out-of-range page URLs. | Complete |
| 8 | Save release/verification records, run release/privacy checks, inspect staged content and whitespace, stop task-owned QA runtime and commit locally. | Complete in this release commit |

Database checks use a new loopback-only temporary PostgreSQL container, random credentials, an existing
installed supported image and `--pull=never`. They never read application database URLs or dotenv.
No full database suite, full browser matrix, dependency refresh or infrastructure change is planned.
Private logs, screenshots and reports stay in ignored `work/`. Use the repository QA server commands;
repeat a build only after source affecting the build changes. Preserve existing local services and data.

Completion evidence will be recorded in [verification](V341_VERIFICATION.md) and
[release notes](RELEASE_V3.41.0.md).
