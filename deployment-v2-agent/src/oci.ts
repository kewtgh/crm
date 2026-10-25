// M1 OCI content-graph checks, separated from signing; the outer M2 manifest owns identity.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createGunzip } from 'node:zlib';
import { assert, boundedRead, record, sha256, trustedFile } from './common.ts';

type Descriptor = { digest: string; size: number; mediaType: string };
export type OciInput = { indexDigest: string; manifestDigest: string; maximumObjectBytes: number; maximumUnpackedBytes: number };
const DIGEST = /^sha256:[0-9a-f]{64}$/;
function descriptor(value: unknown): Descriptor {
  assert(record(value) && DIGEST.test(String(value.digest)) && Number.isSafeInteger(value.size) && Number(value.size) >= 0 && Number(value.size) <= 134_217_728 && typeof value.mediaType === 'string' && !Object.hasOwn(value, 'urls') && !Object.hasOwn(value, 'data'), 'OCI_DESCRIPTOR_INVALID'); return value as Descriptor;
}
function blob(root: string, d: Descriptor) { const file = path.join(root, 'blobs/sha256', d.digest.slice(7)); trustedFile(file, false); return file; }
function json(root: string, d: Descriptor) { const raw = boundedRead(blob(root, d), 1_048_576); assert(raw.length === d.size && `sha256:${sha256(raw)}` === d.digest, 'OCI_DIGEST_MISMATCH'); const value: unknown = JSON.parse(raw.toString()); assert(record(value), 'OCI_JSON_INVALID'); return value; }
export async function verifyOci(root: string, input: OciInput, deadline: number) {
  assert(DIGEST.test(input.indexDigest) && DIGEST.test(input.manifestDigest) && Number.isSafeInteger(input.maximumObjectBytes) && input.maximumObjectBytes > 0 && input.maximumObjectBytes <= 134_217_728 && Number.isSafeInteger(input.maximumUnpackedBytes) && input.maximumUnpackedBytes > 0 && input.maximumUnpackedBytes <= 268_435_456, 'OCI_BUDGET_INVALID');
  const layout: unknown = JSON.parse(boundedRead(path.join(root, 'oci-layout'), 4096).toString());
  assert(record(layout) && layout.imageLayoutVersion === '1.0.0' && Object.keys(layout).length === 1, 'OCI_LAYOUT_INVALID');
  const raw = boundedRead(path.join(root, 'index.json')); assert(`sha256:${sha256(raw)}` === input.indexDigest, 'OCI_DIGEST_MISMATCH');
  const index: unknown = JSON.parse(raw.toString()); assert(record(index) && index.schemaVersion === 2 && Array.isArray(index.manifests) && index.manifests.length === 1, 'OCI_INDEX_INVALID');
  const manifestDescriptor = descriptor(index.manifests[0]); assert(manifestDescriptor.digest === input.manifestDigest && manifestDescriptor.mediaType === 'application/vnd.oci.image.manifest.v1+json', 'OCI_MANIFEST_INVALID');
  const manifest = json(root, manifestDescriptor), configDescriptor = descriptor(manifest.config), config = json(root, configDescriptor);
  assert(manifest.schemaVersion === 2 && Array.isArray(manifest.layers) && manifest.layers.length > 0 && manifest.layers.length <= 16 && configDescriptor.mediaType === 'application/vnd.oci.image.config.v1+json' && config.os === 'linux' && config.architecture === 'amd64' && record(config.rootfs) && config.rootfs.type === 'layers' && Array.isArray(config.rootfs.diff_ids) && config.rootfs.diff_ids.length === manifest.layers.length, 'OCI_CONFIG_INVALID');
  let objectBytes = raw.length + manifestDescriptor.size + configDescriptor.size, unpackedBytes = 0;
  const expected = new Set([manifestDescriptor.digest.slice(7), configDescriptor.digest.slice(7)]);
  for (let i = 0; i < manifest.layers.length; i++) {
    assert(performance.now() < deadline, 'VERIFY_DEADLINE');
    const d = descriptor(manifest.layers[i]), diff = config.rootfs.diff_ids[i];
    assert(['application/vnd.oci.image.layer.v1.tar', 'application/vnd.oci.image.layer.v1.tar+gzip'].includes(d.mediaType) && typeof diff === 'string' && DIGEST.test(diff), 'OCI_LAYER_INVALID');
    objectBytes += d.size; assert(objectBytes <= input.maximumObjectBytes, 'OCI_BUDGET_EXCEEDED'); expected.add(d.digest.slice(7));
    const file = blob(root, d); assert(fs.statSync(file).size === d.size, 'OCI_SIZE_MISMATCH');
    const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    const source = fs.createReadStream(file, { fd, autoClose: true, signal: AbortSignal.timeout(Math.max(1, Math.min(5000, Math.floor(deadline - performance.now())))) });
    const compressed = createHash('sha256'), uncompressed = createHash('sha256'); source.on('data', b => compressed.update(b));
    const stream = d.mediaType.endsWith('+gzip') ? source.pipe(createGunzip()) : source;
    if (stream !== source) source.on('error', e => stream.destroy(e));
    try { for await (const b of stream) { assert(performance.now() < deadline, 'VERIFY_DEADLINE'); unpackedBytes += b.length; assert(unpackedBytes <= input.maximumUnpackedBytes, 'OCI_DECOMPRESSION_LIMIT'); uncompressed.update(b); } }
    finally { source.destroy(); if (stream !== source) stream.destroy(); }
    assert(`sha256:${compressed.digest('hex')}` === d.digest && `sha256:${uncompressed.digest('hex')}` === diff, 'OCI_DIGEST_MISMATCH');
  }
  const directory = fs.opendirSync(path.join(root, 'blobs/sha256')); let count = 0;
  try { let entry; while ((entry = directory.readSync())) assert(entry.isFile() && expected.delete(entry.name) && ++count <= 18, 'OCI_UNDECLARED_CONTENT'); }
  finally { directory.closeSync(); }
  assert(expected.size === 0, 'OCI_CONTENT_MISSING');
  return { manifestDigest: manifestDescriptor.digest, configDigest: configDescriptor.digest, objectBytes, unpackedBytes, dockerLoad: 'NOT_RUN', dockerIncrementalBytes: 'NOT_RUN' };
}
