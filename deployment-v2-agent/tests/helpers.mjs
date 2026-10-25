import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { after } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { buildRuntime } from '../tools/build.ts';
import { alphaPath } from '../src/common.ts';

const home = path.join(fs.realpathSync(os.tmpdir()), 'lumina-v2-alpha-' + randomUUID()); fs.mkdirSync(home, { mode: 0o700 });
export const runtime = buildRuntime(path.join(home, 'package'));
after(() => { alphaPath(home); fs.rmSync(home, { recursive: true, force: true, maxRetries: 3, retryDelay: 30 }); });
export function invoke(entry, args) { return spawnSync(runtime.node, [entry, ...args], { encoding: 'utf8', windowsHide: true, timeout: 15_000 }); }
export function cli(args) { return invoke(runtime.cli, args); }
export function success(r) { if (r.status !== 0) throw new Error(JSON.stringify({ status: r.status, spawnError: r.error?.code ?? null, signal: r.signal, stderr: r.stderr, stdout: r.stdout })); return JSON.parse(r.stdout); }
export function fixture(t, systemd = false) {
  const root = path.join(fs.realpathSync(os.tmpdir()), 'lumina-v2-alpha-' + randomUUID());
  success(cli(['init', '--root', root, '--ack-nonproduction', ...(systemd ? ['--allow-systemd'] : [])]));
  t.after(() => { alphaPath(root); fs.rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 30 }); }); return root;
}
export function request(root, key = 'fictional-request-01', delayMs = 10) {
  const plan = success(cli(['plan', '--root', root, '--delay-ms', String(delayMs)]));
  const value = { protocolVersion: 1, idempotencyKey: key, ...plan }, file = path.join(root, 'request-' + randomUUID() + '.json');
  fs.writeFileSync(file, JSON.stringify(value), { mode: 0o600 }); return { file, value };
}
export function submit(root, r) { return cli(['submit', '--root', root, '--request', r.file]); }
export function snapshot(root) { return success(cli(['status', '--root', root])); }
export function database(root, readOnly = true) { return new DatabaseSync(path.join(root, 'state.sqlite'), { readOnly, timeout: 100, allowExtension: false }); }
export function query(root, sql) { const db = database(root); try { return db.prepare(sql).get(); } finally { db.close(); } }
export function startWorker(root) { return spawn(runtime.node, [runtime.worker, '--root', root], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); }
export function finished(child) { return new Promise((resolve, reject) => { child.once('error', reject); child.once('close', (code, signal) => resolve({ code, signal })); }); }
export async function until(fn, maximum = 5000) { const end = Date.now() + maximum; while (Date.now() < end) { try { if (fn()) return; } catch {} await new Promise(r => setTimeout(r, 20)); } throw new Error('CONDITION_TIMEOUT'); }
