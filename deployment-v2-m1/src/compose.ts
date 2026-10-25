import { isRecord, assert } from './safety.ts';

// Entirely fictional stdin model; never reads production Compose or .env files.
export const COMPOSE_MODEL = `name: lumina-m1-diagnostics
services:
  web:
    image: example.invalid/fictional-m1:fixture
    user: "10001:10001"
    init: true
    read_only: true
    cap_drop: [ALL]
    security_opt: ["no-new-privileges:true"]
    tmpfs: ["/tmp:rw,noexec,nosuid,nodev"]
    pids_limit: 256
    mem_limit: 512m
    cpus: 1
    networks: [backend]
    ports: ["127.0.0.1:3200:3200"]
networks:
  backend:
    internal: true
`;
export function memoryBytes(value: unknown): bigint | null {
  if (Number.isSafeInteger(value) && Number(value) >= 0) return BigInt(Number(value));
  if (typeof value !== 'string') return null;
  const match = /^(\d{1,12})([kmgt])?b?$/i.exec(value);
  return match ? BigInt(match[1]) * 1024n ** BigInt(match[2] ? 'kmgt'.indexOf(match[2].toLowerCase()) + 1 : 0) : null;
}
export const SECURITY_FIELDS = ['user', 'init', 'read_only', 'cap_drop', 'cap_add', 'privileged', 'security_opt', 'tmpfs', 'pids_limit', 'mem_limit', 'cpus', 'networks', 'ports', 'backend.internal'] as const;
export type SecurityField = typeof SECURITY_FIELDS[number];
export function securityMismatches(model: unknown): SecurityField[] {
  assert(isRecord(model) && isRecord(model.services) && isRecord(model.services.web) && isRecord(model.networks), 'COMPOSE_JSON_SHAPE_INVALID');
  const web = model.services.web, fields: SecurityField[] = [];
  const check = (field: SecurityField, matches: boolean) => { if (!matches) fields.push(field); };
  check('user', web.user === '10001:10001'); check('init', web.init === true); check('read_only', web.read_only === true);
  check('cap_drop', Array.isArray(web.cap_drop) && web.cap_drop.length === 1 && web.cap_drop[0] === 'ALL');
  check('cap_add', web.cap_add === undefined || Array.isArray(web.cap_add) && web.cap_add.length === 0);
  check('privileged', web.privileged === undefined || web.privileged === false);
  check('security_opt', Array.isArray(web.security_opt) && web.security_opt.length === 1 && web.security_opt[0] === 'no-new-privileges:true');
  const temp = Array.isArray(web.tmpfs) && web.tmpfs.length === 1 && typeof web.tmpfs[0] === 'string' ? web.tmpfs[0] : '';
  check('tmpfs', temp.split(':')[0] === '/tmp' && new Set(temp.slice(5).split(',')).size === 4 && ['rw', 'noexec', 'nosuid', 'nodev'].every(x => temp.slice(5).split(',').includes(x)));
  check('pids_limit', web.pids_limit === 256); check('mem_limit', memoryBytes(web.mem_limit) === 536_870_912n); check('cpus', web.cpus === 1 || web.cpus === '1' || web.cpus === '1.0');
  check('networks', isRecord(web.networks) && Object.keys(web.networks).join(',') === 'backend');
  check('backend.internal', isRecord(model.networks.backend) && model.networks.backend.internal === true);
  check('ports', Array.isArray(web.ports) && web.ports.length === 1 && isRecord(web.ports[0]) && web.ports[0].host_ip === '127.0.0.1' && String(web.ports[0].published) === '3200' && web.ports[0].target === 3200 && web.ports[0].protocol === 'tcp');
  return fields;
}
