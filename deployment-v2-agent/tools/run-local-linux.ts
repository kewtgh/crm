import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { assert } from '../src/common.ts';

// A test entrypoint for the existing Windows development Docker Desktop, never a host provisioner.
assert(process.platform === 'win32', 'WINDOWS_DOCKER_DESKTOP_TEST_ENTRY_ONLY');
const args = process.argv.slice(2); assert(args.length === 2 && args[0] === '--suite' && ['m1', 'm2', 'measure'].includes(args[1]), 'ARGUMENT_INVALID');
const suite = args[1], parent = path.resolve('work/deployment-v2-m2'); fs.mkdirSync(parent, { recursive: true });
const workspace = path.join(parent, `linux-testspace-${randomUUID()}`); fs.mkdirSync(workspace);
for (const name of ['deployment-v2-m1', 'deployment-v2-agent']) fs.cpSync(name, path.join(workspace, name), { recursive: true });
fs.mkdirSync(path.join(workspace, 'node_modules'));
for (const name of ['ajv', 'fast-deep-equal', 'fast-json-stable-stringify', 'json-schema-traverse', 'uri-js', 'punycode']) fs.cpSync(path.join('node_modules', name), path.join(workspace, 'node_modules', name), { recursive: true });
const name = `lumina-v2-m2-${suite}-${randomUUID()}`, host = ['--host', 'npipe:////./pipe/dockerDesktopLinuxEngine'];
const image = 'node:24.22.1-bookworm-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205';
const nodeArgs = suite === 'measure' ? ['--input-type=module', '-e', 'import fs from "node:fs";fs.mkdirSync("/tmp/measurements",{mode:448});process.argv=[process.execPath,"measure","--output","/tmp/measurements/result.json"];await import("/workspace/deployment-v2-agent/tools/measure.ts");'] : ['--test', '--test-concurrency=1', `${suite === 'm1' ? 'deployment-v2-m1' : 'deployment-v2-agent'}/tests/*.test.mjs`];
const command = [...host, 'run', '--rm', '--pull=never', '--name', name, '--label', 'lumina.test=deployment-v2-m2', '--network', 'none', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--pids-limit', '96', '--memory', '1g', '--cpus', '2', '--user', '10001:10001', '--tmpfs', '/tmp:rw,nosuid,nodev,exec,size=512m', '--mount', `type=bind,source=${workspace},target=/workspace,readonly`, '--workdir', '/workspace', image, 'node', ...nodeArgs];
const r = spawnSync('docker.exe', command, { encoding: 'utf8', timeout: 55_000, maxBuffer: 262_144, windowsHide: true });
const log = `${r.stdout ?? ''}\n${r.stderr ?? ''}`; fs.writeFileSync(path.join(parent, `${suite}-linux-latest.private.log`), log);
if (r.error) {
  const label = spawnSync('docker.exe', [...host, 'inspect', '--format', '{{index .Config.Labels "lumina.test"}}', name], { encoding: 'utf8', timeout: 2000, windowsHide: true });
  if (label.stdout?.trim() === 'deployment-v2-m2') spawnSync('docker.exe', [...host, 'rm', '--force', name], { encoding: 'utf8', timeout: 3000, windowsHide: true });
}
const count = (key: string) => Number(new RegExp(`(?:ℹ|#) ${key} (\\d+)`).exec(log)?.[1] ?? -1);
if (suite !== 'measure' && r.status === 0) assert(count('tests') > 0 && count('fail') === 0 && count('pass') + count('skipped') === count('tests'), 'TEST_SUMMARY_INVALID');
const report = { scope: 'LOCAL_DOCKER_LINUX_NOT_EXTERNAL_CI', suite, exitCode: r.status, spawnError: (r.error as NodeJS.ErrnoException | undefined)?.code ?? null, tests: suite === 'measure' ? null : count('tests'), pass: suite === 'measure' ? null : count('pass'), fail: suite === 'measure' ? null : count('fail'), notRun: suite === 'measure' ? null : count('skipped'), imageDigest: image.split('@')[1], operatingSystem: 'Debian 12', node: '24.22.1', nativeLock: 'LINUX_FLOCK', filesystem: 'EXECUTABLE_TMPFS', simulatedObservationTests: suite === 'm1' ? 11 : 0, systemd: 'NOT_RUN', rootless: 'NOT_RUN', reboot: 'NOT_RUN', productionCompatibility: false };
fs.writeFileSync(path.join(parent, `${suite}-linux-summary.json`), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report)); process.exitCode = r.status === 0 ? 0 : 1;
if (suite === 'measure' && r.status === 0) {
  const measurement = JSON.parse(r.stdout.trim());
  assert(measurement.kind === 'lumina.m2.measurements', 'MEASUREMENT_FORMAT_INVALID');
  fs.writeFileSync(path.join(parent, 'resources-linux.json'), JSON.stringify(measurement, null, 2) + '\n'); console.log(JSON.stringify(measurement));
}
