import fs from 'node:fs';
import path from 'node:path';
import { stripTypeScriptTypes } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { assert, boundedRead, exclusiveFile, hashFile, NODE_VERSION, VERSION } from '../src/common.ts';

export function buildRuntime(output: string) {
  assert(process.versions.node === NODE_VERSION, 'RUNTIME_VERSION_MISMATCH');
  const root = path.resolve(output), parent = path.dirname(root);
  assert(fs.realpathSync(parent) === parent, 'OUTPUT_PARENT_UNTRUSTED'); fs.mkdirSync(root, { mode: 0o700 });
  fs.mkdirSync(path.join(root, 'lib'), { mode: 0o700 }); fs.mkdirSync(path.join(root, 'runtime'), { mode: 0o700 });
  const sourceRoot = fileURLToPath(new URL('../src/', import.meta.url)), files: { path: string; sha256: string; bytes: number }[] = [];
  const inputs = fs.readdirSync(sourceRoot).filter(f => /\.(ts|mjs)$/.test(f)).sort();
  for (const file of inputs) {
    const raw = boundedRead(path.join(sourceRoot, file), 131_072).toString();
    let code = file.endsWith('.ts') ? stripTypeScriptTypes(raw, { mode: 'strip' }) : raw;
    for (const name of inputs.filter(f => f.endsWith('.ts'))) code = code.replaceAll(name, name.replace(/\.ts$/, '.mjs'));
    const relative = `lib/${file.replace(/\.ts$/, '.mjs')}`; exclusiveFile(path.join(root, relative), code);
    files.push({ path: relative, ...hashFile(path.join(root, relative)) });
  }
  const runtime = `runtime/${process.platform === 'win32' ? 'node.exe' : 'node'}`;
  fs.copyFileSync(process.execPath, path.join(root, runtime)); fs.chmodSync(path.join(root, runtime), 0o700);
  files.push({ path: runtime, ...hashFile(path.join(root, runtime)) });
  const manifest = { kind: 'lumina.alpha.runtime', version: VERSION, node: NODE_VERSION, sqlite: process.versions.sqlite, platform: process.platform, arch: process.arch, protocol: 1, storeEpoch: 1, productionApproved: false, files: files.sort((a, b) => a.path.localeCompare(b.path)) };
  exclusiveFile(path.join(root, 'runtime-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return { root, node: path.join(root, runtime), cli: path.join(root, 'lib/cli.mjs'), worker: path.join(root, 'lib/worker.mjs'), diagnostics: path.join(root, 'lib/diagnostics-cli.mjs') };
}
export function buildVerifier(output: string) {
  const root = path.resolve(output); assert(fs.realpathSync(path.dirname(root)) === path.dirname(root), 'OUTPUT_PARENT_UNTRUSTED'); fs.mkdirSync(root, { mode: 0o700 });
  for (const name of ['common', 'oci', 'release', 'verifier']) {
    const source = boundedRead(fileURLToPath(new URL(`../src/${name}.ts`, import.meta.url)), 131_072).toString();
    exclusiveFile(path.join(root, `${name}.mjs`), stripTypeScriptTypes(source, { mode: 'strip' }).replaceAll('.ts\'', '.mjs\''));
  }
  return path.join(root, 'verifier.mjs');
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2); assert(args.length === 2 && ['--output', '--verifier-output'].includes(args[0]), 'ARGUMENT_INVALID');
  if (args[0] === '--verifier-output') buildVerifier(args[1]); else buildRuntime(args[1]);
  console.log(JSON.stringify({ result: 'BUILT_ALPHA_PRIVATE_RUNTIME_OR_VERIFIER', version: VERSION, productionApproved: false }));
}
