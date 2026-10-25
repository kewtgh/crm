import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

export const CASES = Object.freeze(['ubuntu', 'manager-available', 'manager-failure-attribution',
  'agent-budget', 'agent-fictional-oneshot', 'rootless-isolation', 'rootless-kernel-config',
  'rootless-memory', 'rootless-cpu', 'rootless-pids', 'rootless-compose',
  'target-engine', 'target-compose', 'target-buildx', 'target-combination', 'fixture-cleanup',
  'reboot', 'disk-fault']);
export const REASONS = Object.freeze(['OBSERVED', 'NOT_EXECUTED', 'CHECK_FAILED',
  'PACKAGES_UNAVAILABLE', 'HELPER_UNAVAILABLE', 'USERNS_UNAVAILABLE', 'DAEMON_START_FAILED',
  'CONTROLLERS_UNAVAILABLE', 'IMAGE_PULL_FAILED', 'TARGET_VERSION_MISMATCH', 'EXTERNAL_FIXTURE_REQUIRED']);
export const PACKAGE_NAMES = Object.freeze(['docker-ce', 'docker-ce-rootless-extras', 'docker.io',
  'containerd', 'containerd.io', 'runc', 'docker-compose-v2', 'docker-buildx', 'rootlesskit',
  'uidmap', 'slirp4netns', 'dbus-user-session', 'systemd']);
export const METRICS = Object.freeze(['agentMemoryPeakBytes', 'agentRssBytes', 'agentProcesses',
  'agentTasks', 'agentCpuUsec', 'payloadBytes', 'stateBytes', 'daemonRssBeforeBytes',
  'daemonRssAfterBytes', 'daemonProcessesBefore', 'daemonProcessesAfter', 'daemonTasksBefore',
  'daemonTasksAfter', 'daemonMemoryPeakBytes', 'daemonCpuUsec', 'daemonDiskBytes',
  'baselineFailedUnits', 'injectedFailedUnits', 'remainingFixtureFailures', 'baselineFailuresAfter',
  'legacyUpdateExit', 'legacyHelpersExit', 'legacyExtrasExit']);
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export function failureDetail(error) {
  const detail = {};
  if (['ERR_ASSERTION', 'OBSERVATION_TIMEOUT', 'COMMAND_FAILED'].includes(error.code ?? error.message)) detail.condition = error.code ?? error.message;
  if (['node', 'docker', 'systemctl', 'docker-compose', 'docker-buildx'].includes(error.command)) detail.command = error.command;
  if (Number.isInteger(error.exitCode) && error.exitCode >= 0 && error.exitCode <= 255) detail.exitCode = error.exitCode;
  if (['ENOENT', 'EACCES', 'EPERM', 'ETIMEDOUT'].includes(error.errno)) detail.errno = error.errno;
  // Assertion actual/expected can contain UID/PID or private paths: never publish them.
  return detail;
}
export function aptReason(text, success) {
  if (success) return 'PLAN_AVAILABLE';
  if (/Conflicting values set for option Signed-By/.test(text)) return 'SOURCE_SIGNED_BY_CONFLICT';
  if (/NO_PUBKEY|EXPKEYSIG|not signed|signatures couldn.t be verified/.test(text)) return 'SIGNATURE_REJECTED';
  if (/Version .*docker-ce-rootless-extras.*not found|Version .* for .docker-ce-rootless-extras. was not found/.test(text)) return 'EXTRAS_VERSION_ABSENT';
  if (/does not have a Release file|404.*Not Found/.test(text)) return 'REPOSITORY_UNAVAILABLE';
  if (/Could not get lock|Unable to acquire.*lock/.test(text)) return 'APT_LOCK_BUSY';
  if (/Could not resolve|Could not connect|Certificate verification failed/.test(text)) return 'NETWORK_OR_TLS';
  return 'UNCLASSIFIED_PRIVATE_LOG';
}
export function sourceDigest(root) {
  const names = execFileSync('git', ['ls-files', '-z', '--', 'deployment-v2-agent', 'deployment-v2-m1',
    '.github/workflows/deployment-v2-rootless.yml'], { cwd: root }).toString().split('\0').filter(Boolean).sort();
  return sha256(names.map(name => `${name}\0${sha256(fs.readFileSync(`${root}/${name}`))}\n`).join(''));
}
export function selectPackage(text, upstream) {
  assert(/^\d+\.\d+\.\d+$/.test(upstream));
  return text.split('\n').map(line => line.split('|')[1]?.trim()).find(version =>
    version?.replace(/^\d+:/, '').match(/^(\d+\.\d+\.\d+)(?:\+(?:ds|dfsg)\d*)?-/)?.[1] === upstream) ?? null;
}
export function initial(context) { return { ...context, completed: false, cases: Object.fromEntries(CASES.map(id =>
  [id, { status: 'NOT_RUN', reason: 'NOT_EXECUTED' }])), environment: {}, packages: [], metrics: {}, kernel: {}, facts: {} }; }
const integer = value => Number.isSafeInteger(value) && value >= 0;
const version = value => typeof value === 'string' && /^\d[\d.a-zA-Z:+~_-]{0,95}$/.test(value);
export function summary(raw, context) {
  assert(/^[a-f0-9]{40}$/.test(context.sha) && /^\d{1,20}$/.test(context.runId) && /^\d{1,6}$/.test(context.attempt));
  assert(['24.04', '26.04'].includes(context.profile));
  for (const key of ['sha', 'runId', 'attempt', 'profile']) assert.equal(raw?.[key], context[key], 'STALE_EVIDENCE');
  assert(/^[a-f0-9]{64}$/.test(raw.sourceDigest));
  const cases = CASES.map(id => { const item = raw.cases?.[id];
    assert(item && ['PASS', 'FAIL', 'NOT_RUN'].includes(item.status) && REASONS.includes(item.reason));
    assert(item.status !== 'PASS' || item.reason === 'OBSERVED');
    return { id, status: item.status, reason: item.reason,
      ...(item.status === 'FAIL' && item.failure ? { failure: failureDetail(item.failure) } : {}),
      ...(['SETUP', 'MANAGER', 'AGENT', 'DAEMON', 'CONFIG', 'MEMORY', 'CPU', 'PIDS', 'COMPOSE', 'CLEANUP'].includes(item.phase) ? { phase: item.phase } : {}) };
  });
  const environment = {};
  for (const key of ['ubuntu', 'kernel', 'node', 'systemd', 'engine', 'compose', 'buildx', 'rootlesskit']) if (version(raw.environment?.[key])) environment[key] = raw.environment[key];
  for (const key of ['managerBefore', 'managerAfterInjection', 'managerAfterCleanup']) if (['running', 'degraded'].includes(raw.environment?.[key])) environment[key] = raw.environment[key];
  const metrics = {}; for (const key of METRICS) if (integer(raw.metrics?.[key])) metrics[key] = raw.metrics[key];
  const kernel = {}; for (const phase of ['config', 'cpu', 'pids', 'memory']) {
    if (!raw.kernel?.[phase]) continue; const values = {};
    for (const key of ['memoryMax', 'memoryCurrent', 'memoryPeak', 'memoryMaxEvents', 'oomKill', 'swapMax',
      'cpuQuota', 'cpuPeriod', 'cpuUsec', 'nrThrottled', 'throttledUsec', 'pidsMax', 'pidsCurrent', 'pidsMaxEvents', 'exitCode']) {
      if (integer(raw.kernel[phase][key])) values[key] = raw.kernel[phase][key];
    }
    if (typeof raw.kernel[phase].oomKilled === 'boolean') values.oomKilled = raw.kernel[phase].oomKilled;
    kernel[phase] = values;
  }
  const packages = (Array.isArray(raw.packages) ? raw.packages : []).filter(p => PACKAGE_NAMES.includes(p.name) && version(p.version))
    .map(p => ({ name: p.name, version: p.version, installed: p.installed === true,
      ...(/^[a-f0-9]{64}$/.test(p.sha256) ? { sha256: p.sha256 } : {}) }));
  const facts = {}; for (const key of ['initialExtrasInstalled', 'initialRootlessScript', 'initialRootlesskit', 'officialDockerSourceConfigured',
    'enginePackageUnchanged', 'dedicatedUid', 'socketOwned', 'dataRootOwned', 'rootlessReported',
    'cgroupV2', 'systemdDriver', 'controllersDelegated', 'baselineFailuresPreserved', 'agentIdle',
    'daemonStopped', 'lingerDisabled', 'managerStopped']) if (typeof raw.facts?.[key] === 'boolean') facts[key] = raw.facts[key];
  const legacy = {}; for (const key of ['update', 'helpers', 'extras']) {
    if (['PLAN_AVAILABLE', 'SOURCE_SIGNED_BY_CONFLICT', 'SIGNATURE_REJECTED', 'EXTRAS_VERSION_ABSENT',
      'REPOSITORY_UNAVAILABLE', 'APT_LOCK_BUSY', 'NETWORK_OR_TLS', 'UNCLASSIFIED_PRIVATE_LOG'].includes(raw.legacy?.[key])) legacy[key] = raw.legacy[key];
  }
  const managerFailures = (Array.isArray(raw.managerFailures) ? raw.managerFailures : [])
    .filter(item => ['DBUS', 'GPG', 'KEYRING', 'OTHER'].includes(item.kind) && integer(item.exitCode))
    .map(item => ({ kind: item.kind, exitCode: item.exitCode,
      result: ['exit-code', 'signal', 'timeout', 'resources', 'protocol', 'start-limit-hit'].includes(item.result) ? item.result : 'OTHER' }));
  const daemonFailure = {};
  if (['ROOTLESSKIT_USERNS_DENIED', 'CGROUP_USER_BUS_UNAVAILABLE', 'ENGINE_RUNTIME_MISSING', 'RUNTIME_DIRECTORY_UNAVAILABLE', 'EXECUTION_IDENTITY_INVALID',
    'ENGINE_CONFIGURATION_REJECTED', 'UNCLASSIFIED_PRIVATE_LOG'].includes(raw.daemonFailure?.reason)) daemonFailure.reason = raw.daemonFailure.reason;
  if (integer(raw.daemonFailure?.exitCode) && raw.daemonFailure.exitCode <= 255) daemonFailure.exitCode = raw.daemonFailure.exitCode;
  return { schemaVersion: 1, scope: 'NONPRODUCTION_ALPHA', productionApproved: false,
    ...context, sourceDigest: raw.sourceDigest,
    payloadDigest: /^[a-f0-9]{64}$/.test(raw.payloadDigest) ? raw.payloadDigest : null,
    completed: raw.completed === true,
    result: raw.completed !== true || cases.some(c => c.status === 'FAIL') ? 'FAIL' : cases.some(c => c.status === 'NOT_RUN') ? 'INCOMPLETE' : 'PASS',
    environment, packages, metrics, kernel, facts, legacy, managerFailures, daemonFailure, cases };
}
