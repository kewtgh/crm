import fs from 'node:fs';
import path from 'node:path';
import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { exclusiveFile, hashFile, sha256, VERSION } from '../src/common.ts';
import { RELEASE_IDENTITY, type ReleaseManifest, type TrustPolicy } from '../src/release.ts';

// Independently fictional, ephemeral test identities. Never writes a private key or creates a production trust root.
export function signingFixture() {
  const key = generateKeyPairSync('ed25519');
  const trust: TrustPolicy = { kind: 'lumina.alpha.trust', scope: 'NONPRODUCTION_ALPHA', keyUsage: 'TEST_ONLY', publicKeyPem: key.publicKey.export({ type: 'spki', format: 'pem' }).toString(), sourceCommit: 'a'.repeat(40) };
  return { privateKey: key.privateKey, trust };
}
export function signManifest(root: string, manifest: ReleaseManifest, key: KeyObject, replace = false) {
  const raw = Buffer.from(JSON.stringify(manifest));
  if (replace) { fs.writeFileSync(path.join(root, 'release.json'), raw); fs.writeFileSync(path.join(root, 'release.sig'), sign(null, raw, key)); }
  else { exclusiveFile(path.join(root, 'release.json'), raw); exclusiveFile(path.join(root, 'release.sig'), sign(null, raw, key)); }
}
function fileList(root: string, relative = 'payload'): ReleaseManifest['files'] {
  return fs.readdirSync(path.join(root, relative), { withFileTypes: true }).flatMap(e => {
    const name = `${relative}/${e.name}`;
    return e.isDirectory() ? fileList(root, name) : [{ path: name, ...hashFile(path.join(root, name)) }];
  }).sort((a, b) => a.path.localeCompare(b.path));
}
export function applicationFixture(parent: string, payload = Buffer.alloc(1024)) {
  const root = path.join(parent, 'application-release'); fs.mkdirSync(root, { mode: 0o700 });
  const oci = path.join(root, 'payload/oci'); fs.mkdirSync(path.join(oci, 'blobs/sha256'), { recursive: true, mode: 0o700 });
  const put = (raw: Buffer, mediaType: string) => { const digest = `sha256:${sha256(raw)}`; exclusiveFile(path.join(oci, 'blobs/sha256', digest.slice(7)), raw); return { mediaType, digest, size: raw.length }; };
  const layer = put(gzipSync(payload), 'application/vnd.oci.image.layer.v1.tar+gzip');
  const config = put(Buffer.from(JSON.stringify({ os: 'linux', architecture: 'amd64', rootfs: { type: 'layers', diff_ids: [`sha256:${sha256(payload)}`] } })), 'application/vnd.oci.image.config.v1+json');
  const manifestDescriptor = put(Buffer.from(JSON.stringify({ schemaVersion: 2, mediaType: 'application/vnd.oci.image.manifest.v1+json', config, layers: [layer] })), 'application/vnd.oci.image.manifest.v1+json');
  const index = Buffer.from(JSON.stringify({ schemaVersion: 2, manifests: [manifestDescriptor] }));
  exclusiveFile(path.join(oci, 'index.json'), index); exclusiveFile(path.join(oci, 'oci-layout'), '{"imageLayoutVersion":"1.0.0"}');
  const keys = signingFixture();
  const manifest: ReleaseManifest = { format: 'lumina.offline-directory.v1', scope: 'NONPRODUCTION_ALPHA', kind: 'APPLICATION', version: '0.0.0-fixture.1', source: { ...RELEASE_IDENTITY, commit: keys.trust.sourceCommit, ref: 'refs/tags/app-v0.0.0-fixture.1' }, platform: { os: 'linux', architecture: 'x64' }, agentProtocol: 1, storeEpoch: 1, files: fileList(root), oci: { indexDigest: `sha256:${sha256(index)}`, manifestDigest: manifestDescriptor.digest, maximumObjectBytes: 134_217_728, maximumUnpackedBytes: 268_435_456 } };
  signManifest(root, manifest, keys.privateKey); return { root, manifest, ...keys };
}
export function agentFixture(parent: string, runtimeRoot: string) {
  const root = path.join(parent, 'agent-release'); fs.mkdirSync(root, { mode: 0o700 });
  fs.cpSync(runtimeRoot, path.join(root, 'payload'), { recursive: true });
  const keys = signingFixture(), manifest: ReleaseManifest = { format: 'lumina.offline-directory.v1', scope: 'NONPRODUCTION_ALPHA', kind: 'AGENT', version: VERSION, source: { ...RELEASE_IDENTITY, commit: keys.trust.sourceCommit, ref: `refs/tags/agent-v${VERSION}` }, platform: { os: process.platform, architecture: process.arch }, agentProtocol: 1, storeEpoch: 1, files: fileList(root), oci: null };
  signManifest(root, manifest, keys.privateKey); return { root, manifest, ...keys };
}
