# First principles audit for v3.40

Date: 2026-10-23. Baseline: v3.39.0, `5156aeb`; clean worktree, pinned Node 24.22.0.

## Principles and review boundary

Data governance must distinguish actionable work from retained history, preserve the source record
as the authority for resolution, and report a mutation only when its outcome is known. A saved filter
must describe the rows shown. Reads that began before a write cannot restore obsolete state.
Cleanup must reclaim reproducible artifacts without erasing business data, evidence or rollback assets.

This round traced data-quality reads/commands, current rule scanning/resolution, directory navigation,
recycle restore boundaries, opportunity creation/stage contracts, deterministic automation and local
artifact ownership. The implemented scope is the evidence-backed quality governance closure below;
this is not certification of unrelated financial commands or production infrastructure.

## Findings

| ID | Priority | Evidence and practical impact | Implementation |
| --- | --- | --- | --- |
| Q1 | High | `listQualityIssues()` defaults to every status, while the page labels the total as open issues and renders assign/resolve/dismiss for closed rows. | Default to OPEN/ASSIGNED, expose retained history explicitly, show row status and allow actions only on active findings. Match summary labels to the applied filter. |
| Q2 | High | Search input resets the page without loading results; current query/page and visible rows can disagree. The page has no read/loading scope or out-of-range correction after resolving the last row. | Validated URL triage filters, cancellable reads, stale-result action gating, real page correction and explicit refresh/error/empty distinctions. |
| Q3 | High | Only React state guards writes; reads may race with mutation results. Success toasts are shown after a failed refresh. Lost responses permit a fresh mutation and make accepted resolutions look failed. | Immediate mutation lock, read invalidation, receipt-bound exact retries, separate accepted-save/refresh-failed recovery and locked uncertain inputs. |
| Q4 | High | Quality commands have no request receipts or optimistic version preconditions. Assignment changes `last_seen_at`, configuration changes `updated_at`, and repeat resolution is rejected after closure. A UI-only retry cannot establish one accepted result. | Forward migration for revisions and an atomic quality command wrapper using existing authorization, scan/resolve logic and receipt storage. Keep source verification mandatory; prevent legacy staff write bypass. |
| Q5 | Medium | Issue reads, trend and rule configuration share one `Promise.all`; an unavailable supplementary chart/configuration removes the issue queue. | Shared workspace loader with independent optional-source availability; keep confirmed issue results and clearly mark unavailable supplementary sections. |
| Q6 | Medium | There is no severity/owner triage despite existing backend fields. Task issues lead to an unfiltered task list; history has little review context. | Add shareable status/severity/assignment views, direct validated task links, last-seen/resolution context and bilingual responsive controls. |
| S1 | Medium | Repeated QA creates local bundles and generated build/cache artifacts. Deleting entire `work/` would also erase private reports and evidence. | Inventory sizes and ownership; remove only explicitly classified reproducible temporary artifacts and unused project build content, preserve reports/screenshots/source archives/data. Record reclaimed bytes and retained boundaries. |

## Architecture and business decisions

Keep deterministic source verification in `resolve_data_quality_issue` and existing role/RLS policy.
The new wrapper will own receipt identity, revision preconditions, authorization and atomic outcome;
it will delegate existing rule semantics. Scan results remain observations, not CRM source edits.
Revision changes must include scanner updates, so a stale finding cannot be silently resolved after
a newer observation. Optional chart/configuration failure is a read-availability concern, not zero work.

Recycle restoration and opportunity/automation workflows retain their current contracts in this release.
No evidence in this bounded review justifies automatic record repair, new financial posting, AI scoring
or customer outreach. Those require separately specified business policy rather than a generic audit.

## Selected features and cleanup limits

Implement all Q1–Q6 fixes, triage/history views, explicit read and mutation recovery, and S1 cleanup.
Do not delete business databases, Docker volumes, running services, protected evidence or rollback
images. Docker candidates require project ownership/mount classification and before/after inventory.
Host disk compaction or interruption of unrelated services is outside this cleanup.
