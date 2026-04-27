import React, { useEffect, useState } from 'react';

interface FeedEntry {
  ts: number;
  fromSessionId: string;
  toSessionId: string;
  kind: string;
  excerpt: string;
}

interface Props {
  /** Poll interval ms; 0 = disabled */
  pollMs?: number;
}

export function OrchestrationFeedStrip({ pollMs = 1500 }: Props) {
  const [entries, setEntries] = useState<FeedEntry[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!pollMs) return;
    let cancelled = false;
    const load = async () => {
      try {
        const r = await fetch('/api/orchestration-feed?limit=24');
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const d = (await r.json()) as { entries?: FeedEntry[] };
        if (!cancelled) {
          setEntries(d.entries || []);
          setErr(null);
        }
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      }
    };
    void load();
    const id = window.setInterval(load, pollMs);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [pollMs]);

  if (err && entries.length === 0) {
    return (
      <div className="rb-orchestration-feed rb-orchestration-feed--err" role="status">
        <span className="rb-orchestration-feed__title">Fleet log</span>
        <span className="rb-muted">{err}</span>
      </div>
    );
  }

  return (
    <div className="rb-orchestration-feed" aria-label="Recent fleet messages between agents">
      <div className="rb-orchestration-feed__head">
        <span className="rb-orchestration-feed__title">Fleet log</span>
        <span className="rb-orchestration-feed__hint">Cross-agent tools · visible in Session as Fleet lines</span>
      </div>
      {entries.length === 0 ? (
        <p className="rb-orchestration-feed__empty rb-muted">
          No fleet traffic yet. Mark one session <strong>Orchestrator</strong> and chain <strong>Agent</strong> sessions on
          the Board, then use fleet tools from Session.
        </p>
      ) : (
        <ul className="rb-orchestration-feed__list">
          {entries.map((e, i) => (
            <li key={`${e.ts}-${i}`} className="rb-orchestration-feed__item">
              <span className="rb-orchestration-feed__kind">{e.kind}</span>
              <span className="rb-mono rb-orchestration-feed__ids">
                {e.fromSessionId.slice(0, 8)}→{e.toSessionId.slice(0, 8)}
              </span>
              <span className="rb-orchestration-feed__excerpt">{e.excerpt}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
