import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { AgentError, assert, boundedRead, exclusiveFile, runtimeIdentity, safeError, trustedFile } from './common.ts';
import { executionIdentity, lockedReexecution } from './platform.ts';
import { claim, recordObservation, validateReceipt, type Operation, type Receipt } from './store.ts';
import { readonlySnapshot } from './readonly.ts';
import type { Plan } from './protocol.ts';

function observe(root: string, op: Operation) {
  const file = path.join(root, 'receipts', `${op.step_id}.json`);
  try { trustedFile(file); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
  let value: unknown;
  try { value = JSON.parse(boundedRead(file, 4096).toString()); } catch (error) { if (error instanceof SyntaxError) throw new AgentError('RECEIPT_JSON_INVALID'); throw error; }
  validateReceipt(value, op); return value;
}
async function main() {
  const args = process.argv.slice(2); assert(args.length === 2 && args[0] === '--root', 'ARGUMENT_INVALID');
  const root = path.resolve(args[1]), runtime = runtimeIdentity(), exit = lockedReexecution(root, 'worker', args);
  if (exit !== null) { process.exitCode = exit; return; }
  const controller = new AbortController(), stop = () => controller.abort();
  process.once('SIGTERM', stop); process.once('SIGINT', stop);
  const claimed = claim(root, runtime.digest, executionIdentity());
  if (!claimed) { const s = readonlySnapshot(root); process.exitCode = s.recoveryRequired ? 3 : 0; return { result: s.recoveryRequired ? 'RECOVERY_REQUIRED' : 'NO_WORK' }; }
  if (claimed.action === 'EXPIRED') return { result: 'REJECTED' };
  const op = claimed.op;
  if (claimed.action === 'EXECUTE') {
    try {
      await delay((JSON.parse(op.plan_json) as Plan).delayMs, undefined, { signal: controller.signal });
      assert(!controller.signal.aborted, 'EXECUTION_INTERRUPTED');
      const receipt: Receipt = { kind: 'lumina.alpha.receipt', scope: 'FICTIONAL_ONLY', operationId: op.id, stepId: op.step_id, invocation: JSON.parse(op.execution_json!).invocation, planDigest: op.plan_digest, agentDigest: op.agent_digest };
      exclusiveFile(path.join(root, 'receipts', `${op.step_id}.json`), JSON.stringify(receipt));
    } catch { /* Execution failure is never proof of no effect. Observe the actual receipt below. */ }
    finally { process.removeListener('SIGTERM', stop); process.removeListener('SIGINT', stop); }
  }
  const result = recordObservation(root, op, observe(root, op), runtime.digest);
  process.exitCode = result.state === 'RECOVERY_REQUIRED' ? 3 : 0;
  return { result: result.state, operationRevision: result.revision, externalEffect: 'FICTIONAL_ONLY' };
}
try { const result = await main(); if (result) { const r = process.resourceUsage(); process.stdout.write(`${JSON.stringify({ ...result, resources: { peakRssBytes: r.maxRSS * 1024, cpuMicroseconds: r.userCPUTime + r.systemCPUTime } })}\n`); } }
catch (error) { process.stderr.write(`${JSON.stringify({ code: safeError(error) })}\n`); process.exitCode = 1; }
