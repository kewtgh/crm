import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { AgentError, assert, sitePolicy, trustedFile } from './common.ts';
import { STATES, type State } from './protocol.ts';

export type Snapshot = { siteRevision: number; ownerEpoch: number; epoch: 1; state: State | null; operationRevision: number | null; unresolved: number; grant: 'READY' | 'CONSUMED' | null; checkpoint: 'NOT_STARTED' | 'INTENT' | 'PROVEN' | 'UNKNOWN' | null; recoveryRequired: boolean; acceptedApplication: null };
export function readonlySnapshot(root: string): Snapshot {
  const policy = sitePolicy(root), file = path.join(root, 'state.sqlite');
  const s = trustedFile(file); assert(s.size >= 100 && s.size <= 8 * 1024 ** 2, 'STATE_SIZE_INVALID');
  // Even an active/non-hot journal is conservatively refused; never use immutable=1 or recover it.
  for (const suffix of ['-journal', '-wal', '-shm']) {
    try { fs.lstatSync(`${file}${suffix}`); throw new AgentError('STATE_RECOVERY_REQUIRED'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  const db = new DatabaseSync(file, { readOnly: true, timeout: 100, allowExtension: false });
  try {
    db.exec('PRAGMA query_only=ON; PRAGMA trusted_schema=OFF; PRAGMA temp_store=MEMORY; PRAGMA cache_size=-1024; BEGIN;');
    const tables = db.prepare("SELECT name,type FROM sqlite_schema WHERE name IN('store_meta','site','operations','grants','steps')").all();
    assert(tables.length === 5 && tables.every(t => t.type === 'table'), 'STATE_SCHEMA_UNSUPPORTED');
    const meta = db.prepare('SELECT epoch,scope,agent_digest FROM store_meta WHERE id=1').get();
    assert(meta?.epoch === 1 && meta.scope === 'NONPRODUCTION_ALPHA' && meta.agent_digest === policy.agentDigest, 'STATE_SCHEMA_UNSUPPORTED');
    const site = db.prepare('SELECT revision,owner_epoch,accepted_application FROM site WHERE id=1').get();
    assert(site && Number.isSafeInteger(site.revision) && Number(site.revision) >= 0 && site.owner_epoch === 1 && site.accepted_application === null, 'STATE_PROJECTION_INVALID');
    const op = db.prepare('SELECT id,state,revision FROM operations ORDER BY rowid DESC LIMIT 1').get();
    const unresolved = Number(db.prepare("SELECT count(*) AS n FROM operations WHERE state NOT IN ('COMPLETED','REJECTED')").get()?.n);
    assert(Number.isSafeInteger(unresolved) && unresolved >= 0 && unresolved <= 1, 'STATE_PROJECTION_INVALID');
    const grant = op ? db.prepare('SELECT status FROM grants WHERE operation_id=? ORDER BY rowid DESC LIMIT 1').get(op.id!)?.status : null;
    const checkpoint = op ? db.prepare('SELECT state FROM steps WHERE operation_id=?').get(op.id!)?.state : null;
    assert(!op || STATES.includes(op.state as State) && Number.isSafeInteger(op.revision), 'STATE_PROJECTION_INVALID');
    assert([null, 'READY', 'CONSUMED'].includes(grant as string | null) && [null, 'NOT_STARTED', 'INTENT', 'PROVEN', 'UNKNOWN'].includes(checkpoint as string | null), 'STATE_PROJECTION_INVALID');
    db.exec('COMMIT');
    return { siteRevision: Number(site.revision), ownerEpoch: 1, epoch: 1, state: op?.state as State ?? null, operationRevision: op ? Number(op.revision) : null, unresolved, grant: grant as Snapshot['grant'], checkpoint: checkpoint as Snapshot['checkpoint'], recoveryRequired: op?.state === 'RECOVERY_REQUIRED' || checkpoint === 'INTENT' || checkpoint === 'UNKNOWN', acceptedApplication: null };
  } finally { db.close(); }
}
export function observation(root: string) {
  try { return { status: 'PASS' as const, code: 'MATCH', snapshot: readonlySnapshot(root) }; }
  catch (error) {
    const e = error as NodeJS.ErrnoException & { errcode?: number };
    const code = error instanceof AgentError ? error.code : e.code === 'ENOENT' ? 'NOT_INSTALLED' : ['EACCES', 'EPERM'].includes(String(e.code)) ? 'METADATA_PERMISSION_DENIED' : e.errcode === 5 || e.errcode === 6 ? 'SQLITE_BUSY' : e.errcode === 11 || e.errcode === 26 ? 'STATE_CORRUPT' : 'STATE_READ_FAILED';
    const status = code === 'NOT_INSTALLED' ? 'NOT_RUN' as const : ['STATE_RECOVERY_REQUIRED', 'SQLITE_BUSY', 'METADATA_PERMISSION_DENIED', 'STATE_READ_FAILED'].includes(code) ? 'UNKNOWN' as const : 'FAIL' as const;
    return { status, code, snapshot: null };
  }
}
