import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { fixture, runtime, cli, invoke } from './helpers.mjs';
import { buildRuntime } from '../tools/build.ts';
import { alphaPath } from '../src/common.ts';

test('compiled runtime uses builtins and same-package modules, has no V1 or CRM imports', () => {
  for (const name of fs.readdirSync(path.join(runtime.root, 'lib'))) {
    const code = fs.readFileSync(path.join(runtime.root, 'lib', name), 'utf8');
    for (const match of code.matchAll(/from ['"]([^'"]+)['"]/g)) assert.ok(match[1].startsWith('node:') || /^\.\/[a-z-]+\.mjs$/.test(match[1]));
    assert.doesNotMatch(code, /deploy-production|production-deploy|deployment-v2-m1|node_modules|\bfetch\s*\(|\beval\s*\(|shell:\s*true/);
  }
  assert.equal(fs.realpathSync(runtime.node), runtime.node);
});
test('an application request cannot mutate or upgrade the Agent or systemd attributes', t => {
  const root = fixture(t);
  assert.equal(JSON.parse(cli(['upgrade', '--root', root]).stderr).code, 'COMMAND_NOT_ALLOWED');
  assert.equal(JSON.parse(cli(['dispatch', '--root', root, '--property', 'Restart=always']).stderr).code, 'ARGUMENT_INVALID');
  assert.equal(JSON.parse(cli(['dispatch', '--root', root]).stderr).code, 'ISOLATED_USER_MANAGER_REQUIRED');
  assert.throws(() => alphaPath(path.dirname(root)), { code: 'ALPHA_SCOPE_REQUIRED' });
  const policyFile = path.join(root, 'site.json'), policy = JSON.parse(fs.readFileSync(policyFile)); policy.agentDigest = 'b'.repeat(64); fs.writeFileSync(policyFile, JSON.stringify(policy));
  const before = fs.readFileSync(path.join(root, 'state.sqlite'));
  assert.equal(JSON.parse(cli(['plan', '--root', root]).stderr).code, 'AGENT_BINDING_MISMATCH');
  assert.deepEqual(fs.readFileSync(path.join(root, 'state.sqlite')), before);
});
test('runtime drift and a host Node substitution fail before task admission', t => {
  const root = fixture(t), copy = buildRuntime(path.join(root, 'another-runtime'));
  fs.appendFileSync(path.join(copy.root, 'lib/protocol.mjs'), '\n// fictional drift\n');
  const result = invoke(copy.cli, ['status', '--root', root]);
  // Using the original runtime to run another payload is itself refused before any code is trusted.
  assert.equal(result.status, 1); assert.equal(JSON.parse(result.stderr).code, 'PRIVATE_RUNTIME_REQUIRED');
  const drift = spawnSync(copy.node, [copy.cli, 'status', '--root', root], { encoding: 'utf8', timeout: 8000 });
  assert.equal(drift.status, 1); assert.equal(JSON.parse(drift.stderr).code, 'RUNTIME_INTEGRITY_MISMATCH');
});
test('fixed oneshot asset is not installed or enabled by any runtime module', () => {
  const source = fileURLToPath(new URL('../src/platform.ts', import.meta.url)), code = fs.readFileSync(source, 'utf8');
  assert.ok(code.includes("['--user', 'start', '--no-block', UNIT_NAME]"));
  assert.doesNotMatch(code, /systemd-run|daemon-reload|['"]enable['"]|['"]restart['"]|['"]sudo['"]/);
});
