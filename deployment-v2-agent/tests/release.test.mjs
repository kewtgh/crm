import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fixture, runtime, invoke } from './helpers.mjs';
import { applicationFixture, agentFixture, signManifest, signingFixture } from '../tools/fixtures.ts';
import { verifyRelease } from '../src/release.ts';
import { buildVerifier } from '../tools/build.ts';

test('offline directory v1 verifies signature, fixed identity and actual OCI digest graph', async t => {
  const f = applicationFixture(fixture(t)), result = await verifyRelease(f.root, f.trust, true);
  assert.equal(result.signature, 'PASS'); assert.equal(result.identityPolicy, 'PASS');
  assert.notEqual(result.image.manifestDigest, result.image.configDigest);
  assert.equal(result.image.unpackedBytes, 1024); assert.equal(result.image.dockerLoad, 'NOT_RUN'); assert.equal(result.ciProvenance, 'NOT_RUN');
  assert.equal(result.sourceProof, 'PINNED_KEY_SIGNED_CLAIMS_ONLY'); assert.equal(result.productionApproved, false);
});
test('test keys require explicit nonproduction mode and never satisfy a production policy', async t => {
  const f = applicationFixture(fixture(t));
  await assert.rejects(verifyRelease(f.root, f.trust), { code: 'TEST_KEY_NOT_APPROVED' });
  await assert.rejects(verifyRelease(f.root, { ...f.trust, scope: 'PRODUCTION' }, true), { code: 'TRUST_POLICY_INVALID' });
  await assert.rejects(verifyRelease(f.root, { ...f.trust, publicKeyPem: signingFixture().trust.publicKeyPem }, true), { code: 'RELEASE_SIGNATURE_INVALID' });
});
test('valid signature does not bypass workflow, repository, ref, commit or compatibility policy', async t => {
  const f = applicationFixture(fixture(t));
  for (const key of ['repositoryId', 'issuer', 'workflow', 'commit', 'ref']) {
    const m = structuredClone(f.manifest); m.source[key] = 'fictional-wrong-identity'; signManifest(f.root, m, f.privateKey, true);
    await assert.rejects(verifyRelease(f.root, f.trust, true), { code: 'RELEASE_IDENTITY_MISMATCH' });
  }
  const m = { ...f.manifest, storeEpoch: 2 }; signManifest(f.root, m, f.privateKey, true);
  await assert.rejects(verifyRelease(f.root, f.trust, true), { code: 'RELEASE_COMPATIBILITY_INVALID' });
});
test('tampered, undeclared, aliased and traversal content is refused without extraction', async t => {
  const f = applicationFixture(fixture(t));
  const extra = path.join(f.root, 'fictional-extra'); fs.writeFileSync(extra, 'not signed');
  await assert.rejects(verifyRelease(f.root, f.trust, true), { code: 'RELEASE_UNDECLARED_CONTENT' }); fs.unlinkSync(extra);
  const m = structuredClone(f.manifest); m.files[0].path = '../outside'; signManifest(f.root, m, f.privateKey, true);
  await assert.rejects(verifyRelease(f.root, f.trust, true), { code: 'RELEASE_FILE_LIST_INVALID' });
  signManifest(f.root, f.manifest, f.privateKey, true);
  const blob = path.join(f.root, f.manifest.files[0].path), before = fs.readFileSync(blob);
  fs.writeFileSync(blob, 'tampered'); await assert.rejects(verifyRelease(f.root, f.trust, true), { code: 'RELEASE_INTEGRITY_MISMATCH' }); fs.writeFileSync(blob, before);
  fs.linkSync(blob, path.join(f.root, 'fictional-alias'));
  await assert.rejects(verifyRelease(f.root, f.trust, true));
});
test('signed decompression budget cannot be exceeded and image config identity is distinct', async t => {
  const f = applicationFixture(fixture(t), Buffer.alloc(64 * 1024));
  f.manifest.oci.maximumUnpackedBytes = 1024; signManifest(f.root, f.manifest, f.privateKey, true);
  await assert.rejects(verifyRelease(f.root, f.trust, true), { code: 'OCI_DECOMPRESSION_LIMIT' });
});
test('independent verifier authenticates a complete private-runtime Agent without running its code', async t => {
  const root = fixture(t), f = agentFixture(root, runtime.root), entry = buildVerifier(path.join(root, 'independent-verifier'));
  const trustFile = path.join(root, 'trust.json'); fs.writeFileSync(trustFile, JSON.stringify(f.trust), { mode: 0o600 });
  const args = ['--directory', f.root, '--trust', trustFile, '--allow-test-key'];
  const good = invoke(entry, args); assert.equal(good.status, 0, good.stderr); assert.equal(JSON.parse(good.stdout).kind, 'AGENT');
  const canary = path.join(root, 'must-not-exist');
  fs.writeFileSync(path.join(f.root, 'payload/lib/cli.mjs'), `import fs from 'node:fs'; fs.writeFileSync(${JSON.stringify(canary)}, 'FICTIONAL_UNTRUSTED_EXECUTION');`);
  const bad = invoke(entry, args); assert.equal(bad.status, 1); assert.equal(JSON.parse(bad.stderr).code, 'RELEASE_INTEGRITY_MISMATCH'); assert.equal(fs.existsSync(canary), false);
});
