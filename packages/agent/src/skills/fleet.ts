/**
 * Fleet / orchestration tools — coordinate other sessions with visible transcript lines.
 */
import { normalizeFleetAssignment, type Skill, type OrchestrationKind, type Session } from '@caprigo/shared';

function shortId(id: string): string {
  return id.slice(0, 8);
}

function clip(s: string | undefined, max: number): string | undefined {
  if (!s) return undefined;
  const t = s.trim();
  if (!t) return undefined;
  return t.length <= max ? t : t.slice(0, max - 1) + '…';
}

export interface FleetAgentBinding {
  getSession(id: string): Session | undefined;
  getSessions(): Session[];
  recordFleetExchange(
    fromSessionId: string,
    toSessionId: string,
    content: string,
    kind: OrchestrationKind,
    labels?: { fromLabel?: string; toLabel?: string }
  ): void;
}

export function createFleetSkills(agent: FleetAgentBinding): Skill[] {
  const fleet_message: Skill = {
    name: 'fleet_message',
    description:
      'Cross-session coordination (same Caprigo gateway). **Orchestrator → chained agents only:** kind `directive` (assign work, expected outcome), or `reply` (answer agent). **Task agent → linked orchestrator only:** kind `update` (progress, blocked, or done summary) or `reply` (answer orchestrator). Params: targetSessionId (full uuid from fleet_roster), message (clear text), kind, targetLabel (optional display hint).',
    toolParameters: {
      type: 'object',
      required: ['targetSessionId', 'message', 'kind'],
      properties: {
        targetSessionId: { type: 'string' },
        message: { type: 'string' },
        kind: { type: 'string', enum: ['directive', 'update', 'reply'] },
        targetLabel: { type: 'string' },
      },
    },
    execute: async (params, meta) => {
      const fromSessionId = meta?.sessionId;
      if (!fromSessionId) {
        return { success: false, error: 'No session context for fleet_message' };
      }
      const from = agent.getSession(fromSessionId);
      if (!from) return { success: false, error: 'Session not found' };
      if (from.runtimeMode === 'offline') {
        return { success: false, error: 'Offline-only agents cannot use fleet tools' };
      }

      const targetSessionId = String(params?.targetSessionId ?? '').trim();
      const message = String(params?.message ?? '').trim();
      const kind = String(params?.kind ?? 'directive').toLowerCase() as OrchestrationKind;
      const targetLabel = params?.targetLabel ? String(params.targetLabel).trim() : undefined;

      if (!targetSessionId || !message) {
        return { success: false, error: 'targetSessionId and message required' };
      }
      if (!['directive', 'update', 'reply'].includes(kind)) {
        return { success: false, error: 'kind must be directive, update, or reply' };
      }
      if (targetSessionId === fromSessionId) {
        return { success: false, error: 'Cannot message your own session' };
      }

      const role = normalizeFleetAssignment(from.agentRole);
      const linked = from.linkedOrchestratorId;

      if (role === 'orchestrator') {
        if (kind === 'update') {
          return { success: false, error: 'Orchestrators should use directive or reply, not update' };
        }
        const target = agent.getSession(targetSessionId);
        if (!target) {
          return { success: false, error: 'Target session not found' };
        }
        if (target.linkedOrchestratorId !== fromSessionId) {
          return {
            success: false,
            error:
              'Orchestrators may only message agents **chained to you** (target must have linkedOrchestratorId = your session). Use Workspace Chain (orchestrator → agent) or Details.',
          };
        }
      } else {
        if (!linked || targetSessionId !== linked) {
          return {
            success: false,
            error:
              'Task agents may only fleet_message their linked orchestrator. Set linked orchestrator in Details or Workspace chain.',
          };
        }
        if (kind === 'directive') {
          return { success: false, error: 'Only orchestrators send directives; agents use update or reply' };
        }
      }

      try {
        agent.recordFleetExchange(fromSessionId, targetSessionId, message, kind, {
          toLabel: targetLabel,
        });
        return {
          success: true,
          delivered: true,
          targetSessionId: shortId(targetSessionId) + '…',
          kind,
        };
      } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : String(e) };
      }
    },
  };

  const fleet_roster: Skill = {
    name: 'fleet_roster',
    description:
      'List other sessions: full id (use verbatim in fleet_message), role, link status, optional description/objective snippets. Refresh before targeting.',
    execute: async (_params, meta) => {
      if (!meta?.sessionId) {
        return { success: false, error: 'No session context' };
      }
      const self = meta.sessionId;
      const sessions = agent.getSessions();
      return {
        success: true,
        agents: sessions
          .filter(s => s.id !== self)
          .map(s => ({
            id: s.id,
            messageCount: s.messages.length,
            role: normalizeFleetAssignment(s.agentRole),
            linkedOrchestratorId: s.linkedOrchestratorId ?? null,
            runtimeMode: s.runtimeMode ?? 'llm',
            description: clip(s.description, 160),
            objective: clip(s.objective, 160),
          })),
      };
    },
  };

  return [fleet_message, fleet_roster];
}
