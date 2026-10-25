import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { assert, exclusiveFile, hashFile } from '../src/common.ts';

// Development / CI only. No Docker operations are included in the Agent runtime.
const binary = process.env.M2_COMPOSE_BINARY, endpoint = process.env.M2_DOCKER_ENDPOINT;
assert(binary && endpoint && process.env.M2_NONPRODUCTION_DOCKER === 'ACK_NONPRODUCTION', 'NONPRODUCTION_DOCKER_REQUIRED');
assert(process.platform === 'win32' ? endpoint === 'npipe:////./pipe/dockerDesktopLinuxEngine' : process.platform === 'linux' && endpoint === 'unix:///var/run/docker.sock', 'LOCAL_TEST_ENDPOINT_REQUIRED');
const expected = process.platform === 'win32' ? '4c864dd7f879dd40366e087e68a8a02cbcf018be0128867b13369898e67e1532' : 'dba9d98e1ba5bfe11d88c99b9bd32fc4a0624a30fafe68eea34d61a3e42fd372';
assert(hashFile(binary).sha256 === expected, 'COMPOSE_BINARY_DIGEST_MISMATCH');
const tempParent = fs.realpathSync(os.tmpdir()), root = fs.mkdtempSync(path.join(tempParent, 'lumina-v2-m2-compose-'));
const token = randomUUID(), project = `lumina-v2-m2-${token}`, name = `${project}-probe`;
const env: NodeJS.ProcessEnv = { PATH: process.env.PATH, ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}), DOCKER_CONFIG: root, DOCKER_HOST: endpoint, COMPOSE_DISABLE_ENV_FILE: 'true', COMPOSE_ANSI: 'never', TMP: root, TEMP: root };
function run(file: string, args: string[], maximum = 15_000) {
  const r = spawnSync(file, args, { env, encoding: 'utf8', timeout: maximum, maxBuffer: 131_072, windowsHide: true });
  assert(!r.error && r.status === 0, 'COMPOSE_NATIVE_WORKLOAD_FAILED'); return r.stdout;
}
try {
  assert(run(binary, ['version', '--short']).trim() === '2.40.3', 'COMPOSE_VERSION_MISMATCH');
  const code = 'const fs=require("node:fs");fs.writeFileSync("/tmp/fictional-checkpoint","OK");let readOnly=false;try{fs.writeFileSync("/fictional-must-fail","x")}catch(e){readOnly=e.code==="EROFS"||e.code==="EACCES"}console.log(JSON.stringify({token:process.env.M2_PROBE_TOKEN,node:process.versions.node,sqlite:process.versions.sqlite,platform:process.platform,readOnly,memoryMax:fs.readFileSync("/sys/fs/cgroup/memory.max","utf8").trim(),pidsMax:fs.readFileSync("/sys/fs/cgroup/pids.max","utf8").trim()}))';
  const image = 'node:24.22.1-bookworm-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205';
  const model = `services:\n  probe:\n    image: ${image}\n    pull_policy: never\n    user: "10001:10001"\n    read_only: true\n    cap_drop: ["ALL"]\n    security_opt: ["no-new-privileges:true"]\n    network_mode: none\n    mem_limit: 128m\n    cpus: 0.5\n    pids_limit: 32\n    tmpfs: ["/tmp:rw,noexec,nosuid,nodev,size=16m"]\n    environment:\n      M2_PROBE_TOKEN: "${token}"\n    command: ${JSON.stringify(['node', '-e', code])}\n`;
  const config = path.join(root, 'compose.yml'); exclusiveFile(config, model);
  const raw = run(binary, ['--project-name', project, '--file', config, 'run', '--rm', '--no-deps', '-T', '--pull', 'never', '--name', name, 'probe']);
  const probe = JSON.parse(raw.trim());
  assert(probe.token === token && probe.node === '24.22.1' && probe.platform === 'linux' && probe.readOnly === true && probe.memoryMax === '134217728' && probe.pidsMax === '32', 'COMPOSE_PROBE_MISMATCH');
  console.log(JSON.stringify({ result: 'PASS', scope: 'NONPRODUCTION_DOCKER_NATIVE_WORKLOAD', compose: '2.40.3', node: probe.node, sqlite: probe.sqlite, linuxWorkload: true, readOnlyRoot: true, memoryLimitObservedBytes: 134_217_728, pidsLimitObserved: 32, rootlessCertification: 'NOT_RUN', dynamicLimitStress: 'NOT_RUN', systemdLifecycle: 'NOT_RUN', productionCompatibility: false }));
} finally {
  // Only a container with this invocation's unpredictable name AND project label can be removed.
  const docker = process.platform === 'win32' ? 'docker.exe' : '/usr/bin/docker';
  const inspection = spawnSync(docker, ['--host', endpoint, 'inspect', '--format', '{{index .Config.Labels "com.docker.compose.project"}}', name], { env, encoding: 'utf8', timeout: 2000, windowsHide: true });
  if (inspection.status === 0 && inspection.stdout.trim() === project) spawnSync(docker, ['--host', endpoint, 'rm', '--force', name], { env, stdio: 'ignore', timeout: 3000, windowsHide: true });
  assert(path.dirname(root) === tempParent && path.basename(root).startsWith('lumina-v2-m2-compose-') && fs.realpathSync(root) === root, 'CLEANUP_SCOPE_INVALID');
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 30 });
}
