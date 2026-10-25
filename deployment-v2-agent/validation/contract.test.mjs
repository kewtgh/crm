import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { assertionDetail, emptyReport, harnessDetail, managerHealth, publicSummary, CASES } from './contract.mjs';

const context = { sha: 'a'.repeat(40), runId: '123456789', attempt: '1', sourceDigest: 'b'.repeat(64) };
test('publication rejects stale SHA, run and attempt independently', () => {
  for (const changed of [{ sha: 'c'.repeat(40) }, { runId: '987654321' }, { attempt: '2' }]) {
    assert.throws(() => publicSummary({ ...emptyReport(context), ...changed }, context), /STALE_EVIDENCE/);
  }
});
test('publication includes every capability and never turns missing execution into PASS', () => {
  const raw = emptyReport(context), summary = publicSummary(raw, context);
  assert.equal(summary.result, 'FAIL'); assert.equal(summary.completed, false);
  assert.equal(summary.cases.length, CASES.length);
  assert(summary.cases.every(c => c.status === 'NOT_RUN'));
  delete raw.cases['kernel-flock']; assert.throws(() => publicSummary(raw, context));
});
test('positive extraction removes private data at every publication boundary', () => {
  const marker = 'FICTIONAL-PRIVATE-MARKER', raw = emptyReport(context);
  raw.private = marker; raw.environment = { node: '24.22.1', kernel: marker, PATH: marker };
  raw.metrics = { agentMemoryPeakBytes: 42000000, stateBytes: marker, secret: marker };
  raw.cases['cli-exit'] = { status: 'PASS', code: 'OBSERVED', log: marker };
  const summary = publicSummary(raw, context);
  assert.doesNotMatch(JSON.stringify(summary), /FICTIONAL-PRIVATE-MARKER/);
  assert.deepEqual(summary.environment, { node: '24.22.1' });
  assert.deepEqual(summary.metrics, { agentMemoryPeakBytes: 42000000 });
  assert.deepEqual(summary.cases.find(c => c.id === 'cli-exit'), { id: 'cli-exit', status: 'PASS', code: 'OBSERVED' });
  raw.cases['cli-exit'].code = marker; assert.throws(() => publicSummary(raw, context));
});
test('failures and NOT_RUN remain visible, pass requires direct observation', () => {
  const raw = emptyReport(context); raw.completed = true;
  raw.cases.timeout = { status: 'FAIL', code: 'ASSERTION_FAILED' };
  assert.equal(publicSummary(raw, context).result, 'FAIL');
  raw.cases.timeout = { status: 'PASS', code: 'NOT_EXECUTED' };
  assert.throws(() => publicSummary(raw, context));
});
test('failure comparisons retain only reviewed enum and numeric evidence', () => {
  assert.deepEqual(assertionDetail({ code: 'ERR_ASSERTION', operator: 'strictEqual', expected: 32,
    actual: 'FICTIONAL-PRIVATE-MARKER', message: 'FICTIONAL-PRIVATE-MARKER', path: 'FICTIONAL-PRIVATE-MARKER' }),
  { code: 'ERR_ASSERTION', operator: 'strictEqual', expected: 32 });
  assert.deepEqual(harnessDetail({ phase: 'USER_MANAGER_HEALTH', command: 'systemctl', exitCode: 1,
    managerState: 'degraded', stderr: 'FICTIONAL-PRIVATE-MARKER', env: 'FICTIONAL-PRIVATE-MARKER' }),
  { phase: 'USER_MANAGER_HEALTH', command: 'systemctl', exitCode: 1, managerState: 'degraded' });
});
test('manager health separates degraded units from an unavailable manager without clearing failures', () => {
  assert.equal(managerHealth(0, 'running\n'), 'running');
  assert.equal(managerHealth(1, 'degraded\n'), 'degraded');
  for (const [code, value] of [[1, 'offline'], [1, 'stopping'], [1, 'starting'], [1, 'initializing'], [1, 'running'], [0, 'degraded'], [null, '']]) {
    assert.throws(() => managerHealth(code, value), /USER_MANAGER_UNAVAILABLE/);
  }
});
test('host fixture cannot run without an explicit disposable hosted-runner boundary', () => {
  const workflow = fs.readFileSync(new URL('../../.github/workflows/deployment-v2-agent.yml', import.meta.url), 'utf8');
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /github\.event_name == 'push' && github\.ref == 'refs\/heads\/validation\/deployment-v2-m2\.1'/);
  assert.doesNotMatch(workflow, /pull_request_target|secrets\.|runs-on:.*self-hosted|docker\.sock.*volume/);
  const provision = fs.readFileSync(new URL('provision.sh', import.meta.url), 'utf8');
  assert.match(provision, /RUNNER_ENVIRONMENT:-.*github-hosted/);
  assert.match(provision, /test ! -e \/opt\/lumina-m21-fixture/);
  assert.doesNotMatch(provision, /sysctl|apparmor_parser|usermod|docker system prune|systemctl restart docker/);
});
