import { assert, boundedRead, exclusiveFile, M1Error, safeError, sha256 } from './safety.ts';
import { collectDiagnostics } from './diagnostics.ts';

async function main() {
  assert(process.env.M1_COLLECTOR_SUPERVISED === '1' && process.execArgv.includes('--max-old-space-size=48'), 'SUPERVISOR_REQUIRED');
  const args = process.argv.slice(2);
  assert(args.length === 4 && args[0] === '--policy' && args[2] === '--output', 'ARGUMENT_INVALID');
  let policy: unknown;
  try { policy = JSON.parse(boundedRead(args[1]).toString()); }
  catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    throw new M1Error(error instanceof SyntaxError ? 'POLICY_JSON_INVALID' : code === 'ENOENT' ? 'POLICY_NOT_FOUND' : code === 'EACCES' || code === 'EPERM' ? 'POLICY_PERMISSION_DENIED' : 'POLICY_READ_FAILED');
  }
  const report = await collectDiagnostics(policy);
  const bytes = `${JSON.stringify(report, null, 2)}\n`;
  assert(Buffer.byteLength(bytes) <= 1_048_576, 'DIAGNOSTIC_OUTPUT_LIMIT');
  try { exclusiveFile(args[3], bytes); }
  catch (error) { throw new M1Error((error as NodeJS.ErrnoException).code === 'EEXIST' ? 'OUTPUT_EXISTS' : error instanceof M1Error ? error.code : 'OUTPUT_WRITE_FAILED'); }
  const exitCode = !report.capture.complete ? 3 : report.summary.blocking.length ? 2 : 0;
  process.stdout.write(`${JSON.stringify({ protocol: 'M1_DIAGNOSTIC_RESULT', result: 'WRITTEN', exitCode, sha256: sha256(bytes), bytes: Buffer.byteLength(bytes), collectorPeakRssBytes: process.resourceUsage().maxRSS * 1024 })}\n`);
}
try { await main(); } catch (error) { process.stdout.write(`${JSON.stringify({ protocol: 'M1_DIAGNOSTIC_RESULT', result: 'FAILED', exitCode: 1, code: safeError(error) })}\n`); }
