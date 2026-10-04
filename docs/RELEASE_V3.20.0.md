# v3.20.0 — Admissions Operating System

Lumina connects **Enrollment → formal Applications → Admissions operations**
without replacing Student, Enrollment, Tasks or Finance. One Enrollment can
apply to multiple target institutions, with explicit context and operational history.

- **Formal Applications (095):** Enrollment 1:N Application, immutable Enrollment,
  independent lifecycle status and admission decision, optional target institution,
  explicit deadlines, strict revision/retry contracts and atomic status history.
  Application-linked preparation Tasks reuse the existing checklist; generic Tasks
  with NULL context remain compatible. Student/Product/Cohort identity is derived
  through Enrollment rather than duplicated.
- **Admission Milestones (096):** Enrollment-level nodes optionally reference a
  consistent Application. Types cover interviews, supplementary materials, placement
  tests, I-20 request/issue, SEVIS, visa operations, flight, orientation and arrival.
  Repeated interviews and visa appointments are valid. Due/scheduled/completed times
  remain separate; metadata is type-whitelisted and history records real transitions.
- **Admissions Workflow (097):** human-configured versioned Templates, explicit
  Template + Version starts, sequential Instances and TASK/MILESTONE/CHECKPOINT steps.
  Used versions remain immutable; retirement prevents new starts while preserving
  history. Real Tasks and Milestones remain canonical; finite checkpoints evaluate
  Application submission/decision or matching completed milestones. Missing required
  Application context rejects the entire start instead of guessing between Applications.
- **Operational integration:** existing Task/Notification automation, contextual
  quality findings, workspace/owner/team authorization and personal Admissions export/
  purge. The read-only timeline identifies APPLICATION, MILESTONE and WORKFLOW sources;
  Workflow contributes only start/completion summaries.

**No duplicate Finance system was created.** Application submission and decisions
remain Application facts; deposits/payments/refunds remain Finance facts. They are
not copied into milestones or workflow checkpoints. v3.19 shared-contract allocation
and currency separation remain intact. Task/Milestone completion advances workflows
from canonical records; workflow overrides never rewrite those business facts.

`admission_journeys` remains legacy compatibility data: this release does not migrate,
delete, rename, replace or automatically synchronize it. There is no automatic
Enrollment workflow start and no Production template seed. Formal GAPP, Summer School,
Camp or Competition configuration requires a separate business-confirmed task.

## Frozen migrations

The forward-only SQL raw bytes are frozen and protected by `.gitattributes`.
091–094 also remain unchanged. SHA256 values:

| Migration | SHA256 |
| --- | --- |
| 095 Student Applications | `6eb055645a1bda23dc9b3010152282ea5fca2d55751ba0a3bb848b9b59334a7c` |
| 096 Admission Milestones | `2bebf07e194c128ec228af2c2b3a648a3e416ff7dab151544524f8f65ccd8e21` |
| 097 Admissions Workflows | `8211e641d46aeb8b3ddde49dcd15fae80a8102a2c7dd16a0d60ede0eebe1cf99` |

See [Admissions architecture](ADMISSIONS_ARCHITECTURE.md),
[Cohort/Enrollment architecture](COHORT_ENROLLMENT_ARCHITECTURE.md) and
[release verification](V320_RELEASE_CLOSURE.md). Local manifests, reversible patches,
logs and screenshots remain Git-ignored under `work/`, outside the product checkpoint.
No production access, push or deployment is part of source release closure.

## Deferred

No document management, commission engine, Student Success, Product P&L,
Management Intelligence, AI, complex BPMN, parallel/branching workflow or arbitrary
code/expression actions are included. Cohort default workflows and Finance checkpoints
remain future design. No automatic Production workflow configuration is included.
