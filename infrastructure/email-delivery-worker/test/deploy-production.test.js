import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import {
  buildWranglerArguments,
  loadProductionValues,
  ProductionConfigurationError,
  runDeployment,
  validateProductionValues,
} from "../scripts/deploy-production.mjs";

const execFileAsync = promisify(execFile);
const workerRoot = fileURLToPath(new URL("..", import.meta.url));
const repositoryRoot = path.resolve(workerRoot, "..", "..");

function fakeProductionValues(overrides = {}) {
  return {
    WORKER_NAME: "unit-test-worker",
    WORKER_PUBLIC_BASE_URL: "https://worker.example.invalid",
    CRM_APP_URL: "https://crm.example.invalid",
    EMAIL_FROM: "Test Mail <user@example.test>",
    EMAIL_REPLY_TO: "",
    EMAIL_BRAND_NAME: "Lumina Education CRM",
    DELIVERY_PATH: "/delivery-test",
    HEALTH_PATH: "/health-test",
    CLOUDFLARE_ACCOUNT_ID: "",
    CLOUDFLARE_API_TOKEN: "",
    ...overrides,
  };
}

function asEnvFile(values) {
  return Object.entries(values)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
}

async function withTemporaryEnv(callback) {
  const directory = await mkdtemp(path.join(tmpdir(), "email-worker-test-"));
  const envFile = path.join(directory, ".env.production.local");
  await writeFile(envFile, asEnvFile(fakeProductionValues()), "utf8");
  try {
    return await callback(envFile);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
}

test("production controller fails before Wrangler when the local Env file is missing", async () => {
  const missing = path.join(tmpdir(), "missing-email-worker-env", ".env.production.local");
  await assert.rejects(
    loadProductionValues(missing),
    (error) => error instanceof ProductionConfigurationError
      && error.code === "PRODUCTION_ENV_FILE_MISSING",
  );
});

test("production Env validation requires every runtime value and rejects placeholders", async (t) => {
  for (const key of [
    "WORKER_NAME",
    "WORKER_PUBLIC_BASE_URL",
    "CRM_APP_URL",
    "EMAIL_FROM",
    "EMAIL_BRAND_NAME",
    "DELIVERY_PATH",
    "HEALTH_PATH",
  ]) {
    await t.test(`missing ${key}`, () => {
      assert.throws(
        () => validateProductionValues(
          fakeProductionValues({ [key]: "" }),
          { allowTestValues: true },
        ),
        ProductionConfigurationError,
      );
    });
  }
  for (const overrides of [
    { WORKER_NAME: "example-worker" },
    { WORKER_PUBLIC_BASE_URL: "https://worker.example.invalid" },
    { CRM_APP_URL: "http://crm.example.invalid" },
    { EMAIL_FROM: "invalid-mailbox" },
    { EMAIL_REPLY_TO: "invalid-mailbox" },
    { DELIVERY_PATH: "delivery" },
    { HEALTH_PATH: "/delivery-test" },
  ]) {
    await t.test(`invalid ${Object.keys(overrides)[0]}`, () => {
      assert.throws(
        () => validateProductionValues(
          fakeProductionValues(overrides),
          {
            allowTestValues: !Object.hasOwn(overrides, "WORKER_NAME")
              && !Object.hasOwn(overrides, "WORKER_PUBLIC_BASE_URL"),
          },
        ),
        ProductionConfigurationError,
      );
    });
  }
});

test("Wrangler arguments are strict, route-free, secret-free, and Env-driven", () => {
  const configuration = validateProductionValues(fakeProductionValues({
    EMAIL_REPLY_TO: "user@example.test",
  }), { allowTestValues: true });
  const args = buildWranglerArguments(configuration, { dryRun: true });
  assert.ok(args.includes("--name"));
  assert.ok(args.includes(configuration.WORKER_NAME));
  assert.ok(args.includes("--config"));
  assert.ok(args.some((value) => value.endsWith("wrangler.toml")));
  assert.ok(args.includes("--keep-vars"));
  assert.ok(args.includes("--strict"));
  assert.ok(args.includes("--dry-run"));
  assert.equal(args.includes("--route"), false);
  assert.equal(args.includes("--routes"), false);
  assert.equal(args.includes("--domain"), false);
  const serialized = args.join("\n");
  for (const key of [
    "CRM_APP_URL",
    "EMAIL_FROM",
    "EMAIL_REPLY_TO",
    "EMAIL_BRAND_NAME",
    "DELIVERY_PATH",
    "HEALTH_PATH",
  ]) {
    assert.match(serialized, new RegExp(`${key}:`));
  }
  assert.doesNotMatch(serialized, /LUMINA_WEBHOOK_TOKEN|RESEND_API_KEY|WORKER_PUBLIC_BASE_URL/);
});

test("Wrangler dry-run bundles fictitious configuration without upload or health traffic", async () => {
  await withTemporaryEnv(async (envFile) => {
    let healthRequests = 0;
    const result = await runDeployment({
      dryRun: true,
      envFile,
      allowTestValues: true,
      fetchImplementation: async () => {
        healthRequests += 1;
        throw new Error("dry-run must not issue health traffic");
      },
    });
    assert.deepEqual(result, {
      dryRun: true,
      workerName: "unit-test-worker",
    });
    assert.equal(healthRequests, 0);
    await assert.rejects(access(path.join(workerRoot, ".wrangler", "production-dry-run")));
  });
});

test("local production Env and generated Wrangler deployment configs are ignored", async () => {
  const ignoredPaths = [
    "infrastructure/email-delivery-worker/.env.production.local",
    "infrastructure/email-delivery-worker/.dev.vars.production",
    "infrastructure/email-delivery-worker/.wrangler/deploy/config.json",
    "infrastructure/email-delivery-worker/wrangler.production.toml",
    "infrastructure/email-delivery-worker/wrangler.production.json",
    "infrastructure/email-delivery-worker/wrangler.production.jsonc",
  ];
  for (const ignoredPath of ignoredPaths) {
    const { stdout } = await execFileAsync(
      "git",
      ["check-ignore", "--verbose", ignoredPath],
      { cwd: repositoryRoot },
    );
    assert.match(stdout, /gitignore/);
  }
  await assert.rejects(execFileAsync(
    "git",
    [
      "ls-files",
      "--error-unmatch",
      "infrastructure/email-delivery-worker/.env.production.local",
    ],
    { cwd: repositoryRoot },
  ));
});

test("tracked public tree contains none of the prohibited production identifiers", async () => {
  const { stdout } = await execFileAsync("git", ["ls-files", "-z"], {
    cwd: repositoryRoot,
    encoding: "buffer",
    maxBuffer: 10 * 1024 * 1024,
  });
  const files = stdout.toString("utf8").split("\0").filter(Boolean);
  const zone = ["ewaya", "com"].join(".");
  const prohibited = [
    ["crm-mail", zone].join("."),
    ["mail-api", zone].join("."),
    ["crm", zone].join("."),
    ["notify", zone].join("."),
    ["notifications", ["notify", zone].join(".")].join("@"),
    ["lumina", "mail", "delivery"].join("-"),
    ["lumina", "crm", "email", "delivery"].join("-"),
  ].map((value) => Buffer.from(value));
  const violations = [];
  for (const file of files) {
    const contents = await readFile(path.join(repositoryRoot, file));
    if (prohibited.some((value) => contents.includes(value))) violations.push(file);
  }
  assert.deepEqual(violations, []);
});
