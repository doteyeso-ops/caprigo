import { framedSection, bold, dim, ok, bad, muted, titleLine } from './style';
import { gatewayJson, getGatewayUrl } from './gateway-client';

interface Health {
  status?: string;
  skills?: number;
  llm?: {
    provider?: string;
    ollama?: string | null;
    openai?: string | null;
    badge?: string | null;
  };
}

interface Runtime {
  workspaceRoot?: string;
  skillsDir?: string;
  skillCount?: number;
  llmProvider?: string;
  engine?: { model?: string };
}

interface SessionsPayload {
  sessions: Array<{ id: string; displayName: string; messageCount?: number }>;
}

export async function runDashboard(): Promise<void> {
  const base = getGatewayUrl();
  let health: Health | null = null;
  let runtime: Runtime | null = null;
  let sessionCount = 0;
  let skillCount = 0;
  let errMsg: string | null = null;

  try {
    const [h, rt, sess] = await Promise.all([
      gatewayJson<Health>('/health'),
      gatewayJson<Runtime>('/api/runtime'),
      gatewayJson<SessionsPayload>('/api/sessions'),
    ]);
    health = h;
    runtime = rt;
    sessionCount = sess.sessions?.length ?? 0;
    skillCount = rt.skillCount ?? health.skills ?? 0;
  } catch (e: unknown) {
    errMsg = e instanceof Error ? e.message : String(e);
  }

  console.log('');
  console.log(titleLine('  CAPRIGO  '));
  console.log(dim('  Core · CLI & gateway'));
  console.log('');

  if (errMsg) {
    console.log(framedSection('Gateway', [bad('Unreachable'), '', muted(errMsg), '', muted(`Expected: ${base}`), muted('Start the gateway: npm run start (repo root)')]));
    console.log('');
    return;
  }

  const llm = health?.llm;
  const prov = llm?.provider === 'ollama' ? 'Ollama' : llm?.provider === 'openai_compatible' ? 'OpenAI-compatible' : (llm?.provider ?? '—');
  const llmOk =
    llm?.provider === 'ollama'
      ? llm?.ollama === 'ok'
      : llm?.provider === 'openai_compatible'
        ? llm?.openai === 'ok'
        : true;
  const llmState = !llm ? muted('no probe') : llmOk ? ok('ready') : bad('check connection');

  const lines = [
    `${bold('Gateway')}     ${muted(base)}`,
    `${bold('Workspace')}   ${muted(runtime?.workspaceRoot ?? '—')}`,
    `${bold('Skills dir')}   ${muted(runtime?.skillsDir ?? '—')}`,
    '',
    `${bold('LLM')}         ${prov}${llm?.badge ? dim(` · ${llm.badge}`) : ''}  ${llmState}`,
    `${bold('Model')}       ${muted(runtime?.engine?.model ?? '—')}`,
    '',
    `${bold('Tools')}       ${String(skillCount)} registered`,
    `${bold('Sessions')}    ${String(sessionCount)} agents`,
  ];

  console.log(framedSection('Status', lines));
  console.log('');
  console.log(dim('Commands'));
  console.log(`  ${bold('caprigo open')}          ${muted('Open dashboard in browser')}`);
  console.log(`  ${bold('caprigo agents list')}   ${muted('Fleet table')}`);
  console.log(`  ${bold('caprigo agents create')} ${muted('--name "…"')}`);
  console.log(`  ${bold('caprigo chat')}          ${muted('<id> -m "…"')}`);
  console.log(`  ${bold('caprigo skills')}        ${muted('Tool catalog')}`);
  console.log(`  ${bold('caprigo models')}        ${muted('List models (Ollama / API)')}`);
  console.log(`  ${bold('caprigo onboard')}       ${muted('Setup reference')}`);
  console.log('');
}
