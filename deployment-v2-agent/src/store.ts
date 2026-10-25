import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { assert, fields, record, sha256, sitePolicy, trustedFile, UUID } from './common.ts';
import { assertWriterLock, executionActive, type ExecutionIdentity } from './platform.ts';
import { planDigest, validateRequest, type Plan, type Request, type State } from './protocol.ts';

export type Operation = { id: string; request_key: string; request_hash: string; plan_json: string; plan_digest: string; agent_digest: string; state: State; revision: number; step_id: string; execution_json: string | null };
export type Grant = { id: string; operation_id: string; action: 'EXECUTE' | 'RECONCILE'; expected_revision: number; plan_digest: string; agent_digest: string; status: 'READY' | 'CONSUMED' };
function writable(root: string, digest: string) {
  assertWriterLock(root); assert(sitePolicy(root).agentDigest === digest, 'AGENT_BINDING_MISMATCH');
  const file = path.join(root, 'state.sqlite'), s = trustedFile(file);
  assert(s.size <= 8 * 1024 ** 2 - 131_072, 'STATE_CAPACITY_EXCEEDED');
  const db = new DatabaseSync(file, { timeout: 1500, allowExtension: false });
  db.exec('PRAGMA journal_mode=DELETE; PRAGMA synchronous=EXTRA; PRAGMA foreign_keys=ON; PRAGMA trusted_schema=OFF; PRAGMA temp_store=MEMORY;'); return db;
}
function transaction<T>(db: DatabaseSync, fn: () => T): T { db.exec('BEGIN IMMEDIATE'); try { const result = fn(); db.exec('COMMIT'); return result; } catch (error) { db.exec('ROLLBACK'); throw error; } }
function verify(db: DatabaseSync, root: string, agentDigest: string) { const m = db.prepare('SELECT epoch,scope,agent_digest FROM store_meta WHERE id=1').get(); assert(m?.epoch === 1 && m.scope === 'NONPRODUCTION_ALPHA' && m.agent_digest === agentDigest && sitePolicy(root).agentDigest === agentDigest, 'STATE_SCHEMA_OR_AGENT_MISMATCH'); }
function getOperation(db: DatabaseSync, id: string) { return db.prepare('SELECT * FROM operations WHERE id=?').get(id) as Operation | undefined; }
function event(db: DatabaseSync, op: Operation, code: string, evidence: string | null = null) { db.prepare('INSERT INTO events(operation_id,revision,code,evidence_digest) VALUES(?,?,?,?)').run(op.id, op.revision, code, evidence); }
function advance(db: DatabaseSync, op: Operation, state: State, code: string, evidence: string | null = null) {
  const next = { ...op, state, revision: op.revision + 1 };
  const r = db.prepare('UPDATE operations SET state=?,revision=? WHERE id=? AND revision=?').run(state, next.revision, op.id, op.revision);
  assert(r.changes === 1, 'REVISION_CONFLICT'); db.exec('UPDATE site SET revision=revision+1 WHERE id=1'); event(db, next, code, evidence); return next;
}
function addGrant(db: DatabaseSync, op: Operation, action: Grant['action']) {
  const g: Grant = { id: randomUUID(), operation_id: op.id, action, expected_revision: op.revision, plan_digest: op.plan_digest, agent_digest: op.agent_digest, status: 'READY' };
  db.prepare('INSERT INTO grants VALUES(?,?,?,?,?,?,?)').run(g.id, g.operation_id, g.action, g.expected_revision, g.plan_digest, g.agent_digest, g.status); return g;
}
export function initializeStore(root: string, digest: string) {
  assert(trustedFile(path.join(root, 'state.sqlite')).size === 0, 'STORE_ALREADY_INITIALIZED');
  const db = writable(root, digest);
  try {
    transaction(db, () => { db.exec(`
      CREATE TABLE store_meta(id INTEGER PRIMARY KEY CHECK(id=1),epoch INTEGER NOT NULL CHECK(epoch=1),scope TEXT NOT NULL CHECK(scope='NONPRODUCTION_ALPHA'),agent_digest TEXT NOT NULL);
      CREATE TABLE site(id INTEGER PRIMARY KEY CHECK(id=1),revision INTEGER NOT NULL,owner_epoch INTEGER NOT NULL CHECK(owner_epoch=1),accepted_application TEXT CHECK(accepted_application IS NULL));
      CREATE TABLE operations(id TEXT PRIMARY KEY,request_key TEXT UNIQUE NOT NULL,request_hash TEXT NOT NULL,plan_json TEXT NOT NULL,plan_digest TEXT NOT NULL,agent_digest TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN('QUEUED','PREPARING','RECOVERY_REQUIRED','COMPLETED','REJECTED')),revision INTEGER NOT NULL,step_id TEXT UNIQUE NOT NULL,execution_json TEXT);
      CREATE UNIQUE INDEX one_unresolved ON operations((1)) WHERE state NOT IN('COMPLETED','REJECTED');
      CREATE TRIGGER operation_request_immutable BEFORE UPDATE OF request_key,request_hash,plan_json,plan_digest,agent_digest,step_id ON operations BEGIN SELECT RAISE(ABORT,'REQUEST_IMMUTABLE'); END;
      CREATE TABLE grants(id TEXT PRIMARY KEY,operation_id TEXT NOT NULL REFERENCES operations(id),action TEXT NOT NULL CHECK(action IN('EXECUTE','RECONCILE')),expected_revision INTEGER NOT NULL,plan_digest TEXT NOT NULL,agent_digest TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN('READY','CONSUMED')));
      CREATE UNIQUE INDEX one_ready_grant ON grants((1)) WHERE status='READY';
      CREATE TRIGGER consumed_grant_immutable BEFORE UPDATE ON grants WHEN OLD.status='CONSUMED' BEGIN SELECT RAISE(ABORT,'CONSUMED_GRANT_IMMUTABLE'); END;
      CREATE TRIGGER grant_binding_immutable BEFORE UPDATE OF operation_id,action,expected_revision,plan_digest,agent_digest ON grants BEGIN SELECT RAISE(ABORT,'GRANT_BINDING_IMMUTABLE'); END;
      CREATE TABLE steps(id TEXT PRIMARY KEY,operation_id TEXT UNIQUE NOT NULL REFERENCES operations(id),state TEXT NOT NULL CHECK(state IN('NOT_STARTED','INTENT','PROVEN','UNKNOWN')),intent_digest TEXT,receipt_digest TEXT);
      CREATE TRIGGER proven_step_immutable BEFORE UPDATE ON steps WHEN OLD.state='PROVEN' BEGIN SELECT RAISE(ABORT,'PROVEN_STEP_IMMUTABLE'); END;
      CREATE TABLE evidence(digest TEXT PRIMARY KEY,kind TEXT NOT NULL,body TEXT NOT NULL);
      CREATE TRIGGER evidence_immutable BEFORE UPDATE ON evidence BEGIN SELECT RAISE(ABORT,'EVIDENCE_IMMUTABLE'); END;
      CREATE TABLE events(sequence INTEGER PRIMARY KEY AUTOINCREMENT,operation_id TEXT NOT NULL REFERENCES operations(id),revision INTEGER NOT NULL,code TEXT NOT NULL,evidence_digest TEXT REFERENCES evidence(digest));
    `); db.prepare("INSERT INTO store_meta VALUES(1,1,'NONPRODUCTION_ALPHA',?)").run(digest); db.exec('INSERT INTO site VALUES(1,0,1,NULL)'); });
  } finally { db.close(); }
}
export function admit(root: string, input: unknown, digest: string): Operation {
  validateRequest(input); const request: Request = input, db = writable(root, digest);
  try { verify(db, root, digest); return transaction(db, () => {
    const hash = sha256(JSON.stringify([request.protocolVersion, request.idempotencyKey, request.planDigest]));
    const prior = db.prepare('SELECT * FROM operations WHERE request_key=?').get(request.idempotencyKey) as Operation | undefined;
    if (prior) { assert(prior.request_hash === hash, 'IDEMPOTENCY_CONFLICT'); return { ...prior }; }
    const p = request.plan, policy = sitePolicy(root), site = db.prepare('SELECT revision,owner_epoch FROM site WHERE id=1').get();
    assert(p.siteId === policy.siteId && p.agentDigest === digest && p.ownerEpoch === site?.owner_epoch, 'PLAN_BINDING_MISMATCH');
    assert(p.expectedSiteRevision === site?.revision, 'SITE_REVISION_CONFLICT');
    assert(p.expiresAt > Date.now() && p.expiresAt <= Date.now() + 300_000, 'PLAN_EXPIRED_OR_INVALID');
    assert(!db.prepare("SELECT 1 FROM operations WHERE state NOT IN('COMPLETED','REJECTED')").get(), 'OPERATION_UNRESOLVED');
    assert(Number(db.prepare('SELECT count(*) AS n FROM operations').get()?.n) < 128, 'ALPHA_HISTORY_LIMIT');
    const op: Operation = { id: randomUUID(), request_key: request.idempotencyKey, request_hash: hash, plan_json: JSON.stringify(p), plan_digest: planDigest(p), agent_digest: digest, state: 'QUEUED', revision: 1, step_id: randomUUID(), execution_json: null };
    db.prepare('INSERT INTO operations VALUES(?,?,?,?,?,?,?,?,?,?)').run(op.id, op.request_key, hash, op.plan_json, op.plan_digest, digest, op.state, 1, op.step_id, null);
    db.prepare("INSERT INTO steps VALUES(?,?,'NOT_STARTED',NULL,NULL)").run(op.step_id, op.id);
    addGrant(db, op, 'EXECUTE'); db.exec('UPDATE site SET revision=revision+1 WHERE id=1'); event(db, op, 'ADMITTED'); return op;
  }); } finally { db.close(); }
}
export function authorizeReconcile(root: string, id: string, revision: number, digest: string) {
  assert(UUID.test(id) && Number.isSafeInteger(revision) && revision > 0, 'ARGUMENT_INVALID'); const db = writable(root, digest);
  try { verify(db, root, digest); return transaction(db, () => {
    const op = getOperation(db, id); assert(op && op.revision === revision, 'REVISION_CONFLICT');
    assert(['PREPARING', 'RECOVERY_REQUIRED'].includes(op.state) && op.execution_json, 'RECOVERY_NOT_REQUIRED');
    assert(!executionActive(JSON.parse(op.execution_json) as ExecutionIdentity), 'PRIOR_EXECUTION_STILL_ACTIVE');
    assert(!db.prepare("SELECT 1 FROM grants WHERE status='READY'").get(), 'GRANT_ALREADY_READY');
    assert(Number(db.prepare('SELECT count(*) AS n FROM grants WHERE operation_id=?').get(id)?.n) < 16, 'ALPHA_RECOVERY_LIMIT');
    const next = advance(db, op, 'RECOVERY_REQUIRED', 'RECONCILE_AUTHORIZED'); addGrant(db, next, 'RECONCILE'); return next;
  }); } finally { db.close(); }
}
export function claim(root: string, digest: string, identity: ExecutionIdentity) {
  const db = writable(root, digest);
  try { verify(db, root, digest); return transaction(db, () => {
    const g = db.prepare("SELECT * FROM grants WHERE status='READY'").get() as Grant | undefined;
    if (!g) return null;
    const op = getOperation(db, g.operation_id); assert(op && op.revision === g.expected_revision && op.plan_digest === g.plan_digest && digest === g.agent_digest && digest === op.agent_digest, 'GRANT_BINDING_MISMATCH');
    assert(db.prepare("UPDATE grants SET status='CONSUMED' WHERE id=? AND status='READY'").run(g.id).changes === 1, 'GRANT_ALREADY_CONSUMED');
    if (g.action === 'RECONCILE') { assert(op.state === 'RECOVERY_REQUIRED' && op.execution_json && !executionActive(JSON.parse(op.execution_json) as ExecutionIdentity), 'PRIOR_EXECUTION_STILL_ACTIVE'); return { op: advance(db, op, op.state, 'RECONCILE_CLAIMED'), action: g.action }; }
    assert(op.state === 'QUEUED', 'STATE_TRANSITION_UNSAFE');
    if ((JSON.parse(op.plan_json) as Plan).expiresAt <= Date.now()) return { op: advance(db, op, 'REJECTED', 'UNCLAIMED_PLAN_EXPIRED'), action: 'EXPIRED' as const };
    const execution = JSON.stringify(identity);
    db.prepare('UPDATE operations SET execution_json=? WHERE id=?').run(execution, op.id);
    assert(db.prepare("UPDATE steps SET state='INTENT',intent_digest=? WHERE id=? AND state='NOT_STARTED'").run(sha256(JSON.stringify([op.plan_digest, op.step_id, identity.invocation])), op.step_id).changes === 1, 'STATE_TRANSITION_UNSAFE');
    return { op: { ...advance(db, op, 'PREPARING', 'INTENT_DURABLE'), execution_json: execution }, action: g.action };
  }); } finally { db.close(); }
}
export type Receipt = { kind: 'lumina.alpha.receipt'; scope: 'FICTIONAL_ONLY'; operationId: string; stepId: string; invocation: string; planDigest: string; agentDigest: string };
export function validateReceipt(value: unknown, op: Operation): asserts value is Receipt {
  assert(record(value), 'RECEIPT_INVALID'); fields(value, ['kind', 'scope', 'operationId', 'stepId', 'invocation', 'planDigest', 'agentDigest']);
  assert(value.kind === 'lumina.alpha.receipt' && value.scope === 'FICTIONAL_ONLY' && value.operationId === op.id && value.stepId === op.step_id && value.planDigest === op.plan_digest && value.agentDigest === op.agent_digest && value.invocation === (JSON.parse(op.execution_json!) as ExecutionIdentity).invocation, 'RECEIPT_BINDING_MISMATCH');
}
export function recordObservation(root: string, op: Operation, receipt: Receipt | null, digest: string) {
  if (receipt) validateReceipt(receipt, op); const db = writable(root, digest);
  try { verify(db, root, digest); return transaction(db, () => {
    const current = getOperation(db, op.id); assert(current && current.revision === op.revision && ['PREPARING', 'RECOVERY_REQUIRED'].includes(current.state), 'REVISION_CONFLICT');
    const raw = JSON.stringify(receipt ?? { kind: 'OUTCOME_UNKNOWN', stepId: op.step_id }), evidence = sha256(raw);
    db.prepare('INSERT OR IGNORE INTO evidence VALUES(?,?,?)').run(evidence, receipt ? 'FICTIONAL_RECEIPT' : 'OUTCOME_UNKNOWN', raw);
    assert(db.prepare("UPDATE steps SET state=?,receipt_digest=? WHERE id=? AND state IN('INTENT','UNKNOWN')").run(receipt ? 'PROVEN' : 'UNKNOWN', receipt ? evidence : null, op.step_id).changes === 1, 'STATE_TRANSITION_UNSAFE');
    return advance(db, current, receipt ? 'COMPLETED' : 'RECOVERY_REQUIRED', receipt ? 'RECEIPT_PROVEN' : 'OUTCOME_UNKNOWN', evidence);
  }); } finally { db.close(); }
}
