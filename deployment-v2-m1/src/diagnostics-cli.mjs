import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';

// A plain-JS supervisor deliberately avoids loading the TypeScript runtime a second time.
class SupervisorError extends Error {
  /** @param {string} code */
  constructor(code) { super(code); this.code = code; }
}
/** @param {unknown} value @param {string} code */
function ensure(value, code) { if (!value) throw new SupervisorError(code); }
const workerErrors = ['ARGUMENT_INVALID', 'SUPERVISOR_REQUIRED', 'POLICY_JSON_INVALID', 'POLICY_NOT_FOUND', 'POLICY_PERMISSION_DENIED', 'POLICY_READ_FAILED', 'POLICY_INVALID', 'POLICY_SCOPE_UNSAFE', 'FIELDS_INVALID', 'DIAGNOSTIC_MEMORY_LIMIT', 'DIAGNOSTIC_DEADLINE', 'DIAGNOSTIC_OUTPUT_LIMIT', 'INPUT_LIMIT', 'INPUT_UNTRUSTED', 'OUTPUT_PARENT_UNTRUSTED', 'OUTPUT_EXISTS', 'OUTPUT_WRITE_FAILED', 'UNEXPECTED_FAILURE'];

/** @param {string[]} args @returns {Promise<{status:number|null,stdout:string,reason:string|null}>} */
async function runWorker(args) {
  return new Promise(resolve => {
    const env = { PATH: process.platform === 'win32' ? process.env.PATH ?? '' : '/usr/bin:/bin', M1_COLLECTOR_SUPERVISED: '1', TMP: os.tmpdir(), TEMP: os.tmpdir(), ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}) };
    const child = spawn(process.execPath, ['--max-old-space-size=48', fileURLToPath(new URL('./diagnostics-worker.mjs', import.meta.url)), ...args], { env, windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
    /** @type {Buffer[]} */ const chunks = [];
    let size = 0, settled = false;
    /** @param {number|null} status @param {string|null} reason */
    const finish = (status, reason) => { if (settled) return; settled = true; clearTimeout(timer); resolve({ status, reason, stdout: reason ? '' : Buffer.concat(chunks).toString('utf8') }); };
    const terminate = () => {
      if (!child.pid || child.exitCode !== null) return;
      try {
        if (process.platform !== 'win32') process.kill(-child.pid, 'SIGKILL');
        else { spawnSync(path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe'), ['/PID', String(child.pid), '/T', '/F'], { timeout: 1000, windowsHide: true, stdio: 'ignore' }); child.kill('SIGKILL'); }
      } catch { /* Already exited. */ }
    };
    const timer = setTimeout(() => { terminate(); finish(null, 'DIAGNOSTIC_DEADLINE'); }, 44_000);
    /** @param {Buffer} bytes @param {boolean} stdout */
    const consume = (bytes, stdout) => { size += bytes.length; if (size > 16_384) { terminate(); finish(null, 'DIAGNOSTIC_PROTOCOL_LIMIT'); } else if (stdout) chunks.push(bytes); };
    child.stdout.on('data', b => consume(b, true)); child.stderr.on('data', b => consume(b, false));
    child.once('error', () => finish(null, 'DIAGNOSTIC_WORKER_UNAVAILABLE'));
    child.once('close', status => finish(status, status === 0 ? null : 'DIAGNOSTIC_WORKER_FAILED'));
  });
}
async function main() {
  ensure(process.execArgv.includes('--max-old-space-size=48'), 'MEMORY_LAUNCH_PROFILE_REQUIRED');
  const args = process.argv.slice(2); ensure(args.length === 4 && args[0] === '--policy' && args[2] === '--output', 'ARGUMENT_INVALID');
  const result = await runWorker(args); if (result.reason) throw new SupervisorError(result.reason);
  let message;
  try { message = JSON.parse(result.stdout); } catch { throw new SupervisorError('DIAGNOSTIC_PROTOCOL_INVALID'); }
  ensure(message && typeof message === 'object' && message.protocol === 'M1_DIAGNOSTIC_RESULT' && [0, 1, 2, 3].includes(message.exitCode), 'DIAGNOSTIC_PROTOCOL_INVALID');
  if (message.exitCode === 1) throw new SupervisorError(workerErrors.includes(message.code) ? message.code : 'DIAGNOSTIC_PROTOCOL_INVALID');
  ensure(message.result === 'WRITTEN' && typeof message.sha256 === 'string' && /^[a-f0-9]{64}$/.test(message.sha256), 'DIAGNOSTIC_PROTOCOL_INVALID');
  const peak = process.resourceUsage().maxRSS * 1024;
  ensure(Number.isSafeInteger(message.collectorPeakRssBytes) && message.collectorPeakRssBytes > 0 && message.collectorPeakRssBytes + peak <= 134_217_728, 'DIAGNOSTIC_AGGREGATE_MEMORY_LIMIT');
  process.stdout.write(`${JSON.stringify({ result: 'COLLECTOR_EXITED', exitCode: message.exitCode, supervisorPeakRssBytes: peak, conservativePeakSumBytes: peak + message.collectorPeakRssBytes })}\n`);
  process.exitCode = message.exitCode;
}
try { await main(); }
catch (error) { process.stderr.write(`${JSON.stringify({ code: error instanceof SupervisorError ? error.code : 'UNEXPECTED_FAILURE' })}\n`); process.exitCode = 1; }
