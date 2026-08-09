import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  chmod,
  lstat,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { isIP } from "node:net";
import path from "node:path";
import { parseEnv } from "node:util";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import {
  parseHttpsUrl,
  validMailbox,
  validRoutePath,
} from "../src/config.js";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const workerDirectory = path.resolve(scriptDirectory, "..");
export const DEFAULT_PRODUCTION_ENV_FILE = "/etc/lumina-crm/secrets/email-worker-deploy.env";
export const DEFAULT_PRODUCTION_CONFIG_ROOT = "/var/lib/lumina-crm/email-worker-deployments";
const productionCompatibilityDate = "2026-07-27";
const temporaryDirectoryPrefix = "wrangler-";
const temporaryConfigFilename = "wrangler.production.json";
const workerEntrypoint = path.join(workerDirectory, "src", "index.js");
const requiredSecretNames = ["LUMINA_WEBHOOK_TOKEN", "RESEND_API_KEY"];
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
const requiredKeys = [...supportedKeys].filter((key) => key !== "EMAIL_REPLY_TO");
const placeholderWords = /(?:^|[._\s/-])(example|placeholder|replace|change-me)(?:$|[._\s/-])/i;
const maxWranglerErrorDetailBytes = 8_000;
const require = createRequire(import.meta.url);
const execFileAsync = promisify(execFile);
const sourceCommitPattern = /^[a-f0-9]{40}$/;
const cloudflareIdentifierPattern = /^[a-zA-Z0-9_-]{1,128}$/;
const deploymentEvidenceFilename = "last-success.json";

export class ProductionConfigurationError extends Error {
  constructor(code) {
    super(code);
    this.name = "ProductionConfigurationError";
    this.code = code;
  }
}

class WranglerExecutionError extends Error {
  constructor(detail) {
    super("WRANGLER_FAILED");
    this.name = "WranglerExecutionError";
    this.code = "WRANGLER_FAILED";
    this.detail = detail;
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

function validCustomDomainHostname(url, { allowTestValues }) {
  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (url.port
    || hostname.length > 253
    || !hostname.includes(".")
    || hostname.includes("*")
    || isIP(hostname) !== 0
    || hostname === "localhost") {
    return false;
  }
  const labels = hostname.split(".");
  if (!labels.every((label) => (
    label.length >= 1
    && label.length <= 63
    && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)
  ))) {
    return false;
  }
  return allowTestValues || !placeholderHostname(hostname);
}

function mailboxDomain(value) {
  const bracketed = value.match(/<([^<>]+)>$/);
  const address = (bracketed?.[1] ?? value).trim();
  return address.slice(address.lastIndexOf("@") + 1);
}

function validateAuthentication(values) {
  if (!/^[a-f0-9]{32}$/i.test(values.CLOUDFLARE_ACCOUNT_ID)) {
    fail("CLOUDFLARE_ACCOUNT_ID_INVALID");
  }
  if (values.CLOUDFLARE_API_TOKEN.length < 20
    || values.CLOUDFLARE_API_TOKEN.length > 512
    || /\s/.test(values.CLOUDFLARE_API_TOKEN)) {
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

  const publicBaseUrl = parseHttpsUrl(values.WORKER_PUBLIC_BASE_URL, { originOnly: true });
  const applicationUrl = parseHttpsUrl(values.CRM_APP_URL);
  if (!publicBaseUrl) fail("WORKER_PUBLIC_BASE_URL_INVALID");
  if (!validCustomDomainHostname(publicBaseUrl, { allowTestValues })) {
    fail("WORKER_PUBLIC_HOSTNAME_INVALID");
  }
  if (!applicationUrl) fail("CRM_APP_URL_INVALID");
  if (!allowTestValues && (
    [...supportedKeys].some((key) => values[key] && placeholderWords.test(values[key]))
    || placeholderHostname(publicBaseUrl.hostname)
    || placeholderHostname(applicationUrl.hostname)
  )) {
    fail("PLACEHOLDER_FORBIDDEN");
  }
  if (!validMailbox(values.EMAIL_FROM)) fail("EMAIL_FROM_INVALID");
  if (values.EMAIL_REPLY_TO && !validMailbox(values.EMAIL_REPLY_TO)) {
    fail("EMAIL_REPLY_TO_INVALID");
  }
  if (!allowTestValues && (
    placeholderHostname(mailboxDomain(values.EMAIL_FROM))
    || (values.EMAIL_REPLY_TO && placeholderHostname(mailboxDomain(values.EMAIL_REPLY_TO)))
  )) {
    fail("EMAIL_PLACEHOLDER_FORBIDDEN");
  }
  if (values.EMAIL_BRAND_NAME.length > 120 || /[\r\n]/.test(values.EMAIL_BRAND_NAME)) {
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
    CUSTOM_DOMAIN_HOSTNAME: publicBaseUrl.hostname,
    CRM_APP_URL: applicationUrl.toString(),
    WORKER_PUBLIC_BASE_URL: publicBaseUrl.origin,
  };
}

function gidForGroup(groupFileContents, groupName) {
  for (const line of groupFileContents.split(/\r?\n/)) {
    if (!line || line.startsWith("#")) continue;
    const [name, , gid] = line.split(":");
    if (name === groupName && /^\d+$/.test(gid)) return Number(gid);
  }
  fail("PRODUCTION_ENV_GROUP_UNAVAILABLE");
}

export async function validateProductionEnvFile(envFile, {
  lstatImplementation = lstat,
  statImplementation = stat,
  readFileImplementation = readFile,
  groupFile = "/etc/group",
} = {}) {
  let fileStatus;
  try {
    fileStatus = await lstatImplementation(envFile);
  } catch (error) {
    if (error?.code === "ENOENT") fail("PRODUCTION_ENV_FILE_MISSING");
    fail("PRODUCTION_ENV_FILE_UNREADABLE");
  }
  if (fileStatus.isSymbolicLink()) fail("PRODUCTION_ENV_FILE_SYMLINK_FORBIDDEN");
  if (!fileStatus.isFile()) fail("PRODUCTION_ENV_FILE_NOT_REGULAR");
  if (fileStatus.uid !== 0) fail("PRODUCTION_ENV_FILE_OWNER_INVALID");
  if ((fileStatus.mode & 0o777 & ~0o640) !== 0) fail("PRODUCTION_ENV_FILE_MODE_TOO_OPEN");

  let groupContents;
  try {
    groupContents = await readFileImplementation(groupFile, "utf8");
  } catch {
    fail("PRODUCTION_ENV_GROUP_UNAVAILABLE");
  }
  if (fileStatus.gid !== gidForGroup(groupContents, "lumina-crm")) {
    fail("PRODUCTION_ENV_FILE_GROUP_INVALID");
  }

  let parentStatus;
  try {
    parentStatus = await statImplementation(path.dirname(envFile));
  } catch {
    fail("PRODUCTION_ENV_DIRECTORY_UNREADABLE");
  }
  if (!parentStatus.isDirectory()) fail("PRODUCTION_ENV_DIRECTORY_INVALID");
  if ((parentStatus.mode & 0o004) !== 0) fail("PRODUCTION_ENV_DIRECTORY_WORLD_READABLE");
}

export async function loadProductionValues(envFile, options = {}) {
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

function uidForUser(passwdFileContents, username) {
  for (const line of passwdFileContents.split(/\r?\n/)) {
    if (!line || line.startsWith("#")) continue;
    const [name, , uid] = line.split(":");
    if (name === username && /^\d+$/.test(uid)) return Number(uid);
  }
  fail("PRODUCTION_RUNTIME_USER_UNAVAILABLE");
}

export async function validateProductionConfigRoot(runtimeRoot, {
  expectedUid = process.getuid?.(),
  lstatImplementation = lstat,
  readFileImplementation = readFile,
  passwdFile = "/etc/passwd",
} = {}) {
  if (!path.isAbsolute(runtimeRoot)) fail("PRODUCTION_CONFIG_ROOT_INVALID");
  if (!Number.isSafeInteger(expectedUid) || expectedUid < 0) {
    fail("PRODUCTION_RUNTIME_USER_UNAVAILABLE");
  }
  let passwdContents;
  try {
    passwdContents = await readFileImplementation(passwdFile, "utf8");
  } catch {
    fail("PRODUCTION_RUNTIME_USER_UNAVAILABLE");
  }
  const luminaUid = uidForUser(passwdContents, "lumina-crm");
  if (expectedUid !== luminaUid) fail("PRODUCTION_RUNTIME_USER_INVALID");

  let rootStatus;
  try {
    rootStatus = await lstatImplementation(runtimeRoot);
  } catch (error) {
    if (error?.code === "ENOENT") fail("PRODUCTION_CONFIG_ROOT_MISSING");
    fail("PRODUCTION_CONFIG_ROOT_UNREADABLE");
  }
  if (rootStatus.isSymbolicLink()) fail("PRODUCTION_CONFIG_ROOT_SYMLINK_FORBIDDEN");
  if (!rootStatus.isDirectory()) fail("PRODUCTION_CONFIG_ROOT_NOT_DIRECTORY");
  if (rootStatus.uid !== luminaUid) fail("PRODUCTION_CONFIG_ROOT_OWNER_INVALID");
  if ((rootStatus.mode & 0o777) !== 0o700) fail("PRODUCTION_CONFIG_ROOT_MODE_INVALID");
  return luminaUid;
}

function domainRecord(value) {
  return value
    && typeof value === "object"
    && !Array.isArray(value)
    && typeof value.hostname === "string"
    && typeof value.service === "string"
    && typeof value.zone_name === "string"
    && value.hostname.length > 0
    && value.service.length > 0
    && value.zone_name.length > 0;
}

async function fetchDomainList(configuration, query, fetchImplementation) {
  const url = new URL(
    `/client/v4/accounts/${encodeURIComponent(configuration.CLOUDFLARE_ACCOUNT_ID)}/workers/domains`,
    "https://api.cloudflare.com",
  );
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);

  let response;
  try {
    response = await fetchImplementation(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${configuration.CLOUDFLARE_API_TOKEN}`,
      },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    fail("CUSTOM_DOMAIN_PREFLIGHT_UNAVAILABLE");
  }
  if (response.status !== 200) fail("CUSTOM_DOMAIN_PREFLIGHT_UNAVAILABLE");

  const payload = await response.json().catch(() => null);
  if (!payload
    || payload.success !== true
    || !Array.isArray(payload.result)
    || !payload.result.every(domainRecord)
    || (Number.isSafeInteger(payload.result_info?.total_count)
      && payload.result_info.total_count !== payload.result.length)) {
    fail("CUSTOM_DOMAIN_PREFLIGHT_INVALID_RESPONSE");
  }
  return payload.result;
}

export async function preflightCustomDomain(
  configuration,
  fetchImplementation = globalThis.fetch,
) {
  const hostnameMatches = await fetchDomainList(
    configuration,
    { hostname: configuration.CUSTOM_DOMAIN_HOSTNAME },
    fetchImplementation,
  );
  if (hostnameMatches.length === 0) fail("CUSTOM_DOMAIN_NOT_FOUND");
  if (hostnameMatches.length !== 1
    || hostnameMatches[0].hostname !== configuration.CUSTOM_DOMAIN_HOSTNAME) {
    fail("CUSTOM_DOMAIN_PREFLIGHT_INVALID_RESPONSE");
  }
  if (hostnameMatches[0].service !== configuration.WORKER_NAME) {
    fail("CUSTOM_DOMAIN_OWNERSHIP_MISMATCH");
  }

  const serviceMatches = await fetchDomainList(
    configuration,
    { service: configuration.WORKER_NAME },
    fetchImplementation,
  );
  if (serviceMatches.length !== 1
    || serviceMatches[0].service !== configuration.WORKER_NAME
    || serviceMatches[0].hostname !== configuration.CUSTOM_DOMAIN_HOSTNAME
    || serviceMatches[0].zone_name !== hostnameMatches[0].zone_name) {
    fail("CUSTOM_DOMAIN_SET_MISMATCH");
  }
  return {
    hostname: configuration.CUSTOM_DOMAIN_HOSTNAME,
    zoneName: hostnameMatches[0].zone_name,
  };
}

export function buildProductionWranglerConfig(configuration, customDomain) {
  const variables = {
    CRM_APP_URL: configuration.CRM_APP_URL,
    EMAIL_FROM: configuration.EMAIL_FROM,
    EMAIL_BRAND_NAME: configuration.EMAIL_BRAND_NAME,
    DELIVERY_PATH: configuration.DELIVERY_PATH,
    HEALTH_PATH: configuration.HEALTH_PATH,
  };
  if (configuration.EMAIL_REPLY_TO) variables.EMAIL_REPLY_TO = configuration.EMAIL_REPLY_TO;

  return {
    name: configuration.WORKER_NAME,
    main: workerEntrypoint,
    compatibility_date: productionCompatibilityDate,
    workers_dev: false,
    preview_urls: false,
    keep_vars: true,
    routes: [{
      pattern: customDomain.hostname,
      zone_name: customDomain.zoneName,
      custom_domain: true,
      enabled: true,
      previews_enabled: false,
    }],
    vars: variables,
    observability: {
      enabled: true,
      head_sampling_rate: 1,
      logs: {
        enabled: true,
        head_sampling_rate: 1,
        persist: true,
        invocation_logs: true,
      },
      traces: {
        enabled: false,
        head_sampling_rate: 1,
        persist: true,
      },
    },
    secrets: { required: [...requiredSecretNames] },
  };
}

function directTemporaryChild(runtimeRoot, directory) {
  const resolvedRoot = path.resolve(runtimeRoot);
  const resolvedDirectory = path.resolve(directory);
  return path.dirname(resolvedDirectory) === resolvedRoot
    && path.basename(resolvedDirectory).startsWith(temporaryDirectoryPrefix);
}

export async function removeTemporaryWranglerConfig(temporaryConfig, {
  rmImplementation = rm,
} = {}) {
  if (!temporaryConfig
    || !directTemporaryChild(temporaryConfig.runtimeRoot, temporaryConfig.directory)) {
    fail("TEMP_CONFIG_CLEANUP_TARGET_INVALID");
  }
  try {
    await rmImplementation(temporaryConfig.directory, { force: true, recursive: true });
  } catch {
    fail("TEMP_CONFIG_CLEANUP_FAILED");
  }
}

export async function createTemporaryWranglerConfig(configuration, customDomain, {
  runtimeRoot = DEFAULT_PRODUCTION_CONFIG_ROOT,
  expectedUid = process.getuid?.(),
  chmodImplementation = chmod,
  lstatImplementation = lstat,
  mkdtempImplementation = mkdtemp,
  readFileImplementation = readFile,
  rmImplementation = rm,
  writeFileImplementation = writeFile,
} = {}) {
  const luminaUid = await validateProductionConfigRoot(runtimeRoot, {
    expectedUid,
    lstatImplementation,
    readFileImplementation,
  });
  let directory;
  try {
    directory = await mkdtempImplementation(path.join(runtimeRoot, temporaryDirectoryPrefix));
    if (!directTemporaryChild(runtimeRoot, directory)) fail("TEMP_CONFIG_DIRECTORY_INVALID");
    await chmodImplementation(directory, 0o700);
    const directoryStatus = await lstatImplementation(directory);
    if (directoryStatus.isSymbolicLink()) fail("TEMP_CONFIG_DIRECTORY_SYMLINK_FORBIDDEN");
    if (!directoryStatus.isDirectory()) fail("TEMP_CONFIG_DIRECTORY_INVALID");
    if (directoryStatus.uid !== luminaUid) fail("TEMP_CONFIG_DIRECTORY_OWNER_INVALID");
    if ((directoryStatus.mode & 0o777) !== 0o700) fail("TEMP_CONFIG_DIRECTORY_MODE_INVALID");

    const configPath = path.join(directory, temporaryConfigFilename);
    const config = buildProductionWranglerConfig(configuration, customDomain);
    await writeFileImplementation(configPath, `${JSON.stringify(config, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    await chmodImplementation(configPath, 0o600);
    const configStatus = await lstatImplementation(configPath);
    if (configStatus.isSymbolicLink()) fail("TEMP_CONFIG_FILE_SYMLINK_FORBIDDEN");
    if (!configStatus.isFile()) fail("TEMP_CONFIG_FILE_INVALID");
    if (configStatus.uid !== luminaUid) fail("TEMP_CONFIG_FILE_OWNER_INVALID");
    if ((configStatus.mode & 0o777) !== 0o600) fail("TEMP_CONFIG_FILE_MODE_INVALID");
    return {
      configPath,
      directory,
      dryRunOutputDirectory: path.join(directory, "dry-run-output"),
      runtimeRoot,
    };
  } catch (error) {
    if (directory && directTemporaryChild(runtimeRoot, directory)) {
      try {
        await rmImplementation(directory, { force: true, recursive: true });
      } catch {
        fail("TEMP_CONFIG_CLEANUP_FAILED");
      }
    }
    if (error instanceof ProductionConfigurationError) throw error;
    fail("TEMP_CONFIG_CREATE_FAILED");
  }
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

export function buildWranglerArguments(
  temporaryConfig,
  { dryRun = false, sourceCommit } = {},
) {
  if (!sourceCommitPattern.test(sourceCommit ?? "")) fail("SOURCE_COMMIT_INVALID");
  const args = [
    wranglerExecutable(),
    "deploy",
    "--config",
    temporaryConfig.configPath,
    "--strict",
    "--tag",
    sourceCommit,
    "--message",
    sourceCommit,
  ];
  if (dryRun) {
    args.push("--dry-run", "--outdir", temporaryConfig.dryRunOutputDirectory);
  }
  return args;
}

function encodedVariants(value) {
  const componentEncoded = encodeURIComponent(value);
  const uriEncoded = encodeURI(value);
  const lowerPercentEscapes = (encoded) => encoded.replace(
    /%[0-9A-F]{2}/g,
    (escape) => escape.toLowerCase(),
  );
  return [
    value,
    componentEncoded,
    componentEncoded.replaceAll("%20", "+"),
    uriEncoded,
    lowerPercentEscapes(componentEncoded),
    lowerPercentEscapes(componentEncoded.replaceAll("%20", "+")),
    lowerPercentEscapes(uriEncoded),
  ];
}

function sanitizedOutput(value, configuration) {
  const sensitiveValues = [
    configuration.CLOUDFLARE_API_TOKEN,
    configuration.CLOUDFLARE_ACCOUNT_ID,
    configuration.WORKER_NAME,
    configuration.CUSTOM_DOMAIN_HOSTNAME,
    configuration.CUSTOM_DOMAIN_ZONE_NAME,
    configuration.WORKER_PUBLIC_BASE_URL,
    configuration.CRM_APP_URL,
    configuration.CRM_APP_URL.replace(/\/$/, ""),
    configuration.EMAIL_FROM,
    configuration.EMAIL_REPLY_TO,
    configuration.EMAIL_BRAND_NAME,
    configuration.DELIVERY_PATH,
    configuration.HEALTH_PATH,
  ].filter(Boolean);
  const redactions = [...new Set(sensitiveValues.flatMap(encodedVariants))]
    .filter(Boolean)
    .sort((left, right) => right.length - left.length);
  let safe = value;
  for (const redaction of redactions) safe = safe.replaceAll(redaction, "<redacted>");
  return safe;
}

function limitedUtf8Tail(value, maximumBytes = maxWranglerErrorDetailBytes) {
  const bytes = Buffer.from(value, "utf8");
  if (bytes.length <= maximumBytes) return value;
  return bytes.subarray(bytes.length - maximumBytes).toString("utf8").replace(/^\uFFFD+/, "");
}

export function formatControllerFailure(error) {
  if (error instanceof WranglerExecutionError) {
    const detail = limitedUtf8Tail(error.detail).trim();
    return `Worker production controller failed: ${error.code}${detail ? `\n${detail}` : ""}\n`;
  }
  const stableErrorCode = typeof error?.message === "string"
    && /^[A-Z][A-Z0-9_]{1,100}$/.test(error.message)
    ? error.message
    : "UNEXPECTED_FAILURE";
  const code = error instanceof ProductionConfigurationError ? error.code : stableErrorCode;
  return `Worker production controller failed: ${code}\n`;
}

async function runWrangler(configuration, temporaryConfig, {
  dryRun,
  sourceCommit,
  spawnImplementation = spawn,
}) {
  const args = buildWranglerArguments(temporaryConfig, { dryRun, sourceCommit });
  const childEnvironment = { ...process.env };
  delete childEnvironment.LUMINA_WEBHOOK_TOKEN;
  delete childEnvironment.RESEND_API_KEY;
  childEnvironment.CLOUDFLARE_ACCOUNT_ID = configuration.CLOUDFLARE_ACCOUNT_ID;
  childEnvironment.CLOUDFLARE_API_TOKEN = configuration.CLOUDFLARE_API_TOKEN;

  return new Promise((resolve, reject) => {
    const child = spawnImplementation(process.execPath, args, {
      cwd: workerDirectory,
      env: childEnvironment,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const collect = (target) => (chunk) => {
      if (target === "stdout") stdout += chunk.toString();
      else stderr += chunk.toString();
      if (stdout.length + stderr.length > 1_000_000) {
        child.kill();
        reject(new Error("WRANGLER_OUTPUT_LIMIT_EXCEEDED"));
      }
    };
    child.stdout?.on("data", collect("stdout"));
    child.stderr?.on("data", collect("stderr"));
    child.on("error", () => reject(new Error("WRANGLER_START_FAILED")));
    child.on("close", (code) => {
      if (code === 0) {
        resolve({
          stdout: limitedUtf8Tail(sanitizedOutput(stdout, configuration)),
          stderr: limitedUtf8Tail(sanitizedOutput(stderr, configuration)),
        });
      }
      else reject(new WranglerExecutionError(
        limitedUtf8Tail(sanitizedOutput(`${stdout}\n${stderr}`, configuration)),
      ));
    });
  });
}

export async function resolveSourceProvenance({
  execFileImplementation = execFileAsync,
} = {}) {
  let head;
  let statusOutput;
  try {
    ({ stdout: head } = await execFileImplementation(
      "git",
      ["rev-parse", "--verify", "HEAD"],
      { cwd: workerDirectory, encoding: "utf8", maxBuffer: 64 * 1024 },
    ));
    ({ stdout: statusOutput } = await execFileImplementation(
      "git",
      ["status", "--porcelain=v1", "--untracked-files=all"],
      { cwd: workerDirectory, encoding: "utf8", maxBuffer: 64 * 1024 },
    ));
  } catch {
    fail("SOURCE_PROVENANCE_UNAVAILABLE");
  }
  const sourceCommit = String(head).trim().toLowerCase();
  if (!sourceCommitPattern.test(sourceCommit)) fail("SOURCE_COMMIT_INVALID");
  if (String(statusOutput).length !== 0) fail("SOURCE_WORKTREE_DIRTY");
  return { sourceCommit };
}

async function fetchCloudflareResult(configuration, pathname, fetchImplementation) {
  const url = new URL(
    `/client/v4/accounts/${encodeURIComponent(configuration.CLOUDFLARE_ACCOUNT_ID)}${pathname}`,
    "https://api.cloudflare.com",
  );
  let response;
  try {
    response = await fetchImplementation(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${configuration.CLOUDFLARE_API_TOKEN}`,
      },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    fail("WORKER_DEPLOYMENT_STATUS_UNAVAILABLE");
  }
  if (response.status !== 200) fail("WORKER_DEPLOYMENT_STATUS_UNAVAILABLE");
  const payload = await response.json().catch(() => null);
  if (!payload || payload.success !== true || !payload.result) {
    fail("WORKER_DEPLOYMENT_STATUS_UNAVAILABLE");
  }
  return payload.result;
}

export async function queryWorkerVersions(
  configuration,
  fetchImplementation = globalThis.fetch,
) {
  const result = await fetchCloudflareResult(
    configuration,
    `/workers/scripts/${encodeURIComponent(configuration.WORKER_NAME)}/versions?deployable=true`,
    fetchImplementation,
  );
  if (!Array.isArray(result.items) || result.items.length > 1_000) {
    fail("WORKER_DEPLOYMENT_STATUS_UNAVAILABLE");
  }
  for (const version of result.items) {
    if (!version
      || typeof version !== "object"
      || !cloudflareIdentifierPattern.test(version.id ?? "")
      || typeof version.metadata?.created_on !== "string") {
      fail("WORKER_DEPLOYMENT_STATUS_UNAVAILABLE");
    }
  }
  return result.items;
}

export function identifyUploadedVersion(beforeVersions, afterVersions, sourceCommit) {
  if (!sourceCommitPattern.test(sourceCommit ?? "")) fail("SOURCE_COMMIT_INVALID");
  const beforeIds = new Set(beforeVersions.map((version) => version.id));
  const candidates = afterVersions.filter((version) => (
    !beforeIds.has(version.id)
    && version.annotations?.["workers/tag"] === sourceCommit
    && version.annotations?.["workers/message"] === sourceCommit
  ));
  if (candidates.length !== 1) fail("WORKER_ACTIVE_VERSION_MISMATCH");
  return candidates[0];
}

export async function queryActiveDeployment(
  configuration,
  fetchImplementation = globalThis.fetch,
) {
  const result = await fetchCloudflareResult(
    configuration,
    `/workers/scripts/${encodeURIComponent(configuration.WORKER_NAME)}/deployments`,
    fetchImplementation,
  );
  if (!Array.isArray(result.deployments) || result.deployments.length === 0) {
    fail("WORKER_DEPLOYMENT_STATUS_UNAVAILABLE");
  }
  return result.deployments[0];
}

export function acceptActiveDeployment(deployment, intendedVersionId) {
  if (!deployment
    || typeof deployment !== "object"
    || !Array.isArray(deployment.versions)
    || !cloudflareIdentifierPattern.test(intendedVersionId ?? "")) {
    fail("WORKER_DEPLOYMENT_STATUS_UNAVAILABLE");
  }
  if (deployment.versions.length > 1) fail("WORKER_TRAFFIC_SPLIT_UNEXPECTED");
  if (deployment.versions.length !== 1) fail("WORKER_ACTIVE_VERSION_MISMATCH");
  const [traffic] = deployment.versions;
  if (!traffic
    || !cloudflareIdentifierPattern.test(traffic.version_id ?? "")
    || typeof traffic.percentage !== "number"
    || !Number.isFinite(traffic.percentage)) {
    fail("WORKER_DEPLOYMENT_STATUS_UNAVAILABLE");
  }
  if (traffic.version_id !== intendedVersionId || traffic.percentage !== 100) {
    fail("WORKER_ACTIVE_VERSION_MISMATCH");
  }
  if (!deployment.created_on || Number.isNaN(Date.parse(deployment.created_on))) {
    fail("WORKER_DEPLOYMENT_STATUS_UNAVAILABLE");
  }
  const deploymentTimestamp = new Date(deployment.created_on).toISOString();
  if (deployment.id !== undefined
    && !cloudflareIdentifierPattern.test(deployment.id)) {
    fail("WORKER_DEPLOYMENT_STATUS_UNAVAILABLE");
  }
  return {
    workerVersionId: intendedVersionId,
    ...(deployment.id === undefined ? {} : { deploymentId: deployment.id }),
    trafficPercentage: 100,
    deploymentTimestamp,
  };
}

export async function persistDeploymentEvidence(evidence, {
  runtimeRoot = DEFAULT_PRODUCTION_CONFIG_ROOT,
  chmodImplementation = chmod,
  randomUUIDImplementation = randomUUID,
  renameImplementation = rename,
  rmImplementation = rm,
  writeFileImplementation = writeFile,
} = {}) {
  const expectedKeys = [
    "workerVersionId",
    ...(evidence.deploymentId === undefined ? [] : ["deploymentId"]),
    "trafficPercentage",
    "sourceCommit",
    "deploymentTimestamp",
  ];
  if (Object.keys(evidence).join("\n") !== expectedKeys.join("\n")
    || !cloudflareIdentifierPattern.test(evidence.workerVersionId ?? "")
    || (evidence.deploymentId !== undefined
      && !cloudflareIdentifierPattern.test(evidence.deploymentId))
    || evidence.trafficPercentage !== 100
    || !sourceCommitPattern.test(evidence.sourceCommit ?? "")
    || typeof evidence.deploymentTimestamp !== "string"
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(evidence.deploymentTimestamp)
    || Number.isNaN(Date.parse(evidence.deploymentTimestamp))
    || new Date(evidence.deploymentTimestamp).toISOString() !== evidence.deploymentTimestamp) {
    fail("DEPLOYMENT_EVIDENCE_INVALID");
  }
  const finalPath = path.join(runtimeRoot, deploymentEvidenceFilename);
  const temporaryPath = path.join(
    runtimeRoot,
    `.last-success-${randomUUIDImplementation()}.tmp`,
  );
  try {
    await writeFileImplementation(temporaryPath, `${JSON.stringify(evidence, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    await chmodImplementation(temporaryPath, 0o600);
    await renameImplementation(temporaryPath, finalPath);
  } catch {
    try {
      await rmImplementation(temporaryPath, { force: true });
    } catch {
      // Preserve the stable evidence failure below.
    }
    fail("DEPLOYMENT_EVIDENCE_PERSIST_FAILED");
  }
  return finalPath;
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
  if (response.status !== 200 || body?.status !== "ok" || body?.service !== "lumina-email-delivery") {
    throw new Error("HEALTH_CHECK_FAILED");
  }
}

export async function runDeployment({
  dryRun = false,
  envFile = DEFAULT_PRODUCTION_ENV_FILE,
  runtimeRoot = DEFAULT_PRODUCTION_CONFIG_ROOT,
  allowTestValues = false,
  platform = process.platform,
  fetchImplementation = globalThis.fetch,
  spawnImplementation = spawn,
  validateEnvFileImplementation = validateProductionEnvFile,
  preflightCustomDomainImplementation = preflightCustomDomain,
  createTemporaryConfigImplementation = createTemporaryWranglerConfig,
  removeTemporaryConfigImplementation = removeTemporaryWranglerConfig,
  resolveSourceProvenanceImplementation = resolveSourceProvenance,
  queryWorkerVersionsImplementation = queryWorkerVersions,
  queryActiveDeploymentImplementation = queryActiveDeployment,
  persistDeploymentEvidenceImplementation = persistDeploymentEvidence,
  temporaryConfigOptions = {},
} = {}) {
  if (platform !== "linux") fail("PRODUCTION_DEPLOY_REQUIRES_LINUX");
  if (!path.isAbsolute(envFile)) fail("ENV_FILE_PATH_MUST_BE_ABSOLUTE");
  await validateEnvFileImplementation(envFile);
  const sourceProvenance = await resolveSourceProvenanceImplementation();
  if (!sourceCommitPattern.test(sourceProvenance?.sourceCommit ?? "")) {
    fail("SOURCE_COMMIT_INVALID");
  }

  let configuration = await loadProductionValues(envFile, { allowTestValues });
  const customDomain = await preflightCustomDomainImplementation(
    configuration,
    fetchImplementation,
  );
  configuration = {
    ...configuration,
    CUSTOM_DOMAIN_ZONE_NAME: customDomain.zoneName,
  };
  let temporaryConfig;
  try {
    temporaryConfig = await createTemporaryConfigImplementation(configuration, customDomain, {
      runtimeRoot,
      ...temporaryConfigOptions,
    });
    if (dryRun) {
      await runWrangler(configuration, temporaryConfig, {
        dryRun,
        sourceCommit: sourceProvenance.sourceCommit,
        spawnImplementation,
      });
      return { dryRun, workerName: configuration.WORKER_NAME };
    }

    const versionsBefore = await queryWorkerVersionsImplementation(
      configuration,
      fetchImplementation,
    );
    const sourceAtUpload = await resolveSourceProvenanceImplementation();
    if (sourceAtUpload?.sourceCommit !== sourceProvenance.sourceCommit) {
      fail("SOURCE_CHANGED_DURING_DEPLOYMENT");
    }
    const wranglerResult = await runWrangler(configuration, temporaryConfig, {
      dryRun,
      sourceCommit: sourceProvenance.sourceCommit,
      spawnImplementation,
    });
    if (!wranglerResult
      || typeof wranglerResult.stdout !== "string"
      || typeof wranglerResult.stderr !== "string") {
      fail("WRANGLER_RESULT_INVALID");
    }
    const sourceAfterUpload = await resolveSourceProvenanceImplementation();
    if (sourceAfterUpload?.sourceCommit !== sourceProvenance.sourceCommit) {
      fail("SOURCE_CHANGED_DURING_DEPLOYMENT");
    }

    const versionsAfter = await queryWorkerVersionsImplementation(
      configuration,
      fetchImplementation,
    );
    const uploadedVersion = identifyUploadedVersion(
      versionsBefore,
      versionsAfter,
      sourceProvenance.sourceCommit,
    );
    const activeDeployment = await queryActiveDeploymentImplementation(
      configuration,
      fetchImplementation,
    );
    acceptActiveDeployment(activeDeployment, uploadedVersion.id);

    const postDeploymentDomain = await preflightCustomDomainImplementation(
      configuration,
      fetchImplementation,
    );
    if (postDeploymentDomain.hostname !== customDomain.hostname
      || postDeploymentDomain.zoneName !== customDomain.zoneName) {
      fail("CUSTOM_DOMAIN_SET_MISMATCH");
    }
    await verifyHealth(configuration, fetchImplementation);

    const finalActiveDeployment = await queryActiveDeploymentImplementation(
      configuration,
      fetchImplementation,
    );
    const deploymentEvidence = {
      ...acceptActiveDeployment(finalActiveDeployment, uploadedVersion.id),
      sourceCommit: sourceProvenance.sourceCommit,
    };
    const orderedDeploymentEvidence = {
      workerVersionId: deploymentEvidence.workerVersionId,
      ...(deploymentEvidence.deploymentId === undefined
        ? {}
        : { deploymentId: deploymentEvidence.deploymentId }),
      trafficPercentage: deploymentEvidence.trafficPercentage,
      sourceCommit: deploymentEvidence.sourceCommit,
      deploymentTimestamp: deploymentEvidence.deploymentTimestamp,
    };
    await persistDeploymentEvidenceImplementation(orderedDeploymentEvidence, {
      runtimeRoot,
      ...temporaryConfigOptions,
    });
    return {
      dryRun,
      workerName: configuration.WORKER_NAME,
      deploymentEvidence: orderedDeploymentEvidence,
    };
  } finally {
    if (temporaryConfig) {
      await removeTemporaryConfigImplementation(temporaryConfig, temporaryConfigOptions);
    }
  }
}

export function parseArguments(argumentsList) {
  let dryRun = false;
  for (const argument of argumentsList) {
    if (argument === "--dry-run") {
      if (dryRun) fail("ARGUMENT_UNSUPPORTED");
      dryRun = true;
    } else {
      fail("ARGUMENT_UNSUPPORTED");
    }
  }
  return { dryRun, envFile: DEFAULT_PRODUCTION_ENV_FILE };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  await runDeployment(options);
  process.stdout.write(options.dryRun
    ? "Worker production dry-run completed without upload.\n"
    : "Worker active-version proof and health check completed.\n");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(formatControllerFailure(error));
    process.exitCode = 1;
  });
}
