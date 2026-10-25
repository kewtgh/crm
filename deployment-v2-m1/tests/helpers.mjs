import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createExperiment, experimentPath } from '../src/safety.ts';
import { initializeStore } from '../src/store.ts';
import { buildDiagnostics } from '../tools/build-diagnostics.ts';

export const cli = fileURLToPath(new URL('../src/lifecycle-cli.ts', import.meta.url));
export function fixture(t, allowSystemd = false) {
  const root = path.join(fs.realpathSync(os.tmpdir()), `lumina-m1-${randomUUID()}`);
  createExperiment(root, allowSystemd); initializeStore(root);
  t.after(() => { experimentPath(root); fs.rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }); });
  return root;
}
export function diagnosticEntry(root) { return buildDiagnostics(path.join(root, 'diagnostics-runtime')); }
export function run(args, options = {}) {
  return spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', windowsHide: true, timeout: 15_000, ...options });
}
export function start(args) { return spawn(process.execPath, [cli, ...args], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }); }
export function finished(child) {
  return new Promise((resolve, reject) => { child.once('error', reject); child.once('close', (code, signal) => resolve({ code, signal })); });
}
export async function until(fn, ms = 5000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await fn()) return; await new Promise(r => setTimeout(r, 30)); }
  throw new Error('CONDITION_TIMEOUT');
}
export const policy = JSON.parse(fs.readFileSync(new URL('../fixtures/policy.example.json', import.meta.url), 'utf8'));
export function model() { return { services: { web: { user: '10001:10001', init: true, read_only: true, cap_drop: ['ALL'], security_opt: ['no-new-privileges:true'], tmpfs: ['/tmp:rw,noexec,nosuid,nodev'], pids_limit: 256, mem_limit: '512m', cpus: 1, networks: { backend: null }, ports: [{ host_ip: '127.0.0.1', published: '3200', target: 3200, protocol: 'tcp' }] } }, networks: { backend: { internal: true } } }; }
export function hostFixture(overrides = {}) {
  const calls = [];
  const io = {
    platform: 'linux', uid: policy.projectUid,
    metadata(file) { return { kind: file.endsWith('.sock') || file.endsWith('/bus') ? 'socket' : 'directory', uid: policy.projectUid, mode: 0o700, canonical: true }; },
    read(file) { return file.endsWith('os-release') ? 'ID=ubuntu\nVERSION_ID="26.04"\n' : 'cpu memory pids\n'; },
    capacity() { return 8n * 1024n ** 3n; }, peakRssBytes() { return 40 * 1024 ** 2; },
    async command(id, _policy, _timeout, input) {
      calls.push({ id, input });
      const outputs = { 'docker.info': JSON.stringify({ ServerVersion: '29.1.3', SecurityOptions: ['name=rootless'], DockerRootDir: policy.dataRoot, CgroupDriver: 'systemd', CgroupVersion: '2' }), 'compose.version': '2.40.3+ds1-0ubuntu1', 'compose.model': JSON.stringify(model()), 'systemd.manager': 'Version=259.1', 'systemd.docker': 'LoadState=loaded\nActiveState=active\nSubState=running', 'systemd.agent': 'LoadState=not-found\nActiveState=inactive\nSubState=dead' };
      return { ok: true, stdout: outputs[id], exitCode: 0, durationMs: 1 };
    }, ...overrides,
  };
  return { io, calls };
}
