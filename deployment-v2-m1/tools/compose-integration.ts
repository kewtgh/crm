import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { assert, sha256 } from '../src/safety.ts';
import { COMPOSE_MODEL, securityMismatches } from '../src/compose.ts';

// Test tooling only; no downloader, installation, Docker daemon access, or V1 imports.
const binary = process.env.M1_COMPOSE_BINARY;
assert(binary, 'COMPOSE_RUNTIME_NOT_PROVIDED');
const digest = sha256(fs.readFileSync(binary));
const expected = process.platform === 'win32' ? '4c864dd7f879dd40366e087e68a8a02cbcf018be0128867b13369898e67e1532' : 'dba9d98e1ba5bfe11d88c99b9bd32fc4a0624a30fafe68eea34d61a3e42fd372';
assert(digest === expected, 'COMPOSE_RUNTIME_DIGEST_MISMATCH');
const env: Record<string, string> = { PATH: process.env.PATH ?? '', COMPOSE_DISABLE_ENV_FILE: 'true', DOCKER_HOST: process.platform === 'win32' ? 'npipe:////./pipe/lumina-m1-no-daemon' : 'unix:///nonexistent-lumina-m1/docker.sock' };
if (process.env.SystemRoot) env.SystemRoot = process.env.SystemRoot;
const run = (input: string) => spawnSync(binary, ['--project-name', 'lumina-m1-parser', '--file', '-', 'config', '--format', 'json', '--no-interpolate'], { input, encoding: 'utf8', env, timeout: 5000, maxBuffer: 262_144, windowsHide: true });
const version = spawnSync(binary, ['version', '--short'], { env, encoding: 'utf8', timeout: 5000, windowsHide: true });
assert(version.status === 0 && version.stdout.trim().replace(/^v/, '') === '2.40.3', 'COMPOSE_VERSION_MISMATCH');
const good = run(COMPOSE_MODEL); assert(good.status === 0, 'COMPOSE_REAL_PARSE_FAILED'); assert(securityMismatches(JSON.parse(good.stdout)).length === 0, 'COMPOSE_REAL_SECURITY_MISMATCH');
const bad = run(COMPOSE_MODEL.replace('["/tmp:rw,noexec,nosuid,nodev"]', '[/tmp:rw,noexec,nosuid,nodev]'));
assert(bad.status === 0 && securityMismatches(JSON.parse(bad.stdout)).includes('tmpfs'), 'COMPOSE_REAL_REGRESSION_NOT_REPRODUCED');
console.log(JSON.stringify({ kind: 'lumina.m1.compose-integration', result: 'PASS', platform: process.platform, version: '2.40.3', binaryDigest: digest, positiveModel: 'PASS', realTmpfsRegression: 'PASS', daemonAccess: false, rootlessCompatibility: 'NOT_RUN' }));
