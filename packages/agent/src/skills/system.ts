import * as os from 'os';
import { Skill } from '@caprigo/shared';

export const currentDateTimeSkill: Skill = {
  name: 'current_datetime',
  description: 'Get the current date and time on the system',
  execute: async () => {
    const now = new Date();
    return {
      success: true,
      currentDate: now.toLocaleDateString(),
      currentTime: now.toLocaleTimeString(),
      iso: now.toISOString(),
    };
  },
};

export const systemInfoSkill: Skill = {
  name: 'system_info',
  description:
    'Summary of the host running the gateway: OS, hostname, CPU count, memory, home/temp paths. Use before running OS-specific shell commands.',
  executionType: 'local',
  execute: async () => {
    try {
      const cpus = os.cpus();
      return {
        success: true,
        platform: os.platform(),
        release: os.release(),
        arch: os.arch(),
        hostname: os.hostname(),
        homedir: os.homedir(),
        tmpdir: os.tmpdir(),
        cwd: process.cwd(),
        cpu_count: cpus.length,
        total_mem_mb: Math.round(os.totalmem() / (1024 * 1024)),
        free_mem_mb: Math.round(os.freemem() / (1024 * 1024)),
      };
    } catch (e: unknown) {
      const err = e as { message?: string };
      return { success: false, error: err?.message || String(e) };
    }
  },
};

export const systemSkills: Skill[] = [currentDateTimeSkill, systemInfoSkill];
