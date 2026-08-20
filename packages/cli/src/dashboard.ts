import { framedSection, bold, ok, bad, muted, brandHeader, dim } from './style';
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
  console.log(brandHeader('CAPRIGO', 'Capricorn x Virgo', 'Local-first agents with a quieter terminal'));
  console.log('');

  if (errMsg) {
    console.log(
      framedSection('Gateway', [
        bad('Unreachable'),
        '',
        muted(errMsg),
        '',
        muted(`Expected: ${base}`),
        muted('Start the gateway: npm run start (repo root)'),
      ])
    );
    console.log('');
    return;
  }

  const llm = health?.llm;
  const prov =
    llm?.provider === 'ollama'
      ? 'Ollama'
      : llm?.provider === 'openai_compatible'
        ? 'OpenAI-compatible'
        : (llm?.provider ?? '-');
  const llmOk =
    llm?.provider === 'ollama'
      ? llm?.ollama === 'ok'
      : llm?.provider === 'openai_compatible'
        ? llm?.openai === 'ok'
        : true;
  const llmState = !llm ? muted('no probe') : llmOk ? ok('ready') : bad('check connection');

  const badge = llm?.badge ? ` ${muted(`· ${llm.badge}`)}` : '';
  const lines = [
    `${bold('Gateway')}     ${muted(base)}`,
    `${bold('Workspace')}   ${muted(runtime?.workspaceRoot ?? '-')}`,
    `${bold('Skills dir')}  ${muted(runtime?.skillsDir ?? '-')}`,
    '',
    `${bold('LLM')}         ${prov}${badge}  ${llmState}`,
    `${bold('Model')}       ${muted(runtime?.engine?.model ?? '-')}`,
    '',
    `${bold('Tools')}       ${String(skillCount)} registered`,
    `${bold('Sessions')}    ${String(sessionCount)} agents`,
  ];

  console.log(framedSection('Status', lines));
  console.log('');
  console.log(
    framedSection('Quick commands', [
      `${bold('caprigo open')}          ${muted('Open Overview in the browser')}`,
      `${bold('caprigo agents list')}   ${muted('Inspect the fleet')}`,
      `${bold('caprigo agents create')} ${muted('--name "Reviewer"')}`,
      `${bold('caprigo chat')}          ${muted('<id>')}  ${dim('(interactive) or -m "msg"')}`,
      `${bold('caprigo files')}         ${muted('')}  ${dim('files Caprigo edited')}`,
      `${bold('caprigo skills')}        ${muted('Review the tool catalog')}`,
      `${bold('caprigo models')}        ${muted('Probe the active model source')}`,
      `${bold('caprigo onboard')}       ${muted('Print the setup path')}`,
    ])
  );
  console.log('');
}
