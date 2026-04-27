import { caprigoEnv } from '@caprigo/shared';

export function getGatewayUrl(): string {
  return caprigoEnv('GATEWAY_URL') || 'http://localhost:18789';
}

function mergeHeaders(init?: HeadersInit): Headers {
  const h = new Headers(init);
  const token = process.env.CAPRIGO_API_TOKEN?.trim();
  if (token) h.set('x-caprigo-token', token);
  return h;
}

export async function gatewayFetch(path: string, init?: RequestInit): Promise<Response> {
  const url = `${getGatewayUrl().replace(/\/$/, '')}${path.startsWith('/') ? path : `/${path}`}`;
  return fetch(url, { ...init, headers: mergeHeaders(init?.headers) });
}

export async function readJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  let data: unknown;
  try {
    data = JSON.parse(text) as unknown;
  } catch {
    throw new Error(`Expected JSON (${res.status}): ${text.slice(0, 240)}`);
  }
  if (!res.ok) {
    const err =
      typeof data === 'object' && data !== null && 'error' in data && typeof (data as { error: unknown }).error === 'string'
        ? (data as { error: string }).error
        : text.slice(0, 200);
    throw new Error(err || `HTTP ${res.status}`);
  }
  return data as T;
}

export async function gatewayJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await gatewayFetch(path, init);
  return readJson<T>(res);
}

export async function gatewayPostJson<T>(path: string, body: unknown): Promise<T> {
  const res = await gatewayFetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return readJson<T>(res);
}

export async function gatewayPatchJson<T>(path: string, body: unknown): Promise<T> {
  const res = await gatewayFetch(path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return readJson<T>(res);
}

export async function gatewayDelete(path: string): Promise<void> {
  const res = await gatewayFetch(path, { method: 'DELETE' });
  const text = await res.text();
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const data = JSON.parse(text) as { error?: string };
      if (data.error) msg = data.error;
    } catch {
      if (text) msg = text.slice(0, 240);
    }
    throw new Error(msg);
  }
  if (!text.trim()) return;
  try {
    JSON.parse(text);
  } catch {
    /* ignore non-JSON success body */
  }
}
