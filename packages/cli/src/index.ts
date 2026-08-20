#!/usr/bin/env node

import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import { program } from 'commander';
import { caprigoDataRoot, caprigoEnv, caprigoPermissionsPath, caprigoWorkspaceRoot } from '@caprigo/shared';
import { runDashboard } from './dashboard';
import { registerAgentCommands } from './agents-cli';
import { openInBrowser } from './open-browser';
import { framedSection, bold, dim, ok, warn, bad, table, trunc, titleLine } from './style';
import { gatewayJson, getGatewayUrl } from './gateway-client';
import { chatOnce, chatRepl } from './chat-cli';
import { runTui } from './tui';

function setupLine(label: string, passed: boolean, detail: string): string {
  return `${passed ? ok('PASS') : warn('CHECK')}  ${label}  ${detail}`;
}

function repoRootFromCli(): string {
  return path.resolve(__dirname, '..', '..', '..');
}

function envFilePath(): string {
  return path.join(repoRootFromCli(), '.env');
}

function npmCommandForHost(): { command: string; argsPrefix: string[] } {
  return process.platform === 'win32'
    ? { command: 'npm.cmd', argsPrefix: [] }
    : { command: 'npm', argsPrefix: [] };
}

function parseDotEnvFile(filePath: string): Record<string, string> {
  if (!fs.existsSync(filePath)) return {};
  const raw = fs.readFileSync(filePath, 'utf8');
  const out: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    out[key] = value;
  }
  return out;
}

function writeDotEnvFile(filePath: string, values: Record<string, string>): void {
  const keys = Object.keys(values).sort();
  const body = keys.map(key => `${key}=${values[key]}`).join('\n') + '\n';
  fs.writeFileSync(filePath, body, 'utf8');
}

async function promptInput(
  rl: { question: (query: string) => Promise<string> },
  label: string,
  initial = '',
  allowEmpty = false
): Promise<string> {
  while (true) {
    const suffix = initial ? ` [${initial}]` : '';
    const raw = (await rl.question(`${label}${suffix}: `)).trim();
    const value = raw || initial;
    if (value || allowEmpty) return value;
  }
}

async function promptYesNo(
  rl: { question: (query: string) => Promise<string> },
  label: string,
  defaultYes = true
): Promise<boolean> {
  const suffix = defaultYes ? ' [Y/n]' : ' [y/N]';
  const raw = (await rl.question(`${label}${suffix}: `)).trim().toLowerCase();
  if (!raw) return defaultYes;
  return raw === 'y' || raw === 'yes';
}

async function promptChoice(
  rl: { question: (query: string) => Promise<string> },
  label: string,
  options: string[],
  initialIndex = 0
): Promise<string> {
  console.log('');
  console.log(label);
  options.forEach((option, index) => {
    console.log(`  ${index + 1}. ${option}${index === initialIndex ? ' (default)' : ''}`);
  });
  while (true) {
    const raw = (await rl.question(`Choose 1-${options.length} [${initialIndex + 1}]: `)).trim();
    if (!raw) return options[initialIndex];
    const idx = Number(raw);
    if (Number.isInteger(idx) && idx >= 1 && idx <= options.length) return options[idx - 1];
  }
}

async function fetchOllamaTags(baseUrl: string): Promise<string[]> {
  const url = `${baseUrl.replace(/\/$/, '')}/api/tags`;
  const res = await fetch(url);
  const data = (await res.json()) as { models?: Array<{ name?: string }> };
  return Array.isArray(data.models)
    ? data.models.map(model => String(model.name || '').trim()).filter(Boolean)
    : [];
}

async function fetchOpenAiModels(baseUrl: string, apiKey: string): Promise<string[]> {
  const normalized = /\/v1\/?$/.test(baseUrl) ? baseUrl.replace(/\/$/, '') : `${baseUrl.replace(/\/$/, '')}/v1`;
  const res = await fetch(`${normalized}/models`, {
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
  });
  const data = (await res.json()) as { data?: Array<{ id?: string }> };
  return Array.isArray(data.data)
    ? data.data.map(model => String(model.id || '').trim()).filter(Boolean)
    : [];
}

async function gatewayReachable(url: string): Promise<boolean> {
  try {
    const res = await fetch(`${url.replace(/\/$/, '')}/health`);
    return res.ok;
  } catch {
    return false;
  }
}

async function waitForGateway(url: string, timeoutMs = 30000): Promise<boolean> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await gatewayReachable(url)) return true;
    await new Promise(resolve => setTimeout(resolve, 1500));
  }
  return false;
}

function startGatewayDetached(): void {
  const repoRoot = repoRootFromCli();
  const npm = npmCommandForHost();
  spawn(npm.command, [...npm.argsPrefix, 'run', 'start'], {
    cwd: repoRoot,
    detached: true,
    stdio: 'ignore',
  }).unref();
}

async function runDoctor(json = false): Promise<void> {
  const repoRoot = repoRootFromCli();
  const envPath = envFilePath();
  const gatewayUrl = getGatewayUrl();
  const permissionsPath = caprigoPermissionsPath();
  const workspaceRoot = caprigoWorkspaceRoot();
  const dataRoot = caprigoDataRoot();
  const envValues = parseDotEnvFile(envPath);
  const gatewayUp = await gatewayReachable(gatewayUrl);

  const local = {
    repoRoot,
    envPath,
    envExists: fs.existsSync(envPath),
    permissionsPath,
    permissionsExists: fs.existsSync(permissionsPath),
    workspaceRoot,
    dataRoot,
    llmProvider: envValues.CAPRIGO_LLM_PROVIDER || caprigoEnv('LLM_PROVIDER') || '',
    defaultModel: envValues.DEFAULT_MODEL || process.env.DEFAULT_MODEL || '',
    ollamaUrl: envValues.OLLAMA_URL || process.env.OLLAMA_URL || '',
    openaiBase: envValues.OPENAI_BASE_URL || process.env.OPENAI_BASE_URL || '',
    vibesBase: envValues.VIBES_CODED_API_BASE || process.env.VIBES_CODED_API_BASE || '',
  };

  let runtime: Record<string, unknown> | null = null;
  let health: Record<string, unknown> | null = null;
  let skills: Record<string, unknown> | null = null;
  let offlineScripts: Record<string, unknown> | null = null;
  let sessions: Record<string, unknown> | null = null;
  let runtimeError = '';

  if (gatewayUp) {
    try {
      [health, runtime, skills, offlineScripts, sessions] = await Promise.all([
        gatewayJson<Record<string, unknown>>('/health'),
        gatewayJson<Record<string, unknown>>('/api/runtime'),
        gatewayJson<Record<string, unknown>>('/api/skills'),
        gatewayJson<Record<string, unknown>>('/api/offline-scripts'),
        gatewayJson<Record<string, unknown>>('/api/sessions'),
      ]);
    } catch (e: unknown) {
      runtimeError = e instanceof Error ? e.message : String(e);
    }
  }

  if (json) {
    console.log(
      JSON.stringify(
        {
          gatewayUrl,
          gatewayReachable: gatewayUp,
          local,
          health,
          runtime,
          skills,
          offlineScripts,
          sessions,
          runtimeError: runtimeError || undefined,
        },
        null,
        2
      )
    );
    return;
  }

  const lines = [
    setupLine('Repo root', true, repoRoot),
    setupLine('.env file', local.envExists, envPath),
    setupLine('Permissions file', local.permissionsExists, permissionsPath),
    setupLine('Workspace root', true, workspaceRoot),
    setupLine('Data root', true, dataRoot),
    setupLine('Gateway', gatewayUp, gatewayUrl),
  ];

  if (local.llmProvider || local.defaultModel) {
    lines.push(setupLine('Configured provider', !!local.llmProvider, local.llmProvider || '(unset)'));
    lines.push(setupLine('Configured model', !!local.defaultModel, local.defaultModel || '(unset)'));
  }

  try {
    const { probeLmStudio, describeLmStudioTarget } = await import('./embedded-runtime');
    const probe = await probeLmStudio();
    lines.push(
      setupLine(
        'LM Studio',
        probe.ok,
        probe.ok
          ? `${describeLmStudioTarget()} · ${probe.models.length} model(s)`
          : `${describeLmStudioTarget()} · ${probe.error || 'unreachable'}`
      )
    );
  } catch {
    /* ignore */
  }

  console.log('');
  console.log(titleLine('Caprigo - doctor'));
  console.log('');
  console.log(framedSection('Local configuration', lines));
  console.log('');

  if (!gatewayUp) {
    console.log(
      framedSection('Gateway status', [
        `Gateway is not required for embedded TUI (default).`,
        `Optional: \`caprigo serve\` then \`caprigo tui --gateway\`.`,
        `Daily path: start LM Studio → load a model → \`caprigo tui\`.`,
      ])
    );
    console.log('');
    console.log(
      framedSection('Recommended use', [
        'Use `caprigo setup --interactive` (pick LM Studio).',
        'Use `caprigo tui` for the embedded agent harness.',
        `Permissions live at ${permissionsPath}.`,
      ])
    );
    console.log('');
    return;
  }

  const llm = (health?.llm as Record<string, unknown> | undefined) || {};
  const runtimeSkillsDir = String(runtime?.skillsDir || '');
  const runtimeWorkspace = String(runtime?.workspaceRoot || workspaceRoot);
  const runtimeModel = String(((runtime?.engine as Record<string, unknown> | undefined)?.model as string) || '');
  const skillCount = Array.isArray(skills?.skills) ? skills!.skills.length : Number(runtime?.skillCount || 0);
  const offlineCount = Array.isArray(offlineScripts?.scripts) ? offlineScripts!.scripts.length : 0;
  const sessionCount = Array.isArray(sessions?.sessions) ? sessions!.sessions.length : 0;

  console.log(
    framedSection('Runtime status', [
      setupLine('Runtime workspace', !!runtimeWorkspace, runtimeWorkspace || '(unset)'),
      setupLine('Runtime skills dir', !!runtimeSkillsDir, runtimeSkillsDir || '(unset)'),
      setupLine('Provider', !!llm.provider, String(llm.provider || '(unset)')),
      setupLine('Model', !!runtimeModel, runtimeModel || '(unset)'),
      setupLine('Skills loaded', skillCount > 0, `${skillCount}`),
      setupLine('Offline scripts', offlineCount >= 0, `${offlineCount}`),
      setupLine('Sessions', sessionCount >= 0, `${sessionCount}`),
    ])
  );
  console.log('');

  if (runtimeError) {
    console.log(framedSection('Runtime error', [runtimeError]));
    console.log('');
  }

  console.log(
    framedSection('Recommended use', [
      'Use `caprigo setup --interactive` for first-run config.',
      'Use `./launch.ps1` for normal startup after setup.',
      'Use Overview to verify backend/model, then create the first agent.',
      `Permissions live at ${permissionsPath}. Expand scopes there intentionally if local tool access is denied.`,
    ])
  );
  console.log('');
}

type InteractiveSetupOptions = {
  launch?: boolean;
  openBrowser?: boolean;
};

async function runInteractiveSetup(options: InteractiveSetupOptions = {}): Promise<void> {
  const readline = await import('readline/promises');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const envPath = envFilePath();
  const existing = parseDotEnvFile(envPath);

  try {
    console.log('');
    console.log(titleLine('Caprigo - interactive setup'));
    console.log('');
    console.log('This writes the runtime setup the user owns before agents begin operating.');

    const providerChoice = await promptChoice(
      rl,
      'LLM backend',
      ['lmstudio (OpenAI-compatible local)', 'ollama', 'openai (remote API)'],
      (() => {
        const cur = String(existing.CAPRIGO_LLM_PROVIDER || 'openai_compatible').toLowerCase();
        if (cur === 'ollama') return 1;
        if (cur === 'openai' && !String(existing.OPENAI_BASE_URL || '').includes('1234')) return 2;
        return 0;
      })()
    );

    const nextEnv: Record<string, string> = {
      ...existing,
    };

    let discoveredModels: string[] = [];

    if (providerChoice.startsWith('ollama')) {
      nextEnv.CAPRIGO_LLM_PROVIDER = 'ollama';
      const ollamaUrl = await promptInput(
        rl,
        'Ollama URL',
        existing.OLLAMA_URL || 'http://127.0.0.1:11434'
      );
      nextEnv.OLLAMA_URL = ollamaUrl;
      delete nextEnv.OPENAI_BASE_URL;
      delete nextEnv.OPENAI_API_KEY;

      try {
        discoveredModels = await fetchOllamaTags(ollamaUrl);
        if (discoveredModels.length > 0) {
          console.log('');
          console.log(`Detected ${discoveredModels.length} Ollama model(s).`);
        }
      } catch {
        console.log('');
        console.log(warn('Could not list Ollama models right now. You can still enter one manually.'));
      }
    } else {
      const isLmStudio = providerChoice.startsWith('lmstudio');
      nextEnv.CAPRIGO_LLM_PROVIDER = 'openai_compatible';
      const apiBase = await promptInput(
        rl,
        isLmStudio ? 'LM Studio base URL' : 'OpenAI-compatible base URL',
        existing.OPENAI_BASE_URL ||
          (isLmStudio ? 'http://127.0.0.1:1234/v1' : 'https://api.openai.com/v1')
      );
      const apiKey = await promptInput(
        rl,
        isLmStudio ? 'API key (optional for LM Studio)' : 'OpenAI-compatible API key',
        existing.OPENAI_API_KEY || '',
        true
      );
      nextEnv.OPENAI_BASE_URL = apiBase;
      if (apiKey) nextEnv.OPENAI_API_KEY = apiKey;
      delete nextEnv.OLLAMA_URL;
      nextEnv.CAPRIGO_HARNESS_MODE = existing.CAPRIGO_HARNESS_MODE || '1';

      try {
        discoveredModels = await fetchOpenAiModels(apiBase, apiKey);
        if (discoveredModels.length > 0) {
          console.log('');
          console.log(`Detected ${discoveredModels.length} model(s).`);
        }
      } catch {
        console.log('');
        console.log(
          warn(
            isLmStudio
              ? 'Could not reach LM Studio. Start the local server and load a model, then retry.'
              : 'Could not list remote models right now. You can still enter one manually.'
          )
        );
      }
    }

    let chosenModel = existing.DEFAULT_MODEL || '';
    if (discoveredModels.length > 0) {
      chosenModel = await promptChoice(
        rl,
        'Default model',
        [...discoveredModels, 'Enter a different model manually'],
        0
      );
      if (chosenModel === 'Enter a different model manually') {
        chosenModel = await promptInput(rl, 'Default model', existing.DEFAULT_MODEL || '');
      }
    } else {
      chosenModel = await promptInput(rl, 'Default model', existing.DEFAULT_MODEL || '');
    }
    nextEnv.DEFAULT_MODEL = chosenModel;

    const setMarketplaceKey = await promptYesNo(
      rl,
      'Configure Vibes marketplace settings now',
      !!existing.VIBES_CODED_API_BASE || !!existing.VIBES_CODED_API_KEY
    );
    if (setMarketplaceKey) {
      nextEnv.VIBES_CODED_API_BASE = await promptInput(
        rl,
        'Vibes API base',
        existing.VIBES_CODED_API_BASE || 'https://vibes-coded.com/api'
      );
      const vibesKey = await promptInput(rl, 'Vibes API key', existing.VIBES_CODED_API_KEY || '', true);
      if (vibesKey) nextEnv.VIBES_CODED_API_KEY = vibesKey;
    }

    const writeEnv = await promptYesNo(rl, `Write setup to ${envPath}`, true);
    if (writeEnv) {
      writeDotEnvFile(envPath, nextEnv);
      console.log('');
      console.log(ok(`Wrote ${envPath}`));
    } else {
      console.log('');
      console.log(warn('Skipped writing .env file.'));
    }

    const gatewayUrl = getGatewayUrl();
    const gatewayWasReachable = await gatewayReachable(gatewayUrl);
    const shouldStartGateway =
      typeof options.launch === 'boolean'
        ? options.launch
        : await promptYesNo(
            rl,
            'Start Caprigo gateway after setup',
            !gatewayWasReachable
          );

    let gatewayStarted = false;
    let gatewayReady = false;
    if (shouldStartGateway) {
      gatewayStarted = true;
      console.log('');
      console.log(dim('Starting Caprigo gateway...'));
      startGatewayDetached();
      gatewayReady = await waitForGateway(gatewayUrl, 30000);
      console.log(gatewayReady ? ok(`Gateway ready at ${gatewayUrl}`) : warn(`Gateway did not report ready within 30s at ${gatewayUrl}`));
    }

    const shouldOpenBrowser =
      typeof options.openBrowser === 'boolean'
        ? options.openBrowser
        : gatewayStarted
          ? gatewayReady && (await promptYesNo(rl, 'Open Caprigo Overview in your browser now', true))
          : await promptYesNo(rl, 'Open Caprigo Overview in your browser now', false);

    if (shouldOpenBrowser) {
      openInBrowser(gatewayUrl);
    }

    console.log('');
    console.log(
      framedSection('Next actions', [
        gatewayStarted
          ? gatewayReady
            ? `1. Overview should now be available at ${gatewayUrl}`
            : `1. Check gateway startup manually with npm run start`
          : `1. Start Caprigo: npm run start`,
        `2. Run setup check: node packages/cli/dist/index.js setup`,
        `3. Open Overview and confirm backend + model`,
        `4. Create the first agent`,
      ])
    );
    console.log('');
    console.log(
      framedSection('Setup complete', [
        `Config file: ${envPath}`,
        `Gateway URL: ${gatewayUrl}`,
        gatewayStarted
          ? gatewayReady
            ? 'Status: Caprigo launched successfully.'
            : 'Status: launch attempted, but health did not confirm in time.'
          : 'Status: config saved; launch was left to the user.',
        `Next: open Overview, confirm backend + model, then create the first agent.`,
      ])
    );
    console.log('');
  } finally {
    rl.close();
  }
}

program
  .name('caprigo')
  .description('Caprigo CLI — local LM Studio agent harness (TUI, tools, computer use)')
  .version('2.0.0', '-V, --version');

program
  .command('tui')
  .alias('ui')
  .description('Interactive agent TUI (embedded LM Studio harness by default)')
  .argument('[sessionId]', 'Optional agent id / prefix (gateway mode only)')
  .option('--gateway', 'Attach to Caprigo gateway instead of embedded runtime')
  .action(async (sessionId?: string, opts?: { gateway?: boolean }) => {
    try {
      await runTui(sessionId, { gateway: !!opts?.gateway });
    } catch (e: unknown) {
      console.error(bad('Error:'), e instanceof Error ? e.message : e);
      process.exit(1);
    }
  });

program
  .command('serve')
  .description('Start Caprigo gateway (optional HTTP API + web)')
  .action(() => {
    const gatewayEntry = path.join(__dirname, '../../gateway/dist/index.js');
    console.log(dim('Starting gateway…'), gatewayEntry);
    const child = spawn(process.execPath, [gatewayEntry], {
      stdio: 'inherit',
      env: process.env,
    });
    child.on('exit', code => process.exit(code ?? 0));
  });

program
  .command('dashboard')
  .alias('d')
  .description('Overview panel')
  .action(async () => {
    await runDashboard();
  });

program
  .command('status')
  .description('Alias for dashboard')
  .action(async () => {
    await runDashboard();
  });

program
  .command('open')
  .description('Open the web dashboard in your browser')
  .option('-u, --url <url>', 'Override gateway URL (default: CAPRIGO_GATEWAY_URL or http://localhost:18789)')
  .action(opts => {
    const u = (opts.url as string | undefined)?.trim() || getGatewayUrl();
    console.log(dim('Opening'), u);
    openInBrowser(u);
  });

registerAgentCommands(program);

program
  .command('chat')
  .description('Chat with an agent (omit -m for interactive CLI REPL)')
  .argument('<sessionId>', 'Session id (prefix allowed)')
  .option('-m, --message <text>', 'One-shot user message (skip REPL)')
  .action(async (sessionId: string, opts) => {
    try {
      const msg = opts.message != null ? String(opts.message).trim() : '';
      if (msg) {
        await chatOnce(sessionId, msg);
        return;
      }
      if (!process.stdin.isTTY) {
        console.error(bad('Interactive chat needs a TTY, or pass -m "message".'));
        process.exit(1);
      }
      await chatRepl(sessionId);
    } catch (e: unknown) {
      console.error(bad('Error:'), e instanceof Error ? e.message : e);
      process.exit(1);
    }
  });

program
  .command('files')
  .description('List files Caprigo recently created or edited')
  .option('-n, --limit <n>', 'Max paths', '40')
  .option('-j, --json', 'JSON output')
  .action(async opts => {
    try {
      const limit = Math.min(200, Math.max(1, parseInt(String(opts.limit || '40'), 10) || 40));
      const data = await gatewayJson<{
        touched: Array<{ path: string; lastAction: string; lastTs: string; count: number }>;
        events?: unknown[];
        count: number;
      }>(`/api/file-ledger?limit=${limit}`);
      if (opts.json) {
        console.log(JSON.stringify(data, null, 2));
        return;
      }
      console.log(titleLine(`File ledger (${data.count})`));
      const rows = data.touched || [];
      if (!rows.length) {
        console.log(dim('No writes/edits recorded yet. Ask an agent to write_file or search_replace.'));
        return;
      }
      for (const r of rows) {
        console.log(`${ok(r.lastAction.padEnd(8))} ${trunc(r.path, 72)}  ${dim(`×${r.count}`)}`);
      }
    } catch (e: unknown) {
      console.error(bad('Error:'), e instanceof Error ? e.message : e);
      process.exit(1);
    }
  });

program
  .command('skills')
  .description('List registered tools / skills')
  .option('-j, --json', 'Output as JSON')
  .action(async opts => {
    try {
      const data = await gatewayJson<{
        skills?: Array<{ name: string; description: string; source?: string }>;
        skillsDir?: string;
      }>('/api/skills');
      if (opts.json) {
        console.log(JSON.stringify(data.skills || [], null, 2));
        return;
      }
      const skills = data.skills || [];
      console.log('');
      console.log(titleLine(`  Tools  (${skills.length})`));
      if (data.skillsDir) console.log(dim(`  ${data.skillsDir}`));
      console.log('');
      if (skills.length === 0) {
        console.log(dim('No skills loaded.'));
        return;
      }
      const rows = skills.map(s => [
        trunc(s.name, 22),
        trunc(String(s.source ?? 'core'), 11),
        trunc(s.description.replace(/\s+/g, ' '), 44),
      ]);
      console.log(table(['NAME', 'SOURCE', 'DESCRIPTION'], [22, 11, 44], rows));
      console.log('');
    } catch (e: unknown) {
      console.error(bad('Error:'), e instanceof Error ? e.message : e);
      process.exit(1);
    }
  });

program
  .command('models')
  .description('List models from the active LLM backend (Ollama tags or OpenAI-compatible /v1/models)')
  .option('-j, --json', 'Output as JSON')
  .action(async opts => {
    try {
      const rt = await gatewayJson<{ llmProvider?: string }>('/api/runtime');
      const prov = String(rt.llmProvider || '').toLowerCase();
      let path = '/api/ollama/models';
      if (prov === 'openai_compatible' || prov === 'openai') path = '/api/openai/models';
      const raw = await gatewayJson<{ models?: string[]; error?: string; ollamaUrl?: string | null; baseUrl?: string | null }>(
        path
      );
      if (opts.json) {
        console.log(JSON.stringify(raw, null, 2));
        return;
      }
      if (raw.error) {
        console.warn(warn(raw.error));
      }
      const models = raw.models || [];
      console.log('');
      console.log(titleLine('  Models'));
      if (raw.ollamaUrl) console.log(dim(`  Ollama  ${raw.ollamaUrl}`));
      if (raw.baseUrl) console.log(dim(`  API     ${raw.baseUrl}`));
      console.log('');
      if (models.length === 0) console.log(dim('(none — check backend or provider)'));
      else models.forEach(m => console.log(`  ${m}`));
      console.log('');
    } catch (e: unknown) {
      console.error(bad('Error:'), e instanceof Error ? e.message : e);
      process.exit(1);
    }
  });

program
  .command('health')
  .description('Gateway & LLM probe (detailed)')
  .option('-j, --json', 'Output as JSON')
  .action(async opts => {
    try {
      const data = await gatewayJson<Record<string, unknown>>('/health');
      if (opts.json) {
        console.log(JSON.stringify(data, null, 2));
        return;
      }
      const llm = data.llm as Record<string, unknown> | undefined;
      const lines: string[] = [
        `${bold('Status')}     ${String(data.status ?? '—')}`,
        `${bold('Skills')}     ${String(data.skills ?? '—')}`,
      ];
      if (llm) {
        lines.push('', `${bold('LLM')}`);
        lines.push(`  provider     ${String(llm.provider ?? '—')}`);
        if (llm.ollama_url) lines.push(`  ollama URL   ${String(llm.ollama_url)} → ${String(llm.ollama)}`);
        if (llm.openai_base) {
          lines.push(`  API base     ${String(llm.openai_base)}`);
          lines.push(`  API key      ${llm.openai_api_key_set ? ok('set') : warn('not set')}`);
          lines.push(`  reachable    ${String(llm.openai)}`);
          if (llm.openai_probe_detail) {
            const pd = String(llm.openai_probe_detail);
            lines.push(`  probe        ${pd.length > 100 ? `${pd.slice(0, 100)}…` : pd}`);
          }
        }
      }
      const vibes = data.vibes as Record<string, unknown> | undefined;
      if (vibes) {
        lines.push('', `${bold('Vibes')}`);
        lines.push(`  API          ${String(vibes.api_base ?? '—')}`);
        lines.push(`  key          ${vibes.api_key_set ? ok('set') : dim('not set')}`);
      }
      console.log('');
      console.log(framedSection('Health', lines));
      console.log('');
    } catch (e: unknown) {
      console.error(bad('Error:'), e instanceof Error ? e.message : e);
      process.exit(1);
    }
  });

program
  .command('setup')
  .description('Run first-run setup checks and show the next required actions')
  .option('-i, --interactive', 'Prompt for provider/model and optionally write .env')
  .option('--launch', 'Start Caprigo after interactive setup')
  .option('--no-launch', 'Do not start Caprigo after interactive setup')
  .option('--open-browser', 'Open Overview in the browser after interactive setup')
  .option('--no-open-browser', 'Do not open Overview after interactive setup')
  .action(async opts => {
    if (opts.interactive || process.env.CAPRIGO_SETUP_INTERACTIVE === '1') {
      const launch =
        typeof opts.launch === 'boolean'
          ? opts.launch
          : process.env.CAPRIGO_SETUP_AUTO_LAUNCH === '1'
            ? true
            : process.env.CAPRIGO_SETUP_AUTO_LAUNCH === '0'
              ? false
              : undefined;
      const openBrowser =
        typeof opts.openBrowser === 'boolean'
          ? opts.openBrowser
          : process.env.CAPRIGO_SETUP_OPEN_BROWSER === '1'
            ? true
            : process.env.CAPRIGO_SETUP_OPEN_BROWSER === '0'
              ? false
              : undefined;
      await runInteractiveSetup({ launch, openBrowser });
      return;
    }
    const gatewayUrl = getGatewayUrl();
    try {
      const [health, runtime, skills, sessions] = await Promise.all([
        gatewayJson<Record<string, unknown>>('/health'),
        gatewayJson<{ llmProvider?: string; engine?: { model?: string | null } }>('/api/runtime'),
        gatewayJson<{ skills?: Array<{ source?: string }> }>('/api/skills'),
        gatewayJson<{ sessions?: Array<{ id: string }> }>('/api/sessions'),
      ]);

      const llm = health.llm as Record<string, unknown> | undefined;
      const provider = String(runtime.llmProvider || llm?.provider || 'unknown');
      const model = String(runtime.engine?.model || '').trim();
      const providerReady =
        provider === 'ollama'
          ? llm?.ollama === 'ok'
          : provider === 'openai' || provider === 'openai_compatible'
            ? llm?.openai === 'ok'
            : false;

      let models: string[] = [];
      try {
        const modelPath =
          provider === 'openai' || provider === 'openai_compatible' ? '/api/openai/models' : '/api/ollama/models';
        const modelData = await gatewayJson<{ models?: string[] }>(modelPath);
        models = Array.isArray(modelData.models) ? modelData.models : [];
      } catch {
        models = [];
      }

      const skillCount = (skills.skills || []).length;
      const sessionCount = (sessions.sessions || []).length;
      const modelListed = !model ? false : models.length === 0 ? true : models.includes(model);

      console.log('');
      console.log(titleLine('Caprigo - setup check'));
      console.log('');
      console.log(
        framedSection('Setup status', [
          setupLine('Gateway', true, gatewayUrl),
          setupLine('LLM backend', providerReady, `${provider}${providerReady ? ' reachable' : ' needs attention'}`),
          setupLine('Default model', !!model && modelListed, model || 'not configured'),
          setupLine('Tools and skills', skillCount > 0, `${skillCount} loaded`),
          setupLine('First agent', sessionCount > 0, sessionCount > 0 ? `${sessionCount} created` : 'not created yet'),
        ])
      );
      console.log('');
      console.log(
        framedSection('Recommended order', [
          '1. Confirm the backend shows PASS.',
          '2. Confirm the model is the one you intend to use.',
          '3. Open Overview and check skills plus marketplace imports.',
          '4. Create one focused agent.',
          '5. Move to Session or Board for live operation.',
        ])
      );
      console.log('');
      if (!providerReady || !model || !modelListed) {
        console.log(warn('Next action: finish runtime/model setup before expecting agents to operate reliably.'));
      } else if (sessionCount === 0) {
        console.log(warn('Next action: create the first agent from Overview or `caprigo agents create`.'));
      } else {
        console.log(ok('Setup baseline looks good. Agents can operate now.'));
      }
      console.log('');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.log('');
      console.log(titleLine('Caprigo - setup check'));
      console.log('');
      console.log(
        framedSection('Gateway not ready', [
          `Gateway URL: ${gatewayUrl}`,
          `Error: ${msg}`,
          'Start Caprigo with `npm run start` from the repo root.',
          'Then open Overview and confirm backend + model health.',
        ])
      );
      console.log('');
      process.exit(1);
    }
  });

program
  .command('doctor')
  .description('Inspect local Caprigo config, permissions, and live runtime status when available')
  .option('-j, --json', 'Output as JSON')
  .action(async opts => {
    try {
      await runDoctor(Boolean(opts.json));
    } catch (e: unknown) {
      console.error(bad('Error:'), e instanceof Error ? e.message : e);
      process.exit(1);
    }
  });

program
  .command('connect')
  .description('Discover LM Studio on localhost/LAN and write Caprigo .env for the harness')
  .argument('[target]', 'Optional host or URL (e.g. 10.0.0.27 or http://10.0.0.27:1234/v1)')
  .option('--host <host>', 'LM Studio host IP/hostname')
  .option('--port <port>', 'LM Studio port', '1234')
  .option('--model <id>', 'Model id to set as DEFAULT_MODEL')
  .option('--no-scan', 'Do not scan the LAN /24')
  .option('--dry-run', 'Discover only; do not write .env')
  .option('--launch', 'Start embedded TUI after connecting')
  .action(async (target: string | undefined, opts) => {
    try {
      const { connectLmStudio, normalizeLmStudioBase } = await import('./lmstudio-connect');
      const envPath = envFilePath();
      const port = Math.max(1, parseInt(String(opts.port || '1234'), 10) || 1234);
      let hostOpt = (opts.host as string | undefined)?.trim() || undefined;
      if (!hostOpt && target?.trim()) {
        const t = target.trim();
        if (/^https?:\/\//i.test(t)) {
          hostOpt = new URL(normalizeLmStudioBase(t, port)).hostname;
        } else {
          hostOpt = t.replace(/:\d+$/, '').replace(/\/.*$/, '');
        }
      }

      console.log('');
      console.log(titleLine('Caprigo - connect LM Studio'));
      console.log('');

      const result = await connectLmStudio({
        envPath,
        host: hostOpt,
        port,
        model: (opts.model as string | undefined)?.trim(),
        scanLan: opts.scan !== false,
        write: !opts.dryRun,
        onProgress: m => console.log(dim(`  ${m}`)),
      });
      console.log('');
      console.log(
        framedSection(opts.dryRun ? 'Discovered (dry-run)' : 'Connected', [
          `Base URL: ${result.baseUrl}`,
          `Model:    ${result.model}`,
          `Models:   ${result.models.join(', ') || '(none listed)'}`,
          opts.dryRun ? 'Wrote:    (skipped)' : `Wrote:    ${result.envPath}`,
        ])
      );
      console.log('');
      if (opts.launch && !opts.dryRun) {
        console.log(dim('Launching embedded TUI…'));
        await runTui();
      } else if (!opts.dryRun) {
        console.log(dim('Next: caprigo tui'));
        console.log('');
      }
    } catch (e: unknown) {
      console.error(bad('Error:'), e instanceof Error ? e.message : e);
      process.exit(1);
    }
  });

program
  .command('onboard')
  .description('Print the user setup path before agents begin operating')
  .action(() => {
    const home = process.env.USERPROFILE || process.env.HOME || '~';
    const skillsDir = path.join(home, '.caprigo', 'skills');
    console.log('');
    console.log(titleLine('Caprigo - user setup path'));
    console.log('');
    console.log(framedSection('1 - Choose and verify an LLM backend', [
      `${bold('A) Ollama (default)')}  CAPRIGO_LLM_PROVIDER=ollama`,
      `              OLLAMA_URL=http://localhost:11434`,
      `              DEFAULT_MODEL=qwen3:latest`,
      '',
      `${bold('B) OpenAI-compatible')}  CAPRIGO_LLM_PROVIDER=openai`,
      `              OPENAI_BASE_URL=https://api.openai.com/v1`,
      `              OPENAI_API_KEY=...`,
      `              DEFAULT_MODEL=gpt-4o-mini`,
    ]));
    console.log('');
    console.log(framedSection('2 - Add optional skills and imports', [
      `Drop JS skills in ${skillsDir}`,
      `Or set CAPRIGO_SKILLS_DIR`,
      `Agent Skills (SKILL.md): skills/agentskills/`,
    ]));
    console.log('');
    console.log(framedSection('3 - Start Caprigo and confirm runtime health', [
      `Dashboard + API: ${bold('npm run start')} (repo root)`,
      `CLI default URL: ${getGatewayUrl()} (${dim('CAPRIGO_GATEWAY_URL')})`,
      `Remote mutations: set ${dim('CAPRIGO_API_TOKEN')} and pass ${dim('x-caprigo-token')}`,
    ]));
    console.log('');
    console.log(framedSection('4 - Then let the agent operate', [
      `Overview: confirm backend, model, skills, and create the first agent`,
      `Board: run scripts, chain agents, and manage fleet operations`,
      `Session: chat with one agent after setup is complete`,
      `Landing page / docs: INSTALL_AND_FIRST_RUN.md and LANDING_PAGE_BRIEF.md`,
    ]));
    console.log('');
  });

program.addHelpText(
  'after',
  `
${dim('Examples:')}
  ${bold('caprigo')}                      ${dim('# TUI shell (chat / files / agents)')}
  ${bold('caprigo tui')} ${dim('[id]')}
  ${bold('caprigo agents list')}
  ${bold('caprigo chat')} ${dim('<id> -m "…"')}
  ${bold('caprigo files')}
  ${bold('caprigo dashboard')}            ${dim('# one-shot status panel')}
`
);

const argv = process.argv.slice(2);
if (argv.length === 0) {
  void runTui()
    .then(() => {
      /* tui owns process exit */
    })
    .catch(e => {
      console.error(e);
      process.exit(1);
    });
} else {
  program.parse();
}
