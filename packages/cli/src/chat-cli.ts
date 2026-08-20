import * as readline from 'readline';
import { bad, bold, dim, ok, warn } from './style';
import { gatewayJson, gatewayPostJson } from './gateway-client';

async function resolveSession(sessionId: string): Promise<{ id: string; name?: string; runtimeMode?: string }> {
  const data = await gatewayJson<{ sessions: Array<{ id: string; name?: string; runtimeMode?: string }> }>(
    '/api/sessions'
  );
  const rows = data.sessions || [];
  const sid = sessionId.toLowerCase();
  const match =
    rows.find(s => s.id === sessionId) || rows.find(s => s.id.toLowerCase().startsWith(sid));
  if (!match) {
    throw new Error(`No session: ${sessionId}`);
  }
  if (match.runtimeMode === 'offline') {
    throw new Error('Session is offline / script mode — switch it to LLM first.');
  }
  return match;
}

/** One-shot chat. */
export async function chatOnce(sessionId: string, message: string): Promise<void> {
  const match = await resolveSession(sessionId);
  const msg = message.trim();
  if (!msg) throw new Error('Empty message');
  const out = await gatewayPostJson<{ response?: string; error?: string }>(
    `/api/sessions/${match.id}/messages`,
    { message: msg }
  );
  if (out.response !== undefined) {
    console.log(out.response);
    return;
  }
  throw new Error(out.error || 'Unknown error');
}

/**
 * Interactive CLI chat (resource-light vs web UI).
 * Slash commands: /quit /files /help /clear (local only)
 */
export async function chatRepl(sessionId: string): Promise<void> {
  const match = await resolveSession(sessionId);
  console.log(bold(`Caprigo chat · ${match.name || match.id}`));
  console.log(dim('Type a message. /files · /help · /quit'));
  console.log('');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });

  const ask = (): void => {
    rl.question(dim('you> '), async line => {
      const text = String(line || '').trim();
      if (!text) {
        ask();
        return;
      }
      if (text === '/quit' || text === '/exit' || text === '/q') {
        rl.close();
        return;
      }
      if (text === '/help') {
        console.log(dim('/files  list files Caprigo edited'));
        console.log(dim('/quit   leave chat'));
        ask();
        return;
      }
      if (text === '/files') {
        try {
          const data = await gatewayJson<{
            touched?: Array<{ path: string; lastAction: string; lastTs: string; count: number }>;
          }>('/api/file-ledger?limit=30');
          const rows = data.touched || [];
          if (!rows.length) {
            console.log(warn('No file changes recorded yet.'));
          } else {
            for (const r of rows) {
              console.log(`${ok(r.lastAction.padEnd(8))} ${r.path}  ${dim(`×${r.count} ${r.lastTs}`)}`);
            }
          }
        } catch (e: unknown) {
          console.error(bad(e instanceof Error ? e.message : String(e)));
        }
        ask();
        return;
      }
      try {
        process.stdout.write(dim('…\n'));
        const out = await gatewayPostJson<{ response?: string; error?: string }>(
          `/api/sessions/${match.id}/messages`,
          { message: text }
        );
        if (out.response !== undefined) {
          console.log(`${bold('caprigo>')} ${out.response}`);
        } else {
          console.error(bad(out.error || 'Unknown error'));
        }
      } catch (e: unknown) {
        console.error(bad(e instanceof Error ? e.message : String(e)));
      }
      console.log('');
      ask();
    });
  };

  rl.on('close', () => {
    console.log(dim('bye'));
    process.exit(0);
  });

  ask();
}
