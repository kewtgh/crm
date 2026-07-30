import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { EventEmitter } from "node:events";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { PassThrough } from "node:stream";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import {
  buildWranglerArguments,
  DEFAULT_PRODUCTION_ENV_FILE,
  loadProductionValues,
  parseArguments,
  ProductionConfigurationError,
  runDeployment,
  validateProductionEnvFile,
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
    EMAIL_BRAND_NAME: "Fictitious Test Brand",
    DELIVERY_PATH: "/delivery-test",
    HEALTH_PATH: "/health-test",
    CLOUDFLARE_ACCOUNT_ID: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    CLOUDFLARE_API_TOKEN: "fictitious-test-token-00000000",
    ...overrides,
  };
}

function asEnvFile(values) {
  return Object.entries(values).map(([key, value]) => `${key}=${value}`).join("\n");
}

async function withTemporaryEnv(callback) {
  const directory = await mkdtemp(path.join(tmpdir(), "email-worker-test-"));
  const envFile = path.join(directory, "worker-fixture.env");
  await writeFile(envFile, asEnvFile(fakeProductionValues()), "utf8");
  try {
    return await callback(envFile);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
}

function successfulSpawn(capture = {}) {
  return (command, args, options) => {
    capture.command = command;
    capture.args = args;
    capture.options = options;
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => {};
    queueMicrotask(() => child.emit("close", 0));
    return child;
  };
}

function failingSpawn(output) {
  return () => {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => {};
    queueMicrotask(() => {
      child.stderr.write(output);
      child.emit("close", 1);
    });
    return child;
  };
}

function fileStatus({ symlink = false, file = true, uid = 0, gid = 4242, mode = 0o640 } = {}) {
  return {
    uid,
    gid,
    mode,
    isSymbolicLink: () => symlink,
    isFile: () => file,
  };
}

const secureFileOptions = {
  lstatImplementation: async () => fileStatus(),
  statImplementation: async () => ({ mode: 0o750, isDirectory: () => true }),
  readFileImplementation: async () => "lumina-crm:x:4242:\n",
};

test("production deployment is Linux-only with a stable error code", async () => {
  await assert.rejects(
    runDeployment({ platform: "win32" }),
    (error) => error instanceof ProductionConfigurationError
      && error.code === "PRODUCTION_DEPLOY_REQUIRES_LINUX",
  );
});

test("production mode uses the fixed Ubuntu Env path", () => {
  assert.equal(DEFAULT_PRODUCTION_ENV_FILE, "/etc/lumina-crm/secrets/email-worker-deploy.env");
  assert.deepEqual(parseArguments([]), {
    dryRun: false,
    envFile: DEFAULT_PRODUCTION_ENV_FILE,
  });
});

test("dry-run requires an explicit absolute Env file", () => {
  assert.throws(() => parseArguments(["--dry-run"]), { code: "DRY_RUN_ENV_FILE_REQUIRED" });
  assert.throws(
    () => parseArguments(["--dry-run", "--env-file", "fixture.env"]),
    { code: "ENV_FILE_PATH_MUST_BE_ABSOLUTE" },
  );
});

test("missing Env file fails closed before Wrangler", async () => {
  const missing = path.join(tmpdir(), "missing-email-worker-env", "worker-fixture.env");
  await assert.rejects(loadProductionValues(missing), { code: "PRODUCTION_ENV_FILE_MISSING" });
});

test("Linux production Env metadata rejects unsafe files", async (t) => {
  const cases = [
    ["symlink", { symlink: true }, "PRODUCTION_ENV_FILE_SYMLINK_FORBIDDEN"],
    ["non-regular", { file: false }, "PRODUCTION_ENV_FILE_NOT_REGULAR"],
    ["non-root owner", { uid: 1000 }, "PRODUCTION_ENV_FILE_OWNER_INVALID"],
    ["wrong group", { gid: 9999 }, "PRODUCTION_ENV_FILE_GROUP_INVALID"],
    ["mode wider than 0640", { mode: 0o644 }, "PRODUCTION_ENV_FILE_MODE_TOO_OPEN"],
  ];
  for (const [name, overrides, code] of cases) {
    await t.test(name, async () => {
      await assert.rejects(
        validateProductionEnvFile(DEFAULT_PRODUCTION_ENV_FILE, {
          ...secureFileOptions,
          lstatImplementation: async () => fileStatus(overrides),
        }),
        { code },
      );
    });
  }
  await t.test("world-readable parent", async () => {
    await assert.rejects(
      validateProductionEnvFile(DEFAULT_PRODUCTION_ENV_FILE, {
        ...secureFileOptions,
        statImplementation: async () => ({ mode: 0o754, isDirectory: () => true }),
      }),
      { code: "PRODUCTION_ENV_DIRECTORY_WORLD_READABLE" },
    );
  });
  await validateProductionEnvFile(DEFAULT_PRODUCTION_ENV_FILE, secureFileOptions);
});

test("production Env validation requires all deployment values and rejects unknown keys", async (t) => {
  for (const key of Object.keys(fakeProductionValues()).filter((key) => key !== "EMAIL_REPLY_TO")) {
    await t.test(`missing ${key}`, () => {
      assert.throws(
        () => validateProductionValues(fakeProductionValues({ [key]: "" }), { allowTestValues: true }),
        ProductionConfigurationError,
      );
    });
  }
  assert.throws(
    () => validateProductionValues({ ...fakeProductionValues(), UNKNOWN_KEY: "x" }, { allowTestValues: true }),
    { code: "ENV_KEY_UNSUPPORTED" },
  );
  assert.throws(() => validateProductionValues(fakeProductionValues()), { code: "PLACEHOLDER_FORBIDDEN" });
});

test("Wrangler arguments are strict, route-free, secret-free, and Env-driven", () => {
  const configuration = validateProductionValues(fakeProductionValues({
    EMAIL_REPLY_TO: "user@example.test",
  }), { allowTestValues: true });
  const args = buildWranglerArguments(configuration, { dryRun: true });
  assert.ok(args.includes("--name"));
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
  ]) assert.match(serialized, new RegExp(`${key}:`));
  assert.doesNotMatch(serialized, /LUMINA_WEBHOOK_TOKEN|RESEND_API_KEY|WORKER_PUBLIC_BASE_URL/);
});

test("cross-platform dry-run uses an explicit fictitious Env, does not upload, and skips health", async () => {
  await withTemporaryEnv(async (envFile) => {
    let healthRequests = 0;
    const result = await runDeployment({
      dryRun: true,
      envFile,
      fetchImplementation: async () => {
        healthRequests += 1;
        throw new Error("dry-run must not issue health traffic");
      },
    });
    assert.deepEqual(result, { dryRun: true, workerName: "unit-test-worker" });
    assert.equal(healthRequests, 0);
    await assert.rejects(access(path.join(workerRoot, ".wrangler", "production-dry-run")));
  });
});

test("deployment strips runtime secrets from Wrangler environment and health-checks only production", async () => {
  await withTemporaryEnv(async (envFile) => {
    const capture = {};
    let requestedUrl;
    const previousWebhook = process.env.LUMINA_WEBHOOK_TOKEN;
    const previousResend = process.env.RESEND_API_KEY;
    process.env.LUMINA_WEBHOOK_TOKEN = "must-not-leak";
    process.env.RESEND_API_KEY = "must-not-leak";
    try {
      const result = await runDeployment({
        envFile,
        platform: "linux",
        allowTestValues: true,
        validateEnvFileImplementation: async () => {},
        spawnImplementation: successfulSpawn(capture),
        fetchImplementation: async (url) => {
          requestedUrl = url.toString();
          return {
            status: 200,
            json: async () => ({ status: "ok", service: "lumina-email-delivery" }),
          };
        },
      });
      assert.deepEqual(result, { dryRun: false, workerName: "unit-test-worker" });
      assert.equal(capture.options.env.LUMINA_WEBHOOK_TOKEN, undefined);
      assert.equal(capture.options.env.RESEND_API_KEY, undefined);
      assert.doesNotMatch(capture.args.join("\n"), /LUMINA_WEBHOOK_TOKEN|RESEND_API_KEY/);
      assert.equal(requestedUrl, "https://worker.example.invalid/health-test");
    } finally {
      if (previousWebhook === undefined) delete process.env.LUMINA_WEBHOOK_TOKEN;
      else process.env.LUMINA_WEBHOOK_TOKEN = previousWebhook;
      if (previousResend === undefined) delete process.env.RESEND_API_KEY;
      else process.env.RESEND_API_KEY = previousResend;
    }
  });
});

test("failed Wrangler output redacts every deployment identifier", async () => {
  await withTemporaryEnv(async (envFile) => {
    const values = fakeProductionValues();
    const exposed = Object.values(values).filter(Boolean).join(" ");
    await assert.rejects(
      runDeployment({
        dryRun: true,
        envFile,
        spawnImplementation: failingSpawn(exposed),
      }),
      (error) => {
        assert.match(error.message, /^WRANGLER_FAILED/);
        for (const value of Object.values(values).filter(Boolean)) {
          assert.equal(error.message.includes(value), false);
        }
        return true;
      },
    );
  });
});

test("server template is empty and excludes runtime secrets", async () => {
  const template = await readFile(path.join(repositoryRoot, "deploy", "email-worker-deploy.env.example"), "utf8");
  const assignments = template.split(/\r?\n/).filter((line) => /^[A-Z][A-Z0-9_]*=/.test(line));
  assert.equal(assignments.length, 10);
  assert.ok(assignments.every((line) => line.endsWith("=")));
  assert.doesNotMatch(template, /LUMINA_WEBHOOK_TOKEN|RESEND_API_KEY|example\.com/);
});

test("tracked contracts preserve the Windows-development and Ubuntu-production boundary", async () => {
  const { stdout } = await execFileAsync("git", ["ls-files", "-z"], {
    cwd: repositoryRoot,
    encoding: "buffer",
    maxBuffer: 10 * 1024 * 1024,
  });
  const files = stdout.toString("utf8").split("\0").filter(Boolean);
  const retiredLocalName = [".env", "production", "local"].join(".");
  const violations = [];
  for (const file of files) {
    const contents = await readFile(path.join(repositoryRoot, file));
    if (contents.includes(Buffer.from(retiredLocalName))) violations.push(file);
  }
  assert.deepEqual(violations, []);

  const contractFiles = [
    "README.md",
    "docs/DEPLOYMENT.md",
    "docs/IMPLEMENTATION_STATUS.md",
    "infrastructure/email-delivery-worker/README.md",
  ];
  const contracts = (await Promise.all(contractFiles.map((file) => readFile(
    path.join(repositoryRoot, file),
    "utf8",
  )))).join("\n");
  assert.match(contracts, /Windows[^\n]*development|Windows[^\n]*开发/i);
  assert.match(contracts, /Ubuntu[^\n]*production|Ubuntu[^\n]*生产/i);
  assert.match(contracts, /\/etc\/lumina-crm\/secrets\/email-worker-deploy\.env/);
  assert.doesNotMatch(contracts, /```powershell[\s\S]{0,500}deploy:production/i);
});

test("tracked public tree and Wrangler config contain no production identifiers", async () => {
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

  const wrangler = await readFile(path.join(workerRoot, "wrangler.toml"), "utf8");
  assert.doesNotMatch(wrangler, /^\s*(?:name|route|routes|vars|account_id)\s*=/m);
  assert.doesNotMatch(wrangler, /https:\/\/|@/);
});
