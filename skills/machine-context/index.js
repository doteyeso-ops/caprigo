/**
 * Non-secret machine snapshot (hostname, OS, arch, memory) — handy when debugging or writing paths.
 */
const os = require('os');

module.exports = {
  name: 'machine_context',
  description:
    'Return hostname, platform, release, arch, CPU count, and approximate total/free memory (local machine).',
  execute: async () => {
    return {
      success: true,
      hostname: os.hostname(),
      platform: os.platform(),
      release: os.release(),
      arch: os.arch(),
      cpus: os.cpus()?.length ?? 0,
      totalMemBytes: os.totalmem(),
      freeMemBytes: os.freemem(),
      homedir: os.homedir(),
      tmpdir: os.tmpdir(),
    };
  },
};
