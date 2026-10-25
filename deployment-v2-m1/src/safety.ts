import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

export class M1Error extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.code = code; }
}
export const sha256 = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
export const isRecord = (v: unknown): v is Record<string, unknown> => Boolean(v && typeof v === 'object' && !Array.isArray(v));
export function assert(value: unknown, code: string): asserts value { if (!value) throw new M1Error(code); }
export function keys(value: Record<string, unknown>, required: string[], optional: string[] = []) {
  assert(required.every(k => Object.hasOwn(value, k)) && Object.keys(value).every(k => [...required, ...optional].includes(k)), 'FIELDS_INVALID');
}
export function boundedRead(file: string, maximum = 65_536): Buffer {
  const metadata = fs.lstatSync(file);
  assert(metadata.isFile() && !metadata.isSymbolicLink(), 'INPUT_UNTRUSTED');
  const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  try {
    const stat = fs.fstatSync(fd);
    assert(stat.isFile() && stat.size <= maximum, 'INPUT_LIMIT');
    const bytes = Buffer.alloc(maximum + 1);
    let count = 0;
    while (count <= maximum) {
      const n = fs.readSync(fd, bytes, count, maximum + 1 - count, null);
      if (!n) break;
      count += n;
    }
    assert(count <= maximum, 'INPUT_LIMIT');
    return bytes.subarray(0, count);
  } finally { fs.closeSync(fd); }
}
export function exclusiveFile(file: string, bytes: string | Uint8Array) {
  const parentPath = path.dirname(path.resolve(file)), parentMeta = fs.lstatSync(parentPath);
  assert(parentMeta.isDirectory() && !parentMeta.isSymbolicLink() && fs.realpathSync(parentPath) === parentPath, 'OUTPUT_PARENT_UNTRUSTED');
  if (process.platform !== 'win32') assert((parentMeta.uid === process.getuid?.() || parentMeta.uid === 0) && (parentMeta.mode & 0o022) === 0, 'OUTPUT_PARENT_UNTRUSTED');
  const fd = fs.openSync(file, 'wx', 0o600);
  try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  if (process.platform !== 'win32') {
    const parent = fs.openSync(path.dirname(file), 'r');
    try { fs.fsyncSync(parent); } finally { fs.closeSync(parent); }
  }
}
export function trustedFile(file: string, uid: number | undefined = process.getuid?.()) {
  const s = fs.lstatSync(file);
  assert(s.isFile() && !s.isSymbolicLink() && s.nlink === 1 && fs.realpathSync(file) === path.resolve(file), 'FILE_UNTRUSTED');
  if (process.platform !== 'win32') assert(s.uid === uid && (s.mode & 0o077) === 0, 'FILE_UNTRUSTED');
  return s;
}
export type Marker = { kind: 'lumina.m1.fictional'; id: string; profile: 'LINUX_FLOCK' | 'WINDOWS_SQLITE_ONLY'; allowSystemd: boolean };
export function experimentPath(root: string) {
  const resolved = path.resolve(root);
  assert(path.dirname(resolved) === fs.realpathSync(os.tmpdir()) && /^lumina-m1-[0-9a-f-]{36}$/.test(path.basename(resolved)), 'EXPERIMENT_PATH_UNSAFE');
  return resolved;
}
export function experiment(root: string): Marker {
  root = experimentPath(root);
  const s = fs.lstatSync(root);
  assert(s.isDirectory() && !s.isSymbolicLink() && fs.realpathSync(root) === root, 'EXPERIMENT_UNTRUSTED');
  if (process.platform !== 'win32') assert(s.uid === process.getuid?.() && (s.mode & 0o077) === 0, 'EXPERIMENT_UNTRUSTED');
  trustedFile(path.join(root, 'experiment.json'));
  const marker: unknown = JSON.parse(boundedRead(path.join(root, 'experiment.json')).toString());
  assert(isRecord(marker), 'EXPERIMENT_UNTRUSTED');
  keys(marker, ['kind', 'id', 'profile', 'allowSystemd']);
  assert(marker.kind === 'lumina.m1.fictional' && /^[0-9a-f-]{36}$/.test(String(marker.id)) && typeof marker.allowSystemd === 'boolean', 'EXPERIMENT_UNTRUSTED');
  assert(marker.profile === (process.platform === 'linux' ? 'LINUX_FLOCK' : 'WINDOWS_SQLITE_ONLY'), 'EXPERIMENT_PROFILE');
  return marker as Marker;
}
export function createExperiment(root: string, allowSystemd = false) {
  root = experimentPath(root);
  assert(['win32', 'linux'].includes(process.platform), 'PLATFORM_UNSUPPORTED');
  assert(!allowSystemd || process.platform === 'linux' && process.getuid?.() !== 0, 'NONPRODUCTION_USER_REQUIRED');
  fs.mkdirSync(root, { mode: 0o700 }); // Deliberately non-recursive and exclusive; never adopts an existing directory.
  const marker: Marker = { kind: 'lumina.m1.fictional', id: randomUUID(), profile: process.platform === 'linux' ? 'LINUX_FLOCK' : 'WINDOWS_SQLITE_ONLY', allowSystemd };
  exclusiveFile(path.join(root, 'experiment.json'), JSON.stringify(marker));
  exclusiveFile(path.join(root, 'write.lock'), '');
  exclusiveFile(path.join(root, 'state.sqlite'), '');
  fs.mkdirSync(path.join(root, 'effects'), { mode: 0o700 });
  return marker;
}
export function safeError(error: unknown) {
  return error instanceof M1Error && /^[A-Z][A-Z0-9_]{2,70}$/.test(error.code) ? error.code : 'UNEXPECTED_FAILURE';
}
