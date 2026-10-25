// TEST FIXTURE ONLY: never packaged in the Agent runtime or reachable by a request.
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { Worker } from 'node:worker_threads';
import { setTimeout as delay } from 'node:timers/promises';
import assert from 'node:assert/strict';

const mode = process.argv[2];
const cgroup = process.argv[3] === 'self'
  ? `/sys/fs/cgroup${fs.readFileSync('/proc/self/cgroup', 'utf8').trim().split('::')[1]}`
  : process.argv[3];
assert(['config', 'memory', 'cpu', 'tasks', 'children'].includes(mode));
const controls = Object.fromEntries(['memory.max', 'pids.max', 'cpu.max'].map(name =>
  [name, fs.readFileSync(`${cgroup}/${name}`, 'utf8').trim()]));
assert.equal(controls['memory.max'], '134217728');
assert.equal(controls['pids.max'], '32');
const [quota, period] = controls['cpu.max'].split(' ').map(Number);
assert.equal(quota / period, 1);
if (mode === 'config') console.log(JSON.stringify({ enforced: false, configured: true }));
const counters = name => Object.fromEntries(fs.readFileSync(`${cgroup}/${name}`, 'utf8').trim().split('\n').map(line => line.split(' ').map((value, index) => index ? Number(value) : value)));
if (mode === 'memory') {
  const buffers = [];
  for (let n = 0; n < 96; n++) { buffers.push(Buffer.alloc(4 * 1024 ** 2, 0x5a)); await delay(10); }
  throw new Error('MEMORY_LIMIT_NOT_ENFORCED');
}
if (mode === 'cpu') {
  const before = counters('cpu.stat');
  const workers = Array.from({ length: 4 }, () => new Worker('const end=Date.now()+2500; while(Date.now()<end) Math.sqrt(Math.random());',
    { eval: true, resourceLimits: { maxOldGenerationSizeMb: 8, maxYoungGenerationSizeMb: 2, stackSizeMb: 1 } }));
  await Promise.all(workers.map(worker => new Promise((resolve, reject) => { worker.once('error', reject); worker.once('exit', code => code ? reject(new Error('CPU_WORKER_FAILED')) : resolve(undefined)); })));
  const after = counters('cpu.stat');
  assert(after.nr_throttled > before.nr_throttled && after.throttled_usec > before.throttled_usec);
  console.log(JSON.stringify({ enforced: true, throttledUsec: after.throttled_usec - before.throttled_usec }));
}
if (mode === 'tasks' || mode === 'children') {
  const children = [];
  try {
    let refused = false;
    for (let n = 0; n < (mode === 'children' ? 3 : 40); n++) {
      const child = spawn('/usr/bin/sleep', ['30'], { stdio: 'ignore' }); children.push(child);
      const started = await new Promise(resolve => { child.once('spawn', () => resolve(true)); child.once('error', error => { assert.equal(Reflect.get(error, 'code'), 'EAGAIN'); resolve(false); }); });
      if (!started) { refused = true; break; }
    }
    if (mode === 'children') { console.log(JSON.stringify({ children: true })); await delay(30_000); }
    else { assert(refused && counters('pids.events').max > 0); console.log(JSON.stringify({ enforced: true })); }
  } finally { for (const child of children) if (child.pid) child.kill('SIGKILL'); }
}
