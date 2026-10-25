import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { assert, experiment, isRecord, keys, sha256, trustedFile } from './safety.ts';

export type Task = { delayMs: number; mode: 'NORMAL' | 'CRASH_BEFORE_EFFECT' | 'CRASH_AFTER_EFFECT' };
export type Operation = { id: string; request_key: string; digest: string; task: string; state: 'QUEUED' | 'RUNNING' | 'RECOVERY_REQUIRED' | 'COMPLETED'; grant: 'READY' | 'CLAIMED' | 'DONE'; revision: number; receipt: string | null; worker_pid: number | null };
export function validateTask(task: unknown): asserts task is Task {
  assert(isRecord(task), 'TASK_INVALID'); keys(task, ['delayMs', 'mode']);
  assert(Number.isSafeInteger(task.delayMs) && Number(task.delayMs) >= 0 && Number(task.delayMs) <= 5000 && ['NORMAL', 'CRASH_BEFORE_EFFECT', 'CRASH_AFTER_EFFECT'].includes(String(task.mode)), 'TASK_INVALID');
}
export function openStore(root: string, readOnly = false) {
  experiment(root); trustedFile(path.join(root, 'state.sqlite'));
  const db = new DatabaseSync(path.join(root, 'state.sqlite'), { readOnly, timeout: 1500, allowExtension: false });
  if (!readOnly) db.exec('PRAGMA journal_mode=DELETE; PRAGMA synchronous=EXTRA; PRAGMA foreign_keys=ON;');
  return db;
}
export function initializeStore(root: string) {
  const db = openStore(root);
  try {
    db.exec(`BEGIN IMMEDIATE;
      CREATE TABLE meta(kind TEXT NOT NULL CHECK(kind='lumina.m1.fictional'), epoch INTEGER NOT NULL CHECK(epoch=1));
      INSERT INTO meta VALUES('lumina.m1.fictional',1);
      CREATE TABLE operations(id TEXT PRIMARY KEY, request_key TEXT NOT NULL UNIQUE, digest TEXT NOT NULL, task TEXT NOT NULL,
        state TEXT NOT NULL CHECK(state IN ('QUEUED','RUNNING','RECOVERY_REQUIRED','COMPLETED')),
        grant TEXT NOT NULL CHECK(grant IN ('READY','CLAIMED','DONE')), revision INTEGER NOT NULL, receipt TEXT, worker_pid INTEGER);
      CREATE UNIQUE INDEX one_unresolved ON operations((1)) WHERE state<>'COMPLETED';
      CREATE TABLE events(sequence INTEGER PRIMARY KEY AUTOINCREMENT, operation_id TEXT NOT NULL REFERENCES operations(id), code TEXT NOT NULL, revision INTEGER NOT NULL);
      COMMIT;`);
  } finally { db.close(); }
}
function transaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try { const result = fn(); db.exec('COMMIT'); return result; }
  catch (error) { db.exec('ROLLBACK'); throw error; }
}
function verifyStore(db: DatabaseSync) {
  const meta = db.prepare('SELECT kind,epoch FROM meta').get();
  assert(meta?.kind === 'lumina.m1.fictional' && meta.epoch === 1, 'STORE_FORMAT_UNSUPPORTED');
}
function event(db: DatabaseSync, op: Operation, code: string) {
  db.prepare('INSERT INTO events(operation_id,code,revision) VALUES(?,?,?)').run(op.id, code, op.revision);
}
export function lookup(root: string, key?: string) {
  const db = openStore(root, true);
  try {
    verifyStore(db);
    const row = db.prepare(key !== undefined ? 'SELECT * FROM operations WHERE request_key=?' : 'SELECT * FROM operations ORDER BY rowid DESC LIMIT 1').get(...(key !== undefined ? [key] : [])) as Operation | undefined;
    return row ? { ...row } : undefined;
  } finally { db.close(); }
}
export function submit(root: string, key: string, task: Task): Operation {
  assert(/^[A-Za-z0-9_-]{8,80}$/.test(key), 'REQUEST_KEY_INVALID'); validateTask(task);
  const body = JSON.stringify({ delayMs: task.delayMs, mode: task.mode }), digest = sha256(body);
  const db = openStore(root);
  try {
    verifyStore(db);
    return transaction(db, () => {
      const prior = db.prepare('SELECT * FROM operations WHERE request_key=?').get(key) as Operation | undefined;
      if (prior) { assert(prior.digest === digest, 'IDEMPOTENCY_CONFLICT'); return { ...prior }; }
      assert(!db.prepare("SELECT 1 FROM operations WHERE state<>'COMPLETED'").get(), 'OPERATION_UNRESOLVED');
      const op: Operation = { id: randomUUID(), request_key: key, digest, task: body, state: 'QUEUED', grant: 'READY', revision: 1, receipt: null, worker_pid: null };
      db.prepare('INSERT INTO operations VALUES(?,?,?,?,?,?,?,?,?)').run(op.id, key, digest, body, op.state, op.grant, op.revision, null, null);
      event(db, op, 'ADMITTED'); return op;
    });
  } finally { db.close(); }
}
export function claim(root: string): Operation | undefined {
  const db = openStore(root);
  try {
    verifyStore(db);
    return transaction(db, () => {
      const op = db.prepare("SELECT * FROM operations WHERE state='QUEUED' AND grant='READY'").get() as Operation | undefined;
      if (!op) return undefined;
      const result = db.prepare("UPDATE operations SET state='RUNNING',grant='CLAIMED',revision=revision+1,worker_pid=? WHERE id=? AND revision=? AND grant='READY'").run(process.pid, op.id, op.revision);
      assert(result.changes === 1, 'REVISION_CONFLICT');
      const next: Operation = { ...op, state: 'RUNNING', grant: 'CLAIMED', revision: op.revision + 1, worker_pid: process.pid };
      event(db, next, 'INTENT_DURABLE'); return next;
    });
  } finally { db.close(); }
}
export function observeResult(root: string, id: string, revision: number, receipt: string | null) {
  const db = openStore(root);
  try {
    verifyStore(db);
    return transaction(db, () => {
      const op = db.prepare('SELECT * FROM operations WHERE id=?').get(id) as Operation | undefined;
      assert(op && op.revision === revision, 'REVISION_CONFLICT');
      if (op.state === 'COMPLETED') { assert(op.receipt === receipt, 'RECEIPT_CONFLICT'); return op; }
      assert(['RUNNING', 'RECOVERY_REQUIRED'].includes(op.state) && op.grant === 'CLAIMED', 'STATE_TRANSITION_UNSAFE');
      const next: Operation = { ...op, revision: revision + 1, state: receipt ? 'COMPLETED' : 'RECOVERY_REQUIRED', grant: receipt ? 'DONE' : 'CLAIMED', receipt };
      const r = db.prepare('UPDATE operations SET state=?,grant=?,revision=?,receipt=? WHERE id=? AND revision=?').run(next.state, next.grant, next.revision, receipt, id, revision);
      assert(r.changes === 1, 'REVISION_CONFLICT'); event(db, next, receipt ? 'RECEIPT_OBSERVED' : 'OUTCOME_UNKNOWN'); return next;
    });
  } finally { db.close(); }
}
