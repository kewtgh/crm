import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { assert, boundedRead, exclusiveFile, experiment, isRecord, sha256, trustedFile } from './safety.ts';
import { claim, lookup, observeResult, type Operation, type Task } from './store.ts';

export function nativeLockHeld(root: string) {
  if (process.platform !== 'linux') return false;
  trustedFile(path.join(root, 'write.lock'));
  const file = fs.lstatSync(path.join(root, 'write.lock'), { bigint: true });
  const dev = file.dev, major = ((dev >> 8n) & 0xfffn) | ((dev >> 32n) & 0xfffff000n), minor = (dev & 0xffn) | ((dev >> 12n) & 0xffffff00n);
  return fs.readFileSync('/proc/locks', 'utf8').split('\n').some(line => {
    const parts = line.trim().split(/\s+/);
    if (parts[1] !== 'FLOCK' || parts[3] !== 'WRITE' || Number(parts[4]) !== process.pid) return false;
    const [a, b, inode] = (parts[5] ?? '').split(':');
    return Boolean(a && b && inode) && BigInt(`0x${a}`) === major && BigInt(`0x${b}`) === minor && BigInt(inode) === file.ino;
  });
}
export function reexecuteWithLock(root: string, args: string[]) {
  const marker = experiment(root);
  if (marker.profile === 'WINDOWS_SQLITE_ONLY' || nativeLockHeld(root)) return null;
  trustedFile(path.join(root, 'write.lock'));
  const result = spawnSync('/usr/bin/flock', ['--nonblock', '--exclusive', '--conflict-exit-code=73', '--no-fork', path.join(root, 'write.lock'), process.execPath, fileURLToPath(new URL('./lifecycle-cli.ts', import.meta.url)), ...args], { stdio: 'inherit', timeout: 12_000, env: { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8' } });
  assert(!result.error, 'NATIVE_LOCK_UNAVAILABLE'); return result.status ?? 1;
}
function assertWorkerLock(root: string) { if (process.platform === 'linux') assert(nativeLockHeld(root), 'NATIVE_LOCK_REQUIRED'); }
function receiptFile(root: string, op: Operation) { return path.join(root, 'effects', `${op.id}.json`); }
export function receiptDigest(root: string, op: Operation) {
  const file = receiptFile(root, op);
  try { trustedFile(file); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
  const raw = boundedRead(file, 4096), value: unknown = JSON.parse(raw.toString());
  assert(isRecord(value) && Object.keys(value).sort().join(',') === 'digest,kind,operationId' && value.kind === 'FICTIONAL_EFFECT' && value.operationId === op.id && value.digest === op.digest, 'RECEIPT_CONFLICT');
  return sha256(raw);
}
export async function runFictionalTask(root: string) {
  experiment(root); assertWorkerLock(root);
  const op = claim(root);
  if (!op) return { result: 'NO_WORK' };
  const task = JSON.parse(op.task) as Task;
  if (task.mode === 'CRASH_BEFORE_EFFECT') process.exit(23);
  await new Promise(resolve => setTimeout(resolve, task.delayMs));
  exclusiveFile(receiptFile(root, op), JSON.stringify({ kind: 'FICTIONAL_EFFECT', operationId: op.id, digest: op.digest }));
  if (task.mode === 'CRASH_AFTER_EFFECT') process.exit(24);
  return observeResult(root, op.id, op.revision, receiptDigest(root, op));
}
export function reconcileFictional(root: string) {
  experiment(root); assertWorkerLock(root);
  const op = lookup(root);
  if (!op || op.state === 'QUEUED' || op.state === 'COMPLETED') return op ?? { result: 'NO_WORK' };
  if (op.worker_pid) {
    let active = true;
    try { process.kill(op.worker_pid, 0); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') active = false; }
    assert(!active, 'WORKER_STILL_ACTIVE'); // A live or inaccessible identity never permits reconciliation.
  }
  return observeResult(root, op.id, op.revision, receiptDigest(root, op));
}
export function systemdArguments(root: string) {
  const marker = experiment(root);
  assert(process.platform === 'linux' && process.getuid?.() !== 0 && marker.allowSystemd, 'ISOLATED_SYSTEMD_NOT_APPROVED');
  return ['--user', '--quiet', '--no-block', '--collect', `--unit=lumina-v2-m1-${marker.id}.service`, '--property=Type=oneshot', '--property=RemainAfterExit=no', '--property=Restart=no', '--property=KillMode=control-group', '--property=TimeoutStartSec=12s', '--property=MemoryMax=128M', '--property=TasksMax=64', '--property=UnsetEnvironment=NODE_OPTIONS HTTP_PROXY HTTPS_PROXY ALL_PROXY DOCKER_HOST DOCKER_CONTEXT', '--', process.execPath, fileURLToPath(new URL('./lifecycle-cli.ts', import.meta.url)), 'run', '--root', root];
}
