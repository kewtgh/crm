import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { assert, createExperiment, exclusiveFile, experimentPath, sha256 } from '../src/safety.ts';
import { initializeStore, lookup, openStore, submit } from '../src/store.ts';

type Capability = { id: string; result: 'PASS' | 'FAIL' | 'NOT_RUN'; scope: 'LOCAL_NATIVE' | 'REPOSITORY_CONFIGURATION' | 'EXTERNAL_LINUX' | 'L2' | 'L3'; evidence: string; reason: string };
const args = process.argv.slice(2); assert(args.length === 2 && args[0] === '--output', 'ARGUMENT_INVALID');
const root = path.join(fs.realpathSync(os.tmpdir()), `lumina-m1-${randomUUID()}`), capabilities: Capability[] = [];
const started = performance.now();
const add = (id: string, result: Capability['result'], scope: Capability['scope'], evidence: string, reason: string) => capabilities.push({ id, result, scope, evidence, reason });
createExperiment(root);
try {
  initializeStore(root); const db = openStore(root, true);
  const sqliteVersion = String(db.prepare('SELECT sqlite_version() AS version').get()?.version); db.close();
  add('node.runtime', process.version === 'v24.22.1' ? 'PASS' : 'FAIL', 'LOCAL_NATIVE', 'process.version', 'PIN_COMPARISON');
  add('sqlite.transaction', 'PASS', 'LOCAL_NATIVE', 'real SQLite schema, SELECT and transaction', 'EMBEDDED_NO_SERVICE');
  submit(root, 'fictional-inventory-key', { delayMs: 1, mode: 'NORMAL' });
  const command = spawnSync(process.execPath, [fileURLToPath(new URL('../src/lifecycle-cli.ts', import.meta.url)), 'run', '--root', root], { encoding: 'utf8', timeout: 8000, windowsHide: true });
  const executed = command.status === 0 && lookup(root)?.state === 'COMPLETED';
  add('fictional-task.native-process', executed ? 'PASS' : 'FAIL', 'LOCAL_NATIVE', 'CLI child + SQLite + exclusive effect receipt', 'NO_DATABASE_OR_CONTAINER_TASK');
  add('linux.flock', process.platform !== 'linux' ? 'NOT_RUN' : executed ? 'PASS' : 'FAIL', process.platform === 'linux' ? 'EXTERNAL_LINUX' : 'LOCAL_NATIVE', 'worker validates its own /proc/locks identity', process.platform === 'linux' ? 'NATIVE_FLOCK_REQUIRED' : 'LINUX_UNAVAILABLE');
  add('linux.filesystem', process.platform !== 'linux' ? 'NOT_RUN' : executed ? 'PASS' : 'FAIL', 'LOCAL_NATIVE', 'fsync file and directory; normal execution only', process.platform === 'linux' ? 'NOT_POWER_LOSS_CERTIFICATION' : 'LINUX_UNAVAILABLE');
  let composePassed = false;
  if (process.env.M1_COMPOSE_BINARY) {
    const r = spawnSync(process.execPath, [fileURLToPath(new URL('./compose-integration.ts', import.meta.url))], { encoding: 'utf8', timeout: 12_000, maxBuffer: 65_536, windowsHide: true, env: { PATH: process.env.PATH ?? '', ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}), M1_COMPOSE_BINARY: process.env.M1_COMPOSE_BINARY } });
    composePassed = r.status === 0;
  }
  add('compose.actual-parser', composePassed ? 'PASS' : process.env.M1_COMPOSE_BINARY ? 'FAIL' : 'NOT_RUN', process.platform === 'linux' ? 'EXTERNAL_LINUX' : 'LOCAL_NATIVE', 'pinned 2.40.3 real config + malformed tmpfs regression; no daemon', composePassed ? 'PARSER_ONLY_NOT_ROOTLESS' : 'PINNED_COMPOSE_NOT_VALIDATED');
  let manager = false;
  if (process.platform === 'linux') {
    const uid = process.getuid?.();
    const r = spawnSync('/usr/bin/systemctl', ['--user', 'show', '--property=Version', '--no-pager'], { encoding: 'utf8', timeout: 1500, maxBuffer: 65_536, env: { PATH: '/usr/bin:/bin', XDG_RUNTIME_DIR: `/run/user/${uid}`, DBUS_SESSION_BUS_ADDRESS: `unix:path=/run/user/${uid}/bus` } });
    manager = r.status === 0 && /^Version=\d{3}/m.test(r.stdout);
  }
  add('systemd.user-manager.access', manager ? 'PASS' : 'NOT_RUN', 'L2', 'read-only fixed manager property', manager ? 'ACCESS_ONLY_NOT_LIFECYCLE' : 'MANAGER_NOT_VALIDATED');
  add('systemd.oneshot.lifecycle', 'NOT_RUN', 'L2', 'tests/systemd.test.mjs requires explicit isolated user-manager execution', 'NO_EXECUTED_L2_EVIDENCE');
  add('rootless.docker', 'NOT_RUN', 'L2', 'no approved project policy supplied; no daemon fallback', 'NO_ISOLATED_ROOTLESS_EVIDENCE');
  add('cgroup.v2.limits', 'NOT_RUN', 'L2', 'configuration alone is insufficient', 'NO_DYNAMIC_LIMIT_TEST');
  add('system.reboot', 'NOT_RUN', 'L3', 'no disposable reboot target provided', 'NO_ISOLATED_REBOOT_TARGET');
  add('storage.power-loss', 'NOT_RUN', 'L3', 'no disposable power-loss target provided', 'NO_ISOLATED_POWER_LOSS_TARGET');
  add('ci.linux.definition', 'NOT_RUN', 'REPOSITORY_CONFIGURATION', '.github/workflows/ci.yml and deployment-v2-m1.yml', 'CONFIGURED_NOT_EXECUTED_FOR_THIS_COMMIT');
  let wslExit: number | null = null;
  if (process.platform === 'win32') {
    const r = spawnSync('wsl.exe', ['--list', '--quiet'], { timeout: 5000, maxBuffer: 65_536, windowsHide: true }); wslExit = r.status;
  }
  const report = { schemaVersion: 1, kind: 'lumina.m1.capability-inventory', platform: process.platform, node: process.versions.node, sqlite: sqliteVersion, durationMs: Math.ceil(performance.now() - started), nativeTaskCompleted: executed, nativeLockProfile: process.platform === 'linux' ? 'LINUX_FLOCK' : 'WINDOWS_SQLITE_ONLY', sqliteBytes: fs.statSync(path.join(root, 'state.sqlite')).size, observedParentPeakRssBytes: process.resourceUsage().maxRSS * 1024, wslProbeExitCode: wslExit, capabilities, compatibleWithProduction: false };
  const bytes = `${JSON.stringify(report, null, 2)}\n`; exclusiveFile(path.resolve(args[1]), bytes);
  console.log(JSON.stringify({ result: 'WRITTEN', sha256: sha256(bytes), nativeCapabilities: capabilities.map(({ id, result }) => ({ id, result })), compatibleWithProduction: false }));
} finally { experimentPath(root); fs.rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }); }
