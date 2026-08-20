/**
 * Session todo list — ported from Nous Hermes Agent `tools/todo_tool.py` (MIT).
 * Planning aid the model re-reads; HOME seeds items from MissionPlan steps.
 */

export type TodoStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';

export interface TodoItem {
  id: string;
  content: string;
  status: TodoStatus;
}

const VALID = new Set<TodoStatus>(['pending', 'in_progress', 'completed', 'cancelled']);
const MAX_CONTENT = 400;
const MAX_ITEMS = 32;

function cap(s: string): string {
  const t = String(s || '').trim();
  if (t.length <= MAX_CONTENT) return t || '(no description)';
  return t.slice(0, MAX_CONTENT - 1) + '…';
}

function normalize(item: Partial<TodoItem> & { id?: string; content?: string; status?: string }): TodoItem {
  const id = String(item.id || '?').trim() || '?';
  const content = cap(String(item.content || ''));
  let status = String(item.status || 'pending').toLowerCase() as TodoStatus;
  if (!VALID.has(status)) status = 'pending';
  return { id, content, status };
}

export class TodoStore {
  private items: TodoItem[] = [];

  read(): TodoItem[] {
    return this.items.map(i => ({ ...i }));
  }

  hasActive(): boolean {
    return this.items.some(i => i.status === 'pending' || i.status === 'in_progress');
  }

  write(todos: Array<Partial<TodoItem>>, merge = false): TodoItem[] {
    const cleaned = todos.map(normalize).slice(0, MAX_ITEMS);
    if (!merge) {
      this.items = cleaned;
      return this.read();
    }
    const map = new Map(this.items.map(i => [i.id, { ...i }]));
    for (const t of cleaned) {
      const prev = map.get(t.id);
      if (prev) {
        if (t.content) prev.content = t.content;
        if (t.status) prev.status = t.status;
        map.set(t.id, prev);
      } else {
        map.set(t.id, t);
        this.items.push(t);
      }
    }
    this.items = this.items
      .map(i => map.get(i.id) || i)
      .filter((i, idx, arr) => arr.findIndex(x => x.id === i.id) === idx)
      .slice(0, MAX_ITEMS);
    return this.read();
  }

  markCompleted(idOrNeedle: string): void {
    const n = idOrNeedle.toLowerCase();
    for (const item of this.items) {
      if (item.id === idOrNeedle || item.content.toLowerCase().includes(n)) {
        if (item.status !== 'cancelled') item.status = 'completed';
      }
    }
  }

  markToolDone(tool: string): void {
    const t = tool.toLowerCase();
    for (const item of this.items) {
      if (item.status === 'completed' || item.status === 'cancelled') continue;
      if (item.id === t || item.content.toLowerCase().includes(t)) {
        item.status = 'completed';
        break;
      }
    }
    // Promote next pending → in_progress
    const next = this.items.find(i => i.status === 'pending');
    if (next && !this.items.some(i => i.status === 'in_progress')) {
      next.status = 'in_progress';
    }
  }

  /** Compact block for system prompt (Hermes-style active list). */
  formatForPrompt(): string {
    const active = this.items.filter(i => i.status === 'pending' || i.status === 'in_progress');
    if (!active.length) return '';
    const markers: Record<string, string> = {
      completed: '[x]',
      in_progress: '[>]',
      pending: '[ ]',
      cancelled: '[~]',
    };
    const lines = ['## Active task list (Caprigo todo)', 'Mark items done via the `todo` tool as you finish them.'];
    for (const item of active) {
      lines.push(`- ${markers[item.status] || '[?]'} ${item.id}. ${item.content}`);
    }
    return lines.join('\n');
  }

  summary() {
    const items = this.items;
    return {
      total: items.length,
      pending: items.filter(i => i.status === 'pending').length,
      in_progress: items.filter(i => i.status === 'in_progress').length,
      completed: items.filter(i => i.status === 'completed').length,
      cancelled: items.filter(i => i.status === 'cancelled').length,
    };
  }
}

/** Seed todos from a HOME mission plan (bootstrap + remaining). */
export function seedTodosFromMissionSteps(
  steps: Array<{ tool: string; label?: string }>,
  objective: string
): TodoItem[] {
  const out: TodoItem[] = [
    { id: 'goal', content: cap(`Goal: ${objective}`), status: 'in_progress' },
  ];
  steps.forEach((s, i) => {
    out.push({
      id: String(i + 1),
      content: cap(`${s.label || s.tool}`),
      status: i === 0 ? 'in_progress' : 'pending',
    });
  });
  if (out.length > 1) {
    out[0].status = 'pending';
  }
  return out.slice(0, MAX_ITEMS);
}
