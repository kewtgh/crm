import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { fixture, policy, diagnosticEntry } from './helpers.mjs';
import { createExperiment, exclusiveFile } from '../src/safety.ts';
import { openStore } from '../src/store.ts';

test('runtime modules have no dependency on CRM source, V1, npm or a remote service', () => {
  const source = fileURLToPath(new URL('../src/', import.meta.url));
  for (const file of fs.readdirSync(source).filter(f => /\.(?:ts|mjs)$/.test(f))) {
    const text = fs.readFileSync(path.join(source, file), 'utf8');
    for (const match of text.matchAll(/from ['"]([^'"]+)['"]/g)) assert.ok(match[1].startsWith('node:') || match[1].startsWith('./'), `${file}: namespace escape`);
    assert.doesNotMatch(text, /\b(?:fetch|XMLHttpRequest)\s*\(|from ['"](?:pg|https?|net|tls)['"]/);
  }
});
test('experiment setup cannot adopt an arbitrary existing directory', t => {
  const root = fixture(t); assert.throws(() => createExperiment(path.dirname(root)), { code: 'EXPERIMENT_PATH_UNSAFE' });
  assert.throws(() => exclusiveFile(path.join(root, 'experiment.json'), 'replacement'));
});
test('a hard-linked state file cannot alias another store', t => {
  const root = fixture(t), alias = path.join(root, 'state-alias.sqlite');
  fs.linkSync(path.join(root, 'state.sqlite'), alias);
  assert.throws(() => openStore(root), { code: 'FILE_UNTRUSTED' });
});
test('diagnostics run from a detached JavaScript bundle without application dependencies', t => {
  const root = fixture(t), entry = diagnosticEntry(root);
  const p = path.join(root, 'policy.json'), output = path.join(root, 'report.json'); fs.writeFileSync(p, JSON.stringify(policy));
  const r = spawnSync(process.execPath, ['--max-old-space-size=48', entry, '--policy', p, '--output', output], { encoding: 'utf8', timeout: 5000, cwd: root });
  assert.equal(r.status, 3, r.stderr); assert.equal(JSON.parse(fs.readFileSync(output)).tool.productionApproved, false);
});
