import type { Command } from 'commander';
import { table, bold, dim, ok, bad, trunc } from './style';
import { gatewayDelete, gatewayJson, gatewayPostJson, getGatewayUrl } from './gateway-client';

interface SessionRow {
  id: string;
  displayName: string;
  runtimeMode?: string;
  agentRole?: string;
  status?: string;
  messageCount?: number;
  effectiveModel?: string | null;
}

export function registerAgentCommands(program: Command): void {
  const agents = program
    .command('agents')
    .alias('agent')
    .description('List, create, inspect, or remove agent sessions (same fleet as the dashboard)');

  agents
    .command('list')
    .alias('ls')
    .description('Table of all sessions')
    .option('-j, --json', 'Raw JSON')
    .action(async opts => {
      try {
        const data = await gatewayJson<{ sessions: SessionRow[] }>('/api/sessions');
        if (opts.json) {
          console.log(JSON.stringify(data.sessions || [], null, 2));
          return;
        }
        const rows = data.sessions || [];
        if (rows.length === 0) {
          console.log(dim('No agents yet. Run ') + bold('caprigo agents create --name "My agent"'));
          return;
        }
        const t = table(
          ['ID', 'NAME', 'MODE', 'ROLE', 'STATUS', 'MSGS', 'MODEL'],
          [10, 18, 8, 12, 8, 5, 16],
          rows.map(s => [
            trunc(s.id, 8),
            trunc(s.displayName, 18),
            s.runtimeMode === 'offline' ? 'offline' : 'llm',
            trunc(String(s.agentRole ?? 'agent'), 12),
            trunc(String(s.status ?? '—'), 8),
            String(s.messageCount ?? 0),
            trunc(s.effectiveModel != null && s.effectiveModel !== '' ? String(s.effectiveModel) : '—', 16),
          ])
        );
        console.log('');
        console.log(t);
        console.log('');
        console.log(dim(`Gateway: ${getGatewayUrl()}`));
      } catch (e: unknown) {
        console.error(bad('Error:'), e instanceof Error ? e.message : e);
        process.exit(1);
      }
    });

  agents
    .command('create')
    .description('Create a new session')
    .requiredOption('-n, --name <name>', 'Display name')
    .option('--offline', 'Offline / script mode (no chat LLM)', false)
    .option('--orchestrator', 'Fleet orchestrator role', false)
    .option('-m, --model <id>', 'Per-session model override')
    .action(async opts => {
      try {
        const body: Record<string, unknown> = {
          displayName: opts.name,
          runtimeMode: opts.offline ? 'offline' : 'llm',
          agentRole: opts.orchestrator ? 'orchestrator' : 'agent',
        };
        if (opts.model) body.model = opts.model;
        const created = await gatewayPostJson<SessionRow & { id: string }>('/api/sessions', body);
        console.log(ok('Created agent'));
        console.log(`  id          ${created.id}`);
        console.log(`  name        ${created.displayName}`);
        console.log(`  mode        ${created.runtimeMode ?? 'llm'}`);
        console.log(`  role        ${created.agentRole ?? 'agent'}`);
        console.log(dim(`  Chat: caprigo chat ${created.id} -m "Hello"`));
      } catch (e: unknown) {
        console.error(bad('Error:'), e instanceof Error ? e.message : e);
        process.exit(1);
      }
    });

  agents
    .command('show')
    .description('Show one session')
    .argument('<id>', 'Session id (prefix ok if unique — first match)')
    .option('-j, --json', 'Raw JSON')
    .action(async (idArg: string, opts) => {
      try {
        const data = await gatewayJson<{ sessions: SessionRow[] }>('/api/sessions');
        const rows = data.sessions || [];
        const idLower = idArg.toLowerCase();
        const match =
          rows.find(s => s.id === idArg) ||
          rows.find(s => s.id.toLowerCase().startsWith(idLower)) ||
          rows.find(s => s.id.toLowerCase().includes(idLower));
        if (!match) {
          console.error(bad('No session matches:'), idArg);
          process.exit(1);
        }
        if (opts.json) {
          console.log(JSON.stringify(match, null, 2));
          return;
        }
        console.log('');
        for (const [k, v] of Object.entries(match)) {
          console.log(`  ${bold(k.padEnd(22))} ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`);
        }
        console.log('');
      } catch (e: unknown) {
        console.error(bad('Error:'), e instanceof Error ? e.message : e);
        process.exit(1);
      }
    });

  agents
    .command('delete')
    .alias('rm')
    .description('Remove a session')
    .argument('<id>', 'Session id')
    .option('-y, --yes', 'Skip confirmation', false)
    .action(async (idArg: string, opts) => {
      try {
        const data = await gatewayJson<{ sessions: SessionRow[] }>('/api/sessions');
        const rows = data.sessions || [];
        const idLower = idArg.toLowerCase();
        const match =
          rows.find(s => s.id === idArg) ||
          rows.find(s => s.id.toLowerCase().startsWith(idLower));
        if (!match) {
          console.error(bad('No session matches:'), idArg);
          process.exit(1);
        }
        if (!opts.yes) {
          const readline = await import('readline/promises');
          const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
          const ans = await rl.question(`Remove ${match.displayName} (${match.id})? [y/N] `);
          rl.close();
          if (ans.toLowerCase() !== 'y' && ans.toLowerCase() !== 'yes') {
            console.log(dim('Cancelled.'));
            return;
          }
        }
        await gatewayDelete(`/api/sessions/${match.id}`);
        console.log(ok('Removed.'), match.id);
      } catch (e: unknown) {
        console.error(bad('Error:'), e instanceof Error ? e.message : e);
        process.exit(1);
      }
    });
}
