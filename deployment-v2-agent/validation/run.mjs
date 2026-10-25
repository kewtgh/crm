// Disposable hosted-runner harness. No imports into the Agent payload; no application tasks.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as delay } from 'node:timers/promises';
import { assertionDetail, emptyReport, harnessDetail, managerHealth, sha256 } from './contract.mjs';

const fixture = '/opt/lumina-m21-fixture', payload = `${fixture}/payload`;
const node = `${payload}/runtime/node`, cliFile = `${payload}/lib/cli.mjs`;
const unit = 'lumina-crm-deployment-v2-alpha.service';
const home = os.userInfo().homedir, lab = `${home}/lab`, units = `${home}/.config/systemd/user`;
assert(process.platform === 'linux' && process.getuid() !== 0);
assert(process.env.M21_DISPOSABLE_HOST === 'ACK_GITHUB_HOSTED_NONPRODUCTION');
assert(process.env.GITHUB_ACTIONS === 'true' && process.env.RUNNER_ENVIRONMENT === 'github-hosted');
assert(home === '/home/lumina-m21-fixture' && fs.readFileSync('/proc/1/comm', 'utf8').trim() === 'systemd');
// sudo may preserve a runner-owned cwd that a fresh UID cannot traverse (Python startup
// needs an accessible cwd). Every subprocess starts inside our private fixture instead.
assert.equal(fs.statSync(lab).uid, process.getuid()); process.chdir(lab);
const context = { sha: process.env.GITHUB_SHA, runId: process.env.GITHUB_RUN_ID,
  attempt: process.env.GITHUB_RUN_ATTEMPT, sourceDigest: process.env.M21_SOURCE_DIGEST };
const report = emptyReport(context);
const save = () => fs.writeFileSync(`${lab}/report.json`, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
save();
const failures = [];
let phase = 'ENVIRONMENT';
const result = (id, status, code = status === 'PASS' ? 'OBSERVED' : 'ASSERTION_FAILED') => {
  assert(Object.hasOwn(report.cases, id)); report.cases[id] = { status, code }; save();
  console.log(`${id}:${status}:${code}`);
};
async function check(ids, fn) {
  if (!Array.isArray(ids)) ids = [ids];
  try { await fn(); for (const id of ids) result(id, 'PASS'); }
  catch (error) {
    failures.push({ cases: ids, error: String(error.stack ?? error) });
    for (const id of ids) { result(id, 'FAIL'); report.cases[id].assertion = assertionDetail(error); } save();
  }
  finally { fs.writeFileSync(`${lab}/errors.json`, JSON.stringify(failures, null, 2), { mode: 0o600 }); }
}
function exec(file, args, timeout = 8000, options = {}) {
  const r = spawnSync(file, args, { encoding: 'utf8', timeout, maxBuffer: 131072, ...options });
  if (r.error || r.status !== 0) {
    const error = new Error('FIXTURE_COMMAND_FAILED');
    Object.assign(error, { command: path.basename(file), exitCode: r.status,
      managerState: file === '/usr/bin/systemctl' && args.includes('is-system-running') ? r.stdout?.trim() : null });
    throw error;
  }
  assert(!r.error && r.status === 0, JSON.stringify({ command: path.basename(file), status: r.status, error: r.error ? Reflect.get(r.error, 'code') : null, stderr: r.stderr?.slice(0, 4096) }));
  return r.stdout;
}
const systemctl = args => exec('/usr/bin/systemctl', ['--user', ...args]);
function show(name = unit) { return Object.fromEntries(systemctl(['show', name, '--no-pager']).trim().split('\n').map(s => { const n = s.indexOf('='); return [s.slice(0, n), s.slice(n + 1)]; })); }
const cli = args => JSON.parse(exec(node, [cliFile, ...args]));
/** @returns {Promise<{status: number | null, stdout: string, stderr: string}>} */
async function parallelCli(args) {
  const child = spawn(node, [cliFile, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = ''; child.stdout.on('data', d => { stdout += d; }); child.stderr.on('data', d => { stderr += d; });
  return await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('CLI_TIMEOUT')); }, 10000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', status => { clearTimeout(timer); resolve({ status, stdout, stderr }); });
  });
}
async function until(fn, ms = 12000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { try { const value = fn(); if (value) return value; } catch { /* Transient SQLite journal / unit startup is not success. */ } await delay(40); }
  throw new Error('OBSERVATION_TIMEOUT');
}
function query(root, sql, write = false) {
  const db = new DatabaseSync(`${root}/state.sqlite`, { readOnly: !write, timeout: 100 });
  try { if (write) { db.exec(sql); return {}; } return db.prepare(sql).get(); } finally { db.close(); }
}
const snapshot = root => cli(['status', '--root', root]);
async function fresh() {
  systemctl(['stop', unit]); spawnSync('/usr/bin/systemctl', ['--user', 'reset-failed', unit]);
  const root = `${lab}/lumina-v2-alpha-${randomUUID()}`;
  cli(['init', '--root', root, '--ack-nonproduction', '--allow-systemd']);
  const rendered = `${root}/review.service`;
  cli(['render-unit', '--root', root, '--output', rendered]);
  fs.copyFileSync(rendered, `${units}/${unit}`); fs.chmodSync(`${units}/${unit}`, 0o600);
  systemctl(['daemon-reload']); return root;
}
function request(root, delayMs = 3000) {
  const plan = cli(['plan', '--root', root, '--delay-ms', String(delayMs)]);
  const file = `${root}/request-${randomUUID()}.json`;
  fs.writeFileSync(file, JSON.stringify({ protocolVersion: 1, idempotencyKey: `fictional-${randomUUID()}`, ...plan }), { flag: 'wx', mode: 0o600 });
  return file;
}
function submit(root, file = request(root)) { return cli(['submit', '--root', root, '--request', file]); }
function dispatch(root) { assert.equal(cli(['dispatch', '--root', root]).completed, false); }
async function inactive(name = unit, ms = 12000) {
  return until(() => { const s = show(name); return Number(s.MainPID) === 0 && ['inactive', 'failed'].includes(s.ActiveState) && s; }, ms);
}
function readNumber(file) { return Number(fs.readFileSync(file, 'utf8').trim()); }
function cgroup(name = unit) { const group = show(name).ControlGroup; assert(group?.startsWith('/user.slice/')); return `/sys/fs/cgroup${group}`; }
function measure(group) {
  for (const [file, metric] of [['memory.peak', 'agentMemoryPeakBytes'], ['pids.current', 'agentTasksPeak']]) {
    if (fs.existsSync(`${group}/${file}`)) report.metrics[metric] = Math.max(report.metrics[metric] ?? 0, readNumber(`${group}/${file}`));
  }
  if (fs.existsSync(`${group}/cpu.stat`)) {
    const match = fs.readFileSync(`${group}/cpu.stat`, 'utf8').match(/^usage_usec (\d+)$/m);
    if (match) report.metrics.agentCpuUsageUsec = Math.max(report.metrics.agentCpuUsageUsec ?? 0, Number(match[1]));
  }
  const pids = fs.readFileSync(`${group}/cgroup.procs`, 'utf8').trim().split('\n').filter(Boolean);
  report.metrics.agentProcessPeak = Math.max(report.metrics.agentProcessPeak ?? 0, pids.length);
  let rss = 0;
  for (const pid of pids) { try { rss += Number(fs.readFileSync(`/proc/${pid}/status`, 'utf8').match(/^VmRSS:\s+(\d+) kB$/m)?.[1] ?? 0) * 1024; } catch { /* Process already exited. */ } }
  report.metrics.agentRssPeakBytes = Math.max(report.metrics.agentRssPeakBytes ?? 0, rss);
  save();
}
async function complete(root) {
  const s = await until(() => {
    const s = snapshot(root); if (s.state === 'COMPLETED') return s;
    const group = cgroup(); if (fs.existsSync(`${group}/cgroup.procs`)) measure(group);
    return false;
  });
  assert.equal(s.checkpoint, 'PROVEN'); assert.equal(s.grant, 'CONSUMED'); assert.equal(s.acceptedApplication, null);
  const end = await inactive();
  for (const [key, metric, scale] of [['MemoryPeak', 'agentMemoryPeakBytes', 1], ['CPUUsageNSec', 'agentCpuUsageUsec', 1000]]) {
    if (/^\d+$/.test(end[key])) report.metrics[metric] = Math.max(report.metrics[metric] ?? 0, Math.floor(Number(end[key]) / Number(scale)));
  }
  save(); return s;
}
function receiptCount(root) { return fs.readdirSync(`${root}/receipts`).length; }
function size(directory) { return fs.readdirSync(directory, { withFileTypes: true }).reduce((n, item) => n + (item.isDirectory() ? size(path.join(directory, item.name)) : item.isFile() ? fs.statSync(path.join(directory, item.name)).size : 0), 0); }

try {
  report.payloadDigest = sha256(fs.readFileSync(`${payload}/runtime-manifest.json`));
  report.metrics.payloadBytes = size(payload);
  const osRelease = fs.readFileSync('/etc/os-release', 'utf8');
  report.environment = { ubuntu: osRelease.match(/^VERSION_ID="([\d.]+)"/m)?.[1],
    kernel: os.release().match(/^[\d.]+/)?.[0], node: process.versions.node,
    systemd: exec('/usr/bin/systemctl', ['--version']).match(/^systemd (\d+)/)?.[1] };
  phase = 'CGROUP_CONTROLLERS';
  assert.equal(fs.readFileSync('/sys/fs/cgroup/cgroup.controllers', 'utf8').includes('memory'), true);
  phase = 'USER_MANAGER_HEALTH';
  const health = spawnSync('/usr/bin/systemctl', ['--user', 'is-system-running'], { encoding: 'utf8', timeout: 8000 });
  assert(!health.error); report.environment.managerState = managerHealth(health.status, health.stdout);
  // Probe the actual manager interface before loading / executing our fixed unit.
  assert.match(systemctl(['show', '--property=Version', '--value']).trim(), /^255(?:\D|$)/);
  phase = 'UNIT_DIRECTORY';
  fs.mkdirSync(units, { recursive: true, mode: 0o700 });
  // A harmless placeholder permits the first stop before installing the exact rendered unit.
  fs.writeFileSync(`${units}/${unit}`, '[Service]\nType=oneshot\nExecStart=/usr/bin/true\n', { mode: 0o600 });
  phase = 'UNIT_RELOAD'; systemctl(['daemon-reload']);
  phase = 'CASES';

  await check(['fixed-oneshot', 'cli-exit', 'unit-budget-config'], async () => {
    const root = await fresh(); submit(root); dispatch(root);
    await until(() => snapshot(root).checkpoint === 'INTENT');
    const s = show(), group = cgroup();
    assert.equal(s.Type, 'oneshot'); assert.equal(s.KillMode, 'control-group');
    assert.equal(s.Restart, 'no'); assert.equal(s.RemainAfterExit, 'no');
    assert.equal(readNumber(`${group}/memory.max`), 128 * 1024 ** 2);
    assert.equal(readNumber(`${group}/pids.max`), 32);
    const [quota, period] = fs.readFileSync(`${group}/cpu.max`, 'utf8').trim().split(' ').map(Number);
    assert.equal(quota / period, 1);
    Object.assign(report.metrics, { memoryMaxBytes: 134217728, tasksMax: 32, cpuQuotaUsec: quota, cpuPeriodUsec: period });
    for (let n = 0; n < 20; n++) { measure(group); await delay(30); }
    const final = await complete(root); assert.equal(final.unresolved, 0);
    report.metrics.stateBytes = size(root);
  });
  await check('pty-hangup', async () => {
    const root = await fresh(), file = request(root, 5000);
    const pty = spawnSync('/usr/bin/python3', [`${fixture}/validation/terminal-hangup.py`, node, cliFile, root, file], { encoding: 'utf8', timeout: 20000, maxBuffer: 4096 });
    assert(!pty.error); const r = JSON.parse(pty.stdout);
    if (!r.hangup) throw new Error(r.reason);
    assert.equal(pty.status, 0);
    assert.equal(r.hangup, true);
    // Manager still owns a running worker after the actual controlling terminal was closed.
    await until(() => Number(show().MainPID) > 0); await complete(root);
  });
  await check(['concurrent-admission', 'concurrent-dispatch', 'kernel-flock', 'grant-once'], async () => {
    const root = await fresh(), files = Array.from({ length: 4 }, () => request(root, 5000));
    const admissions = await Promise.all(files.map(file => parallelCli(['submit', '--root', root, '--request', file])));
    assert.equal(admissions.filter(r => r.status === 0).length, 1);
    assert.equal(query(root, 'SELECT count(*) AS n FROM operations').n, 1);
    const dispatches = await Promise.all(Array.from({ length: 4 }, () => parallelCli(['dispatch', '--root', root])));
    assert(dispatches.every(r => r.status === 0));
    await until(() => snapshot(root).checkpoint === 'INTENT');
    const busy = spawnSync(node, [cliFile, 'submit', '--root', root, '--request', files[0]], { encoding: 'utf8', timeout: 8000 });
    assert.equal(busy.status, 73); assert.match(busy.stderr, /PROJECT_LOCK_BUSY/);
    await complete(root); assert.equal(receiptCount(root), 1);
    const receipt = fs.readFileSync(`${root}/receipts/${fs.readdirSync(`${root}/receipts`)[0]}`);
    dispatch(root); await inactive();
    assert.equal(receiptCount(root), 1);
    assert.deepEqual(fs.readFileSync(`${root}/receipts/${fs.readdirSync(`${root}/receipts`)[0]}`), receipt);
    assert.equal(query(root, "SELECT count(*) AS n FROM events WHERE code='INTENT_DURABLE'").n, 1);
  });
  await check('timeout', async () => {
    const root = await fresh(); submit(root, request(root, 5000)); dispatch(root);
    await until(() => snapshot(root).checkpoint === 'INTENT');
    process.kill(Number(show().MainPID), 'SIGSTOP');
    const end = await inactive(unit, 22000); assert.equal(end.Result, 'timeout');
    assert.equal(snapshot(root).grant, 'CONSUMED');
    // Timeout is not evidence of no effect: SIGCONT can run an already-ready timer.
    const before = fs.readdirSync(`${root}/receipts`).map(name => [name, sha256(fs.readFileSync(`${root}/receipts/${name}`))]);
    // A new start without a new grant cannot replay the stopped operation.
    systemctl(['reset-failed', unit]); dispatch(root); await inactive();
    assert.deepEqual(fs.readdirSync(`${root}/receipts`).map(name => [name, sha256(fs.readFileSync(`${root}/receipts/${name}`))]), before);
    assert.equal(query(root, "SELECT count(*) AS n FROM events WHERE code='INTENT_DURABLE'").n, 1);
  });
  await check('explicit-reconcile', async () => {
    const root = await fresh(), op = submit(root, request(root, 5000)); dispatch(root);
    await until(() => snapshot(root).checkpoint === 'INTENT');
    systemctl(['kill', '--kill-whom=all', '--signal=SIGKILL', unit]);
    await inactive(); assert.equal(receiptCount(root), 0);
    const old = snapshot(root);
    assert.equal(old.checkpoint, 'INTENT'); assert.equal(old.grant, 'CONSUMED');
    cli(['reconcile', '--root', root, '--operation', op.operationId, '--revision', String(old.operationRevision)]);
    systemctl(['reset-failed', unit]); dispatch(root); await inactive();
    const after = snapshot(root); assert.equal(after.checkpoint, 'UNKNOWN');
    assert.equal(after.state, 'RECOVERY_REQUIRED'); assert.equal(after.grant, 'CONSUMED'); assert.equal(receiptCount(root), 0);
  });
  await check('receipt-reconcile', async () => {
    const root = await fresh(), op = submit(root, request(root, 100));
    // TEST-ONLY SQLite fault injection. This is not claimed as disk/power-loss evidence.
    query(root, "CREATE TRIGGER fixture_abort BEFORE UPDATE OF state ON operations WHEN NEW.state='COMPLETED' BEGIN SELECT RAISE(ABORT,'FICTIONAL_TRANSACTION_ABORT'); END;", true);
    dispatch(root); const end = await inactive(); assert.equal(end.Result, 'exit-code');
    assert.equal(receiptCount(root), 1); const name = `${root}/receipts/${fs.readdirSync(`${root}/receipts`)[0]}`;
    const before = fs.readFileSync(name), time = fs.statSync(name).mtimeMs;
    const old = snapshot(root); assert.equal(old.checkpoint, 'INTENT'); assert.equal(old.grant, 'CONSUMED');
    query(root, 'DROP TRIGGER fixture_abort;', true);
    cli(['reconcile', '--root', root, '--operation', op.operationId, '--revision', String(old.operationRevision)]);
    systemctl(['reset-failed', unit]); dispatch(root); await complete(root);
    assert.deepEqual(fs.readFileSync(name), before); assert.equal(fs.statSync(name).mtimeMs, time); assert.equal(receiptCount(root), 1);
  });
  await check('idle-zero-agent', async () => {
    const s = await inactive(); assert.equal(Number(s.MainPID), 0);
    const workerArgument = `${payload}/lib/worker.mjs`;
    const found = fs.readdirSync('/proc').filter(pid => /^\d+$/.test(pid)).some(pid => {
      try { return fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').includes(workerArgument); } catch { return false; }
    });
    assert.equal(found, false);
  });

  // Exact candidate budget, independent test-only stress unit; Agent ExecStart stays unchanged.
  for (const mode of ['memory', 'cpu', 'tasks', 'children']) {
    const id = mode === 'children' ? 'child-group-cleanup' : `unit-${mode}-enforced`;
    await check(id, async () => {
      const name = `lumina-m21-${mode}.service`, output = `${lab}/${mode}.json`;
      const text = `[Service]\nType=oneshot\nExecStart=${node} ${fixture}/validation/resource-probe.mjs ${mode} self\nMemoryMax=128M\nCPUQuota=100%\nTasksMax=32\nKillMode=control-group\nTimeoutStartSec=${mode === 'children' ? 3 : 12}s\nTimeoutStopSec=2s\nRestart=no\nStandardOutput=file:${output}\n`;
      fs.writeFileSync(`${units}/${name}`, text, { mode: 0o600 }); systemctl(['daemon-reload']);
      systemctl(['start', '--no-block', name]);
      const group = await until(() => { const s = show(name); return Number(s.MainPID) > 0 && `/sys/fs/cgroup${s.ControlGroup}`; });
      const end = await inactive(name, 18000);
      if (mode === 'memory' && end.Result === 'oom-kill') { assert.equal(end.ExecMainCode, '2'); assert.equal(end.ExecMainStatus, '9'); }
      else if (mode === 'children') { assert.equal(end.Result, 'timeout'); assert.equal(JSON.parse(fs.readFileSync(output, 'utf8')).children, true); }
      else {
        assert.equal(end.Result, 'success'); const pressure = JSON.parse(fs.readFileSync(output, 'utf8')); assert.equal(pressure.enforced, true);
        if (mode === 'memory') Object.assign(report.metrics, { pressureMemoryCurrentBytes: pressure.memoryCurrentBytes,
          pressureMemoryMaxEvents: pressure.maxEventsDelta, pressureSwapCurrentBytes: pressure.swapCurrentBytes });
      }
      assert(!fs.existsSync(`${group}/cgroup.procs`) || fs.readFileSync(`${group}/cgroup.procs`, 'utf8').trim() === '');
    });
  }
  await rootless();
  for (const id of ['reboot', 'power-loss', 'disk-fault']) result(id, 'NOT_RUN', 'EXTERNAL_FIXTURE_REQUIRED');
  result('target-ubuntu-profile', 'NOT_RUN', 'TARGET_PROFILE_NOT_MATCHED');
  report.completed = true; save();
} catch (error) {
  report.harnessFailure = harnessDetail({ phase, command: error.command, exitCode: error.exitCode,
    managerState: error.managerState, assertion: assertionDetail(error) });
  failures.push({ cases: ['harness'], error: String(error.stack ?? error) });
  fs.writeFileSync(`${lab}/errors.json`, JSON.stringify(failures, null, 2), { mode: 0o600 }); save();
} finally {
  // These services and the identity exist only in this disposable hosted VM.
  spawnSync('/usr/bin/systemctl', ['--user', 'stop', unit, 'lumina-m21-rootless.service',
    'lumina-m21-memory.service', 'lumina-m21-cpu.service', 'lumina-m21-tasks.service', 'lumina-m21-children.service'], { timeout: 15000, stdio: 'ignore' });
}
process.exitCode = failures.length || !report.completed ? 1 : 0;

async function rootless() {
  const ids = ['rootless-isolation', 'rootless-budget-config', 'rootless-memory-enforced', 'rootless-cpu-enforced', 'rootless-tasks-enforced'];
  const missing = code => { for (const id of ids) result(id, 'NOT_RUN', code); };
  const daemon = ['/usr/bin/dockerd-rootless.sh', '/usr/bin/rootlesskit', '/usr/bin/newuidmap', '/usr/bin/newgidmap'];
  const absent = daemon.filter(file => !fs.existsSync(file));
  if (absent.length) { report.rootlessMissing = absent.map(file => path.basename(file)); missing('ROOTLESS_PREREQUISITE_MISSING'); return; }
  const socket = `/run/user/${process.getuid()}/docker.sock`, dataRoot = `${lab}/docker-data`;
  const rootlessUnit = 'lumina-m21-rootless.service';
  fs.writeFileSync(`${units}/${rootlessUnit}`, `[Service]\nType=simple\nExecStart=/usr/bin/dockerd-rootless.sh --host=unix://${socket} --data-root=${dataRoot} --exec-opt native.cgroupdriver=systemd\nDelegate=yes\nKillMode=mixed\nTimeoutStopSec=10\nRestart=no\n`, { mode: 0o600 });
  systemctl(['daemon-reload']); systemctl(['start', '--no-block', rootlessUnit]);
  const docker = (args, timeout = 10000) => exec('/usr/bin/docker', ['--host', `unix://${socket}`, ...args], timeout);
  try { await until(() => fs.existsSync(socket) && JSON.parse(docker(['info', '--format', '{{json .}}'])), 35000); }
  catch { missing('ROOTLESS_START_FAILED'); return; }
  let info;
  await check('rootless-isolation', async () => {
    info = JSON.parse(docker(['info', '--format', '{{json .}}']));
    assert(info.SecurityOptions.some(s => s.includes('rootless'))); assert.equal(info.DockerRootDir, dataRoot);
    assert.equal(fs.statSync(socket).uid, process.getuid()); assert.equal(fs.statSync(dataRoot).uid, process.getuid());
    assert.equal(info.CgroupVersion, '2'); assert.equal(info.CgroupDriver, 'systemd');
    report.environment.docker = info.ServerVersion.match(/^[\d.]+/)?.[0];
    const pid = Number(show(rootlessUnit).MainPID);
    assert(pid > 0);
    const sumRss = group => {
      let total = 0;
      for (const entry of fs.readdirSync(group, { withFileTypes: true })) if (entry.isDirectory()) total += sumRss(`${group}/${entry.name}`);
      for (const member of fs.readFileSync(`${group}/cgroup.procs`, 'utf8').trim().split('\n').filter(Boolean)) {
        try { total += Number(fs.readFileSync(`/proc/${member}/status`, 'utf8').match(/^VmRSS:\s+(\d+) kB$/m)?.[1] ?? 0) * 1024; } catch { /* Exited process. */ }
      }
      return total;
    };
    report.metrics.rootlessDaemonRssBytes = sumRss(`/sys/fs/cgroup${show(rootlessUnit).ControlGroup}`);
  });
  if (report.cases['rootless-isolation'].status !== 'PASS') return;
  const controllers = fs.readFileSync(`/sys/fs/cgroup/user.slice/user-${process.getuid()}.slice/user@${process.getuid()}.service/cgroup.controllers`, 'utf8');
  if (!['cpu', 'memory', 'pids'].every(c => controllers.split(/\s+/).includes(c))) {
    for (const id of ids.slice(1)) result(id, 'NOT_RUN', 'CONTROLLER_NOT_DELEGATED'); return;
  }
  const image = 'node:24.22.1-bookworm-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205';
  try { docker(['pull', image], 90000); } catch { for (const id of ids.slice(1)) result(id, 'NOT_RUN', 'ROOTLESS_PULL_FAILED'); return; }
  const probe = `${fixture}/validation/resource-probe.mjs`;
  for (const mode of ['config', 'cpu', 'tasks', 'memory']) {
    const id = mode === 'config' ? 'rootless-budget-config' : `rootless-${mode}-enforced`;
    await check(id, async () => {
      const name = `lumina-m21-${mode}`;
      docker(['create', '--name', name, '--network=none', '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges',
        '--memory=128m', '--memory-swap=128m', '--cpus=1', '--pids-limit=32',
        '--mount', `type=bind,source=${probe},target=/probe.mjs,readonly`, image, 'node', '/probe.mjs', mode === 'memory' ? 'memory-oom' : mode, '/sys/fs/cgroup']);
      try {
        const before = JSON.parse(docker(['inspect', name]))[0];
        assert.equal(before.HostConfig.Memory, 134217728); assert.equal(before.HostConfig.NanoCpus, 1000000000); assert.equal(before.HostConfig.PidsLimit, 32);
        docker(['start', name]);
        await until(() => { const s = JSON.parse(docker(['inspect', name]))[0].State; return !s.Running && s; }, 18000);
        const s = JSON.parse(docker(['inspect', name]))[0].State;
        if (mode === 'memory') { assert.equal(s.OOMKilled, true); assert.equal(s.ExitCode, 137); }
        else { assert.equal(s.ExitCode, 0); assert.equal(JSON.parse(docker(['logs', name]))[mode === 'config' ? 'configured' : 'enforced'], true); }
      } finally { docker(['rm', '--force', name]); }
    });
  }
  save(); // Actual daemon allocated disk is measured by the disposable host coordinator.
}
