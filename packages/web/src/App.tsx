import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { AgentFleet } from './components/AgentFleet';
import { ConfigPanel } from './components/ConfigPanel';
import { WorkspacePanel } from './components/WorkspacePanel';
import { SettingsPanel } from './components/SettingsPanel';
import { DeskPanel } from './components/DeskPanel';
import { AgentDetailsDialog, AgentSkillsDialog } from './components/AgentSessionDialogs';
import { AgentBuilderDialog } from './components/AgentBuilderDialog';
import { SystemMonitorWidget } from './components/SystemMonitorWidget';
import { DashboardHero } from './components/DashboardHero';
import type {
  AgentCardModel,
  HealthPayload,
  LocalScriptItem,
  RuntimePayload,
  SessionPatchPayload,
  SkillListItem,
} from './types';
import { LEGACY_MONITOR_DOCK_KEY } from './legacyStorageKeys';

const MONITOR_DOCK_KEY = 'caprigo.systemMonitor.docked';

interface Message {
  role: 'user' | 'assistant' | 'offline' | 'orchestration';
  content: string;
  offline?: {
    scriptId: string;
    scriptName?: string;
    exitCode: number;
    ok: boolean;
    stderr?: string;
  };
  orchestration?: {
    peerSessionId: string;
    peerLabel?: string;
    kind: 'directive' | 'update' | 'reply';
    channel: 'out' | 'in';
  };
}

async function fetchSessions(): Promise<AgentCardModel[]> {
  const r = await fetch('/api/sessions');
  if (!r.ok) throw new Error('Failed to list sessions');
  const d = await r.json();
  return (d.sessions || []) as AgentCardModel[];
}

export default function App() {
  const [agents, setAgents] = useState<AgentCardModel[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [skills, setSkills] = useState<SkillListItem[]>([]);
  const [health, setHealth] = useState<HealthPayload | null>(null);
  const [runtime, setRuntime] = useState<RuntimePayload | null>(null);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'workspace' | 'chat' | 'settings'>('dashboard');
  const [localScripts, setLocalScripts] = useState<LocalScriptItem[]>([]);
  const [localScriptsDir, setLocalScriptsDir] = useState<string | null>(null);
  const [offlineRunningId, setOfflineRunningId] = useState<string | null>(null);
  const [detailsAgentId, setDetailsAgentId] = useState<string | null>(null);
  const [detailsTaskFocus, setDetailsTaskFocus] = useState(false);
  const [skillsAgentId, setSkillsAgentId] = useState<string | null>(null);
  const [builder, setBuilder] = useState<{ open: boolean; editId: string | null }>({
    open: false,
    editId: null,
  });
  const [monitorDocked, setMonitorDocked] = useState(() => {
    try {
      const v = localStorage.getItem(MONITOR_DOCK_KEY);
      if (v !== null) return v === '1';
      return localStorage.getItem(LEGACY_MONITOR_DOCK_KEY) === '1';
    } catch {
      return false;
    }
  });
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);
  /** Bumps when opening Chat from Workspace so the compose box can auto-focus. */
  const [chatFocusSerial, setChatFocusSerial] = useState(0);
  const selectedIdRef = useRef<string | null>(null);
  const loadMessagesSeqRef = useRef(0);

  const loadOllamaModels = useCallback(async () => {
    try {
      let path = '/api/ollama/models';
      try {
        const rt = await fetch('/api/runtime').then(r => r.json());
        const p = String(rt?.llmProvider || '').toLowerCase();
        if (p === 'openai_compatible' || p === 'openai') path = '/api/openai/models';
      } catch {
        /* default: Ollama */
      }
      const r = await fetch(path);
      const d = (await r.json()) as { models?: string[] };
      setOllamaModels(Array.isArray(d.models) ? d.models : []);
    } catch {
      setOllamaModels([]);
    }
  }, []);

  const refreshStatus = useCallback(async () => {
    try {
      const [h, rt] = await Promise.all([fetch('/health'), fetch('/api/runtime')]);
      const [hData, rtData] = await Promise.all([h.json(), rt.json()]);
      setHealth(hData);
      setRuntime(rtData);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(MONITOR_DOCK_KEY, monitorDocked ? '1' : '0');
    } catch {
      /* ignore */
    }
  }, [monitorDocked]);

  const loadAgents = useCallback(async () => {
    try {
      const list = await fetchSessions();
      setAgents(list);
      return list;
    } catch {
      return [];
    }
  }, []);

  const loadMessages = useCallback(async (sessionId: string) => {
    const seq = ++loadMessagesSeqRef.current;
    const r = await fetch(`/api/sessions/${sessionId}/messages`);
    if (!r.ok) return;
    const d = await r.json();
    if (seq !== loadMessagesSeqRef.current) return;
    if (selectedIdRef.current !== sessionId) return;
    setMessages((d.messages || []) as Message[]);
  }, []);

  const reloadSkills = useCallback(async () => {
    try {
      const [sr, rt] = await Promise.all([fetch('/api/skills'), fetch('/api/runtime')]);
      const jd = await sr.json();
      const rd = await rt.json();
      const raw = (jd.skills || []) as Array<{
        name: string;
        description: string;
        source?: string;
        vibesListingId?: string | null;
        vibesTitle?: string | null;
      }>;
      setSkills(
        raw.map(s => ({
          name: s.name,
          description: s.description,
          source:
            s.source === 'mcp'
              ? 'mcp'
              : s.source === 'agentskill'
                ? 'agentskill'
                : s.source === 'marketplace'
                  ? 'marketplace'
                  : s.source === 'user'
                    ? 'user'
                    : 'core',
          vibesListingId: s.vibesListingId ?? undefined,
          vibesTitle: s.vibesTitle ?? undefined,
        }))
      );
      setRuntime(rd);
    } catch {
      /* ignore */
    }
  }, []);

  const patchSession = useCallback(async (id: string, body: SessionPatchPayload) => {
    const r = await fetch(`/api/sessions/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      let msg = `HTTP ${r.status}`;
      try {
        const j = (await r.json()) as { error?: string };
        if (j?.error) msg = j.error;
      } catch {
        /* ignore */
      }
      throw new Error(msg);
    }
    await loadAgents();
  }, [loadAgents]);

  const createAgentApi = useCallback(
    async (body: Record<string, unknown>) => {
      const r = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        let msg = `HTTP ${r.status}`;
        try {
          const j = (await r.json()) as { error?: string };
          if (j?.error) msg = j.error;
        } catch {
          /* ignore */
        }
        throw new Error(msg);
      }
      const d = (await r.json()) as { id: string };
      await loadAgents();
      setSelectedId(d.id);
      setMessages([]);
      return { id: d.id };
    },
    [loadAgents]
  );

  const consumeDetailsTaskFocus = useCallback(() => setDetailsTaskFocus(false), []);

  const builderAgent = useMemo(
    () => (builder.editId ? agents.find(a => a.id === builder.editId) ?? null : null),
    [builder.editId, agents]
  );

  const orchestratorsForBuilder = useMemo(
    () => agents.filter(a => a.agentRole === 'orchestrator' && a.id !== builder.editId),
    [agents, builder.editId]
  );

  useEffect(() => {
    void reloadSkills();
    void loadOllamaModels();
    void refreshStatus();
    fetch('/api/offline-scripts')
      .then(r => r.json())
      .then(d => {
        setLocalScripts(d.scripts || []);
        setLocalScriptsDir(d.scriptsDir || null);
      })
      .catch(() => {});
  }, [reloadSkills, loadOllamaModels, refreshStatus]);

  useEffect(() => {
    loadAgents().then(list => {
      if (list.length === 0) {
        setSelectedId(null);
        return;
      }
      setSelectedId(prev => (prev && list.some(a => a.id === prev) ? prev : list[0].id));
    });
  }, [loadAgents]);

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  useEffect(() => {
    if (selectedId) loadMessages(selectedId);
  }, [selectedId, loadMessages]);

  useEffect(() => {
    const t = window.setInterval(() => loadAgents(), 800);
    return () => clearInterval(t);
  }, [loadAgents]);

  useEffect(() => {
    const t = window.setInterval(() => {
      void refreshStatus();
    }, 5000);
    return () => clearInterval(t);
  }, [refreshStatus]);

  useEffect(() => {
    if (detailsAgentId && !agents.some(a => a.id === detailsAgentId)) setDetailsAgentId(null);
    if (skillsAgentId && !agents.some(a => a.id === skillsAgentId)) setSkillsAgentId(null);
  }, [agents, detailsAgentId, skillsAgentId]);

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || !selectedId || loading) return;
    const sessionIdAtSend = selectedId;
    const sel = agents.find(a => a.id === selectedId);
    if (sel?.runtimeMode === 'offline') return;
    setInput('');
    setMessages(m => [...m, { role: 'user', content: text }]);
    setLoading(true);
    try {
      const res = await fetch(`/api/sessions/${sessionIdAtSend}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text }),
      });
      let data: { response?: string; error?: string } = {};
      try {
        data = await res.json();
      } catch {
        data = { error: `Server error (${res.status})` };
      }
      if (data.response !== undefined) {
        if (selectedIdRef.current === sessionIdAtSend) {
          setMessages(m => [...m, { role: 'assistant', content: data.response! }]);
        }
      } else {
        if (selectedIdRef.current === sessionIdAtSend) {
          setMessages(m => [...m, { role: 'assistant', content: `Error: ${data.error || 'Unknown error'}` }]);
        }
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Network error';
      if (selectedIdRef.current === sessionIdAtSend) {
        setMessages(m => [...m, { role: 'assistant', content: `Error: ${msg}` }]);
      }
    } finally {
      setLoading(false);
      loadAgents();
      void refreshStatus();
    }
  };

  const runOfflineScript = async (sessionId: string, scriptId: string) => {
    if (!scriptId || offlineRunningId) return;
    setOfflineRunningId(sessionId);
    try {
      await fetch(`/api/sessions/${sessionId}/offline/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scriptId, args: [] }),
      });
      await loadMessages(sessionId);
      await loadAgents();
    } finally {
      setOfflineRunningId(null);
    }
  };

  const closeAgent = async (id: string) => {
    if (!window.confirm('Remove this agent? Its conversation is deleted.')) return;
    await fetch(`/api/sessions/${id}`, { method: 'DELETE' });
    const list = await fetchSessions();
    setAgents(list);
    if (selectedId === id) {
      const next = list[0]?.id ?? null;
      setSelectedId(next);
      if (next) await loadMessages(next);
      else setMessages([]);
    }
  };

  const renameAgent = async (id: string) => {
    const a = agents.find(x => x.id === id);
    const next = window.prompt('Display name', a?.displayName || '');
    if (next === null) return;
    if (!next.trim()) {
      window.alert('Display name cannot be empty.');
      return;
    }
    const r = await fetch(`/api/sessions/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ displayName: next }),
    });
    if (r.ok) loadAgents();
  };

  const selectedAgent = agents.find(a => a.id === selectedId) ?? null;

  const llm = health?.llm;
  const llmOk =
    llm?.provider === 'ollama'
      ? llm?.ollama === 'ok'
      : llm?.provider === 'openai_compatible'
        ? llm?.openai === 'ok'
        : true;

  const tabClass = (t: typeof activeTab) => (activeTab === t ? ' rb-tab--active' : '');

  return (
    <div className={`rb-app${monitorDocked ? ' rb-app--monitor-dock' : ''}`}>
      <header className="rb-topbar">
        <div className="rb-topbar__brand">
          <span className="rb-topbar__logo">Caprigo</span>
          <span className="rb-sr-only">Caprigo Core - overview, board, session, and settings</span>
        </div>
        <nav className="rb-tabs" aria-label="Primary">
          <button type="button" className={`rb-tab${tabClass('dashboard')}`} onClick={() => setActiveTab('dashboard')}>
            Overview
          </button>
          <button type="button" className={`rb-tab${tabClass('workspace')}`} onClick={() => setActiveTab('workspace')}>
            Board
          </button>
          <button type="button" className={`rb-tab${tabClass('chat')}`} onClick={() => setActiveTab('chat')}>
            Session
          </button>
          <button type="button" className={`rb-tab${tabClass('settings')}`} onClick={() => setActiveTab('settings')}>
            Settings
          </button>
        </nav>
        <div className="rb-topbar__right">
          <button
            type="button"
            className={`rb-monitor-tab${monitorDocked ? ' rb-monitor-tab--on' : ''}`}
            title="Toggle pinned system monitor panel"
            aria-pressed={monitorDocked}
            onClick={() => setMonitorDocked(v => !v)}
          >
            Monitor
          </button>
          {llm && (
            <span
              className={`rb-pill ${llmOk ? 'rb-pill--ok' : 'rb-pill--bad'}`}
              title={
                !llmOk && llm.openai_probe_detail
                  ? llm.openai_probe_detail
                  : llmOk
                    ? 'LLM backend reachable'
                    : 'LLM probe failed — see Runtime setup for detail'
              }
            >
              {llm.badge ? `${llm.badge} · ` : ''}
              {llm.provider === 'ollama' ? 'Ollama' : 'API'} · {llmOk ? 'ready' : 'check'}
            </span>
          )}
          {runtime && (
            <span className="rb-pill">
              Model <span className="rb-mono">{runtime.engine.model}</span>
            </span>
          )}
        </div>
      </header>

      {activeTab === 'dashboard' && (
        <div className="rb-dashboard-wrap">
          <DashboardHero
            agentCount={agents.length}
            skillCount={skills.length}
            llmStatus={!llm ? 'unset' : llmOk ? 'live' : 'check'}
            llmLabel={
              llm
                ? `${llm.badge ? `${llm.badge} · ` : ''}${llm.provider === 'ollama' ? 'Ollama' : 'API'}`
                : 'LLM'
            }
            modelLabel={runtime?.engine.model ?? ''}
            workspaceHint={runtime?.workspaceRoot ?? null}
            setupReady={agents.length === 0 && llmOk && !!runtime?.engine.model}
            onCreateAgent={() => setBuilder({ open: true, editId: null })}
          />
          <div className="rb-dashboard">
            <ConfigPanel health={health} runtime={runtime} skills={skills} agentCount={agents.length} onReloadSkills={reloadSkills} />

            <AgentFleet
              agents={agents}
              selectedId={selectedId}
              localScripts={localScripts}
              onSelect={id => {
                setSelectedId(id);
                loadMessages(id);
              }}
              onClose={closeAgent}
              onRename={renameAgent}
              onOpenBuilder={() => setBuilder({ open: true, editId: null })}
              onEditAgent={id => setBuilder({ open: true, editId: id })}
              onAgentDetails={id => {
                setDetailsAgentId(id);
                setDetailsTaskFocus(false);
              }}
              onAgentSkills={setSkillsAgentId}
            />
          </div>
        </div>
      )}

      {activeTab === 'workspace' && (
        <DeskPanel
          agents={agents}
          selectedId={selectedId}
          localScripts={localScripts}
          scriptsDir={localScriptsDir}
          offlineRunningId={offlineRunningId}
          onRunOfflineScript={runOfflineScript}
          onSetRuntimeMode={(id, mode) => patchSession(id, { runtimeMode: mode })}
          onSelectAgent={id => {
            setSelectedId(id);
            loadMessages(id);
          }}
          onOpenBuilder={() => setBuilder({ open: true, editId: null })}
          onEditAgent={id => setBuilder({ open: true, editId: id })}
          onRefreshAgents={loadAgents}
          onCloseAgent={closeAgent}
          onRenameAgent={renameAgent}
          onAgentDetails={id => {
            setDetailsAgentId(id);
            setDetailsTaskFocus(false);
          }}
          onAgentTaskInstructions={id => {
            setDetailsAgentId(id);
            setDetailsTaskFocus(true);
          }}
          onAgentSkills={setSkillsAgentId}
          onPlayAgent={(id, mode) => {
            setSelectedId(id);
            if (mode === 'offline') {
              setActiveTab('workspace');
              return;
            }
            setActiveTab('chat');
            void loadMessages(id);
            setChatFocusSerial(s => s + 1);
          }}
          onStopAgent={async id => {
            try {
              const r = await fetch(`/api/sessions/${id}/stop`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
              });
              if (!r.ok) {
                const j = (await r.json().catch(() => ({}))) as { error?: string };
                throw new Error(j.error || `HTTP ${r.status}`);
              }
              await loadAgents();
            } catch (e) {
              window.alert(e instanceof Error ? e.message : String(e));
            }
          }}
          onLinkWorkerToOrchestrator={async (workerId, orchestratorId) => {
            await patchSession(workerId, { linkedOrchestratorId: orchestratorId });
          }}
          engineModel={runtime?.engine.model ?? ''}
          llmProvider={health?.llm?.provider}
          ollamaModels={ollamaModels}
          onRefreshOllamaModels={loadOllamaModels}
          onSetSessionModel={async (sessionId, model) => {
            await patchSession(sessionId, { model });
          }}
        />
      )}

      {activeTab === 'chat' && (
        <div className="rb-chat-shell">
          <WorkspacePanel
            agents={agents}
            selected={selectedAgent}
            onSelectAgent={id => {
              setSelectedId(id);
              loadMessages(id);
            }}
            messages={messages}
            loading={loading}
            input={input}
            onInputChange={setInput}
            onSend={sendMessage}
            focusInputSerial={chatFocusSerial}
          />
        </div>
      )}

      {activeTab === 'settings' && (
        <SettingsPanel
          health={health}
          runtime={runtime}
          onSaved={setRuntime}
          onStatusRefresh={refreshStatus}
          ollamaModels={ollamaModels}
          onRefreshOllamaModels={loadOllamaModels}
          llmProvider={health?.llm?.provider}
        />
      )}

      {detailsAgentId && (
        <AgentDetailsDialog
          agent={agents.find(a => a.id === detailsAgentId) ?? null}
          allAgents={agents}
          runtime={runtime}
          localScripts={localScripts}
          llmProvider={health?.llm?.provider}
          ollamaModels={ollamaModels}
          onRefreshOllamaModels={loadOllamaModels}
          focusTaskSection={detailsTaskFocus}
          workspaceRoot={runtime?.workspaceRoot ?? null}
          onTaskFocusConsumed={consumeDetailsTaskFocus}
          onClose={() => {
            setDetailsAgentId(null);
            setDetailsTaskFocus(false);
          }}
          onFleetPatch={async (id, patch) => {
            await patchSession(id, patch);
          }}
          onPatchSession={patchSession}
          onPinSystemMonitor={() => setMonitorDocked(true)}
          onEdit={() => {
            const id = detailsAgentId;
            if (!id) return;
            setDetailsAgentId(null);
            setBuilder({ open: true, editId: id });
          }}
          onOpenChat={() => {
            const id = detailsAgentId;
            if (!id) return;
            setSelectedId(id);
            setDetailsAgentId(null);
            setActiveTab('chat');
            void loadMessages(id);
          }}
          onAssignSkills={() => {
            const id = detailsAgentId;
            if (!id) return;
            setSelectedId(id);
            setDetailsAgentId(null);
            setSkillsAgentId(id);
          }}
          onGoWorkspace={() => {
            const id = detailsAgentId;
            if (id) setSelectedId(id);
            setDetailsAgentId(null);
            setActiveTab('workspace');
          }}
        />
      )}

      {builder.open && (
        <AgentBuilderDialog
          open={builder.open}
          mode={builder.editId ? 'edit' : 'create'}
          agent={builderAgent}
          catalog={skills}
          localScripts={localScripts}
          scriptsDir={localScriptsDir}
          orchestrators={orchestratorsForBuilder}
          workspaceRoot={runtime?.workspaceRoot ?? null}
          engineModel={runtime?.engine.model ?? ''}
          llmProvider={health?.llm?.provider}
          ollamaModels={ollamaModels}
          onRefreshOllamaModels={loadOllamaModels}
          onClose={() => setBuilder({ open: false, editId: null })}
          onCreate={createAgentApi}
          onPatch={async (sessionId, patch) => {
            await patchSession(sessionId, patch);
          }}
          onCreated={() => setActiveTab('workspace')}
        />
      )}
      {monitorDocked && (
        <aside className="rb-monitor-dock" aria-label="System monitor">
          <header className="rb-monitor-dock__head">
            <span className="rb-monitor-dock__title">System monitor</span>
            <button type="button" className="rb-icon-btn" onClick={() => setMonitorDocked(false)} title="Hide panel">
              Close
            </button>
          </header>
          <div className="rb-monitor-dock__body">
            <SystemMonitorWidget layout="docked" pollMs={2500} />
          </div>
        </aside>
      )}

      {skillsAgentId && (
        <AgentSkillsDialog
          agent={agents.find(a => a.id === skillsAgentId) ?? null}
          catalog={skills}
          onClose={() => setSkillsAgentId(null)}
          onSave={async (sessionId, assignedSkills) => {
            await patchSession(sessionId, { assignedSkills });
          }}
        />
      )}
    </div>
  );
}
