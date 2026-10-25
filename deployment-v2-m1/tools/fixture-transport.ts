import fs from 'node:fs';
import path from 'node:path';
import { generateKeyPairSync, sign } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { experiment, sha256 } from '../src/safety.ts';

export function buildTransportFixture(root: string, payload = Buffer.alloc(1024)) {
  experiment(root);
  const base = path.join(root, 'oci'); fs.mkdirSync(base, { mode: 0o700 });
  fs.mkdirSync(path.join(base, 'blobs/sha256'), { recursive: true, mode: 0o700 });
  const put = (bytes: Buffer, mediaType: string) => {
    const digest = `sha256:${sha256(bytes)}`; fs.writeFileSync(path.join(base, 'blobs/sha256', digest.slice(7)), bytes, { flag: 'wx', mode: 0o600 }); return { mediaType, digest, size: bytes.length };
  };
  const layer = put(gzipSync(payload), 'application/vnd.oci.image.layer.v1.tar+gzip');
  const config = put(Buffer.from(JSON.stringify({ os: 'linux', architecture: 'amd64', rootfs: { type: 'layers', diff_ids: [`sha256:${sha256(payload)}`] } })), 'application/vnd.oci.image.config.v1+json');
  const manifest = put(Buffer.from(JSON.stringify({ schemaVersion: 2, mediaType: 'application/vnd.oci.image.manifest.v1+json', config, layers: [layer] })), 'application/vnd.oci.image.manifest.v1+json');
  const index = Buffer.from(JSON.stringify({ schemaVersion: 2, manifests: [manifest] }));
  fs.writeFileSync(path.join(base, 'index.json'), index); fs.writeFileSync(path.join(base, 'oci-layout'), JSON.stringify({ imageLayoutVersion: '1.0.0' }));
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const source = { repositoryId: '424242', issuer: 'https://example.invalid/issuer', workflow: 'fictional/release.yml', ref: 'refs/tags/fictional-m1', commit: 'a'.repeat(40) };
  const value = { kind: 'lumina.m1.fictional-transport', source, indexDigest: `sha256:${sha256(index)}`, manifestDigest: manifest.digest, platform: { os: 'linux', architecture: 'amd64' }, maxObjectBytes: 16 * 1024 ** 2, maxUnpackedBytes: 8 * 1024 ** 2 };
  const signed = (v: unknown): [Buffer, Buffer] => { const raw = Buffer.from(JSON.stringify(v)); return [raw, sign(null, raw, privateKey)]; };
  return { base, value, signed, trust: { ...source, publicKey }, layer, config };
}
