# Host compatibility and transition repair

Baseline: c164ff1524192b7d699dae1962c02bf72566407b; accepted application baseline:
796cc43e63784eb8891ca6420572cd563cb2ac80, version 3.40.0. No production access or
Docker/package/service/data modification is authorized by this repository task.

Confirmed regressions:

- Docker/Compose/Buildx floors were taken from recommended packages, without required-feature
  evidence. Missing observations were called incompatible versions. Ubuntu package suffixes fail
  strict semver parsing. Exact recommended BuildKit tags unnecessarily require replacement.
- Maintenance and unit source equality couples host provisioning to every control-plane edit.
- The accepted old Bootstrap does not send the new nonce/attempt environment. The new entry fails
  before business operations, leaving an ambiguous started request without an entry receipt.
- The generic early archive correctly refuses missing receipts, but has no separately audited
  transition-failure recovery. Its refusal must remain for ordinary ambiguous deployments.

Adopted implementation:

1. Audit command features against tagged upstream sources; declare explicit Ubuntu 29.1.3 /
   Compose 2.40.3 / Buildx 0.30.1 compatibility lines plus required read-only functional probes.
   Keep Node/npm pins. Separate recommendation, observed capability, protocol and application.
2. Preserve rootless/socket/owner/config/network/proxy/build arguments. Allow only enumerated
   audited BuildKit images, matching metadata and actual daemon. Trust only content-reviewed
   legacy maintenance/unit revisions or a valid installed bundle, independently of target source.
3. Version handoff. For missing modern fields, authenticate only pinned old source code, exact
   arguments, actual parent process, execution lock, request and persisted handoff intent. Modern
   handoff remains nonce-bound. Run an immutable old Bootstrap from Git in a real child-process
   integration test against the new entry.
4. Add a separate transition-failure evidence collection/approval/archive CLI. Cross-check trusted
   old/new source order, complete systemd invocation logs and exit, bootstrap history, accepted
   release and current runtime identities. Missing journal is only one negative observation.
   Preserve original request/latest snapshots; do not synthesize an entry receipt or change results.
   Every destructive phase is intent-logged and safely resumable. No replay of the old request.
5. Provide an explicitly approved source-only adoption path from a separately trusted repair copy,
   so a broken old CLI does not need to upgrade Docker just to install its fix. Preflight static
   target data before fast-forward; refuse pending requests and preserve acceptance state.
6. Execute deploy tests, typecheck and lint; add real version-pinned CLI/config checks when locally
   feasible, accurately separate fixture/CLI/engine validation, and update both operator runbooks.

No Docker CE migration, package replacement, daemon restart, global prune, marker edit or data
volume action is introduced. Unknown legacy origins, incomplete evidence and real functional or
security failures remain blocking. Production evidence must stay out of public repository files.

Implementation and local verification are complete: see
[verification and limitations](HOST_COMPATIBILITY_REPAIR_VERIFICATION.md). Production acceptance
and archival of an actual request remain operator actions subject to real host evidence.
