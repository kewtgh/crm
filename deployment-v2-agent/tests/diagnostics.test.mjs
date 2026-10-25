import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fixture, runtime, invoke, database } from './helpers.mjs';
import { observation } from '../src/readonly.ts';

const require = createRequire(import.meta.url), Ajv = require('../../node_modules/ajv');
const schema = JSON.parse(fs.readFileSync(new URL('../schemas/state-diagnostics-v1.schema.json', import.meta.url)));
const validate = new Ajv({ allErrors: true }).compile(schema);
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
test('independent state diagnostic uses one process, respects 128 MiB, exports no private state', t => {
  const root = fixture(t), output = path.join(root, 'report.json');
  const files = ['site.json', 'state.sqlite', 'write.lock'], before = files.map(f => hash(path.join(root, f)));
  const result = invoke(runtime.diagnostics, ['--root', root, '--output', output]); assert.equal(result.status, 0, result.stderr);
  const raw = fs.readFileSync(output, 'utf8'), report = JSON.parse(raw);
  assert.equal(validate(report), true, JSON.stringify(validate.errors));
  assert.equal(report.budget.processes, 1); assert.equal(report.budget.workerThreads, 1); assert.ok(report.budget.peakRssBytes <= 134217728);
  assert.equal(report.budget.hardRssLimit, false); assert.equal(report.compatibilityCertified, false);
  for (const field of [root, '"uid"', '"execution_json"', '"request_key"', '"pid"']) assert.ok(!raw.includes(field));
  assert.deepEqual(files.map(f => hash(path.join(root, f))), before);
  const original = fs.readFileSync(output); assert.equal(invoke(runtime.diagnostics, ['--root', root, '--output', output]).status, 1); assert.deepEqual(fs.readFileSync(output), original);
  const injected = structuredClone(report); injected.snapshot.secret = 'FICTIONAL_PRIVATE_MARKER'; assert.equal(validate(injected), false);
});
test('journal is an explicit UNKNOWN and cannot trigger implicit SQLite recovery', t => {
  const root = fixture(t), file = path.join(root, 'state.sqlite'), journal = file + '-journal';
  fs.writeFileSync(journal, Buffer.from('FICTIONAL_JOURNAL_HEADER'), { mode: 0o600 });
  const before = [hash(file), hash(journal)];
  assert.equal(observation(root).status, 'UNKNOWN'); assert.equal(observation(root).code, 'STATE_RECOVERY_REQUIRED');
  assert.deepEqual([hash(file), hash(journal)], before);
});
test('missing state is NOT_INSTALLED without database creation', t => {
  const root = fixture(t), file = path.join(root, 'state.sqlite'); fs.unlinkSync(file);
  assert.equal(observation(root).status, 'NOT_RUN'); assert.equal(observation(root).code, 'NOT_INSTALLED'); assert.equal(fs.existsSync(file), false);
});
test('foreign schema and incompatible epochs are separate from corrupt SQLite', t => {
  const root = fixture(t), db = database(root, false);
  db.exec('PRAGMA ignore_check_constraints=ON; UPDATE store_meta SET epoch=99;'); db.close();
  assert.equal(observation(root).code, 'STATE_SCHEMA_UNSUPPORTED'); assert.equal(observation(root).status, 'FAIL');
  fs.writeFileSync(path.join(root, 'state.sqlite'), Buffer.alloc(256, 65));
  assert.equal(observation(root).code, 'STATE_CORRUPT'); assert.equal(observation(root).status, 'FAIL');
});
test('aliased state cannot escape the project boundary', t => {
  const root = fixture(t), file = path.join(root, 'state.sqlite'); fs.linkSync(file, path.join(root, 'fictional-alias'));
  assert.equal(observation(root).code, 'FILE_UNTRUSTED'); assert.equal(observation(root).status, 'FAIL');
});
