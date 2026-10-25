import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { assert, boundedRead, createExperiment, exclusiveFile, experimentPath, sha256 } from '../src/safety.ts';
import { initializeStore, submit } from '../src/store.ts';
import { verifyFictionalTransport } from '../src/transport.ts';
import { buildTransportFixture } from './fixture-transport.ts';
import { buildDiagnostics } from './build-diagnostics.ts';

const args = process.argv.slice(2); assert(args.length === 2 && args[0] === '--output', 'ARGUMENT_INVALID');
const root = path.join(fs.realpathSync(os.tmpdir()), `lumina-m1-${randomUUID()}`); createExperiment(root);
try {
  initializeStore(root); submit(root, 'fictional-measure-key', { delayMs: 1, mode: 'NORMAL' });
  const start = performance.now();
  const worker = spawnSync(process.execPath, [fileURLToPath(new URL('../src/lifecycle-cli.ts', import.meta.url)), 'run', '--root', root], { encoding: 'utf8', timeout: 8000, windowsHide: true });
  assert(worker.status === 0, 'MEASUREMENT_WORKER_FAILED'); const workerReport = JSON.parse(worker.stdout) as { resources: { peakRssBytes: number; cpuMicroseconds: number } };
  const workerWallMs = Math.ceil(performance.now() - start);
  const policy = path.join(root, 'policy.json'), diagnostic = path.join(root, 'diagnostic.json');
  fs.copyFileSync(new URL('../fixtures/policy.example.json', import.meta.url), policy);
  const entry = buildDiagnostics(path.join(root, 'diagnostics-runtime'));
  const snapshot = (directory: string): string[] => fs.readdirSync(directory).flatMap(f => {
    const file = path.join(directory, f);
    return fs.lstatSync(file).isDirectory() ? snapshot(file) : [path.relative(root, file)];
  });
  const before = snapshot(root).sort();
  const digests = Object.fromEntries(before.map(f => [f, sha256(boundedRead(path.join(root, f), 262_144))]));
  const dStart = performance.now();
  const result = spawnSync(process.execPath, ['--max-old-space-size=48', entry, '--policy', policy, '--output', diagnostic], { encoding: 'utf8', timeout: 5000, windowsHide: true });
  assert(result.status === 3, 'MEASUREMENT_DIAGNOSTIC_FAILED');
  const diagnosticWallMs = Math.ceil(performance.now() - dStart);
  const d = JSON.parse(fs.readFileSync(diagnostic, 'utf8')) as { budget: { observedPeakRssBytes: number }; capture: { durationMs: number } };
  const supervisor = JSON.parse(result.stdout) as { supervisorPeakRssBytes: number; conservativePeakSumBytes: number };
  assert(snapshot(root).filter(x => x !== 'diagnostic.json').sort().join(',') === before.join(','), 'READ_ONLY_MEASUREMENT_FAILED');
  assert(Object.entries(digests).every(([f, digest]) => sha256(boundedRead(path.join(root, f), 262_144)) === digest), 'READ_ONLY_MEASUREMENT_FAILED');
  const f = buildTransportFixture(root), tStart = performance.now(), transport = await verifyFictionalTransport(f.base, ...f.signed(f.value), f.trust);
  const transportWallMs = Math.ceil(performance.now() - tStart);
  const sourceRoot = fileURLToPath(new URL('../src/', import.meta.url));
  const sourceBytes = fs.readdirSync(sourceRoot).reduce((n, file) => n + fs.statSync(path.join(sourceRoot, file)).size, 0);
  const sourceDigest = sha256(fs.readdirSync(sourceRoot).sort().map(file => `${file}:${sha256(boundedRead(path.join(sourceRoot, file), 131_072))}`).join('\n'));
  const bundleBytes = fs.readdirSync(path.dirname(entry)).reduce((n, file) => n + fs.statSync(path.join(path.dirname(entry), file)).size, 0);
  const report = { schemaVersion: 1, kind: 'lumina.m1.local-measurements', platform: process.platform, node: process.versions.node, worker: { ...workerReport.resources, wallMs: workerWallMs, sqliteBytes: fs.statSync(path.join(root, 'state.sqlite')).size, effects: fs.readdirSync(path.join(root, 'effects')).length }, diagnostics: { executionProfile: 'PRECOMPILED_JAVASCRIPT', bundleBytesExcludingNode: bundleBytes, peakRssBytes: supervisor.conservativePeakSumBytes - supervisor.supervisorPeakRssBytes, supervisorPeakRssBytes: supervisor.supervisorPeakRssBytes, conservativePeakSumBytes: supervisor.conservativePeakSumBytes, wallMs: diagnosticWallMs, collectMs: d.capture.durationMs, outputBytes: fs.statSync(diagnostic).size, extraDirectoryEntries: 1, existingFixtureFilesUnchanged: true, hardRssLimit: 'NOT_RUN' }, transport: { ...transport, verifyMs: transportWallMs }, sourceBytes, sourceDigest, privateRuntimeBundleBytes: 'NOT_RUN', systemdRuntimeResources: 'NOT_RUN', productionResourceProof: false };
  exclusiveFile(path.resolve(args[1]), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report));
} finally { experimentPath(root); fs.rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }); }
