import { Worker } from 'node:worker_threads';

// One Node process with an isolated short thread; no second Node baseline or child command.
/** @param {string} code */
function failure(code) { process.stderr.write(`${JSON.stringify({ code })}\n`); process.exitCode = 1; }
async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 4 || args[0] !== '--root' || args[2] !== '--output') return failure('ARGUMENT_INVALID');
  /** @type {any} */
  const report = await new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./diagnostic-worker.mjs', import.meta.url), { workerData: { root: args[1], output: args[3], startedNs: process.hrtime.bigint().toString() }, env: {}, execArgv: [], resourceLimits: { maxOldGenerationSizeMb: 24, maxYoungGenerationSizeMb: 2, stackSizeMb: 2 }, stdout: true, stderr: true });
    let bytes = 0;
    const timer = setTimeout(() => { worker.unref(); void worker.terminate(); failure('DIAGNOSTIC_DEADLINE'); process.exit(1); }, 44_000);
    const consume = /** @param {Buffer} b */ b => { bytes += b.length; if (bytes > 16_384) { void worker.terminate(); clearTimeout(timer); reject(new Error('DIAGNOSTIC_OUTPUT_LIMIT')); } };
    worker.stdout.on('data', consume); worker.stderr.on('data', consume);
    worker.once('message', m => { clearTimeout(timer); void worker.terminate(); resolve(m); });
    worker.once('error', () => { clearTimeout(timer); reject(new Error('DIAGNOSTIC_WORKER_FAILED')); });
    worker.once('exit', code => { if (code !== 0) { clearTimeout(timer); reject(new Error('DIAGNOSTIC_WORKER_FAILED')); } });
  });
  if (!report || report.protocol !== 'M2_DIAGNOSTIC_RESULT') return failure('DIAGNOSTIC_PROTOCOL_INVALID');
  if (report.result === 'FAILED') return failure(['OUTPUT_EXISTS', 'OUTPUT_PARENT_UNTRUSTED', 'METADATA_PERMISSION_DENIED', 'DIAGNOSTIC_DEADLINE', 'DIAGNOSTIC_MEMORY_LIMIT', 'DIAGNOSTIC_OUTPUT_LIMIT', 'UNEXPECTED_FAILURE'].includes(report.code) ? report.code : 'DIAGNOSTIC_CAPTURE_FAILED');
  if (report.result !== 'WRITTEN' || !['PASS', 'FAIL', 'UNKNOWN', 'NOT_RUN'].includes(report.status) || !/^[a-f0-9]{64}$/.test(report.sha256)) return failure('DIAGNOSTIC_PROTOCOL_INVALID');
  const rss = process.resourceUsage().maxRSS * 1024;
  if (rss > 134_217_728) return failure('DIAGNOSTIC_MEMORY_LIMIT');
  process.stdout.write(`${JSON.stringify({ result: 'WRITTEN', status: report.status, peakRssBytes: rss })}\n`);
  process.exitCode = report.status === 'PASS' ? 0 : report.status === 'FAIL' ? 2 : 3;
}
try { await main(); } catch (error) { const code = /** @type {NodeJS.ErrnoException} */ (error).code; failure(code === 'EEXIST' ? 'OUTPUT_EXISTS' : code === 'EACCES' || code === 'EPERM' ? 'METADATA_PERMISSION_DENIED' : 'DIAGNOSTIC_FAILED'); }
