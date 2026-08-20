/**
 * Live HOME: compile + auto-drain notepad playbook via embedded runtime (needs LMS for leftover LLM only).
 * Expects harness to finish without capability refusal.
 */
const path = require('path');
const fs = require('fs');
process.chdir(path.resolve(__dirname, '..'));

function loadEnv() {
  const p = path.resolve('.env');
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#') || !t.includes('=')) continue;
    const i = t.indexOf('=');
    const k = t.slice(0, i).trim();
    const v = t.slice(i + 1).trim();
    if (!(k in process.env)) process.env[k] = v;
  }
}

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL', msg);
    process.exit(1);
  }
}

async function main() {
  loadEnv();
  process.env.CAPRIGO_HOME = process.env.CAPRIGO_HOME || '1';
  process.env.CAPRIGO_HOME_AUTODRAIN = process.env.CAPRIGO_HOME_AUTODRAIN || '1';

  const marker = `home-${Date.now().toString(36)}`;
  const user = `open notepad and type ${marker}`;

  const { compileMission } = require('../packages/agent/dist/harness-mission');
  const plan = compileMission(user);
  assert(plan && plan.playbookId === 'desktop_notepad_type', `playbook got ${plan && plan.playbookId}`);
  assert(plan.slots.type_text === marker, `slot ${plan.slots.type_text}`);

  const { createEmbeddedRuntime } = require('../packages/cli/dist/embedded-runtime');
  const rt = await createEmbeddedRuntime({ displayName: 'e2e-home-notepad' });
  const events = [];
  const started = Date.now();
  const { response, stats } = await rt.processMessage(user, e => {
    if (
      e.type === 'mission_compiled' ||
      e.type === 'mission_bootstrap' ||
      e.type === 'mission_action' ||
      e.type === 'mission_verified' ||
      e.type === 'task_start'
    ) {
      events.push(e);
    }
  });
  const ms = Date.now() - started;
  console.log('tools', stats && stats.tools);
  console.log('ms', ms, 'tokens', stats && stats.promptTokens, stats && stats.completionTokens);
  console.log(
    'events',
    events.map(e => `${e.type}:${e.tool || e.playbookId || e.status || ''}`).slice(0, 20)
  );
  console.log('response_head', String(response).slice(0, 400));

  const tools = (stats && stats.tools) || [];
  assert(
    tools.includes('execute_command') || tools.includes('desktop_type') || tools.includes('desktop_focus'),
    'HOME should run desktop tools'
  );
  assert(!/do not have the capability/i.test(String(response)), 'no capability refusal');
  const compiled = events.some(e => e.type === 'mission_compiled');
  assert(compiled, 'mission_compiled event');

  console.log('OK e2e-home-notepad');
  await rt.dispose();
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
