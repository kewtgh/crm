import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import {
  acceptActiveDeployment,
  buildProductionWranglerConfig,
  buildWranglerArguments,
  buildWranglerVersionListArguments,
  createTemporaryWranglerConfig,
  DEFAULT_PRODUCTION_CONFIG_ROOT,
  DEFAULT_PRODUCTION_ENV_FILE,
  formatControllerFailure,
  identifyUploadedVersion,
  loadProductionValues,
  parseArguments,
  persistDeploymentEvidence,
  preflightCustomDomain,
  ProductionConfigurationError,
  queryActiveDeployment,
  queryWorkerVersions,
  removeTemporaryWranglerConfig,
  resolveSourceProvenance,
  runDeployment,
  validateProductionConfigRoot,
  validateProductionEnvFile,
  validateProductionValues,
} from "../scripts/deploy-production.mjs";

const execFileAsync = promisify(execFile);
const workerRoot = fileURLToPath(new URL("..", import.meta.url));
const repositoryRoot = path.resolve(workerRoot, "..", "..");
const SOURCE_COMMIT = "0123456789abcdef0123456789abcdef01234567";
const OLD_VERSION_ID = "11111111-1111-4111-8111-111111111111";
const UPLOADED_VERSION_ID = "22222222-2222-4222-8222-222222222222";
const DEPLOYMENT_ID = "33333333-3333-4333-8333-333333333333";
const DEPLOYMENT_TIMESTAMP = "2026-08-10T08:00:00.000Z";

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

function validatedValues(overrides = {}) {
  return validateProductionValues(fakeProductionValues(overrides), { allowTestValues: true });
}

function fakeDomain(overrides = {}) {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    hostname: "worker.example.invalid",
    service: "unit-test-worker",
    zone_name: "example.invalid",
    ...overrides,
  };
}

function fakeVersion({
  id = UPLOADED_VERSION_ID,
  sourceCommit = SOURCE_COMMIT,
  createdOn = DEPLOYMENT_TIMESTAMP,
} = {}) {
  return {
    id,
    metadata: { created_on: createdOn },
    annotations: {
      "workers/tag": sourceCommit,
      "workers/message": sourceCommit,
    },
  };
}

function fakeDeployment({
  id = DEPLOYMENT_ID,
  versions = [{ version_id: UPLOADED_VERSION_ID, percentage: 100 }],
  createdOn = DEPLOYMENT_TIMESTAMP,
} = {}) {
  return { id, versions, created_on: createdOn };
}

function asEnvFile(values) {
  return Object.entries(values).map(([key, value]) => `${key}=${value}`).join("\n");
}

async function withTemporaryEnv(callback, values = fakeProductionValues()) {
  const directory = await mkdtemp(path.join(tmpdir(), "email-worker-test-"));
  const envFile = path.join(directory, "worker-fixture.env");
  await writeFile(envFile, asEnvFile(values), "utf8");
  try {
    return await callback(envFile, directory);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
}

function jsonResponse(status, payload) {
  return { status, json: async () => payload };
}

function domainAndHealthFetch({
  domains = [fakeDomain()],
  status = 200,
  payload,
  invalidJson = false,
  healthStatus = 200,
  scriptVersions = [{
    id: UPLOADED_VERSION_ID,
    metadata: { created_on: DEPLOYMENT_TIMESTAMP },
    number: 2,
  }],
  deployments = [fakeDeployment(), fakeDeployment()],
  deploymentStatus = 200,
  deploymentInvalidJson = false,
  capture = {},
} = {}) {
  return async (input, options = {}) => {
    const url = new URL(input);
    capture.requests ??= [];
    capture.requests.push({ options, url: url.toString() });
    if (url.hostname === "api.cloudflare.com") {
      if (url.pathname.endsWith("/versions")) {
        capture.scriptVersionApiRequests = (capture.scriptVersionApiRequests ?? 0) + 1;
        return jsonResponse(deploymentStatus, {
          success: true,
          result: { items: scriptVersions },
        });
      }
      if (url.pathname.endsWith("/deployments")) {
        capture.events ??= [];
        capture.events.push("deployment");
        const index = capture.deploymentQueries ?? 0;
        capture.deploymentQueries = index + 1;
        if (deploymentInvalidJson) {
          return { status: deploymentStatus, json: async () => { throw new Error("invalid"); } };
        }
        const deployment = deployments[Math.min(index, deployments.length - 1)];
        return jsonResponse(deploymentStatus, {
          success: true,
          result: { deployments: deployment ? [deployment] : [] },
        });
      }
      if (invalidJson) return { status, json: async () => { throw new Error("invalid"); } };
      if (payload !== undefined) return jsonResponse(status, payload);
      let result = domains;
      if (url.searchParams.has("hostname")) {
        result = result.filter((domain) => domain.hostname === url.searchParams.get("hostname"));
      }
      if (url.searchParams.has("service")) {
        result = result.filter((domain) => domain.service === url.searchParams.get("service"));
      }
      return jsonResponse(status, {
        success: true,
        errors: [],
        messages: [],
        result,
        result_info: { total_count: result.length },
      });
    }
    capture.events ??= [];
    capture.events.push("health");
    capture.healthRequests = (capture.healthRequests ?? 0) + 1;
    return {
      status: healthStatus,
      json: async () => ({ status: "ok", service: "lumina-email-delivery" }),
    };
  };
}

function successfulSpawn(capture = {}, {
  versionsBefore = [fakeVersion({ id: OLD_VERSION_ID, sourceCommit: "a".repeat(40) })],
  versionsAfter = [
    fakeVersion({ id: OLD_VERSION_ID, sourceCommit: "a".repeat(40) }),
    fakeVersion(),
  ],
} = {}) {
  return (command, args, options) => {
    capture.wranglerCalls ??= [];
    capture.wranglerCalls.push({ args, command, options });
    const versionList = args[1] === "versions" && args[2] === "list";
    let stdout = "";
    if (versionList) {
      const queryIndex = capture.versionQueries ?? 0;
      capture.versionQueries = queryIndex + 1;
      stdout = JSON.stringify(queryIndex === 0 ? versionsBefore : versionsAfter);
    } else {
      capture.command = command;
      capture.args = args;
      capture.options = options;
    }
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => {};
    queueMicrotask(() => {
      if (stdout) child.stdout.write(stdout);
      child.emit("close", 0);
    });
    return child;
  };
}

function failingSpawn(output = "safe Wrangler failure detail") {
  const versionListSpawn = successfulSpawn({});
  return (command, args, options) => {
    if (args[1] === "versions" && args[2] === "list") {
      return versionListSpawn(command, args, options);
    }
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

function erroringSpawn() {
  const versionListSpawn = successfulSpawn({});
  return (command, args, options) => {
    if (args[1] === "versions" && args[2] === "list") {
      return versionListSpawn(command, args, options);
    }
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => {};
    queueMicrotask(() => child.emit("error", new Error("spawn failed")));
    return child;
  };
}

function fileStatus({
  symlink = false,
  file = true,
  directory = false,
  uid = 0,
  gid = 4242,
  mode = 0o640,
} = {}) {
  return {
    uid,
    gid,
    mode,
    isDirectory: () => directory,
    isSymbolicLink: () => symlink,
    isFile: () => file,
  };
}

const secureEnvFileOptions = {
  lstatImplementation: async () => fileStatus(),
  statImplementation: async () => ({ mode: 0o750, isDirectory: () => true }),
  readFileImplementation: async () => "lumina-crm:x:4242:\n",
};

function temporaryHarness(capture = {}) {
  return {
    createTemporaryConfigImplementation: async (configuration, customDomain, { runtimeRoot }) => {
      capture.created = (capture.created ?? 0) + 1;
      capture.generated = buildProductionWranglerConfig(configuration, customDomain);
      return {
        configPath: path.join(runtimeRoot, "wrangler-random", "wrangler.production.json"),
        directory: path.join(runtimeRoot, "wrangler-random"),
        dryRunOutputDirectory: path.join(runtimeRoot, "wrangler-random", "dry-run-output"),
        runtimeRoot,
      };
    },
    removeTemporaryConfigImplementation: async () => {
      capture.cleaned = (capture.cleaned ?? 0) + 1;
    },
  };
}

async function runFixture(envFile, {
  capture = {},
  dryRun = false,
  fetchImplementation = domainAndHealthFetch({ capture }),
  spawnImplementation = successfulSpawn(capture),
  ...overrides
} = {}) {
  return runDeployment({
    dryRun,
    envFile,
    runtimeRoot: path.join(tmpdir(), "fictitious-email-worker-runtime"),
    platform: "linux",
    allowTestValues: true,
    fetchImplementation,
    spawnImplementation,
    validateEnvFileImplementation: async () => {},
    resolveSourceProvenanceImplementation: async () => {
      capture.sourceChecks = (capture.sourceChecks ?? 0) + 1;
      return { sourceCommit: SOURCE_COMMIT };
    },
    persistDeploymentEvidenceImplementation: async (evidence) => {
      capture.persistedEvidence = evidence;
    },
    ...temporaryHarness(capture),
    ...overrides,
  });
}

test("all production controller modes are Linux-only before Env, API, temp config, or Wrangler", async () => {
  for (const dryRun of [false, true]) {
    const calls = { env: 0, preflight: 0, temporary: 0, wrangler: 0 };
    await assert.rejects(runDeployment({
      dryRun,
      platform: "win32",
      validateEnvFileImplementation: async () => { calls.env += 1; },
      preflightCustomDomainImplementation: async () => { calls.preflight += 1; },
      createTemporaryConfigImplementation: async () => { calls.temporary += 1; },
      spawnImplementation: () => { calls.wrangler += 1; },
    }), { code: "PRODUCTION_DEPLOY_REQUIRES_LINUX" });
    assert.deepEqual(calls, { env: 0, preflight: 0, temporary: 0, wrangler: 0 });
  }
});

test("production and dry-run use only the fixed Ubuntu Env path", () => {
  assert.equal(DEFAULT_PRODUCTION_ENV_FILE, "/etc/lumina-crm/secrets/email-worker-deploy.env");
  assert.equal(DEFAULT_PRODUCTION_CONFIG_ROOT, "/var/lib/lumina-crm/email-worker-deployments");
  assert.deepEqual(parseArguments([]), { dryRun: false, envFile: DEFAULT_PRODUCTION_ENV_FILE });
  assert.deepEqual(parseArguments(["--dry-run"]), {
    dryRun: true,
    envFile: DEFAULT_PRODUCTION_ENV_FILE,
  });
  assert.throws(() => parseArguments(["--env-file", "fixture.env"]), { code: "ARGUMENT_UNSUPPORTED" });
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
      await assert.rejects(validateProductionEnvFile(DEFAULT_PRODUCTION_ENV_FILE, {
        ...secureEnvFileOptions,
        lstatImplementation: async () => fileStatus(overrides),
      }), { code });
    });
  }
  await t.test("world-readable parent", async () => {
    await assert.rejects(validateProductionEnvFile(DEFAULT_PRODUCTION_ENV_FILE, {
      ...secureEnvFileOptions,
      statImplementation: async () => ({ mode: 0o754, isDirectory: () => true }),
    }), { code: "PRODUCTION_ENV_DIRECTORY_WORLD_READABLE" });
  });
  await validateProductionEnvFile(DEFAULT_PRODUCTION_ENV_FILE, secureEnvFileOptions);
});

test("production Env rejects invalid or unsafe Custom Domain origins", async (t) => {
  const cases = [
    "https://worker.example.invalid/path",
    "https://worker.example.invalid?query=yes",
    "https://worker.example.invalid#fragment",
    "https://user:password@worker.example.invalid",
    "https://*.example.invalid",
    "https://localhost",
    "https://127.0.0.1",
    "https://worker.example.invalid:8443",
  ];
  for (const value of cases) {
    await t.test(value, () => {
      assert.throws(
        () => validateProductionValues(fakeProductionValues({ WORKER_PUBLIC_BASE_URL: value }), {
          allowTestValues: true,
        }),
        ProductionConfigurationError,
      );
    });
  }
  assert.throws(
    () => validateProductionValues(fakeProductionValues()),
    { code: "WORKER_PUBLIC_HOSTNAME_INVALID" },
  );
});

test("generated production JSON contains the complete strict comparison surface", () => {
  const configuration = validatedValues({ EMAIL_REPLY_TO: "reply@example.test" });
  const generated = buildProductionWranglerConfig(configuration, {
    hostname: "worker.example.invalid",
    zoneName: "example.invalid",
  });
  assert.equal(generated.name, "unit-test-worker");
  assert.equal(path.resolve(generated.main), path.join(workerRoot, "src", "index.js"));
  assert.equal(generated.compatibility_date, "2026-07-27");
  assert.equal(generated.workers_dev, false);
  assert.equal(generated.preview_urls, false);
  assert.equal(generated.keep_vars, true);
  assert.deepEqual(generated.routes, [{
    pattern: "worker.example.invalid",
    zone_name: "example.invalid",
    custom_domain: true,
    enabled: true,
    previews_enabled: false,
  }]);
  assert.deepEqual(generated.vars, {
    CRM_APP_URL: "https://crm.example.invalid/",
    EMAIL_FROM: "Test Mail <user@example.test>",
    EMAIL_BRAND_NAME: "Fictitious Test Brand",
    DELIVERY_PATH: "/delivery-test",
    HEALTH_PATH: "/health-test",
    EMAIL_REPLY_TO: "reply@example.test",
  });
  assert.deepEqual(generated.observability, {
    enabled: true,
    head_sampling_rate: 1,
    logs: {
      enabled: true,
      head_sampling_rate: 1,
      persist: true,
      invocation_logs: true,
    },
    traces: { enabled: false, head_sampling_rate: 1, persist: true },
  });
  assert.deepEqual(generated.secrets.required, ["LUMINA_WEBHOOK_TOKEN", "RESEND_API_KEY"]);
});

test("optional reply-to is absent when empty and no credential value enters generated JSON", () => {
  const configuration = validatedValues();
  const serialized = JSON.stringify(buildProductionWranglerConfig(configuration, {
    hostname: "worker.example.invalid",
    zoneName: "example.invalid",
  }));
  assert.equal(Object.hasOwn(JSON.parse(serialized).vars, "EMAIL_REPLY_TO"), false);
  for (const forbidden of [
    configuration.CLOUDFLARE_ACCOUNT_ID,
    configuration.CLOUDFLARE_API_TOKEN,
    "fictitious-webhook-secret",
    "fictitious-resend-secret",
    "DATABASE_URL",
    "R2_ACCESS_KEY",
    "EMAIL_DELIVERY_WEBHOOK_TOKEN",
  ]) assert.equal(serialized.includes(forbidden), false);
});

test("Wrangler arguments use only the temporary config and strict deployment surface", () => {
  const temporaryConfig = {
    configPath: path.join(tmpdir(), "runtime", "wrangler.production.json"),
    dryRunOutputDirectory: path.join(tmpdir(), "runtime", "dry-run-output"),
  };
  const productionArgs = buildWranglerArguments(temporaryConfig, { sourceCommit: SOURCE_COMMIT });
  const dryRunArgs = buildWranglerArguments(temporaryConfig, {
    dryRun: true,
    sourceCommit: SOURCE_COMMIT,
  });
  const versionListArgs = buildWranglerVersionListArguments(temporaryConfig);
  for (const args of [productionArgs, dryRunArgs]) {
    assert.ok(args.includes("--strict"));
    assert.equal(args[args.indexOf("--config") + 1], temporaryConfig.configPath);
    assert.equal(args[args.indexOf("--tag") + 1], SOURCE_COMMIT);
    assert.equal(args[args.indexOf("--message") + 1], SOURCE_COMMIT);
    assert.doesNotMatch(
      args.join("\n"),
      /--name|--var|--route|--domain|--keep-vars|\bsecret\b|\bdelete\b|\bbulk\b/i,
    );
  }
  assert.ok(dryRunArgs.includes("--dry-run"));
  assert.equal(dryRunArgs[dryRunArgs.indexOf("--outdir") + 1], temporaryConfig.dryRunOutputDirectory);
  assert.equal(productionArgs.includes("--dry-run"), false);
  assert.deepEqual(versionListArgs.slice(1), [
    "versions",
    "list",
    "--config",
    temporaryConfig.configPath,
    "--json",
  ]);
});

test("runtime root is a real 0700 directory owned by the lumina-crm execution user", async (t) => {
  const root = path.join(path.parse(process.cwd()).root, "var", "lib", "lumina-test-runtime");
  const options = {
    expectedUid: 1001,
    readFileImplementation: async () => "lumina-crm:x:1001:1001::/var/lib/lumina-crm:/bin/bash\n",
  };
  await validateProductionConfigRoot(root, {
    ...options,
    lstatImplementation: async () => fileStatus({ directory: true, file: false, uid: 1001, mode: 0o700 }),
  });
  const cases = [
    [{ symlink: true, directory: true, file: false, uid: 1001, mode: 0o700 }, "PRODUCTION_CONFIG_ROOT_SYMLINK_FORBIDDEN"],
    [{ directory: false, file: true, uid: 1001, mode: 0o700 }, "PRODUCTION_CONFIG_ROOT_NOT_DIRECTORY"],
    [{ directory: true, file: false, uid: 1002, mode: 0o700 }, "PRODUCTION_CONFIG_ROOT_OWNER_INVALID"],
    [{ directory: true, file: false, uid: 1001, mode: 0o750 }, "PRODUCTION_CONFIG_ROOT_MODE_INVALID"],
  ];
  for (const [status, code] of cases) {
    await t.test(code, async () => {
      await assert.rejects(validateProductionConfigRoot(root, {
        ...options,
        lstatImplementation: async () => fileStatus(status),
      }), { code });
    });
  }
  await assert.rejects(validateProductionConfigRoot(root, {
    ...options,
    expectedUid: 1002,
    lstatImplementation: async () => fileStatus({ directory: true, file: false, uid: 1001, mode: 0o700 }),
  }), { code: "PRODUCTION_RUNTIME_USER_INVALID" });
});

test("temporary JSON directory is 0700, file is 0600, owner is lumina-crm, and name is unpredictable", async () => {
  const root = path.join(path.parse(process.cwd()).root, "var", "lib", "lumina-test-runtime");
  const directory = path.join(root, "wrangler-r4nd0m");
  const chmodCalls = [];
  let written;
  const result = await createTemporaryWranglerConfig(validatedValues(), {
    hostname: "worker.example.invalid",
    zoneName: "example.invalid",
  }, {
    runtimeRoot: root,
    expectedUid: 1001,
    readFileImplementation: async () => "lumina-crm:x:1001:1001::/var/lib/lumina-crm:/bin/bash\n",
    mkdtempImplementation: async (prefix) => {
      assert.equal(prefix, path.join(root, "wrangler-"));
      return directory;
    },
    chmodImplementation: async (target, mode) => { chmodCalls.push([target, mode]); },
    writeFileImplementation: async (target, contents, options) => { written = { target, contents, options }; },
    lstatImplementation: async (target) => {
      if (target === root) return fileStatus({ directory: true, file: false, uid: 1001, mode: 0o700 });
      if (target === directory) return fileStatus({ directory: true, file: false, uid: 1001, mode: 0o700 });
      return fileStatus({ directory: false, file: true, uid: 1001, mode: 0o600 });
    },
  });
  assert.equal(result.directory, directory);
  assert.equal(path.dirname(result.configPath), directory);
  assert.deepEqual(chmodCalls, [[directory, 0o700], [result.configPath, 0o600]]);
  assert.equal(written.target, result.configPath);
  assert.deepEqual(written.options, { encoding: "utf8", flag: "wx", mode: 0o600 });
  assert.equal(JSON.parse(written.contents).name, "unit-test-worker");
});

test("temporary config rejects symlinks and removes every partially created directory", async (t) => {
  const root = path.join(path.parse(process.cwd()).root, "var", "lib", "lumina-test-runtime");
  const directory = path.join(root, "wrangler-r4nd0m");
  for (const [kind, code] of [
    ["directory", "TEMP_CONFIG_DIRECTORY_SYMLINK_FORBIDDEN"],
    ["file", "TEMP_CONFIG_FILE_SYMLINK_FORBIDDEN"],
  ]) {
    await t.test(kind, async () => {
      const removed = [];
      await assert.rejects(createTemporaryWranglerConfig(validatedValues(), {
        hostname: "worker.example.invalid",
        zoneName: "example.invalid",
      }, {
        runtimeRoot: root,
        expectedUid: 1001,
        readFileImplementation: async () => "lumina-crm:x:1001:1001::/var/lib/lumina-crm:/bin/bash\n",
        mkdtempImplementation: async () => directory,
        chmodImplementation: async () => {},
        writeFileImplementation: async () => {},
        rmImplementation: async (target) => { removed.push(target); },
        lstatImplementation: async (target) => {
          if (target === root) return fileStatus({ directory: true, file: false, uid: 1001, mode: 0o700 });
          if (target === directory) return fileStatus({
            directory: true,
            file: false,
            uid: 1001,
            mode: 0o700,
            symlink: kind === "directory",
          });
          return fileStatus({ file: true, uid: 1001, mode: 0o600, symlink: kind === "file" });
        },
      }), { code });
      assert.deepEqual(removed, [directory]);
    });
  }
});

test("temporary cleanup only recursively removes a direct unpredictable runtime child", async () => {
  const root = path.join(path.parse(process.cwd()).root, "var", "lib", "lumina-test-runtime");
  const directory = path.join(root, "wrangler-r4nd0m");
  const calls = [];
  await removeTemporaryWranglerConfig({ runtimeRoot: root, directory }, {
    rmImplementation: async (...args) => { calls.push(args); },
  });
  assert.deepEqual(calls, [[directory, { force: true, recursive: true }]]);
  await assert.rejects(removeTemporaryWranglerConfig({
    runtimeRoot: root,
    directory: path.dirname(root),
  }), { code: "TEMP_CONFIG_CLEANUP_TARGET_INVALID" });
});

test("Custom Domain preflight requires an exact hostname and sole target Worker association", async () => {
  const capture = {};
  const result = await preflightCustomDomain(validatedValues(), domainAndHealthFetch({ capture }));
  assert.deepEqual(result, { hostname: "worker.example.invalid", zoneName: "example.invalid" });
  assert.equal(capture.requests.length, 2);
  assert.match(capture.requests[0].url, /hostname=worker\.example\.invalid/);
  assert.match(capture.requests[1].url, /service=unit-test-worker/);
  for (const request of capture.requests) {
    assert.equal(request.options.method, "GET");
    assert.equal(request.options.headers.Authorization, "Bearer fictitious-test-token-00000000");
  }
});

test("Custom Domain preflight fails closed for missing, foreign, or additional domains", async (t) => {
  const cases = [
    ["missing", [], "CUSTOM_DOMAIN_NOT_FOUND"],
    ["foreign", [fakeDomain({ service: "other-test-worker" })], "CUSTOM_DOMAIN_OWNERSHIP_MISMATCH"],
    ["additional", [fakeDomain(), fakeDomain({ hostname: "extra.example.invalid" })], "CUSTOM_DOMAIN_SET_MISMATCH"],
  ];
  for (const [name, domains, code] of cases) {
    await t.test(name, async () => {
      await assert.rejects(preflightCustomDomain(
        validatedValues(),
        domainAndHealthFetch({ domains }),
      ), { code });
    });
  }
});

test("Custom Domain preflight rejects API failure, invalid JSON, and invalid contracts", async (t) => {
  const cases = [
    ["non-200", domainAndHealthFetch({ status: 503 }), "CUSTOM_DOMAIN_PREFLIGHT_UNAVAILABLE"],
    ["invalid JSON", domainAndHealthFetch({ invalidJson: true }), "CUSTOM_DOMAIN_PREFLIGHT_INVALID_RESPONSE"],
    ["invalid contract", domainAndHealthFetch({ payload: { success: true, result: [{}] } }), "CUSTOM_DOMAIN_PREFLIGHT_INVALID_RESPONSE"],
  ];
  for (const [name, fetchImplementation, code] of cases) {
    await t.test(name, async () => {
      await assert.rejects(preflightCustomDomain(validatedValues(), fetchImplementation), { code });
    });
  }
});

test("annotation-free Scripts Versions API cannot break Wrangler JSON provenance or dry-run", async () => {
  await withTemporaryEnv(async (envFile) => {
    const generated = [];
    for (const dryRun of [false, true]) {
      const capture = {};
      const result = await runFixture(envFile, { capture, dryRun });
      if (dryRun) {
        assert.deepEqual(result, { dryRun, workerName: "unit-test-worker" });
        assert.equal(capture.persistedEvidence, undefined);
        assert.equal(capture.versionQueries ?? 0, 0);
        assert.equal(capture.deploymentQueries ?? 0, 0);
      } else {
        assert.deepEqual(result, {
          dryRun,
          workerName: "unit-test-worker",
          deploymentEvidence: {
            workerVersionId: UPLOADED_VERSION_ID,
            deploymentId: DEPLOYMENT_ID,
            trafficPercentage: 100,
            sourceCommit: SOURCE_COMMIT,
            deploymentTimestamp: DEPLOYMENT_TIMESTAMP,
          },
        });
        assert.deepEqual(capture.persistedEvidence, result.deploymentEvidence);
        assert.equal(capture.versionQueries, 2);
        assert.equal(capture.scriptVersionApiRequests ?? 0, 0);
        assert.equal(capture.deploymentQueries, 2);
        assert.equal(
          capture.requests.filter((request) => new URL(request.url).pathname.endsWith("/workers/domains")).length,
          4,
        );
      }
      assert.equal(capture.created, 1);
      assert.equal(capture.cleaned, 1);
      assert.equal(capture.generated.preview_urls, false);
      generated.push(capture.generated);
      if (dryRun) assert.equal(capture.healthRequests ?? 0, 0);
      else {
        assert.equal(capture.healthRequests, 1);
        assert.ok(capture.events.indexOf("deployment") < capture.events.indexOf("health"));
        assert.ok(capture.events.lastIndexOf("deployment") > capture.events.indexOf("health"));
      }
    }
    assert.deepEqual(generated[0], generated[1]);
  });
});

test("source provenance requires an exact clean 40-character commit", async (t) => {
  await t.test("clean source", async () => {
    const calls = [];
    const result = await resolveSourceProvenance({
      execFileImplementation: async (command, args, options) => {
        calls.push({ args, command, options });
        return { stdout: args[0] === "rev-parse" ? `${SOURCE_COMMIT}\n` : "" };
      },
    });
    assert.deepEqual(result, { sourceCommit: SOURCE_COMMIT });
    assert.equal(calls.length, 2);
  });
  await t.test("dirty source", async () => {
    await assert.rejects(resolveSourceProvenance({
      execFileImplementation: async (command, args) => ({
        stdout: args[0] === "rev-parse" ? SOURCE_COMMIT : " M src/index.js\n",
      }),
    }), { code: "SOURCE_WORKTREE_DIRTY" });
  });
  await t.test("invalid commit", async () => {
    await assert.rejects(resolveSourceProvenance({
      execFileImplementation: async (command, args) => ({
        stdout: args[0] === "rev-parse" ? "short" : "",
      }),
    }), { code: "SOURCE_COMMIT_INVALID" });
  });
});

test("dirty or changing source never produces false deployment evidence", async (t) => {
  await withTemporaryEnv(async (envFile) => {
    await t.test("dirty before upload", async () => {
      const capture = {};
      await assert.rejects(runFixture(envFile, {
        capture,
        resolveSourceProvenanceImplementation: async () => {
          throw new ProductionConfigurationError("SOURCE_WORKTREE_DIRTY");
        },
      }), { code: "SOURCE_WORKTREE_DIRTY" });
      assert.equal(capture.wranglerCalls, undefined);
      assert.equal(capture.persistedEvidence, undefined);
    });

    await t.test("source changes while Wrangler deploy runs", async () => {
      const capture = {};
      let sourceChecks = 0;
      let rejected;
      try {
        await runFixture(envFile, {
          capture,
          resolveSourceProvenanceImplementation: async () => {
            sourceChecks += 1;
            return {
              sourceCommit: sourceChecks < 3 ? SOURCE_COMMIT : "a".repeat(40),
            };
          },
        });
      } catch (error) {
        rejected = error;
      }
      assert.equal(rejected?.code, "SOURCE_CHANGED_DURING_DEPLOYMENT");
      assert.equal(sourceChecks, 3);
      assert.equal(capture.args[1], "deploy");
      assert.equal(capture.persistedEvidence, undefined);
      assert.match(
        formatControllerFailure(rejected),
        /CONTROL_PLANE_STATE=UPLOAD_SUCCEEDED_BUT_PROVENANCE_UNVERIFIED/,
      );
    });
  });
});

test("uploaded Worker Version provenance requires one new Wrangler JSON version", async (t) => {
  const before = [fakeVersion({ id: OLD_VERSION_ID, sourceCommit: "a".repeat(40) })];
  const uploaded = fakeVersion();
  assert.equal(identifyUploadedVersion(before, [...before, uploaded], SOURCE_COMMIT), uploaded);
  const unavailableCases = [
    ["tag mismatch", fakeVersion({ sourceCommit: "b".repeat(40) })],
    ["message mismatch", {
      ...uploaded,
      annotations: { ...uploaded.annotations, "workers/message": "b".repeat(40) },
    }],
    ["missing tag", {
      ...uploaded,
      annotations: { "workers/message": SOURCE_COMMIT },
    }],
    ["missing message", {
      ...uploaded,
      annotations: { "workers/tag": SOURCE_COMMIT },
    }],
  ];
  for (const [name, candidate] of unavailableCases) {
    await t.test(name, () => {
      assert.throws(
        () => identifyUploadedVersion(before, [...before, candidate], SOURCE_COMMIT),
        { code: "WORKER_VERSION_PROVENANCE_UNAVAILABLE" },
      );
    });
  }
  await t.test("multiple new versions", () => {
    assert.throws(() => identifyUploadedVersion(before, [
      ...before,
      uploaded,
      fakeVersion({ id: "44444444-4444-4444-8444-444444444444" }),
    ], SOURCE_COMMIT), { code: "WORKER_VERSION_PROVENANCE_AMBIGUOUS" });
  });
});

test("post-upload provenance failures report control-plane split without implying runtime rollback", async (t) => {
  await withTemporaryEnv(async (envFile) => {
    const cases = [
      [
        "unavailable",
        [
          fakeVersion({ id: OLD_VERSION_ID, sourceCommit: "a".repeat(40) }),
          fakeVersion({ sourceCommit: "b".repeat(40) }),
        ],
        "WORKER_VERSION_PROVENANCE_UNAVAILABLE",
      ],
      [
        "ambiguous",
        [
          fakeVersion({ id: OLD_VERSION_ID, sourceCommit: "a".repeat(40) }),
          fakeVersion(),
          fakeVersion({ id: "44444444-4444-4444-8444-444444444444" }),
        ],
        "WORKER_VERSION_PROVENANCE_AMBIGUOUS",
      ],
    ];
    for (const [name, versionsAfter, code] of cases) {
      await t.test(name, async () => {
        const capture = {};
        let rejected;
        try {
          await runFixture(envFile, {
            capture,
            spawnImplementation: successfulSpawn(capture, { versionsAfter }),
          });
        } catch (error) {
          rejected = error;
        }
        assert.equal(rejected?.code, code);
        assert.equal(capture.deploymentQueries ?? 0, 0);
        assert.equal(capture.healthRequests ?? 0, 0);
        assert.equal(capture.persistedEvidence, undefined);
        assert.equal(formatControllerFailure(rejected),
          `Worker production controller failed: ${code}\n`
          + "CONTROL_PLANE_STATE=UPLOAD_SUCCEEDED_BUT_PROVENANCE_UNVERIFIED\n"
          + "WORKER_UPLOAD_COMPLETED=yes\n"
          + "WORKER_VERSION_ID=unknown\n"
          + "ACTIVE_DEPLOYMENT_VERIFIED=no\n"
          + "EVIDENCE_PERSISTED=no\n");
      });
    }
  });
});

test("active deployment requires exactly the uploaded version at 100 percent", async (t) => {
  const accepted = acceptActiveDeployment(fakeDeployment(), UPLOADED_VERSION_ID);
  assert.deepEqual(accepted, {
    workerVersionId: UPLOADED_VERSION_ID,
    deploymentId: DEPLOYMENT_ID,
    trafficPercentage: 100,
    deploymentTimestamp: DEPLOYMENT_TIMESTAMP,
  });

  const mismatches = [
    ["old version active", [{ version_id: OLD_VERSION_ID, percentage: 100 }]],
    ["uploaded version at zero", [{ version_id: UPLOADED_VERSION_ID, percentage: 0 }]],
    ["uploaded version at fifty", [{ version_id: UPLOADED_VERSION_ID, percentage: 50 }]],
  ];
  for (const [name, versions] of mismatches) {
    await t.test(name, () => {
      assert.throws(
        () => acceptActiveDeployment(fakeDeployment({ versions }), UPLOADED_VERSION_ID),
        { code: "WORKER_ACTIVE_VERSION_MISMATCH" },
      );
    });
  }
  await t.test("two-version traffic split", () => {
    assert.throws(() => acceptActiveDeployment(fakeDeployment({
      versions: [
        { version_id: UPLOADED_VERSION_ID, percentage: 50 },
        { version_id: OLD_VERSION_ID, percentage: 50 },
      ],
    }), UPLOADED_VERSION_ID), { code: "WORKER_TRAFFIC_SPLIT_UNEXPECTED" });
  });
});

test("Wrangler version JSON and Deployment API are independent machine-readable proofs", async () => {
  const capture = {};
  const configuration = validatedValues();
  const fetchImplementation = domainAndHealthFetch({ capture });
  const temporaryConfig = {
    configPath: path.join(tmpdir(), "runtime", "wrangler.production.json"),
  };
  const versions = await queryWorkerVersions(configuration, temporaryConfig, {
    spawnImplementation: successfulSpawn(capture),
  });
  const deployment = await queryActiveDeployment(configuration, fetchImplementation);
  assert.equal(versions.length, 1);
  assert.deepEqual(deployment, fakeDeployment());
  assert.deepEqual(capture.wranglerCalls[0].args.slice(1), [
    "versions",
    "list",
    "--config",
    temporaryConfig.configPath,
    "--json",
  ]);
  assert.equal(capture.wranglerCalls[0].options.env.CLOUDFLARE_ACCOUNT_ID, configuration.CLOUDFLARE_ACCOUNT_ID);
  assert.equal(capture.wranglerCalls[0].options.env.CLOUDFLARE_API_TOKEN, configuration.CLOUDFLARE_API_TOKEN);
  assert.equal(capture.scriptVersionApiRequests ?? 0, 0);
  assert.match(capture.requests[0].url, /\/deployments$/);
  assert.equal(capture.requests[0].options.method, "GET");
  assert.equal(capture.requests[0].options.headers.Accept, "application/json");

  await assert.rejects(queryActiveDeployment(
    configuration,
    domainAndHealthFetch({ deploymentStatus: 503 }),
  ), { code: "WORKER_DEPLOYMENT_STATUS_UNAVAILABLE" });
  await assert.rejects(queryActiveDeployment(
    configuration,
    domainAndHealthFetch({ deploymentInvalidJson: true }),
  ), { code: "WORKER_DEPLOYMENT_STATUS_UNAVAILABLE" });
});

test("stale healthy Worker cannot satisfy active-version acceptance", async () => {
  await withTemporaryEnv(async (envFile) => {
    const capture = {};
    let rejected;
    try {
      await runFixture(envFile, {
        capture,
        fetchImplementation: domainAndHealthFetch({
          capture,
          deployments: [fakeDeployment({
            versions: [{ version_id: OLD_VERSION_ID, percentage: 100 }],
          })],
        }),
      });
    } catch (error) {
      rejected = error;
    }
    assert.equal(rejected?.code, "WORKER_ACTIVE_VERSION_MISMATCH");
    assert.equal(capture.healthRequests ?? 0, 0);
    assert.equal(capture.persistedEvidence, undefined);
    assert.match(formatControllerFailure(rejected), /CONTROL_PLANE_STATE=DEPLOYMENT_NOT_ACTIVE/);
    assert.match(formatControllerFailure(rejected), new RegExp(`WORKER_VERSION_ID=${UPLOADED_VERSION_ID}`));
  });
});

test("post-deployment Custom Domain proof must still match the intended Worker", async () => {
  await withTemporaryEnv(async (envFile) => {
    const capture = {};
    let domainChecks = 0;
    await assert.rejects(runFixture(envFile, {
      capture,
      preflightCustomDomainImplementation: async () => {
        domainChecks += 1;
        return domainChecks === 1
          ? { hostname: "worker.example.invalid", zoneName: "example.invalid" }
          : { hostname: "other.example.invalid", zoneName: "example.invalid" };
      },
    }), { code: "CUSTOM_DOMAIN_SET_MISMATCH" });
    assert.equal(domainChecks, 2);
    assert.equal(capture.healthRequests ?? 0, 0);
    assert.equal(capture.persistedEvidence, undefined);
  });
});

test("correct active version still requires strict health and final active proof", async (t) => {
  await withTemporaryEnv(async (envFile) => {
    await t.test("health failure", async () => {
      const capture = {};
      await assert.rejects(runFixture(envFile, {
        capture,
        fetchImplementation: domainAndHealthFetch({ capture, healthStatus: 503 }),
      }), { message: "HEALTH_CHECK_FAILED" });
      assert.equal(capture.deploymentQueries, 1);
      assert.equal(capture.healthRequests, 1);
      assert.equal(capture.persistedEvidence, undefined);
    });
    await t.test("version changes after health", async () => {
      const capture = {};
      await assert.rejects(runFixture(envFile, {
        capture,
        fetchImplementation: domainAndHealthFetch({
          capture,
          deployments: [
            fakeDeployment(),
            fakeDeployment({ versions: [{ version_id: OLD_VERSION_ID, percentage: 100 }] }),
          ],
        }),
      }), { code: "WORKER_ACTIVE_VERSION_MISMATCH" });
      assert.equal(capture.healthRequests, 1);
      assert.equal(capture.persistedEvidence, undefined);
    });
  });
});

test("deployment evidence persists only the bounded source-to-traffic proof", async () => {
  const runtimeRoot = await mkdtemp(path.join(tmpdir(), "email-worker-evidence-"));
  const evidence = {
    workerVersionId: UPLOADED_VERSION_ID,
    deploymentId: DEPLOYMENT_ID,
    trafficPercentage: 100,
    sourceCommit: SOURCE_COMMIT,
    deploymentTimestamp: DEPLOYMENT_TIMESTAMP,
  };
  try {
    const evidencePath = await persistDeploymentEvidence(evidence, { runtimeRoot });
    assert.equal(path.dirname(evidencePath), runtimeRoot);
    assert.deepEqual(JSON.parse(await readFile(evidencePath, "utf8")), evidence);
    assert.deepEqual(Object.keys(evidence), [
      "workerVersionId",
      "deploymentId",
      "trafficPercentage",
      "sourceCommit",
      "deploymentTimestamp",
    ]);

    const calls = {};
    await persistDeploymentEvidence(evidence, {
      runtimeRoot,
      randomUUIDImplementation: () => "55555555-5555-4555-8555-555555555555",
      writeFileImplementation: async (target, contents, options) => {
        calls.write = { contents, options, target };
      },
      chmodImplementation: async (target, mode) => {
        calls.chmod = { mode, target };
      },
      renameImplementation: async (source, target) => {
        calls.rename = { source, target };
      },
    });
    assert.equal(calls.write.options.mode, 0o600);
    assert.equal(calls.write.options.flag, "wx");
    assert.equal(calls.chmod.mode, 0o600);
    assert.equal(calls.rename.source, calls.write.target);
    assert.equal(path.basename(calls.rename.target), "last-success.json");
  } finally {
    await rm(runtimeRoot, { force: true, recursive: true });
  }
});

test("deployment state failures expose no secret or provider values", async () => {
  await withTemporaryEnv(async (envFile) => {
    const secretMarker = "must-not-appear-cloudflare-token-or-provider-value";
    let rejected;
    try {
      await runFixture(envFile, {
        fetchImplementation: async (input) => {
          const url = new URL(input);
          if (url.pathname.includes("/workers/domains")) {
            return domainAndHealthFetch()(input);
          }
          throw new Error(secretMarker);
        },
      });
    } catch (error) {
      rejected = error;
    }
    const rendered = formatControllerFailure(rejected);
    assert.equal(
      rendered,
      "Worker production controller failed: WORKER_DEPLOYMENT_STATUS_UNAVAILABLE\n"
        + "CONTROL_PLANE_STATE=ACTIVE_DEPLOYMENT_UNVERIFIED\n"
        + "WORKER_UPLOAD_COMPLETED=yes\n"
        + `WORKER_VERSION_ID=${UPLOADED_VERSION_ID}\n`
        + "ACTIVE_DEPLOYMENT_VERIFIED=no\n"
        + "EVIDENCE_PERSISTED=no\n",
    );
    assert.equal(rendered.includes(secretMarker), false);
    for (const secret of [
      fakeProductionValues().CLOUDFLARE_API_TOKEN,
      "LUMINA_WEBHOOK_TOKEN",
      "RESEND_API_KEY",
      "recipient@example.test",
    ]) {
      assert.equal(rendered.includes(secret), false);
    }
  });
});

test("Wrangler nonzero exit, spawn error, and health rejection all clean temporary config", async (t) => {
  await withTemporaryEnv(async (envFile) => {
    const cases = [
      ["Wrangler failure", failingSpawn(), domainAndHealthFetch()],
      ["spawn error", erroringSpawn(), domainAndHealthFetch()],
      ["health failure", successfulSpawn(), domainAndHealthFetch({ healthStatus: 503 })],
    ];
    for (const [name, spawnImplementation, fetchImplementation] of cases) {
      await t.test(name, async () => {
        const capture = {};
        await assert.rejects(runFixture(envFile, {
          capture,
          fetchImplementation,
          spawnImplementation,
        }));
        assert.equal(capture.created, 1);
        assert.equal(capture.cleaned, 1);
      });
    }
  });
});

test("deployment strips runtime secrets and keeps Cloudflare authentication only in process environment", async () => {
  await withTemporaryEnv(async (envFile) => {
    const capture = {};
    const previousWebhook = process.env.LUMINA_WEBHOOK_TOKEN;
    const previousResend = process.env.RESEND_API_KEY;
    process.env.LUMINA_WEBHOOK_TOKEN = "must-not-leak-webhook";
    process.env.RESEND_API_KEY = "must-not-leak-resend";
    try {
      await runFixture(envFile, { capture });
      assert.equal(capture.options.env.LUMINA_WEBHOOK_TOKEN, undefined);
      assert.equal(capture.options.env.RESEND_API_KEY, undefined);
      assert.equal(capture.options.env.CLOUDFLARE_ACCOUNT_ID, fakeProductionValues().CLOUDFLARE_ACCOUNT_ID);
      assert.equal(capture.options.env.CLOUDFLARE_API_TOKEN, fakeProductionValues().CLOUDFLARE_API_TOKEN);
      assert.doesNotMatch(capture.args.join("\n"), /LUMINA_WEBHOOK_TOKEN|RESEND_API_KEY|secret/i);
    } finally {
      if (previousWebhook === undefined) delete process.env.LUMINA_WEBHOOK_TOKEN;
      else process.env.LUMINA_WEBHOOK_TOKEN = previousWebhook;
      if (previousResend === undefined) delete process.env.RESEND_API_KEY;
      else process.env.RESEND_API_KEY = previousResend;
    }
  });
});

test("top-level Wrangler failure exposes bounded detail and redacts every generated production value", async () => {
  const fixtureValues = fakeProductionValues({ EMAIL_REPLY_TO: "reply@example.test" });
  await withTemporaryEnv(async (envFile) => {
    const values = {
      ...fixtureValues,
      CUSTOM_DOMAIN_HOSTNAME: "worker.example.invalid",
      CUSTOM_DOMAIN_ZONE_NAME: "example.invalid",
    };
    const sensitiveValues = Object.values(values).filter(Boolean);
    const encodedValues = sensitiveValues.flatMap((value) => [
      encodeURIComponent(value),
      encodeURIComponent(value).replaceAll("%20", "+"),
      encodeURIComponent(value).replaceAll("%20", "+").replace(
        /%[0-9A-F]{2}/g,
        (escape) => escape.toLowerCase(),
      ),
      encodeURI(value),
    ]);
    const exposed = [
      "x".repeat(9_000),
      ...sensitiveValues,
      ...encodedValues,
      "Wrangler strict conflict detail remains visible.",
    ].join("\n");
    let rejected;
    try {
      await runFixture(envFile, {
        spawnImplementation: failingSpawn(exposed),
      });
    } catch (error) {
      rejected = error;
    }
    const rendered = formatControllerFailure(rejected);
    assert.match(rendered, /^Worker production controller failed: WRANGLER_FAILED$/m);
    assert.match(rendered, /Wrangler strict conflict detail remains visible\./);
    assert.ok(Buffer.byteLength(rendered, "utf8") <= 8_100);
    for (const value of [...sensitiveValues, ...encodedValues]) {
      assert.equal(rendered.includes(value), false);
    }
  }, fixtureValues);
});

test("Cloudflare API failures surface only stable redacted controller codes", async () => {
  const values = validatedValues();
  let rejected;
  try {
    await preflightCustomDomain(values, async () => {
      throw new Error(Object.values(values).join(" "));
    });
  } catch (error) {
    rejected = error;
  }
  const rendered = formatControllerFailure(rejected);
  assert.equal(
    rendered,
    "Worker production controller failed: CUSTOM_DOMAIN_PREFLIGHT_UNAVAILABLE\n",
  );
  for (const value of Object.values(values).filter(Boolean)) {
    assert.equal(rendered.includes(value), false);
  }
});

test("Wrangler 4.102.0 accepts the generated JSON in no-upload strict dry-run", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "email-worker-wrangler-dry-run-"));
  try {
    const configPath = path.join(directory, "wrangler.production.json");
    const outputDirectory = path.join(directory, "output");
    const generated = buildProductionWranglerConfig(validatedValues(), {
      hostname: "worker.example.invalid",
      zoneName: "example.invalid",
    });
    await writeFile(configPath, `${JSON.stringify(generated, null, 2)}\n`, "utf8");
    const packageJsonPath = path.join(workerRoot, "node_modules", "wrangler", "package.json");
    const packageManifest = JSON.parse(await readFile(packageJsonPath, "utf8"));
    assert.equal(packageManifest.version, "4.102.0");
    const wranglerBin = path.resolve(path.dirname(packageJsonPath), packageManifest.bin.wrangler);
    await execFileAsync(process.execPath, [
      wranglerBin,
      "deploy",
      "--config",
      configPath,
      "--strict",
      "--dry-run",
      "--outdir",
      outputDirectory,
    ], { cwd: workerRoot, maxBuffer: 10 * 1024 * 1024 });
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("dry-run and cleanup leave the Git worktree unchanged", async () => {
  const before = await execFileAsync("git", ["status", "--porcelain"], { cwd: repositoryRoot });
  await withTemporaryEnv(async (envFile) => {
    await runFixture(envFile, { dryRun: true });
  });
  const after = await execFileAsync("git", ["status", "--porcelain"], { cwd: repositoryRoot });
  assert.equal(after.stdout, before.stdout);
});

test("server template is empty and excludes runtime secrets", async () => {
  const template = await readFile(path.join(repositoryRoot, "deploy", "email-worker-deploy.env.example"), "utf8");
  const assignments = template.split(/\r?\n/).filter((line) => /^[A-Z][A-Z0-9_]*=/.test(line));
  assert.equal(assignments.length, 10);
  assert.ok(assignments.every((line) => line.endsWith("=")));
  assert.doesNotMatch(template, /LUMINA_WEBHOOK_TOKEN|RESEND_API_KEY|example\.com/);
});

test("tracked contracts keep Windows development-only and Ubuntu production-only", async () => {
  const { stdout } = await execFileAsync("git", ["ls-files", "-z"], {
    cwd: repositoryRoot,
    encoding: "buffer",
    maxBuffer: 10 * 1024 * 1024,
  });
  const files = stdout.toString("utf8").split("\0").filter(Boolean);
  assert.equal(files.some((file) => /wrangler\.production\.json$/i.test(file)), false);
  assert.equal(files.some((file) => /email-worker-deploy\.env$/i.test(file)), false);

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
  assert.match(contracts, /\/var\/lib\/lumina-crm\/email-worker-deployments/);
  assert.doesNotMatch(contracts, /```powershell[\s\S]{0,500}deploy:production/i);
});

test("tracked public tree contains no production identifiers or generated production config", async () => {
  const { stdout } = await execFileAsync("git", ["ls-files", "-z"], {
    cwd: repositoryRoot,
    encoding: "buffer",
    maxBuffer: 10 * 1024 * 1024,
  });
  const files = stdout.toString("utf8").split("\0").filter(Boolean);
  const zone = ["ewaya", "com"].join(".");
  const publicUserAgent = `${["lumina", "mail", "delivery"].join("-")}/1.0`;
  const publicUserAgentPrefix = ["lumina", "mail", "delivery"].join("-");
  const prohibited = [
    ["crm-mail", zone].join("."),
    ["mail-api", zone].join("."),
    ["crm", zone].join("."),
    ["notify", zone].join("."),
    ["notifications", ["notify", zone].join(".")].join("@"),
    ["lumina", "crm", "email", "delivery"].join("-"),
  ].map((value) => Buffer.from(value));
  const violations = [];
  for (const file of files) {
    const contents = await readFile(path.join(repositoryRoot, file));
    const publicText = contents.toString("utf8").replaceAll(publicUserAgent, "");
    if (publicText.includes(publicUserAgentPrefix)
      || prohibited.some((value) => contents.includes(value))) {
      violations.push(file);
    }
  }
  assert.deepEqual(violations, []);

  const wrangler = await readFile(path.join(workerRoot, "wrangler.toml"), "utf8");
  assert.match(wrangler, /^workers_dev = false$/m);
  assert.match(wrangler, /^preview_urls = false$/m);
  assert.doesNotMatch(wrangler, /^\s*(?:name|route|routes|vars|account_id)\s*=/m);
  assert.doesNotMatch(wrangler, /https:\/\/|@/);
});
