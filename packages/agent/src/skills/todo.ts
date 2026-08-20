/**
 * Session `todo` skill — Hermes-compatible planning tool.
 */

import { Skill } from '@caprigo/shared';
import type { TodoStore } from '../todo-store';

/** Bound by Agent so execute can reach the session store. */
let resolveStore: ((sessionId?: string) => TodoStore | null) | null = null;

export function bindTodoStoreResolver(fn: (sessionId?: string) => TodoStore | null): void {
  resolveStore = fn;
}

export const todoSkill: Skill = {
  name: 'todo',
  description:
    'Manage your task list for the current session. Use for complex tasks with 3+ steps. ' +
    'Call with no parameters to read. Provide todos[] to write (merge=false replaces; merge=true updates by id). ' +
    'Each item: {id, content, status: pending|in_progress|completed|cancelled}. Only ONE in_progress at a time. ' +
    'Mark completed immediately when done. Always returns the full list.',
  toolParameters: {
    type: 'object',
    properties: {
      todos: {
        type: 'array',
        description: 'Task items to write. Omit to read.',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            content: { type: 'string' },
            status: {
              type: 'string',
              enum: ['pending', 'in_progress', 'completed', 'cancelled'],
            },
          },
          required: ['id', 'content', 'status'],
          additionalProperties: false,
        },
      },
      merge: {
        type: 'boolean',
        description: 'true: update by id; false (default): replace entire list',
      },
    },
    additionalProperties: false,
  },
  execute: async (params: { todos?: unknown; merge?: boolean }, ctx?: { sessionId?: string }) => {
    const store = resolveStore?.(ctx?.sessionId) || null;
    if (!store) {
      return { success: false, error: 'Todo store not available for this session.' };
    }
    if (params.todos != null) {
      let list = params.todos as unknown;
      if (typeof list === 'string') {
        try {
          list = JSON.parse(list);
        } catch {
          return { success: false, error: 'todos must be a list of objects' };
        }
      }
      if (!Array.isArray(list)) {
        return { success: false, error: `todos must be a list, got ${typeof list}` };
      }
      const items = store.write(list as any[], !!params.merge);
      return { success: true, todos: items, summary: store.summary() };
    }
    return { success: true, todos: store.read(), summary: store.summary() };
  },
};

export const todoSkills: Skill[] = [todoSkill];
