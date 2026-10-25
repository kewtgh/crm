// Disposable external test coordinator. Not part of buildRuntime and not an Agent task.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { failureDetail, sha256 } from './contract.mjs';

assert(process.platform === 'linux' && process.getuid() !== 0);
assert(process.env.M22_ACK === 'NONPRODUCTION_DISPOSABLE' && process.env.GITHUB_ACTIONS === 'true' && process.env.RUNNER_ENVIRONMENT === 'github-hosted');
const base = '/opt/lumina-m22-fixture', payload = `${base}/payload`, home = os.userInfo().homedir;
assert.equal(home, '/home/lumina-m22-fixture');
const lab = `${home}/lab`, units = `${home}/.config/systemd/user`, reportFile = `${lab}/report.json`;
process.chdir(lab); fs.mkdirSync(units, { recursive: true, mode: 0o700 });
const report = JSON.parse(fs.readFileSync(reportFile, 'utf8')), errors = [];
const agent = 'lumina-crm-deployment-v2-alpha.service', daemonUnit = 'lumina-m22-rootless.service', expectedFailure = 'lumina-m22-expected-failure.service';
const owned = [agent, daemonUnit, expectedFailure]; let phase = 'SETUP';
const save = () => fs.writeFileSync(reportFile, JSON.stringify(report, null, 2), { mode: 0o600 });
const mark = (id, status, reason = status === 'PASS' ? 'OBSERVED' : 'CHECK_FAILED') => { report.cases[id] = { status, reason, phase }; save(); };
async function check(id, fn) { try { await fn(); mark(id, 'PASS'); } catch (e) { errors.push({ id, error: String(e.stack ?? e), stderr: e.privateStderr }); mark(id, 'FAIL'); report.cases[id].failure = failureDetail(e); save(); fs.writeFileSync(`${lab}/errors.json`, JSON.stringify(errors), { mode: 0o600 }); } }
function exec(file, args, timeout = 8000, options = {}) {
  const r = spawnSync(file, args, { encoding: 'utf8', timeout, maxBuffer: 131072, ...options });
  if (r.error || r.status !== 0) { const error = new Error('COMMAND_FAILED');
    Object.assign(error, { command: path.basename(file), exitCode: r.status, errno: r.error ? Reflect.get(r.error, 'code') : null,
      privateStderr: r.stderr?.slice(-4000) }); throw error;
  }
  return r.stdout;
}
const ctl = args => exec('/usr/bin/systemctl', ['--user', ...args]);
const show = name => Object.fromEntries(ctl(['show', name, '--no-pager']).trim().split('\n').map(s => { const n = s.indexOf('='); return [s.slice(0, n), s.slice(n + 1)]; }));
const cli = args => JSON.parse(exec(`${payload}/runtime/node`, [`${payload}/lib/cli.mjs`, ...args]));
async function until(fn, ms = 15000) { const end = Date.now() + ms; while (Date.now() < end) { try { const value = fn(); if (value) return value; } catch {} await delay(50); } throw new Error('OBSERVATION_TIMEOUT'); }
function failedUnits() { return new Set(JSON.parse(ctl(['list-units', '--all', '--state=failed', '--output=json', '--no-pager'])).map(s => s.unit)); }
function health() { const r = spawnSync('/usr/bin/systemctl', ['--user', 'is-system-running'], { encoding: 'utf8', timeout: 2000 }); const state = r.stdout?.trim(); assert(['running', 'degraded'].includes(state)); return state; }
function install(name, text) { assert(owned.includes(name)); fs.writeFileSync(`${units}/${name}`, text, { mode: 0o600 }); ctl(['daemon-reload']); }
function numeric(file) { return Number(fs.readFileSync(file, 'utf8').trim()); }
function sample(name) {
  const s = show(name); assert(s.ControlGroup?.startsWith('/user.slice/'));
  const group = `/sys/fs/cgroup${s.ControlGroup}`, ids = new Set();
  function visit(dir) { for (const p of fs.readFileSync(`${dir}/cgroup.procs`, 'utf8').trim().split('\n').filter(Boolean)) ids.add(p);
    for (const d of fs.readdirSync(dir, { withFileTypes: true })) if (d.isDirectory()) visit(`${dir}/${d.name}`); }
  visit(group); let rss = 0, tasks = 0;
  for (const pid of ids) { try { const data = fs.readFileSync(`/proc/${pid}/status`, 'utf8'); rss += Number(data.match(/^VmRSS:\s+(\d+) kB$/m)?.[1] ?? 0) * 1024; tasks += Number(data.match(/^Threads:\s+(\d+)$/m)?.[1] ?? 0); } catch {} }
  return { rss, tasks, processes: ids.size, peak: numeric(`${group}/memory.peak`),
    cpu: Number(fs.readFileSync(`${group}/cpu.stat`, 'utf8').match(/^usage_usec (\d+)$/m)?.[1] ?? 0), group };
}
const rootlessIds = ['rootless-isolation', 'rootless-kernel-config', 'rootless-memory', 'rootless-cpu', 'rootless-pids', 'rootless-compose'];
const missingRootless = reason => rootlessIds.forEach(id => mark(id, 'NOT_RUN', reason));
const find = names => names.find(file => fs.existsSync(file));
function logicalBytes(dir) { return fs.readdirSync(dir, { withFileTypes: true }).reduce((n, d) => n + (d.isDirectory() ? logicalBytes(`${dir}/${d.name}`) : d.isFile() ? fs.statSync(`${dir}/${d.name}`).size : 0), 0); }
const engineRoot = `${base}/engine`, profile = report.profile;
const engineDirs = `${base}/bin:/usr/sbin:/usr/bin:/bin`;
const dockerBin = profile === '24.04' ? '/usr/bin/docker' : find([`${engineRoot}/usr/bin/docker`]);
const rootlessScript = find([`${engineRoot}/usr/bin/dockerd-rootless.sh`, `${engineRoot}/usr/share/docker.io/contrib/dockerd-rootless.sh`, '/usr/bin/dockerd-rootless.sh']);
const pluginDirs = [`${engineRoot}/usr/libexec/docker/cli-plugins`, `${engineRoot}/usr/lib/docker/cli-plugins`];
const compose = find(pluginDirs.map(dir => `${dir}/docker-compose`));
const buildx = find(pluginDirs.map(dir => `${dir}/docker-buildx`));
const socket = `/run/user/${process.getuid()}/docker.sock`, dataRoot = `${lab}/docker-data`;
const dockerEnv = { ...process.env, PATH: engineDirs, DOCKER_HOST: `unix://${socket}`, DOCKER_CONFIG: `${lab}/docker-client` };
const docker = (args, timeout = 12000) => exec(dockerBin, ['--host', `unix://${socket}`, ...args], timeout, { env: dockerEnv });
let baseline;
try {
  report.payloadDigest = sha256(fs.readFileSync(`${payload}/runtime-manifest.json`));
  report.metrics.payloadBytes = logicalBytes(payload);
  report.environment.node = process.versions.node; report.environment.kernel = os.release().match(/^[\d.]+/)?.[0];
  report.environment.systemd = exec('/usr/bin/systemctl', ['--version']).match(/^systemd (\d+)/)?.[1];
  if (fs.existsSync('/usr/bin/rootlesskit')) report.environment.rootlesskit = exec('/usr/bin/rootlesskit', ['--version']).match(/\b(\d+\.\d+\.\d+)\b/)?.[1];
  report.facts.enginePackageUnchanged = true;
  await check('ubuntu', async () => { assert.equal(report.environment.ubuntu, profile); assert.equal(fs.readFileSync('/proc/1/comm', 'utf8').trim(), 'systemd'); });
  phase = 'MANAGER';
  await check('manager-available', async () => { report.environment.managerBefore = await until(() => health(), 5000); baseline = failedUnits(); report.metrics.baselineFailedUnits = baseline.size;
    report.managerFailures = [...baseline].map(name => { const s = show(name); return {
      kind: name.startsWith('dbus') ? 'DBUS' : name.includes('gpg') ? 'GPG' : name.includes('keyring') ? 'KEYRING' : 'OTHER',
      exitCode: Number(s.ExecMainStatus ?? 0), result: s.Result }; });
    assert.match(ctl(['show', '--property=Version', '--value']), /^\d+/); });
  assert(baseline);
  await check('manager-failure-attribution', async () => {
    install(expectedFailure, '[Service]\nType=oneshot\nExecStart=/usr/bin/false\nRestart=no\n');
    spawnSync('/usr/bin/systemctl', ['--user', 'start', expectedFailure], { timeout: 3000 });
    const after = failedUnits(); assert(after.has(expectedFailure)); assert.equal(show(expectedFailure).ExecMainStatus, '1');
    report.metrics.injectedFailedUnits = after.size; report.environment.managerAfterInjection = health();
    assert.equal(report.environment.managerAfterInjection, 'degraded');
    ctl(['reset-failed', expectedFailure]); assert.deepEqual(failedUnits(), baseline);
  });
  phase = 'AGENT';
  const root = `${lab}/lumina-v2-alpha-${randomUUID()}`;
  await check('agent-fictional-oneshot', async () => {
    cli(['init', '--root', root, '--ack-nonproduction', '--allow-systemd']);
    cli(['render-unit', '--root', root, '--output', `${units}/${agent}`]); ctl(['daemon-reload']);
    const plan = cli(['plan', '--root', root, '--delay-ms', '4000']);
    const file = `${root}/request.json`; fs.writeFileSync(file, JSON.stringify({ protocolVersion: 1, idempotencyKey: `fictional-${randomUUID()}`, ...plan }), { flag: 'wx', mode: 0o600 });
    cli(['submit', '--root', root, '--request', file]); cli(['dispatch', '--root', root]);
    await until(() => cli(['status', '--root', root]).checkpoint === 'INTENT');
    await check('agent-budget', async () => {
      const s = sample(agent); assert.equal(numeric(`${s.group}/memory.max`), 134217728); assert.equal(numeric(`${s.group}/pids.max`), 32);
      const [quota, period] = fs.readFileSync(`${s.group}/cpu.max`, 'utf8').trim().split(' ').map(Number); assert.equal(quota / period, 1);
      Object.assign(report.metrics, { agentMemoryPeakBytes: s.peak, agentRssBytes: s.rss, agentProcesses: s.processes, agentTasks: s.tasks, agentCpuUsec: s.cpu });
    });
    await until(() => cli(['status', '--root', root]).state === 'COMPLETED');
    const s = cli(['status', '--root', root]); assert.equal(s.checkpoint, 'PROVEN'); assert.equal(s.grant, 'CONSUMED'); assert.equal(s.acceptedApplication, null);
    await until(() => Number(show(agent).MainPID) === 0); report.facts.agentIdle = true;
    report.metrics.stateBytes = fs.statSync(`${root}/state.sqlite`).size;
  });
  phase = 'SETUP';
  for (const [id, binary, expected] of [['target-compose', compose, '2.40.3'], ['target-buildx', buildx, '0.30.1']]) {
    const key = id.slice(7);
    if (!binary) { mark(id, 'NOT_RUN', 'PACKAGES_UNAVAILABLE'); continue; }
    await check(id, async () => { const value = exec(binary, ['version'], 8000, { env: dockerEnv }).match(/\b(?:v)?(\d+\.\d+\.\d+)\b/)?.[1];
      report.environment[key] = value; assert.equal(value, expected); });
  }
  phase = 'DAEMON';
  if (!dockerBin || !rootlessScript || !fs.existsSync('/usr/bin/rootlesskit') || !fs.existsSync('/usr/bin/newuidmap')) missingRootless('HELPER_UNAVAILABLE');
  else await rootless();
  if (!report.environment.engine) mark('target-engine', 'NOT_RUN', 'PACKAGES_UNAVAILABLE');
  else if (report.environment.engine === '29.1.3' && profile === '26.04') mark('target-engine', 'PASS');
  else mark('target-engine', 'NOT_RUN', 'TARGET_VERSION_MISMATCH');
  const target = ['ubuntu', 'target-engine', 'target-compose', 'target-buildx', 'rootless-isolation', 'rootless-kernel-config', 'rootless-memory', 'rootless-cpu', 'rootless-pids', 'rootless-compose'];
  if (profile === '26.04' && target.every(id => report.cases[id].status === 'PASS')) mark('target-combination', 'PASS');
  else mark('target-combination', 'NOT_RUN', 'TARGET_VERSION_MISMATCH');
  mark('reboot', 'NOT_RUN', 'EXTERNAL_FIXTURE_REQUIRED'); mark('disk-fault', 'NOT_RUN', 'EXTERNAL_FIXTURE_REQUIRED');
} catch (e) { errors.push({ phase, error: String(e.stack ?? e), stderr: e.privateStderr }); }
finally {
  phase = 'CLEANUP';
  await check('fixture-cleanup', async () => {
    for (const name of owned) if (fs.existsSync(`${units}/${name}`)) {
      ctl(['stop', name]); spawnSync('/usr/bin/systemctl', ['--user', 'reset-failed', name], { timeout: 3000 });
    }
    report.facts.daemonStopped = !fs.existsSync(`${units}/${daemonUnit}`) || Number(show(daemonUnit).MainPID) === 0;
    const after = failedUnits(); report.metrics.remainingFixtureFailures = owned.filter(name => after.has(name)).length;
    report.metrics.baselineFailuresAfter = after.size; assert.deepEqual(after, baseline);
    report.facts.baselineFailuresPreserved = true; report.environment.managerAfterCleanup = health();
    assert.equal(report.metrics.remainingFixtureFailures, 0);
  });
  report.completed = errors.every(e => e.id); save();
  fs.writeFileSync(`${lab}/errors.json`, JSON.stringify(errors), { mode: 0o600 });
}
process.exitCode = errors.length || !report.completed ? 1 : 0;

async function rootless() {
  const script = `[Service]\nType=simple\nEnvironment=PATH=${engineDirs}\nExecStart=${rootlessScript} --host=unix://${socket} --data-root=${dataRoot} --exec-opt native.cgroupdriver=systemd\nDelegate=yes\nKillMode=mixed\nTimeoutStopSec=10s\nRestart=no\n`;
  install(daemonUnit, script); ctl(['start', '--no-block', daemonUnit]);
  try { await until(() => fs.existsSync(socket) && JSON.parse(docker(['info', '--format', '{{json .}}'])), 30000); }
  catch {
    const r = spawnSync('/usr/bin/journalctl', ['--user', '--unit', daemonUnit, '--no-pager', '--output=cat', '--lines=60'], { encoding: 'utf8', timeout: 3000, maxBuffer: 32768 });
    const log = r.stdout ?? ''; fs.writeFileSync(`${lab}/daemon-start.private.log`, log, { mode: 0o600 });
    const reason = /operation not permitted|userns|AppArmor/i.test(log) ? 'ROOTLESSKIT_USERNS_DENIED'
      : /Failed to connect to bus|cgroup.*delegat/i.test(log) ? 'CGROUP_USER_BUS_UNAVAILABLE'
      : /executable file not found|command not found|no such file/i.test(log) ? 'ENGINE_RUNTIME_MISSING'
      : /failed to start daemon|invalid argument/i.test(log) ? 'ENGINE_CONFIGURATION_REJECTED' : 'UNCLASSIFIED_PRIVATE_LOG';
    report.daemonFailure = { reason, exitCode: Number(show(daemonUnit).ExecMainStatus) };
    missingRootless('DAEMON_START_FAILED'); return;
  }
  const sampleDaemon = suffix => { const s = sample(daemonUnit); Object.assign(report.metrics,
    { [`daemonRss${suffix}Bytes`]: s.rss, [`daemonProcesses${suffix}`]: s.processes, [`daemonTasks${suffix}`]: s.tasks,
      daemonMemoryPeakBytes: s.peak, daemonCpuUsec: s.cpu }); save(); };
  await check('rootless-isolation', async () => {
    const info = JSON.parse(docker(['info', '--format', '{{json .}}'])); report.environment.engine = info.ServerVersion.match(/^[\d.]+/)?.[0];
    assert(info.SecurityOptions.some(v => v.includes('rootless'))); assert.equal(info.DockerRootDir, dataRoot);
    assert.equal(fs.statSync(socket).uid, process.getuid()); assert.equal(fs.statSync(dataRoot).uid, process.getuid());
    assert.equal(info.CgroupVersion, '2'); assert.equal(info.CgroupDriver, 'systemd');
    const group = `/sys/fs/cgroup${show(daemonUnit).ControlGroup}`;
    const daemonPids = fs.readFileSync(`${group}/cgroup.procs`, 'utf8').trim().split('\n').filter(Boolean);
    const hostPid = daemonPids.find(pid => { try { return fs.readFileSync(`/proc/${pid}/comm`, 'utf8').trim() === 'dockerd'; } catch { return false; } });
    assert(hostPid); const mapping = fs.readFileSync(`/proc/${hostPid}/uid_map`, 'utf8').trim().split('\n')[0].trim().split(/\s+/).map(Number);
    assert.deepEqual(mapping, [0, process.getuid(), 1]);
    Object.assign(report.facts, { dedicatedUid: process.getuid() !== 0, socketOwned: true, dataRootOwned: true,
      rootlessReported: true, cgroupV2: true, systemdDriver: true }); sampleDaemon('Before');
  });
  if (report.cases['rootless-isolation'].status !== 'PASS') return;
  const controllers = fs.readFileSync(`/sys/fs/cgroup/user.slice/user-${process.getuid()}.slice/user@${process.getuid()}.service/cgroup.controllers`, 'utf8').split(/\s+/);
  report.facts.controllersDelegated = ['cpu', 'memory', 'pids'].every(c => controllers.includes(c));
  if (!report.facts.controllersDelegated) { for (const id of rootlessIds.slice(1)) mark(id, 'NOT_RUN', 'CONTROLLERS_UNAVAILABLE'); return; }
  const image = 'node:24.22.1-bookworm-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205';
  try { docker(['pull', image], 75000); } catch { for (const id of rootlessIds.slice(1)) mark(id, 'NOT_RUN', 'IMAGE_PULL_FAILED'); return; }
  for (const mode of ['config', 'cpu', 'pids', 'memory']) {
    phase = mode.toUpperCase(); const id = mode === 'config' ? 'rootless-kernel-config' : `rootless-${mode}`;
    await check(id, async () => {
      const name = `lumina-m22-${mode}`;
      docker(['create', '--name', name, '--network=none', '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges',
        '--memory=128m', '--memory-swap=128m', '--cpus=1', '--pids-limit=32',
        '--mount', `type=bind,source=${base}/validation,target=/fixtures/validation,readonly`,
        '--mount', `type=bind,source=${base}/validation-m22,target=/fixtures/validation-m22,readonly`,
        image, 'node', '/fixtures/validation-m22/probe.mjs', mode === 'pids' ? 'tasks' : mode === 'memory' ? 'memory-oom' : mode, '/sys/fs/cgroup']);
      try {
        docker(['start', name]); const state = await until(() => { const s = JSON.parse(docker(['inspect', name]))[0].State; return !s.Running && s; }, 20000);
        const lines = docker(['logs', name]).trim().split('\n').map(line => JSON.parse(line));
        const before = lines.find(v => v.stage === 'BEFORE'), after = lines.find(v => v.stage === 'AFTER');
        report.kernel[mode] = { ...(after ?? before), exitCode: state.ExitCode, oomKilled: state.OOMKilled }; save();
        assert.equal(before.memoryMax, 134217728); assert.equal(before.swapMax, 0); assert.equal(before.cpuQuota / before.cpuPeriod, 1); assert.equal(before.pidsMax, 32);
        if (mode === 'memory') { assert.equal(state.ExitCode, 137); assert.equal(state.OOMKilled, true); }
        else { assert.equal(state.ExitCode, 0); assert(after); if (mode === 'cpu') { assert(after.nrThrottled > before.nrThrottled); assert(after.throttledUsec > before.throttledUsec); }
          if (mode === 'pids') assert(after.pidsMaxEvents > before.pidsMaxEvents); }
      } finally { docker(['rm', '--force', name]); }
    });
  }
  phase = 'COMPOSE';
  if (!compose) mark('rootless-compose', 'NOT_RUN', 'PACKAGES_UNAVAILABLE');
  else await check('rootless-compose', async () => {
    const yaml = `${lab}/compose.yaml`; fs.writeFileSync(yaml, `services:\n  fictional:\n    image: ${image}\n    network_mode: none\n    read_only: true\n    cap_drop: [ALL]\n    security_opt: [no-new-privileges:true]\n    mem_limit: 128m\n    memswap_limit: 128m\n    cpus: 1\n    pids_limit: 32\n    command: [node, -e, "console.log('FICTIONAL_ROOTLESS_COMPOSE')"]\n`, { mode: 0o600 });
    const args = ['--project-name', 'lumina-m22-fictional', '--file', yaml];
    try { const value = exec(compose, [...args, 'run', '--rm', '--no-deps', 'fictional'], 20000, { env: dockerEnv }); assert.match(value, /FICTIONAL_ROOTLESS_COMPOSE/); }
    finally { exec(compose, [...args, 'down', '--remove-orphans'], 15000, { env: dockerEnv }); }
  });
  sampleDaemon('After');
}
