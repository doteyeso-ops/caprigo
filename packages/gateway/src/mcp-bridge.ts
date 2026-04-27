/**
 * Bridges MCP stdio servers into Caprigo skills (one skill per MCP tool).
 */

import type { Agent } from '@caprigo/agent';
import type { Skill, SkillToolParameters } from '@caprigo/shared';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { McpServerEntry, McpServersFile } from './mcp-servers-store.js';

export type McpServerStatus = {
  id: string;
  enabled: boolean;
  ok: boolean;
  toolCount: number;
  error?: string;
};

type Connection = {
  client: Client;
  transport: StdioClientTransport;
  toolMap: Map<string, string>;
};

const MCP_TOOL_TIMEOUT_MS = Math.min(
  600_000,
  Math.max(30_000, parseInt(process.env.CAPRIGO_MCP_TOOL_TIMEOUT_MS || '180000', 10) || 180000)
);

let connections: Connection[] = [];
let registeredSkillNames: string[] = [];
let lastStatuses: McpServerStatus[] = [];

function makeCaprigoSkillName(serverId: string, toolName: string): string {
  const safe = String(toolName).replace(/[^a-zA-Z0-9_]/g, '_');
  return `mcp_${serverId}_${safe}`;
}

function inputSchemaToToolParameters(schema: {
  type?: string;
  properties?: Record<string, object>;
  required?: string[];
}): SkillToolParameters {
  return {
    type: 'object',
    properties: (schema.properties || {}) as Record<string, unknown>,
    required: schema.required,
    additionalProperties: true,
  };
}

function serializeCallToolResult(result: unknown): unknown {
  if (!result || typeof result !== 'object') return result;
  const r = result as Record<string, unknown>;
  const content = r.content;
  if (!Array.isArray(content)) return result;
  const parts: unknown[] = [];
  for (const block of content) {
    if (!block || typeof block !== 'object') {
      parts.push(block);
      continue;
    }
    const b = block as Record<string, unknown>;
    if (b.type === 'text' && typeof b.text === 'string') {
      parts.push({ type: 'text', text: b.text });
      continue;
    }
    if (b.type === 'image' && typeof b.data === 'string') {
      const n = b.data.length;
      parts.push({
        type: 'image',
        mimeType: b.mimeType,
        data: n > 8000 ? `[base64 image omitted: ${n} chars]` : b.data,
      });
      continue;
    }
    if (b.type === 'audio' && typeof b.data === 'string') {
      const n = b.data.length;
      parts.push({
        type: 'audio',
        mimeType: b.mimeType,
        data: n > 8000 ? `[base64 audio omitted: ${n} chars]` : b.data,
      });
      continue;
    }
    parts.push(block);
  }
  return { ...r, content: parts };
}

export function getMcpServerStatuses(): McpServerStatus[] {
  return lastStatuses;
}

/** Skill names currently registered from MCP (for GET /api/skills source tagging). */
export function getMcpRegisteredSkillNames(): string[] {
  return [...registeredSkillNames];
}

export async function closeMcpBridge(): Promise<void> {
  for (const c of connections) {
    try {
      await c.client.close();
    } catch {
      /* ignore */
    }
    try {
      await c.transport.close();
    } catch {
      /* ignore */
    }
  }
  connections = [];
}

export async function refreshMcpBridge(agent: Agent, file: McpServersFile): Promise<void> {
  await closeMcpBridge();
  for (const name of registeredSkillNames) {
    agent.unregisterSkill(name);
  }
  registeredSkillNames = [];
  lastStatuses = [];

  const disabled = (process.env.CAPRIGO_DISABLE_MCP || '').trim();
  if (disabled === '1' || disabled.toLowerCase() === 'true') {
    console.log('[MCP] Disabled (CAPRIGO_DISABLE_MCP)');
    return;
  }

  const statuses: McpServerStatus[] = [];

  for (const srv of file.servers) {
    if (!srv.enabled) {
      statuses.push({ id: srv.id, enabled: false, ok: true, toolCount: 0 });
      continue;
    }

    const client = new Client({ name: 'caprigo-gateway', version: '2.0.0' }, { capabilities: {} });
    const transport = new StdioClientTransport({
      command: srv.command,
      args: srv.args || [],
      env: srv.env,
      cwd: srv.cwd,
      stderr: 'inherit',
    });

    const toolMap = new Map<string, string>();

    try {
      await client.connect(transport);
      const listed = await client.listTools(undefined, { timeout: 120_000 });
      const tools = listed.tools || [];

      for (const t of tools) {
        const mcpName = t.name;
        const skillName = makeCaprigoSkillName(srv.id, mcpName);
        toolMap.set(skillName, mcpName);
        const desc =
          (t.description ? String(t.description) : `MCP tool ${mcpName}`) +
          ` [MCP ${srv.id}/${mcpName}]`;

        const schema = t.inputSchema;
        const skill: Skill = {
          name: skillName,
          description: desc,
          toolParameters:
            schema && typeof schema === 'object' && (schema as { type?: string }).type === 'object'
              ? inputSchemaToToolParameters(
                  schema as { type: 'object'; properties?: Record<string, object>; required?: string[] }
                )
              : undefined,
          executionType: 'local',
          execute: async (params: Record<string, unknown>) => {
            try {
              const raw = await client.callTool(
                { name: mcpName, arguments: params || {} },
                undefined,
                { timeout: MCP_TOOL_TIMEOUT_MS }
              );
              const summarized = serializeCallToolResult(raw);
              if (
                summarized &&
                typeof summarized === 'object' &&
                (summarized as Record<string, unknown>).isError
              ) {
                return { success: false, error: JSON.stringify(summarized), mcp: true };
              }
              return { success: true, result: summarized, mcp: true };
            } catch (e: any) {
              return {
                success: false,
                error: e?.message || String(e),
                mcp: true,
              };
            }
          },
        };
        agent.registerSkill(skill);
        registeredSkillNames.push(skillName);
      }

      connections.push({ client, transport, toolMap });
      statuses.push({ id: srv.id, enabled: true, ok: true, toolCount: tools.length });
      console.log(`[MCP] Connected ${srv.id}: ${tools.length} tools (${tools.map(x => x.name).join(', ')})`);
    } catch (e: any) {
      try {
        await client.close();
      } catch {
        /* ignore */
      }
      try {
        await transport.close();
      } catch {
        /* ignore */
      }
      const msg = e?.message || String(e);
      console.warn(`[MCP] Failed to connect ${srv.id}: ${msg}`);
      statuses.push({ id: srv.id, enabled: true, ok: false, toolCount: 0, error: msg });
    }
  }

  lastStatuses = statuses;
}
