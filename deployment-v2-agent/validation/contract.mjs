import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

// Publication is positive extraction. No error text, paths, identifiers or logs.
export const CASES = Object.freeze([
  'fixed-oneshot', 'cli-exit', 'pty-hangup', 'concurrent-admission',
  'concurrent-dispatch', 'kernel-flock', 'grant-once', 'timeout',
  'explicit-reconcile', 'receipt-reconcile', 'idle-zero-agent',
  'unit-budget-config', 'unit-memory-enforced', 'unit-cpu-enforced',
  'unit-tasks-enforced', 'child-group-cleanup', 'rootless-isolation',
  'rootless-budget-config', 'rootless-memory-enforced',
  'rootless-cpu-enforced', 'rootless-tasks-enforced',
  'reboot', 'power-loss', 'disk-fault', 'target-ubuntu-profile',
]);
export const CODES = Object.freeze(['OBSERVED', 'ASSERTION_FAILED', 'NOT_EXECUTED',
  'USER_MANAGER_UNAVAILABLE', 'CGROUP_UNAVAILABLE', 'ROOTLESS_PREREQUISITE_MISSING',
  'ROOTLESS_START_FAILED', 'ROOTLESS_PULL_FAILED', 'CONTROLLER_NOT_DELEGATED',
  'EXTERNAL_FIXTURE_REQUIRED', 'TARGET_PROFILE_NOT_MATCHED', 'HARNESS_INCOMPLETE']);
export const METRICS = Object.freeze(['agentMemoryPeakBytes', 'agentTasksPeak',
  'agentCpuUsageUsec', 'agentProcessPeak', 'agentRssPeakBytes', 'stateBytes',
  'payloadBytes', 'rootlessDiskBytes', 'rootlessDaemonRssBytes',
  'memoryMaxBytes', 'cpuQuotaUsec', 'cpuPeriodUsec', 'tasksMax',
  'pressureMemoryCurrentBytes', 'pressureMemoryMaxEvents', 'pressureSwapCurrentBytes']);
export const sha256 = value => createHash('sha256').update(value).digest('hex');
export function managerHealth(exitCode, output) {
  const state = typeof output === 'string' ? output.trim() : '';
  // 'degraded' means one or more units failed, not that the manager is unavailable.
  assert(exitCode === 0 && state === 'running' || exitCode === 1 && state === 'degraded', 'USER_MANAGER_UNAVAILABLE');
  return state;
}
const safeValue = value => typeof value === 'boolean' || Number.isSafeInteger(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER
  || ['oneshot', 'control-group', 'no', 'CONSUMED', 'PROVEN', 'INTENT', 'UNKNOWN', 'COMPLETED',
    'RECOVERY_REQUIRED', 'timeout', 'exit-code', 'oom-kill', 'success', '2', '9', 'systemd'].includes(value);
export function assertionDetail(error) {
  const detail = {};
  if (['ERR_ASSERTION', 'OBSERVATION_TIMEOUT', 'CLI_TIMEOUT', 'PTY_SUBMIT_FAILED',
    'PTY_DISPATCH_FAILED', 'PTY_DISPATCH_NOT_OBSERVED', 'PTY_HANGUP_NOT_OBSERVED',
    'PTY_SESSION_DID_NOT_EXIT', 'PTY_READ_FAILED'].includes(error.code ?? error.message)) detail.code = error.code ?? error.message;
  if (['strictEqual', 'deepStrictEqual', '=='].includes(error.operator)) detail.operator = error.operator;
  for (const key of ['expected', 'actual']) if (safeValue(error[key])) detail[key] = error[key];
  return detail;
}
export function harnessDetail(raw) {
  const result = {};
  if (['ENVIRONMENT', 'CGROUP_CONTROLLERS', 'USER_MANAGER_HEALTH', 'UNIT_DIRECTORY', 'UNIT_RELOAD', 'CASES'].includes(raw?.phase)) result.phase = raw.phase;
  if (['systemctl', 'node', 'docker', 'python3'].includes(raw?.command)) result.command = raw.command;
  if (Number.isInteger(raw?.exitCode) && raw.exitCode >= 0 && raw.exitCode <= 255) result.exitCode = raw.exitCode;
  if (['running', 'degraded', 'starting', 'initializing', 'offline', 'maintenance', 'stopping', 'unknown'].includes(raw?.managerState)) result.managerState = raw.managerState;
  if (raw?.assertion) result.assertion = assertionDetail(raw.assertion);
  return result;
}
export function sourceDigest(root) {
  const names = execFileSync('git', ['ls-files', '-z', '--', 'deployment-v2-agent',
    'deployment-v2-m1', '.github/workflows/deployment-v2-agent.yml'], { cwd: root }).toString().split('\0').filter(Boolean).sort();
  assert(names.length > 0);
  return sha256(names.map(name => `${name}\0${sha256(fs.readFileSync(path.join(root, name)))}\n`).join(''));
}
export function emptyReport(context) {
  return { ...context, completed: false, payloadDigest: null, environment: {}, metrics: {},
    cases: Object.fromEntries(CASES.map(id => [id, { status: 'NOT_RUN', code: 'NOT_EXECUTED' }])) };
}
export function publicSummary(raw, context) {
  assert(/^[a-f0-9]{40}$/.test(context.sha));
  assert(/^\d{1,20}$/.test(context.runId) && /^\d{1,6}$/.test(context.attempt));
  assert(raw && raw.sha === context.sha && raw.runId === context.runId && raw.attempt === context.attempt, 'STALE_EVIDENCE');
  assert(/^[a-f0-9]{64}$/.test(raw.sourceDigest));
  assert(raw.payloadDigest === null || /^[a-f0-9]{64}$/.test(raw.payloadDigest));
  const cases = CASES.map(id => {
    const item = raw.cases?.[id];
    assert(item && ['PASS', 'FAIL', 'NOT_RUN'].includes(item.status) && CODES.includes(item.code));
    assert(item.status !== 'PASS' || item.code === 'OBSERVED');
    return { id, status: item.status, code: item.code,
      ...(item.status === 'FAIL' && item.assertion ? { assertion: assertionDetail(item.assertion) } : {}) };
  });
  const environment = {};
  for (const name of ['ubuntu', 'kernel', 'systemd', 'node', 'docker']) {
    const value = raw.environment?.[name];
    if (typeof value === 'string' && /^\d{1,3}(?:\.\d{1,4}){0,3}$/.test(value)) environment[name] = value;
  }
  if (['running', 'degraded'].includes(raw.environment?.managerState)) environment.managerState = raw.environment.managerState;
  const metrics = {};
  for (const name of METRICS) {
    const value = raw.metrics?.[name];
    if (Number.isSafeInteger(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER) metrics[name] = value;
  }
  return { schemaVersion: 1, scope: 'NONPRODUCTION_ALPHA', productionApproved: false,
    sha: context.sha, runId: context.runId, attempt: context.attempt,
    runner: 'github-hosted-ubuntu-24.04-x64', sourceDigest: raw.sourceDigest,
    payloadDigest: raw.payloadDigest, completed: raw.completed === true,
    result: raw.completed === true && !cases.some(c => c.status === 'FAIL') ? 'PASS' : 'FAIL',
    environment, metrics, cases,
    ...(raw.rootlessMissing ? { rootlessMissing: ['dockerd-rootless.sh', 'rootlesskit', 'newuidmap', 'newgidmap'].filter(name => raw.rootlessMissing.includes(name)) } : {}),
    ...(raw.harnessFailure ? { harnessFailure: harnessDetail(raw.harnessFailure) } : {}) };
}
