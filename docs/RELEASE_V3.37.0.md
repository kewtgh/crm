# v3.37.0 — Reliable task queues and complete saved views

Task completion now confirms that an active task was actually updated under the existing database
policies. Already completed, archived, missing or unavailable tasks produce a safe conflict instead
of a false success. A retry cannot overwrite the original completion timestamp.

The priority queue supports search, pagination and due-today filtering in the user's reporting
timezone. Action-center task signals open the matching personal queue. Queue changes preserve other
directory URL parameters. Cancelled stale reads cannot restore a completed task; failed refreshes
have an explicit retry action. Counts and filters are clearly limited to the existing 100-task
snapshot. Mobile summaries wrap, and selections are confined to the current page.

New personal and team saved views retain all supported directory filters. Version-1 views remain
compatible and clearly identified; their previous independent-filter behavior is preserved. The API
validates the version, bounded filter structure and resource-specific keys. Team views grant no new
record access. Students and Performance work launchers now match canonical routes and capabilities.

The Node 24 LTS / Chromium 1248 baseline remains pinned. No schema migration, financial posting rule,
consent rule or production deployment is included.

See [audit](FIRST_PRINCIPLES_AUDIT_V337.md), [implementation plan](FIRST_PRINCIPLES_PLAN_V337.md)
and [verification](V337_VERIFICATION.md) for evidence and limits.
