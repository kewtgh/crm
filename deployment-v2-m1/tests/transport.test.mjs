import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { generateKeyPairSync } from 'node:crypto';
import { fixture } from './helpers.mjs';
import { verifyFictionalTransport } from '../src/transport.ts';
import { buildTransportFixture } from '../tools/fixture-transport.ts';

function transportFixture(t, payload = Buffer.alloc(1024)) {
  return buildTransportFixture(fixture(t), payload);
}
test('actual signature and OCI content graph are verified without Docker or a Registry', async t => {
  const f = transportFixture(t), r = await verifyFictionalTransport(f.base, ...f.signed(f.value), f.trust);
  assert.equal(r.signature, 'PASS'); assert.notEqual(r.manifestDigest, r.configDigest);
  assert.equal(r.imageContentBytes, 1024); assert.equal(r.dockerLoad, 'NOT_RUN'); assert.equal(r.productionCiProvenance, 'NOT_RUN');
  assert.equal(r.evidenceClass, 'EPHEMERAL_TEST_KEY_ONLY');
});
test('content hash alone cannot establish source identity or a trusted signer', async t => {
  const f = transportFixture(t), other = generateKeyPairSync('ed25519');
  await assert.rejects(verifyFictionalTransport(f.base, ...f.signed(f.value), { ...f.trust, publicKey: other.publicKey }), { code: 'SOURCE_SIGNATURE_INVALID' });
  for (const key of ['repositoryId', 'issuer', 'workflow', 'ref', 'commit']) await assert.rejects(verifyFictionalTransport(f.base, ...f.signed(f.value), { ...f.trust, [key]: 'wrong-identity' }), { code: 'SOURCE_IDENTITY_MISMATCH' });
});
test('manifest and compressed layer tampering are rejected before any load', async t => {
  const f = transportFixture(t), [bytes, signature] = f.signed(f.value);
  bytes[bytes.length - 2] ^= 1; await assert.rejects(verifyFictionalTransport(f.base, bytes, signature, f.trust), { code: 'SOURCE_SIGNATURE_INVALID' });
  const file = path.join(f.base, 'blobs/sha256', f.layer.digest.slice(7)), layer = fs.readFileSync(file); layer[10] ^= 1; fs.writeFileSync(file, layer);
  await assert.rejects(verifyFictionalTransport(f.base, ...f.signed(f.value), f.trust));
});
test('decompression and signed byte budgets fail closed', async t => {
  const f = transportFixture(t, Buffer.alloc(64 * 1024));
  await assert.rejects(verifyFictionalTransport(f.base, ...f.signed({ ...f.value, maxUnpackedBytes: 1024 }), f.trust), { code: 'DECOMPRESSION_LIMIT' });
  await assert.rejects(verifyFictionalTransport(f.base, ...f.signed({ ...f.value, maxObjectBytes: 10 }), f.trust), { code: 'TRANSPORT_BUDGET_EXCEEDED' });
});
test('unbudgeted objects and platform claims cannot be smuggled into a transport', async t => {
  const f = transportFixture(t);
  await assert.rejects(verifyFictionalTransport(f.base, ...f.signed({ ...f.value, platform: { os: 'linux', architecture: 'arm64' } }), f.trust), { code: 'PLATFORM_MISMATCH' });
  for (const extra of [path.join(f.base, 'blobs/sha256', 'f'.repeat(64)), path.join(f.base, 'fictional-extra'), path.join(f.base, 'blobs/fictional-extra')]) {
    fs.writeFileSync(extra, 'FICTIONAL_ORPHAN', { flag: 'wx' });
    await assert.rejects(verifyFictionalTransport(f.base, ...f.signed(f.value), f.trust), { code: 'UNDECLARED_CONTENT' });
    fs.unlinkSync(extra);
  }
});
