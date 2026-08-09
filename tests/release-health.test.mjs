import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  evaluateProductionReleaseHealth,
  PREEXISTING_QUEUE_DEGRADATION,
  sanitizeReleaseHealthEvidence,
} from "../scripts/lib/production-release-health.mjs";
import { assertWorkerContainerHealth } from "../scripts/lib/worker-container-health.mjs";
import {
  createAcceptedRelease,
  ProductionReleaseWorkflowError,
  releaseFailureRollbackPlan,
  runProductionReleaseWorkflow,
} from "../scripts/lib/production-deploy-workflow.mjs";

const repositoryFile = (path) => new URL(`../${path}`, import.meta.url);

function readiness({
  failedJobs = 0,
  stuckJobs = 0,
  missingWorkers = 0,
  staleWorkers = 0,
  checks = {},
  extra = {},
} = {}) {
  return {
    checks:{ environment:true,auth:true,database:true,workers:true,queues:failedJobs === 0 && stuckJobs === 0,...checks },
    metrics:{ failedJobs,stuckJobs,missingWorkers,staleWorkers },
    ...extra,
  };
}

function workerSnapshot(overrides = {}) {
  return {
    database:true,
    failedJobs:0,
    stuckJobs:0,
    missingWorkers:0,
    staleWorkers:0,
    ...overrides,
  };
}

test("Worker container health ignores retryable and stuck queue counts", () => {
  assert.equal(assertWorkerContainerHealth({
    schemaCurrent:true,
    snapshot:workerSnapshot({ failedJobs:1 }),
  }), true);
  assert.equal(assertWorkerContainerHealth({
    schemaCurrent:true,
    snapshot:workerSnapshot({ stuckJobs:1 }),
  }), true);
});

test("Worker container health still fails closed on heartbeat and schema health", () => {
  assert.throws(
    () => assertWorkerContainerHealth({schemaCurrent:true,snapshot:workerSnapshot({missingWorkers:1})}),
    /WORKER_HEALTH_MISSINGWORKERS/,
  );
  assert.throws(
    () => assertWorkerContainerHealth({schemaCurrent:true,snapshot:workerSnapshot({staleWorkers:1})}),
    /WORKER_HEALTH_STALEWORKERS/,
  );
  assert.throws(
    () => assertWorkerContainerHealth({schemaCurrent:false,snapshot:workerSnapshot()}),
    /WORKER_SCHEMA_NOT_CURRENT/,
  );
});

test("release acceptance applies the exact failed-job baseline matrix", () => {
  const cases = [
    [0,0,"HEALTHY",[]],
    [1,1,"ACCEPTED_WITH_PREEXISTING_DEGRADATION",[PREEXISTING_QUEUE_DEGRADATION]],
    [1,0,"HEALTHY",[]],
    [2,1,"ACCEPTED_WITH_PREEXISTING_DEGRADATION",[PREEXISTING_QUEUE_DEGRADATION]],
  ];
  for (const [baselineFailedJobs,finalFailedJobs,status,warnings] of cases) {
    assert.deepEqual(
      evaluateProductionReleaseHealth({
        baseline:readiness({failedJobs:baselineFailedJobs}),
        final:readiness({failedJobs:finalFailedJobs}),
      }),
      {status,baselineFailedJobs,finalFailedJobs,stuckJobs:0,warnings},
    );
  }
  for (const [baselineFailedJobs,finalFailedJobs] of [[0,1],[1,2]]) {
    assert.throws(
      () => evaluateProductionReleaseHealth({
        baseline:readiness({failedJobs:baselineFailedJobs}),
        final:readiness({failedJobs:finalFailedJobs}),
      }),
      /RELEASE_HEALTH_FAILED_JOBS_INCREASED/,
    );
  }
});

test("release acceptance blocks stuck work and infrastructure degradation", () => {
  assert.throws(
    () => evaluateProductionReleaseHealth({baseline:readiness(),final:readiness({stuckJobs:1})}),
    /RELEASE_HEALTH_STUCK_JOBS/,
  );
  assert.throws(
    () => evaluateProductionReleaseHealth({baseline:readiness(),final:readiness({missingWorkers:1})}),
    /RELEASE_HEALTH_MISSING_WORKERS|RELEASE_HEALTH_WORKERS_FAILED/,
  );
  assert.throws(
    () => evaluateProductionReleaseHealth({baseline:readiness(),final:readiness({staleWorkers:1})}),
    /RELEASE_HEALTH_STALE_WORKERS|RELEASE_HEALTH_WORKERS_FAILED/,
  );
  assert.throws(
    () => evaluateProductionReleaseHealth({baseline:readiness(),final:readiness({checks:{auth:false}})}),
    /RELEASE_HEALTH_AUTH_FAILED/,
  );
});

function workflowOperations({ baselineFailedJobs, finalFailedJobs }) {
  const target = {
    commit:"a".repeat(40),
    version:"3.8.28",
    currentImage:`lumina-crm:${"a".repeat(40)}`,
    operationsImage:`lumina-crm-ops:${"a".repeat(40)}`,
  };
  const noop = async () => undefined;
  return {
    resolveTarget:async () => target,
    preflightSecretSources:noop,
    preflightTargetRuntimeContract:noop,
    prepare:noop,
    buildImages:noop,
    writeCandidateEnvironment:async () => "candidate.env",
    startPostgres:noop,
    bootstrapDatabase:noop,
    verifyMigrations:noop,
    markMigrationMayHaveChanged:noop,
    migrate:noop,
    bootstrapAdmin:noop,
    captureReleaseHealthBaseline:async () => readiness({failedJobs:baselineFailedJobs}),
    switchApplication:noop,
    acceptRuntime:async (_environment, {baseline}) => evaluateProductionReleaseHealth({
      baseline,
      final:readiness({failedJobs:finalFailedJobs}),
    }),
  };
}

test("pre-existing degradation completes the release workflow without rollback", async () => {
  const result = await runProductionReleaseWorkflow({
    mode:"deploy",
    targetCommit:"a".repeat(40),
    operations:workflowOperations({baselineFailedJobs:1,finalFailedJobs:1}),
  });
  assert.equal(result.releaseHealth.status, "ACCEPTED_WITH_PREEXISTING_DEGRADATION");
  assert.deepEqual(result.releaseHealth.warnings, [PREEXISTING_QUEUE_DEGRADATION]);
});

test("a target-created failure rejects acceptance and requires rollback", async () => {
  let failure;
  try {
    await runProductionReleaseWorkflow({
      mode:"deploy",
      targetCommit:"a".repeat(40),
      operations:workflowOperations({baselineFailedJobs:1,finalFailedJobs:2}),
    });
  } catch (error) {
    failure = error;
  }
  assert.equal(failure instanceof ProductionReleaseWorkflowError, true);
  assert.equal(failure.switched, true);
  assert.deepEqual(releaseFailureRollbackPlan({
    switched:failure.switched,
    previousAccepted:{currentImage:"previous",operationsImage:"previous-ops"},
  }), {status:"REQUIRED"});
});

test("recovery accepts failed jobs when the unavailable baseline cannot be reconstructed", () => {
  const evidence = evaluateProductionReleaseHealth({
    baseline:null,
    final:readiness({failedJobs:1}),
    allowMissingBaseline:true,
  });
  assert.deepEqual(evidence, {
    status:"ACCEPTED_WITH_PREEXISTING_DEGRADATION",
    baselineFailedJobs:1,
    finalFailedJobs:1,
    stuckJobs:0,
    warnings:[PREEXISTING_QUEUE_DEGRADATION],
  });
});

test("release evidence contains only bounded aggregate health fields", () => {
  const evidence = evaluateProductionReleaseHealth({
    baseline:readiness({failedJobs:1}),
    final:readiness({
      failedJobs:1,
      extra:{
        payload:"payload-secret",
        error:"provider-error-secret",
        recipient:"recipient@example.test",
        credential:"credential-secret",
      },
    }),
  });
  assert.deepEqual(Object.keys(evidence), [
    "status","baselineFailedJobs","finalFailedJobs","stuckJobs","warnings",
  ]);
  assert.doesNotMatch(
    JSON.stringify(evidence),
    /payload-secret|provider-error-secret|recipient@example|credential-secret/,
  );
  const accepted = createAcceptedRelease({
    deploymentId:"deployment-id",
    request:{requestId:"request-id",mode:"deploy"},
    target:{
      commit:"a".repeat(40),version:"3.8.28",
      currentImage:`lumina-crm:${"a".repeat(40)}`,
      operationsImage:`lumina-crm-ops:${"a".repeat(40)}`,
    },
    previousAccepted:null,
    acceptedAt:"2026-08-09T00:00:00.000Z",
    releaseHealth:evidence,
  });
  assert.deepEqual(accepted.releaseHealth, evidence);
  assert.deepEqual(sanitizeReleaseHealthEvidence({...evidence,payload:"must-be-removed"}), evidence);
  assert.throws(
    () => sanitizeReleaseHealthEvidence({...evidence,warnings:["ARBITRARY_WARNING"]}),
    /RELEASE_HEALTH_WARNINGS_INVALID/,
  );
});

test("normal readiness and Operations remain operationally degraded and actionable", async () => {
  const [diagnostics,healthRoute,operationsRoute,operationsRepository] = await Promise.all([
    readFile(repositoryFile("lib/readiness-diagnostics.ts"),"utf8"),
    readFile(repositoryFile("app/api/health/route.ts"),"utf8"),
    readFile(repositoryFile("app/api/operations/route.ts"),"utf8"),
    readFile(repositoryFile("lib/operations-repository.ts"),"utf8"),
  ]);
  assert.match(diagnostics, /failedJobs === 0 && metrics\.stuckJobs === 0/);
  assert.match(healthRoute, /status: ready \? 200 : 503/);
  assert.match(operationsRoute, /listRetryableJobs/);
  assert.match(operationsRoute, /retryableJobs/);
  assert.match(operationsRepository, /operational_retryable_jobs_page/);
});

test("deployment evidence and logs never serialize readiness documents", async () => {
  const runner = await readFile(repositoryFile("scripts/deploy-production-runner.mjs"),"utf8");
  assert.match(runner, /persist\(\{ releaseHealth \}\)/);
  assert.doesNotMatch(runner, /persist\(\{[^}]*readiness|JSON\.stringify\(readiness\)|log\([^\n]*readiness/);
  assert.match(runner, /applicationAccepted:true[\s\S]*releaseHealth/);
  assert.match(runner, /acceptanceMode:"recovery"/);
});

test("the Worker performs an immediate bounded bootstrap cycle before its 300-second delay", async () => {
  const [loop,compose,runner] = await Promise.all([
    readFile(repositoryFile("scripts/run-worker-loop.mjs"),"utf8"),
    readFile(repositoryFile("compose.production.yml"),"utf8"),
    readFile(repositoryFile("scripts/deploy-production-runner.mjs"),"utf8"),
  ]);
  assert.ok(loop.indexOf("await runScript(cycleScript, 240_000)") < loop.indexOf("await delay(intervalSeconds * 1_000)"));
  assert.match(compose, /WORKER_LOOP_INTERVAL_SECONDS: \$\{WORKER_LOOP_INTERVAL_SECONDS:-300\}/);
  assert.match(compose, /start_period: 3m/);
  assert.match(runner, /waitForContainerHealth\(envFile, "worker", 240_000\)/);
});
