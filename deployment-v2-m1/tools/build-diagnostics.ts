import fs from 'node:fs';
import path from 'node:path';
import { stripTypeScriptTypes } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { assert, boundedRead, exclusiveFile, sha256 } from '../src/safety.ts';

const inputs = ['safety.ts', 'observation.ts', 'compose.ts', 'diagnostics.ts', 'diagnostics-worker.ts', 'diagnostics-cli.mjs'];

// Development-only, Node builtins only. Never compiles or installs anything on a host being diagnosed.
export function buildDiagnostics(output: string) {
  const directory = path.resolve(output), parent = path.dirname(directory);
  assert(fs.realpathSync(parent) === parent && fs.lstatSync(parent).isDirectory(), 'OUTPUT_PARENT_UNTRUSTED');
  fs.mkdirSync(directory, { mode: 0o700 }); // A new directory only; never adopts an installed payload.
  const files: { name: string; sha256: string; sourceSha256: string }[] = [];
  for (const file of inputs) {
    const source = boundedRead(fileURLToPath(new URL(`../src/${file}`, import.meta.url)), 131_072);
    let code = file.endsWith('.ts') ? stripTypeScriptTypes(source.toString(), { mode: 'strip' }) : source.toString();
    for (const name of inputs.filter(f => f.endsWith('.ts'))) code = code.replaceAll(name, name.replace(/\.ts$/, '.mjs'));
    const name = file.replace(/\.ts$/, '.mjs');
    exclusiveFile(path.join(directory, name), code);
    files.push({ name, sha256: sha256(code), sourceSha256: sha256(source) });
  }
  exclusiveFile(path.join(directory, 'package.json'), JSON.stringify({ private: true, type: 'module', version: '0.1.0-experimental' }));
  const manifest = { kind: 'lumina.m1.diagnostics-bundle', version: '0.1.0-experimental', productionApproved: false, provenance: 'LOCAL_UNATTESTED_BUILD', node: process.versions.node, files };
  exclusiveFile(path.join(directory, 'm1-bundle.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return path.join(directory, 'diagnostics-cli.mjs');
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  assert(args.length === 2 && args[0] === '--output', 'ARGUMENT_INVALID');
  buildDiagnostics(args[1]);
  console.log(JSON.stringify({ result: 'BUILT_NONPRODUCTION_BUNDLE', productionApproved: false }));
}
