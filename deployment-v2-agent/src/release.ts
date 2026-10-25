import fs from 'node:fs';
import path from 'node:path';
import { createPublicKey, verify } from 'node:crypto';
import { assert, boundedRead, fields, hashFile, NODE_VERSION, record, sha256, VERSION } from './common.ts';
import { verifyOci, type OciInput } from './oci.ts';

export const RELEASE_IDENTITY = { repositoryId: '1302532628', issuer: 'https://token.actions.githubusercontent.com', workflow: '.github/workflows/deployment-v2-agent.yml' };
export type TrustPolicy = { kind: 'lumina.alpha.trust'; scope: 'NONPRODUCTION_ALPHA'; keyUsage: 'ALPHA_OPERATOR' | 'TEST_ONLY'; publicKeyPem: string; sourceCommit: string };
export type ReleaseManifest = { format: 'lumina.offline-directory.v1'; scope: 'NONPRODUCTION_ALPHA'; kind: 'AGENT' | 'APPLICATION'; version: string; source: typeof RELEASE_IDENTITY & { commit: string; ref: string }; platform: { os: string; architecture: string }; agentProtocol: 1; storeEpoch: 1; files: { path: string; bytes: number; sha256: string }[]; oci: OciInput | null };
function validateTrust(value: unknown, allowTestKey: boolean): asserts value is TrustPolicy {
  assert(record(value), 'TRUST_POLICY_INVALID'); fields(value, ['kind', 'scope', 'keyUsage', 'publicKeyPem', 'sourceCommit']);
  assert(value.kind === 'lumina.alpha.trust' && value.scope === 'NONPRODUCTION_ALPHA' && ['ALPHA_OPERATOR', 'TEST_ONLY'].includes(String(value.keyUsage)) && typeof value.publicKeyPem === 'string' && value.publicKeyPem.length <= 8192 && /^[0-9a-f]{40}$/.test(String(value.sourceCommit)), 'TRUST_POLICY_INVALID');
  assert(value.keyUsage !== 'TEST_ONLY' || allowTestKey, 'TEST_KEY_NOT_APPROVED');
}
function allowedFile(kind: ReleaseManifest['kind'], name: string) { return kind === 'AGENT' ? /^payload\/(?:lib\/[a-z-]+\.mjs|runtime\/node(?:\.exe)?|runtime-manifest\.json)$/.test(name) : /^payload\/oci\/(?:oci-layout|index\.json|blobs\/sha256\/[a-f0-9]{64})$/.test(name); }
function exactTree(root: string, files: string[]) {
  const expected = new Set(files), directories = new Set<string>();
  for (const f of files) { let d = path.posix.dirname(f); while (d !== '.') { directories.add(d); d = path.posix.dirname(d); } }
  let count = 0;
  const walk = (directory: string, prefix: string) => {
    assert(fs.realpathSync(directory) === directory && !fs.lstatSync(directory).isSymbolicLink(), 'RELEASE_PATH_UNTRUSTED');
    const entries = fs.opendirSync(directory);
    try { let entry; while ((entry = entries.readSync())) {
      assert(++count <= 96, 'RELEASE_ENTRY_LIMIT'); const relative = prefix + entry.name;
      if (entry.isDirectory()) { assert(directories.has(relative), 'RELEASE_UNDECLARED_CONTENT'); walk(path.join(directory, entry.name), `${relative}/`); }
      else assert(entry.isFile() && expected.delete(relative), 'RELEASE_UNDECLARED_CONTENT');
    } } finally { entries.closeSync(); }
  };
  walk(root, ''); assert(expected.size === 0, 'RELEASE_CONTENT_MISSING');
}
export async function verifyRelease(input: string, trustInput: unknown, allowTestKey = false) {
  const started = performance.now(), deadline = started + 10_000, root = path.resolve(input);
  validateTrust(trustInput, allowTestKey); const trust = trustInput;
  const key = createPublicKey(trust.publicKeyPem); assert(key.asymmetricKeyType === 'ed25519', 'SIGNATURE_ALGORITHM_INVALID');
  const raw = boundedRead(path.join(root, 'release.json')), signature = boundedRead(path.join(root, 'release.sig'), 64);
  assert(signature.length === 64 && verify(null, raw, key, signature), 'RELEASE_SIGNATURE_INVALID');
  const m: unknown = JSON.parse(raw.toString()); assert(record(m), 'RELEASE_MANIFEST_INVALID');
  fields(m, ['format', 'scope', 'kind', 'version', 'source', 'platform', 'agentProtocol', 'storeEpoch', 'files', 'oci']);
  assert(m.format === 'lumina.offline-directory.v1' && m.scope === 'NONPRODUCTION_ALPHA' && ['AGENT', 'APPLICATION'].includes(String(m.kind)) && m.agentProtocol === 1 && m.storeEpoch === 1 && typeof m.version === 'string' && /^\d+\.\d+\.\d+(?:-[a-z0-9.]+)?$/.test(m.version) && m.version.length <= 64, 'RELEASE_COMPATIBILITY_INVALID');
  assert(record(m.source) && record(m.platform), 'RELEASE_MANIFEST_INVALID'); fields(m.source, ['repositoryId', 'issuer', 'workflow', 'commit', 'ref']); fields(m.platform, ['os', 'architecture']);
  for (const k of ['repositoryId', 'issuer', 'workflow'] as const) assert(m.source[k] === RELEASE_IDENTITY[k], 'RELEASE_IDENTITY_MISMATCH');
  assert(m.source.commit === trust.sourceCommit && m.source.ref === `refs/tags/${m.kind === 'AGENT' ? 'agent' : 'app'}-v${m.version}`, 'RELEASE_IDENTITY_MISMATCH');
  assert(m.platform.architecture === 'x64' && (m.kind === 'AGENT' ? ['linux', 'win32'].includes(String(m.platform.os)) && m.version === VERSION : m.platform.os === 'linux'), 'RELEASE_PLATFORM_INVALID');
  assert(Array.isArray(m.files) && m.files.length > 0 && m.files.length <= 48, 'RELEASE_FILE_LIST_INVALID');
  const manifest = m as unknown as ReleaseManifest, names = new Set<string>(); let total = 0;
  for (const entry of manifest.files) {
    assert(record(entry), 'RELEASE_FILE_LIST_INVALID'); fields(entry, ['path', 'bytes', 'sha256']);
    assert(typeof entry.path === 'string' && allowedFile(manifest.kind, entry.path) && !names.has(entry.path) && /^[a-f0-9]{64}$/.test(String(entry.sha256)) && Number.isSafeInteger(entry.bytes) && entry.bytes >= 0, 'RELEASE_FILE_LIST_INVALID');
    names.add(entry.path); total += entry.bytes; assert(total <= (manifest.kind === 'AGENT' ? 402_653_184 : 134_217_728), 'RELEASE_SIZE_LIMIT');
  }
  exactTree(root, ['release.json', 'release.sig', ...names]);
  for (const entry of manifest.files) { const actual = hashFile(path.join(root, entry.path), 268_435_456, deadline); assert(actual.bytes === entry.bytes && actual.sha256 === entry.sha256, 'RELEASE_INTEGRITY_MISMATCH'); }
  let image = null;
  if (manifest.kind === 'AGENT') {
    assert(manifest.oci === null && names.has('payload/runtime-manifest.json'), 'RELEASE_MANIFEST_INVALID');
    const r: unknown = JSON.parse(boundedRead(path.join(root, 'payload/runtime-manifest.json')).toString());
    assert(record(r) && r.kind === 'lumina.alpha.runtime' && r.node === NODE_VERSION && r.version === VERSION && r.platform === manifest.platform.os && r.arch === 'x64' && r.protocol === 1 && r.storeEpoch === 1 && r.productionApproved === false && Array.isArray(r.files), 'RELEASE_RUNTIME_INVALID');
    assert(r.files.length + 1 === names.size && r.files.every(f => record(f) && typeof f.path === 'string' && names.has(`payload/${f.path}`) && manifest.files.some(v => v.path === `payload/${f.path}` && v.sha256 === f.sha256 && v.bytes === f.bytes)), 'RELEASE_RUNTIME_INVALID');
    assert(new Set(r.files.map(f => (f as { path: string }).path)).size === r.files.length && ['payload/lib/cli.mjs', 'payload/lib/worker.mjs', 'payload/lib/common.mjs', `payload/runtime/${manifest.platform.os === 'win32' ? 'node.exe' : 'node'}`].every(f => names.has(f)), 'RELEASE_RUNTIME_INVALID');
  } else {
    assert(record(manifest.oci), 'RELEASE_OCI_REQUIRED'); fields(manifest.oci, ['indexDigest', 'manifestDigest', 'maximumObjectBytes', 'maximumUnpackedBytes']);
    image = await verifyOci(path.join(root, 'payload/oci'), manifest.oci, deadline);
  }
  assert(performance.now() < deadline, 'VERIFY_DEADLINE');
  return { format: manifest.format, scope: 'NONPRODUCTION_ALPHA', kind: manifest.kind, artifactDigest: sha256(raw), signature: 'PASS', identityPolicy: 'PASS', integrity: 'PASS', signerClass: trust.keyUsage, sourceProof: 'PINNED_KEY_SIGNED_CLAIMS_ONLY', ciProvenance: 'NOT_RUN', productionApproved: false, payloadBytes: total, verificationMs: Math.ceil(performance.now() - started), image };
}
