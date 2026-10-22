# Deployment reliability repair

Baseline: `5e6703a97d127ed36ac9d7a84e6a7a5d93215044`, release 3.37.6.

Confirmed defects: bootstrap discards Git failure evidence and misclassifies early failures as finalization failures; request recovery uses elapsed time rather than execution evidence; rollback lacks schema compatibility proof; public acceptance has no readiness window; host runtime compatibility is not enforced.

Infrastructure hypothesis remains unconfirmed: a Tunnel process with no registered connections can fail public acceptance even when application health succeeds. TCP establishment alone does not prove Tunnel registration. No protocol, certificate, proxy, or host root cause is established.

Implementation sequence:

1. Add safe Git classifications, bounded fetch retries, durable bootstrap attempt records, and evidence-based request recovery.
2. Record authoritative database and image migration manifests; guard all application restoration paths. Persist migration and switch intent before operations.
3. Separate internal health from public acceptance; retain compatible candidates, provide explicit acceptance continuation, and reconcile terminal archives without replay.
4. Add bounded public readiness and read-only, instance-specific Tunnel diagnostics; enforce Node runtime boundaries.
5. Add deterministic failure and interrupted-state tests; run deployment, asset, privacy, type, lint, build, and metadata gates.
6. Document operator commands, recovery limits, optional Tunnel readiness guidance, and the release candidate. No production access, push, or deployment.

Safety invariants: one systemd controller under the existing deployment lock; no automatic migration replay; no reverse migrations; no unproven old-image restoration; no public acceptance without exact-version HTTP 200; no terminal request archival before terminal state is durable; no raw network errors in state; no unrelated resource cleanup.
