import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { aptReason, initial, sourceDigest, sha256, PACKAGE_NAMES } from './contract.mjs';
const file = 'work/ci-private/m22-report.json', [command, a, b] = process.argv.slice(2);
function pkg(name) { const r = spawnSync('dpkg-query', ['-W', '-f=${Status}|${Version}', name], { encoding: 'utf8' });
  return r.status === 0 && r.stdout.startsWith('install ok installed|') ? r.stdout.split('|')[1] : null; }
if (command === 'init') {
  const report = initial({ sha: process.env.GITHUB_SHA, runId: process.env.GITHUB_RUN_ID,
    attempt: process.env.GITHUB_RUN_ATTEMPT, profile: process.env.M22_PROFILE, sourceDigest: sourceDigest(process.cwd()) });
  report.facts = { initialExtrasInstalled: Boolean(pkg('docker-ce-rootless-extras')),
    initialRootlessScript: fs.existsSync('/usr/bin/dockerd-rootless.sh'), initialRootlesskit: fs.existsSync('/usr/bin/rootlesskit') };
  report.environment.ubuntu = fs.readFileSync('/etc/os-release', 'utf8').match(/^VERSION_ID="([\d.]+)"/m)?.[1];
  report.packages = PACKAGE_NAMES.map(name => ({ name, version: pkg(name), installed: true })).filter(p => p.version);
  fs.writeFileSync(file, JSON.stringify(report), { flag: 'wx', mode: 0o600 });
} else {
  const report = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (command === 'legacy') {
    report.metrics[a] = Number(b); const key = ({ legacyUpdateExit: 'update', legacyHelpersExit: 'helpers', legacyExtrasExit: 'extras' })[a];
    if (!key) throw new Error('STAGE_NOT_ALLOWED'); report.legacy ??= {};
    report.legacy[key] = aptReason(fs.readFileSync(`work/ci-private/m22-legacy-${key}.log`, 'utf8'), Number(b) === 0);
  }
  if (command === 'package') {
    const result = spawnSync('dpkg-deb', ['--field', a, 'Package', 'Version'], { encoding: 'utf8' });
    if (result.status !== 0) throw new Error('PACKAGE_INVALID');
    const name = result.stdout.match(/^Package: (.+)$/m)?.[1], version = result.stdout.match(/^Version: (.+)$/m)?.[1];
    if (!PACKAGE_NAMES.includes(name)) throw new Error('PACKAGE_NOT_ALLOWLISTED');
    report.packages.push({ name, version, installed: false, sha256: sha256(fs.readFileSync(a)) });
  }
  fs.writeFileSync(file, JSON.stringify(report));
}
