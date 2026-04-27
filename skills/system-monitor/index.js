/**
 * Local skill — exposes host stats (same shape as GET /api/system-monitor) for tool calls.
 */
const os = require('os');
const fs = require('fs');

function mb(n) {
  return Math.round((n / (1024 * 1024)) * 10) / 10;
}

function gb(n) {
  return Math.round((n / (1024 * 1024 * 1024)) * 100) / 100;
}

function snapshot() {
  const total = os.totalmem();
  const free = os.freemem();
  const used = total - free;
  const pm = process.memoryUsage();
  const cpus = os.cpus();
  const load = typeof os.loadavg === 'function' ? os.loadavg() : null;

  let disk = null;
  try {
    if (typeof fs.statfsSync === 'function') {
      const sf = fs.statfsSync(process.cwd());
      const bsize = Number(sf.bsize);
      const blocks = Number(sf.blocks);
      const bfree = Number(sf.bfree);
      const totalB = bsize * blocks;
      const freeB = bsize * bfree;
      if (totalB > 0 && Number.isFinite(totalB)) {
        disk = {
          path: process.cwd(),
          totalGb: gb(totalB),
          freeGb: gb(freeB),
          usedPct: Math.round(((totalB - freeB) / totalB) * 1000) / 10,
        };
      }
    }
  } catch (_) {
    /* optional */
  }

  return {
    hostname: os.hostname(),
    platform: os.platform(),
    release: os.release(),
    arch: os.arch(),
    uptimeHostSec: Math.round(os.uptime()),
    uptimeProcessSec: Math.round(process.uptime()),
    loadavg: load && load.length ? load.map(n => Math.round(n * 100) / 100) : null,
    cpus: cpus.length || 0,
    cpuModel: (cpus[0] && cpus[0].model && cpus[0].model.trim()) || '—',
    memory: {
      totalMb: mb(total),
      freeMb: mb(free),
      usedMb: mb(used),
      usedPct: total > 0 ? Math.round((used / total) * 1000) / 10 : 0,
      processRssMb: mb(pm.rss),
      processHeapMb: mb(pm.heapUsed),
    },
    disk,
    gatewayPid: process.pid,
    fetchedAt: new Date().toISOString(),
  };
}

module.exports = {
  name: 'system_monitor',
  description:
    'Read-only snapshot of this machine and the gateway process: CPU count, load, memory, disk (cwd volume), uptime. Same data as the dashboard system monitor.',
  execute: async () => {
    const s = snapshot();
    return { success: true, snapshot: s, ...s };
  },
};
