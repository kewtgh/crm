import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fixture, run, start, finished, until } from './helpers.mjs';
import { claim, lookup, observeResult, openStore, submit } from '../src/store.ts';
import { createExperiment } from '../src/safety.ts';
import { systemdArguments } from '../src/lifecycle.ts';

test('real SQLite admission is atomic, idempotent, and rejects conflicting or unresolved work', t => {
  const root = fixture(t), task = { delayMs: 1, mode: 'NORMAL' };
  const a = submit(root, 'fictional-key-01', task);
  assert.deepEqual(submit(root, 'fictional-key-01', task), a);
  assert.throws(() => submit(root, 'fictional-key-01', { ...task, delayMs: 2 }), { code: 'IDEMPOTENCY_CONFLICT' });
  assert.throws(() => submit(root, 'fictional-key-02', task), { code: 'OPERATION_UNRESOLVED' });
  const db = openStore(root, true);
  assert.equal(db.prepare('select count(*) as n from operations').get().n, 1); db.close();
});
test('grant claim is once-only and stale completion cannot change a transaction', t => {
  const root = fixture(t); submit(root, 'fictional-key-01', { delayMs: 0, mode: 'NORMAL' });
  const op = claim(root); assert.equal(op.grant, 'CLAIMED'); assert.equal(claim(root), undefined);
  assert.throws(() => observeResult(root, op.id, op.revision - 1, 'fictional'), { code: 'REVISION_CONFLICT' });
  assert.equal(lookup(root).state, 'RUNNING');
});
test('native child execution persists one fictional effect and duplicate execution is a no-op', t => {
  const root = fixture(t); submit(root, 'fictional-key-01', { delayMs: 1, mode: 'NORMAL' });
  const first = run(['run', '--root', root]); assert.equal(first.status, 0, first.stderr);
  assert.equal(lookup(root).state, 'COMPLETED'); const before = fs.readFileSync(path.join(root, 'state.sqlite'));
  assert.equal(run(['run', '--root', root]).status, 0);
  assert.deepEqual(fs.readFileSync(path.join(root, 'state.sqlite')), before);
  assert.equal(fs.readdirSync(path.join(root, 'effects')).length, 1);
});
for (const mode of ['CRASH_BEFORE_EFFECT', 'CRASH_AFTER_EFFECT']) test(`real process abnormal exit ${mode} never replays a claimed grant`, t => {
  const root = fixture(t); submit(root, 'fictional-key-01', { delayMs: 0, mode });
  assert.equal(run(['run', '--root', root]).status, mode === 'CRASH_BEFORE_EFFECT' ? 23 : 24);
  assert.equal(lookup(root).state, 'RUNNING');
  assert.equal(run(['run', '--root', root]).status, 0);
  assert.equal(fs.readdirSync(path.join(root, 'effects')).length, mode === 'CRASH_BEFORE_EFFECT' ? 0 : 1);
  assert.equal(run(['reconcile', '--root', root]).status, 0);
  assert.equal(lookup(root).state, mode === 'CRASH_BEFORE_EFFECT' ? 'RECOVERY_REQUIRED' : 'COMPLETED');
  if (mode === 'CRASH_BEFORE_EFFECT') assert.throws(() => submit(root, 'fictional-key-02', { delayMs: 0, mode: 'NORMAL' }), { code: 'OPERATION_UNRESOLVED' });
});
test('parallel native processes admit at most one request; serialization uses real SQLite', async t => {
  const root = fixture(t);
  const children = [1, 2, 3, 4].map(n => start(['submit', '--root', root, '--key', `fictional-key-${n}`]));
  const results = await Promise.all(children.map(finished));
  assert.equal(results.filter(x => x.code === 0).length, 1);
  const db = openStore(root, true); assert.equal(db.prepare('select count(*) as n from operations').get().n, 1); db.close();
});
test('abruptly terminating the actual worker preserves a durable unknown intent', async t => {
  const root = fixture(t); submit(root, 'fictional-key-01', { delayMs: 5000, mode: 'NORMAL' });
  const child = start(['run', '--root', root]); const result = finished(child);
  t.after(() => { if (child.exitCode === null) child.kill('SIGKILL'); });
  await until(() => lookup(root)?.state === 'RUNNING');
  assert.notEqual(run(['reconcile', '--root', root]).status, 0); assert.equal(lookup(root).state, 'RUNNING');
  process.kill(lookup(root).worker_pid, 'SIGKILL'); await result;
  assert.equal(run(['reconcile', '--root', root]).status, 0);
  assert.equal(lookup(root).state, 'RECOVERY_REQUIRED'); assert.equal(fs.readdirSync(path.join(root, 'effects')).length, 0);
});
test('native Linux flock is mandatory for the worker, never silently emulated', { skip: process.platform !== 'linux' ? 'NOT_RUN: this checkout executes on Windows' : false }, t => {
  const root = fixture(t); submit(root, 'fictional-key-01', { delayMs: 0, mode: 'NORMAL' });
  assert.equal(run(['run', '--root', root]).status, 0);
  assert.equal(lookup(root).state, 'COMPLETED');
});
test('existing directories, invalid tasks and unauthorized systemd dispatch are refused', t => {
  const root = fixture(t);
  assert.throws(() => createExperiment(root));
  assert.throws(() => submit(root, 'fictional-key-01', { delayMs: 0, mode: 'RUN_SHELL' }), { code: 'TASK_INVALID' });
  assert.throws(() => systemdArguments(root), { code: 'ISOLATED_SYSTEMD_NOT_APPROVED' });
});
