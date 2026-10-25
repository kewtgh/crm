import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { assert, boundedRead, sha256, sitePolicy, trustedFile } from './common.ts';

// Native flock identity follows the M1 experiment; no lock emulation on Linux.
export function nativeLockHeld(root: string) {
  if (process.platform !== 'linux') return false;
  const f = path.join(root, 'write.lock'); trustedFile(f); const s = fs.lstatSync(f, { bigint: true });
  const major = ((s.dev >> 8n) & 0xfffn) | ((s.dev >> 32n) & 0xfffff000n), minor = (s.dev & 0xffn) | ((s.dev >> 12n) & 0xffffff00n);
  return fs.readFileSync('/proc/locks', 'utf8').split('\n').some(line => {
    const p = line.trim().split(/\s+/); if (p[1] !== 'FLOCK' || p[3] !== 'WRITE' || Number(p[4]) !== process.pid) return false;
    const [a, b, inode] = (p[5] ?? '').split(':');
    return Boolean(a && b && inode) && BigInt(`0x${a}`) === major && BigInt(`0x${b}`) === minor && BigInt(inode) === s.ino;
  });
}
export function assertWriterLock(root: string) { sitePolicy(root); if (process.platform === 'linux') assert(nativeLockHeld(root), 'NATIVE_LOCK_REQUIRED'); }
export function lockedReexecution(root: string, entry: 'cli' | 'worker', args: string[]) {
  const p = sitePolicy(root); if (p.profile === 'WINDOWS_SQLITE_ONLY' || nativeLockHeld(root)) return null;
  trustedFile(path.join(root, 'write.lock'));
  const r = spawnSync('/usr/bin/flock', ['--nonblock', '--exclusive', '--conflict-exit-code=73', '--no-fork', path.join(root, 'write.lock'), process.execPath, '--max-old-space-size=64', fileURLToPath(new URL(`./${entry}.mjs`, import.meta.url)), ...args], { stdio: 'inherit', timeout: 15_000, env: { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8', ...(process.env.INVOCATION_ID ? { INVOCATION_ID: process.env.INVOCATION_ID } : {}) } });
  const spawnCode = (r.error as NodeJS.ErrnoException | undefined)?.code;
  assert(!r.error, spawnCode === 'ETIMEDOUT' ? 'NATIVE_LOCK_TIMEOUT' : spawnCode === 'ENOENT' ? 'NATIVE_LOCK_EXECUTABLE_MISSING' : 'NATIVE_LOCK_UNAVAILABLE');
  if (r.status === 73) process.stderr.write(`${JSON.stringify({ code: 'PROJECT_LOCK_BUSY' })}\n`);
  return r.status ?? 1;
}
export type ExecutionIdentity = { pid: number; boot: string; start: string; invocation: string; managerInvocation: string | null };
function startTicks(pid: number) { const raw = fs.readFileSync(`/proc/${pid}/stat`, 'utf8'); return raw.slice(raw.lastIndexOf(')') + 2).trim().split(/\s+/)[19]; }
export function executionIdentity(): ExecutionIdentity {
  const boot = process.platform === 'linux' ? fs.readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim() : 'WINDOWS_UNVERIFIED';
  const start = process.platform === 'linux' ? startTicks(process.pid) : 'UNVERIFIED';
  return { pid: process.pid, boot, start, invocation: randomUUID(), managerInvocation: /^[0-9a-f]{32}$/.test(process.env.INVOCATION_ID ?? '') ? process.env.INVOCATION_ID! : null };
}
export function executionActive(i: ExecutionIdentity) {
  if (process.platform === 'linux') {
    if (fs.readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim() !== i.boot) return false;
    try { return startTicks(i.pid) === i.start; } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; return true; }
  }
  try { process.kill(i.pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code !== 'ESRCH'; }
}
export const UNIT_NAME = 'lumina-crm-deployment-v2-alpha.service';
export function renderUnit(root: string, runtimeRoot: string) {
  const p = sitePolicy(root); assert(p.allowSystemd && process.platform === 'linux' && process.getuid?.() !== 0, 'ISOLATED_USER_MANAGER_REQUIRED');
  for (const value of [root, runtimeRoot]) assert(/^\/[A-Za-z0-9_./-]+$/.test(value) && path.resolve(value) === value, 'UNIT_PATH_UNSAFE');
  return `[Unit]\nDescription=Lumina isolated Deployment Alpha (no application release)\n\n[Service]\nType=oneshot\nExecStart=/usr/bin/flock --nonblock --exclusive --conflict-exit-code=73 --no-fork ${root}/write.lock ${runtimeRoot}/runtime/node --max-old-space-size=64 ${runtimeRoot}/lib/worker.mjs --root ${root}\nRemainAfterExit=no\nRestart=no\nKillMode=control-group\nTimeoutStartSec=15s\nTimeoutStopSec=2s\nMemoryMax=128M\nCPUQuota=100%\nTasksMax=32\nUMask=0077\nNoNewPrivileges=yes\nUnsetEnvironment=NODE_OPTIONS DOCKER_HOST DOCKER_CONTEXT HTTP_PROXY HTTPS_PROXY ALL_PROXY\n`;
}
export function dispatch(root: string, runtimeRoot: string) {
  const expected = renderUnit(root, runtimeRoot), uid = process.getuid?.();
  const env = { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8', XDG_RUNTIME_DIR: `/run/user/${uid}`, DBUS_SESSION_BUS_ADDRESS: `unix:path=/run/user/${uid}/bus` };
  const unitPath = path.join(os.userInfo().homedir, '.config/systemd/user', UNIT_NAME);
  try { trustedFile(unitPath, false); } catch (error) { assert((error as NodeJS.ErrnoException).code !== 'ENOENT', 'UNIT_NOT_INSTALLED'); throw error; }
  assert(sha256(boundedRead(unitPath)) === sha256(expected), 'UNIT_CONTENT_MISMATCH');
  const show = spawnSync('/usr/bin/systemctl', ['--user', 'show', UNIT_NAME, '--property=LoadState,FragmentPath,DropInPaths,NeedDaemonReload', '--no-pager'], { env, encoding: 'utf8', timeout: 2000, maxBuffer: 16_384 });
  assert(!show.error && show.status === 0, 'USER_MANAGER_UNAVAILABLE');
  const values = Object.fromEntries(show.stdout.trim().split('\n').map(s => { const index = s.indexOf('='); return [s.slice(0, index), s.slice(index + 1)]; }));
  assert(values.LoadState === 'loaded' && values.FragmentPath === unitPath && values.DropInPaths === '' && values.NeedDaemonReload === 'no', 'UNIT_LOADED_IDENTITY_MISMATCH');
  const r = spawnSync('/usr/bin/systemctl', ['--user', 'start', '--no-block', UNIT_NAME], { env, encoding: 'utf8', timeout: 2000, maxBuffer: 16_384 });
  assert(!r.error && r.status === 0, 'SYSTEMD_DISPATCH_FAILED'); return { dispatch: 'ENQUEUED', completed: false };
}
