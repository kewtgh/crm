import { assert, boundedRead, NODE_VERSION, safeError } from './common.ts';
import { verifyRelease } from './release.ts';
async function main() {
  assert(process.versions.node === NODE_VERSION, 'RUNTIME_VERSION_MISMATCH');
  const args = process.argv.slice(2); assert((args.length === 4 || args.length === 5 && args[4] === '--allow-test-key') && args[0] === '--directory' && args[2] === '--trust', 'ARGUMENT_INVALID');
  const trust: unknown = JSON.parse(boundedRead(args[3], 16_384).toString());
  return verifyRelease(args[1], trust, args.length === 5);
}
try { process.stdout.write(`${JSON.stringify(await main())}\n`); }
catch (error) { process.stderr.write(`${JSON.stringify({ code: safeError(error) })}\n`); process.exitCode = 1; }
