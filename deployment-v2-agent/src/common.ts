import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const VERSION = '0.2.0-alpha.1', NODE_VERSION = '24.22.1', SCOPE = 'NONPRODUCTION_ALPHA';
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export class AgentError extends Error { readonly code: string; constructor(code: string) { super(code); this.code = code; } }
export function assert(value: unknown, code: string): asserts value { if (!value) throw new AgentError(code); }
export const record = (v: unknown): v is Record<string, unknown> => Boolean(v && typeof v === 'object' && !Array.isArray(v));
export function fields(v: Record<string, unknown>, names: string[]) { assert(names.length === Object.keys(v).length && names.every(k => Object.hasOwn(v, k)), 'FIELDS_INVALID'); }
export const sha256 = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
export function safeError(error: unknown) { return error instanceof AgentError ? error.code : ['EACCES', 'EPERM'].includes(String((error as NodeJS.ErrnoException)?.code)) ? 'METADATA_PERMISSION_DENIED' : 'UNEXPECTED_FAILURE'; }
export function trustedFile(file: string, privateMode = true) {
  const s = fs.lstatSync(file);
  assert(s.isFile() && !s.isSymbolicLink() && s.nlink === 1 && fs.realpathSync(file) === path.resolve(file), 'FILE_UNTRUSTED');
  if (process.platform !== 'win32') assert((s.uid === process.getuid?.() || !privateMode && s.uid === 0) && (s.mode & (privateMode ? 0o077 : 0o022)) === 0, 'FILE_UNTRUSTED');
  return s;
}
export function boundedRead(file: string, maximum = 65_536) {
  const s = fs.lstatSync(file); assert(s.isFile() && !s.isSymbolicLink() && s.size <= maximum, 'INPUT_LIMIT');
  const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  try {
    assert(fs.fstatSync(fd).isFile(), 'INPUT_UNTRUSTED');
    const b = Buffer.alloc(maximum + 1); let count = 0;
    while (count <= maximum) { const n = fs.readSync(fd, b, count, maximum + 1 - count, null); if (!n) break; count += n; }
    assert(count <= maximum, 'INPUT_LIMIT'); return b.subarray(0, count);
  } finally { fs.closeSync(fd); }
}
export function hashFile(file: string, maximum = 268_435_456, deadline = Infinity) {
  trustedFile(file, false); const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  try {
    const size = fs.fstatSync(fd).size; assert(size <= maximum, 'INPUT_LIMIT');
    const hash = createHash('sha256'), b = Buffer.alloc(65_536); let bytes = 0;
    for (;;) { assert(performance.now() < deadline, 'VERIFY_DEADLINE'); const n = fs.readSync(fd, b, 0, b.length, null); if (!n) break; bytes += n; assert(bytes <= maximum, 'INPUT_LIMIT'); hash.update(b.subarray(0, n)); }
    assert(bytes === size, 'INPUT_CHANGED'); return { sha256: hash.digest('hex'), bytes };
  } finally { fs.closeSync(fd); }
}
export function exclusiveFile(file: string, bytes: Uint8Array | string, mode = 0o600) {
  const parent = path.dirname(path.resolve(file)), s = fs.lstatSync(parent);
  assert(s.isDirectory() && !s.isSymbolicLink() && fs.realpathSync(parent) === parent, 'OUTPUT_PARENT_UNTRUSTED');
  if (process.platform !== 'win32') assert((s.uid === process.getuid?.() || s.uid === 0) && (s.mode & 0o022) === 0, 'OUTPUT_PARENT_UNTRUSTED');
  const fd = fs.openSync(file, 'wx', mode);
  try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  if (process.platform !== 'win32') { const directory = fs.openSync(parent, 'r'); try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); } }
}
export function alphaPath(input: string) { const root = path.resolve(input); assert(path.basename(root).startsWith('lumina-v2-alpha-') && UUID.test(path.basename(root).slice(16)), 'ALPHA_SCOPE_REQUIRED'); return root; }
export type SitePolicy = { kind: 'lumina.alpha.site'; scope: typeof SCOPE; siteId: string; uid: number | null; agentDigest: string; profile: 'LINUX_FLOCK' | 'WINDOWS_SQLITE_ONLY'; allowSystemd: boolean };
export function sitePolicy(input: string): SitePolicy {
  const root = alphaPath(input), s = fs.lstatSync(root);
  assert(s.isDirectory() && !s.isSymbolicLink() && fs.realpathSync(root) === root, 'SITE_UNTRUSTED');
  if (process.platform !== 'win32') assert(s.uid === process.getuid?.() && (s.mode & 0o077) === 0, 'SITE_IDENTITY_MISMATCH');
  trustedFile(path.join(root, 'site.json')); const p: unknown = JSON.parse(boundedRead(path.join(root, 'site.json')).toString());
  assert(record(p), 'SITE_UNTRUSTED'); fields(p, ['kind', 'scope', 'siteId', 'uid', 'agentDigest', 'profile', 'allowSystemd']);
  assert(p.kind === 'lumina.alpha.site' && p.scope === SCOPE && UUID.test(String(p.siteId)) && /^[a-f0-9]{64}$/.test(String(p.agentDigest)) && typeof p.allowSystemd === 'boolean', 'SITE_UNTRUSTED');
  assert(p.uid === (process.getuid?.() ?? null) && p.profile === (process.platform === 'linux' ? 'LINUX_FLOCK' : 'WINDOWS_SQLITE_ONLY'), 'SITE_IDENTITY_MISMATCH');
  return p as SitePolicy;
}
export function createSite(input: string, agentDigest: string, allowSystemd = false) {
  assert(['win32', 'linux'].includes(process.platform), 'PLATFORM_UNSUPPORTED');
  const root = alphaPath(input), parent = path.dirname(root), s = fs.lstatSync(parent);
  assert(fs.realpathSync(parent) === parent && s.isDirectory(), 'OUTPUT_PARENT_UNTRUSTED');
  if (process.platform !== 'win32') assert(parent === fs.realpathSync(os.tmpdir()) || s.uid === process.getuid?.() && (s.mode & 0o077) === 0, 'OUTPUT_PARENT_UNTRUSTED');
  assert(!allowSystemd || process.platform === 'linux' && process.getuid?.() !== 0, 'ISOLATED_USER_MANAGER_REQUIRED');
  fs.mkdirSync(root, { mode: 0o700 });
  const p: SitePolicy = { kind: 'lumina.alpha.site', scope: SCOPE, siteId: randomUUID(), uid: process.getuid?.() ?? null, agentDigest, profile: process.platform === 'linux' ? 'LINUX_FLOCK' : 'WINDOWS_SQLITE_ONLY', allowSystemd };
  exclusiveFile(path.join(root, 'site.json'), JSON.stringify(p)); exclusiveFile(path.join(root, 'write.lock'), ''); exclusiveFile(path.join(root, 'state.sqlite'), '');
  fs.mkdirSync(path.join(root, 'receipts'), { mode: 0o700 }); return p;
}
export function runtimeIdentity() {
  assert(['win32', 'linux'].includes(process.platform), 'PLATFORM_UNSUPPORTED');
  assert(process.versions.node === NODE_VERSION, 'RUNTIME_VERSION_MISMATCH');
  const root = path.resolve(fileURLToPath(new URL('../', import.meta.url))), file = path.join(root, 'runtime-manifest.json');
  const raw = boundedRead(file), m: unknown = JSON.parse(raw.toString());
  assert(record(m) && m.kind === 'lumina.alpha.runtime' && m.version === VERSION && m.node === NODE_VERSION && m.platform === process.platform && m.arch === process.arch && m.protocol === 1 && m.storeEpoch === 1 && Array.isArray(m.files) && m.files.length <= 32, 'RUNTIME_MANIFEST_INVALID');
  assert(fs.realpathSync(process.execPath) === path.join(root, 'runtime', process.platform === 'win32' ? 'node.exe' : 'node'), 'PRIVATE_RUNTIME_REQUIRED');
  const seen = new Set<string>();
  for (const entry of m.files) {
    assert(record(entry) && typeof entry.path === 'string' && /^(?:lib\/[a-z-]+\.mjs|runtime\/node(?:\.exe)?)$/.test(entry.path) && !seen.has(entry.path), 'RUNTIME_MANIFEST_INVALID');
    seen.add(entry.path); const digest = hashFile(path.join(root, entry.path)); assert(digest.sha256 === entry.sha256 && digest.bytes === entry.bytes, 'RUNTIME_INTEGRITY_MISMATCH');
  }
  assert(seen.has('lib/cli.mjs') && seen.has('lib/worker.mjs') && seen.has('lib/common.mjs') && seen.has(`runtime/${process.platform === 'win32' ? 'node.exe' : 'node'}`), 'RUNTIME_MANIFEST_INVALID');
  return { root, digest: sha256(raw) };
}
