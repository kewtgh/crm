import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { assert, boundedRead, isRecord, keys, M1Error, sha256 } from './safety.ts';
import { boundedCommand, cleanEnvironment, commandSpec, errno, remaining, rootExecutable, type CommandId, type Errno, type Policy, type ReadResult } from './observation.ts';
import { COMPOSE_MODEL, securityMismatches, type SecurityField } from './compose.ts';

export const CHECK_IDS = ['host.platform', 'host.identity', 'host.os', 'docker.socket', 'docker.config', 'docker.data-directory', 'docker.info', 'docker.version', 'docker.rootless', 'docker.data-root', 'docker.cgroup', 'docker.isolation', 'compose.version', 'compose.security-model', 'buildx.version', 'systemd.user-bus', 'systemd.manager', 'systemd.docker', 'systemd.agent', 'cgroup.controllers', 'storage.capacity', 'state.snapshot'] as const;
export type CheckId = typeof CHECK_IDS[number];
export const CODES = ['MATCH', 'LINUX_REQUIRED', 'PROJECT_UID_MISMATCH', 'METADATA_PERMISSION_DENIED', 'METADATA_MISSING', 'METADATA_READ_FAILED', 'RESOURCE_TYPE_MISMATCH', 'RESOURCE_OWNER_MISMATCH', 'RESOURCE_PERMISSIONS_UNSAFE', 'RESOURCE_PATH_UNTRUSTED', 'DEPENDENCY_UNRESOLVED', 'COMMAND_TIMEOUT', 'COMMAND_OUTPUT_LIMIT', 'COMMAND_SPAWN_FAILED', 'COMMAND_NONZERO_EXIT', 'COMMAND_EXECUTABLE_UNTRUSTED', 'JSON_INVALID', 'JSON_SHAPE_INVALID', 'INFO_FIELD_MISSING', 'INFO_FIELD_INVALID', 'DAEMON_NOT_ROOTLESS', 'DATA_ROOT_MISMATCH', 'CGROUP_CONFIGURATION_MISMATCH', 'VERSION_INVALID', 'VERSION_NOT_BASELINE', 'COMPOSE_SECURITY_MISMATCH', 'OS_NOT_BASELINE', 'USER_MANAGER_RESPONSE_INVALID', 'SERVICE_STATUS_INVALID', 'SERVICE_NOT_RUNNING', 'NOT_INSTALLED', 'CONTROLLERS_MISSING', 'CAPACITY_BELOW_MINIMUM', 'CAPACITY_UNAVAILABLE', 'M1_COLLECTION_NOT_IMPLEMENTED', 'M1_STORE_READER_NOT_IMPLEMENTED', 'READ_FAILED'] as const;
export type Code = typeof CODES[number];
export type Status = 'PASS' | 'FAIL' | 'UNKNOWN' | 'NOT_RUN';
export type Observed = { matches?: boolean; available?: boolean; version?: string; installed?: boolean; active?: boolean; mismatches?: SecurityField[]; state?: 'active' | 'inactive' | 'failed' | 'activating' | 'deactivating' | 'unknown' };
export type Check = { checkId: CheckId; status: Status; severity: 'BLOCKING' | 'WARNING'; code: Code; stage: 'PLATFORM' | 'READ_METADATA' | 'EXECUTE' | 'PARSE' | 'EVALUATE'; dependsOn: CheckId[]; expected: null; observed: Observed | null; exitCode: number | null; errno: Errno | null; durationMs: number; remediationId: 'REVIEW_PROJECT_SCOPE' | 'RESOLVE_DEPENDENCY_FIRST' | 'REVIEW_OBSERVATION' };
export type Metadata = { kind: 'file' | 'directory' | 'socket' | 'other'; uid: number; mode: number; canonical: boolean };
export type HostIO = { platform: string; uid: number | null; metadata(file: string): Metadata; read(file: string): string; capacity(file: string): bigint; command(id: CommandId, policy: Policy, timeoutMs: number, input?: string): Promise<ReadResult>; peakRssBytes(): number };
export function validatePolicy(value: unknown): Policy {
  assert(isRecord(value), 'POLICY_INVALID');
  keys(value, ['schemaVersion', 'projectUid', 'socket', 'dataRoot', 'dockerConfig', 'composeBinary', 'stateParent', 'minimumFreeBytes']);
  assert(value.schemaVersion === 1 && Number.isSafeInteger(value.projectUid) && Number(value.projectUid) > 0 && Number(value.projectUid) < 1_000_000, 'POLICY_INVALID');
  for (const k of ['socket', 'dataRoot', 'dockerConfig', 'stateParent']) assert(typeof value[k] === 'string' && /^\/[A-Za-z0-9_./-]{1,240}$/.test(value[k]) && value[k] !== '/' && path.posix.normalize(value[k]) === value[k], 'POLICY_INVALID');
  assert(value.socket !== '/var/run/docker.sock' && value.socket !== '/run/docker.sock', 'POLICY_SCOPE_UNSAFE');
  assert(['/usr/libexec/docker/cli-plugins/docker-compose', '/usr/lib/docker/cli-plugins/docker-compose'].includes(String(value.composeBinary)), 'POLICY_INVALID');
  assert(Number.isSafeInteger(value.minimumFreeBytes) && Number(value.minimumFreeBytes) >= 1_048_576 && Number(value.minimumFreeBytes) <= 1024 ** 4, 'POLICY_INVALID');
  return value as Policy;
}
export const liveIO: HostIO = {
  platform: process.platform, uid: process.getuid?.() ?? null,
  metadata(file) {
    const s = fs.lstatSync(file);
    return { kind: s.isSymbolicLink() ? 'other' : s.isSocket() ? 'socket' : s.isDirectory() ? 'directory' : s.isFile() ? 'file' : 'other', uid: s.uid, mode: s.mode & 0o777, canonical: fs.realpathSync(file) === file };
  },
  read(file) {
    if (file === '/etc/os-release') {
      const resolved = fs.realpathSync(file);
      assert(['/etc/os-release', '/usr/lib/os-release'].includes(resolved), 'OS_FILE_UNTRUSTED'); rootExecutable(resolved);
      return boundedRead(resolved).toString();
    }
    return boundedRead(file).toString();
  },
  capacity(file) { const s = fs.statfsSync(file, { bigint: true }); return s.bavail * s.bsize; },
  async command(id, policy, timeoutMs, input) {
    const spec = commandSpec(id, policy);
    try { rootExecutable(spec.file); }
    catch (error) { return { ok: false, reason: 'EXECUTABLE_UNTRUSTED', errno: errno(error), exitCode: null, durationMs: 0 }; }
    return boundedCommand(spec.file, spec.args, cleanEnvironment(policy), timeoutMs, input, 'inherit');
  },
  peakRssBytes() { return process.resourceUsage().maxRSS * 1024; },
};
export function normalizedVersion(raw: unknown) {
  if (typeof raw !== 'string' || raw.length > 256) return null;
  const match = /^v?(\d{1,3}\.\d{1,3}\.\d{1,3})(?:(?:\+ds\d+)?-\d+ubuntu\d+(?:\.\d+)?)?$/.exec(raw.trim());
  return match?.[1] ?? null; // No arbitrary suffix or raw version string can cross the publication boundary.
}
export function ownDigest() {
  const files = ['safety.ts', 'observation.ts', 'compose.ts', 'diagnostics.ts', 'diagnostics-cli.mjs', 'diagnostics-worker.ts'];
  return `sha256:${sha256(files.map(f => `${f}:${sha256(boundedRead(fileURLToPath(new URL(f, import.meta.url)), 131_072))}`).join('\n'))}`;
}
export async function collectDiagnostics(policyInput: unknown, io: HostIO = liveIO) {
  const policy = validatePolicy(policyInput), start = performance.now(), deadline = start + 45_000;
  const checks: Check[] = [];
  const versions: { component: 'node' | 'docker' | 'compose' | 'buildx'; status: Status; version: string | null }[] = [{ component: 'node', status: 'PASS', version: process.versions.node }];
  const guard = () => {
    assert(performance.now() < deadline, 'DIAGNOSTIC_DEADLINE');
    assert(io.peakRssBytes() <= 128 * 1024 ** 2, 'DIAGNOSTIC_MEMORY_LIMIT');
  };
  const add = (id: CheckId, status: Status, code: Code, observed: Observed | null = null, dependsOn: CheckId[] = [], stage: Check['stage'] = 'EVALUATE', extra: Partial<Pick<Check, 'errno' | 'exitCode' | 'durationMs'>> = {}) => {
    const row: Check = { checkId: id, status, severity: ['buildx.version', 'systemd.agent', 'state.snapshot'].includes(id) ? 'WARNING' : 'BLOCKING', code, stage, dependsOn, expected: null, observed, exitCode: null, errno: null, durationMs: 0, remediationId: status === 'NOT_RUN' && dependsOn.length ? 'RESOLVE_DEPENDENCY_FIRST' : id.startsWith('docker.') || id === 'host.identity' ? 'REVIEW_PROJECT_SCOPE' : 'REVIEW_OBSERVATION', ...extra };
    checks.push(row); return row;
  };
  const ready = (id: CheckId, deps: CheckId[]) => {
    guard();
    if (deps.every(d => checks.find(c => c.checkId === d)?.status === 'PASS')) return true;
    add(id, 'NOT_RUN', 'DEPENDENCY_UNRESOLVED', null, deps); return false;
  };
  const metadata = (id: CheckId, file: string, kind: Metadata['kind'], deps: CheckId[]) => {
    if (!ready(id, deps)) return;
    try {
      const m = io.metadata(file);
      if (!m.canonical) add(id, 'FAIL', 'RESOURCE_PATH_UNTRUSTED', { matches: false }, deps, 'READ_METADATA');
      else if (m.kind !== kind) add(id, 'FAIL', 'RESOURCE_TYPE_MISMATCH', { matches: false }, deps, 'READ_METADATA');
      else if (m.uid !== policy.projectUid) add(id, 'FAIL', 'RESOURCE_OWNER_MISMATCH', { matches: false }, deps, 'READ_METADATA');
      else if ((m.mode & (kind === 'socket' ? 0o007 : 0o077)) !== 0) add(id, 'FAIL', 'RESOURCE_PERMISSIONS_UNSAFE', { matches: false }, deps, 'READ_METADATA');
      else add(id, 'PASS', 'MATCH', { matches: true }, deps, 'READ_METADATA');
    } catch (error) {
      const e = errno(error); add(id, 'UNKNOWN', e === 'EACCES' || e === 'EPERM' ? 'METADATA_PERMISSION_DENIED' : e === 'ENOENT' ? 'METADATA_MISSING' : 'METADATA_READ_FAILED', { available: false }, deps, 'READ_METADATA', { errno: e });
    }
  };
  const command = async (id: CheckId, cmd: CommandId, deps: CheckId[], input?: string) => {
    if (!ready(id, deps)) return null;
    let r: ReadResult;
    try { r = await io.command(cmd, policy, remaining(deadline), input); }
    catch (error) { r = { ok: false, reason: 'SPAWN_FAILED', errno: errno(error), exitCode: null, durationMs: 0 }; }
    guard();
    if (!r.ok) { add(id, 'UNKNOWN', `COMMAND_${r.reason}` as Code, null, deps, 'EXECUTE', { errno: r.errno, exitCode: r.exitCode, durationMs: Math.min(45_000, r.durationMs) }); return null; }
    return r;
  };
  guard();
  add('host.platform', io.platform === 'linux' ? 'PASS' : 'FAIL', io.platform === 'linux' ? 'MATCH' : 'LINUX_REQUIRED', { matches: io.platform === 'linux' }, [], 'PLATFORM');
  if (ready('host.identity', ['host.platform'])) add('host.identity', io.uid === policy.projectUid ? 'PASS' : 'FAIL', io.uid === policy.projectUid ? 'MATCH' : 'PROJECT_UID_MISMATCH', { matches: io.uid === policy.projectUid });
  if (ready('host.os', ['host.platform'])) {
    try { const text = io.read('/etc/os-release'); const match = /^ID=(?:"ubuntu"|ubuntu)$/m.test(text) && /^VERSION_ID=(?:"26\.04"|26\.04)$/m.test(text); add('host.os', match ? 'PASS' : 'FAIL', match ? 'MATCH' : 'OS_NOT_BASELINE', { matches: match }); }
    catch (error) { add('host.os', 'UNKNOWN', 'READ_FAILED', null, ['host.platform'], 'READ_METADATA', { errno: errno(error) }); }
  }
  metadata('docker.socket', policy.socket, 'socket', ['host.identity']);
  metadata('docker.config', policy.dockerConfig, 'directory', ['host.identity']);
  metadata('docker.data-directory', policy.dataRoot, 'directory', ['host.identity']);
  const infoResult = await command('docker.info', 'docker.info', ['docker.socket', 'docker.config', 'docker.data-directory']);
  let info: Record<string, unknown> | null = null;
  if (infoResult) {
    try { const parsed: unknown = JSON.parse(infoResult.stdout); if (!isRecord(parsed)) throw new M1Error('JSON_SHAPE_INVALID'); info = parsed; add('docker.info', 'PASS', 'MATCH', { available: true }); }
    catch (error) { add('docker.info', 'UNKNOWN', error instanceof M1Error ? 'JSON_SHAPE_INVALID' : 'JSON_INVALID', null, [], 'PARSE'); }
  }
  for (const [id, field, predicate, failure] of [
    ['docker.rootless', 'SecurityOptions', (v: unknown) => Array.isArray(v) && v.every(x => typeof x === 'string') && v.includes('name=rootless'), 'DAEMON_NOT_ROOTLESS'],
    ['docker.data-root', 'DockerRootDir', (v: unknown) => v === policy.dataRoot, 'DATA_ROOT_MISMATCH'],
    ['docker.cgroup', 'CgroupVersion', (v: unknown) => String(v) === '2' && info?.CgroupDriver === 'systemd', 'CGROUP_CONFIGURATION_MISMATCH'],
  ] as const) {
    if (ready(id, ['docker.info'])) {
      if (!info || !Object.hasOwn(info, field) || id === 'docker.cgroup' && !Object.hasOwn(info, 'CgroupDriver')) add(id, 'UNKNOWN', 'INFO_FIELD_MISSING', null, ['docker.info'], 'PARSE');
      else if (id === 'docker.rootless' && (!Array.isArray(info[field]) || !(info[field] as unknown[]).every(v => typeof v === 'string')) || id === 'docker.data-root' && typeof info[field] !== 'string' || id === 'docker.cgroup' && (typeof info.CgroupDriver !== 'string' || !['string', 'number'].includes(typeof info[field]))) add(id, 'UNKNOWN', 'INFO_FIELD_INVALID', null, ['docker.info'], 'PARSE');
      else { const match = predicate(info[field]); add(id, match ? 'PASS' : 'FAIL', match ? 'MATCH' : failure, { matches: match }, ['docker.info']); }
    }
  }
  if (ready('docker.isolation', ['docker.rootless', 'docker.data-root', 'docker.cgroup'])) add('docker.isolation', 'PASS', 'MATCH', { matches: true }, ['docker.rootless', 'docker.data-root', 'docker.cgroup']);
  if (ready('docker.version', ['docker.info'])) {
    const version = normalizedVersion(info?.ServerVersion);
    versions.push({ component: 'docker', status: version ? 'PASS' : 'UNKNOWN', version });
    add('docker.version', version === '29.1.3' ? 'PASS' : version ? 'FAIL' : 'UNKNOWN', version === '29.1.3' ? 'MATCH' : version ? 'VERSION_NOT_BASELINE' : 'VERSION_INVALID', version ? { version } : null);
  }
  const composeVersion = await command('compose.version', 'compose.version', ['host.identity', 'docker.config']);
  if (composeVersion) {
    const v = normalizedVersion(composeVersion.stdout); versions.push({ component: 'compose', status: v ? 'PASS' : 'UNKNOWN', version: v });
    add('compose.version', v === '2.40.3' ? 'PASS' : v ? 'FAIL' : 'UNKNOWN', v === '2.40.3' ? 'MATCH' : v ? 'VERSION_NOT_BASELINE' : 'VERSION_INVALID', v ? { version: v } : null);
  }
  const model = await command('compose.security-model', 'compose.model', ['compose.version'], COMPOSE_MODEL);
  if (model) {
    try { const fields = securityMismatches(JSON.parse(model.stdout)); add('compose.security-model', fields.length ? 'FAIL' : 'PASS', fields.length ? 'COMPOSE_SECURITY_MISMATCH' : 'MATCH', { mismatches: fields }, ['compose.version']); }
    catch (error) { add('compose.security-model', 'UNKNOWN', error instanceof M1Error ? 'JSON_SHAPE_INVALID' : 'JSON_INVALID', null, ['compose.version'], 'PARSE'); }
  }
  // Optional Buildx is deliberately not executed: its plugin provenance is not yet part of this MVP policy.
  add('buildx.version', 'NOT_RUN', 'M1_COLLECTION_NOT_IMPLEMENTED');
  metadata('systemd.user-bus', `/run/user/${policy.projectUid}/bus`, 'socket', ['host.identity']);
  const manager = await command('systemd.manager', 'systemd.manager', ['systemd.user-bus']);
  if (manager) add('systemd.manager', /^Version=\d{3}(?:[. -][A-Za-z0-9.+~_-]+)?$/m.test(manager.stdout.trim()) ? 'PASS' : 'UNKNOWN', /^Version=\d{3}(?:[. -][A-Za-z0-9.+~_-]+)?$/m.test(manager.stdout.trim()) ? 'MATCH' : 'USER_MANAGER_RESPONSE_INVALID', null);
  for (const id of ['systemd.docker', 'systemd.agent'] as const) {
    const r = await command(id, id, ['systemd.manager']); if (!r) continue;
    const fields = Object.fromEntries(r.stdout.split(/\r?\n/).filter(s => /^(LoadState|ActiveState|SubState)=/.test(s)).map(s => s.split('=', 2)));
    if (fields.LoadState === 'not-found' && id === 'systemd.agent') add(id, 'NOT_RUN', 'NOT_INSTALLED', { installed: false });
    else if (fields.LoadState !== 'loaded' || !['active', 'inactive', 'failed', 'activating', 'deactivating'].includes(fields.ActiveState)) add(id, 'UNKNOWN', 'SERVICE_STATUS_INVALID');
    else if (id === 'systemd.docker' && fields.ActiveState !== 'active') add(id, 'FAIL', 'SERVICE_NOT_RUNNING', { active: false });
    else add(id, 'PASS', 'MATCH', { installed: true, state: fields.ActiveState as Observed['state'] });
  }
  if (ready('cgroup.controllers', ['docker.isolation'])) {
    try {
      const raw = io.read(`/sys/fs/cgroup/user.slice/user-${policy.projectUid}.slice/user@${policy.projectUid}.service/cgroup.controllers`);
      const present = new Set(raw.trim().split(/\s+/)); const match = ['cpu', 'memory', 'pids'].every(x => present.has(x));
      add('cgroup.controllers', match ? 'PASS' : 'FAIL', match ? 'MATCH' : 'CONTROLLERS_MISSING', { matches: match });
    } catch (error) { add('cgroup.controllers', 'UNKNOWN', 'READ_FAILED', null, ['docker.isolation'], 'READ_METADATA', { errno: errno(error) }); }
  }
  if (ready('storage.capacity', ['host.identity'])) {
    try { const match = io.capacity(policy.stateParent) >= BigInt(policy.minimumFreeBytes); add('storage.capacity', match ? 'PASS' : 'FAIL', match ? 'MATCH' : 'CAPACITY_BELOW_MINIMUM', { matches: match }); }
    catch (error) { add('storage.capacity', 'UNKNOWN', 'CAPACITY_UNAVAILABLE', null, [], 'READ_METADATA', { errno: errno(error) }); }
  }
  add('state.snapshot', 'NOT_RUN', 'M1_STORE_READER_NOT_IMPLEMENTED');
  guard();
  const report = {
    schemaVersion: 1, kind: 'lumina.deployment.diagnostics',
    tool: { version: '0.1.0-experimental', releaseDigest: ownDigest(), policyVersion: 1, productionApproved: false, provenance: 'UNATTESTED_M1' },
    capture: { at: new Date().toISOString(), durationMs: Math.ceil(performance.now() - start), readOnly: true, networkMode: 'NONE', scope: 'NONPRODUCTION_TEST', complete: checks.every(c => c.status === 'PASS' || c.status === 'FAIL') },
    subject: `host-${randomUUID()}`, versions, checks,
    state: { source: 'UNAVAILABLE' },
    capabilities: ['oneshot.lifecycle', 'rootless.limits', 'storage.power-loss', 'memory.hard-rss'].map(id => ({ id, requiredLayer: id === 'storage.power-loss' ? 'L3' : 'L2', result: 'NOT_RUN', reason: 'OUTSIDE_READ_ONLY_SCOPE' })),
    compatibilityCertified: false,
    summary: { pass: checks.filter(c => c.status === 'PASS').length, fail: checks.filter(c => c.status === 'FAIL').length, unknown: checks.filter(c => c.status === 'UNKNOWN').length, notRun: checks.filter(c => c.status === 'NOT_RUN').length, blocking: checks.filter(c => c.severity === 'BLOCKING' && c.status !== 'PASS').map(c => c.checkId), partialReason: checks.some(c => c.status === 'UNKNOWN' || c.status === 'NOT_RUN') ? 'OBSERVATIONS_INCOMPLETE' : null },
    redaction: { profileVersion: 1, pseudonyms: 'PER_REPORT', rawIncluded: false, omitted: ['PATHS', 'UIDS', 'RAW_OUTPUT', 'ENVIRONMENT', 'HOST_IDENTITY'] },
    budget: { deadlineMs: 45_000, outputBytesMaximum: 1_048_576, observedPeakRssBytes: io.peakRssBytes(), rssLimitBytes: 134_217_728, hardRssLimit: false },
  };
  assert(Buffer.byteLength(JSON.stringify(report)) <= 1_048_576, 'DIAGNOSTIC_OUTPUT_LIMIT');
  return report;
}
