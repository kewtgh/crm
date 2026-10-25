import fs from 'node:fs';
import path from 'node:path';
import { assert, boundedRead, createSite, exclusiveFile, runtimeIdentity, safeError, sitePolicy } from './common.ts';
import { dispatch, lockedReexecution, renderUnit } from './platform.ts';
import { admit, authorizeReconcile, initializeStore, type Operation } from './store.ts';
import { readonlySnapshot } from './readonly.ts';
import { makePlan, planDigest } from './protocol.ts';

function options(args: string[], allowed: string[], flags: string[] = []) {
  const result: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const key = args[i]; assert(allowed.includes(key) && !Object.hasOwn(result, key), 'ARGUMENT_INVALID');
    if (flags.includes(key)) result[key] = 'true';
    else { assert(args[i + 1] !== undefined && !args[i + 1].startsWith('--'), 'ARGUMENT_INVALID'); result[key] = args[++i]; }
  }
  assert(result['--root'], 'ARGUMENT_INVALID'); return result;
}
const summary = (op: Operation) => ({ operationId: op.id, state: op.state, revision: op.revision });
async function main() {
  const [command, ...args] = process.argv.slice(2), runtime = runtimeIdentity();
  const allowed: Record<string, string[]> = { init: ['--root', '--ack-nonproduction', '--allow-systemd'], status: ['--root'], plan: ['--root', '--delay-ms', '--output'], submit: ['--root', '--request'], reconcile: ['--root', '--operation', '--revision'], dispatch: ['--root'], 'render-unit': ['--root', '--output'] };
  assert(Object.hasOwn(allowed, command), 'COMMAND_NOT_ALLOWED');
  const o = options(args, allowed[command], ['--ack-nonproduction', '--allow-systemd']), root = path.resolve(o['--root']);
  if (command === 'init') {
    assert(o['--ack-nonproduction'], 'ALPHA_ACK_REQUIRED');
    if (!fs.existsSync(root)) createSite(root, runtime.digest, Boolean(o['--allow-systemd']));
    else assert(sitePolicy(root).agentDigest === runtime.digest, 'AGENT_BINDING_MISMATCH');
    const exit = lockedReexecution(root, 'cli', process.argv.slice(2)); if (exit !== null) { process.exitCode = exit; return; }
    initializeStore(root, runtime.digest); return { initialized: true, productionApproved: false };
  }
  if (command === 'status') return readonlySnapshot(root);
  assert(sitePolicy(root).agentDigest === runtime.digest, 'AGENT_BINDING_MISMATCH');
  if (command === 'plan') {
    const policy = sitePolicy(root), snapshot = readonlySnapshot(root);
    const plan = makePlan(policy.siteId, snapshot.siteRevision, runtime.digest, Number(o['--delay-ms'] ?? 10));
    const result = { plan, planDigest: planDigest(plan) };
    if (o['--output']) { exclusiveFile(o['--output'], JSON.stringify(result)); return { written: true }; }
    return result;
  }
  if (command === 'render-unit') { assert(o['--output'], 'ARGUMENT_INVALID'); exclusiveFile(o['--output'], renderUnit(root, runtime.root)); return { written: true, installed: false }; }
  if (command === 'dispatch') return dispatch(root, runtime.root);
  const exit = lockedReexecution(root, 'cli', process.argv.slice(2)); if (exit !== null) { process.exitCode = exit; return; }
  if (command === 'submit') { assert(o['--request'], 'ARGUMENT_INVALID'); return summary(admit(root, JSON.parse(boundedRead(o['--request']).toString()), runtime.digest)); }
  assert(command === 'reconcile' && o['--operation'] && o['--revision'], 'ARGUMENT_INVALID');
  return summary(authorizeReconcile(root, o['--operation'], Number(o['--revision']), runtime.digest));
}
try { const result = await main(); if (result) process.stdout.write(`${JSON.stringify(result)}\n`); }
catch (error) { process.stderr.write(`${JSON.stringify({ code: safeError(error) })}\n`); process.exitCode = 1; }
