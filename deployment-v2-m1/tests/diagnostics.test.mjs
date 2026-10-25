import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fixture, hostFixture, model, policy, diagnosticEntry } from './helpers.mjs';
import { collectDiagnostics, normalizedVersion, validatePolicy } from '../src/diagnostics.ts';
import { reportSchema } from '../src/report-schema.ts';
import { boundedCommand, cleanEnvironment, commandSpec } from '../src/observation.ts';
import { memoryBytes, securityMismatches } from '../src/compose.ts';

const require = createRequire(import.meta.url), Ajv = require('../../node_modules/ajv');
// Schema uses the shared assertion vocabulary only. Ajv6 validates that subset;
// it is not presented as a complete draft-2020-12 metaschema engine.
const compatibleSchema = structuredClone(reportSchema); delete compatibleSchema.$schema;
const validate = new Ajv({ allErrors: true }).compile(compatibleSchema);
const check = (r, id) => r.checks.find(c => c.checkId === id);

test('JSON schema matches its generator and rejects private/unexpected fields', async () => {
  assert.deepEqual(JSON.parse(fs.readFileSync(new URL('../schemas/diagnostics-v1.schema.json', import.meta.url), 'utf8')), reportSchema);
  const { io } = hostFixture(), report = await collectDiagnostics(policy, io);
  assert.equal(validate(report), true, JSON.stringify(validate.errors));
  for (const alter of [r => { r.hostname = 'fictional-private-marker'; }, r => { r.checks[0].observed.path = 'fictional-private-marker'; }, r => { r.compatibilityCertified = true; }, r => { r.tool.productionApproved = true; }]) {
    const changed = structuredClone(report); alter(changed); assert.equal(validate(changed), false);
  }
});
test('fixture host observations are never promoted to dynamic compatibility', async () => {
  const { io } = hostFixture(), report = await collectDiagnostics(policy, io);
  assert.equal(check(report, 'docker.isolation').status, 'PASS');
  assert.equal(check(report, 'systemd.agent').code, 'NOT_INSTALLED');
  assert.equal(report.compatibilityCertified, false); assert.equal(report.tool.productionApproved, false);
  assert.ok(report.capabilities.every(c => c.result === 'NOT_RUN'));
  assert.equal(report.budget.hardRssLimit, false);
});
test('socket EACCES keeps the first cause and downstream checks are NOT_RUN', async () => {
  const { io, calls } = hostFixture(); const original = io.metadata;
  io.metadata = file => { if (file === policy.socket) throw Object.assign(new Error('FICTIONAL_PRIVATE_SOCKET'), { code: 'EACCES' }); return original(file); };
  const report = await collectDiagnostics(policy, io);
  assert.equal(check(report, 'docker.socket').status, 'UNKNOWN');
  assert.equal(check(report, 'docker.socket').code, 'METADATA_PERMISSION_DENIED');
  assert.equal(check(report, 'docker.socket').errno, 'EACCES');
  for (const id of ['docker.info', 'docker.rootless', 'docker.data-root', 'docker.isolation']) assert.equal(check(report, id).status, 'NOT_RUN');
  assert.ok(!calls.some(c => c.id === 'docker.info'));
  assert.doesNotMatch(JSON.stringify(report), /FICTIONAL_PRIVATE_SOCKET/);
});
for (const [field, value, expected] of [['SecurityOptions', ['name=seccomp'], 'DAEMON_NOT_ROOTLESS'], ['DockerRootDir', '/fictional-other-scope', 'DATA_ROOT_MISMATCH'], ['CgroupVersion', '1', 'CGROUP_CONFIGURATION_MISMATCH'], ['SecurityOptions', null, 'INFO_FIELD_INVALID']]) test(`typed first cause for Docker ${field} / ${expected}`, async () => {
  const { io } = hostFixture(), original = io.command;
  io.command = async (...args) => { const r = await original(...args); if (args[0] === 'docker.info') { const v = JSON.parse(r.stdout); v[field] = value; r.stdout = JSON.stringify(v); } return r; };
  const report = await collectDiagnostics(policy, io);
  assert.ok(report.checks.some(c => c.code === expected));
  assert.equal(check(report, 'docker.isolation').status, 'NOT_RUN');
  assert.doesNotMatch(JSON.stringify(report), /fictional-other-scope/);
});
for (const [stdout, code] of [['{', 'JSON_INVALID'], ['[]', 'JSON_SHAPE_INVALID']]) test(`malformed daemon output reports ${code}`, async () => {
  const { io } = hostFixture(), original = io.command;
  io.command = async (...args) => args[0] === 'docker.info' ? { ok: true, stdout, exitCode: 0, durationMs: 1 } : original(...args);
  const report = await collectDiagnostics(policy, io); assert.equal(check(report, 'docker.info').code, code); assert.equal(check(report, 'docker.rootless').status, 'NOT_RUN');
});
test('raw output, version suffixes, UID and paths cannot cross positive extraction', async () => {
  const { io } = hostFixture(), original = io.command;
  io.command = async (...args) => {
    const r = await original(...args);
    if (args[0] === 'docker.info') { const v = JSON.parse(r.stdout); v.Secret = 'FICTIONAL_PRIVATE_MARKER'; v.ServerVersion = '29.1.3-FICTIONAL_PRIVATE_MARKER'; r.stdout = JSON.stringify(v); }
    return r;
  };
  const report = await collectDiagnostics(policy, io), text = JSON.stringify(report);
  for (const marker of ['FICTIONAL_PRIVATE_MARKER', policy.socket, policy.dataRoot, '"projectUid"']) assert.ok(!text.includes(marker));
  assert.equal(check(report, 'docker.version').code, 'VERSION_INVALID');
  assert.equal(validate(report), true, JSON.stringify(validate.errors));
});
test('policy cannot supply arbitrary commands, remote contexts or rootful socket', () => {
  assert.throws(() => validatePolicy({ ...policy, command: 'arbitrary' }));
  assert.throws(() => validatePolicy({ ...policy, socket: 'tcp://example.invalid:2375' }));
  assert.throws(() => validatePolicy({ ...policy, socket: '/var/run/docker.sock' }));
  const env = cleanEnvironment(policy); assert.equal(env.DOCKER_CONTEXT, undefined); assert.equal(env.NODE_OPTIONS, undefined); assert.equal(env.HTTPS_PROXY, undefined);
  for (const id of ['docker.info', 'compose.version', 'compose.model', 'systemd.manager', 'systemd.docker', 'systemd.agent']) assert.ok(!commandSpec(id, policy).args.some(a => /^(?:start|restart|up|run|exec|pull|load|prune|install)$/.test(a)));
});
test('native command runner bounds timeout and output and never forwards raw stderr', async () => {
  const env = { ...process.env, NODE_OPTIONS: '' };
  assert.equal((await boundedCommand(process.execPath, ['-e', 'setTimeout(()=>{},30000)'], env, 60)).reason, 'TIMEOUT');
  const flood = await boundedCommand(process.execPath, ['-e', 'process.stdout.write("X".repeat(300000))'], env, 1000);
  assert.equal(flood.reason, 'OUTPUT_LIMIT'); assert.equal(flood.stdout, undefined);
  const stderr = await boundedCommand(process.execPath, ['-e', 'process.stderr.write("FICTIONAL_PRIVATE_MARKER");process.exit(7)'], env, 1000);
  assert.equal(stderr.reason, 'NONZERO_EXIT'); assert.equal(stderr.exitCode, 7); assert.doesNotMatch(JSON.stringify(stderr), /FICTIONAL_PRIVATE_MARKER/);
});
test('RSS over budget rejects the capture, memory enforcement is not misrepresented', async () => {
  const { io } = hostFixture({ peakRssBytes: () => 129 * 1024 ** 2 });
  await assert.rejects(collectDiagnostics(policy, io), { code: 'DIAGNOSTIC_MEMORY_LIMIT' });
});
test('Compose semantic checks retain exact safety and accept byte-equivalent memory', () => {
  const v = model(); assert.deepEqual(securityMismatches(v), []);
  v.services.web.mem_limit = 536870912; assert.deepEqual(securityMismatches(v), []);
  v.services.web.tmpfs = ['/tmp:rw', 'noexec', 'nosuid', 'nodev']; assert.ok(securityMismatches(v).includes('tmpfs'));
  assert.equal(memoryBytes('512m'), 536870912n); assert.equal(memoryBytes('512-MARKER'), null);
  assert.equal(normalizedVersion('2.40.3+ds1-0ubuntu1'), '2.40.3'); assert.equal(normalizedVersion('2.40.3-private'), null);
});
test('standalone CLI emits bounded JSON and cannot overwrite an output', t => {
  const root = fixture(t), policyFile = path.join(root, 'policy.json'), output = path.join(root, 'diagnostic.json');
  fs.writeFileSync(policyFile, JSON.stringify(policy), { mode: 0o600 });
  const args = ['--max-old-space-size=48', diagnosticEntry(root), '--policy', policyFile, '--output', output];
  const first = spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 5000 });
  assert.equal(first.status, 3, first.stderr); const before = fs.readFileSync(output);
  assert.equal(validate(JSON.parse(before)), true, JSON.stringify(validate.errors));
  assert.equal(spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 5000 }).status, 1);
  assert.deepEqual(fs.readFileSync(output), before);
});
test('supervisor preserves fixed worker failure reasons without forwarding policy contents', t => {
  const root = fixture(t), p = path.join(root, 'invalid-policy.json'); fs.writeFileSync(p, '{FICTIONAL_PRIVATE_MARKER');
  const result = spawnSync(process.execPath, ['--max-old-space-size=48', diagnosticEntry(root), '--policy', p, '--output', path.join(root, 'out.json')], { encoding: 'utf8', timeout: 5000 });
  assert.equal(result.status, 1); assert.equal(JSON.parse(result.stderr).code, 'POLICY_JSON_INVALID');
  assert.doesNotMatch(result.stderr + result.stdout, /FICTIONAL_PRIVATE_MARKER|invalid-policy/);
});
