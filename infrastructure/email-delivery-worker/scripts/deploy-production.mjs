import { spawn } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { createRequire } from "node:module";

import {
  parseHttpsUrl,
  validMailbox,
  validRoutePath,
} from "../src/config.js";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const workerDirectory = path.resolve(scriptDirectory, "..");
const defaultEnvFile = path.join(workerDirectory, ".env.production.local");
const dryRunOutputDirectory = path.join(workerDirectory, ".wrangler", "production-dry-run");
const supportedKeys = new Set([
  "WORKER_NAME",
  "WORKER_PUBLIC_BASE_URL",
  "CRM_APP_URL",
  "EMAIL_FROM",
  "EMAIL_REPLY_TO",
  "EMAIL_BRAND_NAME",
  "DELIVERY_PATH",
  "HEALTH_PATH",
  "CLOUDFLARE_ACCOUNT_ID",
  "CLOUDFLARE_API_TOKEN",
]);
const requiredKeys = [
  "WORKER_NAME",
  "WORKER_PUBLIC_BASE_URL",
  "CRM_APP_URL",
  "EMAIL_FROM",
  "EMAIL_BRAND_NAME",
  "DELIVERY_PATH",
  "HEALTH_PATH",
];
const placeholderWords = /(?:^|[._\s-])(example|placeholder|replace|change-me)(?:$|[._\s-])/i;
const require = createRequire(import.meta.url);

export class ProductionConfigurationError extends Error {
  constructor(code) {
    super(code);
    this.name = "ProductionConfigurationError";
    this.code = code;
  }
}

function fail(code) {
  throw new ProductionConfigurationError(code);
}

function placeholderHostname(hostname) {
  const normalized = hostname.toLowerCase().replace(/\.$/, "");
  return normalized === "localhost"
    || normalized === "example.com"
    || normalized.endsWith(".example.com")
    || normalized.endsWith(".example")
    || normalized.endsWith(".invalid")
    || normalized.endsWith(".test")
    || normalized === "127.0.0.1"
    || normalized === "::1";
}

function mailboxDomain(value) {
  const bracketed = value.match(/<([^<>]+)>$/);
  const address = (bracketed?.[1] ?? value).trim();
  return address.slice(address.lastIndexOf("@") + 1);
}

function validateAuthentication(values) {
  if (values.CLOUDFLARE_ACCOUNT_ID
    && !/^[a-f0-9]{32}$/i.test(values.CLOUDFLARE_ACCOUNT_ID)) {
    fail("CLOUDFLARE_ACCOUNT_ID_INVALID");
  }
  if (values.CLOUDFLARE_API_TOKEN
    && (values.CLOUDFLARE_API_TOKEN.length < 20
      || values.CLOUDFLARE_API_TOKEN.length > 512
      || /\s/.test(values.CLOUDFLARE_API_TOKEN))) {
    fail("CLOUDFLARE_API_TOKEN_INVALID");
  }
}

export function validateProductionValues(rawValues, { allowTestValues = false } = {}) {
  const unknownKeys = Object.keys(rawValues).filter((key) => !supportedKeys.has(key));
  if (unknownKeys.length > 0) fail("ENV_KEY_UNSUPPORTED");

  const values = Object.fromEntries(
    [...supportedKeys].map((key) => [key, String(rawValues[key] ?? "").trim()]),
  );
  if (requiredKeys.some((key) => !values[key])) fail("ENV_REQUIRED_VALUE_MISSING");
  if (!/^[a-z0-9](?:[a-z0-9-]{0,253}[a-z0-9])?$/.test(values.WORKER_NAME)) {
    fail("WORKER_NAME_INVALID");
  }
  if (!allowTestValues && placeholderWords.test(values.WORKER_NAME)) {
    fail("WORKER_NAME_PLACEHOLDER");
  }

  const publicBaseUrl = parseHttpsUrl(values.WORKER_PUBLIC_BASE_URL, { originOnly: true });
  const applicationUrl = parseHttpsUrl(values.CRM_APP_URL);
  if (!publicBaseUrl) fail("WORKER_PUBLIC_BASE_URL_INVALID");
  if (!applicationUrl) fail("CRM_APP_URL_INVALID");
  if (!allowTestValues
    && (placeholderHostname(publicBaseUrl.hostname)
      || placeholderHostname(applicationUrl.hostname))) {
    fail("URL_PLACEHOLDER_FORBIDDEN");
  }
  if (!validMailbox(values.EMAIL_FROM)) fail("EMAIL_FROM_INVALID");
  if (values.EMAIL_REPLY_TO && !validMailbox(values.EMAIL_REPLY_TO)) {
    fail("EMAIL_REPLY_TO_INVALID");
  }
  if (!allowTestValues
    && (placeholderHostname(mailboxDomain(values.EMAIL_FROM))
      || (values.EMAIL_REPLY_TO && placeholderHostname(mailboxDomain(values.EMAIL_REPLY_TO))))) {
    fail("EMAIL_PLACEHOLDER_FORBIDDEN");
  }
  if (!values.EMAIL_BRAND_NAME
    || values.EMAIL_BRAND_NAME.length > 120
    || /[\r\n]/.test(values.EMAIL_BRAND_NAME)) {
    fail("EMAIL_BRAND_NAME_INVALID");
  }
  if (!validRoutePath(values.DELIVERY_PATH)
    || !validRoutePath(values.HEALTH_PATH)
    || values.DELIVERY_PATH === values.HEALTH_PATH) {
    fail("WORKER_PATH_INVALID");
  }
  validateAuthentication(values);

  return {
    ...values,
    CRM_APP_URL: applicationUrl.toString(),
    WORKER_PUBLIC_BASE_URL: publicBaseUrl.origin,
  };
}

export async function loadProductionValues(
  envFile = defaultEnvFile,
  options = {},
) {
  let contents;
  try {
    contents = await readFile(envFile, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") fail("PRODUCTION_ENV_FILE_MISSING");
    fail("PRODUCTION_ENV_FILE_UNREADABLE");
  }
  let parsed;
  try {
    parsed = parseEnv(contents);
  } catch {
    fail("PRODUCTION_ENV_FILE_INVALID");
  }
  return validateProductionValues(parsed, options);
}

function wranglerExecutable() {
  const packageJsonPath = require.resolve("wrangler/package.json");
  const packageJson = require(packageJsonPath);
  const relativeBin = typeof packageJson.bin === "string"
    ? packageJson.bin
    : packageJson.bin?.wrangler;
  if (!relativeBin) fail("WRANGLER_BINARY_UNAVAILABLE");
  return path.resolve(path.dirname(packageJsonPath), relativeBin);
}

export function buildWranglerArguments(configuration, { dryRun = false } = {}) {
  const variables = [
    ["CRM_APP_URL", configuration.CRM_APP_URL],
    ["EMAIL_FROM", configuration.EMAIL_FROM],
    ["EMAIL_BRAND_NAME", configuration.EMAIL_BRAND_NAME],
    ["DELIVERY_PATH", configuration.DELIVERY_PATH],
    ["HEALTH_PATH", configuration.HEALTH_PATH],
  ];
  if (configuration.EMAIL_REPLY_TO) {
    variables.push(["EMAIL_REPLY_TO", configuration.EMAIL_REPLY_TO]);
  }
  const args = [
    wranglerExecutable(),
    "deploy",
    "--config",
    path.join(workerDirectory, "wrangler.toml"),
    "--name",
    configuration.WORKER_NAME,
    "--keep-vars",
    "--strict",
  ];
  for (const [key, value] of variables) {
    args.push("--var", `${key}:${value}`);
  }
  if (dryRun) {
    args.push(
      "--dry-run",
      "--outdir",
      dryRunOutputDirectory,
    );
  }
  return args;
}

function sanitizedOutput(value, configuration) {
  const redactions = [
    configuration.CLOUDFLARE_API_TOKEN,
    configuration.CLOUDFLARE_ACCOUNT_ID,
    configuration.WORKER_PUBLIC_BASE_URL,
    configuration.CRM_APP_URL,
    configuration.EMAIL_FROM,
    configuration.EMAIL_REPLY_TO,
    configuration.EMAIL_BRAND_NAME,
    configuration.DELIVERY_PATH,
    configuration.HEALTH_PATH,
  ].filter(Boolean).sort((left, right) => right.length - left.length);
  let safe = value;
  for (const redaction of redactions) safe = safe.replaceAll(redaction, "<redacted>");
  return safe;
}

async function runWrangler(configuration, { dryRun, spawnImplementation = spawn }) {
  const args = buildWranglerArguments(configuration, { dryRun });
  const childEnvironment = { ...process.env };
  delete childEnvironment.LUMINA_WEBHOOK_TOKEN;
  delete childEnvironment.RESEND_API_KEY;
  for (const key of ["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN"]) {
    if (configuration[key]) childEnvironment[key] = configuration[key];
    else delete childEnvironment[key];
  }

  await new Promise((resolve, reject) => {
    const child = spawnImplementation(process.execPath, args, {
      cwd: workerDirectory,
      env: childEnvironment,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    const collect = (chunk) => {
      output += chunk.toString();
      if (output.length > 1_000_000) {
        child.kill();
        reject(new Error("WRANGLER_OUTPUT_LIMIT_EXCEEDED"));
      }
    };
    child.stdout?.on("data", collect);
    child.stderr?.on("data", collect);
    child.on("error", () => reject(new Error("WRANGLER_START_FAILED")));
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(
        `WRANGLER_FAILED\n${sanitizedOutput(output, configuration).slice(-8_000)}`,
      ));
    });
  });
}

async function verifyHealth(configuration, fetchImplementation = globalThis.fetch) {
  const healthUrl = new URL(configuration.HEALTH_PATH, configuration.WORKER_PUBLIC_BASE_URL);
  let response;
  try {
    response = await fetchImplementation(healthUrl, {
      method: "GET",
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new Error("HEALTH_CHECK_UNAVAILABLE");
  }
  const body = await response.json().catch(() => null);
  if (response.status !== 200
    || body?.status !== "ok"
    || body?.service !== "lumina-email-delivery") {
    throw new Error("HEALTH_CHECK_FAILED");
  }
}

export async function runDeployment({
  dryRun = false,
  envFile = defaultEnvFile,
  allowTestValues = false,
  fetchImplementation = globalThis.fetch,
  spawnImplementation = spawn,
} = {}) {
  const configuration = await loadProductionValues(envFile, { allowTestValues });
  try {
    await runWrangler(configuration, { dryRun, spawnImplementation });
  } finally {
    if (dryRun) await rm(dryRunOutputDirectory, { force: true, recursive: true });
  }
  if (!dryRun) await verifyHealth(configuration, fetchImplementation);
  return { dryRun, workerName: configuration.WORKER_NAME };
}

async function main() {
  const unknownArguments = process.argv.slice(2).filter((argument) => argument !== "--dry-run");
  if (unknownArguments.length > 0) fail("ARGUMENT_UNSUPPORTED");
  const dryRun = process.argv.includes("--dry-run");
  await runDeployment({ dryRun });
  process.stdout.write(dryRun
    ? "Worker production dry-run completed without upload.\n"
    : "Worker deployment and health check completed.\n");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    const code = error instanceof ProductionConfigurationError ? error.code : error.message;
    process.stderr.write(`Worker production controller failed: ${String(code).split("\n", 1)[0]}\n`);
    process.exitCode = 1;
  });
}
