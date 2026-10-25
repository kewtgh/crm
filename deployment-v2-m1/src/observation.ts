import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { assert } from './safety.ts';

export const ERRNOS = ['ENOENT', 'EACCES', 'EPERM', 'ETIMEDOUT', 'EIO', 'EROFS', 'ENOSPC', 'EBUSY', 'EINVAL', 'UNKNOWN'] as const;
export type Errno = typeof ERRNOS[number];
export function errno(error: unknown): Errno {
  const value = (error as NodeJS.ErrnoException | undefined)?.code;
  return ERRNOS.includes(value as Errno) ? value as Errno : 'UNKNOWN';
}
type CommandResult = { ok: true; stdout: string; exitCode: 0 } | { ok: false; reason: 'TIMEOUT' | 'OUTPUT_LIMIT' | 'SPAWN_FAILED' | 'NONZERO_EXIT' | 'EXECUTABLE_UNTRUSTED'; errno: Errno | null; exitCode: number | null };
export type ReadResult = CommandResult & { durationMs: number };
export const COMMANDS = ['docker.info', 'compose.version', 'compose.model', 'buildx.version', 'systemd.manager', 'systemd.docker', 'systemd.agent'] as const;
export type CommandId = typeof COMMANDS[number];
export type Policy = { schemaVersion: 1; projectUid: number; socket: string; dataRoot: string; dockerConfig: string; composeBinary: '/usr/libexec/docker/cli-plugins/docker-compose' | '/usr/lib/docker/cli-plugins/docker-compose'; stateParent: string; minimumFreeBytes: number };
export type Environment = Record<string, string>;
export function cleanEnvironment(policy: Policy): Environment {
  return { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8', DOCKER_HOST: `unix://${policy.socket}`, DOCKER_CONFIG: policy.dockerConfig, COMPOSE_DISABLE_ENV_FILE: 'true', XDG_RUNTIME_DIR: `/run/user/${policy.projectUid}`, DBUS_SESSION_BUS_ADDRESS: `unix:path=/run/user/${policy.projectUid}/bus` };
}
export function commandSpec(id: CommandId, policy: Policy): { file: string; args: string[] } {
  switch (id) {
    case 'docker.info': return { file: '/usr/bin/docker', args: ['info', '--format', '{{json .}}'] };
    case 'compose.version': return { file: policy.composeBinary, args: ['version', '--short'] };
    case 'compose.model': return { file: policy.composeBinary, args: ['--project-name', 'lumina-m1-diagnostics', '--file', '-', 'config', '--format', 'json', '--no-interpolate'] };
    case 'buildx.version': return { file: '/usr/bin/docker', args: ['buildx', 'version'] };
    case 'systemd.manager': return { file: '/usr/bin/systemctl', args: ['--user', 'show', '--property=Version', '--no-pager'] };
    case 'systemd.docker': return { file: '/usr/bin/systemctl', args: ['--user', 'show', 'docker.service', '--property=LoadState,ActiveState,SubState', '--no-pager'] };
    case 'systemd.agent': return { file: '/usr/bin/systemctl', args: ['--user', 'show', 'lumina-crm-deployment-v2.service', '--property=LoadState,ActiveState,SubState', '--no-pager'] };
  }
}
export function remaining(deadline: number, commandMaximum = 3000) { return Math.max(0, Math.min(commandMaximum, Math.floor(deadline - performance.now()))); }
export async function boundedCommand(file: string, args: string[], env: Environment, timeoutMs: number, input?: string, group: 'leader' | 'inherit' = 'leader'): Promise<ReadResult> {
  const started = performance.now();
  if (timeoutMs < 1) return { ok: false, reason: 'TIMEOUT', errno: 'ETIMEDOUT', exitCode: null, durationMs: 0 };
  return new Promise(resolve => {
    let bytes = 0, settled = false, limit = false, expired = false;
    const chunks: Buffer[] = [];
    const child = spawn(file, args, { env, windowsHide: true, detached: process.platform !== 'win32' && group === 'leader', stdio: ['pipe', 'pipe', 'pipe'] });
    const terminate = () => {
      if (!child.pid) return;
      try {
        if (process.platform !== 'win32') { if (group === 'leader') process.kill(-child.pid, 'SIGKILL'); else child.kill('SIGKILL'); }
        else if (child.exitCode === null) {
          spawnSync(path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe'), ['/PID', String(child.pid), '/T', '/F'], { timeout: 1000, windowsHide: true, stdio: 'ignore' });
          child.kill('SIGKILL');
        }
      } catch { /* Already exited. */ }
    };
    const done = (result: CommandResult) => {
      if (settled) return; settled = true; clearTimeout(timer);
      resolve({ ...result, durationMs: Math.ceil(performance.now() - started) } as ReadResult);
    };
    const timer = setTimeout(() => { expired = true; terminate(); done({ ok: false, reason: 'TIMEOUT', errno: 'ETIMEDOUT', exitCode: null }); }, timeoutMs);
    const consume = (chunk: Buffer, stdout: boolean) => {
      bytes += chunk.length;
      if (bytes > 262_144) { limit = true; terminate(); done({ ok: false, reason: 'OUTPUT_LIMIT', errno: null, exitCode: null }); }
      else if (stdout) chunks.push(chunk);
    };
    child.stdout.on('data', (c: Buffer) => consume(c, true));
    child.stderr.on('data', (c: Buffer) => consume(c, false)); // Count, never return or log raw stderr.
    child.stdin.on('error', () => {});
    child.once('error', e => done({ ok: false, reason: 'SPAWN_FAILED', errno: errno(e), exitCode: null }));
    child.once('close', code => {
      if (expired || limit) return;
      if (code === 0) done({ ok: true, stdout: Buffer.concat(chunks).toString('utf8'), exitCode: 0 });
      else done({ ok: false, reason: 'NONZERO_EXIT', errno: null, exitCode: Number.isInteger(code) && Number(code) >= 0 && Number(code) <= 255 ? code : null });
    });
    child.stdin.end(input);
  });
}
export function rootExecutable(file: string) {
  const s = fs.lstatSync(file);
  assert(s.isFile() && !s.isSymbolicLink() && s.uid === 0 && (s.mode & 0o022) === 0 && fs.realpathSync(file) === file, 'EXECUTABLE_UNTRUSTED');
  // Reject writable ancestors; an executable's own owner alone cannot establish trust.
  let directory = file.slice(0, file.lastIndexOf('/'));
  while (directory) {
    const p = fs.lstatSync(directory);
    assert(p.isDirectory() && !p.isSymbolicLink() && p.uid === 0 && (p.mode & 0o022) === 0, 'EXECUTABLE_UNTRUSTED');
    directory = directory.slice(0, directory.lastIndexOf('/'));
  }
}
