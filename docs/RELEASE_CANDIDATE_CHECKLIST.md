# Production candidate verification

Feature-specific tests and browser checks establish a feature's behavior. They do not establish that
all historical contracts still accept the candidate. A production candidate must satisfy both.

Before committing or handing off the candidate:

1. Run the changed behavior tests and the complete npm run test:contracts:raw. Keep failures visible;
   investigate obsolete assertions separately from actual application defects. Preserve unrelated
   assertions and existing security gates.
2. Run npm run release:verify in an isolated development Docker environment, or require the same
   candidate's successful CI Production candidate Docker verification job. This executes the actual
   Dockerfile sequence: locked dependencies, production build, typecheck:raw, lint:raw,
   test:contracts:raw, then test:deploy:raw. Do not replace it with mocked Docker commands.
3. Record the source SHA/worktree patch, pinned versions, complete test totals, conditional skips,
   Docker result and image digest. Keep raw evidence under ignored work/. Never use production
   sockets, database credentials, business secrets or production data for verification.
4. Stop on failure or NOT_RUN. After a code/test/configuration correction, rerun affected gates and
   the verification build. A documentation-only report update need not repeat unchanged image input.
5. Only then create the candidate commit. Push and production release still require their existing
   authorization. Use a new deployment request; do not replay an archived failed request.

The regular CI workflow now has a separate Docker verification job on its existing code-change and
manual triggers. Its documentation path exclusions remain: for a documentation-only candidate,
manually dispatch CI for that SHA or run local verification before handoff. Repository branch
protection/required-check settings are administered separately; adding the workflow does not prove
those remote settings are configured.

Node LTS, npm and dependency pins come from the repository. Verification adds no production service,
database or build infrastructure. The application version can remain unchanged for a test/gate-only
repair of an unreleased candidate; the new commit identifies the corrected source.
