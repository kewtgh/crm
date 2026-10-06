# v3.27.0 — Daily workflow and interaction reliability

Staff can start from a business task on the dashboard and add participation directly from a student
or cohort, with the existing canonical enrollment form and lifecycle validation. Identity context
is preselected; access and business validation still belong to the API/database.

Shared drawers now isolate nested dialogs, restore focus and retain scroll locks until all dialogs
close. Contact, contract and enrollment editors warn before discarding unsaved input through the
close controls or Escape. The guard also covers full-page unload; it is not an offline draft store
or a universal router blocker. No personal form content is persisted in browser storage.

Filters expose a reset action with an active-filter count. Student searches suppress stale results;
cohort pagination shows a loading state instead of old rows. Related selectors avoid raw UUID
fallback labels. Student support routes retain the correct family navigation context.

The action center shows its update time and can refresh in place. Its overlapping category counts
are explicitly described as signals, not distinct task totals. Failure of optional growth summaries
no longer hides the entire dashboard; unavailable figures are omitted with a warning. Core read
failures still fail visibly. After enrollment saves, refresh failures cannot trigger a second write.

The campaign screen no longer presents won opportunity value minus planned budget as ROI. It shows
won opportunity value and explains that this does not establish cash, Revenue or investment return.
No financial policy, Revenue recognition, cost accounting or attribution is introduced.

No migration or external service is needed. Historical migrations remain unchanged, latest 113.
No Production access, deployment or push is included. Revenue candidate documents remain uncommitted.

Audit scope, implementation decisions, verification boundaries and deferred policy-dependent
features are recorded in PRODUCT_WORKFLOW_AUDIT_V327.md and PRODUCT_WORKFLOW_PLAN_V327.md.

Frontline and management workflows have equal priority. The dashboard presents equally prominent
Daily operations and Management & improvement switches. Management links reuse the formal
executive overview, channel reporting and team performance views, with import/data-quality tools.
These links do not grant permissions, create Revenue metrics or infer employee compensation.
