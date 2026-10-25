import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { aptReason, failureDetail, initial, selectPackage, summary } from './contract.mjs';
const context = { sha: 'a'.repeat(40), runId: '123456789', attempt: '1', profile: '26.04' };
const fixture = () => initial({ ...context, sourceDigest: 'b'.repeat(64) });
test('Ubuntu package selection respects epochs, exact upstream and revision', () => {
  assert.equal(selectPackage(' docker.io | 29.1.30-1 | repo\n docker.io | 29.1.3-0ubuntu1 | repo', '29.1.3'), '29.1.3-0ubuntu1');
  assert.equal(selectPackage('extra | 5:28.0.4-1~ubuntu.24.04~noble | repo', '28.0.4'), '5:28.0.4-1~ubuntu.24.04~noble');
  assert.equal(selectPackage('pkg | 29.1.4-1 | repo', '29.1.3'), null);
  assert.equal(selectPackage('pkg | 2.40.3+ds1-0ubuntu1 | repo', '2.40.3'), '2.40.3+ds1-0ubuntu1');
  assert.equal(selectPackage('pkg | 2.40.3~rc1-1 | repo', '2.40.3'), null);
});
test('profile, SHA, run and attempt are independently bound', () => {
  for (const change of [{ sha: 'c'.repeat(40) }, { runId: '987654321' }, { attempt: '2' }, { profile: '24.04' }]) {
    assert.throws(() => summary({ ...fixture(), ...change }, context), /STALE_EVIDENCE/);
  }
});
test('missing capabilities never become a complete gate pass', () => {
  const raw = fixture(); assert.equal(summary(raw, context).result, 'FAIL');
  raw.completed = true; assert.equal(summary(raw, context).result, 'INCOMPLETE');
  raw.cases['rootless-memory'] = { status: 'FAIL', reason: 'CHECK_FAILED' }; assert.equal(summary(raw, context).result, 'FAIL');
  raw.cases['rootless-memory'] = { status: 'PASS', reason: 'NOT_EXECUTED' }; assert.throws(() => summary(raw, context));
});
test('APT first cause is a fixed classification without publishing raw source or stderr', () => {
  assert.equal(aptReason('Conflicting values set for option Signed-By: FICTIONAL_PRIVATE_MARKER', false), 'SOURCE_SIGNED_BY_CONFLICT');
  assert.equal(aptReason('NO_PUBKEY FICTIONAL_PRIVATE_MARKER', false), 'SIGNATURE_REJECTED');
  assert.equal(aptReason('E: Version 5:1 for docker-ce-rootless-extras was not found', false), 'EXTRAS_VERSION_ABSENT');
  assert.equal(aptReason('FICTIONAL_PRIVATE_MARKER', false), 'UNCLASSIFIED_PRIVATE_LOG');
});
test('publication removes raw errors, environment, unit names, paths and identifiers', () => {
  const raw = fixture(), marker = 'FICTIONAL_PRIVATE_MARKER';
  raw.errors = marker; raw.environment = { node: '24.22.1', PATH: marker, engine: marker };
  raw.packages = [{ name: marker, version: '1.0' }]; raw.metrics = { daemonRssBeforeBytes: 50000000, token: marker };
  raw.kernel = { cpu: { cpuQuota: 100000, cpuPeriod: 100000, secret: marker } }; raw.facts = { socketOwned: true, socket: marker };
  const value = summary(raw, context); assert.doesNotMatch(JSON.stringify(value), /FICTIONAL_PRIVATE_MARKER/);
  assert.deepEqual(value.packages, []); assert.deepEqual(value.metrics, { daemonRssBeforeBytes: 50000000 });
  assert.deepEqual(failureDetail({ code: 'ERR_ASSERTION', actual: 12345, expected: 'FICTIONAL_PRIVATE_MARKER', command: 'systemctl', exitCode: 1 }),
    { condition: 'ERR_ASSERTION', command: 'systemctl', exitCode: 1 });
});
test('a failed socket without ExecMainStatus does not invent a process exit code', () => {
  const raw = fixture(); raw.managerFailures = [{ kind: 'GPG', unitType: 'socket', result: 'exit-code' }];
  assert.deepEqual(summary(raw, context).managerFailures, [{ kind: 'GPG', unitType: 'socket', result: 'exit-code' }]);
});
test('M2.1 evidence and runtime are excluded from the M2.2 mutation surface', () => {
  const provision = fs.readFileSync(new URL('provision.sh', import.meta.url), 'utf8');
  assert.match(provision, /dpkg-deb --extract/); assert.match(provision, /--no-upgrade --no-remove/);
  assert.doesNotMatch(provision, /sysctl|apparmor_parser|docker system prune|systemctl restart docker|apt-get upgrade/);
  const run = fs.readFileSync(new URL('run.mjs', import.meta.url), 'utf8');
  assert.match(run, /\['reset-failed', expectedFailure\]/);
  assert.doesNotMatch(run, /\['reset-failed'\]/);
  assert.doesNotMatch(run, /Environment=DOCKERD_ROOTLESS_ROOTLESSKIT=/);
  assert.match(run, /Environment=XDG_RUNTIME_DIR=\/run\/user\/\$\{process\.getuid\(\)\}/);
  assert.match(run, /Environment=DBUS_SESSION_BUS_ADDRESS=unix:path=\/run\/user\//);
  assert.match(provision, /ln -s \/usr\/bin\/rootlesskit \/opt\/lumina-m22-fixture\/bin\/docker-rootlesskit/);
});
