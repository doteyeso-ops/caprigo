/**
 * Network / clipboard host utilities for the local harness.
 */

import { execFile, spawn } from 'child_process';
import { promisify } from 'util';
import { Skill } from '@caprigo/shared';

const execFileAsync = promisify(execFile);

function writeStdin(command: string, args: string[], text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      windowsHide: true,
      stdio: ['pipe', 'ignore', 'pipe'],
    });
    let err = '';
    child.stderr?.on('data', (d: Buffer) => {
      err += d.toString();
    });
    child.on('error', reject);
    child.on('close', code => {
      if (code === 0) resolve();
      else reject(new Error(err.trim() || `${command} exited ${code}`));
    });
    child.stdin?.end(text, 'utf8');
  });
}

export type LanDevice = {
  ip: string;
  mac?: string;
  hostname?: string;
  state?: string;
  source: string;
};

function parseArpA(stdout: string): LanDevice[] {
  const out: LanDevice[] = [];
  const seen = new Set<string>();
  for (const line of stdout.split(/\r?\n/)) {
    // Windows:  10.0.0.1            00-11-22-33-44-55     dynamic
    // Unix:     ? (10.0.0.1) at 00:11:22:33:44:55 [ether] on eth0
    const win = line.match(
      /^\s*(\d{1,3}(?:\.\d{1,3}){3})\s+([0-9a-fA-F-]{11,17}|[0-9a-fA-F:]{11,17})\s+(\w+)/
    );
    if (win) {
      const ip = win[1];
      if (seen.has(ip)) continue;
      seen.add(ip);
      out.push({
        ip,
        mac: win[2].replace(/-/g, ':').toLowerCase(),
        state: win[3],
        source: 'arp',
      });
      continue;
    }
    const nix = line.match(
      /\((\d{1,3}(?:\.\d{1,3}){3})\)\s+at\s+([0-9a-fA-F:]{11,17}|incomplete)/i
    );
    if (nix) {
      const ip = nix[1];
      if (seen.has(ip)) continue;
      seen.add(ip);
      const mac = nix[2].toLowerCase();
      out.push({
        ip,
        mac: mac === 'incomplete' ? undefined : mac,
        source: 'arp',
      });
    }
  }
  return out;
}

async function parseNetNeighbor(): Promise<LanDevice[]> {
  if (process.platform !== 'win32') return [];
  try {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      [
        '-NoProfile',
        '-Command',
        [
          'Get-NetNeighbor -AddressFamily IPv4 -ErrorAction SilentlyContinue |',
          'Where-Object { $_.State -ne "Unreachable" -and $_.IPAddress -notlike "224.*" -and $_.IPAddress -ne "255.255.255.255" } |',
          'Select-Object IPAddress,LinkLayerAddress,State,InterfaceAlias |',
          'ConvertTo-Json -Compress',
        ].join(' '),
      ],
      { timeout: 20000, windowsHide: true, maxBuffer: 2_000_000 }
    );
    const raw = stdout.trim();
    if (!raw) return [];
    const parsed = JSON.parse(raw) as
      | Array<{ IPAddress?: string; LinkLayerAddress?: string; State?: string }>
      | { IPAddress?: string; LinkLayerAddress?: string; State?: string };
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    return rows
      .map(r => ({
        ip: String(r.IPAddress || '').trim(),
        mac: r.LinkLayerAddress
          ? String(r.LinkLayerAddress).replace(/-/g, ':').toLowerCase()
          : undefined,
        state: r.State ? String(r.State) : undefined,
        source: 'Get-NetNeighbor',
      }))
      .filter(d => d.ip);
  } catch {
    return [];
  }
}

export const listLanDevicesSkill: Skill = {
  name: 'list_lan_devices',
  description:
    'List devices seen on the local network (IP, MAC, state) via ARP / Get-NetNeighbor. Use for "who is on my LAN / connected devices" — do NOT invent filesystem paths like /network_devices.',
  executionType: 'local',
  toolParameters: {
    type: 'object',
    properties: {
      include_multicast: {
        type: 'boolean',
        description: 'Include multicast/broadcast rows (default false)',
      },
    },
  },
  execute: async (params: { include_multicast?: boolean }) => {
    try {
      const includeMulti = !!params?.include_multicast;
      let devices: LanDevice[] = [];
      if (process.platform === 'win32') {
        devices = await parseNetNeighbor();
      }
      if (!devices.length) {
        const { stdout } = await execFileAsync(
          process.platform === 'win32' ? 'arp.exe' : 'arp',
          process.platform === 'win32' ? ['-a'] : ['-an'],
          { timeout: 15000, windowsHide: true, maxBuffer: 2_000_000 }
        );
        devices = parseArpA(stdout);
      }
      if (!includeMulti) {
        devices = devices.filter(
          d =>
            !d.ip.startsWith('224.') &&
            d.ip !== '255.255.255.255' &&
            !d.ip.endsWith('.255')
        );
      }
      devices.sort((a, b) =>
        a.ip.localeCompare(b.ip, undefined, { numeric: true })
      );
      return {
        success: true,
        count: devices.length,
        devices,
        hint: 'These are ARP/neighbor cache entries (recently contacted hosts), not a full subnet scan.',
      };
    } catch (e: unknown) {
      const err = e as { message?: string };
      return { success: false, error: err?.message || String(e) };
    }
  },
};

export const clipboardReadSkill: Skill = {
  name: 'clipboard_read',
  description: 'Read the current system clipboard text (Windows/macOS/Linux).',
  executionType: 'local',
  toolParameters: { type: 'object', properties: {} },
  execute: async () => {
    try {
      let text = '';
      if (process.platform === 'win32') {
        const { stdout } = await execFileAsync(
          'powershell.exe',
          ['-NoProfile', '-Command', 'Get-Clipboard -Raw'],
          { timeout: 10000, windowsHide: true, maxBuffer: 2_000_000 }
        );
        text = stdout.replace(/\r?\n$/, '');
      } else if (process.platform === 'darwin') {
        const { stdout } = await execFileAsync('pbpaste', [], {
          timeout: 10000,
          maxBuffer: 2_000_000,
        });
        text = stdout;
      } else {
        try {
          const { stdout } = await execFileAsync('xclip', ['-selection', 'clipboard', '-o'], {
            timeout: 10000,
            maxBuffer: 2_000_000,
          });
          text = stdout;
        } catch {
          const { stdout } = await execFileAsync('xsel', ['--clipboard', '--output'], {
            timeout: 10000,
            maxBuffer: 2_000_000,
          });
          text = stdout;
        }
      }
      return {
        success: true,
        text,
        chars: text.length,
      };
    } catch (e: unknown) {
      const err = e as { message?: string };
      return { success: false, error: err?.message || String(e) };
    }
  },
};

export const clipboardWriteSkill: Skill = {
  name: 'clipboard_write',
  description: 'Write text to the system clipboard.',
  executionType: 'local',
  toolParameters: {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'Text to place on the clipboard' },
    },
    required: ['text'],
  },
  execute: async (params: { text?: string }) => {
    try {
      const text = params?.text;
      if (text == null || typeof text !== 'string') {
        return { success: false, error: 'clipboard_write requires string "text"' };
      }
      if (process.platform === 'win32') {
        await writeStdin(
          'powershell.exe',
          ['-NoProfile', '-Command', 'Set-Clipboard -Value $input'],
          text
        );
      } else if (process.platform === 'darwin') {
        await writeStdin('pbcopy', [], text);
      } else {
        try {
          await writeStdin('xclip', ['-selection', 'clipboard'], text);
        } catch {
          await writeStdin('xsel', ['--clipboard', '--input'], text);
        }
      }
      return { success: true, chars: text.length };
    } catch (e: unknown) {
      const err = e as { message?: string };
      return { success: false, error: err?.message || String(e) };
    }
  },
};
