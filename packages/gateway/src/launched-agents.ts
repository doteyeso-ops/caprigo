/**
 * Per-session UI state for “launched agents” (cards + task lines), Solana-style.
 */

import type { AgentActivityEvent, TaskActivity } from '@caprigo/shared';
import { pushOrchestrationFeed } from './orchestration-feed';

export interface LaunchedAgentView {
  id: string;
  displayName: string;
  createdAt: number;
  status: 'idle' | 'thinking' | 'error';
  tasks: TaskActivity[];
  lastError?: string;
}

const store = new Map<string, LaunchedAgentView>();

export function registerLaunchedAgent(id: string, displayName: string): void {
  store.set(id, {
    id,
    displayName: displayName.trim() || `Agent ${id.slice(0, 8)}`,
    createdAt: Date.now(),
    status: 'idle',
    tasks: [],
  });
}

export function ensureLaunchedAgent(id: string): LaunchedAgentView {
  let v = store.get(id);
  if (!v) {
    v = {
      id,
      displayName: `Agent ${id.slice(0, 8)}`,
      createdAt: Date.now(),
      status: 'idle',
      tasks: [],
    };
    store.set(id, v);
  }
  return v;
}

export function removeLaunchedAgent(id: string): void {
  store.delete(id);
}

export function getLaunchedAgent(id: string): LaunchedAgentView | undefined {
  return store.get(id);
}

export function setAgentStatus(id: string, status: LaunchedAgentView['status'], lastError?: string): void {
  const v = store.get(id);
  if (!v) return;
  v.status = status;
  if (lastError !== undefined) v.lastError = lastError;
  else if (status !== 'error') v.lastError = undefined;
}

export function clearTasksForTurn(id: string): void {
  const v = ensureLaunchedAgent(id);
  v.tasks = [];
}

/** Wire Agent activity stream into task rows. */
export function handleAgentActivity(e: AgentActivityEvent): void {
  if (e.type === 'orchestration_exchange') {
    pushOrchestrationFeed({
      fromSessionId: e.fromSessionId,
      toSessionId: e.toSessionId,
      kind: e.kind,
      excerpt: e.excerpt,
    });
    const line = `Fleet · ${e.kind}: ${e.excerpt.slice(0, 140)}`;
    const tid = () => `fleet-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const from = ensureLaunchedAgent(e.fromSessionId);
    const to = ensureLaunchedAgent(e.toSessionId);
    from.tasks.push({ taskId: tid(), status: line, done: true });
    to.tasks.push({ taskId: tid(), status: line, done: true });
    if (from.tasks.length > 30) from.tasks = from.tasks.slice(-30);
    if (to.tasks.length > 30) to.tasks = to.tasks.slice(-30);
    return;
  }

  const v = store.get(e.sessionId);
  if (!v) return;

  if (e.type === 'task_start') {
    v.tasks.push({
      taskId: e.taskId,
      status: e.label,
      done: false,
    });
    return;
  }

  if (e.type === 'task_end') {
    const row = v.tasks.find(t => t.taskId === e.taskId);
    if (row) {
      row.done = true;
      if (!e.ok) {
        row.status = `${row.status} — ${e.detail || 'error'}`;
      }
    }
  }
}
