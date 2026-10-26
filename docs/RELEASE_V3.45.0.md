# v3.45.0 — Reliable discovery and compact scheduling input

## Global discovery

- Healthy record sources remain searchable when another type fails. Coverage feedback names the unavailable types without exposing backend errors.
- Fair suggestions retain later record types rather than allowing organization/contact rows to occupy the entire result set. Suggestions are bounded and do not claim full database totals.
- Search scope can focus one authorized record type or page shortcuts only. Retry is explicit; stale responses, IME Enter and locale display are handled independently.
- Contract refresh retains the requested UUID beyond the default page. Products open read-only details instead of an editor. Quote links load the requested authorized quote and scroll to its context. Missing/inaccessible records have an explicit return path.

## Schedule creation and controls

The existing RPC boundary now distinguishes JSON/JSONB array arguments from PostgreSQL arrays. This fixes appointment attendee serialization, including an empty attendee list, while preserving integer-array reminders, authorization, exact creation receipts and delivery consent rules. No historical migration or business database is modified by this code change.

All 63 shared input call sites across 35 components use one integrated field, with one native-picker button inside its border. Compact values normalize immediately:

- `2215` → `22:15`; `0803` → `08:03`.
- `1005` → October 5 of the current year in the account timezone (device year in standalone forms), independent of the currently viewed calendar month/year.
- Impossible dates/times, leap-day errors and native min/max/step violations remain invalid; values are never rolled into another day.

Ordinary ISO date/time entry and native selection remain supported. FormData contains one canonical value per named field. Form reset restores uncontrolled defaults and preserves parent-controlled state. Calendar validation, relation and attendee-consent failures have specific bilingual guidance. Uncertain requests continue to retain their original identity and are not retried automatically.

## Compatibility and operations

Node 24.22.1 LTS and current dependency pins remain unchanged. No database migration, persistent service, search index or infrastructure dependency is added. V2 remains paused and V1 deployment protocols remain unchanged. This release is committed locally; production installation and publication require their existing authorization.

See [audit](FIRST_PRINCIPLES_AUDIT_V345.md), [completed plan](FIRST_PRINCIPLES_PLAN_V345.md) and [verification](V345_VERIFICATION.md).
