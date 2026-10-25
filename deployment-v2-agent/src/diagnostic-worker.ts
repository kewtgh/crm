import { parentPort, workerData } from 'node:worker_threads';
import { observation } from './readonly.ts';
import { assert, exclusiveFile, safeError, sha256, VERSION } from './common.ts';
try {
  const result = observation(String(workerData.root));
  const rss = process.resourceUsage().maxRSS * 1024;
  assert(rss <= 134_217_728, 'DIAGNOSTIC_MEMORY_LIMIT');
  const durationMs = Math.ceil(Number(process.hrtime.bigint() - BigInt(workerData.startedNs)) / 1_000_000);
  assert(durationMs < 44_000, 'DIAGNOSTIC_DEADLINE');
  const report = { schemaVersion: 1, kind: 'lumina.alpha.state-diagnostics', toolVersion: VERSION, scope: 'NONPRODUCTION_ALPHA', readOnly: true, network: 'NONE', productionApproved: false, compatibilityCertified: false, ...result, budget: { durationMs, peakRssBytes: rss, maximumRssBytes: 134_217_728, hardRssLimit: false, processes: 1, workerThreads: 1 } };
  const raw = `${JSON.stringify(report, null, 2)}\n`; assert(Buffer.byteLength(raw) <= 65_536, 'DIAGNOSTIC_OUTPUT_LIMIT');
  // All potentially blocking filesystem work, including publication/fsync, stays under the main watchdog.
  exclusiveFile(String(workerData.output), raw);
  parentPort!.postMessage({ protocol: 'M2_DIAGNOSTIC_RESULT', result: 'WRITTEN', status: result.status, sha256: sha256(raw), peakRssBytes: process.resourceUsage().maxRSS * 1024 });
} catch (error) {
  const e = error as NodeJS.ErrnoException;
  parentPort!.postMessage({ protocol: 'M2_DIAGNOSTIC_RESULT', result: 'FAILED', code: e.code === 'EEXIST' ? 'OUTPUT_EXISTS' : safeError(error) });
}
