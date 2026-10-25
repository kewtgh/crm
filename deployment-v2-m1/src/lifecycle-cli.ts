import { spawnSync } from 'node:child_process';
import { assert, createExperiment, M1Error, safeError } from './safety.ts';
import { initializeStore, lookup, submit, type Task } from './store.ts';
import { reconcileFictional, reexecuteWithLock, runFictionalTask, systemdArguments } from './lifecycle.ts';

async function main() {
  const [command, ...args] = process.argv.slice(2), options: Record<string, string> = {};
  for (let i = 0; i < args.length; i += 2) {
    assert(['--root', '--key', '--delay-ms', '--mode', '--allow-systemd'].includes(args[i]) && args[i + 1] !== undefined && !Object.hasOwn(options, args[i]), 'ARGUMENT_INVALID');
    options[args[i]] = args[i + 1];
  }
  const root = options['--root']; assert(root, 'ARGUMENT_INVALID');
  if (command === 'init') {
    assert(!options['--allow-systemd'] || options['--allow-systemd'] === 'ACK_NONPRODUCTION', 'ARGUMENT_INVALID');
    const marker = createExperiment(root, Boolean(options['--allow-systemd'])); initializeStore(root); return marker;
  }
  if (command === 'status') {
    const op = lookup(root); return op ? { operationId: op.id, state: op.state, grant: op.grant, revision: op.revision } : { state: 'IDLE' };
  }
  if (['submit', 'run', 'reconcile'].includes(command)) {
    const exit = reexecuteWithLock(root, process.argv.slice(2)); if (exit !== null) { process.exitCode = exit; return null; }
  }
  if (command === 'submit') {
    const op = submit(root, options['--key'] ?? '', { delayMs: Number(options['--delay-ms'] ?? '10'), mode: (options['--mode'] ?? 'NORMAL') as Task['mode'] });
    return { operationId: op.id, state: op.state, grant: op.grant };
  }
  if (command === 'run') { const op = await runFictionalTask(root); const usage = process.resourceUsage(); return { result: 'state' in op ? op.state : op.result, resources: { peakRssBytes: usage.maxRSS * 1024, cpuMicroseconds: usage.userCPUTime + usage.systemCPUTime } }; }
  if (command === 'reconcile') { const op = reconcileFictional(root); return { result: 'state' in op ? op.state : op.result }; }
  if (command === 'dispatch') {
    const r = spawnSync('/usr/bin/systemd-run', systemdArguments(root), { encoding: 'utf8', timeout: 3000, maxBuffer: 65_536, env: { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8', XDG_RUNTIME_DIR: `/run/user/${process.getuid?.()}`, DBUS_SESSION_BUS_ADDRESS: `unix:path=/run/user/${process.getuid?.()}/bus` } });
    assert(!r.error && r.status === 0, 'SYSTEMD_DISPATCH_UNAVAILABLE'); return { dispatch: 'ENQUEUED', completed: false };
  }
  throw new M1Error('ARGUMENT_INVALID');
}
try { const result = await main(); if (result !== null) process.stdout.write(`${JSON.stringify(result)}\n`); }
catch (error) { process.stderr.write(`${JSON.stringify({ code: safeError(error) })}\n`); process.exitCode = 1; }
