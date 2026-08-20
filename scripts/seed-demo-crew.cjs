#!/usr/bin/env node
/**
 * Seed a Repo Crew on a running gateway for marketing screenshots / demos.
 * Usage: node scripts/seed-demo-crew.cjs [--url http://127.0.0.1:18789] [--reset]
 */
'use strict';

const base = (() => {
  const i = process.argv.indexOf('--url');
  return (i >= 0 ? process.argv[i + 1] : process.env.CAPRIGO_GATEWAY_URL) || 'http://127.0.0.1:18789';
})().replace(/\/$/, '');
const reset = process.argv.includes('--reset');

const headers = { 'Content-Type': 'application/json' };
if (process.env.CAPRIGO_API_TOKEN) {
  headers['x-caprigo-token'] = process.env.CAPRIGO_API_TOKEN;
}

async function api(method, path, body) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body != null ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) throw new Error(`${method} ${path} ${res.status}: ${typeof data === 'string' ? data : JSON.stringify(data)}`);
  return data;
}

async function main() {
  await api('GET', '/health');

  if (reset) {
    const listed = await api('GET', '/api/sessions');
    for (const s of listed.sessions || []) {
      await api('DELETE', `/api/sessions/${s.id}`);
    }
    console.log('cleared existing sessions');
  }

  const lead = await api('POST', '/api/sessions', {
    displayName: 'Repo Crew Lead',
    description: 'Coordinates repository implementation work across linked agents.',
    objective: 'Break the repo task into focused assignments and keep the user updated on blockers and completion.',
    runtimeMode: 'llm',
    agentRole: 'orchestrator',
  });

  await api('POST', '/api/sessions', {
    displayName: 'Repo Scout',
    description: 'Finds the right files, symbols, and code paths before implementation.',
    objective: 'Identify the 1-3 most relevant files and likely edit points for each assigned code task.',
    runtimeMode: 'llm',
    agentRole: 'agent',
    linkedOrchestratorId: lead.id,
  });

  await api('POST', '/api/sessions', {
    displayName: 'Code Operator',
    description: 'Implements changes and verifies the result.',
    objective: 'Make the requested code change end-to-end and report changed files or blockers clearly.',
    runtimeMode: 'llm',
    agentRole: 'agent',
    linkedOrchestratorId: lead.id,
  });

  console.log(JSON.stringify({ ok: true, leadId: lead.id, gateway: base }, null, 2));
}

main().catch(err => {
  console.error(err.message || err);
  process.exit(1);
});
