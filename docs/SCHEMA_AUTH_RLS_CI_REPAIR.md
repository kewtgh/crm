# Schema/auth CI repair — v3.36.0

Baseline: `a0955109dccc456097393423fc6d8f20ca6da88b`, clean main, migration 130 /
135 SQL. The GitHub Actions database job failed in “Validate schema and auth/RLS behavior”
with `UNVALIDATED_CONSTRAINTS:public.uploaded_contract_receipts.uploaded_receipt_actor_account_fk`.
The failure was confirmed from the supplied job log, retained only under ignored work/.

Migration 128 deliberately introduced the actor FK as NOT VALID to enforce new writes
without guessing historical actors. Its validation was not completed. The existing
db:validate gate correctly rejects unvalidated constraints, so db:smoke never started.
The earlier module suites had not exercised this exact combined CI entry point.

Forward migration `202610080131_validate_uploaded_receipt_actor.sql` checks for legacy
orphans, then validates the existing constraint. An orphan yields only the stable code
`UPLOADED_RECEIPT_ACTOR_ORPHANS_REQUIRE_REVIEW`. No actor is guessed, no receipt is deleted
or updated, and historical migrations are untouched. Existing problematic data requires
controlled operator review; no production data was inspected or repaired here.

`npm run test:schema:auth:postgres` provisions a random disposable PostgreSQL instance,
applies the complete migration chain and executes the same db-validate and auth/RLS smoke
scripts used by CI. It also proves that the staged-FK upgrade preserves valid receipts,
is repeatable, rejects new invalid actors and blocks legacy orphaned receipts without
backfill/deletion. Actual Contract/document lineage is used in the fictional fixture.

Verification:

- Fresh full-chain db:validate: PASS, all constraints/indexes valid; roles retain least privilege.
- Exact db:smoke: PASS, Argon2id, sessions, TOTP/replay, RLS, atomic profile changes,
  appointment and communication idempotency/pagination.
- Forward-upgrade and legacy-orphan fixtures: PASS.
- Targeted migration/auth/release contracts, typecheck, changed-script lint, privacy,
  release metadata, migration verification and diff whitespace: PASS.

Tests used `postgres:18.4-bookworm`, random database/passwords, tmpfs, a loopback random
port and finally cleanup. No application environment, provider delivery or Production
was used. No UI/application change requires another browser run or build.

Version remains 3.36.0. Current migration head is 131 / 136 SQL. The previous V336 report
retains its original checkpoint results; this report records the subsequent CI correction.
The 135 previously committed SQL files are unchanged. Rollout requires the new migration;
no secret change is required. The user authorized a local repair commit. Push: NOT RUN.
Deploy: NOT RUN. Production: NONE. Remote Actions rerun is separate from this local proof.
