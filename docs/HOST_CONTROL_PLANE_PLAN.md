# Host control plane implementation plan

Baseline: `796cc43e63784eb8891ca6420572cd563cb2ac80`, application 3.40.0.
The previously accepted application is 3.37.7. This work changes the host control plane;
it does not deploy, migrate, access production, or publish a remote branch.

## Confirmed causes

Runtime and builder requirements are duplicated across repository scripts, installed maintenance
code and provisioning notes. Bootstrap validates its current Node but fetches/fast-forwards before
understanding the target's requirements. The target runner validates at module initialization,
before it can record a no-side-effect rejection. Bootstrap marks controller intent as started;
there is no independent, request-bound receipt proving rejection before business operations.
Installed root-owned maintenance code has no atomic, audited alignment protocol.

## Implementation and acceptance

1. Add a versioned, data-only host contract and a dependency-free compatibility evaluator. Distinguish
   minimum requirements, supported ranges and recommendations; keep Node/npm pins and CI aligned.
2. Implement read-only structured host diagnostics for runtimes, CRM rootless identity/config,
   builder ownership/configuration, installed maintenance content, units/locks and disk gates.
   Run before request admission and after fetch/before merge using bounded `git show` reads of
   fixed target paths. No target JavaScript is evaluated during this check.
3. Add planning-only host upgrade commands. System packages remain a separate operator procedure.
   Builder replacement requires an exact approved plan, ownership/configuration validation,
   shared deployment/maintenance locks and durable phase receipts. Ambiguous create/remove
   outcomes are inspected and fail closed; recovery never blindly deletes a replacement.
4. Install reviewed root-owned maintenance as a content-addressed bundle and an atomically replaced
   root-owned launcher. Approval binds all source bytes; normal Git updates cannot install it.
5. Inherit Bootstrap's Node executable. Add a target entry gate that writes an exclusive rejection
   receipt before any business operation and durable handoff evidence after approval. Explicit
   archival validates request/launch/attempt/source identities and independent journals under locks.
   Missing receipts, migrations, switches, accepted results and finalization failures remain blocked.
6. Add deterministic filesystem/process adapters and failure-injection tests for all new boundaries.
   Execute `npm run test:deploy`, `npm run typecheck`, `npm run lint`; preserve existing tests and
   schema/finalization/reconcile behavior. No live production or Docker calls are used for tests.
7. Update deployment/runbook instructions and save exact verification results and operator limits.

All system package upgrades, root installation and destructive builder replacement require distinct
operator approval. No global prune, data volume removal, PostgreSQL change or other Docker instance
access is introduced. The application version stays 3.40.0 for this control-plane repair.

## Execution result

All seven implementation steps are complete. The versioned contract, static target preflight,
request admission checks, inherited Node handoff, installed maintenance bundle/receipt, approved
builder replacement and evidence-bound early archival are implemented. CI now checks contract
alignment and runs the deployment suite. Required checks and local-only limits are recorded in
[verification](HOST_CONTROL_PLANE_VERIFICATION.md). No production or Docker instance was accessed,
no system upgrade was executed, and no remote branch was pushed.
