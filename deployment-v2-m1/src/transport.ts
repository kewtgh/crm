import fs from 'node:fs';
import path from 'node:path';
import { createHash, verify, type KeyObject } from 'node:crypto';
import { createGunzip } from 'node:zlib';
import { assert, boundedRead, isRecord, keys, sha256 } from './safety.ts';

export type SourcePolicy = { repositoryId: string; issuer: string; workflow: string; ref: string; commit: string; publicKey: KeyObject };
export type Descriptor = { digest: string; size: number; mediaType: string };
const DIGEST = /^sha256:[0-9a-f]{64}$/;
export function descriptor(v: unknown): Descriptor {
  assert(isRecord(v) && typeof v.digest === 'string' && DIGEST.test(v.digest) && Number.isSafeInteger(v.size) && Number(v.size) >= 0 && Number(v.size) <= 16 * 1024 ** 2 && typeof v.mediaType === 'string', 'DESCRIPTOR_INVALID');
  assert(!Object.hasOwn(v, 'urls') && !Object.hasOwn(v, 'data'), 'EXTERNAL_CONTENT_FORBIDDEN');
  return v as Descriptor;
}
function fileInside(base: string, relative: string) {
  assert(fs.realpathSync(base) === path.resolve(base) && !fs.lstatSync(base).isSymbolicLink(), 'ARTIFACT_PATH_UNTRUSTED');
  const file = path.join(base, relative);
  let parent = path.dirname(file);
  while (parent !== base) { assert(fs.lstatSync(parent).isDirectory() && fs.realpathSync(parent) === parent, 'ARTIFACT_PATH_UNTRUSTED'); parent = path.dirname(parent); }
  const s = fs.lstatSync(file);
  assert(s.isFile() && !s.isSymbolicLink() && fs.realpathSync(file) === file, 'ARTIFACT_PATH_UNTRUSTED'); return file;
}
function blobFile(base: string, d: Descriptor) { return fileInside(base, `blobs/sha256/${d.digest.slice(7)}`); }
function exactDirectory(base: string, expected: string[]) {
  const pending = new Set(expected), directory = fs.opendirSync(base);
  try {
    let entry;
    while ((entry = directory.readSync())) {
      assert(pending.delete(entry.name), 'UNDECLARED_CONTENT');
    }
  } finally { directory.closeSync(); }
  assert(pending.size === 0, 'CONTENT_MISSING');
}
function jsonBlob(base: string, d: Descriptor) {
  const bytes = boundedRead(blobFile(base, d), 1_048_576);
  assert(bytes.length === d.size && `sha256:${sha256(bytes)}` === d.digest, 'CONTENT_DIGEST_MISMATCH');
  const value: unknown = JSON.parse(bytes.toString()); assert(isRecord(value), 'OCI_JSON_INVALID'); return value;
}
async function layer(base: string, d: Descriptor, expectedDiffId: string, maximum: number) {
  assert(['application/vnd.oci.image.layer.v1.tar', 'application/vnd.oci.image.layer.v1.tar+gzip'].includes(d.mediaType), 'LAYER_FORMAT_UNSUPPORTED');
  const file = blobFile(base, d); assert(fs.statSync(file).size === d.size, 'CONTENT_SIZE_MISMATCH');
  const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  const source = fs.createReadStream(file, { fd, autoClose: true, signal: AbortSignal.timeout(5000) });
  const compressed = createHash('sha256'), uncompressed = createHash('sha256');
  source.on('data', b => { compressed.update(b); });
  const stream = d.mediaType.endsWith('+gzip') ? source.pipe(createGunzip()) : source;
  if (stream !== source) source.on('error', e => stream.destroy(e));
  let size = 0;
  try {
    for await (const chunk of stream) {
      size += chunk.length; assert(size <= maximum, 'DECOMPRESSION_LIMIT'); uncompressed.update(chunk);
    }
  } finally { source.destroy(); if (stream !== source) stream.destroy(); }
  assert(`sha256:${compressed.digest('hex')}` === d.digest && `sha256:${uncompressed.digest('hex')}` === expectedDiffId, 'CONTENT_DIGEST_MISMATCH'); return size;
}
export async function verifyFictionalTransport(base: string, rawManifest: Buffer, signature: Buffer, trust: SourcePolicy) {
  base = path.resolve(base);
  assert(rawManifest.length <= 65_536 && signature.length <= 512 && verify(null, rawManifest, trust.publicKey, signature), 'SOURCE_SIGNATURE_INVALID');
  const value: unknown = JSON.parse(rawManifest.toString()); assert(isRecord(value), 'TRANSPORT_MANIFEST_INVALID');
  keys(value, ['kind', 'source', 'indexDigest', 'manifestDigest', 'platform', 'maxObjectBytes', 'maxUnpackedBytes']);
  assert(value.kind === 'lumina.m1.fictional-transport' && isRecord(value.source) && isRecord(value.platform), 'TRANSPORT_MANIFEST_INVALID');
  keys(value.source, ['repositoryId', 'issuer', 'workflow', 'ref', 'commit']); keys(value.platform, ['os', 'architecture']);
  for (const key of ['repositoryId', 'issuer', 'workflow', 'ref', 'commit'] as const) assert(value.source[key] === trust[key], 'SOURCE_IDENTITY_MISMATCH');
  assert(/^[0-9a-f]{40}$/.test(trust.commit), 'SOURCE_IDENTITY_INVALID');
  assert(value.platform.os === 'linux' && value.platform.architecture === 'amd64', 'PLATFORM_MISMATCH');
  assert(typeof value.indexDigest === 'string' && DIGEST.test(value.indexDigest) && typeof value.manifestDigest === 'string' && DIGEST.test(value.manifestDigest), 'TRANSPORT_MANIFEST_INVALID');
  assert(Number.isSafeInteger(value.maxObjectBytes) && Number(value.maxObjectBytes) > 0 && Number(value.maxObjectBytes) <= 16 * 1024 ** 2 && Number.isSafeInteger(value.maxUnpackedBytes) && Number(value.maxUnpackedBytes) > 0 && Number(value.maxUnpackedBytes) <= 8 * 1024 ** 2, 'TRANSPORT_BUDGET_INVALID');
  const indexBytes = boundedRead(fileInside(base, 'index.json'));
  const layoutBytes = boundedRead(fileInside(base, 'oci-layout'), 4096);
  const layout: unknown = JSON.parse(layoutBytes.toString());
  assert(isRecord(layout) && layout.imageLayoutVersion === '1.0.0' && Object.keys(layout).length === 1, 'OCI_LAYOUT_INVALID');
  assert(`sha256:${sha256(indexBytes)}` === value.indexDigest, 'CONTENT_DIGEST_MISMATCH');
  const index: unknown = JSON.parse(indexBytes.toString());
  assert(isRecord(index) && index.schemaVersion === 2 && Array.isArray(index.manifests) && index.manifests.length === 1, 'OCI_INDEX_INVALID');
  const m = descriptor(index.manifests[0]);
  assert(m.digest === value.manifestDigest && m.mediaType === 'application/vnd.oci.image.manifest.v1+json', 'OCI_MANIFEST_INVALID');
  const manifest = jsonBlob(base, m);
  assert(manifest.schemaVersion === 2 && Array.isArray(manifest.layers) && manifest.layers.length > 0 && manifest.layers.length <= 16, 'OCI_MANIFEST_INVALID');
  const configDescriptor = descriptor(manifest.config), config = jsonBlob(base, configDescriptor);
  assert(configDescriptor.mediaType === 'application/vnd.oci.image.config.v1+json' && config.os === 'linux' && config.architecture === 'amd64' && isRecord(config.rootfs) && config.rootfs.type === 'layers' && Array.isArray(config.rootfs.diff_ids) && config.rootfs.diff_ids.length === manifest.layers.length, 'OCI_CONFIG_INVALID');
  let objectBytes = indexBytes.length + layoutBytes.length + m.size + configDescriptor.size, imageContentBytes = 0;
  const expectedBlobs = new Set([m.digest.slice(7), configDescriptor.digest.slice(7)]);
  for (let i = 0; i < manifest.layers.length; i++) {
    const d = descriptor(manifest.layers[i]), diff = config.rootfs.diff_ids[i];
    expectedBlobs.add(d.digest.slice(7));
    assert(typeof diff === 'string' && DIGEST.test(diff), 'OCI_CONFIG_INVALID');
    objectBytes += d.size; assert(objectBytes <= Number(value.maxObjectBytes), 'TRANSPORT_BUDGET_EXCEEDED');
    imageContentBytes += await layer(base, d, diff, Number(value.maxUnpackedBytes) - imageContentBytes);
  }
  // A directory transport may not hide unbudgeted/orphan objects or symlink entries.
  exactDirectory(base, ['blobs', 'index.json', 'oci-layout']);
  exactDirectory(path.join(base, 'blobs'), ['sha256']);
  const entries = fs.opendirSync(path.join(base, 'blobs/sha256'));
  try {
    let entry; let count = 0;
    while ((entry = entries.readSync())) { assert(entry.isFile() && expectedBlobs.has(entry.name) && ++count <= 18, 'UNDECLARED_CONTENT'); expectedBlobs.delete(entry.name); }
  } finally { entries.closeSync(); }
  assert(expectedBlobs.size === 0, 'CONTENT_MISSING');
  assert(objectBytes <= Number(value.maxObjectBytes), 'TRANSPORT_BUDGET_EXCEEDED');
  return { kind: 'lumina.m1.transport-result', signature: 'PASS', identityPolicy: 'PASS', evidenceClass: 'EPHEMERAL_TEST_KEY_ONLY', productionCiProvenance: 'NOT_RUN', dockerLoad: 'NOT_RUN', manifestDigest: m.digest, configDigest: configDescriptor.digest, sameDigestKind: false, objectBytes, imageContentBytes, verifierScratchBytes: 0, dockerStorageOverhead: 'NOT_RUN', additionalDiskLowerBoundBytes: objectBytes + imageContentBytes };
}
