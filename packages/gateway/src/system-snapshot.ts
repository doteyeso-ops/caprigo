/**
 * Host + gateway process stats for GET /api/system-monitor and alignment with the system_monitor skill.
 */

import * as os from 'os';
import * as fs from 'fs';

export interface SystemMonitorSnapshot {
  hostname: string;
  platform: string;
  release: string;
  arch: string;
  uptimeHostSec: number;
  uptimeProcessSec: number;
  /** null on platforms without load (rare) */
  loadavg: number[] | null;
  cpus: number;
  cpuModel: string;
  memory: {
    totalMb: number;
    freeMb: number;
    usedMb: number;
    usedPct: number;
    processRssMb: number;
    processHeapMb: number;
  };
  disk: {
    path: string;
    totalGb: number;
    freeGb: number;
    usedPct: number;
  } | null;
  gatewayPid: number;
  fetchedAt: string;
}

function mb(n: number): number {
  return Math.round((n / (1024 * 1024)) * 10) / 10;
}

function gb(n: number): number {
  return Math.round((n / (1024 * 1024 * 1024)) * 100) / 100;
}

export function getSystemMonitorSnapshot(): SystemMonitorSnapshot {
  const total = os.totalmem();
  const free = os.freemem();
  const used = total - free;
  const pm = process.memoryUsage();
  const cpus = os.cpus();
  const load = typeof os.loadavg === 'function' ? os.loadavg() : null;

  let disk: SystemMonitorSnapshot['disk'] = null;
  try {
    if (typeof fs.statfsSync === 'function') {
      const sf = fs.statfsSync(process.cwd());
      const bsize = Number(sf.bsize);
      const blocks = Number(sf.blocks);
      const bfree = Number(sf.bfree);
      const totalB = bsize * blocks;
      const freeB = bsize * bfree;
      if (totalB > 0 && Number.isFinite(totalB)) {
        const usedPct = Math.round(((totalB - freeB) / totalB) * 1000) / 10;
        disk = {
          path: process.cwd(),
          totalGb: gb(totalB),
          freeGb: gb(freeB),
          usedPct,
        };
      }
    }
  } catch {
    /* statfs unavailable on some Node/OS builds */
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
    cpuModel: cpus[0]?.model?.trim() || '—',
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
