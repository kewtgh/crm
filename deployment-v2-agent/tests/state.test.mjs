import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fixture, request, submit, success, cli, snapshot, runtime, invoke, query, database, startWorker, until, finished } from './helpers.mjs';
import { planDigest } from '../src/protocol.ts';

test('fixed request, CAS and idempotency admission use the actual private Node and SQLite', t => {
  const root = fixture(t), r = request(root), admitted = success(submit(root, r));
  assert.deepEqual(success(submit(root, r)), admitted);
  const changed = structuredClone(r.value); changed.plan.delayMs++; changed.planDigest = planDigest(changed.plan);
  fs.writeFileSync(r.file, JSON.stringify(changed)); assert.equal(JSON.parse(submit(root, r).stderr).code, 'IDEMPOTENCY_CONFLICT');
  const stale = request(root, 'fictional-request-02'); stale.value.plan.expectedSiteRevision = 0; stale.value.planDigest = planDigest(stale.value.plan); fs.writeFileSync(stale.file, JSON.stringify(stale.value));
  assert.equal(JSON.parse(submit(root, stale).stderr).code, 'SITE_REVISION_CONFLICT');
  assert.equal(query(root, 'SELECT count(*) AS n FROM operations').n, 1); assert.equal(snapshot(root).acceptedApplication, null);
});
test('grant, intent, receipt, projection and event retain one logical execution', t => {
  const root = fixture(t), r = request(root); success(submit(root, r));
  assert.equal(success(invoke(runtime.worker, ['--root', root])).result, 'COMPLETED');
  const before = fs.readFileSync(path.join(root, 'state.sqlite'));
  assert.equal(success(invoke(runtime.worker, ['--root', root])).result, 'NO_WORK');
  assert.deepEqual(fs.readFileSync(path.join(root, 'state.sqlite')), before);
  assert.equal(fs.readdirSync(path.join(root, 'receipts')).length, 1);
  assert.equal(snapshot(root).checkpoint, 'PROVEN'); assert.equal(snapshot(root).grant, 'CONSUMED');
  const db = database(root, false); try {
    assert.throws(() => db.exec("UPDATE grants SET status='READY'"));
    assert.throws(() => db.exec("UPDATE operations SET plan_digest='changed'"));
    assert.throws(() => db.exec("UPDATE steps SET state='INTENT'"));
    assert.equal(db.prepare("SELECT count(*) AS n FROM events WHERE code='RECEIPT_PROVEN'").get().n, 1);
  } finally { db.close(); }
});
test('multiple real CLIs serialize admission without another queue or owner file', async t => {
  const root = fixture(t), requests = [1, 2, 3, 4].map(n => request(root, `fictional-request-${n}`));
  const results = await Promise.all(requests.map(r => finished(spawn(runtime.node, [runtime.cli, 'submit', '--root', root, '--request', r.file], { stdio: 'ignore', windowsHide: true }))));
  assert.equal(results.filter(r => r.code === 0).length, 1); assert.equal(query(root, 'SELECT count(*) AS n FROM operations').n, 1);
});
test('killing the actual execution leaves intent and cannot reset a consumed grant', async t => {
  const root = fixture(t), op = success(submit(root, request(root, 'fictional-kill-01', 5000))), child = startWorker(root), done = finished(child);
  t.after(() => { if (child.exitCode === null) child.kill('SIGKILL'); });
  await until(() => query(root, 'SELECT execution_json FROM operations').execution_json);
  const execution = JSON.parse(query(root, 'SELECT execution_json FROM operations').execution_json);
  const active = cli(['reconcile', '--root', root, '--operation', op.operationId, '--revision', '2']); assert.notEqual(active.status, 0);
  process.kill(execution.pid, 'SIGKILL'); await done;
  assert.equal(invoke(runtime.worker, ['--root', root]).status, 3);
  assert.equal(snapshot(root).checkpoint, 'INTENT'); assert.equal(fs.readdirSync(path.join(root, 'receipts')).length, 0);
  success(cli(['reconcile', '--root', root, '--operation', op.operationId, '--revision', '2']));
  assert.equal(invoke(runtime.worker, ['--root', root]).status, 3);
  assert.equal(snapshot(root).state, 'RECOVERY_REQUIRED'); assert.equal(snapshot(root).checkpoint, 'UNKNOWN');
  assert.equal(query(root, "SELECT count(*) AS n FROM grants WHERE status='CONSUMED'").n, 2);
  assert.equal(JSON.parse(submit(root, request(root, 'fictional-new-02')).stderr).code, 'OPERATION_UNRESOLVED');
});
test('receipt survives a real SQLite completion rollback and reconcile never repeats the effect', t => {
  const root = fixture(t), op = success(submit(root, request(root)));
  let db = database(root, false); db.exec("CREATE TRIGGER fixture_fail_commit BEFORE UPDATE OF state ON operations WHEN NEW.state='COMPLETED' BEGIN SELECT RAISE(ABORT,'FICTIONAL_TRANSACTION_ABORT'); END;"); db.close();
  assert.equal(invoke(runtime.worker, ['--root', root]).status, 1);
  const name = fs.readdirSync(path.join(root, 'receipts'))[0], file = path.join(root, 'receipts', name), bytes = fs.readFileSync(file);
  assert.equal(snapshot(root).checkpoint, 'INTENT'); assert.equal(query(root, "SELECT count(*) AS n FROM evidence").n, 0);
  db = database(root, false); db.exec('DROP TRIGGER fixture_fail_commit'); db.close();
  success(cli(['reconcile', '--root', root, '--operation', op.operationId, '--revision', '2']));
  assert.equal(success(invoke(runtime.worker, ['--root', root])).result, 'COMPLETED');
  assert.deepEqual(fs.readFileSync(file), bytes); assert.equal(fs.readdirSync(path.join(root, 'receipts')).length, 1);
  assert.equal(snapshot(root).acceptedApplication, null);
});
test('Linux termination records unknown outcome; no claim is reissued', { skip: process.platform !== 'linux' ? 'NOT_RUN: real Unix signal handling requires Linux' : false }, async t => {
  const root = fixture(t); success(submit(root, request(root, 'fictional-term-01', 5000)));
  const child = startWorker(root), done = finished(child); t.after(() => { if (child.exitCode === null) child.kill('SIGKILL'); });
  await until(() => query(root, 'SELECT execution_json FROM operations').execution_json);
  process.kill(JSON.parse(query(root, 'SELECT execution_json FROM operations').execution_json).pid, 'SIGTERM');
  assert.equal((await done).code, 3); assert.equal(snapshot(root).state, 'RECOVERY_REQUIRED');
  assert.equal(fs.readdirSync(path.join(root, 'receipts')).length, 0);
});
test('protocol rejects arbitrary shell, unit attributes, wrong agent and expired plans', t => {
  const root = fixture(t);
  for (const alter of [r => { r.plan.command = 'fictional-shell'; }, r => { r.plan.unit = 'other.service'; }, r => { r.plan.agentDigest = 'b'.repeat(64); }, r => { r.plan.expiresAt = 1; }]) {
    const r = request(root); alter(r.value);
    if (!r.value.plan.command && !r.value.plan.unit) r.value.planDigest = planDigest(r.value.plan);
    fs.writeFileSync(r.file, JSON.stringify(r.value)); assert.notEqual(submit(root, r).status, 0);
  }
  assert.equal(query(root, 'SELECT count(*) AS n FROM operations').n, 0);
  assert.equal(JSON.parse(cli(['dispatch', '--root', root, '--property', 'MemoryMax=1G']).stderr).code, 'ARGUMENT_INVALID');
  assert.equal(JSON.parse(cli(['upgrade', '--root', root]).stderr).code, 'COMMAND_NOT_ALLOWED');
});
