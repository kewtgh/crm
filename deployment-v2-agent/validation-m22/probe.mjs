// Test-only wrapper: report bounded kernel counters around the unchanged M2.1 pressure probe.
import fs from 'node:fs';
const root = '/sys/fs/cgroup';
function number(file) { return Number(fs.readFileSync(`${root}/${file}`, 'utf8').trim()); }
function counters(file) { return Object.fromEntries(fs.readFileSync(`${root}/${file}`, 'utf8').trim().split('\n').map(line => { const [key, value] = line.split(' '); return [key, Number(value)]; })); }
function snapshot(stage) {
  const [cpuQuota, cpuPeriod] = fs.readFileSync(`${root}/cpu.max`, 'utf8').trim().split(' ').map(Number);
  const memory = counters('memory.events'), cpu = counters('cpu.stat'), pids = counters('pids.events');
  console.log(JSON.stringify({ stage, memoryMax: number('memory.max'), memoryCurrent: number('memory.current'),
    memoryPeak: number('memory.peak'), memoryMaxEvents: memory.max, oomKill: memory.oom_kill,
    swapMax: number('memory.swap.max'), cpuQuota, cpuPeriod, cpuUsec: cpu.usage_usec,
    nrThrottled: cpu.nr_throttled, throttledUsec: cpu.throttled_usec,
    pidsMax: number('pids.max'), pidsCurrent: number('pids.current'), pidsMaxEvents: pids.max }));
}
snapshot('BEFORE');
const fixedProbe = '/fixtures/validation/resource-probe.mjs';
await import(fixedProbe);
snapshot('AFTER');
