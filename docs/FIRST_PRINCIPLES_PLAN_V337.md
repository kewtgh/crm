# Implementation plan — v3.37

Source: [audit and selected functions](FIRST_PRINCIPLES_AUDIT_V337.md). User authorizes implementation,
version update, commit and subsequent cleanup. No push or production deployment is requested.

| Step | Work and acceptance | Status |
| --- | --- | --- |
| 1 | Save opening findings and this plan before application edits. | Complete |
| 2 | A1: guarded returned-row completion; zero/malformed results fail safely; active transition and errors covered by executable adapter tests. | Complete |
| 3 | A2–A4: task filter helper, user reporting timezone matching the dashboard, deep links, bounded queue pagination/search, cancellable reads, synchronous mutation guard, refresh recovery, explicit snapshot scope, accessible controls. | Complete |
| 4 | A5: bounded v2 view config and resource-specific validation, local/server round-trip, full filter restoration; retain v1 semantics and ownership boundaries. | Complete |
| 5 | A6: correct Students route and Performance capability; test all roles against canonical navigation. | Complete |
| 6 | Targeted unit/API-adapter regressions, Node 24 LTS typecheck, changed-file lint, one production build, public browser phase and isolated component phase in Chromium 1248. Each optional check is bounded to 55 seconds or less. | Complete |
| 7 | Promote canonical version files to 3.37.0, record outcomes and limits, verify privacy/release metadata and diff, then commit reviewed files. | Complete in release commit |
| 8 | Stop task-owned services; inspect local disk/Docker inventory privately; remove only task-generated disposable files and confirmed unused project build content. Preserve volumes, running containers and rollback images. Record reclaimed space and any blocked cleanup. | Complete |

Final outcomes and scope limits are recorded in [verification](V337_VERIFICATION.md). Cleanup was
completed after acceptance and before the release commit, allowing its result to be included here.

## Verification and publication contract

Test actual data transformations, state transitions and browser interactions; avoid implementation-only
assertions as the sole evidence. Browser coverage includes Chinese/English, desktop/mobile, keyboard,
advanced-view save/restore, legacy views, task page boundaries, due-today timezone, failed refresh and
completion-versus-delayed-read behavior. A passing public phase does not substitute for component QA.
No database migration is planned; no full database suite or ten-phase browser matrix is required.
Historical release evidence is retained as historical. Final documentation must state skipped checks
and cannot claim a real-DB or production test that was not run.

Raw logs, screenshots, Docker inventory and temporary downloads remain ignored. Published documents
contain only minimized conclusions and repository-relative paths. Do not delete an arbitrary Docker
volume or use broad system prune. Any cleanup is confined to inspected unused cache/images and
verified paths inside the repository's ignored work directory.
