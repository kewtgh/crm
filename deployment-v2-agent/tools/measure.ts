import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { assert, alphaPath, boundedRead, exclusiveFile, hashFile, sha256 } from '../src/common.ts';
import { buildRuntime } from './build.ts';
import { applicationFixture } from './fixtures.ts';
import { verifyRelease } from '../src/release.ts';

const args = process.argv.slice(2); assert(args.length === 2 && args[0] === '--output', 'ARGUMENT_INVALID');
const home = path.join(fs.realpathSync(os.tmpdir()), `lumina-v2-alpha-${randomUUID()}`); fs.mkdirSync(home, { mode: 0o700 });
try {
  const b = buildRuntime(path.join(home, 'package')), root = path.join(home, `lumina-v2-alpha-${randomUUID()}`);
  const run = (entry: string, args: string[]) => { const r = spawnSync(b.node, ['--max-old-space-size=64', entry, ...args], { encoding: 'utf8', timeout: 12_000, windowsHide: true }); assert(r.status === 0, 'MEASUREMENT_COMMAND_FAILED'); return JSON.parse(r.stdout); };
  run(b.cli, ['init', '--root', root, '--ack-nonproduction']);
  const plan = run(b.cli, ['plan', '--root', root, '--delay-ms', '1']), file = path.join(root, 'request.json');
  exclusiveFile(file, JSON.stringify({ protocolVersion: 1, idempotencyKey: 'fictional-measurement-01', ...plan }));
  run(b.cli, ['submit', '--root', root, '--request', file]);
  const start = performance.now(), worker = run(b.worker, ['--root', root]), workerWallMs = Math.ceil(performance.now() - start);
  const snapshot = (directory: string): [string, string][] => fs.readdirSync(directory).sort().flatMap(name => {
    const file = path.join(directory, name); return fs.lstatSync(file).isDirectory() ? snapshot(file) : [[path.relative(home, file), hashFile(file).sha256] as [string, string]];
  });
  const before = snapshot(root), output = path.join(root, 'diagnostic.json'), dStart = performance.now();
  const diagnosticExit = run(b.diagnostics, ['--root', root, '--output', output]); const diagnosticWallMs = Math.ceil(performance.now() - dStart);
  const diagnostic = JSON.parse(fs.readFileSync(output, 'utf8'));
  diagnostic.budget.peakRssBytes = Math.max(diagnostic.budget.peakRssBytes, diagnosticExit.peakRssBytes);
  assert(JSON.stringify(snapshot(root).filter(([f]) => f !== path.relative(home, output))) === JSON.stringify(before), 'DIAGNOSTIC_WRITE_DETECTED');
  const f = applicationFixture(root), release = await verifyRelease(f.root, f.trust, true);
  const manifest = JSON.parse(fs.readFileSync(path.join(b.root, 'runtime-manifest.json'), 'utf8')) as { files: { path: string; bytes: number }[] };
  const codeBytes = manifest.files.filter(f => f.path.startsWith('lib/')).reduce((n, f) => n + f.bytes, 0), nodeBytes = fs.statSync(b.node).size;
  const sourceRoot = path.resolve('deployment-v2-agent/src'), sourceFiles = fs.readdirSync(sourceRoot).sort();
  const sourceDigest = sha256(sourceFiles.map(name => `${name}:${sha256(boundedRead(path.join(sourceRoot, name), 131_072))}`).join('\n'));
  const result = { schemaVersion: 1, kind: 'lumina.m2.measurements', platform: process.platform, node: process.versions.node, sqlite: process.versions.sqlite, sourceDigest, worker: { ...worker.resources, wallMs: workerWallMs, sqliteBytes: fs.statSync(path.join(root, 'state.sqlite')).size }, diagnostics: { ...diagnostic.budget, wallMs: diagnosticWallMs, outputBytes: fs.statSync(output).size, existingFixtureFilesUnchanged: true, coverage: 'STATE_ONLY_M1_HOST_COLLECTOR_RETAINED_SEPARATELY' }, package: { nodeBytes, compiledCodeBytes: codeBytes, payloadBytes: nodeBytes + codeBytes + fs.statSync(path.join(b.root, 'runtime-manifest.json')).size, maximumBytes: 402_653_184, privateNode: true }, release, systemdLifecycle: 'NOT_RUN', hardRssLimit: 'NOT_RUN', productionCompatibility: false };
  exclusiveFile(path.resolve(args[1]), JSON.stringify(result, null, 2) + '\n'); console.log(JSON.stringify(result));
} finally { alphaPath(home); fs.rmSync(home, { recursive: true, force: true, maxRetries: 3, retryDelay: 30 }); }
