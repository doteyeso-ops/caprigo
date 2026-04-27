/**
 * Recent cross-agent fleet messages for the Orchestration UI (in-memory).
 */

const MAX = 80;
const entries: Array<{
  ts: number;
  fromSessionId: string;
  toSessionId: string;
  kind: string;
  excerpt: string;
}> = [];

export function pushOrchestrationFeed(e: {
  fromSessionId: string;
  toSessionId: string;
  kind: string;
  excerpt: string;
}): void {
  entries.push({ ts: Date.now(), ...e });
  while (entries.length > MAX) entries.shift();
}

export function getOrchestrationFeed(limit: number): typeof entries {
  const n = Math.min(MAX, Math.max(1, limit));
  return entries.slice(-n);
}
