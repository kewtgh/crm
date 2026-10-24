# Implementation plan for v3.42

Implement all R1–R5 findings in the [audit](FIRST_PRINCIPLES_AUDIT_V342.md), update the local release
to v3.42.0 and commit. Publication, production writes and deployment are outside this task.

| Step | Deliverable and acceptance | Status |
| --- | --- | --- |
| 1 | Save the audit and complete implementation/verification plan before code changes. | Complete |
| 2 | R1/R3: forward migration 139 provides one authorized global recovery query, exact totals, stable ordering and consistent cleanup metadata across the complete catalog. Records beyond the old per-kind cap remain reachable. | Complete |
| 3 | R2: archive-token-bound restoration, atomic receipt/audit, current authorization on replay and legacy entrypoint revocation. Preserve existing domain restore behavior. | Complete |
| 4 | Shared strict read/write contracts and API adapters, GET recovery endpoint and initial-read failure recovery. | Complete |
| 5 | R4/R5: independent recovery workspace state, shareable filters/paging/history, stale-read gating, immediate duplicate guard, locked uncertain confirmation, exact retry and accepted-restore refresh-only recovery. Include bilingual responsive controls, compact mobile cards, cleared prior-operation feedback and known record-detail links. | Complete |
| 6 | Bounded behavior/adapter tests, disposable PostgreSQL lifecycle/concurrency/permission invariants, fresh nonincremental typecheck and changed-file lint. | Complete |
| 7 | Update canonical metadata, required production build and a targeted Chromium 1248 recovery phase at desktop/mobile/narrow widths in both languages. Inspect screenshots and retain exact build/runtime evidence. Builds were repeated after actual mobile layout/feedback corrections. | Complete |
| 8 | Save release/verification records, run privacy/release gates, review staged content, stop task-owned QA runtime and commit locally. | Complete in this release commit |

Each optional verification command is limited to 55 seconds. The required build keeps its normal
repository timeout and is repeated only following source changes. Database checks use a fresh,
temporary, loopback-only container and an installed PostgreSQL 18 image with `--pull=never`; they
never read application database URLs or dotenv. No full database suite or complete browser matrix.
Private evidence remains under ignored `work/`. Preserve existing services, volumes and records.

Final evidence: [verification](V342_VERIFICATION.md) and [release notes](RELEASE_V3.42.0.md).
