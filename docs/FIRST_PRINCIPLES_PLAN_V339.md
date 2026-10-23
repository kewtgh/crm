# Implementation plan for v3.39

Source: [audit](FIRST_PRINCIPLES_AUDIT_V339.md). Scope includes all C1–C5 and E1–E2 findings and selected
features. The user authorizes implementation, version update and local commit, without deployment.

| Step | Acceptance | Status |
| --- | --- | --- |
| 1 | Save evidence-based audit and execution plan before application changes. | Complete |
| 2 | C1: forward-only migration for authorized, receipt-bound, version-checked appointment actions. Preserve terminal states, audit and invitation atomicity; block legacy command bypass. | Complete |
| 3 | C2/C5: shared create/action contracts, stable reminders, supported relations and exact payload retry. No editable/closable uncertain request. | Complete |
| 4 | C3/C4: cancel and invalidate reads around writes; visible failed/refreshing states; consistent event removal; selected-day agenda and explicit two-month scope. | Complete |
| 5 | E1/E2: export refresh, page correction, loading/error/empty distinction, expiry eligibility, status validation and correct API validation errors. | Complete |
| 6 | Bounded unit/adapter regressions, disposable PostgreSQL appointment tests, typecheck, changed-file lint and required production build. A later mobile layout correction required rebuilding. | Complete |
| 7 | Chromium 1248 targeted calendar/export fixtures in Chinese/English at desktop/mobile; inspect screenshots and the affected public phase. No operational database writes. | Complete |
| 8 | Update version 3.39.0 metadata and release/verification docs, run privacy/release checks, stop task-owned services, review and commit. | Complete in release commit |

Each optional QA command has a 55-second hard limit or less. A full migration chain may be used only
to prepare a fresh disposable test database; no complete database regression suite or ten-phase browser
matrix is planned. The test container must use an existing local PostgreSQL image with `--pull=never`,
loopback-only port binding and temporary storage. Do not read application database credentials or touch
unrelated containers. Private logs/screenshots remain under ignored `work/`; document only minimized
results. Passing component fixtures does not prove production delivery or provider integration.
