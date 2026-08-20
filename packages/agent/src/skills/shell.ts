import { Skill } from '@caprigo/shared';
import { caprigoEnv } from '@caprigo/shared';
import { checkCaprigoShellCommand, resolveCaprigoToolPath, caprigoWorkspaceRoot } from '@caprigo/shared';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const DEFAULT_EXEC_MS = 60_000;
const MAX_EXEC_MS = 300_000;

function executeDisabled(): boolean {
  const v = caprigoEnv('DISABLE_EXECUTE_COMMAND')?.trim() || process.env.CAPRIGO_DISABLE_EXECUTE_COMMAND?.trim();
  return v === '1' || v === 'true';
}

export const executeCommandSkill: Skill = {
  name: 'execute_command',
  description:
    'Run a shell/terminal command on the Caprigo host (git, package managers, scripts, system utilities, launching apps like notepad). Windows: PowerShell (`powershell -NoProfile -Command "..."`) or `cmd /c`. Prefer this for terminal work — do not type shell commands into random windows via desktop_type unless the user asks for OS UI. For mouse/keyboard on native apps use desktop_*; for web pages use browser_*. Long interactive TUIs may not work — prefer one-shot commands.',
  executionType: 'local',
  toolParameters: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'Shell command line to run.' },
      cwd: {
        type: 'string',
        description: 'Working directory (defaults to gateway process cwd).',
      },
      timeout_ms: {
        type: 'number',
        description: `Max runtime in ms (default ${DEFAULT_EXEC_MS}, max ${MAX_EXEC_MS}).`,
      },
    },
    required: ['command'],
    additionalProperties: false,
  },
  execute: async (params: { command?: string; cwd?: string; timeout_ms?: number }) => {
    if (executeDisabled()) {
      return { success: false, error: 'Shell execution disabled (CAPRIGO_DISABLE_EXECUTE_COMMAND=1).' };
    }
    const command = String(params?.command ?? '').trim();
    if (!command) return { success: false, error: 'command is required' };

    let timeout = DEFAULT_EXEC_MS;
    if (params?.timeout_ms != null) {
      const n = Number(params.timeout_ms);
      if (Number.isFinite(n)) timeout = Math.min(MAX_EXEC_MS, Math.max(5_000, Math.floor(n)));
    }

    try {
      const cwd = params.cwd ? resolveCaprigoToolPath(String(params.cwd).trim(), caprigoWorkspaceRoot()) : caprigoWorkspaceRoot();
      const allowed = checkCaprigoShellCommand(command, cwd);
      if (!allowed.allowed) {
        return { success: false, error: allowed.reason };
      }
      const { stdout, stderr } = await execAsync(command, {
        cwd,
        timeout,
        maxBuffer: 5 * 1024 * 1024,
      });
      let out = (stdout || '').trim();
      if (out.length > 4000) out = out.substring(0, 4000) + '\n... (truncated)';
      return {
        success: true,
        stdout: out,
        stderr: stderr ? (stderr as string).trim() : undefined,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
        stdout: error.stdout || '',
        stderr: error.stderr || '',
      };
    }
  },
};

export const shellSkills: Skill[] = [executeCommandSkill];
