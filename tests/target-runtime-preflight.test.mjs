import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import {
  inspectCoreRuntimeEnvironment,
  inspectWorkerRuntimeEnvironment,
} from "../lib/runtime-environment-core.mjs";
import {
  classifyTargetRuntimeValidatorResult,
  runTargetRuntimePreflight,
} from "../scripts/lib/target-runtime-validator-process.mjs";
import {
  TargetRuntimeContractError,
  validateTargetRuntimeContract,
} from "../scripts/lib/target-runtime-contract.mjs";

const repositoryRoot = path.resolve(new URL("..", import.meta.url).pathname.replace(/^\/(?:([A-Za-z]:))/, "$1"));
const invitationHex = "ab".repeat(32);

function runtimeFixture({ invitationKey = invitationHex } = {}) {
  return {
    web: {
      APP_URL: "https://crm.example.net",
      NEXT_PUBLIC_TURNSTILE_SITE_KEY: "turnstile-site-key-production",
      TURNSTILE_SECRET_KEY: "turnstile-secret-".padEnd(40, "a"),
      TURNSTILE_EXPECTED_HOSTNAME: "crm.example.net",
      ALTCHA_HMAC_SECRET: "altcha-secret-".padEnd(40, "b"),
      DATABASE_URL: "postgresql://crm_app:password@postgres:5432/lumina_crm",
      SYSTEM_DATABASE_URL: "postgresql://crm_system:password@postgres:5432/lumina_crm",
      CRM_WORKSPACE_ID: "00000000-0000-4000-8000-000000000001",
      LOGIN_THROTTLE_HASH_SECRET: "login-secret-".padEnd(40, "c"),
      TRUSTED_DEVICE_HASH_SECRET: "trusted-secret-".padEnd(40, "d"),
      TOTP_ENCRYPTION_KEY: "totp-secret-".padEnd(40, "e"),
      INVITATION_CREDENTIAL_ENCRYPTION_KEY: invitationKey,
      OBJECT_STORAGE_SIGNING_SECRET: "object-secret-".padEnd(40, "f"),
    },
    worker: {
      WORKER_DATABASE_URL: "postgresql://crm_worker:password@postgres:5432/lumina_crm",
      CRM_WORKSPACE_ID: "00000000-0000-4000-8000-000000000001",
      OBJECT_STORAGE_PROVIDER: "local",
      OBJECT_STORAGE_LOCAL_ROOT: "/var/lib/lumina-crm/objects",
      EMAIL_DELIVERY_WEBHOOK_URL: "https://mailer.example.net/delivery",
      EMAIL_DELIVERY_WEBHOOK_TOKEN: "delivery-token-".padEnd(40, "g"),
      INVITATION_CREDENTIAL_ENCRYPTION_KEY: invitationKey,
      OUTBOX_BATCH_SIZE: "20",
      CALENDAR_DELIVERY_BATCH_SIZE: "20",
      COMMUNICATION_DELIVERY_BATCH_SIZE: "20",
      EXPORT_BATCH_SIZE: "10",
      REMINDER_BATCH_SIZE: "100",
      WORKER_JOB_CONCURRENCY: "4",
      WEBHOOKS_ENABLED: "false",
      INTEGRATION_SYNC_ENABLED: "false",
      OBSERVABILITY_ENABLED: "false",
      SSO_ENABLED: "false",
      SCIM_ENABLED: "false",
    },
  };
}

function validateFixture(fixture) {
  return validateTargetRuntimeContract({
    ...fixture,
    webStatus: inspectCoreRuntimeEnvironment(fixture.web),
    workerStatus: inspectWorkerRuntimeEnvironment(fixture.worker),
  });
}

const envText = (values) => `${Object.entries(values).map(([key, value]) => `${key}=${value}`).join("\n")}\n`;

async function isolatedCheckout(context, fixture = runtimeFixture()) {
  const root = await mkdtemp(path.join(os.tmpdir(), "lumina-target-runtime-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  for (const relativePath of [
    "scripts/validate-production-runtime-contract.mjs",
    "scripts/lib/target-runtime-contract.mjs",
    "lib/runtime-environment-core.mjs",
    "lib/application-origin.mjs",
    "lib/email-delivery-runtime.mjs",
  ]) {
    const destination = path.join(root, relativePath);
    await mkdir(path.dirname(destination), { recursive: true });
    await cp(path.join(repositoryRoot, relativePath), destination);
  }
  const secretsRoot = path.join(root, "secrets");
  await mkdir(secretsRoot);
  await writeFile(path.join(secretsRoot, "production.env"), envText(fixture.web));
  await writeFile(path.join(secretsRoot, "worker.env"), envText(fixture.worker));
  return { root, secretsRoot };
}

test("target runtime validator executes from a checkout without node_modules or tsx", async (context) => {
  const { root, secretsRoot } = await isolatedCheckout(context);
  await assert.rejects(readFile(path.join(root, "node_modules", "tsx", "package.json")), /ENOENT/);
  const validatorModule = await import(pathToFileURL(path.join(root, "scripts", "validate-production-runtime-contract.mjs")).href);
  assert.deepEqual(
    await validatorModule.validateProductionRuntimeContractFiles({ secretsRoot, enforceProductionPath: false }),
    { status: "VALID", boundaries: ["web", "worker"] },
  );
});

test("valid hex and base64 invitation keys retain the complete contract", () => {
  assert.equal(validateFixture(runtimeFixture()).status, "VALID");
  const base64 = Buffer.from("z".repeat(32)).toString("base64");
  assert.equal(validateFixture(runtimeFixture({ invitationKey: base64 })).status, "VALID");
});

test("target runtime errors retain missing, invalid, mismatch, and independence codes", () => {
  const cases = [
    ["TARGET_RUNTIME_SECRET_MISSING", (fixture) => { fixture.web.INVITATION_CREDENTIAL_ENCRYPTION_KEY = ""; }],
    ["TARGET_RUNTIME_ENVIRONMENT_INVALID", (fixture) => {
      fixture.web.INVITATION_CREDENTIAL_ENCRYPTION_KEY = "short";
      fixture.worker.INVITATION_CREDENTIAL_ENCRYPTION_KEY = "short";
    }],
    ["TARGET_RUNTIME_SECRET_MISMATCH", (fixture) => { fixture.worker.INVITATION_CREDENTIAL_ENCRYPTION_KEY = "cd".repeat(32); }],
    ["TARGET_RUNTIME_SECRET_NOT_INDEPENDENT", (fixture) => {
      fixture.web.TOTP_ENCRYPTION_KEY = fixture.web.INVITATION_CREDENTIAL_ENCRYPTION_KEY;
    }],
  ];
  for (const [code, mutate] of cases) {
    const fixture = runtimeFixture();
    mutate(fixture);
    assert.throws(() => validateFixture(fixture), (error) => error instanceof TargetRuntimeContractError && error.code === code);
  }
});

test("feature groups and Worker external budgets remain authoritative", () => {
  const missingFeatureGroup = runtimeFixture();
  missingFeatureGroup.worker.WEBHOOKS_ENABLED = "true";
  assert.equal(inspectWorkerRuntimeEnvironment(missingFeatureGroup.worker).valid, false);
  assert.ok(inspectWorkerRuntimeEnvironment(missingFeatureGroup.worker).missing.includes("WEBHOOK_PROCESSOR_URL"));

  const enabled = runtimeFixture();
  Object.assign(enabled.worker, {
    WEBHOOKS_ENABLED: "true",
    WEBHOOK_MICROSOFT_365_SECRET: "webhook-1".padEnd(40, "1"),
    WEBHOOK_GOOGLE_CALENDAR_SECRET: "webhook-2".padEnd(40, "2"),
    WEBHOOK_EMAIL_SECRET: "webhook-3".padEnd(40, "3"),
    WEBHOOK_E_SIGNATURE_SECRET: "webhook-4".padEnd(40, "4"),
    WEBHOOK_ACCOUNTING_SECRET: "webhook-5".padEnd(40, "5"),
    WEBHOOK_PAYMENT_SECRET: "webhook-6".padEnd(40, "6"),
    WEBHOOK_PROCESSOR_URL: "https://processor.example.net/webhooks",
    WEBHOOK_PROCESSOR_TOKEN: "webhook-token".padEnd(40, "7"),
    WEBHOOK_BATCH_SIZE: "20",
    INTEGRATION_SYNC_ENABLED: "true",
    INTEGRATION_SYNC_PROCESSOR_URL: "https://processor.example.net/integrations",
    INTEGRATION_SYNC_PROCESSOR_TOKEN: "integration-token".padEnd(40, "8"),
    INTEGRATION_SYNC_BATCH_SIZE: "10",
    OBSERVABILITY_ENABLED: "true",
    OBSERVABILITY_WEBHOOK_URL: "https://observability.example.net/events",
    OBSERVABILITY_WEBHOOK_TOKEN: "observability-token".padEnd(40, "9"),
    OBSERVABILITY_SAMPLE_RATE: "0.5",
    SSO_ENABLED: "true",
    SSO_ALLOWED_DOMAINS: "school.example.net,academy.example.org",
    SCIM_ENABLED: "true",
    SCIM_BEARER_TOKEN: "scim-token".padEnd(40, "a"),
  });
  assert.equal(validateFixture(enabled).status, "VALID");
  enabled.worker.WORKER_JOB_CONCURRENCY = "1";
  assert.equal(inspectWorkerRuntimeEnvironment(enabled.worker).valid, false);
  assert.ok(inspectWorkerRuntimeEnvironment(enabled.worker).missing.includes("OUTBOX_BATCH_SIZE"));
});

test("validator bootstrap failures use stable codes without retaining sensitive stderr", () => {
  const secret = "postgresql://user:password@database.example/lumina";
  assert.deepEqual(classifyTargetRuntimeValidatorResult({
    code: 1,
    stderr: `Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'damaged'\n${secret}`,
  }), { valid: false, errorCode: "TARGET_RUNTIME_VALIDATOR_UNAVAILABLE" });
  assert.deepEqual(classifyTargetRuntimeValidatorResult({
    code: 1,
    stderr: `SyntaxError: broken validator\n${secret}`,
  }), { valid: false, errorCode: "TARGET_RUNTIME_VALIDATOR_EXECUTION_FAILED" });
  assert.deepEqual(classifyTargetRuntimeValidatorResult({
    code: 1,
    stderr: "TARGET_RUNTIME_SECRET_MISSING:web,worker:web:INVITATION_CREDENTIAL_ENCRYPTION_KEY",
  }), {
    valid: false,
    errorCode: "TARGET_RUNTIME_SECRET_MISSING:web,worker:web:INVITATION_CREDENTIAL_ENCRYPTION_KEY",
  });
  assert.deepEqual(classifyTargetRuntimeValidatorResult({ code: 0, stdout: "damaged" }), {
    valid: false,
    errorCode: "TARGET_RUNTIME_VALIDATOR_EXECUTION_FAILED",
  });
  assert.deepEqual(classifyTargetRuntimeValidatorResult({
    code: 0,
    stdout: JSON.stringify({ status: "VALID", boundaries: ["web", "worker"] }),
  }), { valid: true, errorCode: null });
});

test("validator failures persist FAILED and never masquerade as environment validation", async () => {
  const states = [];
  await assert.rejects(
    runTargetRuntimePreflight({
      run: async () => ({ code: 1, stdout: "", stderr: "SyntaxError: damaged" }),
      persist: (state) => states.push(state),
      secretsRoot: "/etc/lumina-crm/secrets",
    }),
    /TARGET_RUNTIME_VALIDATOR_EXECUTION_FAILED/,
  );
  assert.deepEqual(states, [{ preflight: "FAILED" }]);

  const unavailableStates = [];
  await assert.rejects(
    runTargetRuntimePreflight({
      run: async () => { throw new Error("spawn failed with sensitive details"); },
      persist: (state) => unavailableStates.push(state),
      secretsRoot: "/etc/lumina-crm/secrets",
    }),
    /TARGET_RUNTIME_VALIDATOR_UNAVAILABLE/,
  );
  assert.deepEqual(unavailableStates, [{ preflight: "FAILED" }]);
});

test("production controller and runner use only tracked dependency-free validator modules", async () => {
  const [controller, runner, validator, facade, service] = await Promise.all([
    readFile(path.join(repositoryRoot, "scripts", "deploy-production.mjs"), "utf8"),
    readFile(path.join(repositoryRoot, "scripts", "deploy-production-runner.mjs"), "utf8"),
    readFile(path.join(repositoryRoot, "scripts", "validate-production-runtime-contract.mjs"), "utf8"),
    readFile(path.join(repositoryRoot, "lib", "runtime-environment.ts"), "utf8"),
    readFile(path.join(repositoryRoot, "deploy", "systemd", "lumina-crm-deploy.service"), "utf8"),
  ]);
  assert.doesNotMatch(controller, /from ["'](?:tsx|zod)["']|\bnpx\b|npm (?:ci|install)/);
  assert.doesNotMatch(runner, /--import["',\s]+tsx|\bnpx\b|node_modules/);
  assert.match(runner, /runTargetRuntimePreflight\(\{/);
  assert.match(runner, /const currentRuntime = switched\s*\? await runtimeSnapshot\(\)/);
  assert.match(runner, /state:"unchanged",health:"unchanged"/);
  assert.doesNotMatch(validator, /runtime-environment\.ts|from ["'](?:tsx|zod)["']/);
  assert.doesNotMatch(facade, /from "zod"|placeholderPattern|workerBudgetIssues/);
  assert.match(facade, /from "\.\/runtime-environment-core\.mjs"/);
  assert.match(service, /\/usr\/bin\/node \/opt\/lumina-crm\/source\/scripts\/deploy-production-runner\.mjs/);
  assert.doesNotMatch(service, /tsx|npx|npm|node_modules/);
});
