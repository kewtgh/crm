# v3.47.0 verification

Baseline: `93e217bb5f46ab87e073e7cbfe2f691c2e0af2a9`. Verification uses fictional data only.
Verification ran on the candidate worktree derived from that baseline before the local commit.
Raw local logs and screenshots stay in ignored `work/`; no historical release result is reused.

## Evidence

- Node 24.22.1 LTS; development builds/browser launcher use the pinned npm 12.2.1.
- Typecheck: PASS. Lint: PASS, zero errors/warnings.
- Targeted v347 contracts: 7 PASS; no skipped tests, included in both complete contract scripts.
- Complete `test:contracts:raw`: 414 + 8 CAPTCHA = **422 PASS**, zero failures/skips.
- `test:deploy:raw`: **218 PASS / 0 FAIL / 1 SKIP**. The conditional real deployment-database
  compatibility check lacks `DEPLOYMENT_TEST_DATABASE_URL`; it is not claimed as executed.
- Public repository privacy/artifact checks: **14 PASS**.
- Dependency audits: main application, existing delivery Worker and planning package each report
  **0 vulnerabilities**. Dependencies were not upgraded; paused V2 is outside this release.
- Production-mode development build: PASS after the final application changes.
- Chromium revision 1248, Headless Shell **156.0.8078.4**, localhost production build v3.47.0:
  privacy/calendar phase **10 PASS**; adjacent calendar/export phase **11 PASS**. Checks cover
  Chinese/English at 1440/375 px, overflow, original review evidence, filters, stale snapshot 409,
  exact-payload uncertain retry, accepted-write/read-failure separation, five completion periods,
  history paging, recipient read-only controls and USER relation creation. Existing receipt
  summaries and artifact expiry remain visible, with explicit fixture assertions. Existing date/time
  controls remain single pickers. These controlled API fixtures are UI evidence, not database or
  real outbound notification evidence. No QA authentication identities were created (0/0).
- Fresh PostgreSQL 18.4 Bookworm, disposable Docker tmpfs container: complete migration chain
  through 143, privacy command replay/CAS/concurrency/rollback/access/MFA/second-review checks,
  calendar invitation/reminder replay, recipient read-only RLS, foreign/inactive member denial and
  completed record retention PASS. Update/cancel each notify once and reschedule/cancel both
  recipients' reminders. Injected notification insertion failure rolls back the appointment.
  Legacy long correction fields remain readable while unknown fields are removed at the SQL
  projection. Both the actual read and receipt shapes pass the shared runtime contracts.
  Test setup failures (missing fictional profile, incorrect test
  RPC return shape, missing test role reset) were corrected without weakening application checks.
  No worker or external messaging ran; the test container was removed.
- Full contracts initially identified old relation-type and notification-link expectations;
  their assertions now reflect the new functionality and retain unrelated regression checks.
- The first UI run sampled the preceding page before its request finished; the harness now waits
  for the matching history response before checking pagination. No application guard was removed.
- Initial Lint's one Hook dependency warning was corrected before the final clean run.

## Docker verification

Final actual `docker build --progress=plain --target verification .`: **PASS**, exit 0.
Locked dependencies, the production build, typecheck, clean Lint, complete contracts (422 PASS)
and deployment tests (218 PASS / 1 conditional SKIP) executed in the Dockerfile's real order.
The verification instruction completed in 52.1 seconds; layer export/unpack in 8.9 seconds.

Verified Docker Desktop local image / manifest-list ID:
`sha256:6f5389f289d836580aaf5c4738729a86597a990e7dcffe7de3163f103fd0cacc`.
Linux manifest: `sha256:4466a44057f9b0b8c6dd43b1e3a01825247bff27a242f28e7adc4ede2d312d9e`.
A read-only, network-disabled, automatically removed container confirmed Linux amd64,
Debian GNU/Linux 13 Trixie, Node **24.22.1**, npm **12.2.1**. The config digest printed by
BuildKit was not a locally runnable image reference; the exported manifest-list ID was used.
Existing nonfatal dependency peer/deprecation and bundler static-analysis warnings remain visible;
no gate was removed or skipped to suppress them.

The final browser run records the repository QA resolver's source fingerprint
`f0a84607b90a553031c26d233bb60b0158dc327dace2a0d26548a696b927db41`, migration head
`202610260143_calendar_member_invitations` and production build hash
`46dbd2e80851921e86ae43b8aab07bb43c56b0f6f54fd2a539253945137030b0`.
The baseline SHA in that precommit report identifies its parent, not the eventual delivery commit.
Documentation-only completion of this report does not change the verified application image input.

## Limits

Local Docker/Chromium/Windows success does not certify Ubuntu production behavior or a live
release. No external CI execution, production connection, business database copy, real outbound
notification or archived deployment retry is part of this task. V2 remains paused.

The test image is PostgreSQL 18.4 Bookworm already present locally, not a claim that the configured
18.6 Trixie application image or production data was tested. Tests bootstrap a new loopback-only
tmpfs instance with generated credentials; never use dotenv connection strings or existing volumes.
Forward migrations 142/143 remain subject to the normal administrator-approved V1 release gates.
The controlled tests do not execute a real privacy export/deletion job, SMTP delivery or production
invitation; invitation/reminder records are verified transactionally in the disposable database.

No production connection or change was made. No V1/V2, HunterAI, Docker/systemd configuration,
business database or existing deployment state changed. QA server stopped and disposable database
removed. Push/deploy and reuse of any archived request are not authorized by this verification.

## Handoff

**GO for a new v3.47.0 release candidate from the resulting local commit**, subject to normal
remote CI and administrator-controlled V1 release gates. This is not production deployment
approval. Existing production compatibility, restore and migration checks remain authoritative;
do not replay any prior archived request. The two new forward migrations must accompany the
application candidate. No additional production service, database instance or process is required.
