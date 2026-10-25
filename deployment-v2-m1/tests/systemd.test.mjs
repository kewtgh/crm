import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, run, until } from './helpers.mjs';
import { lookup, submit } from '../src/store.ts';

test('real nonproduction user-manager oneshot survives dispatch CLI exit', { skip: process.platform !== 'linux' || process.env.M1_ISOLATED_SYSTEMD !== 'ACK_NONPRODUCTION' ? 'NOT_RUN: requires explicit isolated Linux user-manager approval' : false }, async t => {
  const root = fixture(t, true); submit(root, 'fictional-detach-01', { delayMs: 1000, mode: 'NORMAL' });
  const dispatched = run(['dispatch', '--root', root]); assert.equal(dispatched.status, 0, dispatched.stderr);
  assert.equal(JSON.parse(dispatched.stdout).completed, false);
  await until(() => lookup(root)?.state === 'COMPLETED', 15_000);
  assert.equal(lookup(root).grant, 'DONE');
});
