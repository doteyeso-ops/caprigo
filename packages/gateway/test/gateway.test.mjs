import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DIST_ENTRY = path.resolve(__dirname, '../dist/index.js');
const BASE_PORT = 19880;

async function waitForReady(baseUrl, timeoutMs = 10000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const r = await fetch(`${baseUrl}/ready`);
      if (r.ok) return;
    } catch {
      // retry
    }
    await delay(150);
  }
  throw new Error('Gateway did not become ready in time');
}

function startGateway({ port, token }) {
  const child = spawn(process.execPath, [DIST_ENTRY], {
    env: {
      ...process.env,
      PORT: String(port),
      CAPRIGO_BIND_HOST: '127.0.0.1',
      CAPRIGO_API_TOKEN: token,
      CAPRIGO_REQUEST_LOG: '0',
      CAPRIGO_RATE_LIMIT_MAX: '1000',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  child.stdout.on('data', d => {
    logs += d.toString();
  });
  child.stderr.on('data', d => {
    logs += d.toString();
  });
  return { child, logsRef: () => logs };
}

async function stopGateway(child) {
  if (child.exitCode != null) return;
  child.kill('SIGTERM');
  await new Promise(resolve => child.once('exit', resolve));
}

test('mutating APIs require token when configured', async () => {
  const port = BASE_PORT;
  const token = 'test-token-1';
  const { child, logsRef } = startGateway({ port, token });
  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    await waitForReady(baseUrl);
    const noAuth = await fetch(`${baseUrl}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ displayName: 'No Auth' }),
    });
    assert.equal(noAuth.status, 401);

    const authed = await fetch(`${baseUrl}/api/sessions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-caprigo-token': token,
      },
      body: JSON.stringify({ displayName: 'Auth OK' }),
    });
    assert.equal(authed.status, 200, `expected 200, got ${authed.status}. logs:\n${logsRef()}`);
  } finally {
    await stopGateway(child);
  }
});

test('llm-config updates are transactional on invalid defaultModel', async () => {
  const port = BASE_PORT + 1;
  const token = 'test-token-2';
  const { child, logsRef } = startGateway({ port, token });
  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    await waitForReady(baseUrl);
    const before = await fetch(`${baseUrl}/api/runtime`).then(r => r.json());
    const beforeProvider = before?.llmConnection?.provider;

    const bad = await fetch(`${baseUrl}/api/llm-config`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'x-caprigo-token': token,
      },
      body: JSON.stringify({
        provider: 'openai_compatible',
        defaultModel: '   ',
      }),
    });
    assert.equal(bad.status, 400);

    const after = await fetch(`${baseUrl}/api/runtime`).then(r => r.json());
    assert.equal(
      after?.llmConnection?.provider,
      beforeProvider,
      `provider changed despite 400 response. logs:\n${logsRef()}`
    );
  } finally {
    await stopGateway(child);
  }
});

