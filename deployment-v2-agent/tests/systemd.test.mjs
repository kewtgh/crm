import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readonlySnapshot } from '../src/readonly.ts';
import os from 'node:os';
import { buildRuntime } from '../tools/build.ts';
import { alphaPath } from '../src/common.ts';

test('fixed unit export requires opt-in and writes only the chosen file, without installing a service', { skip: process.platform !== 'linux' || process.getuid?.() === 0 ? 'NOT_RUN: unit export contract requires a non-root Linux identity' : false }, () => {
  const home = path.join(fs.realpathSync(os.tmpdir()), `lumina-v2-alpha-${randomUUID()}`); fs.mkdirSync(home, { mode: 0o700 });
  try {
    const b = buildRuntime(path.join(home, 'package')), root = path.join(home, `lumina-v2-alpha-${randomUUID()}`);
    const cli = args => { const r = spawnSync(b.node, [b.cli, ...args], { encoding: 'utf8', timeout: 8000 }); assert.equal(r.status, 0, r.stderr); return JSON.parse(r.stdout); };
    cli(['init', '--root', root, '--ack-nonproduction', '--allow-systemd']);
    const before = fs.readFileSync(path.join(root, 'state.sqlite')), file = path.join(home, 'review.service');
    assert.equal(cli(['render-unit', '--root', root, '--output', file]).installed, false);
    const unit = fs.readFileSync(file, 'utf8');
    assert.match(unit, /^ExecStart=\/usr\/bin\/flock --nonblock --exclusive --conflict-exit-code=73 --no-fork /m);
    assert.ok(unit.includes(`${root}/write.lock ${b.node} --max-old-space-size=64 ${b.worker} --root ${root}`));
    assert.deepEqual(fs.readFileSync(path.join(root, 'state.sqlite')), before);
    assert.equal(readonlySnapshot(root).unresolved, 0);
  } finally { alphaPath(home); fs.rmSync(home, { recursive: true, force: true, maxRetries: 3, retryDelay: 30 }); }
});

test('fixed user oneshot completes a fictional task after the submitting CLI exits', { skip: process.platform !== 'linux' || process.env.M2_ISOLATED_SYSTEMD !== 'ACK_NONPRODUCTION' ? 'NOT_RUN: no approved fixed unit and isolated user manager' : false }, async () => {
  // Only an administrator-prepared Alpha site / matching runtime; never installs or reloads a unit.
  const root = process.env.M2_SYSTEMD_ALPHA_ROOT, payload = process.env.M2_SYSTEMD_RUNTIME; assert.ok(root && payload);
  const cli = args => { const r = spawnSync(path.join(payload, 'runtime/node'), [path.join(payload, 'lib/cli.mjs'), ...args], { encoding: 'utf8', timeout: 8000 }); assert.equal(r.status, 0, r.stderr); return JSON.parse(r.stdout); };
  assert.equal(readonlySnapshot(root).unresolved, 0);
  const token = randomUUID(), p = cli(['plan', '--root', root, '--delay-ms', '1000']), file = path.join(root, `systemd-${token}.json`);
  fs.writeFileSync(file, JSON.stringify({ protocolVersion: 1, idempotencyKey: `fictional-${token}`, ...p }), { flag: 'wx', mode: 0o600 });
  cli(['submit', '--root', root, '--request', file]);
  assert.equal(cli(['dispatch', '--root', root]).completed, false);
  const end = Date.now() + 15_000;
  while (Date.now() < end && readonlySnapshot(root).state !== 'COMPLETED') await new Promise(r => setTimeout(r, 100));
  const after = readonlySnapshot(root); assert.equal(after.state, 'COMPLETED'); assert.equal(after.checkpoint, 'PROVEN'); assert.equal(after.grant, 'CONSUMED'); assert.equal(after.acceptedApplication, null);
});
